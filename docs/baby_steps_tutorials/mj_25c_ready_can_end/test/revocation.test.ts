// Tearing up a permission slip (DSOR-DEL-04a to DSOR-DEL-04c in
// specs/dsor/02-security.md, section 13.3). The slip's delegator, or a tenant administrator,
// tears it up through DSoR, as a command. From the next call on, the agent is refused, and the
// slip's work that waits for an approval moves to CANCELLED, its reservation released (step 25's
// README, claims C1 to C6, C8, C9, C11, and C12).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { memoryClaims } from "../src/claims.ts";
import type { Answer } from "../src/envelope.ts";
import { invoices, memoryInvoices } from "../src/invoice.ts";
import { memoryReservations } from "../src/limits.ts";
import { createLog } from "../src/log.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import { checkPermission } from "../src/permissions.ts";
import { logins, type Principal } from "../src/principals.ts";
import { call } from "../src/pipeline.ts";
import {
  memoryProposals,
  type MemoryProposals,
  type ProposalDraft,
  type ProposalStore,
} from "../src/proposals.ts";
import { buildRegistry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { memorySlips, type MemorySlips, type SlipStore } from "../src/slips.ts";
import {
  ADMIN,
  AGENT,
  CFO,
  contract,
  DEL_100,
  DEL_101,
  DEL_102,
  FOREIGN_URI,
  INTAKE_SLIP,
  keyed,
  OUR_EXTENSIONS,
  refusal,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  source,
  storyDirectories,
  SUPERVISOR,
  USER_700,
  withPlanted,
  type StorySlip,
} from "./helpers.ts";

const DEL_100_URI = "dsor://org_456/delegation/del_100";

/** The one refusal of a person who may not tear up a slip, whether the slip is there or not. */
function notYours(person: string, slip: string): string {
  return `"delegation.revoke": ${person} may not tear up slip "${slip}": only its signer or a tenant administrator may`;
}
const WHY = "the agent paid VENDOR-44 twice";
const DAY = { value: "200000", currency: "USD" };
const AMOUNT = { value: "31400.00", currency: "USD" };

/** A world in memory: the story's slips, proposals, reservations, and a registry over them. */
function story(
  slips: readonly StorySlip[] = [DEL_100, DEL_101, DEL_102, INTAKE_SLIP],
  // The slips and the proposals the claim's work uses, when a test changes them. Line ③ reads the
  // slips store itself, and the test reads the proposals store itself.
  options: {
    claimSlips?: (kept: MemorySlips) => SlipStore;
    claimProposals?: (kept: MemoryProposals) => ProposalStore;
  } = {},
) {
  const claimSlips = options.claimSlips ?? ((kept: MemorySlips) => kept);
  const claimProposals = options.claimProposals ?? ((kept: MemoryProposals) => kept);
  const ledger = structuredClone(invoices);
  const store = memoryInvoices(ledger);
  const rows: Payment[] = [];
  const payments = memoryPayments(rows);
  const proposals = memoryProposals();
  const reservations = memoryReservations();
  const kept = memorySlips(slips);
  const registry = buildRegistry(
    shipped,
    handlersFor(),
    shippedRoles,
    shippedInputs,
    shippedLabels,
    store,
    payments,
    kept,
    storyDirectories(),
    readRoleSettings(),
    // The claim's work tears up the slip in the same store that line ③ reads.
    memoryClaims(store, payments, claimProposals(proposals), reservations, claimSlips(kept)),
    ownWorkFor(),
  );
  return { rows, proposals, reservations, slips: kept, registry, log: createLog() };
}
type World = ReturnType<typeof story>;

/** A person tears up a slip, with a fresh key. */
function tearUp(
  world: World,
  envelope: RequestEnvelope = keyed(SUPERVISOR),
  input: unknown = { slip: DEL_100_URI, reason: WHY },
  lines?: number[],
): Promise<Answer> {
  return call(world.registry, world.log, envelope, "delegation.revoke", input, (n) =>
    lines?.push(n),
  );
}

/** The agent drafts a payment for INV-1008, with a fresh key, or in the mode given. */
function draft(world: World, envelope: RequestEnvelope = keyed(AGENT)): Promise<Answer> {
  return call(world.registry, world.log, envelope, "payment.create", {
    invoice: "dsor://org_456/invoice/INV-1008",
    expected_version: 1,
  });
}

/** The status of the agent's slip, as the store keeps it now. */
async function statusOf(world: World, agent = "accounts-payable-fte"): Promise<unknown> {
  const found = await world.slips.find("org_456", agent);
  return (found?.slip as { status?: unknown } | undefined)?.status;
}

/** What the caller heard, in one word. */
function heard(answer: Answer): string {
  if ("code" in answer) return answer.code;
  return "outcome" in answer ? answer.outcome : "data";
}

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "").slice(
    "dsor://org_456/proposal/".length,
  );
}

// A proposal of the agent's under a slip, planted by the test and moved by hand along the picture.
// Approvals arrive in step 29, so no call reaches PENDING_APPROVAL or APPROVED yet (step 25's
// README, outcome 3).
async function planted(
  world: World,
  delegation: string,
  path: ("PENDING_APPROVAL" | "APPROVED")[],
): Promise<string> {
  const id = `prop_${crypto.randomUUID()}`;
  const requester = {
    identity_mode: "unattended" as const,
    subject: "user_123",
    subject_type: "human",
    actor_chain: ["accounts-payable-fte"],
    active_tenant: "org_456",
    delegation,
    subject_authority: { source: "role_source" as const, as_of: new Date().toISOString() },
  };
  const draft: ProposalDraft = {
    operation: "payment.create@1",
    mode: "execute",
    payload: { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 },
    payload_hash: `sha256:${"0".repeat(64)}`,
    resources: ["dsor://org_456/invoice/INV-1008"],
    requester,
    idempotency_key: `plant-${id}`,
  };
  const by = {
    mover: {
      mode: "unattended" as const,
      subject: "user_123",
      actor_chain: ["accounts-payable-fte"],
      subject_authority: requester.subject_authority,
    },
    cause: "planted by the test",
    correlation: { request_id: "req_planted" },
  };
  await world.proposals.create("org_456", id, draft, by, "P7D");
  let from: "PROPOSED" | "PENDING_APPROVAL" | "APPROVED" = "PROPOSED";
  for (const to of path) {
    expect(await world.proposals.move("org_456", id, from, to, by)).toBe(true);
    from = to;
  }
  return id;
}

describe("C1, C4: the delegator tears up the slip", () => {
  it("DSOR-DEL-04a: user_123 tears up del_100, which user_123 signed: COMMITTED, and the slip is revoked", async () => {
    const world = story();
    const lines: number[] = [];
    const answer = await tearUp(world, keyed(SUPERVISOR), undefined, lines);
    expect(answer).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", id: "del_100", status: "revoked", cancelled: 0 },
      semantics: "atomic",
    });
    expect(await statusOf(world)).toBe("revoked");
    // The whole checklist of a command, as for any other: a key, a proposal, and a record.
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("DSOR-DEL-04b: the agent's next call after the tear-up hears DELEGATION_REVOKED, a draft and a read alike", async () => {
    const world = story();
    expect(heard(await draft(world))).toBe("COMMITTED");
    expect(heard(await tearUp(world))).toBe("COMMITTED");
    expect(await draft(world)).toMatchObject({
      code: "DELEGATION_REVOKED",
      message: '"payment.create": slip del_100 was torn up',
      retry: "never",
    });
    const read = await call(world.registry, world.log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(read).toMatchObject({ code: "DELEGATION_REVOKED" });
    expect(world.rows).toHaveLength(1);
  });

  it("DSOR-DEL-04a: a slip that the directory suspended (step 19b) can be torn up too", async () => {
    const world = story([{ ...DEL_100, status: "suspended" }, DEL_101, DEL_102]);
    expect(heard(await tearUp(world))).toBe("COMMITTED");
    expect(await statusOf(world)).toBe("revoked");
  });
});

describe("C2: a tenant administrator tears up any slip of the company", () => {
  it("DSOR-DEL-04a: admin_100, org_456's tenant administrator, tears up del_100, which user_123 signed", async () => {
    const world = story();
    expect(await tearUp(world, keyed(ADMIN))).toMatchObject({
      outcome: "COMMITTED",
      data: { id: "del_100", status: "revoked" },
    });
    expect(await statusOf(world)).toBe("revoked");
  });
});

describe("C3: nobody else tears up a slip", () => {
  // Changed by step 25's review (M2): every person may ask, so line ⑤ lets the CFO through, and
  // line ⑨ refuses the CFO: del_100 is not the CFO's.
  it("DSOR-DEL-04a: the CFO, who did not sign del_100 and is not a tenant administrator, is refused at line ⑨, and the slip stays active", async () => {
    const world = story();
    const lines: number[] = [];
    const answer = await tearUp(world, keyed(CFO), undefined, lines);
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: notYours("cfo_100", "del_100"),
    });
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
    expect((await world.proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
    expect(await statusOf(world)).toBe("active");
  });

  it("DSOR-DEL-04a: another supervisor of org_456, who did not sign del_100, is refused, and the slip stays active", async () => {
    const world = story();
    const other = {
      id: "user_124",
      type: "human",
      memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
    } as unknown as Principal;
    const answer = await withPlanted("tok_user_124", other, () =>
      tearUp(world, keyed({ token: "tok_user_124", tenant: "org_456" })),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: notYours("user_124", "del_100"),
    });
    expect(await statusOf(world)).toBe("active");
  });

  it("DSOR-DEL-04a: the agent cannot tear up its own slip: line ⑤ refuses an agent, even when its slip lists delegation:revoke", async () => {
    const listing = { ...DEL_100, permissions: [...DEL_100.permissions, "delegation:revoke"] };
    const world = story([listing, DEL_101, DEL_102]);
    const lines: number[] = [];
    expect(await tearUp(world, keyed(AGENT), undefined, lines)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"delegation.revoke" is for people only, and accounts-payable-fte is not a person',
    });
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 11]);
    expect(await statusOf(world)).toBe("active");
  });

  it("DSOR-DEL-04a: org_789's supervisor cannot name a slip of org_456", async () => {
    const world = story();
    expect(await tearUp(world, keyed(USER_700))).toMatchObject({ message: FOREIGN_URI });
    expect(await statusOf(world)).toBe("active");
  });

  // Changed by step 25's review (M1): a person who may not tear up a slip learns nothing of it, so
  // only a tenant administrator, who may tear up any slip, hears that one is not there.
  it("DSOR-ERR-01b: a slip that nobody has: a tenant administrator hears RESOURCE_NOT_FOUND, and anyone else the refusal of a slip that is not theirs", async () => {
    const world = story();
    const input = { slip: "dsor://org_456/delegation/del_999", reason: WHY };
    expect(await tearUp(world, keyed(ADMIN), input)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no slip "del_999"',
    });
    expect(await tearUp(world, keyed(SUPERVISOR), input)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: notYours("user_123", "del_999"),
    });
  });

  it("Step 25: a slip torn up already, or past its date, gives CONFLICT, and nothing changes", async () => {
    const world = story([DEL_100, { ...DEL_101, expires_at: "2020-01-01T00:00:00Z" }, DEL_102]);
    expect(heard(await tearUp(world))).toBe("COMMITTED");
    expect(await tearUp(world)).toMatchObject({
      code: "CONFLICT",
      message: "slip del_100 is torn up already",
    });
    const old = { slip: "dsor://org_456/delegation/del_101", reason: WHY };
    expect(await tearUp(world, keyed(SUPERVISOR), old)).toMatchObject({
      code: "CONFLICT",
      message: "slip del_101 is past its date, so there is nothing to tear up",
    });
    expect(await statusOf(world, "firm-ap-fte")).toBe("active");
  });

  it("Step 25: the input must name a slip, and give a reason", async () => {
    const world = story();
    for (const input of [
      { slip: "dsor://org_456/invoice/INV-1008", reason: WHY },
      { slip: DEL_100_URI },
      { slip: DEL_100_URI, reason: "" },
    ]) {
      expect(await tearUp(world, keyed(SUPERVISOR), input)).toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
    // The authority's own spelling is refused at line ③, before line ⑥: a person calls under no
    // slip, so an argument named delegation disagrees with the call (DSOR-SRC-02b).
    expect(
      await tearUp(world, keyed(SUPERVISOR), { delegation: DEL_100_URI, reason: WHY }),
    ).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "the arguments name a slip the caller does not call under, in delegation",
    });
    expect(await statusOf(world)).toBe("active");
  });
});

describe("C5, C6: the slip's waiting work is cancelled", () => {
  it("DSOR-DEL-04c: the tear-up moves every PENDING_APPROVAL or APPROVED proposal under the slip to CANCELLED, each with a record", async () => {
    const world = story();
    const pending = await planted(world, "del_100", ["PENDING_APPROVAL"]);
    const approved = await planted(world, "del_100", ["PENDING_APPROVAL", "APPROVED"]);
    const answer = await tearUp(world);
    // Changed by step 25's review (L2): the answer counts them. Each one has its record.
    expect(answer).toMatchObject({ outcome: "COMMITTED", data: { cancelled: 2 } });
    for (const id of [pending, approved]) {
      const proposal = await world.proposals.get("org_456", id);
      expect(proposal?.state).toBe("CANCELLED");
      expect(proposal?.transitions.at(-1)).toMatchObject({
        to: "CANCELLED",
        // Changed by step 25's review (L4): the person who tore up the slip made the move.
        actor: "user_123",
        cause: "slip del_100 was torn up",
      });
    }
  });

  // NEW IN STEP 25c: the learner's proposed DSOR-DEL-04c lists READY too, so the prepared draft is
  // cancelled with the rest, and its booking goes back to the day. Step 25 kept it READY (step 25's
  // README, decision L4; step 25c's README, claim C2).
  it("Step 25c: a READY proposal under the torn-up slip moves to CANCELLED, and its reservation is released (step 25c's README, claim C2)", async () => {
    // del_100 with step 24's limits, so the prepared draft reserves its amount.
    const limits = {
      per_transaction_limit: { value: "50000", currency: "USD" },
      cumulative_limits: [{ window: "P1D", amount: DAY }],
    };
    const world = story([{ ...DEL_100, constraints: limits }, DEL_101, DEL_102]);
    const prepared = await draft(world, { ...keyed(AGENT), mode: "propose_only" });
    expect(heard(prepared)).toBe("READY");
    const id = String("proposal" in prepared ? prepared.proposal : "")
      .split("/")
      .at(-1)!;
    expect(heard(await tearUp(world))).toBe("COMMITTED");
    expect((await world.proposals.get("org_456", id))?.state).toBe("CANCELLED");
    expect((await world.reservations.get("org_456", id))?.state).toBe("released");
  });

  it("Step 25: a waiting proposal under another slip is not touched", async () => {
    const world = story();
    const firms = await planted(world, "del_101", ["PENDING_APPROVAL"]);
    expect(await tearUp(world)).toMatchObject({ data: { cancelled: 0 } });
    expect((await world.proposals.get("org_456", firms))?.state).toBe("PENDING_APPROVAL");
  });

  it("DSOR-DEL-06d: a CANCELLED proposal's reservation is released, and the day gets its amount back", async () => {
    const world = story();
    const pending = await planted(world, "del_100", ["PENDING_APPROVAL"]);
    expect(await world.reservations.reserve("org_456", pending, "del_100", AMOUNT, DAY)).toBe(true);
    expect(await world.reservations.used("org_456", "del_100", "USD")).toBe("31400.00");
    expect(heard(await tearUp(world))).toBe("COMMITTED");
    expect((await world.reservations.get("org_456", pending))?.state).toBe("released");
    expect(await world.reservations.used("org_456", "del_100", "USD")).toBe("0.00");
  });
});

describe("C9: the tear-up is a command, and leaves its records", () => {
  it("Step 25: the tear-up leaves one delegation_change record: the person, the reason, and the call", async () => {
    const world = story();
    const answer = await tearUp(world);
    expect(await world.slips.changes()).toStrictEqual([
      {
        kind: "delegation_change",
        result: "revoked",
        reason: WHY,
        correlation: answer.correlation,
        tenant: "org_456",
        delegation: "del_100",
        identity: {
          mode: "direct",
          subject: "user_123",
          actor_chain: [],
          subject_authority: { source: "token", as_of: expect.any(String) },
        },
      },
    ]);
  });

  it("Step 25: the tear-up's own proposal moves PROPOSED to COMMITTED, and its decision record says ALLOW", async () => {
    const world = story();
    const answer = await tearUp(world);
    const id = String("proposal" in answer ? answer.proposal : "")
      .split("/")
      .at(-1)!;
    const proposal = await world.proposals.get("org_456", id);
    expect(proposal?.state).toBe("COMMITTED");
    expect(proposal?.operation).toBe("delegation.revoke@1");
    const record = (await world.log.records()).at(-1);
    expect([record?.operation, record?.authorization]).toStrictEqual([
      "delegation.revoke@1",
      "ALLOW",
    ]);
  });

  it("Step 25: a dry run of a tear-up changes nothing: VALIDATED, and the slip stays active", async () => {
    const world = story();
    const answer = await tearUp(world, { ...SUPERVISOR, mode: "validate_only" });
    expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
    expect(await statusOf(world)).toBe("active");
    expect(await world.slips.changes()).toStrictEqual([]);
  });

  it("Step 25: a prepared tear-up waits in READY, and the slip stays active until someone releases it (step 31)", async () => {
    const world = story();
    const answer = await tearUp(world, { ...keyed(SUPERVISOR), mode: "propose_only" });
    expect(answer).toMatchObject({ outcome: "READY" });
    expect(await statusOf(world)).toBe("active");
  });
});

describe("start-up, and line ⑤'s people only", () => {
  const own = ownWorkFor();
  const withoutRevoke = shipped.filter(({ file }) => file !== "delegation.revoke.json");

  it("Step 25: start-up refuses DSoR's own work that has no contract", () => {
    expect(
      refusal(() =>
        buildRegistry(
          withoutRevoke,
          {},
          shippedRoles,
          shippedInputs,
          shippedLabels,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          own,
        ),
      ),
    ).toContain("delegation.revoke has DSoR's own work but no contract");
  });

  it("Step 25: start-up refuses one name with both company code and DSoR's own work", () => {
    const both = { ...handlersFor(), "delegation.revoke": () => ({}) };
    expect(
      refusal(() =>
        buildRegistry(
          shipped,
          both,
          shippedRoles,
          shippedInputs,
          shippedLabels,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          own,
        ),
      ),
    ).toContain("delegation.revoke has both company code and DSoR's own work");
  });

  it("Step 25: start-up refuses DSoR's own work for a query", () => {
    const asQuery = { ...contract("delegation.revoke"), kind: "query", effect: "read" };
    const sources = [...withoutRevoke, source(asQuery, "delegation.revoke.json")];
    expect(
      refusal(() =>
        buildRegistry(
          sources,
          {},
          shippedRoles,
          shippedInputs,
          shippedLabels,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          own,
        ),
      ),
    ).toContain("delegation.revoke: DSoR's own work changes DSoR's store, so it is a command");
  });

  it("Step 25: line ⑤ refuses an agent for a contract that says people only, whatever it holds, and lets a person through", () => {
    const world = story();
    const peopleOnly = {
      ...contract("invoice.get"),
      extensions: { [OUR_EXTENSIONS]: { people_only: true } },
    } as unknown as Parameters<typeof checkPermission>[1];
    const agent = {
      id: "accounts-payable-fte",
      type: "agent",
      memberships: [{ tenant_id: "org_456", roles: [] }],
    } as unknown as Principal;
    const person = {
      id: "user_123",
      type: "human",
      memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
    } as unknown as Principal;
    const slip = { ...DEL_100, status: "active" } as unknown as Parameters<
      typeof checkPermission
    >[4];
    expect(() =>
      checkPermission(agent, peopleOnly, world.registry.roles, "org_456", slip, ["ap_supervisor"]),
    ).toThrow('"invoice.get" is for people only, and accounts-payable-fte is not a person');
    expect(() =>
      checkPermission(person, peopleOnly, world.registry.roles, "org_456"),
    ).not.toThrow();
  });
});

describe("from step 25's sweep", () => {
  // R6: another call tore the slip up between the look and the change, so the change touched
  // nothing. The tear-up must say so, and cancel nothing.
  it("Step 25: a tear-up whose change finds the slip changed meanwhile is refused with CONFLICT, and cancels nothing", async () => {
    const world = story(undefined, {
      claimSlips: (kept) => ({
        ...kept,
        revoke: async (tenant, id, why) => {
          await kept.revoke(tenant, id, { ...why, words: "another call tore it up first" });
          return kept.revoke(tenant, id, why);
        },
      }),
    });
    const pending = await planted(world, "del_100", ["PENDING_APPROVAL"]);
    expect(await tearUp(world)).toMatchObject({
      code: "CONFLICT",
      message: "slip del_100 changed while it was being torn up",
    });
    expect((await world.proposals.get("org_456", pending))?.state).toBe("PENDING_APPROVAL");
    const changes = await world.slips.changes();
    expect(changes.map((change) => change.reason)).toStrictEqual(["another call tore it up first"]);
  });

  // S1, S2: the work's own look refuses these first, so only a test of the store alone sees the
  // store's own check.
  it("Step 25: the slips store alone tears up only a slip that is active or suspended, and not past its date", async () => {
    const slips = memorySlips([
      { ...DEL_100, id: "del_301", delegate: "agent-1" },
      { ...DEL_100, id: "del_302", delegate: "agent-2", status: "suspended" },
      { ...DEL_100, id: "del_303", delegate: "agent-3", status: "revoked" },
      { ...DEL_100, id: "del_304", delegate: "agent-4", status: "expired" },
      { ...DEL_100, id: "del_305", delegate: "agent-5", expires_at: "2020-01-01T00:00:00Z" },
    ]);
    const why = {
      person: "user_123",
      as_of: new Date().toISOString(),
      words: WHY,
      correlation: { request_id: "req_store" },
    };
    const results: boolean[] = [];
    for (const id of ["del_301", "del_302", "del_303", "del_304", "del_305"]) {
      results.push(await slips.revoke("org_456", id, why));
    }
    expect(results).toStrictEqual([true, true, false, false, false]);
    expect((await slips.changes()).map((change) => change.delegation)).toStrictEqual([
      "del_301",
      "del_302",
    ]);
  });

  // S4: the URI names org_456, so the URI check lets it through. Only the store's own company
  // filter keeps org_789's del_102 out of reach.
  it("DSOR-TEN-01b: a slip id of another company, named in this company's URI, is no slip here: RESOURCE_NOT_FOUND, and org_789's slip stays active", async () => {
    const world = story();
    const input = { slip: "dsor://org_456/delegation/del_102", reason: WHY };
    expect(await tearUp(world, keyed(ADMIN), input)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no slip "del_102"',
    });
    const other = await world.slips.find("org_789", "firm-ap-fte");
    expect((other?.slip as { status?: unknown } | undefined)?.status).toBe("active");
  });

  // K3: a registry built with its own claims, as most tests build one, and DSoR's own work. Its
  // claims must tear up the store that line ③ reads.
  it("Step 25: a registry built with its own claims tears up the slip that line ③ reads", async () => {
    const ledger = structuredClone(invoices);
    const store = memoryInvoices(ledger);
    const payments = memoryPayments([]);
    const registry = buildRegistry(
      shipped,
      handlersFor(),
      shippedRoles,
      shippedInputs,
      shippedLabels,
      store,
      payments,
      memorySlips([DEL_100, DEL_101, DEL_102]),
      storyDirectories(),
      readRoleSettings(),
      undefined,
      ownWorkFor(),
    );
    const log = createLog();
    const input = { slip: DEL_100_URI, reason: WHY };
    expect(heard(await call(registry, log, keyed(SUPERVISOR), "delegation.revoke", input))).toBe(
      "COMMITTED",
    );
    const after = await call(registry, log, keyed(AGENT), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1008",
      expected_version: 1,
    });
    expect(after).toMatchObject({ code: "DELEGATION_REVOKED" });
  });
});

describe("from step 25's review", () => {
  const user124 = {
    id: "user_124",
    type: "human",
    memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
  } as unknown as Principal;
  const AS_124 = { token: "tok_user_124", tenant: "org_456" };
  const asUser124 = <T>(run: () => Promise<T>): Promise<T> =>
    withPlanted("tok_user_124", user124, run);

  // M1: the who-check ran inside the work, after DSoR had said yes.
  it("DSOR-EXE-02: a refused tear-up is recorded DENY, and its proposal ends DENIED, never EXECUTING", async () => {
    const world = story();
    const answer = await asUser124(() => tearUp(world, keyed(AS_124)));
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    const record = (await world.log.records()).at(-1);
    expect([record?.authorization, record?.result]).toStrictEqual(["DENY", "AUTHORIZATION_DENIED"]);
    const proposal = await world.proposals.get("org_456", idOf(answer));
    expect(proposal?.transitions.map((t) => t.to)).toStrictEqual(["PROPOSED", "DENIED"]);
  });

  it("DSOR-OPR-05: a dry run and a prepared call of a refused tear-up hear the real call's refusal", async () => {
    const world = story();
    for (const mode of ["validate_only", "propose_only"] as const) {
      const envelope = mode === "validate_only" ? { ...AS_124, mode } : { ...keyed(AS_124), mode };
      expect(await asUser124(() => tearUp(world, envelope))).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: notYours("user_124", "del_100"),
      });
    }
    // And the two refusals the slip itself gives: none there, and torn up already.
    const none = { slip: "dsor://org_456/delegation/del_999", reason: WHY };
    expect(await tearUp(world, { ...ADMIN, mode: "validate_only" }, none)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    expect(heard(await tearUp(world))).toBe("COMMITTED");
    expect(await tearUp(world, { ...SUPERVISOR, mode: "validate_only" })).toMatchObject({
      code: "CONFLICT",
      message: "slip del_100 is torn up already",
    });
  });

  it("DSOR-ERR-01b: a person who may not tear up a slip hears one answer for a slip that is there and one that is not", async () => {
    const world = story();
    const there = await asUser124(() => tearUp(world, keyed(AS_124)));
    const none = { slip: "dsor://org_456/delegation/del_999", reason: WHY };
    const notThere = await asUser124(() => tearUp(world, keyed(AS_124), none));
    const [a, b] = [there, notThere].map((answer) =>
      "code" in answer ? [answer.code, answer.message.replace(/del_\d+/, "del_N")] : [],
    );
    expect(a).toStrictEqual(b);
  });

  // F12, from the sweep of the review's fixes: with the slip's state told before the who-check,
  // user_124 heard that a slip user_124 may not touch was torn up already.
  it("DSOR-ERR-01b: a person who may not tear up a slip hears the same refusal when it is torn up already: its state stays hidden", async () => {
    const world = story();
    const before = await asUser124(() => tearUp(world, keyed(AS_124)));
    expect(heard(await tearUp(world))).toBe("COMMITTED");
    const after = await asUser124(() => tearUp(world, keyed(AS_124)));
    expect(after).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: notYours("user_124", "del_100"),
    });
    expect("code" in after && "code" in before ? after.message : "").toBe(
      "code" in before ? before.message : "",
    );
  });

  // M2: "revocable by its delegator" held only because every signer was a supervisor. Line ⑤
  // asks every caller for the contract's permission, so every role grants it, and line ⑨ decides
  // whose slip it is. A role added without it would bring the finding back.
  // NEW IN STEP 25c: every role but scheduler. Only dsor-scheduler holds it, a login of type
  // system that signs no slip, so it grants proposal:expire alone (step 25c's README, decision
  // D10). The test now checks that no person holds it, so the finding cannot come back that way.
  it("DSOR-DEL-04a: every role in the shipped roles.json but scheduler grants delegation:revoke, and no person holds scheduler, so every person who signs a slip may ask to tear it up", () => {
    const shipped = JSON.parse(
      readFileSync(new URL("../roles.json", import.meta.url), "utf8"),
    ) as Record<string, string[]>;
    const without = Object.keys(shipped).filter(
      (role) => !shipped[role]!.includes("delegation:revoke"),
    );
    expect(without).toStrictEqual(["scheduler"]);
    const people = [...logins.values()].filter((login) => login.type === "human");
    const theirs = people.flatMap((person) => person.memberships.flatMap((m) => m.roles));
    expect(theirs).not.toContain("scheduler");
    expect(people.length).toBeGreaterThan(0);
  });

  // M2: "revocable by its delegator" held only because every signer was a supervisor.
  it("DSOR-DEL-04a: cfo_100 tears up del_150, which cfo_100 signed, for an agent that only reads", async () => {
    const del150 = {
      ...DEL_100,
      id: "del_150",
      delegator: "cfo_100",
      delegate: "reader-fte",
      permissions: ["invoice:read"],
    };
    const world = story([DEL_100, del150]);
    const input = { slip: "dsor://org_456/delegation/del_150", reason: WHY };
    expect(await tearUp(world, keyed(CFO), input)).toMatchObject({
      outcome: "COMMITTED",
      data: { id: "del_150", status: "revoked" },
    });
  });

  // L1: people only refused agents only, and an application passed.
  it("Step 25: line ⑤'s people only refuses every caller that is not a person: an application that holds tenant_admin, and a type DSoR does not know", async () => {
    const application = {
      id: "ops-console",
      type: "application",
      memberships: [{ tenant_id: "org_456", roles: ["tenant_admin"] }],
    } as unknown as Principal;
    // A type DSoR does not know acts as an agent, so line ③ asks it for a slip first. This one
    // has the agent's slip, which lists delegation:revoke, so only line ⑤ is left to refuse it.
    const unknown = {
      id: "accounts-payable-fte",
      type: "Agent",
      memberships: [{ tenant_id: "org_456", roles: [] }],
    } as unknown as Principal;
    const listing = { ...DEL_100, permissions: [...DEL_100.permissions, "delegation:revoke"] };
    const world = story([listing, DEL_101, DEL_102]);
    for (const caller of [application, unknown]) {
      const answer = await withPlanted("tok_other", caller, () =>
        tearUp(world, keyed({ token: "tok_other", tenant: "org_456" })),
      );
      expect(answer).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `"delegation.revoke" is for people only, and ${caller.id} is not a person`,
      });
    }
    expect(await statusOf(world)).toBe("active");
  });

  // U13: people only, in every mode.
  it("DSOR-DEL-04a: the agent cannot tear up its own slip in any mode, even when its slip lists delegation:revoke", async () => {
    const listing = { ...DEL_100, permissions: [...DEL_100.permissions, "delegation:revoke"] };
    const world = story([listing, DEL_101, DEL_102]);
    for (const envelope of [
      keyed(AGENT),
      { ...keyed(AGENT), mode: "propose_only" },
      { ...AGENT, mode: "validate_only" },
    ]) {
      expect(await tearUp(world, envelope)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    }
    expect(await statusOf(world)).toBe("active");
  });

  // U17: the roles that count are the caller's roles in this company.
  it("Step 25: a tenant administrator of another company is no tenant administrator here", async () => {
    const world = story();
    const elsewhere = {
      id: "user_125",
      type: "human",
      memberships: [
        { tenant_id: "org_456", roles: ["ap_supervisor"] },
        { tenant_id: "org_789", roles: ["tenant_admin"] },
      ],
    } as unknown as Principal;
    const answer = await withPlanted("tok_user_125", elsewhere, () =>
      tearUp(world, keyed({ token: "tok_user_125", tenant: "org_456" })),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: notYours("user_125", "del_100"),
    });
    expect(await statusOf(world)).toBe("active");
  });

  // U6, U7: a proposal that moved on before its cancel keeps its reservation, and is not counted.
  it("DSOR-DEL-06d: a waiting proposal that moved on before the tear-up's move keeps its reservation, and is not counted", async () => {
    let frozen = "";
    const world = story(undefined, {
      claimProposals: (kept) => ({
        ...kept,
        move: async (tenant, id, from, to, by) =>
          id === frozen ? false : kept.move(tenant, id, from, to, by),
      }),
    });
    frozen = await planted(world, "del_100", ["PENDING_APPROVAL"]);
    expect(await world.reservations.reserve("org_456", frozen, "del_100", AMOUNT, DAY)).toBe(true);
    expect(await tearUp(world)).toMatchObject({ data: { cancelled: 0 } });
    expect((await world.reservations.get("org_456", frozen))?.state).toBe("held");
  });
});
