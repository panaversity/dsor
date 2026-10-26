// The release checks the preconditions again, on the records as they are now (DSOR-APR-03a,
// DSOR-APR-03c; step 32's README, claim C5, decision D11). The agent drafts INV-1008, 31,400.00 USD
// to VENDOR-44, which waits for the CFO. cfo_100 approves it. Then the accounts team changes a
// record, and the agent releases it. This is the step's "done when".
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { Freshness } from "../src/freshness.ts";
import { memoryInvoices } from "../src/invoice.ts";
import { AGENT, CFO, keyed, SUPERVISOR } from "./helpers.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const NOT_APPROVED = 'state.vendor.status == "approved"';
const NOT_ISSUED = 'state.invoice.status == "issued"';

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** The agent drafts INV-1008, and cfo_100 approves it: it waits APPROVED for its release. */
async function approved(w: RuleWorld) {
  const answer = await w.draft("INV-1008");
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const kept = (await w.proposals.get("org_456", idOf(answer)))!;
  const approval = await w.ask(keyed(CFO), "proposal.approve", {
    proposal: kept.uri,
    payload_hash: kept.payload_hash,
  });
  expect(approval).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
  return { id: idOf(answer), uri: kept.uri };
}

/** The accounts team sets one of org_456's vendors to this status. */
function vendorIs(w: RuleWorld, id: string, status: "approved" | "suspended"): void {
  w.vendors.find((v) => v.tenant_id === "org_456" && v.id === id)!.status = status;
}

/** The invalidation a release hears when this precondition fails. */
function invalidatedBy(id: string, predicate: string): string {
  return `proposal ${id} is INVALIDATED: CONFLICT: a precondition of payment.create does not hold: ${predicate}`;
}

describe("C5: the release reads the vendor again (step 32's README, decision D11)", () => {
  it("DSOR-APR-03c: VENDOR-44 is suspended after cfo_100's approval: the agent's release of INV-1008 is APPROVAL_INVALIDATED, the proposal INVALIDATED, its 31,400.00 USD back to the day, and nothing paid", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    vendorIs(w, "VENDOR-44", "suspended");
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri });
    expect(released).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: invalidatedBy(id, NOT_APPROVED),
    });
    expect((await w.proposals.get("org_456", id))?.state).toBe("INVALIDATED");
    expect((await w.reservations.get("org_456", id))?.state).toBe("released");
    expect(w.drafted).toStrictEqual([]);
  });

  it("DSOR-APR-03a: the accounts team approves VENDOR-44 again before the release: INV-1008 is paid, PAY-901", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await approved(w);
    vendorIs(w, "VENDOR-44", "suspended");
    vendorIs(w, "VENDOR-44", "approved");
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
      data: { id: "PAY-901", vendor_id: "VENDOR-44" },
    });
  });

  it("DSOR-OPR-06: a dry run of the release says it would be INVALIDATED, and moves nothing", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    vendorIs(w, "VENDOR-44", "suspended");
    const dry = await w.ask({ ...AGENT, mode: "validate_only" }, "proposal.execute", {
      proposal: uri,
    });
    expect(dry).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: `proposal ${id} would be INVALIDATED: CONFLICT: a precondition of payment.create does not hold: ${NOT_APPROVED}`,
    });
    expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
  });

  it("DSOR-APR-03c: the accounts team cancels INV-1008 after the approval: the release is INVALIDATED by the invoice's precondition", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    w.bills.find((b) => b.tenant_id === "org_456" && b.id === "INV-1008")!.status = "cancelled";
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: invalidatedBy(id, NOT_ISSUED),
    });
  });

  it("DSOR-APR-03c: a prepared INV-1009, READY, of a vendor suspended since: user_123's release is INVALIDATED", async () => {
    const w = await ruleWorldOnTuesday();
    const prepared = await w.ask({ ...keyed(AGENT), mode: "propose_only" }, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 1,
    });
    expect(prepared).toMatchObject({ outcome: "READY" });
    vendorIs(w, "VENDOR-44", "suspended");
    const uri = String("proposal" in prepared ? prepared.proposal : "");
    expect(await w.ask(keyed(SUPERVISOR), "proposal.execute", { proposal: uri })).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: invalidatedBy(idOf(prepared), NOT_APPROVED),
    });
    expect((await w.proposals.get("org_456", idOf(prepared)))?.state).toBe("INVALIDATED");
  });

  it("DSOR-FRS-02b: at the release, a vendor read that is not current is not a no: FRESHNESS_UNSATISFIABLE, and INV-1008 still waits APPROVED", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    // From now on, the store that the registry and the claims share labels each vendor read as
    // a cached one, as a store that fell back to a cache would.
    const inner = memoryInvoices(w.bills, w.vendors);
    const cached: Freshness = {
      mode: "observational",
      observed_at: new Date().toISOString(),
      connector: "memory",
    };
    Object.assign(w.registry.invoices, {
      vendor: async (tenant: string, vendor: string) => ({
        ...(await inner.vendor(tenant, vendor)),
        freshness: cached,
      }),
    });
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
    });
    expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
  });
});
