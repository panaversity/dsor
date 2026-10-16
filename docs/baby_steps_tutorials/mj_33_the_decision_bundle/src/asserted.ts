// NEW IN STEP 33: what the agent says about itself, in the request envelope's own field,
// agent_asserted: the skill it used, its rationale, its purpose, and its task (DSOR-AUD-06 in
// specs/dsor/03-execution.md, section 29; step 33's README, decisions D10 to D12). Line ① checks the
// shape, and nothing else: DSoR does not verify one word. The words go into the notebook of
// evidence and the record, and into no check (DSOR-AUD-07).
import { Refusal } from "./envelope.ts";
import type { Principal } from "./principals.ts";
import type { RequestEnvelope } from "./request.ts";

/** What the agent says about itself, as line ① checked it. */
export type AgentAsserted = {
  skill?: { uri: string; version: number; hash: string };
  rationale?: string;
  purpose?: string;
  task_id?: string;
};

// The four things §29 names, and nothing else, so the model's reasoning has no field to go into
// (DSOR-AUD-03b; D10).
const FIELDS: readonly string[] = ["skill", "rationale", "purpose", "task_id"];

// The longest text of each field, in UTF-16 units, as a request id's 128 is counted (step 05).
// not copied: the specification sets no bounds; these are this tutorial's own (step 33's README,
// decision D10).
const LONGEST: Readonly<Record<string, number>> = {
  rationale: 2000,
  purpose: 200,
  task_id: 128,
  uri: 512,
  hash: 200,
};

// copied from packages/spec/schemas/common.schema.json#/$defs/hash/pattern
const HASH = /^sha256:[A-Za-z0-9+\/=_\-]+$/;

// Control characters, a new line among them, which no text of agent_asserted may hold, as a request
// id may hold none (step 09's README, decision 16).
// not copied: this tutorial's own rule (step 33's README, decision D10).
const CONTROL = /\p{Cc}/u;

// The largest version the database's integer column holds, as for an invoice's (step 21's README,
// decision 10).
const LARGEST_VERSION = 2147483647;

/** Whether the value is text of 1 to the field's longest, well-formed, with no control character. */
function isText(value: unknown, field: string): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= LONGEST[field]! &&
    value.isWellFormed() &&
    !CONTROL.test(value)
  );
}

/** Refuses the field, naming it and the rule it breaks. The words are the agent's own: public. */
function refuse(field: string, rule: string): never {
  throw new Refusal("VALIDATION_FAILED", `agent_asserted.${field} must be ${rule}`, "public");
}

/** A plain object, not null and not a list. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The skill, checked: its uri, its version, and its hash, as §34.4 asks a runtime to report them. */
function checkedSkill(sent: unknown): AgentAsserted["skill"] {
  const rule = `{ uri, version, hash }: a uri of 1 to ${LONGEST.uri} characters, a version from 1, and a sha256: hash`;
  if (!isRecord(sent)) refuse("skill", rule);
  const { uri, version, hash, ...more } = sent;
  if (Object.keys(more).length > 0) refuse("skill", rule);
  if (!isText(uri, "uri")) refuse("skill", rule);
  if (!Number.isInteger(version) || (version as number) < 1) refuse("skill", rule);
  if ((version as number) > LARGEST_VERSION) refuse("skill", rule);
  if (!isText(hash, "hash") || !HASH.test(hash)) refuse("skill", rule);
  return { uri, version: version as number, hash };
}

/**
 * What the agent says about itself, read once from the envelope and checked, or none when it says
 * nothing. Only an agent's call may carry it. A copy, so nothing the caller holds can change it.
 */
export function checkedAssertion(
  request: RequestEnvelope,
  caller: Principal,
): AgentAsserted | undefined {
  // The envelope comes from outside the program, so it may even be null. Read once.
  const sent = request?.agent_asserted;
  if (sent === undefined) return undefined;
  if (!isRecord(sent)) {
    throw new Refusal("VALIDATION_FAILED", "agent_asserted must be an object", "public");
  }
  // A person's words have places of their own, such as a tear-up's reason (step 25). These are an
  //   agent's (D10).
  if (caller.type !== "agent") {
    const why = "only an agent's call may carry agent_asserted";
    throw new Refusal("VALIDATION_FAILED", why, "public");
  }
  const extra = Object.keys(sent).find((field) => !FIELDS.includes(field));
  if (extra !== undefined) {
    // The name is the agent's text, so only a short piece of it is shown.
    const allowed = "agent_asserted may carry only skill, rationale, purpose, and task_id";
    throw new Refusal(
      "VALIDATION_FAILED",
      `${allowed}, not ${JSON.stringify(extra.slice(0, 60))}`,
      "public",
    );
  }
  const { skill, rationale, purpose, task_id } = sent;
  const checked: AgentAsserted = {};
  if (skill !== undefined) checked.skill = checkedSkill(skill);
  for (const [field, value] of [
    ["rationale", rationale],
    ["purpose", purpose],
    ["task_id", task_id],
  ] as const) {
    if (value === undefined) continue;
    if (!isText(value, field)) {
      refuse(field, `text of 1 to ${LONGEST[field]} characters, well-formed, on one line`);
    }
    checked[field] = value;
  }
  return checked;
}
