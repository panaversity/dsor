// NEW IN STEP 09: a lost reply is not a failed write.
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
  await real.close();
});

function aDecision(id: string): DecisionToRecord {
  return {
    kind: "decision",
    subject: "user_123",
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

        throw new Error("connection terminated unexpectedly");
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
    const log = await theLog();

    expect(log).toHaveLength(1);
    // The record handed back is the one in the table, not a second attempt at it.
    expect(record?.record_id).toBe(log[0]?.record_id);
    expect(record?.record_hash).toBe(log[0]?.record_hash);
    expect(verifyChain(log, await theHead())).toBe(true);
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
    const log = await theLog();

    expect(answer.kind).not.toBe("error");
    expect(log).toHaveLength(1);
    expect(log[0]?.authorization).toBe("ALLOW");
    expect(log[0]?.result).toBe("ALLOWED");
  });

  it("DSOR-EXE-03b: a write that genuinely failed still refuses, and writes nothing", async () => {
    // The other side of it, and the reason this cannot just assume success. `safe_same_key` is a
    // true statement here: the request never ran, so sending it again is safe.
    useDatabase(withOneBrokenInsert("fail the insert"));

    const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(answer.envelope.retry).toBe("safe_same_key");
    expect(await theLog()).toHaveLength(0);
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
    const log = await theLog();

    expect(log).toHaveLength(1);
    expect(log[0]?.correlation.request_id).toBe("req_theirs");
    expect(verifyChain(log, await theHead())).toBe(true);
  });
});
