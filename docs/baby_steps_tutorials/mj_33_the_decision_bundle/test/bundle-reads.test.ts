// What a bundle says DSoR read, and what a release decided on and counted (DSOR-AUD-03a,
// DSOR-APR-03d, DSOR-VER-01c; step 33's README, claim C2, decisions D5, D7, D8, and D13). The
// agent drafts INV-1008, 31,400.00 USD to VENDOR-44, which waits for the CFO; cfo_100 approves it;
// the accounts team may change VENDOR-44; and the agent releases it.
import { describe, expect, it } from "vitest";
import type { SealedBundle } from "../src/bundle.ts";
import type { Answer } from "../src/envelope.ts";
import { ADMIN, AGENT, CFO, OUR_EXTENSIONS, keyed } from "./helpers.ts";
import { ruleCall, ruleWorldOnTuesday, textOf, version9, type RuleWorld } from "./rule-world.ts";

/** The URI of the proposal an answer names, and its id. */
function proposalOf(answer: Answer): { uri: string; id: string } {
  const uri = String("proposal" in answer ? answer.proposal : "");
  return { uri, id: uri.split("/").at(-1)! };
}

/** The bundle of the world's last call. */
async function lastBundle(w: RuleWorld): Promise<SealedBundle> {
  const last = (await w.log.records()).at(-1)!;
  const bundle = (await w.log.bundles()).find((b) => b.decision_id === last.decision_bundle);
  expect(bundle).toBeDefined();
  return bundle!;
}

/** The agent drafts INV-1008, which waits for the CFO, and cfo_100 approves it. */
async function approved(w: RuleWorld) {
  const drafted = await w.draft("INV-1008");
  expect(drafted).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const { uri, id } = proposalOf(drafted);
  const kept = (await w.proposals.get("org_456", id))!;
  const yes = await w.ask(keyed(CFO), "proposal.approve", {
    proposal: uri,
    payload_hash: kept.payload_hash,
  });
  expect(yes).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
  const approvals = await w.proposals.approvals("org_456", id);
  return { uri, id, hash: kept.payload_hash, approvals };
}

/** The accounts team changes one of org_456's vendors, as its system would: a new version. */
function vendorIs(w: RuleWorld, id: string, status: "approved" | "suspended"): void {
  const vendor = w.vendors.find((v) => v.tenant_id === "org_456" && v.id === id)!;
  vendor.status = status;
  vendor.version += 1;
}

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const VENDOR_44 = "dsor://org_456/vendor/VENDOR-44";

describe("C2: the bundle names each record line ⑨ read (step 33's README, D5)", () => {
  it("DSOR-AUD-03a: the agent's draft of INV-1008 names INV-1008 and VENDOR-44, each at the version line ⑨ read, with the read's time, CURRENT", async () => {
    const w = await ruleWorldOnTuesday();
    await w.draft("INV-1008");
    const { state } = await lastBundle(w);
    expect(state).toStrictEqual([
      { uri: INV_1008, version: 1, observed_at: expect.any(String), freshness: "CURRENT" },
      { uri: VENDOR_44, version: 1, observed_at: expect.any(String), freshness: "CURRENT" },
    ]);
    expect(Date.parse(state[0]!.observed_at)).not.toBeNaN();
  });

  it("DSOR-AUD-03a: a vendor that the accounts system does not list is named too, with no version: DSoR looked and found nothing, and the precondition refused", async () => {
    const w = await ruleWorldOnTuesday();
    w.vendors.splice(
      w.vendors.findIndex((v) => v.tenant_id === "org_456" && v.id === "VENDOR-44"),
      1,
    );
    const answer = await w.draft("INV-1008");
    expect(answer).toMatchObject({ code: "CONFLICT" });
    const bundle = await lastBundle(w);
    expect(bundle.state).toStrictEqual([
      { uri: INV_1008, version: 1, observed_at: expect.any(String), freshness: "CURRENT" },
      { uri: VENDOR_44, observed_at: expect.any(String), freshness: "CURRENT" },
    ]);
    expect(bundle.authority.authorization).toBe("DENY");
  });

  it("DSOR-AUD-03a: an invoice that is not there is named, with no version: the agent's draft of INV-9999 is refused at line ⑨", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.ask(keyed(AGENT), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-9999",
      expected_version: 1,
    });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect((await lastBundle(w)).state).toStrictEqual([
      {
        uri: "dsor://org_456/invoice/INV-9999",
        observed_at: expect.any(String),
        freshness: "CURRENT",
      },
    ]);
  });

  it("DSOR-AUD-03a: a call that line ⑨ never read for names no state: cfo_100's approval, and a refusal at line ⑥", async () => {
    const w = await ruleWorldOnTuesday();
    await approved(w);
    expect((await lastBundle(w)).state).toStrictEqual([]);
    await w.ask(keyed(AGENT), "payment.create", { invoice: "INV-1008", expected_version: 1 });
    expect((await lastBundle(w)).state).toStrictEqual([]);
  });
});

describe("C2: a release's bundle names the request it decided, and the approvals it counted (step 33's README, D7, D8)", () => {
  it("DSOR-AUD-03a: the agent's release of INV-1008 names payment.create@1, the stored request's operation and semantics, the proposal, and the proposal's id as the key of its execution", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, id } = await approved(w);
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    expect(await lastBundle(w)).toMatchObject({
      operation: "payment.create@1",
      proposal: uri,
      identity: { mode: "unattended", subject: "user_123", actor_chain: ["accounts-payable-fte"] },
      authority: { delegation: "del_100", authorization: "ALLOW" },
      execution: { idempotency_key: id, semantics: "compensatable", result: "committed" },
    });
    const record = (await w.log.records()).at(-1)!;
    expect(record.operation).toBe("proposal.execute@1");
  });

  it("DSOR-AUD-03a: the release names cfo_100's approval: in the rule's satisfied_by, and in approval, with the fingerprint it binds and its approver", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, hash, approvals } = await approved(w);
    await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri });
    const bundle = await lastBundle(w);
    expect(approvals).toHaveLength(1);
    expect(bundle.authority.controls).toMatchObject([
      {
        id: "high-value-payment",
        version: 8,
        outcome: "REQUIRE_APPROVAL",
        satisfied_by: [approvals[0]!.id],
      },
    ]);
    expect(bundle.approval).toStrictEqual({
      id: approvals[0]!.id,
      payload_hash: hash,
      approvers: ["cfo_100"],
    });
  });

  it("DSOR-AUD-03a: the release reads INV-1008 and VENDOR-44 again, and names them as it read them: VENDOR-44 at version 3, after the accounts team suspended it and approved it again", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await approved(w);
    vendorIs(w, "VENDOR-44", "suspended");
    vendorIs(w, "VENDOR-44", "approved");
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    expect((await lastBundle(w)).state).toStrictEqual([
      { uri: INV_1008, version: 1, observed_at: expect.any(String), freshness: "CURRENT" },
      { uri: VENDOR_44, version: 3, observed_at: expect.any(String), freshness: "CURRENT" },
    ]);
  });

  it("DSOR-AUD-03a: a release that VENDOR-44's suspension invalidates names the stored operation, VENDOR-44 as suspended at version 2, no approval, and not_executed", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await approved(w);
    vendorIs(w, "VENDOR-44", "suspended");
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      code: "APPROVAL_INVALIDATED",
    });
    const bundle = await lastBundle(w);
    expect(bundle).toMatchObject({
      operation: "payment.create@1",
      authority: { authorization: "DENY" },
      execution: { result: "not_executed" },
    });
    expect(bundle.state[1]).toMatchObject({ uri: VENDOR_44, version: 2 });
    expect(bundle).not.toHaveProperty("approval");
  });

  it("DSOR-AUD-03a: a release of a proposal that is not there names the operation called, proposal.execute@1, and no state", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.ask(keyed(AGENT), "proposal.execute", {
      proposal: "dsor://org_456/proposal/prop_00000000-0000-4000-8000-000000000000",
    });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    const bundle = await lastBundle(w);
    expect(bundle).toMatchObject({ operation: "proposal.execute@1", state: [] });
    expect(bundle.execution.semantics).toBe("atomic");
  });

  it("DSOR-APR-03d: a version 9 of the CFO rule at the release: the bundle names version 9 in controls, and version 8, which the request was decided under, in approved_under", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, approvals } = await approved(w);
    const drafted = await ruleCall(w, CFO, "rule.draft", { draft: textOf(version9()) });
    expect(drafted).toMatchObject({ data: { version: 9 } });
    expect(await ruleCall(w, CFO, "rule.activate", { version: 9 })).toMatchObject({
      data: { status: "active" },
    });
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    const bundle = await lastBundle(w);
    expect(bundle.authority.controls).toMatchObject([
      { id: "high-value-payment", version: 9, satisfied_by: [approvals[0]!.id] },
    ]);
    expect(bundle.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      approved_under: [{ control: "high-value-payment", version: 8 }],
    });
  });

  it("DSOR-AUD-03a: two rules, two approvers: the CFO rule names cfo_100's approval, admin_100's rule names theirs, and approval names the first, with both approvers", async () => {
    const w = await ruleWorldOnTuesday();
    const rule = "dsor://org_456/rule/admin-above-30000";
    const text = {
      ...textOf(version9()),
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
      authority: { system: "local", rule: "admin-above-30000" },
      owner: "admin_100",
      tests: [
        {
          state: { invoice: { open_amount: { value: "30000.00", currency: "USD" } } },
          expect: "ALLOW",
        },
        {
          state: { invoice: { open_amount: { value: "30000.01", currency: "USD" } } },
          expect: "REQUIRE_APPROVAL",
        },
      ],
    };
    expect(await ruleCall(w, ADMIN, "rule.draft", { draft: text }, rule)).toMatchObject({
      data: { version: 1 },
    });
    expect(await ruleCall(w, ADMIN, "rule.activate", { version: 1 }, rule)).toMatchObject({
      data: { status: "active" },
    });
    const drafted = await w.draft("INV-1008");
    const { uri, id } = proposalOf(drafted);
    const kept = (await w.proposals.get("org_456", id))!;
    for (const who of [CFO, ADMIN]) {
      await w.ask(keyed(who), "proposal.approve", {
        proposal: uri,
        payload_hash: kept.payload_hash,
      });
    }
    expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
    const given = await w.proposals.approvals("org_456", id);
    const of = (principal: string) =>
      given.find((a) => a.approvers[0]!.principal === principal)!.id;
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    const bundle = await lastBundle(w);
    const satisfied = Object.fromEntries(
      bundle.authority.controls.map((c) => [c.id, c.satisfied_by]),
    );
    expect(satisfied).toStrictEqual({
      "high-value-payment": [of("cfo_100")],
      "admin-above-30000": [of("admin_100")],
    });
    expect(bundle.approval).toStrictEqual({
      id: given[0]!.id,
      payload_hash: kept.payload_hash,
      approvers: given.map((a) => a.approvers[0]!.principal),
    });
    expect(new Set(bundle.approval!.approvers)).toStrictEqual(new Set(["cfo_100", "admin_100"]));
  });

  it("DSOR-AUD-03a: a dry run of the release names the approvals it would count, and moves nothing", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, id, approvals } = await approved(w);
    expect(
      await w.ask({ ...AGENT, mode: "validate_only" }, "proposal.execute", { proposal: uri }),
    ).toMatchObject({
      outcome: "VALIDATED",
    });
    const bundle = await lastBundle(w);
    expect(bundle).toMatchObject({
      operation: "payment.create@1",
      approval: { id: approvals[0]!.id, approvers: ["cfo_100"] },
      execution: { result: "not_executed" },
    });
    expect(bundle).not.toHaveProperty("proposal");
    expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
  });
});

// Found while building step 33: since step 32 bound the vendor, an approval named every bound record
//   by an invoice's address, VENDOR-44 too.
describe("C2: an approval binds each record by its own address (step 33's README, found while building)", () => {
  it("DSOR-APR-02a: cfo_100's approval binds INV-1008 and VENDOR-44, each at its version, each by its own address", async () => {
    const w = await ruleWorldOnTuesday();
    const { approvals } = await approved(w);
    expect(approvals[0]!.bound_state).toStrictEqual({
      mode: "predicate",
      versions: { [INV_1008]: 1, [VENDOR_44]: 1 },
    });
  });
});

describe("C2: a refusal by a rule names the rule's own reason (step 33's README, D13)", () => {
  it("DSOR-AUD-03a: a rule of admin_100's that refuses payments above 30,000 USD: the bundle names it, DENY, and its own reason, which the caller's words leave out", async () => {
    const w = await ruleWorldOnTuesday();
    const rule = "dsor://org_456/rule/no-payment-above-30000";
    const text = {
      ...textOf(version9()),
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
      effect: { deny: { reason: "no payment above 30,000 USD this month" } },
      authority: { system: "local", rule: "no-payment-above-30000" },
      owner: "admin_100",
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
    expect(await ruleCall(w, ADMIN, "rule.draft", { draft: text }, rule)).toMatchObject({
      data: { version: 1 },
    });
    expect(await ruleCall(w, ADMIN, "rule.activate", { version: 1 }, rule)).toMatchObject({
      data: { status: "active" },
    });
    expect(await w.draft("INV-1008")).toMatchObject({ code: "POLICY_DENIED" });
    const bundle = await lastBundle(w);
    expect(bundle.authority.authorization).toBe("DENY");
    expect(bundle.authority.controls.map((c) => [c.id, c.outcome])).toContainEqual([
      "no-payment-above-30000",
      "DENY",
    ]);
    expect(bundle.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      denied_by: [{ control: "no-payment-above-30000", reason: expect.stringContaining("30,000") }],
    });
  });
});
