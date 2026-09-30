// NEW IN STEP 14: what leaves DSoR for one caller. For an agent, every field above its
// clearance is left out, and the answer lists what was (DSOR-CLS-02a, DSOR-CLS-02b). Every
// answer carries its label (DSOR-CLS-03), and the rows it returns are named for its record
// (DSOR-CLS-05). specs/dsor/02-security.md, section 19.2. The labels are src/labels.ts.
import { LABELS, isObject, labelOf, rank, type Kinds, type Label } from "./labels.ts";
import type { Principal } from "./principals.ts";
import { formatUri, type ResourceParts } from "./uri.ts";

// DSOR-CLS-02a is for agent principals. An agent with no clearance written down has the
// lowest, never a default that shows more (step 14's README, decision 2).
/** The highest label this caller may see, or undefined for a caller whose answers are not masked. */
export function clearanceOf(principal: Principal): Label | undefined {
  return principal.type === "agent" ? (principal.clearance ?? "public") : undefined;
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

// DSOR-CLS-02a. The answer is walked by the kind its contract names, field by field. A
// field above the clearance is left out, never replaced (step 14's README, decision 3).
// The answer is copied, never changed, so nothing withheld stays reachable in it.
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
  // A record of `kind`: each field kept, left out, or walked as a list. `path` is where
  // the record sits: "" for the answer, "items[]." for a page's items.
  function record(value: unknown, kind: string, path: string): unknown {
    // What is not a record has no fields to leave out. An agent gets none of it, and a
    // person gets it whole (step 14's README, decision 3).
    if (!isObject(value)) return whole(value);
    // A row is a record of a kind with no list in it: one invoice, not a page. Its URI is
    // its company, its kind in lower case, and its id. formatUri refuses a row with no id
    // or no tenant_id, so an answer DSoR cannot record is never sent, to anyone (step 14's
    // README, decision 7).
    if (isRow(kind)) {
      const { tenant_id, id } = value;
      resources.push(formatUri({ tenant_id, id, entity: kind.toLowerCase() } as ResourceParts));
    }
    const kept: { [field: string]: unknown } = {};
    for (const [field, inside] of Object.entries(value)) {
      const label = labelOf(kinds, kind, field);
      if (label.endsWith("[]")) {
        const itemKind = label.slice(0, -2);
        kept[field] = Array.isArray(inside)
          ? inside.map((item) => record(item, itemKind, `${path}${field}[].`))
          : whole(inside);
      } else if (clearance === undefined || rank(label) <= rank(clearance)) {
        kept[field] = inside;
        holds(label);
      } else {
        withheld.add(`${path}${field}`);
      }
    }
    return kept;
  }
  // Something DSoR cannot walk field by field.
  function whole(value: unknown): unknown {
    // A throw, not a refusal: the operation's code returned what its contract does not
    // promise, a bug. The caller hears INTERNAL_ERROR, with a fixed message.
    if (clearance !== undefined) throw new Error("the answer is not a record of its kind");
    // Nothing in it has a label, so it is confidential (DSOR-CLS-01).
    holds("confidential");
    return value;
  }
  // A kind none of whose fields is a list.
  function isRow(kind: string): boolean {
    return ![...(kinds.get(kind)?.values() ?? [])].some((value) => value.endsWith("[]"));
  }
  const shown = record(data, kind, "");
  // In order of field, so the same answer always lists them the same way.
  const redactions = [...withheld]
    .sort()
    .map((field): Redaction => ({ field, reason: "clearance", treatment: "omitted" }));
  return { data: shown, classification: highest, redactions, resources };
}
