// The emergency brake. A person who holds control:suspend suspends one agent of a
// company, or freezes every agent of it. While a brake is on, line ④ refuses each command from an
// agent it stops, in every mode, with AGENT_SUSPENDED. Its reads go on, and so do a person's
// calls. The same check runs again inside the claim's transaction, under the brake's lock, so a
// draft on its way never enters EXECUTING after the brake takes effect. Only a person who holds
// control:suspend lifts the brake (DSOR-OPS-01a to DSOR-OPS-01d in specs/dsor/02-security.md,
// section 18; step 25b's README, decisions L6 to L9 and D1 to D14).
// The program keeps the brakes in dsor.brakes (postgres.ts); the unit tests keep them in memory
// (memoryBrakes below).
import { randomUUID } from "node:crypto";
import { Refusal, type Correlation } from "./envelope.ts";
import { controlOf, type OperationalControl } from "./log.ts";
import { actsAsAgent, principalNamed, type Principal } from "./principals.ts";
import { preview, type Contract } from "./registry.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { parseUri } from "./uri.ts";

/** One pull of the brake: on one agent of a company, or on every agent of it, and its lift. */
export type Brake = {
  tenant: string;
  id: string;
  // The agent it stops. None: every agent of the company, a freeze.
  agent?: string;
  pulled_by: string;
  reason: string;
  lifted_by?: string;
  lift_reason?: string;
};

/** Who pulls or lifts a brake: the person, as of when, their own words, and their call. */
export type BrakeBy = { person: string; as_of: string; words: string; correlation: Correlation };

// One brake for each target: an agent, or the company, is braked or not. A second pull changes
// nothing, and one lift releases it. Every pull and lift stays in the history (step 25b's README,
// decision L9).
/** Where DSoR keeps its brakes. */
export type BrakeStore = {
  // Line ④: whether a brake is on for this agent in this company, its own or the company's.
  on: (tenant: string, agent: string) => Promise<boolean>;
  // The same question inside the claim's transaction. On the database it first takes the
  // brake's lock, shared, until the transaction ends: a pull meanwhile waits for this call, and
  // this call waits for a pull already under way (step 25b's README, decisions L8 and D8).
  holdOff: (tenant: string, agent: string) => Promise<boolean>;
  // Line ⑨'s look: the brake on one target that is on now. No agent: the company's freeze.
  get: (tenant: string, agent: string | undefined) => Promise<Brake | undefined>;
  // Pulls the brake on one agent, or on every agent when no agent is named, with its record,
  // both or neither. None when a brake is on already for that target.
  pull: (tenant: string, agent: string | undefined, by: BrakeBy) => Promise<Brake | undefined>;
  // Lifts the brake on one target, with its record, both or neither. None when no brake is on.
  lift: (tenant: string, agent: string | undefined, by: BrakeBy) => Promise<Brake | undefined>;
};

/** A store with no brake, and none to pull: every check says no brake is on. */
export const NO_BRAKES: BrakeStore = Object.freeze({
  on: async () => false,
  holdOff: async () => false,
  get: async () => undefined,
  pull: async (): Promise<never> => {
    throw new Error("this registry pulls no brake");
  },
  lift: async (): Promise<never> => {
    throw new Error("this registry lifts no brake");
  },
});

/** Brakes in memory, and the records of their pulls and lifts, which the tests read. */
export type MemoryBrakes = BrakeStore & {
  all: () => Promise<Brake[]>;
  records: () => Promise<OperationalControl[]>;
};

/** Brakes in memory, for the unit tests. Memory has no transactions, so holdOff holds nothing. */
export function memoryBrakes(): MemoryBrakes {
  const kept: Brake[] = [];
  const records: OperationalControl[] = [];
  const onFor = (tenant: string, agent: string | undefined): Brake | undefined =>
    kept.find((b) => b.tenant === tenant && b.agent === agent && b.lifted_by === undefined);
  const on = async (tenant: string, agent: string): Promise<boolean> =>
    onFor(tenant, agent) !== undefined || onFor(tenant, undefined) !== undefined;
  return Object.freeze({
    on,
    holdOff: on,
    get: async (tenant: string, agent: string | undefined) => {
      const brake = onFor(tenant, agent);
      return brake === undefined ? undefined : structuredClone(brake);
    },
    pull: async (tenant: string, agent: string | undefined, by: BrakeBy) => {
      if (onFor(tenant, agent) !== undefined) return undefined;
      const brake: Brake = {
        tenant,
        id: `brk_${randomUUID()}`,
        ...(agent === undefined ? {} : { agent }),
        pulled_by: by.person,
        reason: by.words,
      };
      kept.push(brake);
      records.push(controlOf(tenant, agent, agent === undefined ? "frozen" : "suspended", by));
      return structuredClone(brake);
    },
    lift: async (tenant: string, agent: string | undefined, by: BrakeBy) => {
      const brake = onFor(tenant, agent);
      if (brake === undefined) return undefined;
      brake.lifted_by = by.person;
      brake.lift_reason = by.words;
      records.push(controlOf(tenant, agent, "lifted", by));
      return structuredClone(brake);
    },
    all: async () => structuredClone(kept),
    records: async () => structuredClone(records),
  });
}

// Public: the words name only the caller and its own company. So every caller hears them in full,
// at line ④ and inside the claim, where a refusal is masked by the caller's clearance. Found
// while building: with the label internal, an agent of public clearance heard the brake's words
// at line ④, and a masked refusal inside the claim (step 25b's README, decision D7).
/** The refusal of a command from a braked agent. It names no person and no reason (decision D7). */
export function braked(agent: string, tenant: string): Refusal {
  const why = `${agent} may make no change in ${tenant}: an emergency brake is on`;
  return new Refusal("AGENT_SUSPENDED", why, "public");
}

// The brake stops what an agent changes, never what it reads, and never a person (§18: "One
// agent principal can make no state change"; step 25b's README, decisions L7 and D3).
/** True when a brake may stop this call: a command from a caller DSoR treats as an agent. */
function stoppable(caller: Principal, contract: Contract): boolean {
  return actsAsAgent(caller) && contract["kind"] === "command";
}

/** Line ④: refuses a command from an agent that a brake stops, in this company, now. */
export async function checkBrake(
  caller: Principal,
  contract: Contract,
  brakes: BrakeStore,
  tenant: string,
): Promise<void> {
  if (stoppable(caller, contract) && (await brakes.on(tenant, caller.id))) {
    throw braked(caller.id, tenant);
  }
}

/**
 * Line ④ again, inside the claim's transaction, right after line ⑧, under the brake's lock. A
 * draft that passed line ④ a moment before a brake waits here for the pull, then is refused
 * (DSOR-OPS-01c; step 25b's README, decisions L8 and D4).
 */
export async function holdBrake(
  caller: Principal,
  contract: Contract,
  brakes: BrakeStore,
  tenant: string,
): Promise<void> {
  if (stoppable(caller, contract) && (await brakes.holdOff(tenant, caller.id))) {
    throw braked(caller.id, tenant);
  }
}

// The target of a pull or a lift: an agent of the company, or the company itself, as a URI that
// line ⑥ checked, and the check of the URIs found in this company (step 25b's README, decision
// D2).
/** The agent a target names, or none when it names the company: every agent of it. */
function targetOf(input: unknown, tenant: string): string | undefined {
  const { entity, id } = parseUri((input as { target: string }).target);
  if (entity === "tenant") {
    if (id !== tenant) {
      throw new Refusal("RESOURCE_NOT_FOUND", `no company ${preview(id)} here`, "internal");
    }
    return undefined;
  }
  // Only an agent of this company can be braked: a person is never stopped by line ④.
  const principal = principalNamed(id);
  const member = principal?.memberships.some((m) => m.tenant_id === tenant) === true;
  if (principal === undefined || !actsAsAgent(principal) || !member) {
    // The caller's own words, cut to a length, as step 25's "no slip" is.
    const why = `no agent ${preview(id)} in ${tenant}`;
    throw new Refusal("RESOURCE_NOT_FOUND", why, "internal");
  }
  return id;
}

/** The words for a target in a refusal: one agent, or every agent of the company. */
function named(agent: string | undefined, tenant: string): string {
  return agent === undefined ? `every agent of ${tenant}` : agent;
}

/** The brake as the caller hears it: a row of its company, with its target and its state. */
function answerOf(brake: Brake, input: unknown, status: "on" | "lifted"): unknown {
  const { target } = input as { target: string };
  return { tenant_id: brake.tenant, id: brake.id, target, status };
}

/** Who pulls or lifts, from the change's own call. */
function byOf(input: unknown, work: OwnStores): BrakeBy {
  const { reason } = input as { reason: string };
  return { person: work.caller.id, as_of: work.now, words: reason, correlation: work.correlation };
}

/** Line ⑨, for a pull: the target is real, and no brake is on for it yet. */
async function mayPull(input: unknown, look: OwnLook): Promise<void> {
  const agent = targetOf(input, look.tenant);
  if ((await look.brakes.get(look.tenant, agent)) !== undefined) {
    const why = `the brake on ${named(agent, look.tenant)} is on already`;
    throw new Refusal("CONFLICT", why, "internal");
  }
}

/** The pull's work, after line ⑩: one change, with its record, that checks for a brake again. */
async function pull(input: unknown, work: OwnStores): Promise<unknown> {
  const agent = targetOf(input, work.tenant);
  const brake = await work.stores.brakes.pull(work.tenant, agent, byOf(input, work));
  if (brake === undefined) {
    const why = `the brake on ${named(agent, work.tenant)} is on already`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  return answerOf(brake, input, "on");
}

/** Line ⑨, for a lift: the target is real, and a brake is on for it. */
async function mayLift(input: unknown, look: OwnLook): Promise<void> {
  const agent = targetOf(input, look.tenant);
  if ((await look.brakes.get(look.tenant, agent)) === undefined) {
    const why = `no brake is on for ${named(agent, look.tenant)}`;
    throw new Refusal("CONFLICT", why, "internal");
  }
}

/** The lift's work, after line ⑩: one change, with its record, that checks the brake again. */
async function lift(input: unknown, work: OwnStores): Promise<unknown> {
  const agent = targetOf(input, work.tenant);
  const brake = await work.stores.brakes.lift(work.tenant, agent, byOf(input, work));
  if (brake === undefined) {
    const why = `no brake is on for ${named(agent, work.tenant)}`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  return answerOf(brake, input, "lifted");
}

/** The brake's two commands, as DSoR's own work. */
export function brakeWorkFor(): Record<string, OwnWork> {
  return {
    "control.suspend": { check: mayPull, change: pull },
    "control.lift": { check: mayLift, change: lift },
  };
}
