// STEP 09: a lost reply is not a failed write.
//
// Step 08's store was a JavaScript array, and an array has two answers: it took the record, or it
// threw. A database on the other side of a network has a third — the INSERT commits and the reply
// never arrives. `audit` used to treat that as a failure, and told the caller two false things:
// that the decision "could not be written down", and that retrying was safe.
//
// Worse than either, the log and the answer disagreed. An auditor reconstructing the request found
// ALLOWED; the caller held a refusal. A decision record exists to stop exactly that.
//
// `DSOR-UNK-01b` is the rule: an unknown outcome is reported as unknown, never as a retryable
// error. So `audit` does not guess which of the two happened. It looks.

import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migrationsIn } from "../src/migrations.ts";
import {
  audit,
  forgetTheLog,
  OutcomeUnknown,
  resetClock,
  setClock,
  theHead,
  theLog,
  useDatabase,
  verifyChain,
  type Database,
  type DecisionToRecord,
} from "../src/audit.ts";
import { callOperation } from "../src/operations.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const SUPERVISOR = { loggedInAs: "user_123" };

let real: PGlite;

beforeEach(async () => {
  real = await PGlite.create();
  await real.exec("CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'local-throwaway-not-a-secret';");

  for (const migration of migrationsIn(fileURLToPath(new URL("../migrations", import.meta.url)))) {
    await real.exec(migration.sql);
  }
});

afterEach(async () => {
  resetClock();
  await real.close();
});

function aDecision(id: string): DecisionToRecord {
  return {
    kind: "decision",
    subject: "user_123",
    tenant: "org_456",
    requestId: id,
    operation: "invoice.get@1",
    authorization: "ALLOW",
    result: "ALLOWED",
  };
}

/**
 * The real database, with one fault injected on the first INSERT.
 *
 * `lose the reply` runs the INSERT and *then* throws, which is what a connection dropped after a
 * commit looks like from here: the row is in the table and the caller has an error.
 * `fail the insert` throws before it, which is a write that genuinely did not happen. The whole
 * point is that these two are indistinguishable to the caller of `db.query`.
 */
function withOneBrokenInsert(mode: "lose the reply" | "fail the insert"): Database {
  let used = false;

  return {
    async query<T>(sql: string, params?: unknown[]) {
      const breaking = !used && sql.includes("INSERT");

      if (breaking && mode === "fail the insert") {
        used = true;

        // A failure the SERVER reports, not a dropped connection: the `authorization` value is
        // rewritten to one the CHECK constraint refuses, so PostgreSQL itself raises 23514. The
        // first version threw a bare Error here, which — once connection errors were told apart
        // from server errors — is a lost connection, not a refused write, and is reported as
        // unknown. A server's own "no" is the only failure that is definitely a failure.
        const refused = [...(params ?? [])];

        refused[12] = "MAYBE";

        return real.query<T>(sql, refused);
      }

      const rows = await real.query<T>(sql, params);

      if (breaking && mode === "lose the reply") {
        used = true;

        throw new Error("connection terminated unexpectedly");
      }

      return rows;
    },
  };
}

describe("an INSERT whose reply is lost", () => {
  it("DSOR-EXE-02: the decision stands, because it really was recorded", async () => {
    useDatabase(withOneBrokenInsert("lose the reply"));

    const record = await audit(aDecision("req_1"));
    const log = await theLog("org_456");

    expect(log).toHaveLength(1);
    // The record handed back is the one in the table, not a second attempt at it.
    expect(record?.record_id).toBe(log[0]?.record_id);
    expect(record?.record_hash).toBe(log[0]?.record_hash);
    expect(verifyChain(log, await theHead("org_456"))).toBe(true);
  });

  it("DSOR-EXE-02: the log and the answer agree, instead of contradicting each other", async () => {
    // The severity, through the real pipeline. Before the fix:
    //
    //     caller: EVIDENCE_STORE_UNAVAILABLE retry:safe_same_key
    //             "could not be written down, so it was not carried out"
    //     log:    1 record(s) [ALLOW/ALLOWED]
    //
    // The log said the request was allowed and the caller was told it never ran.
    useDatabase(withOneBrokenInsert("lose the reply"));

    const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });
    const log = await theLog("org_456");

    expect(answer.kind).not.toBe("error");
    expect(log).toHaveLength(1);
    expect(log[0]?.authorization).toBe("ALLOW");
    expect(log[0]?.result).toBe("ALLOWED");
  });

  it("DSOR-EXE-03b: a write the server refused still refuses, and writes nothing", async () => {
    // The other side of it, and the reason this cannot just assume success. `safe_same_key` is a
    // true statement here: the request never ran, so sending it again is safe.
    useDatabase(withOneBrokenInsert("fail the insert"));

    const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(answer.envelope.retry).toBe("safe_same_key");

    useDatabase(real);

    expect(await theLog("org_456")).toHaveLength(0);
  });

  it("DSOR-UNK-01b: a connection that fails before the server answers is unknown, not failed", async () => {
    // The window a review pointed at. The client sees "connection terminated" while the server may
    // still be executing the statement — a `pg` query_timeout, a partition. The follow-up SELECT
    // finds nothing *yet*, and the first version took that as proof and told the caller
    // `safe_same_key`. Then the row lands, and a retry writes a second one. "Not found" after a
    // connection error is a snapshot, not a proof; only a server's own SQLSTATE is a proof.
    let used = false;

    useDatabase({
      async query<T>(sql: string, params?: unknown[]) {
        if (!used && sql.includes("INSERT")) {
          used = true;

          // Never reaches the server; carries no SQLSTATE.
          throw Object.assign(new Error("Connection terminated unexpectedly"), {
            code: "ECONNRESET",
          });
        }

        return real.query<T>(sql, params);
      },
    });

    const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("OUTCOME_UNKNOWN");
    expect(answer.envelope.retry).toBe("after_reconciliation");
  });

  it("DSOR-EXE-03b: another writer's record at our position is not mistaken for ours", async () => {
    // This is why the check compares `record_hash` and not merely "is there a row". A writer that
    // beat us to this position makes the INSERT fail on the primary key, and a row *does* exist at
    // `audit:org_456:0` — someone else's. Treating that as success would throw away a decision and
    // tell the caller it was recorded.
    useDatabase(real);

    const theirs = await audit(aDecision("req_theirs"));

    expect(theirs?.record_id).toBe("audit:org_456:0");

    // Now a second writer that computes the same position. `forgetTheLog` is not used, so the next
    // write would normally take position 1 — this injects the collision directly by making the
    // tail read come back empty, which is what a writer that read the tail before `theirs`
    // committed would have seen.
    let firstTail = true;

    useDatabase({
      async query<T>(sql: string, params?: unknown[]) {
        if (firstTail && sql.includes("AS at_position") && sql.includes("ORDER BY sequence DESC")) {
          firstTail = false;

          return { rows: [] as T[] };
        }

        return real.query<T>(sql, params);
      },
    });

    await expect(audit(aDecision("req_ours"))).rejects.toThrow(/duplicate key|unique/i);

    // Their record is untouched and still the only one.
    const log = await theLog("org_456");

    expect(log).toHaveLength(1);
    expect(log[0]?.correlation.request_id).toBe("req_theirs");
    expect(verifyChain(log, await theHead("org_456"))).toBe(true);
  });
});

describe("an INSERT whose reply is lost on a connection that then stays dead", () => {
  /**
   * The realistic case, and the one the first fix did not cover. A lost reply usually means the
   * connection is gone — a restart, a failover — so the follow-up "did my record land?" fails on
   * the same connection. The first version let that error escape, and the caller was told
   * `EVIDENCE_STORE_UNAVAILABLE` with retry `safe_same_key` while the row sat in the table: the
   * exact pre-fix behaviour, on the exact case that happens in production. A hostile review
   * measured it.
   *
   * There is no honest success and no honest failure here. `DSOR-UNK-01b` names the only honest
   * answer: unknown, with a retry class that does not permit a fresh attempt, because the decision
   * may already be on record. That is `OUTCOME_UNKNOWN` / `after_reconciliation`.
   */
  function withADeadConnectionAfterTheInsert(): Database {
    let dead = false;

    return {
      async query<T>(sql: string, params?: unknown[]) {
        if (dead) {
          throw new Error("connection terminated unexpectedly");
        }

        const rows = await real.query<T>(sql, params);

        if (sql.includes("INSERT")) {
          dead = true;

          throw new Error("connection terminated unexpectedly");
        }

        return rows;
      },
    };
  }

  it("when the store cannot be asked, audit says it does not know", async () => {
    useDatabase(withADeadConnectionAfterTheInsert());

    await expect(audit(aDecision("req_1"))).rejects.toBeInstanceOf(OutcomeUnknown);
  });

  it("DSOR-UNK-01b: the caller gets OUTCOME_UNKNOWN, never a retry-safe error", async () => {
    useDatabase(withADeadConnectionAfterTheInsert());

    const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("OUTCOME_UNKNOWN");
    expect(answer.envelope.retry).toBe("after_reconciliation");

    // And the row really is there, which is why "retry safely" would have been a lie.
    useDatabase(real);

    expect(await theLog("org_456")).toHaveLength(1);
  });
});

describe("an INSERT refused because the row is already there", () => {
  it("DSOR-EXE-02: two writers at one position do not become one row, whatever their bytes", async () => {
    // Two writers for the same request, subject, operation, result and millisecond. They used to
    // hash identically, and the recovery then could not tell "my INSERT committed" from "someone
    // else wrote the same bytes": the second writer found "its" record present and was told it had
    // been recorded. One row, two receipts. Reachable without a fixed clock, because
    // `nextRequestId` is a per-process counter and two instances of this program both mint `req_1`.
    //
    // Two things close it now, and both are asserted. The position collision is PostgreSQL's
    // SQLSTATE 23505, taken as the answer it is before any hash is compared. And the two records are
    // no longer byte-identical at all: `correlation.trace_id` is a fresh UUID per attempt, inside the
    // hash, so equal hashes can only ever mean one attempt.
    setClock(() => "2026-10-04T00:00:00.000Z");

    let staleTailReads = 0;

    useDatabase({
      async query<T>(sql: string, params?: unknown[]) {
        // Both writers see an empty tail, so both compute position 0.
        if (
          sql.includes("AS at_position") &&
          sql.includes("ORDER BY sequence DESC") &&
          staleTailReads++ < 2
        ) {
          return { rows: [] as T[] };
        }

        return real.query<T>(sql, params);
      },
    });

    const first = await audit(aDecision("req_1"));

    expect(first?.record_id).toBe("audit:org_456:0");

    await expect(audit(aDecision("req_1"))).rejects.toMatchObject({ code: "23505" });

    const log = await theLog("org_456");

    expect(log).toHaveLength(1);
    expect(log[0]?.record_hash).toBe(first?.record_hash);
  });

  it("DSOR-EXE-02: two attempts at one decision never hash to the same bytes", async () => {
    setClock(() => "2026-10-04T00:00:00.000Z");
    useDatabase(real);

    const one = await audit(aDecision("req_1"));

    await forgetTheLog("org_456");

    const two = await audit(aDecision("req_1"));

    // Same position, same time, same everything a caller supplied — different record.
    expect(two?.record_id).toBe(one?.record_id);
    expect(two?.correlation.trace_id).not.toBe(one?.correlation.trace_id);
    expect(two?.record_hash).not.toBe(one?.record_hash);
  });

  it("DSOR-EXE-02: a writer that lost its connection does not take a receipt for another writer's row", async () => {
    // The interleaving a review measured as "two receipts, one row": my INSERT fails on the way to
    // the server; in the gap before my follow-up SELECT, a second writer with the same bytes commits
    // at my position; my SELECT finds a row at my record_id — and, before `trace_id`, with my hash.
    // Now the hashes differ, the row is recognised as someone else's, and I am told the write failed,
    // which is true: my statement can never commit into a position the primary key has given away.
    setClock(() => "2026-10-04T00:00:00.000Z");

    let interrupted = false;
    let theOtherWriter: Promise<unknown> | undefined;

    const wrapped: Database = {
      async query<T>(sql: string, params?: unknown[]) {
        if (!interrupted && sql.includes("INSERT")) {
          interrupted = true;
          // The other writer goes straight through to the real database while mine is "in flight".
          useDatabase(real);
          theOtherWriter = audit(aDecision("req_1"));
          await theOtherWriter;
          useDatabase(wrapped);

          throw Object.assign(new Error("Connection terminated unexpectedly"), {
            code: "ECONNRESET",
          });
        }

        return real.query<T>(sql, params);
      },
    };

    useDatabase(wrapped);

    await expect(audit(aDecision("req_1"))).rejects.toThrow(/Connection terminated/);

    useDatabase(real);

    const log = await theLog("org_456");

    expect(log).toHaveLength(1);
    expect(log[0]?.correlation.request_id).toBe("req_1");
    // Exactly one receipt was handed out, and it was the other writer's.
    const theirs = (await theOtherWriter) as { record_hash: string } | undefined;

    expect(theirs?.record_hash).toBe(log[0]?.record_hash);
  });

  it("DSOR-EXE-03b: another writer's row at my position is a failed write, not an unknown one", async () => {
    // The case that keeps the record_hash comparison killable. Decision 78 said narrowing it to
    // "is there a row" failed a test; once 23505 is short-circuited that test no longer reaches the
    // comparison. This one does: a connection error (no SQLSTATE) while a different writer's row
    // sits at my record_id. Not mine, but definitely not landing either — so EVIDENCE_STORE_UNAVAILABLE
    // is true, and OUTCOME_UNKNOWN would be an over-statement.
    useDatabase(real);

    const theirs = await audit(aDecision("req_theirs"));

    expect(theirs?.record_id).toBe("audit:org_456:0");

    let firstTail = true;
    let firstInsert = true;

    useDatabase({
      async query<T>(sql: string, params?: unknown[]) {
        if (firstTail && sql.includes("AS at_position") && sql.includes("ORDER BY sequence DESC")) {
          firstTail = false;

          return { rows: [] as T[] }; // so I also compute position 0
        }

        if (firstInsert && sql.includes("INSERT")) {
          firstInsert = false;

          throw Object.assign(new Error("Connection terminated unexpectedly"), {
            code: "ECONNRESET",
          });
        }

        return real.query<T>(sql, params);
      },
    });

    // One attempt, inspected two ways. The first version of this test called `audit` twice and the
    // second call honestly succeeded at position 1 — the wrapper only interferes once.
    const outcome: unknown = await audit(aDecision("req_mine")).then(
      () => "resolved",
      (failure: unknown) => failure,
    );

    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).not.toBeInstanceOf(OutcomeUnknown);
    expect((outcome as Error).message).toMatch(/Connection terminated/);

    useDatabase(real);

    const log = await theLog("org_456");

    expect(log).toHaveLength(1);
    expect(log[0]?.correlation.request_id).toBe("req_theirs");
  });
});

describe("the head, when the store does not answer", () => {
  it("DSOR-AUD-04b: a head query that returns no row is an error, not an empty log", async () => {
    // `{ count: 0, lastHash: GENESIS }` is the head of an empty log, and `verifyChain([], thatHead)`
    // is true. So a store that answered nothing used to make "no records" verify as the complete
    // history. Unreachable from a working PostgreSQL — an aggregate always returns one row — and a
    // branch no test can reach must at least fail closed.
    useDatabase({ query: async <T>() => ({ rows: [] as T[] }) });

    await expect(theHead("org_456")).rejects.toThrow(/did not answer the head query/);
  });
});
