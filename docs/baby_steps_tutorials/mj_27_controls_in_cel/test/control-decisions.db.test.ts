// Step 27's controls, on the database (step 27's README, claims C4, C5, C6, and C7). A payment that
// needs the CFO leaves rows of DSoR's own store: a claim that keeps its waiting answer, a
// PENDING_APPROVAL proposal, its booking, and a record that names the control. A real PostgreSQL,
// never a mock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readControls, type ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals, createDbReservations } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  dbRegistry,
  newPool,
  NO_PRIVILEGE,
  ownerInvoices,
  ownerLimits,
  requestId,
  tryThenRollBack,
} from "./db.ts";
import { AGENT, keyed, storyDirectories, withPlanted } from "./helpers.ts";

// The test's own window into the database: a pool the code under test never uses.
const observer = newPool();
const pool = newPool();
const log = createDbLog(pool);
const proposals = createDbProposals(pool);
const reservations = createDbReservations(pool);

/** A registry on the database with these controls. */
function withControls(controls: ControlsSource): Registry {
  return dbRegistry(
    pool,
    storyDirectories(),
    handlersFor(),
    ownWorkFor(),
    readLifetimes(),
    controls,
  );
}
// The shipped file: org_456's high-value-payment v8 (step 27's README, decision D16).
const registry = withControls(readControls());

// INV-9001, at the story's 31,400.00 USD, and del_190 with step 24's limits, for intake-fte. The
// story's own invoices and slips stay as they are (step 21's README, decision 12; step 24's
// README, decision 12).
beforeAll(() => {
  ownerInvoices("add", "31400.00", "USD");
  ownerLimits("add");
});
afterAll(async () => {
  ownerLimits("remove");
  ownerInvoices("remove");
  await observer.end();
  await pool.end();
});

const INV_9001 = { invoice: "dsor://org_456/invoice/INV-9001", expected_version: 1 };
// intake-fte works under del_190 (step 26's README, decision D14).
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;

/** intake-fte drafts a payment of INV-9001, through this registry. */
function drafted(envelope: RequestEnvelope, through: Registry = registry): Promise<Answer> {
  return withPlanted("tok_intake", intake, () =>
    call(through, log, envelope, "payment.create", INV_9001),
  );
}

/** The proposal's id, from the answer's URI. */
function proposalOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** One statement as dsor_runtime inside org_456, rolled back after, and its rows. */
async function rowsOf(sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await tryThenRollBack(observer, sql, "org_456", values)).rows;
}

/** The decision's record of this request, as dsor.audit keeps it. */
function recordOf(request_id: string): Promise<Record<string, unknown>[]> {
  return rowsOf(
    `SELECT "authorization", result, controls FROM dsor.audit
      WHERE kind = 'decision' AND correlation->>'request_id' = $1`,
    [request_id],
  );
}

// The shipped control, as a record names it.
const HIGH_VALUE = {
  id: "high-value-payment",
  version: 8,
  outcome: "REQUIRE_APPROVAL",
  authority: {
    system: "ksor",
    uri: "ksor://org_456/finance/payment-approval-policy",
    rule: "high-value-payment",
    version: 4,
    content_hash: "sha256:9f2c1e7ab4d0",
  },
};
const REQUIRES = [{ approval: { role: "CFO", quorum: 1 }, control: "high-value-payment" }];

describe("C4, C6, C7: a payment that needs the CFO, on the database", () => {
  it("DSOR-EXE-02: on the database, intake-fte drafts INV-9001, 31,400.00 USD: the call waits at PENDING_APPROVAL, its proposal waits in dsor.proposals, 31,400.00 USD is held against del_190, no payment is drafted, and dsor.audit names the control, its version, its outcome, and its policy", async () => {
    ownerLimits("reset");
    const answer = await drafted(keyed(INTAKE));
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL", requires: REQUIRES });
    const proposal = proposalOf(answer);
    const waiting = await proposals.get("org_456", proposal);
    expect(waiting?.state).toBe("PENDING_APPROVAL");
    expect("expires_at" in answer && answer.expires_at).toBe(waiting?.expires_at);
    expect(await reservations.get("org_456", proposal)).toMatchObject({
      delegation: "del_190",
      amount: { value: "31400.00", currency: "USD" },
      state: "held",
    });
    expect(
      await rowsOf(
        "SELECT count(*)::int AS n FROM app.payments WHERE tenant_id = 'org_456' AND invoice_id = 'INV-9001'",
      ),
    ).toStrictEqual([{ n: 0 }]);
    expect(await recordOf(answer.correlation.request_id)).toStrictEqual([
      { authorization: "ALLOW", result: "PENDING_APPROVAL", controls: [HIGH_VALUE] },
    ]);
  });

  it("DSOR-IDM-01c: on the database, a replay of the key gives the waiting answer back from the claim: the same proposal, what it requires, and when it expires; the database holds one proposal and one booking", async () => {
    ownerLimits("reset");
    const envelope = keyed(INTAKE);
    const first = await drafted(envelope);
    const again = await drafted({ ...envelope, request_id: requestId("s27-replay") });
    const { correlation: _first, ...firstAnswer } = first;
    const { correlation: _again, ...againAnswer } = again;
    expect(againAnswer).toStrictEqual(firstAnswer);
    expect(firstAnswer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect(
      await rowsOf("SELECT count(*)::int AS n FROM dsor.proposals WHERE idempotency_key = $1", [
        envelope.idempotency_key,
      ]),
    ).toStrictEqual([{ n: 1 }]);
    expect(
      await rowsOf(
        "SELECT count(*)::int AS n, sum(amount_value)::text AS held FROM dsor.reservations WHERE delegation = 'del_190' AND state = 'held'",
      ),
    ).toStrictEqual([{ n: 1, held: "31400.00" }]);
  });

  // Found by step 27's own break: the log's read could drop the controls, and every test above
  // reads the row with SQL. The log in memory gives them back, so the database's must too.
  it("DSOR-EXE-02: on the database, the log reads a waiting payment's record back with its controls, as the log in memory does", async () => {
    ownerLimits("reset");
    const answer = await drafted(keyed(INTAKE));
    const mine = (await log.records("org_456")).filter(
      (record) => record.correlation.request_id === answer.correlation.request_id,
    );
    expect(mine.map((record) => [record.result, record.controls])).toStrictEqual([
      ["PENDING_APPROVAL", [HIGH_VALUE]],
    ]);
  });

  it("DSOR-EXE-02: on the database, a read's record names no control: its controls column is empty", async () => {
    const read = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(read).toHaveProperty("data");
    expect(await recordOf(read.correlation.request_id)).toStrictEqual([
      { authorization: "ALLOW", result: "ok", controls: null },
    ]);
  });

  it("DSOR-AUD-04a: on the database, dsor_runtime may not change a record's controls: the log only takes new records", async () => {
    await expect(
      tryThenRollBack(
        observer,
        "UPDATE dsor.audit SET controls = '[]'::jsonb WHERE tenant = 'org_456'",
        "org_456",
      ),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });
});

describe("C5: DENY wins, on the database", () => {
  // A second control of org_456, which refuses payments above 30,000 USD, beside the shipped one.
  const shipped = JSON.parse(readControls().text) as Record<string, unknown[]>;
  const refuses = {
    ...(shipped["org_456"]![0] as Record<string, unknown>),
    id: "no-payment-above-30000",
    version: 1,
    condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
    effect: { deny: { reason: "Payments above 30,000 USD go through the bank's own desk." } },
    tests: [
      {
        state: { invoice: { open_amount: { value: "30000.00", currency: "USD" } } },
        expect: "ALLOW",
      },
      {
        state: { invoice: { open_amount: { value: "30000.01", currency: "USD" } } },
        expect: "DENY",
      },
    ],
  };
  const denying = withControls({
    file: "controls.json",
    text: JSON.stringify({ ...shipped, org_456: [...shipped["org_456"]!, refuses] }),
  });

  it("DSOR-AUT-02b: on the database, with a second control that refuses payments above 30,000 USD, intake-fte's draft of INV-9001 hears POLICY_DENIED; its proposal ends DENIED, nothing is held against del_190, and the record names both controls", async () => {
    ownerLimits("reset");
    const envelope = keyed(INTAKE);
    const answer = await drafted(envelope, denying);
    expect(answer).toMatchObject({
      code: "POLICY_DENIED",
      message: '"payment.create" is refused by a control of org_456',
    });
    expect(
      await rowsOf("SELECT state FROM dsor.proposals WHERE idempotency_key = $1", [
        envelope.idempotency_key,
      ]),
    ).toStrictEqual([{ state: "DENIED" }]);
    expect(
      await rowsOf("SELECT count(*)::int AS n FROM dsor.reservations WHERE delegation = 'del_190'"),
    ).toStrictEqual([{ n: 0 }]);
    // And the refusing control's own reason, in this tutorial's extensions (step 27's review,
    // finding L2).
    expect(
      await rowsOf(
        `SELECT extensions->'org.panaversity.steps'->'denied_by' AS denied_by FROM dsor.audit
          WHERE kind = 'decision' AND correlation->>'request_id' = $1`,
        [answer.correlation.request_id],
      ),
    ).toStrictEqual([
      {
        denied_by: [
          {
            control: "no-payment-above-30000",
            reason: "Payments above 30,000 USD go through the bank's own desk.",
          },
        ],
      },
    ]);
    expect(await recordOf(answer.correlation.request_id)).toStrictEqual([
      {
        authorization: "DENY",
        result: "POLICY_DENIED",
        controls: [
          HIGH_VALUE,
          {
            id: "no-payment-above-30000",
            version: 1,
            outcome: "DENY",
            authority: HIGH_VALUE.authority,
          },
        ],
      },
    ]);
  });
});

describe("D11: the sweep, on the database", () => {
  // The shipped controls, and a lifetime of one second, so a test can see a waiting payment
  // expire (step 25c's README, decision D2).
  const quick = dbRegistry(
    pool,
    storyDirectories(),
    handlersFor(),
    ownWorkFor(),
    { file: "ready-lifetimes.json", text: '{ "org_456": "PT1S", "org_789": "PT1S" }' },
    readControls(),
  );
  const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
  const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

  it("DSOR-DEL-06d: on the database, intake-fte's payment of INV-9001 waits for the CFO past its lifetime: dsor-scheduler's sweep moves it from PENDING_APPROVAL to EXPIRED, and its 31,400.00 USD goes back to the day (step 27's README, decision D11)", async () => {
    ownerLimits("reset");
    const answer = await drafted(keyed(INTAKE), quick);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const id = proposalOf(answer);
    const usedBy190 =
      "SELECT used::text AS used FROM dsor.limit_counters WHERE delegation = 'del_190'";
    expect(await rowsOf(usedBy190)).toStrictEqual([{ used: "31400.00" }]);
    await pause(1200);
    const swept = await call(quick, log, keyed(SCHEDULER), "proposal.expire_due", {
      company: "dsor://org_456/tenant/org_456",
    });
    expect(swept).toMatchObject({ outcome: "COMMITTED", data: { tenant_id: "org_456" } });
    const ended = await proposals.get("org_456", id);
    expect(ended?.state).toBe("EXPIRED");
    expect(ended?.transitions.at(-1)).toMatchObject({
      from: "PENDING_APPROVAL",
      to: "EXPIRED",
      actor: "dsor-scheduler",
      cause: "waited past its lifetime",
    });
    expect((await reservations.get("org_456", id))?.state).toBe("released");
    expect(await rowsOf(usedBy190)).toStrictEqual([{ used: "0.00" }]);
  });
});
