// NEW IN STEP 28: each company's rules, in DSoR's own store. The store keeps every version of every
// rule with its status: draft, active, suspended, or retired. Line ⑩ reads the active versions at
// every call, so a change applies to the next call. Only DSoR's own work writes here: rule.draft
// adds a version, and rule.activate, rule.suspend, and rule.retire move one (lifecycle.ts;
// DSOR-CTL-02a in specs/dsor/02-security.md, section 17.4; step 28's README, decisions D2 to D6).
// The program keeps the rules in dsor.controls (postgres.ts). The unit tests and the program's
// story keep them in memory (memoryControls below), filled from a controls file (decision D3).
import { readRules, type Control, type ControlsSource } from "./controls.ts";
import type { Correlation } from "./envelope.ts";
import { controlChangeOf, type ControlChange } from "./log.ts";
import type { MoneyPolicies } from "./policies.ts";

/** The statuses this step builds (step 28's README, decision D17). */
export type RuleStatus = "draft" | "active" | "suspended" | "retired";

// A live version is in force, or may come back: one at a time for each rule (decision D4).
const LIVE: ReadonlySet<string> = new Set(["active", "suspended"]);

/** Who changes a rule: the person, as of when, their own words, and their call. */
export type RuleBy = { person: string; as_of: string; words: string; correlation: Correlation };

/** Where DSoR keeps each company's rules. */
export type ControlStore = {
  // Where the rules are kept, as start-up names it in a problem: a file, or a table.
  where: string;
  // Line ⑩: the active versions of the company's rules on one operation, at every call.
  active: (tenant: string, operation: string) => Promise<Control[]>;
  // Line ⑨ and start-up: every version of one rule, or of every rule of the company, by id and
  // then by version. None when there are none.
  versions: (tenant: string, id?: string) => Promise<Control[]>;
  // The change, inside the claim's transaction: every version of one rule, read under the rule's
  // lock. The database holds the lock until the transaction ends, so two changes to one rule wait
  // for each other (decision D15). Memory has no transactions, so it holds nothing.
  hold: (tenant: string, id: string) => Promise<Control[]>;
  // rule.draft's work: adds one version, a draft, with its record, both or neither.
  add: (tenant: string, draft: Control, by: RuleBy) => Promise<void>;
  // The work of the other three: moves one version from one status to another, with its record,
  // both or neither. A version switched on names the person as its reviewer, and the time it took
  // effect. False when the version is not in that status, or when the picture of moves below draws
  // no such move.
  move: (
    tenant: string,
    id: string,
    version: number,
    from: RuleStatus,
    to: RuleStatus,
    by: RuleBy,
  ) => Promise<boolean>;
};

// The moves of a version, and no others. A draft is switched on or retired. An active version is
// suspended or retired. A suspended one is switched on again or retired. A retired one never
// moves, and nothing moves back to draft (step 28's README, decisions D12 and D13).
const MOVES: Readonly<Record<RuleStatus, readonly RuleStatus[]>> = {
  draft: ["active", "retired"],
  active: ["suspended", "retired"],
  suspended: ["active", "retired"],
  retired: [],
};

/** True when a version may move from this status to that one. */
export function movable(from: RuleStatus, to: RuleStatus): boolean {
  return MOVES[from]?.includes(to) === true;
}

/** A store with no rule, and none to keep: line ⑩ finds no rule (step 28's README, decision D18). */
export const NO_CONTROLS: ControlStore = Object.freeze({
  where: "no store",
  active: async () => [],
  versions: async () => [],
  hold: async () => [],
  add: async (): Promise<never> => {
    throw new Error("this world keeps no rules");
  },
  move: async (): Promise<never> => {
    throw new Error("this world keeps no rules");
  },
});

/** Rules in memory, the companies they belong to, and the records of their changes, which the tests read. */
export type MemoryControls = ControlStore & {
  companies: () => string[];
  records: () => Promise<ControlChange[]>;
};

/** By id, then by version, as the database orders them. */
function inOrder(a: Control, b: Control): number {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.version - b.version;
}

/**
 * Rules in memory, for the unit tests and the program's story, filled from a controls file. A
 * file that is not one stops start-up here. Start-up checks each control (checkRules below).
 */
export function memoryControls(source: ControlsSource): MemoryControls {
  const { rules, problems } = readRules(source);
  if (problems.length > 0) {
    throw new Error(`the rules refused to start:\n  ${problems.join("\n  ")}`);
  }
  const kept = new Map<string, Control[]>();
  for (const [tenant, list] of rules) kept.set(tenant, structuredClone(list) as Control[]);
  const records: ControlChange[] = [];
  // A read never adds a company. A write adds the company of its rule.
  const of = (tenant: string): Control[] => kept.get(tenant) ?? [];
  const into = (tenant: string): Control[] => {
    const list = of(tenant);
    kept.set(tenant, list);
    return list;
  };
  const versions = async (tenant: string, id?: string): Promise<Control[]> =>
    structuredClone(of(tenant).filter((c) => id === undefined || c.id === id)).sort(inOrder);
  return Object.freeze({
    where: source.file,
    active: async (tenant: string, operation: string) =>
      structuredClone(
        of(tenant).filter((c) => c.status === "active" && c.operation === operation),
      ).sort(inOrder),
    versions,
    hold: (tenant: string, id: string) => versions(tenant, id),
    add: async (tenant: string, draft: Control, by: RuleBy) => {
      // As the database refuses them: a version that is not a draft, and a version written twice.
      if (draft.status !== "draft") throw new Error("a version is added as a draft");
      if (of(tenant).some((c) => c.id === draft.id && c.version === draft.version)) {
        throw new Error(`version ${draft.version} of ${draft.id} is kept already`);
      }
      into(tenant).push(structuredClone(draft));
      records.push(controlChangeOf(tenant, draft.id, draft.version, undefined, "draft", by));
    },
    move: async (
      tenant: string,
      id: string,
      version: number,
      from: RuleStatus,
      to: RuleStatus,
      by: RuleBy,
    ) => {
      const found = of(tenant).find(
        (c) => c.id === id && c.version === version && c.status === from,
      );
      if (found === undefined || !movable(from, to)) return false;
      found.status = to;
      if (to === "active") {
        found.reviewed_by = by.person;
        found.effective_from = by.as_of;
      }
      records.push(controlChangeOf(tenant, id, version, from, to, by));
      return true;
    },
    companies: () => [...kept.keys()],
    records: async () => structuredClone(records),
  });
}

/** One control's check, as the registry runs it: its problems, each named, with its tests run when asked. */
export type RuleCheck = (tenant: string, raw: unknown, tests: boolean, place?: number) => string[];

/**
 * Start-up's check of a world's store: every version of each company's rules, with the tests of
 * each active one, one live version for each rule, and each version once. It names every problem,
 * with the place the rules are kept (step 28's README, decision D6).
 */
export async function checkRules(
  registry: { controls: ControlStore; checkRule: RuleCheck; moneyPolicies: MoneyPolicies },
  companies: Iterable<string>,
): Promise<string[]> {
  const { controls, checkRule } = registry;
  const problems: string[] = [];
  for (const tenant of companies) {
    // A test's rates count in the company's control currency, so a company needs its policy.
    if (registry.moneyPolicies.get(tenant) === undefined) {
      problems.push(
        `${controls.where}: ${tenant} has controls, and no money policy to count them in`,
      );
      continue;
    }
    const seen = new Set<string>();
    const live = new Set<string>();
    (await controls.versions(tenant)).forEach((control, index) => {
      // Switching a control on runs its tests (DSOR-CTL-02c): an active one has passed them.
      const found = checkRule(tenant, control, control.status === "active", index + 1);
      if (found.length > 0) {
        problems.push(...found.map((problem) => `${controls.where}: ${problem}`));
        return;
      }
      const key = JSON.stringify([control.id, control.version]);
      if (seen.has(key)) {
        const twice = `${tenant} has version ${control.version} of ${control.id} twice`;
        problems.push(`${controls.where}: ${twice}`);
        return;
      }
      seen.add(key);
      if (!LIVE.has(control.status)) return;
      if (live.has(control.id)) {
        const two = `${tenant} has two live versions of ${control.id}`;
        problems.push(`${controls.where}: ${two}: one at a time may be active or suspended`);
        return;
      }
      live.add(control.id);
    });
  }
  return problems;
}
