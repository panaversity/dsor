// An approval expires with its proposal, on the database (step 29's README, claim C6, decision
// D11). A lifetime of three seconds, so a test can see an APPROVED payment expire: intake-fte
// drafts INV-9001, 31,400.00 USD, cfo_100 approves it at once, and dsor-scheduler sweeps after its
// time. A real PostgreSQL, never a mock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals, createDbReservations } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  dbRegistry,
  newPool,
  ownerInvoices,
  ownerLimits,
  ownerRules,
  tryThenRollBack,
} from "./db.ts";
import { CFO, keyed, storyDirectories, withPlanted } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const proposals = createDbProposals(pool);
const reservations = createDbReservations(pool);
// The shipped rules, read from dsor.controls, and a lifetime of three seconds: enough for
// cfo_100 to approve, short enough to wait for.
const quick = dbRegistry(
  pool,
  storyDirectories(),
  handlersFor(),
  ownWorkFor(),
  { file: "ready-lifetimes.json", text: '{ "org_456": "PT3S", "org_789": "PT3S" }' },
  "database",
);
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };

beforeAll(() => {
  ownerRules("clear");
  ownerInvoices("add", "31400.00", "USD");
  ownerLimits("add");
  ownerLimits("reset");
});
afterAll(async () => {
  ownerRules("clear");
  ownerLimits("remove");
  ownerInvoices("remove");
  await pool.end();
});

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** What del_190 has used today, as dsor_runtime reads it inside org_456. */
async function usedBy190(): Promise<unknown> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT used::text AS used FROM dsor.limit_counters WHERE delegation = 'del_190'",
    "org_456",
  );
  return rows;
}

describe("C6: on the database, an approval expires with its proposal (step 29's README, decision D11)", () => {
  it("DSOR-DEL-06d: on the database, intake-fte's payment of INV-9001, APPROVED by cfo_100, waits past its lifetime: dsor-scheduler's sweep moves it from APPROVED to EXPIRED, and its 31,400.00 USD goes back to the day", async () => {
    const drafted = await withPlanted("tok_intake", intake, () =>
      call(quick, log, keyed(INTAKE), "payment.create", {
        invoice: "dsor://org_456/invoice/INV-9001",
        expected_version: 1,
      }),
    );
    const id = idOf(drafted);
    const kept = await proposals.get("org_456", id);
    const approval = await call(quick, log, keyed(CFO), "proposal.approve", {
      proposal: kept!.uri,
      payload_hash: kept!.payload_hash,
    });
    expect(approval).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
    expect(await usedBy190()).toStrictEqual([{ used: "31400.00" }]);
    await new Promise((done) => setTimeout(done, 3_200));
    const swept = await call(quick, log, keyed(SCHEDULER), "proposal.expire_due", {
      company: "dsor://org_456/tenant/org_456",
    });
    expect(swept).toMatchObject({ outcome: "COMMITTED", data: { tenant_id: "org_456" } });
    const ended = await proposals.get("org_456", id);
    expect(ended?.state).toBe("EXPIRED");
    expect(ended?.transitions.at(-1)).toMatchObject({
      from: "APPROVED",
      to: "EXPIRED",
      actor: "dsor-scheduler",
    });
    expect((await reservations.get("org_456", id))?.state).toBe("released");
    expect(await usedBy190()).toStrictEqual([{ used: "0.00" }]);
  });
});
