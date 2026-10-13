// Each company's rules, in DSoR's own store. The store keeps every version of every
// rule with its status: draft, active, suspended, or retired. Line ⑩ reads the active versions at
// every call, so a change applies to the next call. Only DSoR's own work writes here: rule.draft
// adds a version, and rule.activate, rule.suspend, and rule.retire move one (lifecycle.ts;
// DSOR-CTL-02a in specs/dsor/02-security.md, section 17.4; step 28's README, decisions D2 to D6).
// NEW IN STEP 28b: and stale_authority, which only the sweep's mark gives, with the time of the
// mark and the version of the policy in force. A stale version is in force too, so line ⑩ reads
// it, with its mark, and the mark leaves the owner a notice (drift.ts; DSOR-CTL-03a and
// DSOR-CTL-03b; step 28b's README, decisions D5 to D7).
// The program keeps the rules in dsor.controls (postgres.ts). The unit tests and the program's
// story keep them in memory (memoryControls below), filled from a controls file (step 28's README,
// decision D3).
import { readRules, ruleName, type Control, type ControlsSource } from "./controls.ts";
import type { Correlation } from "./envelope.ts";
import { controlChangeOf, type ControlChange } from "./log.ts";
import type { MoneyPolicies } from "./policies.ts";

/** The statuses this step builds (step 28's README, decision D17). */
// NEW IN STEP 28b: and stale_authority (step 28b's README, decision D6).
export type RuleStatus = "draft" | "active" | "suspended" | "retired" | "stale_authority";

// A live version is in force, or may come back: one at a time for each rule (step 28's README,
// decision D4).
// NEW IN STEP 28b: a stale version is live too: it is in force (step 28b's README, decision D7).
const LIVE: ReadonlySet<string> = new Set(["active", "suspended", "stale_authority"]);

// NEW IN STEP 28b: the version line ⑩ evaluates: active, or stale.
const IN_FORCE: ReadonlySet<string> = new Set(["active", "stale_authority"]);

/** NEW IN STEP 28b: true for a live version: active, stale, or suspended, one at a time for each rule. */
export function isLive(status: string): boolean {
  return LIVE.has(status);
}

/** A version of a policy, as KSoR has it in force: its number and its fingerprint. */
export type PolicyInForce = { version: number; content_hash: string };

/** NEW IN STEP 28b: DSoR's mark on a stale version: when the sweep first marked it, and the version of its policy in force. */
export type StaleMark = { since: string; in_force: PolicyInForce };

// The mark is DSoR's, kept beside the rule's text and never in it: control.schema.json has no
// place for it, and a draft could otherwise write one (step 28b's README, decision D5).
/** NEW IN STEP 28b: a version in force, as line ⑩ reads it: its text, and the sweep's mark when it is stale. */
export type InForce = Control & { stale?: StaleMark };

/** NEW IN STEP 28b: a notice to a rule's owner, which DSoR keeps until a mailer sends it (step 28b's README, decision D5). */
export type Notice = {
  tenant_id: string;
  // The person it is for: the version's owner.
  to: string;
  rule: string;
  version: number;
  words: string;
  at: string;
  // The call that wrote it: the sweep's.
  correlation: Correlation;
};

/** Who changes a rule: the person, as of when, their own words, and their call. */
export type RuleBy = { person: string; as_of: string; words: string; correlation: Correlation };

/** The live version that a switch-on retires: its number, and the status it is in. */
export type Live = { version: number; from: RuleStatus };

/** Where DSoR keeps each company's rules. */
export type ControlStore = {
  // Where the rules are kept, as start-up names it in a problem: a file, or a table.
  where: string;
  // Line ⑩: the versions in force of the company's rules on one operation, at every call: the
  // active ones and the stale ones, each stale one with its mark, in one read.
  // NEW IN STEP 28b: in place of the active versions alone, and on every operation when none is
  // named, as the sweep reads them (step 28b's README, decision D7).
  inForce: (tenant: string, operation?: string) => Promise<InForce[]>;
  // Line ⑨ and start-up: every version of one rule, or of every rule of the company, by id and
  // then by version. None when there are none.
  versions: (tenant: string, id?: string) => Promise<Control[]>;
  // The change, inside the claim's transaction: every version of one rule, read under the rule's
  // lock. The database holds the lock until the transaction ends, so two changes to one rule wait
  // for each other (step 28's README, decision D15). Memory has no transactions, so it holds
  // nothing.
  hold: (tenant: string, id: string) => Promise<Control[]>;
  // rule.draft's work: adds one version, a draft, with its record, both or neither.
  add: (tenant: string, draft: Control, by: RuleBy) => Promise<void>;
  // The switch-on's work, in one step: the live version, when there is one, retired, and this
  // version switched on, naming the person as its reviewer and the time it took effect, each with
  // its record, all or none. False when the versions moved since the change read them: this one
  // left its status, or the live version is not the one named (step 28's README, decisions D4 and
  // D15). Found by step 28's review, finding H1: as two moves, in memory, a retirement at the same
  // moment left no live version, and a payment between the two moves met no rule.
  switchOn: (
    tenant: string,
    id: string,
    version: number,
    from: RuleStatus,
    live: Live | undefined,
    by: RuleBy,
  ) => Promise<boolean>;
  // The work of a suspension and a retirement: moves one version from one status to another, with
  // its record, both or neither. False when the version is not in that status, or when the picture
  // of moves below draws no such move.
  move: (
    tenant: string,
    id: string,
    version: number,
    from: RuleStatus,
    to: RuleStatus,
    by: RuleBy,
  ) => Promise<boolean>;
  // NEW IN STEP 28b: the sweep's mark, in one step: an active version moves to stale_authority,
  // or a stale one gets the policy's newer version in force, with its record and a notice to its
  // owner, all or none. The time of the first mark stays. False when the version is not as the
  // sweep saw it: active when it saw none, or stale with the mark it saw, and a policy that did
  // not move (step 28b's README, decisions D5 and D6).
  mark: (
    tenant: string,
    id: string,
    version: number,
    seen: StaleMark | undefined,
    in_force: PolicyInForce,
    by: RuleBy,
    words: string,
  ) => Promise<boolean>;
};

// The moves of a version, and no others. A draft is switched on or retired. An active version is
// suspended or retired. A suspended one is switched on again or retired. A retired one never
// moves, and nothing moves back to draft (step 28's README, decisions D12 and D13).
// NEW IN STEP 28b: a stale version is suspended or retired by its owner, and never switched on
// again. No move makes a version stale: only the sweep's mark does (step 28b's README, decision
// D6).
const MOVES: Readonly<Record<RuleStatus, readonly RuleStatus[]>> = {
  draft: ["active", "retired"],
  active: ["suspended", "retired"],
  suspended: ["active", "retired"],
  stale_authority: ["suspended", "retired"],
  retired: [],
};

/** True when a version may move from this status to that one. */
export function movable(from: RuleStatus, to: RuleStatus): boolean {
  return MOVES[from]?.includes(to) === true;
}

/** A store with no rule, and none to keep: line ⑩ finds no rule (step 28's README, decision D18). */
export const NO_CONTROLS: ControlStore = Object.freeze({
  where: "no store",
  inForce: async () => [],
  versions: async () => [],
  hold: async () => [],
  add: async (): Promise<never> => {
    throw new Error("this world keeps no rules");
  },
  switchOn: async (): Promise<never> => {
    throw new Error("this world keeps no rules");
  },
  move: async (): Promise<never> => {
    throw new Error("this world keeps no rules");
  },
  mark: async (): Promise<never> => {
    throw new Error("this world keeps no rules");
  },
});

/** Rules in memory, the companies they belong to, and the records of their changes, which the tests read. */
export type MemoryControls = ControlStore & {
  companies: () => string[];
  records: () => Promise<ControlChange[]>;
  // NEW IN STEP 28b: and the notices the sweep left.
  notices: () => Promise<Notice[]>;
};

/** NEW IN STEP 28b: true when two versions of a policy are one: the same number, and the same fingerprint. */
export function samePolicy(a: PolicyInForce, b: PolicyInForce): boolean {
  return a.version === b.version && a.content_hash === b.content_hash;
}

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
  // NEW IN STEP 28b: a file cannot hold DSoR's mark, the time and the version in force, so no
  // version in it is stale (step 28b's README, decision D14).
  for (const [tenant, list] of rules) {
    list.forEach((raw, index) => {
      if ((raw as { status?: unknown } | null)?.status !== "stale_authority") return;
      const name = ruleName(tenant, raw, index + 1);
      problems.push(
        `${source.file}: ${name} has the status stale_authority, which only DSoR's sweep gives`,
      );
    });
  }
  if (problems.length > 0) {
    throw new Error(`the rules refused to start:\n  ${problems.join("\n  ")}`);
  }
  const kept = new Map<string, Control[]>();
  for (const [tenant, list] of rules) kept.set(tenant, structuredClone(list) as Control[]);
  const records: ControlChange[] = [];
  // NEW IN STEP 28b: the sweep's marks, beside the versions, by company, rule, and version, and its
  // notices.
  const marks = new Map<string, StaleMark>();
  const keyOf = (tenant: string, id: string, version: number): string =>
    JSON.stringify([tenant, id, version]);
  const notices: Notice[] = [];
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
    // A stale version's mark rides with it, and only while it is stale.
    inForce: async (tenant: string, operation?: string): Promise<InForce[]> =>
      structuredClone(
        of(tenant)
          .filter((c) => IN_FORCE.has(c.status))
          .filter((c) => operation === undefined || c.operation === operation)
          .map((c): InForce => {
            if (c.status !== "stale_authority") return c;
            // A stale version always has its mark: only the mark makes one. Should one ever have
            // none, line ⑩ refuses, and never reads it as active. Found by step 28b's review,
            // finding L2.
            const mark = marks.get(keyOf(tenant, c.id, c.version));
            if (mark === undefined) throw new Error(`version ${c.version} of ${c.id} has no mark`);
            return { ...c, stale: mark };
          }),
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
    // One step, with no wait inside it: no other call runs between the checks and the changes.
    switchOn: async (
      tenant: string,
      id: string,
      version: number,
      from: RuleStatus,
      live: Live | undefined,
      by: RuleBy,
    ) => {
      const list = of(tenant);
      const target = list.find((c) => c.id === id && c.version === version && c.status === from);
      const others = list.filter((c) => c.id === id && c.version !== version && LIVE.has(c.status));
      const same =
        live === undefined
          ? others.length === 0
          : others.length === 1 &&
            others[0]!.version === live.version &&
            others[0]!.status === live.from;
      if (target === undefined || !same || !movable(from, "active")) return false;
      const [old] = others;
      if (old !== undefined && live !== undefined) {
        old.status = "retired";
        records.push(controlChangeOf(tenant, id, old.version, live.from, "retired", by));
      }
      target.status = "active";
      target.reviewed_by = by.person;
      target.effective_from = by.as_of;
      records.push(controlChangeOf(tenant, id, version, from, "active", by));
      return true;
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
    // One step, with no wait inside it, as the switch-on is.
    mark: async (
      tenant: string,
      id: string,
      version: number,
      seen: StaleMark | undefined,
      in_force: PolicyInForce,
      by: RuleBy,
      words: string,
    ) => {
      const found = of(tenant).find((c) => c.id === id && c.version === version);
      if (found === undefined) return false;
      const key = keyOf(tenant, id, version);
      const was = marks.get(key);
      // As the database compares: the status, and the version in force the sweep saw. The time of
      // the first mark is kept, never compared.
      const asSeen =
        seen === undefined
          ? found.status === "active"
          : found.status === "stale_authority" &&
            was !== undefined &&
            samePolicy(was.in_force, seen.in_force) &&
            !samePolicy(was.in_force, in_force);
      if (!asSeen) return false;
      const from = found.status as RuleStatus;
      found.status = "stale_authority";
      marks.set(key, { since: seen?.since ?? by.as_of, in_force: structuredClone(in_force) });
      records.push(controlChangeOf(tenant, id, version, from, "stale_authority", by, in_force));
      const notice = { tenant_id: tenant, to: found.owner, rule: id, version, words };
      notices.push({ ...notice, at: by.as_of, correlation: { ...by.correlation } });
      return true;
    },
    companies: () => [...kept.keys()],
    records: async () => structuredClone(records),
    notices: async () => structuredClone(notices),
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
      // NEW IN STEP 28b: and so has a stale one, which is in force too.
      const found = checkRule(tenant, control, IN_FORCE.has(control.status), index + 1);
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
        problems.push(
          `${controls.where}: ${two}: one at a time may be active, stale, or suspended`,
        );
        return;
      }
      live.add(control.id);
    });
  }
  return problems;
}
