// NEW IN STEP 14: every field has a sensitivity label. DSOR-CLS-01 in
// specs/dsor/02-security.md, section 19.1. The labels live in classifications.json, one
// entry for each kind of answer, and start-up checks the file (step 14's README, decision 1).
// What leaves DSoR for each caller is src/masking.ts.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { keysWrittenTwice } from "./json.ts";

/** How sensitive a field is. */
export type Label = "public" | "internal" | "confidential" | "restricted";

// The four labels, from the least sensitive to the most. The schema writes them in lower
// case (common.schema.json#/$defs/classification), and a test checks that they are its own.
/** The labels, lowest first. */
export const LABELS: readonly Label[] = ["public", "internal", "confidential", "restricted"];

// For each kind, each field's line, as the file writes it: a label, a label and a kind, or
// "Kind[]", a list whose every item is that kind (readLine below).
/** Every kind of answer, and what each of its fields holds. */
export type Kinds = ReadonlyMap<string, ReadonlyMap<string, string>>;

// Changed by the Stage 2 review: a field that holds an object names the kind of that object
// as well as its own label, so every key at every depth has a line (step 14's README,
// decision 1). Found by the Stage 2 review, and fixed from step 14 on.
/** What one line of the file says a field holds. */
export type Line =
  // "internal": text, a number, true, false, or null.
  | { holds: "value"; label: string }
  // "confidential Money": an object of that kind, with a label of its own for the whole.
  | { holds: "record"; label: string; kind: string }
  // "Invoice[]": a list whose every item is an object of that kind.
  | { holds: "list"; kind: string };

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
    // Each value is a label, a label and a kind the file has, or a list of a kind the file
    // has.
    const checked = new Map<string, string>();
    for (const [field, value] of Object.entries(fields)) {
      if (isLine(value, known)) {
        checked.set(field, value);
        continue;
      }
      const what =
        "which is not a label, a label and a kind the file has, or a list of a kind the file has";
      problems.push(`${file}: ${kind}.${field} is ${JSON.stringify(value)}, ${what}`);
    }
    kinds.set(kind, checked);
  }
  return { kinds, problems };
}

// DSOR-CLS-01. A field nobody labelled is confidential, never public, so a field added
// next year and forgotten in the file is hidden, not shown. A kind the file does not have
// is a kind nobody labelled. The maps are Maps, so "toString" finds nothing.
/** What the file says a field holds: its line. With no line for it, confidential. */
export function labelOf(kinds: Kinds, kind: string, field: string): string {
  return kinds.get(kind)?.get(field) ?? "confidential";
}

/** What a line says a field holds: a plain value, an object of a kind, or a list of one. */
export function readLine(line: string): Line {
  if (line.endsWith("[]")) return { holds: "list", kind: line.slice(0, -2) };
  const [label = "", kind, ...more] = line.split(" ");
  if (kind !== undefined && more.length === 0) return { holds: "record", label, kind };
  // Anything else is a label. Start-up lets only the four in, and rank() puts any other
  // text above them all.
  return { holds: "value", label: line };
}

// Where a label sits among the four: public 0, restricted 3. Start-up lets no other label
// in, and one that got in anyway would sit above them all, so it is never shown.
/** The label's place among the four, lowest first. */
export function rank(label: string): number {
  const at = (LABELS as readonly string[]).indexOf(label);
  return at === -1 ? LABELS.length : at;
}

/** True when the value is one of the four labels, written as the schema writes it. */
export function isLabel(value: unknown): value is Label {
  return typeof value === "string" && (LABELS as readonly string[]).includes(value);
}

// "internal", "confidential Money" when the file has the kind Money, or "Invoice[]" when it
// has the kind Invoice.
function isLine(value: unknown, known: ReadonlySet<string>): value is string {
  if (typeof value !== "string") return false;
  const line = readLine(value);
  if (line.holds === "list") return known.has(line.kind);
  if (line.holds === "record") return isLabel(line.label) && known.has(line.kind);
  return isLabel(line.label);
}

// A list and null are objects in JavaScript too. Neither one gives a field a label.
/** True for an object that is not a list and not null. */
export function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
