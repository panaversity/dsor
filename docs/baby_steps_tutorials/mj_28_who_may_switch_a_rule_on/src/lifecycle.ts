// NEW IN STEP 28: who may switch a rule on. Four commands of DSoR's own, for people only:
// rule.draft writes a new version of a rule, rule.activate switches one on, rule.suspend switches
// the active one off, and rule.retire ends one for good (DSOR-CTL-02a, DSOR-CTL-02b, and
// DSOR-CTL-02c in specs/dsor/02-security.md, section 17.4; step 28's README, decisions D7 to
// D13). Each has two parts, as DSoR's own work does (revocation.ts). The check is line ⑨'s look,
// before any work: who may, which version, its status, and, for a switch-on, the version's own
// checks and its tests. The change runs after line ⑩, inside the claim's transaction. It takes
// the rule's lock, reads the versions again, makes the same checks, and writes each change with
// its record (decisions D14 and D15).
import type { Control } from "./controls.ts";
import { Refusal } from "./envelope.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import type { Principal } from "./principals.ts";
import { preview } from "./registry.ts";
import type { Live, RuleBy, RuleStatus } from "./rulebook.ts";
import { parseUri } from "./uri.ts";

// The most a draft's text may hold, as JSON: a rule with its tests is a few kilobytes. A larger
// one would only fill the store, and the tests that each start-up runs (decision D11).
const MOST = 16_384;

/** The rule an input names: its id, from the address that line ⑥ checked. */
function ruleIdOf(input: unknown): string {
  return parseUri((input as { rule: string }).rule).id;
}

/** Who changes a rule, from the change's own call: the person, the time, their words, and the call. */
function byOf(input: unknown, work: OwnStores): RuleBy {
  const { reason } = input as { reason: string };
  return { person: work.caller.id, as_of: work.now, words: reason, correlation: work.correlation };
}

// The fields of a rule's text, which a draft gives. DSoR sets the other six itself. Line ⑥ refuses
// a draft that names another field, and DSoR keeps only these anyway. Found by step 28's own
// break of line ⑥: a draft that named a time it took effect counted as a version switched on
// before, and could make its own owner the rule's owner of record (decision D11).
const TEXT = [
  "operation",
  "condition",
  "effect",
  "authority",
  "owner",
  "on_stale",
  "stale_grace",
  "tests",
  "extensions",
];

/** The draft an input makes: the next version of the rule, its text, and who wrote it (decision D11). */
function draftOf(input: unknown, versions: readonly Control[], person: string): Control {
  const { draft } = input as { draft: Record<string, unknown> };
  const text = Object.fromEntries(TEXT.filter((f) => f in draft).map((f) => [f, draft[f]]));
  const next = versions.reduce((most, v) => Math.max(most, v.version), 0) + 1;
  const own = { id: ruleIdOf(input), version: next, status: "draft", compiled_by: person };
  return { ...text, ...own } as Control;
}

/** Line ⑨, for a draft: the draft's text passes the checks a version passes at start-up. */
async function mayDraft(input: unknown, look: OwnLook): Promise<void> {
  const { draft } = input as { draft: unknown };
  if (JSON.stringify(draft).length > MOST) {
    const why = `"rule.draft": a draft's text may hold at most ${MOST} characters as JSON`;
    throw new Refusal("VALIDATION_FAILED", why, "internal");
  }
  const versions = await look.controls.versions(look.tenant, ruleIdOf(input));
  const problems = look.checkRule(look.tenant, draftOf(input, versions, look.caller.id), false);
  if (problems.length > 0) {
    throw new Refusal("VALIDATION_FAILED", `"rule.draft": ${problems.join("; ")}`, "internal");
  }
}

/** The draft's work, after line ⑩: the next version, under the rule's lock, with its record. */
async function writeDraft(input: unknown, work: OwnStores): Promise<unknown> {
  const { tenant, caller, stores } = work;
  const versions = await stores.controls.hold(tenant, ruleIdOf(input));
  const draft = draftOf(input, versions, caller.id);
  await stores.controls.add(tenant, draft, byOf(input, work));
  return { tenant_id: tenant, id: draft.id, version: draft.version, status: "draft" };
}

/**
 * A rule's owner of record: the owner of its newest version that was ever switched on, or none
 * for a rule that never was. A version switched on keeps the time it took effect, and a draft
 * never names one (decision D10).
 */
export function ownerOfRecord(versions: readonly Control[]): string | undefined {
  let owner: string | undefined;
  for (const version of versions) {
    if (version.effective_from !== undefined) owner = version.owner;
  }
  return owner;
}

/** One move a command makes: its name, from which statuses, and to which. */
type Move = { name: string; from: readonly RuleStatus[]; to: RuleStatus };
const ACTIVATE: Move = { name: "rule.activate", from: ["draft", "suspended"], to: "active" };
// A suspended version can be switched on again. A retired one never comes back (decision D13).
const SUSPEND: Move = { name: "rule.suspend", from: ["active"], to: "suspended" };
const RETIRE: Move = { name: "rule.retire", from: ["draft", "active", "suspended"], to: "retired" };

/**
 * The version a move may change, after its checks, in this order: who, which version, and its
 * status. Who decides is the rule's owner of record, or, for a rule never switched on, the
 * version's own owner, in person: never an agent, whatever let it past line ⑤ (DSOR-CTL-02b).
 * A switch-on needs the version's own owner too, so a rule never passes to a new owner
 * (decision D10).
 */
function decide(
  move: Move,
  versions: readonly Control[],
  input: unknown,
  caller: Principal,
): Control {
  const id = ruleIdOf(input);
  const { version: number } = input as { version: number };
  const version = versions.find((v) => v.version === number);
  const decider = ownerOfRecord(versions) ?? version?.owner;
  // One answer for a rule that is not the caller's and for one that is not there, so the refusal
  // says nothing of which rules exist (DSOR-ERR-01b; decision D16).
  if (caller.type !== "human" || decider !== caller.id) {
    const why = `${caller.id} may not change rule ${preview(id)}: only its owner may, in person`;
    throw new Refusal("AUTHORIZATION_DENIED", `${JSON.stringify(move.name)}: ${why}`, "internal");
  }
  if (move.to === "active" && version !== undefined && version.owner !== caller.id) {
    const why = `version ${number} of rule ${id} names another owner, and only its own owner may switch it on`;
    throw new Refusal("AUTHORIZATION_DENIED", `${JSON.stringify(move.name)}: ${why}`, "internal");
  }
  if (version === undefined) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no version ${number} of rule ${id}`, "internal");
  }
  if (!move.from.includes(version.status as RuleStatus)) {
    const why = `version ${number} of rule ${id} is ${version.status}, so it cannot be ${move.to}`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  return version;
}

/** The refusal of a change whose version moved on between line ⑨ and the change (decision D15). */
function changedMeanwhile(id: string): Refusal {
  return new Refusal("CONFLICT", `rule ${id} changed while it was being changed`, "internal");
}

/** Line ⑨, for a switch-on: who, which version, its status, then its checks and its tests (DSOR-CTL-02c). */
async function mayActivate(input: unknown, look: OwnLook): Promise<void> {
  const versions = await look.controls.versions(look.tenant, ruleIdOf(input));
  const version = decide(ACTIVATE, versions, input, look.caller);
  const problems = look.checkRule(look.tenant, version, true);
  if (problems.length > 0) {
    throw new Refusal("VALIDATION_FAILED", `"rule.activate": ${problems.join("; ")}`, "internal");
  }
}

/**
 * The switch-on's work, after line ⑩: under the rule's lock, the same checks again, then the live
 * version retired and this one switched on, in one step of the store, each with its record. One
 * live version for each rule (step 28's README, decision D4). The tests ran at line ⑨: a
 * version's text never changes.
 */
async function activate(input: unknown, work: OwnStores): Promise<unknown> {
  const { tenant, caller, stores } = work;
  const id = ruleIdOf(input);
  const versions = await stores.controls.hold(tenant, id);
  const version = decide(ACTIVATE, versions, input, caller);
  const live = versions.find(
    (v) => v.version !== version.version && (v.status === "active" || v.status === "suspended"),
  );
  const retiring = live === undefined ? undefined : { version: live.version, from: live.status };
  const from = version.status as RuleStatus;
  // One step of the store: the live version retired and this one switched on, or neither. Found by
  // step 28's review, finding H1.
  const done = await stores.controls.switchOn(
    tenant,
    id,
    version.version,
    from,
    retiring as Live | undefined,
    byOf(input, work),
  );
  if (!done) throw changedMeanwhile(id);
  const retired = live === undefined ? {} : { retired: live.version };
  return { tenant_id: tenant, id, version: version.version, status: "active", ...retired };
}

/** Line ⑨, for a move that runs no test: who, which version, and its status. */
function mayMove(move: Move): OwnWork["check"] {
  return async (input, look) => {
    decide(move, await look.controls.versions(look.tenant, ruleIdOf(input)), input, look.caller);
  };
}

/** The work of a suspension or a retirement, after line ⑩: the same checks under the rule's lock, then the move, with its record. */
function moveWork(move: Move): OwnWork["change"] {
  return async (input, work) => {
    const { tenant, caller, stores } = work;
    const id = ruleIdOf(input);
    const version = decide(move, await stores.controls.hold(tenant, id), input, caller);
    const from = version.status as RuleStatus;
    const by = byOf(input, work);
    if (!(await stores.controls.move(tenant, id, version.version, from, move.to, by))) {
      throw changedMeanwhile(id);
    }
    return { tenant_id: tenant, id, version: version.version, status: move.to };
  };
}

/** The four commands of a rule's life, as DSoR's own work. */
export function ruleWorkFor(): Record<string, OwnWork> {
  return {
    "rule.draft": { check: mayDraft, change: writeDraft },
    "rule.activate": { check: mayActivate, change: activate },
    "rule.suspend": { check: mayMove(SUSPEND), change: moveWork(SUSPEND) },
    "rule.retire": { check: mayMove(RETIRE), change: moveWork(RETIRE) },
  };
}
