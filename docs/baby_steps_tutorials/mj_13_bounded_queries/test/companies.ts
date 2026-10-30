// Where the cross-tenant suite finds a company inside a request or an
// answer, and changes it. Not a test file itself: test/cross-tenant.ts uses it. Split from
// that file when it passed 300 lines.
import { invoices } from "../src/invoice.ts";

/** One URI of the company in an example, and the three requests that swap it. */
export type Swap = { uri: string; requests: unknown[] };

// The suite works in org_456, the company of the running story, then in org_789. From each
// it reaches for the other, and for org_999, which does not exist (step 12's README,
// decisions 3 and 9).
export const HOMES: readonly string[] = ["org_456", "org_789"];
const OTHER: Readonly<Record<string, string>> = { org_456: "org_789", org_789: "org_456" };
const STRANGER = "org_999";
// The examples are written in org_456. For org_789, their URIs are moved there.
export const WRITTEN_IN = "org_456";

/** A row of a company's data: it names its company and its id, and may hold anything else. */
type Row = { readonly tenant_id: string; readonly id: string };

// The rows each company holds, by kind: the invoices in memory, which are the rows
// migrations 002 and 006 write. test/cross-tenant.db.test.ts checks that the database holds
// exactly these. The canaries and the in-company pair come from them (step 12's README,
// decision 8 and C2). Found by the Stage 2 review, and fixed from step 12 on.
export const ROWS: Readonly<Record<string, readonly Row[]>> = { invoice: invoices };

// An id that no row holds, in any company, for the in-company pair. The second way of the
// swap uses it too (step 12's README, decision 3). Found by the Stage 2 review, and fixed
// from step 12 on.
const NOBODY_HAS = "NOPE";

/** The three ways a URI of this company is swapped (step 12's README, decision 3). */
export function waysFrom(
  home: string,
): { to: string; uri: (entity: string, id: string) => string }[] {
  const other = OTHER[home] ?? STRANGER;
  return [
    {
      to: `${other}, with the same id`,
      uri: (entity, id) => `dsor://${other}/${entity}/${id}`,
    },
    {
      to: `${other}, with an id it does not have`,
      uri: (entity) => `dsor://${other}/${entity}/NOPE`,
    },
    {
      to: `${STRANGER}, which does not exist`,
      uri: (entity, id) => `dsor://${STRANGER}/${entity}/${id}`,
    },
  ];
}

// A URI of this company, cut into its entity and its id. Written here, and not imported
// from src, so a mistake in src's parser is not copied into its own test. A company id is
// "org_" and digits, so it holds nothing a pattern would read as a rule.
function uriOf(home: string): RegExp {
  return new RegExp(`^dsor://${home}/([^/]+)/([^/]+)$`);
}

/** For each URI of this company in the example, the three requests that swap only it. */
export function swaps(example: unknown, home: string): Swap[] {
  const found: Swap[] = [];
  for (const [path, text] of texts(example)) {
    const match = uriOf(home).exec(text);
    if (match === null) continue;
    const [, entity = "", id = ""] = match;
    // One URI at a time: the others stay in the company, so each request carries exactly
    // one foreign URI (step 12's README, decision 3).
    const requests = waysFrom(home).map((way) => replaced(example, path, way.uri(entity, id)));
    found.push({ uri: text, requests });
  }
  return found;
}

// The example moved to another company: each of its URIs of org_456 now names that
// company, with the same entity and id (step 12's README, decision 9).
export function movedTo(home: string, example: unknown): unknown {
  let moved = example;
  for (const [path, text] of texts(example)) {
    const match = uriOf(WRITTEN_IN).exec(text);
    if (match === null) continue;
    const [, entity = "", id = ""] = match;
    moved = replaced(moved, path, `dsor://${home}/${entity}/${id}`);
  }
  return moved;
}

// Every text in a value, however deep, with the path of keys that leads to it.
function texts(value: unknown, path: string[] = []): [string[], string][] {
  if (typeof value === "string") return [[path, value]];
  if (typeof value !== "object" || value === null) return [];
  // A list's keys are its positions, "0", "1", and so on.
  return Object.entries(value).flatMap(([key, inner]) => texts(inner, [...path, key]));
}

// A copy of the example with the text at this path replaced. The example is left as it was.
function replaced(example: unknown, path: string[], text: string): unknown {
  if (path.length === 0) return text;
  const copy = structuredClone(example);
  let parent = copy as Record<string, unknown>;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[path[path.length - 1]!] = text;
  return copy;
}

/**
 * A URI of this company in an example, named with an id only the other company holds, and
 * with one nobody holds: the in-company pair, and the two requests that send it.
 */
export type Pair = {
  uri: string;
  other: string;
  named: string;
  nobody: string;
  ids: [string, string];
  requests: [unknown, unknown];
};

/**
 * For each URI of this company in the example, its in-company pair, when the other company
 * holds an id of that kind that this one does not (step 12's README, C2). Found by the
 * Stage 2 review, and fixed from step 12 on.
 */
export function pairsFor(example: unknown, home: string): Pair[] {
  const other = OTHER[home] ?? STRANGER;
  const found: Pair[] = [];
  for (const [path, text] of texts(example)) {
    const match = uriOf(home).exec(text);
    if (match === null) continue;
    const [, entity = ""] = match;
    const rows = ROWS[entity] ?? [];
    const own = new Set(rows.filter((row) => row.tenant_id === home).map((row) => row.id));
    // The first id the other company holds and this one does not. In step 12, only org_789
    // had one, INV-2001. From step 13, org_456 has one too: INV-1001.
    const theirs = rows.find((row) => row.tenant_id === other && !own.has(row.id));
    if (theirs === undefined) continue;
    const named = `dsor://${home}/${entity}/${theirs.id}`;
    const nobody = `dsor://${home}/${entity}/${NOBODY_HAS}`;
    const requests: [unknown, unknown] = [
      replaced(example, path, named),
      replaced(example, path, nobody),
    ];
    found.push({ uri: text, other, named, nobody, ids: [theirs.id, NOBODY_HAS], requests });
  }
  return found;
}

// Every value in these rows, however deep, as text: an amount's value and its currency too.
function valuesOf(rows: readonly unknown[]): string[] {
  const found: string[] = [];
  const todo: unknown[] = [...rows];
  while (todo.length > 0) {
    const value = todo.pop();
    if (typeof value === "object" && value !== null) todo.push(...Object.values(value));
    else if (value !== undefined && value !== null) found.push(String(value));
  }
  return found;
}

/**
 * This company's canaries: every value in another company's rows that this company's rows
 * never hold, not even inside a longer value. For org_456, VENDOR-77, 99000.00, INV-2001.
 * Its own data can never hold one, so a canary in its answer came from another company
 * (step 12's README, decision 8). Found by the Stage 2 review, and fixed from step 12 on.
 */
export function canariesOf(home: string): string[] {
  const rows = Object.values(ROWS).flat();
  const own = valuesOf(rows.filter((row) => row.tenant_id === home)).map((v) => v.toLowerCase());
  const theirs = valuesOf(rows.filter((row) => row.tenant_id !== home));
  const canaries = theirs.filter(
    (value) => !own.some((mine) => mine.includes(value.toLowerCase())),
  );
  return [...new Set(canaries)].sort();
}

// A URI anywhere in a text, and the company it names. "dsor://" may be in capitals (step 10's
// README, decision 4).
const URI_COMPANY = /dsor:\/\/([^/\s"]*)/gi;

/**
 * Another company's sign in an answer, or undefined when it holds only this company's. The
 * whole answer is searched, every key and every text, however deep, for three signs: a key
 * with "tenant" in its name that holds anything but this company's id, a URI of another
 * company, and a canary, ignoring case (step 12's README, decision 8). It searched only a
 * field named exactly tenant_id and a text that starts with dsor://. Found by the Stage 2
 * review, and fixed from step 12 on.
 */
export function foreignIn(answer: unknown, home: string, sent?: unknown): string | undefined {
  // The id a request names in one of its URIs is not counted: an answer may repeat what it
  // was asked, such as "no invoice INV-2001", and that tells the caller nothing new. Found
  // by the Stage 2 review, and fixed from step 12 on. Only those ids: a canary anywhere
  // else in the request, such as in a note, still counts. Found by a hostile pass on that
  // fix: one note that held every canary switched the search off.
  const asked = new Set<string>();
  for (const [, text] of texts(sent)) {
    for (const [, id = ""] of text.matchAll(URI_ID)) asked.add(id.toLowerCase());
  }
  const canaries = canariesOf(home).filter((canary) => !asked.has(canary.toLowerCase()));
  return search(answer, home, canaries);
}

// The id at the end of a URI: dsor://, a company, a kind, then the id.
const URI_ID = /dsor:\/\/[^/\s"]*\/[^/\s"]+\/([^/\s"]+)/gi;

// One value, and everything inside it, in the order it is written.
function search(value: unknown, home: string, canaries: string[]): string | undefined {
  if (typeof value !== "object" || value === null) {
    if (value === undefined || value === null) return undefined;
    return signIn(String(value), home, canaries, false);
  }
  for (const [key, inner] of Object.entries(value)) {
    // A list's keys are its positions, which name nothing.
    if (!Array.isArray(value)) {
      if (/tenant/i.test(key) && inner !== home) return `${key} ${JSON.stringify(inner)}`;
      const inKey = signIn(key, home, canaries, true);
      if (inKey !== undefined) return inKey;
    }
    const deeper = search(inner, home, canaries);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

// A URI of another company in this text, or a canary inside it, in any letters.
function signIn(text: string, home: string, canaries: string[], key: boolean): string | undefined {
  const where = key ? `the key ${JSON.stringify(text)}` : JSON.stringify(text);
  for (const [, company] of text.matchAll(URI_COMPANY)) {
    if (company !== home) return where;
  }
  const lower = text.toLowerCase();
  const canary = canaries.find((one) => lower.includes(one.toLowerCase()));
  if (canary === undefined) return undefined;
  return lower === canary.toLowerCase() ? where : `${JSON.stringify(canary)} in ${where}`;
}

// NEW IN STEP 13: a list names no single thing, so it has no URI to swap. Its rows are
// checked instead (step 13's README, decision 6).
/** Whether this is a page of a list: an object whose items are a list. */
export function isPage(data: unknown): boolean {
  return (
    typeof data === "object" && data !== null && Array.isArray((data as { items?: unknown }).items)
  );
}

/** Why this page is a finding, or undefined when every item carries this company. */
export function pageProblem(data: unknown, home: string): string | undefined {
  if (!isPage(data)) return "its answer is not a page";
  const { items } = data as { items: unknown[] };
  // An empty page checks nothing. A list with no company filter would pass it.
  if (items.length === 0) return "its answer is a page with no items, so it checks nothing";
  for (const [i, item] of items.entries()) {
    const tenant = (item as { tenant_id?: unknown } | null)?.tenant_id;
    if (tenant === undefined)
      return `items[${i}] has no tenant_id, so its company cannot be checked`;
    if (tenant !== home) {
      return `items[${i}] carries tenant_id ${JSON.stringify(tenant)}, not ${JSON.stringify(home)}`;
    }
  }
  return undefined;
}
