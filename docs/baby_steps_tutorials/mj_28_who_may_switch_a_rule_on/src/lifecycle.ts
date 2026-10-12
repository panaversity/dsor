// NEW IN STEP 28: who may switch a rule on. Commands of DSoR's own, for people only: rule.draft
// writes a new version of a rule (DSOR-CTL-02a and DSOR-CTL-02b in specs/dsor/02-security.md,
// section 17.4; step 28's README, decisions D7 to D11). Each has two parts, as DSoR's own work
// does (revocation.ts). The check is line ⑨'s look, before any work. The change runs after line
// ⑩, inside the claim's transaction. It takes the rule's lock, reads the versions again, and
// writes, with the record (decisions D14 and D15).
import type { Control } from "./controls.ts";
import { Refusal } from "./envelope.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import type { RuleBy } from "./rulebook.ts";
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

/** The commands of a rule's life, as DSoR's own work. */
export function ruleWorkFor(): Record<string, OwnWork> {
  return {
    "rule.draft": { check: mayDraft, change: writeDraft },
  };
}
