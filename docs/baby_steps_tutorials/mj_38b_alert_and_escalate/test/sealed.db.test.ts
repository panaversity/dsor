// Step 36b on the database: a command's decision record commits in the transaction that keeps its
// work and its outcome, or neither does. A process killed at that COMMIT leaves nothing; a
// database that refuses the record keeps no draft, no claim, and no proposal (DSOR-EXE-04a,
// DSOR-EXE-03b; step 36b's README, claims C1 to C4). The tests' own invoice, INV-9001, 500.00 USD
// of VENDOR-44, which the owner adds and removes.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbIntents, createDbLog, inCompany } from "../src/postgres.ts";
import {
  dbRegistry,
  newPool,
  ownerAttempts,
  ownerInvoices,
  ownerProposals,
  ownerRecords,
  ownerRowsFor,
  requestId,
} from "./db.ts";
import { AGENT, keyed, SUPERVISOR } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const bank = createFakeBank();
const none = undefined;
const registry = dbRegistry(
  pool,
  none,
  none,
  none,
  none,
  none,
  none,
  none,
  new Map([["fake-bank", { bank, waitMs: 50 }]]),
);
const intents = createDbIntents(pool);
const INV_9001 = "dsor://org_456/invoice/INV-9001";
const CRASH = fileURLToPath(new URL("crash-at-the-record.ts", import.meta.url));
const settle: string[] = [];

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  ownerRecords("mend");
  for (const id of settle) ownerProposals("settle", id);
  ownerAttempts();
  ownerInvoices("remove");
  await pool.end();
});

/** The proposals org_456 keeps under this key, with their states. */
function madeWith(key: string): Promise<unknown[]> {
  return inCompany(pool, "org_456", async (client) => {
    const { rows } = await client.query(
      "SELECT id, state FROM dsor.proposals WHERE idempotency_key = $1",
      [key],
    );
    return rows;
  });
}

/** How many payments of INV-9001 org_456 keeps. */
function draftsOf9001(): Promise<unknown> {
  return inCompany(pool, "org_456", async (client) => {
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM app.payments WHERE invoice_id = 'INV-9001'",
    );
    return rows[0]?.["n"];
  });
}

/** user_123 drafts a payment of INV-9001 with this envelope. */
function draft(who: { idempotency_key: string }): Promise<Answer> {
  return call(registry, log, { ...SUPERVISOR, ...who }, "payment.create", {
    invoice: INV_9001,
    expected_version: 1,
  });
}

/** Whatever the test did to dsor.audit is taken away again, however the call went. */
async function whileRefusing(
  operation: string,
  run: () => Promise<Answer>,
  how: "refuse" | "refuse-at-commit" = "refuse",
): Promise<Answer> {
  ownerRecords(how, operation);
  try {
    return await run();
  } finally {
    ownerRecords("mend");
  }
}

describe("C1: a process killed at the COMMIT that keeps the record leaves nothing", () => {
  it(
    "DSOR-EXE-04a: killed with SIGKILL after the record was written and before it committed: no draft, no proposal, no claim, and no record; the same key then drafts it once, with its record",
    { timeout: 120_000 },
    async () => {
      ownerInvoices("add");
      const before = await draftsOf9001();
      const { idempotency_key: key } = keyed(SUPERVISOR);
      const request = requestId("c1-crash");
      const child = spawnSync(process.execPath, [CRASH, key, request], {
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(child.signal).toBe("SIGKILL");
      expect(child.stdout).toBe("KILLED AT COMMIT\n");
      expect(await madeWith(key)).toStrictEqual([]);
      expect(await draftsOf9001()).toBe(before);
      expect(ownerRowsFor(request)).toStrictEqual([]);
      const again = await draft({ idempotency_key: key });
      expect(again).toMatchObject({ outcome: "COMMITTED" });
      expect(await madeWith(key)).toMatchObject([{ state: "COMMITTED" }]);
      expect(await draftsOf9001()).toBe((before as number) + 1);
      // Among the rows of its proposal's moves, which share its request id, its decision record.
      expect(ownerRowsFor(again.correlation.request_id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ authorization: "ALLOW", result: "ok" })]),
      );
    },
  );
});

describe("C2: a database that refuses the record keeps nothing of the work", () => {
  it("DSOR-EXE-03b: the record of user_123's draft is refused: EVIDENCE_STORE_UNAVAILABLE, no draft, no proposal, no claim; the same key then drafts it once", async () => {
    ownerInvoices("add");
    const before = await draftsOf9001();
    const envelope = keyed(SUPERVISOR);
    const refused = await whileRefusing("payment.create@1", () => draft(envelope));
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE", retry: "safe_same_key" });
    expect(await madeWith(envelope.idempotency_key)).toStrictEqual([]);
    expect(await draftsOf9001()).toBe(before);
    expect(await draft(envelope)).toMatchObject({ outcome: "COMMITTED" });
    expect(await draftsOf9001()).toBe((before as number) + 1);
  });

  it("DSOR-EXE-04a: the record of the agent's INV-1008, which waits for the CFO, is refused: no waiting proposal is kept", async () => {
    ownerAttempts();
    const envelope = keyed(AGENT);
    const refused = await whileRefusing("payment.create@1", () =>
      call(registry, log, envelope, "payment.create", {
        invoice: "dsor://org_456/invoice/INV-1008",
        expected_version: 1,
      }),
    );
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect(await madeWith(envelope.idempotency_key)).toStrictEqual([]);
  });
});

describe("C3: after the bank was asked, a refused record cannot undo the money", () => {
  // Changed in step 38b: the claim then ends its own note, as the start-up sweep would, so the
  //   proposal is OUTCOME_UNKNOWN and its alert is raised while the program runs (found by step
  //   38b's review, H1; step 38b's README, decision D8).
  it("DSOR-UNK-04b: the record of a send is refused, once: OUTCOME_UNKNOWN, the bank sent once, the proposal OUTCOME_UNKNOWN with its note ended and its alert open, and the record that follows says OUTCOME_UNKNOWN", async () => {
    ownerInvoices("add");
    const drafted = await draft(keyed(SUPERVISOR));
    const id = (drafted as { data: { id: string } }).data.id;
    const request = requestId("c3-send");
    const unknown = await whileRefusing("payment.execute@1", () =>
      call(registry, log, { ...keyed(SUPERVISOR), request_id: request }, "payment.execute", {
        invoice: INV_9001,
        payment: `dsor://org_456/payment/${id}`,
        expected_version: 1,
      }),
    );
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN", retry: "after_reconciliation" });
    expect(bank.transfers().filter((t) => t.payment === id)).toHaveLength(1);
    const proposal = String("proposal" in unknown ? unknown.proposal : "")
      .split("/")
      .at(-1)!;
    expect(await intents.get("org_456", proposal)).toMatchObject({ outcome: "outcome_unknown" });
    expect((await registry.claims.proposals.get("org_456", proposal))?.state).toBe(
      "OUTCOME_UNKNOWN",
    );
    const alerts = await registry.claims.proposals.alerts("org_456");
    expect(alerts.filter((alert) => alert.proposal === proposal)).toMatchObject([
      { state: "open" },
    ]);
    expect(ownerRowsFor(request)).toEqual(
      expect.arrayContaining([expect.objectContaining({ result: "OUTCOME_UNKNOWN" })]),
    );
    settle.push(proposal);
  });
});

// Step 36b's review: each finding, with its test (step 36b's README, "What the review found").
describe("the review, on the database", () => {
  it("DSOR-EXE-04a: F2: the record is written and the claim's COMMIT fails: nothing is kept, and the record that follows names no proposal, no draft, and no execution", async () => {
    ownerInvoices("add");
    const before = await draftsOf9001();
    const envelope = keyed(SUPERVISOR);
    const request = requestId("f2-commit");
    const failed = await whileRefusing(
      "payment.create@1",
      () =>
        call(registry, log, { ...envelope, request_id: request }, "payment.create", {
          invoice: INV_9001,
          expected_version: 1,
        }),
      "refuse-at-commit",
    );
    expect(failed).not.toHaveProperty("outcome");
    expect(failed).not.toHaveProperty("proposal");
    expect(await madeWith(envelope.idempotency_key)).toStrictEqual([]);
    expect(await draftsOf9001()).toBe(before);
    const record = (await log.records("org_456")).find(
      (r) => r.correlation.request_id === request && r.kind === "decision",
    );
    expect(record).toBeDefined();
    expect(JSON.stringify(record)).not.toContain("dsor://org_456/proposal/");
    expect(JSON.stringify(record)).not.toContain("dsor://org_456/payment/");
    const bundle = (await log.bundles("org_456")).find(
      (b) => b.decision_id === record?.decision_bundle,
    );
    expect(bundle?.execution.result).not.toBe("committed");
  });

  it("DSOR-EXE-04a: N1: the record of a call DENIED at line ⑨, a stale version, is refused: no DENIED proposal is kept", async () => {
    ownerInvoices("add");
    const envelope = keyed(SUPERVISOR);
    const refused = await whileRefusing("payment.create@1", () =>
      call(registry, log, envelope, "payment.create", { invoice: INV_9001, expected_version: 2 }),
    );
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect(await madeWith(envelope.idempotency_key)).toStrictEqual([]);
  });

  it("DSOR-EXE-04a: N1: the record of a payment prepared in propose_only mode is refused: no READY proposal is kept", async () => {
    ownerInvoices("add");
    const envelope = { ...keyed(SUPERVISOR), mode: "propose_only" as const };
    const refused = await whileRefusing("payment.create@1", () =>
      call(registry, log, envelope, "payment.create", { invoice: INV_9001, expected_version: 1 }),
    );
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect(await madeWith(envelope.idempotency_key)).toStrictEqual([]);
  });
});
