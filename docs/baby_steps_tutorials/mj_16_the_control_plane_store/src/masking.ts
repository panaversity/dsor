// What leaves DSoR for one caller. For an agent, every field above its
// clearance is left out, and the answer lists what was (DSOR-CLS-02a, DSOR-CLS-02b). Every
// answer carries its label (DSOR-CLS-03), and the rows it returns are named for its record
// (DSOR-CLS-05). specs/dsor/02-security.md, section 19.2. The labels are src/labels.ts.
import { Refusal } from "./envelope.ts";
import {
  LABELS,
  isLabel,
  isObject,
  labelOf,
  rank,
  readLine,
  type Kinds,
  type Label,
} from "./labels.ts";
import { PRINCIPAL_TYPES, actsAsAgent, type Principal } from "./principals.ts";
import { formatUri, type ResourceParts } from "./uri.ts";

// DSOR-CLS-02a is for agent principals. An agent with no clearance written down has the
// lowest, never a default that shows more (step 14's README, decision 2). So does a clearance
// that is not exactly one of the four labels, such as INTERNAL in capitals: rank() puts any
// other text above restricted, so it showed every field. Found by the Stage 2 review, and
// fixed from step 14 on.
/** The highest label this caller may see, or undefined for a caller whose answers are not masked. */
export function clearanceOf(principal: Principal): Label | undefined {
  // Only an agent is masked, and a type DSoR does not know acts as one: Agent in capitals
  // went unmasked. Found by a hostile pass on the Stage 2 review's fix, and fixed from step
  // 14 on (principals.ts, actsAsAgent).
  if (!actsAsAgent(principal)) return undefined;
  return isLabel(principal.clearance) ? principal.clearance : "public";
}

// Start-up refuses a clearance that is not one of the four labels, and a type that is not
// one of the four kinds of caller, beside the role check. So a misspelling is fixed in the
// table, not quietly read as public, or as a person (step 14's README, decisions 2 and 5).
// Found by the Stage 2 review, and fixed from step 14 on; the type by a hostile pass on
// that fix.
/** A problem for each principal whose clearance or type DSoR would not know how to mask. */
export function maskingProblems(principals: Iterable<Principal>): string[] {
  const problems: string[] = [];
  const types: readonly string[] = PRINCIPAL_TYPES;
  for (const { id, type, clearance } of principals) {
    const who = `principal ${JSON.stringify(id)}`;
    if (!types.includes(type)) {
      const what = "which is not one of the four kinds of caller";
      problems.push(`${who} has the type ${JSON.stringify(type)}, ${what}`);
    }
    if (clearance !== undefined && !isLabel(clearance)) {
      const what = "which is not one of the four labels";
      problems.push(`${who} has the clearance ${JSON.stringify(clearance)}, ${what}`);
    }
  }
  return problems;
}

// The message that replaces a refusal's own (step 14's README, decision 8).
const WITHHELD = "the operation refused the call, and its reason is above the caller's clearance";

// DSOR-CLS-02a, for a refusal that the operation's code throws at line ⑨. Its message is
// text that may hold company data. Above the caller's clearance, and for everyone when it
// is restricted, the message is replaced and the code kept, so no record holds a
// restricted message either. Added by the review (step 14's README, decision 8).
/** What the caller hears of something the operation's code threw. */
export function maskRefusal(thrown: unknown, clearance: Label | undefined): unknown {
  if (!(thrown instanceof Refusal)) return thrown;
  const { code, label } = thrown;
  const restricted = rank(label) >= rank("restricted");
  const above = clearance !== undefined && rank(label) > rank(clearance);
  return restricted || above ? new Refusal(code, WITHHELD, label) : thrown;
}

// The result envelope's shape for one withheld field. This step only leaves fields out,
// for the clearance (step 14's README, decisions 3 and 6).
/** One field that was withheld, why, and how. */
export type Redaction = { field: string; reason: "clearance"; treatment: "omitted" };

/** What leaves DSoR for one caller, its label, what was withheld, and the URIs it holds. */
export type Shown = {
  data: unknown;
  classification: Label;
  redactions: Redaction[];
  resources: string[];
};

// How a redaction names a key that classifications.json does not declare. The key is the
// code's own text, so it could carry a value or a URI to the agent. The placeholder carries
// nothing (step 14's README, decision 4). Found by the Stage 2 review, and fixed from step
// 14 on.
/** The name a redaction gives a key the file does not declare. */
export const UNLABELLED = "<unlabelled>";

// DSOR-CLS-02a. The answer is walked by the kind its contract names, field by field, at
// every depth. A field above the clearance is left out, never replaced (step 14's README,
// decision 3).
/** The answer, as this clearance may see it. With no clearance, nothing is left out. */
export function show(
  data: unknown,
  kind: string,
  kinds: Kinds,
  clearance: Label | undefined,
): Shown {
  // DSOR-CLS-02b. Each field left out, as a path, named once however many items lost it.
  const withheld = new Set<string>();
  // DSOR-CLS-03. The highest label among the fields the answer still holds, after
  // masking. An answer that holds no field, such as an empty page, is public (step 14's
  // README, what the specification asks, 4).
  let highest: Label = "public";
  // DSOR-CLS-05. The canonical URI of each row the answer returns.
  const resources: string[] = [];
  function holds(label: string): void {
    const at = Math.min(rank(label), LABELS.length - 1);
    if (at > rank(highest)) highest = LABELS[at]!;
  }
  function above(label: string): boolean {
    return clearance !== undefined && rank(label) > rank(clearance);
  }
  // A record of `kind`. `path` is where it sits: "" for the answer, "items[]." for a page's
  // items, "amount." inside an amount. `shown` is false inside a field the caller may not
  // see: that part is still checked, so a wrong shape is refused for everyone, and nothing
  // of it is kept, listed, labelled, or named. Changed by the Stage 2 review: every key at
  // every depth has a line (step 14's README, decision 3). Fixed from step 14 on.
  function record(value: unknown, kind: string, path: string, shown: boolean): unknown {
    // What is not a record has no fields to leave out and no row to name (step 14's
    // README, decision 3).
    if (!isObject(value)) return whole(value);
    // A row is a record of a kind that labels both tenant_id and id, with lists in it or
    // not: one invoice, not a page. Its URI is its company, its kind in lower case, and its
    // id. formatUri refuses a row with no id or no tenant_id, so an answer DSoR cannot
    // record is never sent, to anyone (step 14's README, decision 7). A row was a kind with
    // no list in it, so an invoice with lines was named nowhere. Found by the Stage 2
    // review, and fixed from step 14 on.
    if (isRow(kind)) {
      const { tenant_id, id } = value;
      const uri = formatUri({ tenant_id, id, entity: kind.toLowerCase() } as ResourceParts);
      if (shown) resources.push(uri);
    }
    const kept: { [field: string]: unknown } = {};
    for (const [field, inside] of Object.entries(value)) {
      const line = readLine(labelOf(kinds, kind, field));
      // A redaction names a field only by a name the file declares. Any other key is listed
      // as UNLABELLED, at its place (step 14's README, decision 4). Found by the Stage 2
      // review, and fixed from step 14 on.
      const at = path + (kinds.get(kind)?.has(field) ? field : UNLABELLED);
      if (line.holds === "list") {
        // A list carries no label of its own. Each item is a record of the list's kind.
        if (!Array.isArray(inside)) return whole(inside);
        const items = inside.map((item) => record(item, line.kind, `${at}[].`, shown));
        if (shown) keep(kept, field, items);
      } else if (line.holds === "record") {
        // An object of a kind the file declares, with a label of its own for the whole, such
        // as amount, a Money that is confidential (step 14's README, decision 1).
        const see = shown && !above(line.label);
        if (shown && !see) withheld.add(at);
        const inner = record(inside, line.kind, `${at}.`, see);
        if (see) {
          keep(kept, field, inner);
          holds(line.label);
        }
      } else {
        // A plain value: text, a number, true, false, or null. An object or a list here has
        // keys no line labels, so it is refused, for everyone. A key with no line is a plain
        // value too, confidential (DSOR-CLS-01). Found by the Stage 2 review, and fixed from
        // step 14 on.
        if (typeof inside === "object" && inside !== null) return whole(inside);
        if (!shown) continue;
        if (above(line.label)) withheld.add(at);
        else {
          keep(kept, field, inside);
          holds(line.label);
        }
      }
    }
    return kept;
  }
  // Something DSoR cannot walk field by field, and cannot name in the record. Nobody
  // gets it, a person too: their read would be recorded as reading nothing. Changed by
  // the review (step 14's README, decision 3). Since the Stage 2 review, that includes an
  // object or a list where the file declares a plain value.
  function whole(_value: unknown): never {
    // A throw, not a refusal: the operation's code returned what its contract does not
    // promise, a bug. The caller hears INTERNAL_ERROR, with a fixed message.
    throw new Error("the answer is not a record of its kind");
  }
  // Each field kept is a field of its own, even one named __proto__, which `kept[field] =`
  // would turn into the object's prototype and drop, after counting its label. Found by a
  // hostile pass on the Stage 2 review's fix, and fixed from step 14 on.
  function keep(kept: object, field: string, value: unknown): void {
    Object.defineProperty(kept, field, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  // A kind that labels both tenant_id and id.
  function isRow(kind: string): boolean {
    const fields = kinds.get(kind);
    return fields !== undefined && fields.has("tenant_id") && fields.has("id");
  }
  // The pipeline hands masking DSoR's own copy of the answer, the one checkAnswerInTenant
  // made and checked. So a getter was read once, a value cannot change after DSoR has
  // looked, and the record and the answer come from the same copy. What could run code
  // when DSoR reads it was refused when the copy was made (src/company.ts; step 14's
  // README, decision 3). Masking made a second copy of its own, with structuredClone.
  // Found by the Stage 2 review, and fixed from step 14 on: one copy, made once.
  const shown = record(data, kind, "", true);
  // In order of field, so the same answer always lists them the same way.
  const redactions = [...withheld]
    .sort()
    .map((field): Redaction => ({ field, reason: "clearance", treatment: "omitted" }));
  return { data: shown, classification: highest, redactions, resources };
}
