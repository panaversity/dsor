// NEW IN STEP 25c: a READY proposal can end (step 25c's README, claims C1 to C6). Since step 23, a
// call in propose_only mode leaves a prepared draft at READY, and nothing could end one. This step
// builds the learner's proposed change to §26.2: a tear-up cancels a READY proposal with the slip's
// other waiting work, and a READY proposal expires when its company's lifetime has passed, through
// DSoR's own sweep command, proposal.expire_due, which dsor-scheduler calls. The change is a
// proposal, not the specification as written (open question 90), so these tests are titled by
// the step, and by the rules of the specification that they also meet.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { memoryBrakes } from "../src/brakes.ts";
import { memoryClaims, type WorkStores } from "../src/claims.ts";
import type { Answer } from "../src/envelope.ts";
import { invoices, memoryInvoices } from "../src/invoice.ts";
import { checkLifetimes, readLifetimes, type LifetimesSource } from "../src/lifetimes.ts";
import { memoryReservations } from "../src/limits.ts";
import { createLog } from "../src/log.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { logins } from "../src/principals.ts";
import { canMove, memoryProposals, STATES, type ProposalDraft } from "../src/proposals.ts";
import { buildRegistry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import type { RoleTableSource } from "../src/permissions.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { memorySlips, type SlipStore } from "../src/slips.ts";
import {
  ADMIN,
  AGENT,
  DEL_100,
  DEL_101,
  DEL_102,
  keyed,
  refusal,
  rolesFile,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  STARTING_ROLES,
  storyDirectories,
  SUPERVISOR,
  USER_700,
} from "./helpers.ts";

// dsor-scheduler: a login of the specification's subject type "system", in both companies, whose
// role, scheduler, holds proposal:expire (step 25c's README, decision D1).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const SCHEDULER_789: RequestEnvelope = { token: "tok_5c4e", tenant: "org_789" };
const DAY_MS = 24 * 60 * 60 * 1000;
// Thursday 09:00 UTC. The world's clock starts here, and a test moves it on.
const T0 = Date.parse("2026-10-08T09:00:00.000Z");
const DRAFT_456 = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
const DRAFT_789 = { invoice: "dsor://org_789/invoice/INV-1008", expected_version: 1 };
const DEL_100_URI = "dsor://org_456/delegation/del_100";
const DAY = { value: "200000", currency: "USD" };
const AMOUNT = { value: "31400.00", currency: "USD" };

/** What a test may change in its world: the role table, del_100's permissions, and the slips. */
type Changes = {
  roles?: RoleTableSource;
  // More permissions on del_100, beside invoice:read and payment:create.
  permissions?: string[];
  // A store of slips around the memory one, which answers otherwise.
  slipsAs?: (slips: SlipStore) => SlipStore;
};

/** A world in memory with one clock: the story's slips, del_100 with step 24's limits. */
function world(lifetimes: LifetimesSource = readLifetimes(), changes: Changes = {}) {
  const clock = { now: T0 };
  const ledger = structuredClone(invoices);
  const store = memoryInvoices(ledger);
  const payments = memoryPayments([]);
  const proposals = memoryProposals(() => clock.now);
  const reservations = memoryReservations(() => clock.now);
  const limits = {
    per_transaction_limit: { value: "50000", currency: "USD" },
    cumulative_limits: [{ window: "P1D", amount: DAY }],
  };
  const permissions = [...DEL_100.permissions, ...(changes.permissions ?? [])];
  const kept = memorySlips([{ ...DEL_100, permissions, constraints: limits }, DEL_101, DEL_102]);
  const slips = changes.slipsAs?.(kept) ?? kept;
  const brakes = memoryBrakes();
  const registry = buildRegistry(
    shipped,
    handlersFor(),
    changes.roles ?? shippedRoles,
    shippedInputs,
    shippedLabels,
    store,
    payments,
    slips,
    storyDirectories(),
    readRoleSettings(),
    memoryClaims(store, payments, proposals, reservations, slips, brakes),
    ownWorkFor(),
    brakes,
    lifetimes,
  );
  const log = createLog();
  const ask = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
    call(registry, log, who, name, input);
  return { clock, proposals, reservations, ask, registry };
}
type World = ReturnType<typeof world>;

/** The proposal an answer names, by its id. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** The agent prepares a draft for INV-1008, which waits at READY and holds 31,400.00 USD. */
function prepare(w: World, who: RequestEnvelope = AGENT, input: unknown = DRAFT_456) {
  return w.ask({ ...keyed(who), mode: "propose_only" }, "payment.create", input);
}

/** A sweep of the caller's company, named by its URI, with a fresh key (decision D11). */
function sweep(w: World, who: RequestEnvelope = SCHEDULER): Promise<Answer> {
  return w.ask(keyed(who), "proposal.expire_due", companyOf(who));
}

/** The sweep's input: the company of the call, as a URI. */
function companyOf(who: RequestEnvelope): { company: string } {
  return { company: `dsor://${who.tenant}/tenant/${who.tenant}` };
}

/** One proposal's state now. */
async function stateOf(w: World, id: string, tenant = "org_456"): Promise<string | undefined> {
  return (await w.proposals.get(tenant, id))?.state;
}

/** The agent's draft under del_100, as line ⑧ would write it, written by the test. */
function draftOf(id: string, as_of: string): ProposalDraft {
  return {
    operation: "payment.create@1",
    mode: "execute",
    payload: DRAFT_456,
    payload_hash: `sha256:${"0".repeat(64)}`,
    resources: ["dsor://org_456/invoice/INV-1008"],
    requester: {
      identity_mode: "unattended",
      subject: "user_123",
      subject_type: "human",
      actor_chain: ["accounts-payable-fte"],
      active_tenant: "org_456",
      delegation: "del_100",
      subject_authority: { source: "role_source", as_of },
    },
    idempotency_key: `plant-${id}`,
  };
}

/** The test's own move: for user_123, whose slip the agent works under. */
function plantedBy(as_of: string) {
  return {
    mover: {
      mode: "unattended" as const,
      subject: "user_123",
      actor_chain: ["accounts-payable-fte"],
      subject_authority: { source: "role_source" as const, as_of },
    },
    cause: "planted by the test",
    correlation: { request_id: "req_planted" },
  };
}

/** A proposal of the agent's under del_100, planted by the test and moved along the picture, with
 * its booking. Approvals arrive in step 29, so no call reaches PENDING_APPROVAL or APPROVED yet. */
async function planted(w: World, path: ("PENDING_APPROVAL" | "APPROVED")[]): Promise<string> {
  const id = `prop_${randomUUID()}`;
  const as_of = new Date(w.clock.now).toISOString();
  const by = plantedBy(as_of);
  await w.proposals.create("org_456", id, draftOf(id, as_of), by, "P7D");
  let from: "PROPOSED" | "PENDING_APPROVAL" | "APPROVED" = "PROPOSED";
  for (const to of path) {
    expect(await w.proposals.move("org_456", id, from, to, by)).toBe(true);
    from = to;
  }
  expect(await w.reservations.reserve("org_456", id, "del_100", AMOUNT, DAY)).toBe(true);
  return id;
}

describe("C1: the picture", () => {
  it("Step 25c: a READY proposal may move to EXECUTING, CANCELLED, or EXPIRED, and to nothing else (step 25c's README, claim C1)", () => {
    const out = STATES.filter((to) => canMove("READY", to)).sort();
    expect(out).toStrictEqual(["CANCELLED", "EXECUTING", "EXPIRED"]);
  });

  it("DSOR-APR-01c: CANCELLED and EXPIRED stay final: nothing moves out of either", () => {
    expect(STATES.filter((to) => canMove("CANCELLED", to))).toStrictEqual([]);
    expect(STATES.filter((to) => canMove("EXPIRED", to))).toStrictEqual([]);
  });
});

describe("C2: a tear-up ends a READY proposal", () => {
  it("Step 25c: a tear-up cancels the slip's READY proposal with its waiting ones, gives each booking back, and counts all three (step 25c's README, claim C2)", async () => {
    const w = world();
    const p1 = await planted(w, ["PENDING_APPROVAL"]);
    const p2 = await planted(w, ["PENDING_APPROVAL", "APPROVED"]);
    const p3 = idOf(await prepare(w));
    expect(await stateOf(w, p3)).toBe("READY");
    expect((await w.reservations.get("org_456", p3))?.state).toBe("held");
    const torn = await w.ask(keyed(SUPERVISOR), "delegation.revoke", {
      slip: DEL_100_URI,
      reason: "VENDOR-44's bank details are in question",
    });
    expect(torn).toMatchObject({
      outcome: "COMMITTED",
      data: { id: "del_100", status: "revoked", cancelled: 3 },
    });
    for (const id of [p1, p2, p3]) {
      expect(await stateOf(w, id)).toBe("CANCELLED");
      expect((await w.reservations.get("org_456", id))?.state).toBe("released");
    }
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("0.00");
  });

  it("DSOR-APR-01b: the READY proposal's move to CANCELLED is recorded with the person who tore up the slip, and why", async () => {
    const w = world();
    const p3 = idOf(await prepare(w));
    await w.ask(keyed(SUPERVISOR), "delegation.revoke", { slip: DEL_100_URI, reason: "stop" });
    const last = (await w.proposals.get("org_456", p3))?.transitions.at(-1);
    expect(last).toMatchObject({
      from: "READY",
      to: "CANCELLED",
      actor: "user_123",
      cause: "slip del_100 was torn up",
    });
  });
});

describe("C3: each proposal's expiry", () => {
  it("Step 25c: a proposal's expires_at is its company's lifetime after created_at, by the store's clock: P7D in org_456 and P3D in org_789 (step 25c's README, claim C3)", async () => {
    const w = world();
    const here = await w.proposals.get("org_456", idOf(await prepare(w)));
    expect(here?.created_at).toBe("2026-10-08T09:00:00.000Z");
    expect(here?.expires_at).toBe("2026-10-15T09:00:00.000Z");
    const there = await prepare(w, USER_700, DRAFT_789);
    expect(there).toMatchObject({ outcome: "READY" });
    const kept = await w.proposals.get("org_789", idOf(there));
    expect(kept?.expires_at).toBe("2026-10-11T09:00:00.000Z");
  });

  it("Step 25c: a proposal made in execute mode gets an expires_at too, and leaves READY at once (step 25c's README, decision D5)", async () => {
    const w = world();
    const made = await w.ask(keyed(AGENT), "payment.create", DRAFT_456);
    const kept = await w.proposals.get("org_456", idOf(made));
    expect(kept).toMatchObject({ state: "COMMITTED", expires_at: "2026-10-15T09:00:00.000Z" });
  });

  // Found by the sweep of small breaks: K5, a memory store that took any lifetime, passed every
  // test, because start-up refuses such a lifetime first. The store refuses what the database's
  // CHECK refuses, so a test in memory cannot make a proposal that the database never could.
  it("Step 25c: the memory store refuses a lifetime that the database's CHECK refuses, zero and over 30 days, and takes P30D (step 25c's README, decision D6)", async () => {
    const store = memoryProposals(() => T0);
    const as_of = new Date(T0).toISOString();
    for (const lifetime of ["PT0S", "P31D"]) {
      const id = `prop_${randomUUID()}`;
      await expect(
        store.create("org_456", id, draftOf(id, as_of), plantedBy(as_of), lifetime),
      ).rejects.toThrow(`a lifetime of "${lifetime}" is not more than zero and at most 30 days`);
      expect(await store.get("org_456", id)).toBeUndefined();
    }
    const id = `prop_${randomUUID()}`;
    await store.create("org_456", id, draftOf(id, as_of), plantedBy(as_of), "P30D");
    expect((await store.get("org_456", id))?.expires_at).toBe("2026-11-07T09:00:00.000Z");
  });
});

describe("C4: the sweep", () => {
  it("Step 25c: after its lifetime, dsor-scheduler's sweep expires the READY proposal and gives its booking back; a newer READY one, a COMMITTED one, and another company's are left alone (step 25c's README, claim C4)", async () => {
    const w = world();
    const due = idOf(await prepare(w));
    const done = idOf(await w.ask(keyed(AGENT), "payment.create", DRAFT_456));
    const theirs = idOf(await prepare(w, USER_700, DRAFT_789));
    w.clock.now = T0 + 7 * DAY_MS;
    const fresh = idOf(await prepare(w));
    const swept = await sweep(w);
    expect(swept).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", expired: 1 },
      semantics: "atomic",
    });
    expect(await stateOf(w, due)).toBe("EXPIRED");
    expect(await stateOf(w, fresh)).toBe("READY");
    expect(await stateOf(w, done)).toBe("COMMITTED");
    // org_789's proposal was due three days ago, and org_456's sweep never touches it.
    expect(await stateOf(w, theirs, "org_789")).toBe("READY");
    expect((await w.reservations.get("org_456", due))?.state).toBe("released");
    expect((await w.reservations.get("org_456", fresh))?.state).toBe("held");
    expect((await w.reservations.get("org_456", done))?.state).toBe("committed");
  });

  it("DSOR-APR-01b: the move to EXPIRED is recorded with dsor-scheduler, the sweep's caller, and why (step 25c's README, decision D4)", async () => {
    const w = world();
    const due = idOf(await prepare(w));
    w.clock.now = T0 + 8 * DAY_MS;
    await sweep(w);
    const last = (await w.proposals.get("org_456", due))?.transitions.at(-1);
    expect(last).toMatchObject({
      from: "READY",
      to: "EXPIRED",
      actor: "dsor-scheduler",
      cause: "waited past its lifetime",
    });
  });

  it("Step 25c: a proposal is due at its expires_at, not one millisecond before (step 25c's README, claim C4)", async () => {
    const w = world();
    const id = idOf(await prepare(w));
    w.clock.now = T0 + 7 * DAY_MS - 1;
    expect(await sweep(w)).toMatchObject({ data: { expired: 0 } });
    expect(await stateOf(w, id)).toBe("READY");
    w.clock.now = T0 + 7 * DAY_MS;
    expect(await sweep(w)).toMatchObject({ data: { expired: 1 } });
    expect(await stateOf(w, id)).toBe("EXPIRED");
  });

  it("Step 25c: each company sweeps its own: org_789's sweep expires org_789's due proposal, and a second sweep finds nothing (step 25c's README, claim C4)", async () => {
    const w = world();
    const theirs = idOf(await prepare(w, USER_700, DRAFT_789));
    w.clock.now = T0 + 3 * DAY_MS;
    expect(await sweep(w, SCHEDULER_789)).toMatchObject({
      data: { tenant_id: "org_789", expired: 1 },
    });
    expect(await stateOf(w, theirs, "org_789")).toBe("EXPIRED");
    expect(await sweep(w, SCHEDULER_789)).toMatchObject({ data: { expired: 0 } });
  });

  it("DSOR-OPR-06: a dry run of the sweep answers VALIDATED, and expires nothing", async () => {
    const w = world();
    const due = idOf(await prepare(w));
    w.clock.now = T0 + 8 * DAY_MS;
    const dry = await w.ask(
      { ...SCHEDULER, mode: "validate_only" },
      "proposal.expire_due",
      companyOf(SCHEDULER),
    );
    expect(dry).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
    expect(await stateOf(w, due)).toBe("READY");
  });

  // Found by the sweep of small breaks: K4, a memory store whose list of due proposals held every
  // company's, passed every test. The sweep moved nothing of org_789's, because a move names its
  // company too. The list answers for its own company, as the database's WHERE does.
  it("Step 25c: the store lists only its own company's READY proposals whose time has come (step 25c's README, claim C4)", async () => {
    const w = world();
    const ours = idOf(await prepare(w));
    const theirs = idOf(await prepare(w, USER_700, DRAFT_789));
    w.clock.now = T0 + 8 * DAY_MS;
    expect(await w.proposals.due("org_456")).toStrictEqual([ours]);
    expect(await w.proposals.due("org_789")).toStrictEqual([theirs]);
  });

  // Found by the sweep of small breaks: K10, a sweep that counted and released a move that did not
  // happen, passed every test. That move fails only when a tear-up ends the proposal between the
  // sweep's list and its move, so the test gives the sweep stores where that has just happened.
  it("Step 25c: a due proposal that a tear-up ended a moment before is not counted, and its booking is not given back again (step 25c's README, decision D9)", async () => {
    const released: string[] = [];
    const stores = {
      proposals: { due: async () => ["prop_ended_a_moment_ago"], move: async () => false },
      reservations: {
        release: async (_tenant: string, id: string): Promise<void> => {
          released.push(id);
        },
      },
    } as unknown as WorkStores;
    const work = {
      tenant: "org_456",
      caller: logins.get("tok_5c4e")!,
      stores,
      correlation: { request_id: "req_race" },
      now: new Date(T0).toISOString(),
    };
    const expire = ownWorkFor()["proposal.expire_due"]!;
    expect(await expire.change(companyOf(SCHEDULER), work)).toStrictEqual({
      tenant_id: "org_456",
      expired: 0,
    });
    expect(released).toStrictEqual([]);
  });
});

describe("C4: the company the sweep names (step 25c's README, decision D11)", () => {
  it("Step 25c: the sweep must name the call's own company: org_789's URI is refused as foreign, and another id in org_456's URI is no company (step 25c's README, decision D11)", async () => {
    const w = world();
    const due = idOf(await prepare(w));
    w.clock.now = T0 + 8 * DAY_MS;
    const foreign = { company: "dsor://org_789/tenant/org_789" };
    expect(await w.ask(keyed(SCHEDULER), "proposal.expire_due", foreign)).toMatchObject({
      code: "TENANT_MISMATCH",
    });
    const other = { company: "dsor://org_456/tenant/org_789" };
    expect(await w.ask(keyed(SCHEDULER), "proposal.expire_due", other)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no company "org_789" here',
    });
    expect(await stateOf(w, due)).toBe("READY");
  });

  // Found by the sweep of small breaks: K23, an input that took a URI of any kind, passed every
  // test, because line ⑨ compares the id only.
  it("Step 25c: the sweep names a company's URI and nothing else: an invoice's URI is refused at line ⑥, and nothing expires (step 25c's README, decision D11)", async () => {
    const w = world();
    const due = idOf(await prepare(w));
    w.clock.now = T0 + 8 * DAY_MS;
    const invoice = { company: "dsor://org_456/invoice/INV-1008" };
    expect(await w.ask(keyed(SCHEDULER), "proposal.expire_due", invoice)).toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(await stateOf(w, due)).toBe("READY");
  });
});

describe("C5: who may sweep", () => {
  // Since the review, user_123 and the agent are refused first as no system login (decision D14).
  // The scheduler is then refused, as any caller is, without proposal:expire.
  it("Step 25c: only a system login holding proposal:expire sweeps: user_123 and the agent are refused at line ⑤, and so is dsor-scheduler when its role grants nothing, and nothing expires (step 25c's README, claim C5)", async () => {
    const w = world();
    const due = idOf(await prepare(w));
    w.clock.now = T0 + 8 * DAY_MS;
    for (const [who, id] of [
      [SUPERVISOR, "user_123"],
      [AGENT, "accounts-payable-fte"],
    ] as const) {
      expect(await sweep(w, who)).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `"proposal.expire_due" is for DSoR's own system logins only, and ${id} is not one`,
      });
    }
    expect(await stateOf(w, due)).toBe("READY");
    const bare = world(readLifetimes(), { roles: rolesFile({ ...STARTING_ROLES, scheduler: [] }) });
    expect(await sweep(bare)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"proposal.expire_due" needs proposal:expire, which the caller does not hold',
    });
  });

  it("Step 25c: a freeze of org_456 stops every agent, and not dsor-scheduler, which is no agent (step 25c's README, decision D1)", async () => {
    const w = world();
    const due = idOf(await prepare(w));
    const frozen = await w.ask(keyed(ADMIN), "control.suspend", {
      target: "dsor://org_456/tenant/org_456",
      reason: "every agent waits for the audit",
    });
    expect(frozen).toMatchObject({ outcome: "COMMITTED" });
    expect(await prepare(w)).toMatchObject({ code: "AGENT_SUSPENDED" });
    w.clock.now = T0 + 8 * DAY_MS;
    expect(await sweep(w)).toMatchObject({ data: { expired: 1 } });
    expect(await stateOf(w, due)).toBe("EXPIRED");
  });

  it("Step 25c: dsor-scheduler holds proposal:expire only: it may not draft, and may not tear up a slip, which is for people only (step 25c's README, decision D10)", async () => {
    const w = world();
    expect(await w.ask(keyed(SCHEDULER), "payment.create", DRAFT_456)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
    expect(
      await w.ask(keyed(SCHEDULER), "delegation.revoke", { slip: DEL_100_URI, reason: "no" }),
    ).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });
});

describe("C6: the lifetimes file, at start-up", () => {
  const problemsOf = (text: string): string[] =>
    checkLifetimes({ file: "ready-lifetimes.json", text }, logins.values()).problems;

  it("Step 25c: the shipped file gives org_456 P7D and org_789 P3D, and start-up takes it (step 25c's README, claim C6)", () => {
    const { lifetimes, problems } = checkLifetimes(readLifetimes(), logins.values());
    expect(problems).toStrictEqual([]);
    expect(Object.fromEntries(lifetimes)).toStrictEqual({
      org_456: { lifetime: "P7D", ms: 7 * DAY_MS },
      org_789: { lifetime: "P3D", ms: 3 * DAY_MS },
    });
  });

  it("Step 25c: start-up refuses a lifetime that is not a duration, is zero, or passes P30D, and a company with none (step 25c's README, claim C6)", () => {
    expect(problemsOf('{ "org_456": "7 days", "org_789": "P3D" }')).toStrictEqual([
      'ready-lifetimes.json: org_456\'s lifetime "7 days" is not a duration such as P7D',
    ]);
    expect(problemsOf('{ "org_456": "P0D", "org_789": "PT0S" }')).toStrictEqual([
      'ready-lifetimes.json: org_456\'s lifetime "P0D" is zero, so a READY proposal would expire as it is made',
      'ready-lifetimes.json: org_789\'s lifetime "PT0S" is zero, so a READY proposal would expire as it is made',
    ]);
    expect(problemsOf('{ "org_456": "P31D", "org_789": "PT721H" }')).toStrictEqual([
      'ready-lifetimes.json: org_456\'s lifetime "P31D" is over 30 days, the longest §44 lets an approval live at L2',
      'ready-lifetimes.json: org_789\'s lifetime "PT721H" is over 30 days, the longest §44 lets an approval live at L2',
    ]);
    expect(problemsOf('{ "org_456": "P7D" }')).toStrictEqual([
      "ready-lifetimes.json: org_789 has no lifetime, and a login works there",
    ]);
    expect(problemsOf('{ "org_456": "P30D", "org_789": "PT720H" }')).toStrictEqual([]);
  });

  // Found by the sweep of small breaks: K18, a pattern with no "^", passed every test here. The
  // spec guard compares the pattern with the specification's. This test refuses text on either
  // side of a duration too.
  it("Step 25c: start-up refuses a lifetime with text before or after its duration (step 25c's README, claim C6)", () => {
    expect(problemsOf('{ "org_456": "xP7D", "org_789": "P3Dx" }')).toStrictEqual([
      'ready-lifetimes.json: org_456\'s lifetime "xP7D" is not a duration such as P7D',
      'ready-lifetimes.json: org_789\'s lifetime "P3Dx" is not a duration such as P7D',
    ]);
  });

  it("Step 25c: start-up refuses a file that is not an object of companies, and a company id that is not one (step 25c's README, claim C6)", () => {
    expect(problemsOf("[]")).toStrictEqual([
      "ready-lifetimes.json: must be an object that gives each company its READY lifetime",
    ]);
    expect(problemsOf("not json")).toStrictEqual(["ready-lifetimes.json: not valid JSON"]);
    expect(problemsOf('{ "org_456": "P7D", "org_789": "P3D", "acme": "P1D" }')).toStrictEqual([
      'ready-lifetimes.json: "acme" is not a company id like org_456',
    ]);
    expect(problemsOf('{ "org_456": "P7D", "org_456": "P1D", "org_789": "P3D" }')).toStrictEqual([
      'ready-lifetimes.json: "org_456" is written twice in one object',
    ]);
  });

  it("Step 25c: a registry built with a broken lifetimes file refuses to start, and names the problem (step 25c's README, claim C6)", () => {
    const broken = { file: "ready-lifetimes.json", text: '{ "org_456": "P7D" }' };
    expect(refusal(() => world(broken))).toContain(
      "ready-lifetimes.json: org_789 has no lifetime, and a login works there",
    );
  });
});

describe("from step 25c's review", () => {
  // Finding H1. Line ③ reads the slip before the claim, and a tear-up between that read and the
  // claim went unseen, so a prepared draft reached READY under a torn-up slip. The check after
  // line ⑧ reads the slip again, inside the claim. Memory has no transactions, so here the store
  // answers as if the slip had changed between the two reads. The database tests race a real
  // tear-up (step 25c's README, decision D12).
  it.each([
    ["torn up", { status: "revoked" }, false, "DELEGATION_REVOKED", "was torn up"],
    ["past its date", {}, true, "DELEGATION_EXPIRED", "is past its date"],
    [
      "suspended",
      { status: "suspended" },
      false,
      "DELEGATION_REQUIRED",
      "is suspended, not active",
    ],
  ])(
    "Step 25c: a slip %s between line ③ and the claim refuses the draft after line ⑧, in execute and propose_only modes: its proposal ends DENIED, with no booking (step 25c's README, decision D12)",
    async (_what, change, past, code, words) => {
      const w = world(readLifetimes(), {
        slipsAs: (slips) => ({
          ...slips,
          hold: async (tenant: string, id: string) => {
            const found = await slips.hold(tenant, id);
            if (found === undefined) return undefined;
            return { slip: { ...(found.slip as object), ...change }, past };
          },
        }),
      });
      for (const mode of ["execute", "propose_only"] as const) {
        const answer = await w.ask({ ...keyed(AGENT), mode }, "payment.create", DRAFT_456);
        expect(answer).toMatchObject({ code, message: `"payment.create": slip del_100 ${words}` });
        expect(await stateOf(w, idOf(answer))).toBe("DENIED");
        expect(await w.reservations.get("org_456", idOf(answer))).toBeUndefined();
      }
    },
  );

  it("Step 25c: a slip gone between line ③ and the claim refuses the draft after line ⑧ (step 25c's README, decision D12)", async () => {
    const w = world(readLifetimes(), {
      slipsAs: (slips) => ({ ...slips, hold: async () => undefined }),
    });
    const answer = await w.ask(keyed(AGENT), "payment.create", DRAFT_456);
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message:
        '"payment.create" needs a slip: accounts-payable-fte holds no person\'s slip in org_456',
    });
    expect(await stateOf(w, idOf(answer))).toBe("DENIED");
  });

  // Found by the second sweep of small breaks (F11): with its check of the slip's company and id
  // gone, line ③ again took a slip of someone else, and every test stayed green. As at line ③,
  // DSoR does not trust its own store to keep a company.
  it.each([
    ["another company's", { tenant: "org_789" }],
    ["another id's", { id: "del_101" }],
  ])(
    "Step 25c: a store that answers line ③ again with %s slip fails the draft as a bug does, and books nothing (step 25c's README, decision D12)",
    async (_whose, other) => {
      const w = world(readLifetimes(), {
        slipsAs: (slips) => ({
          ...slips,
          hold: async (tenant: string, id: string) => {
            const found = await slips.hold(tenant, id);
            if (found === undefined) return undefined;
            return { slip: { ...(found.slip as object), ...other }, past: false };
          },
        }),
      });
      const answer = await w.ask(keyed(AGENT), "payment.create", DRAFT_456);
      expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
      expect(await w.reservations.all()).toStrictEqual([]);
    },
  );

  // Finding M2. With a role that grants proposal:expire, and a slip that lists it, an agent swept,
  // and its records said it called in its own name.
  it("Step 25c: the sweep is for DSoR's own system logins only: an agent whose slip and signer both allow proposal:expire is refused at line ⑤, and so is a person who holds it (step 25c's README, decision D14)", async () => {
    const supervisor = [...STARTING_ROLES["ap_supervisor"]!, "proposal:expire"];
    const roles = rolesFile({ ...STARTING_ROLES, ap_supervisor: supervisor });
    const w = world(readLifetimes(), { roles, permissions: ["proposal:expire"] });
    const due = idOf(await prepare(w));
    w.clock.now = T0 + 8 * DAY_MS;
    for (const [who, id] of [
      [AGENT, "accounts-payable-fte"],
      [SUPERVISOR, "user_123"],
    ] as const) {
      expect(await sweep(w, who)).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `"proposal.expire_due" is for DSoR's own system logins only, and ${id} is not one`,
      });
    }
    expect(await stateOf(w, due)).toBe("READY");
    expect(await sweep(w)).toMatchObject({ data: { expired: 1 } });
  });

  // Finding M3. A sweep's record with another mode, another authority, or another call's request
  // id passed every test.
  it("DSOR-APR-01b: the sweep's move is recorded in dsor-scheduler's own name, directly, by its token, at the time of the sweep's own call", async () => {
    const w = world();
    const due = idOf(await prepare(w));
    w.clock.now = T0 + 8 * DAY_MS;
    const before = Date.now();
    const swept = await sweep(w);
    const after = Date.now();
    const record = (await w.proposals.transitions()).find(
      (kept) => kept.resources[0] === `dsor://org_456/proposal/${due}` && kept.result === "EXPIRED",
    );
    expect(record).toMatchObject({
      identity: {
        mode: "direct",
        subject: "dsor-scheduler",
        actor_chain: [],
        subject_authority: { source: "token" },
      },
      correlation: { request_id: swept.correlation.request_id },
    });
    const asOf = Date.parse(String(record?.identity.subject_authority.as_of));
    expect(asOf >= before && asOf <= after).toBe(true);
  });

  // Finding L2. A timer that sends the same key every night hears the first night's answer again,
  // and nothing more expires. Each night's sweep needs a key of its own, such as its date.
  it("DSOR-IDM-01c: a sweep sent again with its first key, a week later, gives the first answer back and expires nothing more", async () => {
    const w = world();
    await prepare(w);
    w.clock.now = T0 + 8 * DAY_MS;
    const sameKey = keyed(SCHEDULER);
    const first = await w.ask(sameKey, "proposal.expire_due", companyOf(SCHEDULER));
    expect(first).toMatchObject({ data: { expired: 1 } });
    const next = idOf(await prepare(w));
    w.clock.now = T0 + 16 * DAY_MS;
    const again = await w.ask(sameKey, "proposal.expire_due", companyOf(SCHEDULER));
    expect(again).toMatchObject({ data: { expired: 1 } });
    expect(await stateOf(w, next)).toBe("READY");
    expect(await sweep(w)).toMatchObject({ data: { expired: 1 } });
    expect(await stateOf(w, next)).toBe("EXPIRED");
  });

  // Finding L3. A sweep in propose_only mode had no test and no decision.
  it("Step 25c: a prepared sweep expires nothing and waits at READY, and a sweep a week later expires it with the rest (step 25c's README, decision D15)", async () => {
    const w = world();
    const draft = idOf(await prepare(w));
    const prepared = await w.ask(
      { ...keyed(SCHEDULER), mode: "propose_only" },
      "proposal.expire_due",
      companyOf(SCHEDULER),
    );
    expect(prepared).toMatchObject({ outcome: "READY" });
    expect(await stateOf(w, draft)).toBe("READY");
    w.clock.now = T0 + 8 * DAY_MS;
    expect(await sweep(w)).toMatchObject({ data: { expired: 2 } });
    expect(await stateOf(w, idOf(prepared))).toBe("EXPIRED");
  });

  // R1. With the check of the type gone, a list ["P7D"] passed the duration's pattern, because a
  // regular expression reads a list as its text.
  it("Step 25c: start-up refuses a lifetime that is a list or a number, not a text (step 25c's README, claim C6)", () => {
    const problems = checkLifetimes(
      { file: "ready-lifetimes.json", text: '{ "org_456": ["P7D"], "org_789": 3 }' },
      logins.values(),
    ).problems;
    expect(problems).toStrictEqual([
      'ready-lifetimes.json: org_456\'s lifetime ["P7D"] is not a duration such as P7D',
      "ready-lifetimes.json: org_789's lifetime 3 is not a duration such as P7D",
    ]);
  });

  // R7, and the truth sweep. The memory store listed a slip's waiting work in the order it was
  // made, where the database lists it by id, and the README said both did.
  it("Step 25c: the store lists a slip's waiting work, and a company's due proposals, in the order of their ids", async () => {
    const clock = { now: T0 };
    const store = memoryProposals(() => clock.now);
    const as_of = new Date(T0).toISOString();
    const ids = [
      "prop_ffffffff-ffff-4fff-8fff-ffffffffffff",
      "prop_00000000-0000-4000-8000-000000000000",
    ];
    for (const id of ids) {
      await store.create("org_456", id, draftOf(id, as_of), plantedBy(as_of), "PT1S");
      expect(await store.move("org_456", id, "PROPOSED", "READY", plantedBy(as_of))).toBe(true);
    }
    const inOrder = [...ids].sort();
    const waiting = await store.waiting("org_456", "del_100");
    expect(waiting.map((kept) => kept.id)).toStrictEqual(inOrder);
    clock.now = T0 + 1000;
    expect(await store.due("org_456")).toStrictEqual(inOrder);
  });

  // R9. With "company" left out of the schema's required list, a sweep with no company failed
  // inside DSoR's own check, as a bug does.
  it("Step 25c: a sweep that names no company is refused at line ⑥ (step 25c's README, decision D11)", async () => {
    const w = world();
    expect(await w.ask(keyed(SCHEDULER), "proposal.expire_due", {})).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  // R12. Line ⑧ that gave a company with no lifetime 30 days passed every test, because start-up
  // never lets such a registry start. One built by hand still makes no proposal.
  it("Step 25c: a registry that holds no lifetime for the call's company makes no proposal: the call fails as a bug does (step 25c's README, claim C6)", async () => {
    const w = world();
    const bare = { ...w.registry, lifetimes: new Map() };
    const prepared = { ...keyed(AGENT), mode: "propose_only" as const };
    expect(await call(bare, createLog(), prepared, "payment.create", DRAFT_456)).toMatchObject({
      code: "INTERNAL_ERROR",
    });
    expect(await w.proposals.all()).toStrictEqual([]);
  });

  // R15. With the check of "people only" letting a system login through, only the scheduler's role
  // kept it from tearing up a slip or pulling the brake.
  it("Step 25c: dsor-scheduler is refused a tear-up and the brake as no person, even with a role that grants both (step 25c's README, decision D10)", async () => {
    const scheduler = ["proposal:expire", "delegation:revoke", "control:suspend"];
    const w = world(readLifetimes(), { roles: rolesFile({ ...STARTING_ROLES, scheduler }) });
    const tearUp = { slip: DEL_100_URI, reason: "the timer tries" };
    expect(await w.ask(keyed(SCHEDULER), "delegation.revoke", tearUp)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"delegation.revoke" is for people only, and dsor-scheduler is not a person',
    });
    const brake = {
      target: "dsor://org_456/agent/accounts-payable-fte",
      reason: "the timer tries",
    };
    expect(await w.ask(keyed(SCHEDULER), "control.suspend", brake)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"control.suspend" is for people only, and dsor-scheduler is not a person',
    });
  });
});
