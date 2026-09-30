// NEW IN STEP 14: every field has a sensitivity label. DSOR-CLS-01 in
// specs/dsor/02-security.md, section 19.1. The labels live in classifications.json, one
// entry for each kind of answer, and start-up checks the file (step 14's README, decision 1).
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { keysWrittenTwice } from "./json.ts";
import type { Principal } from "./principals.ts";
import { formatUri, type ResourceParts } from "./uri.ts";

/** How sensitive a field is. */
export type Label = "public" | "internal" | "confidential" | "restricted";

// The four labels, from the least sensitive to the most. The schema writes them in lower
// case (common.schema.json#/$defs/classification), and a test checks that they are its own.
/** The labels, lowest first. */
export const LABELS: readonly Label[] = ["public", "internal", "confidential", "restricted"];

// For each kind, each field's label, or "Kind[]": a list whose every item is that kind.
/** Every kind of answer, and what each of its fields holds. */
export type Kinds = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The classifications file, as it was read from disk: its file name and its text. */
export type ClassificationSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../classifications.json", import.meta.url));

/** Reads the classifications file: this step's own, unless another is named. */
export function readClassifications(path: string = SHIPPED): ClassificationSource {
  return { file: basename(path), text: readFileSync(path, "utf8") };
}

/** Checks the classifications file, and names every problem. */
export function checkClassifications(source: ClassificationSource): {
  kinds: Kinds;
  problems: string[];
} {
  const { file, text } = source;
  const kinds = new Map<string, ReadonlyMap<string, string>>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { kinds, problems: [`${file}: not valid JSON`] };
  }
  if (!isObject(data)) {
    const problem = `${file}: must be an object that gives each kind its fields' labels`;
    return { kinds, problems: [problem] };
  }
  // JSON.parse keeps the last of two values for one key, and says nothing. A second
  // "amount" line could quietly make amount public (step 06's lesson, for roles.json).
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  // Every kind is known first, so a list may name a kind written after it.
  const table = data;
  const known = new Set(Object.keys(table).filter((kind) => isObject(table[kind])));
  for (const [kind, fields] of Object.entries(table)) {
    if (!isObject(fields)) {
      const what = "must be an object that gives each field a label";
      problems.push(`${file}: the kind ${JSON.stringify(kind)} ${what}`);
      continue;
    }
    // Each value is a label, or a list of a kind the file has.
    const checked = new Map<string, string>();
    for (const [field, value] of Object.entries(fields)) {
      if (isLabel(value) || isListOfKnownKind(value, known)) {
        checked.set(field, value);
        continue;
      }
      const what = "which is neither a label nor a list of a kind the file has";
      problems.push(`${file}: ${kind}.${field} is ${JSON.stringify(value)}, ${what}`);
    }
    kinds.set(kind, checked);
  }
  return { kinds, problems };
}

// DSOR-CLS-01. A field nobody labelled is confidential, never public, so a field added
// next year and forgotten in the file is hidden, not shown. A kind the file does not have
// is a kind nobody labelled. The maps are Maps, so "toString" finds nothing.
/** What the file says a field holds: its label, or "Kind[]". With no line for it, confidential. */
export function labelOf(kinds: Kinds, kind: string, field: string): string {
  return kinds.get(kind)?.get(field) ?? "confidential";
}

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
  const shown = record(data, kind, "");
  // In order of field, so the same answer always lists them the same way.
  const redactions = [...withheld].sort().map(
    (field): Redaction => ({ field, reason: "clearance", treatment: "omitted" }),
  );
  return { data: shown, classification: highest, redactions, resources };

  // A kind none of whose fields is a list.
  function isRow(kind: string): boolean {
    return ![...(kinds.get(kind)?.values() ?? [])].some((value) => value.endsWith("[]"));
  }
}

// Where a label sits among the four: public 0, restricted 3. Start-up lets no other label
// in, and one that got in anyway would sit above them all, so it is never shown.
function rank(label: string): number {
  const at = (LABELS as readonly string[]).indexOf(label);
  return at === -1 ? LABELS.length : at;
}

/** True when the value is one of the four labels, written as the schema writes it. */
export function isLabel(value: unknown): value is Label {
  return typeof value === "string" && (LABELS as readonly string[]).includes(value);
}

// "Invoice[]", when the file has the kind Invoice.
function isListOfKnownKind(value: unknown, known: ReadonlySet<string>): value is string {
  return typeof value === "string" && value.endsWith("[]") && known.has(value.slice(0, -2));
}

// A list and null are objects in JavaScript too. Neither one gives a field a label.
function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
