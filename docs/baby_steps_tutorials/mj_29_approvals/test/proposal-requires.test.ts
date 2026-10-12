// A waiting proposal keeps what it waits for (step 29's README, claim C7, decision D4). When line
// ⑩ stops a call at PENDING_APPROVAL, the proposal keeps each requirement in proposal.schema.json's
// own field, requires: the rule's id and version, and the approval it asks for. It is written once,
// on that move only, so an approval can satisfy only what the proposal waits for.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { Control, ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import { memoryProposals, type MoveBy, type ProposalDraft } from "../src/proposals.ts";
import { ruleWorldOnTuesday, shippedRule, type RuleWorld } from "./rule-world.ts";

/** A controls file with these rules of org_456. */
function controlsOf(...rules: Control[]): ControlsSource {
  return { file: "controls.json", text: JSON.stringify({ org_456: rules, org_789: [] }) };
}

// A second rule of org_456: above 30,000 USD, one approval by a tenant administrator.
const ADMIN_ABOVE_30000: Control = {
  ...shippedRule(),
  id: "admin-above-30000",
  version: 1,
  condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
  effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
};

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** The proposal an answer names, as DSoR keeps it. */
async function proposalOf(w: RuleWorld, answer: Answer) {
  const kept = await w.proposals.get("org_456", idOf(answer));
  if (kept === undefined) throw new Error("no proposal");
  return kept;
}

const CFO_BY_8 = {
  control: "high-value-payment",
  control_version: 8,
  approval: { role: "CFO", quorum: 1 },
};

describe("C7: a waiting proposal keeps what it waits for (step 29's README, decision D4)", () => {
  it("Step 29: INV-1008's proposal waits for one CFO, by version 8 of high-value-payment, and the agent's answer names the same", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.draft("INV-1008");
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL", requires: [CFO_BY_8] });
    expect((await proposalOf(w, answer)).requires).toStrictEqual([CFO_BY_8]);
  });

  it("DSOR-AUT-02c: when two rules each ask for an approval, the proposal keeps both: INV-1008, 31,400.00 USD, waits for the CFO and for a tenant administrator", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(shippedRule(), ADMIN_ABOVE_30000));
    const answer = await w.draft("INV-1008");
    expect((await proposalOf(w, answer)).requires).toStrictEqual([
      {
        control: "admin-above-30000",
        control_version: 1,
        approval: { role: "tenant_admin", quorum: 1 },
      },
      CFO_BY_8,
    ]);
  });

  it("Step 29: a proposal that no rule stops waits for nothing: INV-1012's draft keeps no requires", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.draft("INV-1012");
    expect("requires" in (await proposalOf(w, answer))).toBe(false);
  });

  it("DSOR-SCH-01: a waiting proposal, as DSoR keeps it, passes proposal.schema.json", async () => {
    const w = await ruleWorldOnTuesday();
    const kept = await proposalOf(w, await w.draft("INV-1008"));
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const schema = (file: string) =>
      JSON.parse(readFileSync(new URL(`../schemas/${file}`, import.meta.url), "utf8")) as object;
    // The step's copies of the specification's schemas, byte for byte (test/schemas.test.ts).
    ajv.addSchema(schema("common.schema.json"));
    ajv.addSchema(schema("security-context.schema.json"));
    const validate = ajv.compile(schema("proposal.schema.json"));
    expect(validate(kept) ? [] : validate.errors).toStrictEqual([]);
  });
});

describe("C7: what a proposal waits for is written once (step 29's README, decision D4)", () => {
  const draft: ProposalDraft = {
    operation: "payment.create@1",
    mode: "execute",
    payload: { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 },
    payload_hash: `sha256:${"0".repeat(64)}`,
    resources: ["dsor://org_456/invoice/INV-1008"],
    requester: {
      identity_mode: "direct",
      subject: "user_123",
      subject_type: "human",
      actor_chain: [],
      active_tenant: "org_456",
      subject_authority: { source: "token", as_of: "2026-10-06T15:05:00.000Z" },
    },
    idempotency_key: "pay-INV-1008",
  };
  const by: MoveBy = {
    mover: {
      mode: "direct",
      subject: "user_123",
      actor_chain: [],
      subject_authority: { source: "token", as_of: "2026-10-06T15:05:00.000Z" },
    },
    cause: "a test",
    correlation: { request_id: "req_test" },
  };

  it("Step 29: the move to PENDING_APPROVAL names what the proposal waits for, and only that move may", async () => {
    const store = memoryProposals();
    await store.create("org_456", "prop_a", draft, by, "P7D");
    await expect(store.move("org_456", "prop_a", "PROPOSED", "PENDING_APPROVAL", by)).rejects.toThrow(
      "a proposal that waits for an approval names what it waits for",
    );
    expect(
      await store.move("org_456", "prop_a", "PROPOSED", "PENDING_APPROVAL", by, [CFO_BY_8]),
    ).toBe(true);
    await expect(
      store.move("org_456", "prop_a", "PENDING_APPROVAL", "EXPIRED", by, [CFO_BY_8]),
    ).rejects.toThrow("what a proposal waits for is written once, when it starts to wait");
    expect((await store.get("org_456", "prop_a"))?.requires).toStrictEqual([CFO_BY_8]);
  });

  it("Step 29: the store keeps its own copy: a caller that changes the list afterwards changes nothing", async () => {
    const store = memoryProposals();
    await store.create("org_456", "prop_b", draft, by, "P7D");
    const given = [structuredClone(CFO_BY_8)];
    await store.move("org_456", "prop_b", "PROPOSED", "PENDING_APPROVAL", by, given);
    given[0]!.approval.quorum = 0;
    expect((await store.get("org_456", "prop_b"))?.requires).toStrictEqual([CFO_BY_8]);
  });
});
