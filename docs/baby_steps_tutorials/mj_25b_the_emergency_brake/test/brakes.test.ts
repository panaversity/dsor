// NEW IN STEP 25b: the emergency brake (DSOR-OPS-01a to DSOR-OPS-01d in
// specs/dsor/02-security.md, section 18). A person who holds control:suspend suspends one agent of
// a company, or freezes every agent of it. While a brake is on, line ④ refuses each command from
// an agent it stops, in every mode, with AGENT_SUSPENDED. Only such a person lifts it (step 25b's
// README, claims C1 to C3 and C5 to C9). The race, a draft on its way while the brake is pulled,
// is a property of a real database: test/brakes.db.test.ts.
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { memoryBrakes, type BrakeStore, type MemoryBrakes } from "../src/brakes.ts";
import { memoryClaims } from "../src/claims.ts";
import type { Answer } from "../src/envelope.ts";
import { invoices, memoryInvoices } from "../src/invoice.ts";
import { memoryReservations } from "../src/limits.ts";
import { createLog } from "../src/log.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import type { Principal } from "../src/principals.ts";
import { call } from "../src/pipeline.ts";
import { memoryProposals } from "../src/proposals.ts";
import { buildRegistry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { memorySlips } from "../src/slips.ts";
import {
  ADMIN,
  AGENT,
  CFO,
  DEL_100,
  DEL_101,
  DEL_102,
  FIRM_IN_456,
  FIRM_IN_789,
  keyed,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  storyDirectories,
  SUPERVISOR,
  USER_700,
  withPlanted,
  type StorySlip,
} from "./helpers.ts";

const AGENT_URI = "dsor://org_456/agent/accounts-payable-fte";
const COMPANY_URI = "dsor://org_456/tenant/org_456";
const WHY = "the agent drafts one payment after another";

/** The one refusal of a command from a braked agent. It names no person and no reason. */
function braked(agent: string, tenant = "org_456"): string {
  return `${agent} may make no change in ${tenant}: an emergency brake is on`;
}

/** A world in memory: the story's slips, its brakes, and a registry over them. */
function story(
  slips: readonly StorySlip[] = [DEL_100, DEL_101, DEL_102],
  // The brakes, when a test changes them.
  brakes: BrakeStore = memoryBrakes(),
) {
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
    // The claim's work pulls and lifts in the same store that line ④ reads.
    memoryClaims(store, payments, proposals, reservations, kept, brakes),
    ownWorkFor(),
    brakes,
  );
  return { rows, proposals, brakes: brakes as MemoryBrakes, registry, log: createLog() };
}
type World = ReturnType<typeof story>;

/** A person pulls the brake on a target, with a fresh key. */
function pull(
  world: World,
  envelope: RequestEnvelope = keyed(SUPERVISOR),
  target: string = AGENT_URI,
  lines?: number[],
): Promise<Answer> {
  return call(
    world.registry,
    world.log,
    envelope,
    "control.suspend",
    { target, reason: WHY },
    (n) => lines?.push(n),
  );
}

/** A person lifts the brake on a target, with a fresh key. */
function lift(
  world: World,
  envelope: RequestEnvelope = keyed(SUPERVISOR),
  target: string = AGENT_URI,
): Promise<Answer> {
  const reason = "the invoice was at fault, not the agent";
  return call(world.registry, world.log, envelope, "control.lift", { target, reason });
}

/** A caller drafts a payment for INV-1008 of its company, with a fresh key, or in the mode given. */
function draft(
  world: World,
  envelope: RequestEnvelope = keyed(AGENT),
  lines?: number[],
  // And code that runs as each line starts, for a test that acts in the middle of a call.
  onLine?: (n: number) => void,
) {
  const invoice = `dsor://${envelope.tenant}/invoice/INV-1008`;
  return call(
    world.registry,
    world.log,
    envelope,
    "payment.create",
    { invoice, expected_version: 1 },
    (n) => {
      lines?.push(n);
      onLine?.(n);
    },
  );
}

/** What the caller heard, in one word. */
function heard(answer: Answer): string {
  if ("code" in answer) return answer.code;
  return "outcome" in answer ? answer.outcome : "data";
}

/** Whether a brake stops this agent in this company now, as line ④ reads it. */
function stopped(world: World, agent = "accounts-payable-fte", tenant = "org_456") {
  return world.brakes.on(tenant, agent);
}

// The agent's slip, listing control:suspend too: the slip may list it, and it still grants
// nothing an agent may use here.
const LISTING = { ...DEL_100, permissions: [...DEL_100.permissions, "control:suspend"] };
const FIRM_LISTING = { ...DEL_101, permissions: [...DEL_101.permissions, "control:suspend"] };

describe("C1: a person suspends one agent", () => {
  it("DSOR-OPS-01a: user_123 suspends accounts-payable-fte in org_456: COMMITTED, and the brake is on", async () => {
    const world = story();
    const lines: number[] = [];
    const answer = await pull(world, keyed(SUPERVISOR), AGENT_URI, lines);
    expect(answer).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", target: AGENT_URI, status: "on" },
      semantics: "atomic",
    });
    expect("data" in answer && String((answer.data as { id: string }).id)).toMatch(
      /^brk_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // The whole checklist of a command, as for any other, line ④ too.
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(await stopped(world)).toBe(true);
  });

  it("DSOR-OPS-01a: while the brake is on, line ④ refuses each command from the agent with AGENT_SUSPENDED, in every mode, and nothing is written", async () => {
    const world = story();
    expect(heard(await pull(world))).toBe("COMMITTED");
    const before = (await world.proposals.all()).length;
    for (const envelope of [
      keyed(AGENT),
      { ...keyed(AGENT), mode: "propose_only" },
      { ...AGENT, mode: "validate_only" },
    ]) {
      const lines: number[] = [];
      expect(await draft(world, envelope, lines)).toMatchObject({
        code: "AGENT_SUSPENDED",
        message: braked("accounts-payable-fte"),
        retry: "never",
      });
      expect(lines).toStrictEqual([1, 2, 3, 4, 11]);
    }
    expect(world.rows).toHaveLength(0);
    // Refused before line ⑧, so no proposal either.
    expect(await world.proposals.all()).toHaveLength(before);
    const last = (await world.log.records()).at(-1);
    expect([last?.authorization, last?.result]).toStrictEqual(["DENY", "AGENT_SUSPENDED"]);
  });

  it("Step 25b: a braked agent still reads, because §18 stops a change of state", async () => {
    const world = story();
    expect(heard(await pull(world))).toBe("COMMITTED");
    const lines: number[] = [];
    const read = await call(
      world.registry,
      world.log,
      AGENT,
      "invoice.get",
      { invoice: "dsor://org_456/invoice/INV-1008" },
      (n) => lines.push(n),
    );
    expect(read).toMatchObject({ data: { id: "INV-1008" } });
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 9, 11]);
  });

  it("DSOR-OPS-01a: the brake on one agent stops no person, and no other agent", async () => {
    const world = story();
    expect(heard(await pull(world))).toBe("COMMITTED");
    expect(heard(await draft(world, keyed(SUPERVISOR)))).toBe("COMMITTED");
    expect(heard(await draft(world, keyed(FIRM_IN_456)))).toBe("COMMITTED");
    expect(await stopped(world, "firm-ap-fte")).toBe(false);
  });
});

describe("C2: a person freezes every agent of the company", () => {
  it("DSOR-OPS-01a: user_123 freezes org_456: every agent of org_456 is refused, firm-ap-fte too, and in org_789 firm-ap-fte still works", async () => {
    const world = story();
    expect(await pull(world, keyed(SUPERVISOR), COMPANY_URI)).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", target: COMPANY_URI, status: "on" },
    });
    expect(await draft(world)).toMatchObject({
      code: "AGENT_SUSPENDED",
      message: braked("accounts-payable-fte"),
    });
    expect(await draft(world, keyed(FIRM_IN_456))).toMatchObject({
      code: "AGENT_SUSPENDED",
      message: braked("firm-ap-fte"),
    });
    expect(heard(await draft(world, keyed(FIRM_IN_789)))).toBe("COMMITTED");
    expect(heard(await draft(world, keyed(SUPERVISOR)))).toBe("COMMITTED");
  });

  it("DSOR-OPS-01a: user_700 freezes org_789 only: org_456's agents go on", async () => {
    const world = story();
    const ours = "dsor://org_789/tenant/org_789";
    expect(heard(await pull(world, keyed(USER_700), ours))).toBe("COMMITTED");
    expect(heard(await draft(world, keyed(FIRM_IN_789)))).toBe("AGENT_SUSPENDED");
    expect(heard(await draft(world, keyed(FIRM_IN_456)))).toBe("COMMITTED");
    expect(heard(await draft(world))).toBe("COMMITTED");
  });
});

describe("C3: the brake and its lift reach the next decision", () => {
  it("DSOR-OPS-01b: line ④ reads the store at every call: the next draft after the pull is refused, and the next after the lift is made", async () => {
    const world = story();
    expect(heard(await draft(world))).toBe("COMMITTED");
    expect(heard(await pull(world))).toBe("COMMITTED");
    expect(heard(await draft(world))).toBe("AGENT_SUSPENDED");
    expect(await lift(world)).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", target: AGENT_URI, status: "lifted" },
    });
    expect(heard(await draft(world))).toBe("COMMITTED");
    expect(world.rows).toHaveLength(2);
  });
});

describe("C5, C6: only a person who holds control:suspend pulls or lifts", () => {
  it("DSOR-OPS-01d: user_123 and admin_100 lift a brake", async () => {
    const world = story();
    expect(heard(await pull(world))).toBe("COMMITTED");
    expect(heard(await lift(world, keyed(SUPERVISOR)))).toBe("COMMITTED");
    expect(heard(await pull(world, keyed(ADMIN)))).toBe("COMMITTED");
    expect(heard(await lift(world, keyed(ADMIN)))).toBe("COMMITTED");
    expect(await stopped(world)).toBe(false);
  });

  it("DSOR-OPS-01d: the braked agent's own lift is refused at line ④, as each of its commands is, and the brake stays on", async () => {
    const world = story([LISTING, DEL_101, DEL_102]);
    expect(heard(await pull(world))).toBe("COMMITTED");
    expect(await lift(world, keyed(AGENT))).toMatchObject({
      code: "AGENT_SUSPENDED",
      message: braked("accounts-payable-fte"),
    });
    expect(await stopped(world)).toBe(true);
  });

  it("DSOR-OPS-01d: another agent cannot lift the brake in any mode, even when its slip lists control:suspend: line ⑤ refuses it", async () => {
    const world = story([DEL_100, FIRM_LISTING, DEL_102]);
    expect(heard(await pull(world))).toBe("COMMITTED");
    for (const envelope of [
      keyed(FIRM_IN_456),
      { ...keyed(FIRM_IN_456), mode: "propose_only" },
      { ...FIRM_IN_456, mode: "validate_only" },
    ]) {
      expect(await lift(world, envelope)).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: '"control.lift" is for people only, and firm-ap-fte is not a person',
      });
    }
    expect(await stopped(world)).toBe(true);
  });

  it("DSOR-OPS-01d: the CFO, who holds no control:suspend, cannot lift the brake, and neither can an application that holds tenant_admin", async () => {
    const world = story();
    expect(heard(await pull(world))).toBe("COMMITTED");
    expect(await lift(world, keyed(CFO))).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"control.lift" needs control:suspend, which the caller does not hold',
    });
    const application = {
      id: "ops-console",
      type: "application",
      memberships: [{ tenant_id: "org_456", roles: ["tenant_admin"] }],
    } as unknown as Principal;
    const answer = await withPlanted("tok_ops", application, () =>
      lift(world, keyed({ token: "tok_ops", tenant: "org_456" })),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"control.lift" is for people only, and ops-console is not a person',
    });
    expect(await stopped(world)).toBe(true);
  });

  it("Step 25b: only the same people pull the brake: an agent, the CFO, and an application are refused at line ⑤ (step 25b's README, decision L6)", async () => {
    const world = story([LISTING, FIRM_LISTING, DEL_102]);
    expect(await pull(world, keyed(FIRM_IN_456))).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"control.suspend" is for people only, and firm-ap-fte is not a person',
    });
    expect(await pull(world, keyed(AGENT), "dsor://org_456/agent/firm-ap-fte")).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"control.suspend" is for people only, and accounts-payable-fte is not a person',
    });
    expect(await pull(world, keyed(CFO))).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"control.suspend" needs control:suspend, which the caller does not hold',
    });
    // And an application that holds tenant_admin. Found by step 25b's review: the title said so,
    // and the test did not.
    const application = {
      id: "ops-console",
      type: "application",
      memberships: [{ tenant_id: "org_456", roles: ["tenant_admin"] }],
    } as unknown as Principal;
    const fromApp = await withPlanted("tok_ops", application, () =>
      pull(world, keyed({ token: "tok_ops", tenant: "org_456" })),
    );
    expect(fromApp).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"control.suspend" is for people only, and ops-console is not a person',
    });
    expect(await stopped(world)).toBe(false);
  });
});

describe("C7: one brake for each target", () => {
  it("Step 25b: a second pull of the same brake gives CONFLICT at line ⑨, and its proposal ends DENIED (step 25b's README, decision L9)", async () => {
    const world = story();
    expect(heard(await pull(world))).toBe("COMMITTED");
    const lines: number[] = [];
    const again = await pull(world, keyed(ADMIN), AGENT_URI, lines);
    expect(again).toMatchObject({
      code: "CONFLICT",
      message: "the brake on accounts-payable-fte is on already",
    });
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
    const id = String("proposal" in again ? again.proposal : "")
      .split("/")
      .at(-1)!;
    expect((await world.proposals.get("org_456", id))?.state).toBe("DENIED");
    expect(await world.brakes.all()).toHaveLength(1);
  });

  it("Step 25b: a lift with no brake on gives CONFLICT at line ⑨, its proposal DENIED, for an agent and for the company", async () => {
    const world = story();
    const none = await lift(world);
    expect(none).toMatchObject({
      code: "CONFLICT",
      message: "no brake is on for accounts-payable-fte",
    });
    // A "no" before any work, from line ⑨: the change would say the same words, after the work
    // began. Found by step 25b's sweep (K18).
    const id = String("proposal" in none ? none.proposal : "")
      .split("/")
      .at(-1)!;
    expect((await world.proposals.get("org_456", id))?.state).toBe("DENIED");
    const record = (await world.log.records()).at(-1);
    expect([record?.authorization, record?.result]).toStrictEqual(["DENY", "CONFLICT"]);
    expect(await lift(world, keyed(SUPERVISOR), COMPANY_URI)).toMatchObject({
      code: "CONFLICT",
      message: "no brake is on for every agent of org_456",
    });
  });

  it("Step 25b: an agent's own brake and the company's freeze are two brakes: lifting the freeze leaves the agent's own brake on", async () => {
    const world = story();
    expect(heard(await pull(world))).toBe("COMMITTED");
    expect(heard(await pull(world, keyed(SUPERVISOR), COMPANY_URI))).toBe("COMMITTED");
    expect(heard(await lift(world, keyed(SUPERVISOR), COMPANY_URI))).toBe("COMMITTED");
    expect(heard(await draft(world))).toBe("AGENT_SUSPENDED");
    expect(heard(await draft(world, keyed(FIRM_IN_456)))).toBe("COMMITTED");
  });

  it("Step 25b: every pull and every lift stays in the history", async () => {
    const world = story();
    for (const step of [pull, lift, pull]) expect(heard(await step(world))).toBe("COMMITTED");
    const all = await world.brakes.all();
    expect(all.map((brake) => brake.lifted_by ?? "on")).toStrictEqual(["user_123", "on"]);
  });
});

describe("C8: each pull and each lift is a command, and leaves its records", () => {
  it("DSOR-AUD-01: a pull, a freeze, and a lift each leave one operational_control record: the person, their words, the call, and the target", async () => {
    const world = story();
    const pulled = await pull(world);
    const frozen = await pull(world, keyed(ADMIN), COMPANY_URI);
    const lifted = await lift(world);
    const records = await world.brakes.records();
    expect(records).toMatchObject([
      {
        kind: "operational_control",
        result: "suspended",
        reason: WHY,
        tenant: "org_456",
        resources: [AGENT_URI],
        correlation: pulled.correlation,
        identity: { mode: "direct", subject: "user_123", subject_authority: { source: "token" } },
      },
      { result: "frozen", resources: [COMPANY_URI], identity: { subject: "admin_100" } },
      {
        result: "lifted",
        reason: "the invoice was at fault, not the agent",
        resources: [AGENT_URI],
        correlation: lifted.correlation,
      },
    ]);
    expect(frozen.correlation).not.toStrictEqual(pulled.correlation);
  });

  it("DSOR-AUD-01: the pull's decision record names the brake's URI", async () => {
    const world = story();
    const answer = await pull(world);
    const id = "data" in answer ? (answer.data as { id: string }).id : "";
    const record = (await world.log.records()).at(-1);
    expect(record).toMatchObject({
      operation: "control.suspend@1",
      authorization: "ALLOW",
      result: "ok",
    });
    expect(JSON.stringify(record)).toContain(`dsor://org_456/brake/${id}`);
  });
});

describe("C9: the target is this company, or an agent of it", () => {
  it("DSOR-SRC-02b: a target in another company is refused at the URI check, and no brake is pulled", async () => {
    const world = story();
    const foreign = "dsor://org_789/agent/firm-ap-fte";
    expect(heard(await pull(world, keyed(SUPERVISOR), foreign))).toBe("TENANT_MISMATCH");
    expect(await stopped(world, "firm-ap-fte", "org_789")).toBe(false);
  });

  it("Step 25b: an agent DSoR does not know in this company, or a person, is no agent, and a company URI must name this company (step 25b's README, decision D2)", async () => {
    const world = story();
    expect(await pull(world, keyed(SUPERVISOR), "dsor://org_456/agent/nobody-fte")).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no agent "nobody-fte" in org_456',
    });
    expect(await pull(world, keyed(SUPERVISOR), "dsor://org_456/agent/cfo_100")).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no agent "cfo_100" in org_456',
    });
    expect(await pull(world, keyed(SUPERVISOR), "dsor://org_456/tenant/org_4567")).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no company "org_4567" here',
    });
    expect(await world.brakes.all()).toHaveLength(0);
  });

  it("Step 25b: an agent of another company only is no agent here", async () => {
    const world = story();
    const elsewhere = {
      id: "other-fte",
      type: "agent",
      memberships: [{ tenant_id: "org_789", roles: [] }],
    } as unknown as Principal;
    const answer = await withPlanted("tok_other", elsewhere, () =>
      pull(world, keyed(SUPERVISOR), "dsor://org_456/agent/other-fte"),
    );
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("Step 25b: the input names an agent or a company, never another kind of record", async () => {
    const world = story();
    const answer = await pull(world, keyed(SUPERVISOR), "dsor://org_456/invoice/INV-1008");
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("decision D7: the brake's words", () => {
  // Found while building: with the label internal, an agent of public clearance heard the brake's
  // words at line ④, and a masked refusal from the check inside the claim.
  it("Step 25b: an agent of any clearance hears the brake's words in full, at line ④ and inside the claim (step 25b's README, decision D7)", async () => {
    const plain = {
      id: "public-fte",
      type: "agent",
      clearance: "public",
      memberships: [{ tenant_id: "org_456", roles: [] }],
    } as unknown as Principal;
    const slip = { ...DEL_100, id: "del_195", delegate: "public-fte" };
    const AS_PLAIN = { token: "tok_plain", tenant: "org_456" };
    // Line ④ finds the brake.
    const atFour = story([DEL_100, slip]);
    expect(heard(await pull(atFour, keyed(SUPERVISOR), "dsor://org_456/tenant/org_456"))).toBe(
      "COMMITTED",
    );
    // Line ④ finds none, and the check inside the claim finds one, as when a pull commits in
    // between.
    const racing = { ...memoryBrakes(), on: async () => false, holdOff: async () => true };
    const inside = story([DEL_100, slip], racing);
    for (const world of [atFour, inside]) {
      const answer = await withPlanted("tok_plain", plain, () => draft(world, keyed(AS_PLAIN)));
      expect(answer).toMatchObject({ code: "AGENT_SUSPENDED", message: braked("public-fte") });
    }
  });
});

describe("from step 25b's sweep", () => {
  // K6: the brake stopped the exact type "agent" only, and every unit test stayed green.
  it("Step 25b: a caller of a type DSoR does not know acts as an agent, so the brake stops it too (step 25b's README, decision D3)", async () => {
    const odd = {
      id: "odd-fte",
      type: "Agent",
      memberships: [{ tenant_id: "org_456", roles: [] }],
    } as unknown as Principal;
    const slip = { ...DEL_100, id: "del_196", delegate: "odd-fte" };
    const world = story([DEL_100, slip]);
    const AS_ODD = { token: "tok_odd", tenant: "org_456" };
    const answer = await withPlanted("tok_odd", odd, async () => {
      expect(heard(await pull(world, keyed(SUPERVISOR), "dsor://org_456/agent/odd-fte"))).toBe(
        "COMMITTED",
      );
      return draft(world, keyed(AS_ODD));
    });
    expect(answer).toMatchObject({ code: "AGENT_SUSPENDED", message: braked("odd-fte") });
  });
});

describe("from step 25b's review", () => {
  // L3: the memory store's second check was never reached, so a store that never found a brake
  // there passed every test. Here the brake is pulled while the draft is at line ⑤: line ④ has
  // passed, and the check after line ⑧ must find it.
  it("DSOR-OPS-01c: a brake pulled while a draft is past line ④ is found by the check after line ⑧: AGENT_SUSPENDED, its proposal DENIED", async () => {
    const world = story();
    const lines: number[] = [];
    const by = {
      person: "user_123",
      as_of: new Date().toISOString(),
      words: WHY,
      correlation: { request_id: "req_test" },
    };
    const answer = await draft(world, keyed(AGENT), lines, (line) => {
      if (line === 5) void world.brakes.pull("org_456", "accounts-payable-fte", by);
    });
    expect(answer).toMatchObject({
      code: "AGENT_SUSPENDED",
      message: braked("accounts-payable-fte"),
    });
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 11]);
    const id = String("proposal" in answer ? answer.proposal : "")
      .split("/")
      .at(-1)!;
    expect((await world.proposals.get("org_456", id))?.state).toBe("DENIED");
    expect(world.rows).toHaveLength(0);
  });

  // L4: no test gave a reason past its limit.
  it("Step 25b: a reason of more than 200 characters is refused at line ⑥, and no brake is pulled", async () => {
    const world = story();
    const answer = await call(world.registry, world.log, keyed(SUPERVISOR), "control.suspend", {
      target: AGENT_URI,
      reason: "x".repeat(201),
    });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await world.brakes.all()).toHaveLength(0);
  });

  // L2: a dry run of the brake's own commands hears the real call's answer, from line ⑨.
  it("DSOR-OPR-05: a person's dry run of a second pull, and of a lift with no brake on, hears the real call's CONFLICT", async () => {
    const world = story();
    const dry = { ...SUPERVISOR, mode: "validate_only" };
    expect(await lift(world, dry)).toMatchObject({
      code: "CONFLICT",
      message: "no brake is on for accounts-payable-fte",
    });
    expect(heard(await pull(world))).toBe("COMMITTED");
    expect(await pull(world, dry)).toMatchObject({
      code: "CONFLICT",
      message: "the brake on accounts-payable-fte is on already",
    });
    expect(heard(await lift(world, dry))).toBe("VALIDATED");
    expect(await stopped(world)).toBe(true);
  });
});
