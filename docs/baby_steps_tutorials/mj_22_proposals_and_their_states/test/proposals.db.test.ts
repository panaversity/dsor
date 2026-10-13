// NEW IN STEP 22: proposals on the database. The trigger is the database's own guard of the
// picture in §26.2 (DSOR-APR-01a, DSOR-APR-01c), each move and its record commit together
// (DSOR-APR-01b, DSOR-AUD-01), and a move is one statement, so two movers never both win
// (DSOR-IDM-04). A real PostgreSQL, never a mock (step 22's README, decisions 3, 4, 6, and 9).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { payloadHash } from "../src/canonical.ts";
import { Refusal } from "../src/envelope.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals } from "../src/postgres.ts";
import { canMove, STATES, type MoveBy, type ProposalDraft, type State } from "../src/proposals.ts";
import {
  dbRegistry,
  newPool,
  NO_PRIVILEGE,
  ownerClaims,
  ownerInvoices,
  ownerProposals,
  ownerProposalStore,
  requestId,
  RUNTIME_URL,
  tryThenRollBack,
} from "./db.ts";
import { keyed, storyDirectories, SUPERVISOR } from "./helpers.ts";

// The test's own window into the database: a pool the code under test never uses.
const observer = newPool();
const pool = newPool();
const log = createDbLog(pool);
const registry = dbRegistry(pool);
const proposals = createDbProposals(pool);

// The tests' own invoice, INV-9001, which the owner adds, so the story's invoices stay as they
// are (step 21's README, decision 12).
const INV_9001 = { invoice: "dsor://org_456/invoice/INV-9001", expected_version: 1 };
beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  ownerInvoices("remove");
  await observer.end();
  await pool.end();
});

// A proposal the store tests write by hand: user_123's own draft of a payment for INV-9001.
const DRAFT: ProposalDraft = {
  operation: "payment.create@1",
  payload: INV_9001,
  payload_hash: `sha256:${"b".repeat(64)}`,
  resources: [INV_9001.invoice],
  requester: {
    identity_mode: "direct",
    subject: "user_123",
    subject_type: "human",
    actor_chain: [],
    active_tenant: "org_456",
    subject_authority: { source: "token", as_of: "2026-10-07T02:05:00.000Z" },
  },
  idempotency_key: "k-s22-store",
};
const AUTHORITY = DRAFT.requester.subject_authority;
const BY_USER: MoveBy = {
  mover: { mode: "direct", subject: "user_123", actor_chain: [], subject_authority: AUTHORITY },
  cause: "payment.create called",
  correlation: { request_id: "req_s22_store", principal_id: "user_123" },
};
const BY_DSOR: MoveBy = {
  mover: { mode: "direct", subject: "dsor", actor_chain: [], subject_authority: AUTHORITY },
  cause: "a test moves it",
  correlation: { request_id: "req_s22_store", principal_id: "user_123" },
};

/** A new proposal of org_456, written through the store, moved along these states. */
async function proposalAt(...path: State[]): Promise<string> {
  const id = `prop_${randomUUID()}`;
  await proposals.create("org_456", id, DRAFT, BY_USER);
  let at: State = "PROPOSED";
  for (const next of path) {
    expect(await proposals.move("org_456", id, at, next, BY_DSOR)).toBe(true);
    at = next;
  }
  return id;
}

/** Runs the work as dsor_runtime inside org_456, in one transaction that is always rolled back. */
async function rolledBack<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await observer.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
    return await work(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

// A proposal written by hand, as dsor_runtime, with no store and no check of DSoR's in the way.
const RAW = `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload, payload_hash,
                                         resources, requester, idempotency_key)
             VALUES ('org_456', $1, 'payment.create@1', 'execute', $2, '{}',
                     'sha256:' || repeat('c', 64), ARRAY[]::text[], '{}', 'k-s22-raw')`;

/**
 * The error code PostgreSQL gave the statement, or "none". Inside a savepoint that is always
 * rolled back, so an allowed move is undone too, and the next try starts where this one did.
 */
async function codeOf(client: pg.PoolClient, sql: string, values: unknown[]): Promise<string> {
  await client.query("SAVEPOINT try");
  try {
    await client.query(sql, values);
    return "none";
  } catch (error) {
    return String((error as { code?: unknown }).code);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT try");
  }
}

// One way to each state the picture can reach from PROPOSED, the shortest, found from src's
// table. COMPENSATING and the two after it have no way in: COMMITTED and FAILED are final.
function pathTo(target: State): State[] | undefined {
  const paths = new Map<State, State[]>([["PROPOSED", []]]);
  const todo: State[] = ["PROPOSED"];
  while (todo.length > 0) {
    const at = todo.shift()!;
    for (const next of STATES) {
      if (canMove(at, next) && !paths.has(next)) {
        paths.set(next, [...paths.get(at)!, next]);
        todo.push(next);
      }
    }
  }
  return paths.get(target);
}

describe("the database's guard of the picture", () => {
  it("DSOR-APR-01a: the database allows exactly the moves src/proposals.ts allows, from every state there is a way to", async () => {
    const seen: [State, State, boolean][] = [];
    const expected: [State, State, boolean][] = [];
    for (const from of STATES) {
      const path = pathTo(from);
      if (path === undefined) continue;
      await rolledBack(async (client) => {
        const id = `prop_${randomUUID()}`;
        await client.query(RAW, [id, "PROPOSED"]);
        for (const step of path) {
          await client.query("UPDATE dsor.proposals SET state = $2 WHERE id = $1", [id, step]);
        }
        for (const to of STATES) {
          const code = await codeOf(client, "UPDATE dsor.proposals SET state = $2 WHERE id = $1", [
            id,
            to,
          ]);
          // A refused move is the trigger's check_violation, never another error.
          expect(["none", "23514"]).toContain(code);
          seen.push([from, to, code === "none"]);
          expected.push([from, to, canMove(from, to)]);
        }
      }).catch((error: unknown) => {
        throw new Error(`from ${from}: ${String(error)}`);
      });
    }
    // Fourteen states have a way in: 14 × 17 tries.
    expect(seen).toHaveLength(14 * STATES.length);
    expect(seen).toStrictEqual(expected);
  });

  it("DSOR-APR-01c: a COMMITTED proposal refuses every other state, on the database: the step's done when", async () => {
    const codes = await rolledBack(async (client) => {
      const id = `prop_${randomUUID()}`;
      await client.query(RAW, [id, "PROPOSED"]);
      for (const step of ["READY", "EXECUTING", "COMMITTED"]) {
        await client.query("UPDATE dsor.proposals SET state = $2 WHERE id = $1", [id, step]);
      }
      const tried: string[] = [];
      for (const to of STATES) {
        tried.push(
          await codeOf(client, "UPDATE dsor.proposals SET state = $2 WHERE id = $1", [id, to]),
        );
      }
      const { rows } = await client.query("SELECT state FROM dsor.proposals WHERE id = $1", [id]);
      return { tried, state: rows[0]?.state };
    });
    expect(codes.tried).toStrictEqual(STATES.map(() => "23514"));
    expect(codes.state).toBe("COMMITTED");
  });

  // Titled by the decision: the picture's last line is not built (open question 89).
  it("Step 22: FAILED is final too, and nothing moves it to COMPENSATING (step 22's README, decision 1)", async () => {
    const code = await rolledBack(async (client) => {
      const id = `prop_${randomUUID()}`;
      await client.query(RAW, [id, "PROPOSED"]);
      for (const step of ["READY", "EXECUTING", "FAILED"]) {
        await client.query("UPDATE dsor.proposals SET state = $2 WHERE id = $1", [id, step]);
      }
      return codeOf(client, "UPDATE dsor.proposals SET state = 'COMPENSATING' WHERE id = $1", [id]);
    });
    expect(code).toBe("23514");
  });

  it("DSOR-APR-01a: a new proposal starts as PROPOSED, on the database", async () => {
    const codes = await rolledBack(async (client) => {
      const tried: [State, string][] = [];
      for (const state of STATES) {
        tried.push([state, await codeOf(client, RAW, [`prop_${randomUUID()}`, state])]);
      }
      return tried;
    });
    expect(codes).toStrictEqual(
      STATES.map((state) => [state, state === "PROPOSED" ? "none" : "23514"]),
    );
  });

  it("Step 22: dsor_runtime may change a proposal's state only, never its request, and may remove none", async () => {
    const id = await proposalAt();
    for (const sql of [
      `UPDATE dsor.proposals SET payload = '{}' WHERE id = '${id}'`,
      `UPDATE dsor.proposals SET requester = '{}' WHERE id = '${id}'`,
      `UPDATE dsor.proposals SET idempotency_key = 'k-other' WHERE id = '${id}'`,
      `DELETE FROM dsor.proposals WHERE id = '${id}'`,
      "TRUNCATE dsor.proposals",
    ]) {
      await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
    }
  });

  it("Step 22: the owner, whom no grant stops, cannot change a proposal's request or skip a move either", () => {
    // Each column the owner might want to change. Found by the review: only the payload was tried.
    for (const column of ["payload", "requester", "created_at"]) {
      expect([column, ownerProposals("rewrite", column)]).toStrictEqual([
        column,
        { code: "23514", message: "only the state of a proposal changes" },
      ]);
    }
    expect(ownerProposals("skip")).toMatchObject({
      code: "23514",
      message: "no move from PROPOSED to COMMITTED in the picture of section 26.2",
    });
  });
});

describe("from the review, the guard", () => {
  // The three states nothing reaches yet, made by the owner with the trigger off for one moment.
  // Found by the review: the table's moves out of them were never tried on the database.
  it("DSOR-APR-01a: the database allows exactly src's moves out of the three states nothing reaches yet", () => {
    const lines = ownerProposals("unreachable") as string[];
    const expected = (["COMPENSATING", "COMPENSATED", "COMPENSATION_FAILED"] as State[]).flatMap(
      (from) => STATES.map((to) => `${from} ${to} ${canMove(from, to) ? "none" : "23514"}`),
    );
    expect(lines).toStrictEqual(expected);
  });

  // Migration 015's guard of an upgrade (step 22's README, decision 15). Found by the review: a
  // claim answered before proposals would replay as INTERNAL_ERROR forever.
  it("Step 22: migration 015 runs only where no claim holds an answer yet", () => {
    expect(ownerProposals("guard")).toStrictEqual({
      empty: { code: "none" },
      answered: {
        code: "55000",
        message:
          "dsor.idempotency holds answers recorded before proposals existed, whose replays could name no proposal: migrate a database of its own",
      },
    });
  });

  // No look-alike of an operator earlier on the path can change the trigger's answer. Found by
  // the review: the pin could go, and every test stayed green.
  it("Step 22: the trigger's function runs with its search_path pinned", async () => {
    const { rows } = await tryThenRollBack(
      observer,
      "SELECT proconfig FROM pg_proc WHERE oid = 'dsor.proposal_moves'::regproc",
    );
    expect(rows).toStrictEqual([{ proconfig: ["search_path=pg_catalog, pg_temp"] }]);
  });
});

describe("the store of proposals, on the database", () => {
  it("DSOR-APR-01b: a proposal made with no cause, or no actor, is refused on the database, and leaves nothing", async () => {
    const id = `prop_${randomUUID()}`;
    await expect(proposals.create("org_456", id, DRAFT, { ...BY_USER, cause: "" })).rejects.toThrow(
      "a move needs a cause",
    );
    const nobody = { ...BY_USER, mover: { ...BY_USER.mover, subject: " " } };
    await expect(proposals.create("org_456", id, DRAFT, nobody)).rejects.toThrow(
      "a move needs an actor",
    );
    expect(await proposals.get("org_456", id)).toBeUndefined();
  });

  it("DSOR-APR-01b: each move is one record in dsor.audit, with its actor, its cause, and the move it made", async () => {
    const id = await proposalAt("READY", "EXECUTING");
    const uri = `dsor://org_456/proposal/${id}`;
    const sql = `SELECT kind, operation, result, reason, identity, resources, extensions, "authorization"
                   FROM dsor.audit WHERE kind = 'proposal_transition' AND resources = ARRAY[$1]::text[]
                  ORDER BY sequence`;
    const { rows } = await tryThenRollBack(observer, sql, "org_456", [uri]);
    expect(
      rows.map(({ result, reason, extensions }) => [result, reason, extensions]),
    ).toStrictEqual([
      ["PROPOSED", "payment.create called", null],
      ["READY", "a test moves it", { "org.panaversity.steps": { from: "PROPOSED" } }],
      ["EXECUTING", "a test moves it", { "org.panaversity.steps": { from: "READY" } }],
    ]);
    for (const row of rows) {
      // A move allows and denies nothing.
      expect(row["authorization"]).toBeNull();
      expect(row["operation"]).toBe("payment.create@1");
    }
    expect(rows.map((row) => row["identity"].subject)).toStrictEqual(["user_123", "dsor", "dsor"]);
  });

  it("DSOR-APR-01b: a move whose record cannot be written does not happen", async () => {
    const id = await proposalAt("READY");
    // A pool whose next record of a move fails, as a full disk or a broken log would.
    const odd = newPool();
    odd.on("connect", (client) => {
      const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
      client.query = ((...a: unknown[]) => {
        if (typeof a[0] === "string" && a[0].includes("INSERT INTO dsor.audit")) {
          return Promise.reject(new Error("the log is broken"));
        }
        return query(...a);
      }) as typeof client.query;
    });
    try {
      await expect(
        createDbProposals(odd).move("org_456", id, "READY", "EXECUTING", BY_DSOR),
      ).rejects.toThrow("the log is broken");
    } finally {
      await odd.end();
    }
    const proposal = await proposals.get("org_456", id);
    expect(proposal?.state).toBe("READY");
    expect(proposal?.transitions.map((t) => t.to)).toStrictEqual(["PROPOSED", "READY"]);
  });

  it("DSOR-IDM-04: two moves of one proposal to EXECUTING at the same moment: one wins, with one record", async () => {
    const id = await proposalAt("READY");
    // The first mover's UPDATE holds the row. Before it writes its record, the second mover
    // starts, and the test waits until PostgreSQL shows the second waiting for that row. Two
    // real connections, not one at a time.
    const second = newPool();
    let secondMove: Promise<boolean> | undefined;
    const first = newPool();
    first.on("connect", (client) => {
      const query = client.query.bind(client) as (...a: unknown[]) => Promise<unknown>;
      let held = false;
      client.query = ((...a: unknown[]) => {
        if (!held && typeof a[0] === "string" && a[0].includes("INSERT INTO dsor.audit")) {
          held = true;
          secondMove = createDbProposals(second).move("org_456", id, "READY", "EXECUTING", BY_DSOR);
          return waitForALockWaiter().then(() => query(...a));
        }
        return query(...a);
      }) as typeof client.query;
    });
    try {
      expect(
        await createDbProposals(first).move("org_456", id, "READY", "EXECUTING", BY_DSOR),
      ).toBe(true);
      expect(await secondMove).toBe(false);
    } finally {
      await first.end();
      await second.end();
    }
    const proposal = await proposals.get("org_456", id);
    expect(proposal?.state).toBe("EXECUTING");
    expect(proposal?.transitions.filter((t) => t.to === "EXECUTING")).toHaveLength(1);
  });

  // DSoR's own WHERE alone, with no policy behind it: the store run by the owner, who holds
  // BYPASSRLS. Found by the sweep: with tenant_id dropped from the move's SQL, every test stayed
  // green, because the database's lock hid it (step 11's README, "What the specification asks").
  it("DSOR-TEN-01b: DSoR's own lock alone keeps a proposal in its company: the owner's store neither reads nor moves it from org_789", () => {
    expect(ownerProposalStore()).toStrictEqual({
      bypassrls: true,
      // Its history, without the forged record of org_789 that names it.
      history: ["PROPOSED"],
      crossGet: null,
      crossMove: false,
      stateAfter: "PROPOSED",
    });
  });

  it("DSOR-TEN-01b: org_456's proposal is invisible, and does not move, inside org_789", async () => {
    const id = await proposalAt();
    expect(await proposals.get("org_789", id)).toBeUndefined();
    expect(await proposals.move("org_789", id, "PROPOSED", "READY", BY_DSOR)).toBe(false);
    const { rows } = await tryThenRollBack(
      observer,
      "SELECT id FROM dsor.proposals WHERE id = $1",
      "org_789",
      [id],
    );
    expect(rows).toStrictEqual([]);
    expect((await proposals.get("org_456", id))?.state).toBe("PROPOSED");
  });
});

describe("a command's proposal, on the database", () => {
  // The order of lines ⑦, ⑧, and ⑨ through the database's claim, where the proposal opens before
  // the savepoint of the code's work. Found by the review: only memory's order was tested.
  it("DSOR-EXE-01a: on the database too, a command runs lines 1, 2, 3, 5, 6, 7, 8, 9, and 11", async () => {
    const lines: number[] = [];
    await call(registry, log, keyed(SUPERVISOR), "payment.create", INV_9001, (n) => lines.push(n));
    expect(lines).toStrictEqual([1, 2, 3, 5, 6, 7, 8, 9, 11]);
  });

  it("DSOR-APR-01a: user_123's draft of INV-9001 leaves a COMMITTED proposal, with four records in the log", async () => {
    const request_id = requestId("s22-draft");
    const answer = await call(
      registry,
      log,
      keyed({ ...SUPERVISOR, request_id }),
      "payment.create",
      INV_9001,
    );
    expect(answer).toMatchObject({ outcome: "COMMITTED", data: { status: "draft" } });
    const uri = "proposal" in answer ? String(answer.proposal) : "";
    const proposal = await proposals.get("org_456", uri.slice("dsor://org_456/proposal/".length));
    expect(proposal?.state).toBe("COMMITTED");
    expect(proposal?.transitions.map(({ from, to, actor }) => [from, to, actor])).toStrictEqual([
      [undefined, "PROPOSED", "user_123"],
      ["PROPOSED", "READY", "dsor"],
      ["READY", "EXECUTING", "dsor"],
      ["EXECUTING", "COMMITTED", "dsor"],
    ]);
    // The decision and the four moves, all with the call's request id.
    const sql = `SELECT kind FROM dsor.audit WHERE correlation->>'request_id' = $1 ORDER BY sequence`;
    const { rows } = await tryThenRollBack(observer, sql, "org_456", [request_id]);
    expect(rows.map((row) => row["kind"])).toStrictEqual([
      "proposal_transition",
      "proposal_transition",
      "proposal_transition",
      "proposal_transition",
      "decision",
    ]);
  });

  it("DSOR-APR-01a: a refusal from the code ends FAILED on the database, and keeps its records, though the code's work rolled back", async () => {
    const answer = await call(registry, log, keyed(SUPERVISOR), "payment.create", {
      ...INV_9001,
      expected_version: 2,
    });
    expect(answer).toMatchObject({ code: "STALE_STATE" });
    const uri = "proposal" in answer ? String(answer.proposal) : "";
    const proposal = await proposals.get("org_456", uri.slice("dsor://org_456/proposal/".length));
    expect(proposal?.state).toBe("FAILED");
    expect(proposal?.transitions.map((t) => t.to)).toStrictEqual([
      "PROPOSED",
      "READY",
      "EXECUTING",
      "FAILED",
    ]);
    expect(proposal?.transitions.at(-1)?.cause).toBe("the code refused: STALE_STATE");
  });

  it("DSOR-IDM-04: a replay on the database names the same proposal, and the database holds one", async () => {
    const envelope = keyed(SUPERVISOR);
    const first = await call(registry, log, envelope, "payment.create", INV_9001);
    const again = await call(registry, log, envelope, "payment.create", INV_9001);
    expect("proposal" in again && again.proposal).toBe("proposal" in first && first.proposal);
    const { rows } = await tryThenRollBack(
      observer,
      "SELECT count(*)::int AS n FROM dsor.proposals WHERE idempotency_key = $1",
      "org_456",
      [envelope.idempotency_key],
    );
    expect(rows).toStrictEqual([{ n: 1 }]);
  });

  it("Step 22: an accident inside the claim rolls back the proposal with the claim and the work", async () => {
    // Code that drafts the payment, then breaks: an accident, not a refusal.
    const shipped = handlersFor();
    const broken = dbRegistry(pool, storyDirectories(), {
      ...shipped,
      "payment.create": async (input, company) => {
        await shipped["payment.create"]!(input, company);
        throw new TypeError("the code broke after it wrote");
      },
    });
    const envelope = keyed(SUPERVISOR);
    const answer = await call(broken, log, envelope, "payment.create", INV_9001);
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect("proposal" in answer).toBe(false);
    const { rows } = await tryThenRollBack(
      observer,
      "SELECT count(*)::int AS n FROM dsor.proposals WHERE idempotency_key = $1",
      "org_456",
      [envelope.idempotency_key],
    );
    expect(rows).toStrictEqual([{ n: 0 }]);
  });

  it("Step 22: a refusal of the code's own still names its proposal, which ended FAILED", async () => {
    // Code that refuses after it wrote: the write is undone, the proposal is kept.
    const shipped = handlersFor();
    const refusing = dbRegistry(pool, storyDirectories(), {
      ...shipped,
      "payment.create": async (input, company) => {
        await shipped["payment.create"]!(input, company);
        throw new Refusal("CONFLICT", "refused after the write, on purpose", "public");
      },
    });
    const answer = await call(refusing, log, keyed(SUPERVISOR), "payment.create", INV_9001);
    expect(answer).toMatchObject({
      code: "CONFLICT",
      proposal: expect.stringMatching(/^dsor:\/\/org_456\/proposal\//),
    });
    const uri = "proposal" in answer ? String(answer.proposal) : "";
    expect(
      (await proposals.get("org_456", uri.slice("dsor://org_456/proposal/".length)))?.state,
    ).toBe("FAILED");
  });

  it("DSOR-APR-01a: the proposal the database keeps passes proposal.schema.json", async () => {
    const answer = await call(registry, log, keyed(SUPERVISOR), "payment.create", INV_9001);
    const uri = "proposal" in answer ? String(answer.proposal) : "";
    const proposal = await proposals.get("org_456", uri.slice("dsor://org_456/proposal/".length));
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    for (const file of ["common", "security-context"]) {
      const url = new URL(`../schemas/${file}.schema.json`, import.meta.url);
      ajv.addSchema(JSON.parse(readFileSync(url, "utf8")) as object);
    }
    const url = new URL("../schemas/proposal.schema.json", import.meta.url);
    const passes = ajv.compile(JSON.parse(readFileSync(url, "utf8")) as object);
    expect([passes(proposal), passes.errors]).toStrictEqual([true, null]);
  });
});

describe("from the sweep, on the database", () => {
  // A kept refusal with no proposal: the replay would name none, so it fails closed. Found by
  // the review: with the checklist's own check gone, the refusal passed through.
  it("Step 22: a replay of a kept refusal with no proposal fails with INTERNAL_ERROR", async () => {
    const key = keyed(SUPERVISOR).idempotency_key;
    expect(ownerClaims("plant", key, payloadHash(INV_9001), "none", "refused")).toStrictEqual({
      planted: 1,
    });
    const answer = await call(
      registry,
      log,
      { ...SUPERVISOR, idempotency_key: key },
      "payment.create",
      INV_9001,
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  // A claim whose kept proposal is not a proposal of its company: a replay fails with
  // INTERNAL_ERROR, and names nothing. Found by the sweep: with the replay's check gone, every
  // test stayed green, because no test planted a broken claim.
  it.each([
    ["no proposal at all, beside a value", "none"],
    ["a number", "7"],
    ["another company's proposal", JSON.stringify(`dsor://org_789/proposal/prop_${randomUUID()}`)],
    ["text that is no proposal", JSON.stringify("dsor://org_456/payment/PAY-901")],
  ])(
    "Step 22: a replay of a claim that keeps %s as its proposal fails with INTERNAL_ERROR",
    async (_what, proposal) => {
      const key = keyed(SUPERVISOR).idempotency_key;
      expect(ownerClaims("plant", key, payloadHash(INV_9001), proposal)).toStrictEqual({
        planted: 1,
      });
      const answer = await call(
        registry,
        log,
        { ...SUPERVISOR, idempotency_key: key },
        "payment.create",
        INV_9001,
      );
      expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
      expect("proposal" in answer).toBe(false);
    },
  );
});

// Waits until PostgreSQL shows a session of dsor_runtime waiting for a row lock on an UPDATE of
// a proposal, for at most ten seconds.
async function waitForALockWaiter(): Promise<void> {
  const watcher = newPool(RUNTIME_URL);
  try {
    for (let tries = 0; tries < 200; tries++) {
      const { rows } = await watcher.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE dsor.proposals%'`,
      );
      if ((rows[0] as { n: number }).n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("the second move never waited for the row");
  } finally {
    await watcher.end();
  }
}
