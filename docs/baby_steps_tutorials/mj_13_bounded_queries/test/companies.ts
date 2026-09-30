// Where the cross-tenant suite finds a company inside a request or an
// answer, and changes it. Not a test file itself: test/cross-tenant.ts uses it. Split from
// that file when it passed 300 lines.

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

// The company a URI names, as the checklist reads it: "dsor://" may be in capitals
// (step 10's README, decision 4).
const URI_COMPANY = /^dsor:\/\/([^/]*)/i;

/**
 * Another company's thing in the data, or undefined when it holds only this company's. Two
 * signs name a company: a tenant_id field, and a URI (step 12's README, decision 8).
 */
export function foreignIn(data: unknown, home: string): string | undefined {
  for (const [path, text] of texts(data)) {
    const field = path[path.length - 1];
    if (field === "tenant_id" && text !== home) return `tenant_id ${JSON.stringify(text)}`;
    const company = URI_COMPANY.exec(text)?.[1];
    if (company !== undefined && company !== home) return JSON.stringify(text);
  }
  return undefined;
}

// NEW IN STEP 13: a list names no single thing, so it has no URI to swap. Its rows are
// checked instead (step 13's README, decision 6).
/** Whether this is a page of a list: an object whose items are a list. */
export function isPage(data: unknown): boolean {
  return typeof data === "object" && data !== null && Array.isArray((data as { items?: unknown }).items);
}

/** Why this page is a finding, or undefined when every item carries this company. */
export function pageProblem(data: unknown, home: string): string | undefined {
  if (!isPage(data)) return "its answer is not a page";
  const { items } = data as { items: unknown[] };
  // An empty page checks nothing. A list with no company filter would pass it.
  if (items.length === 0) return "its answer is a page with no items, so it checks nothing";
  for (const [i, item] of items.entries()) {
    const tenant = (item as { tenant_id?: unknown } | null)?.tenant_id;
    if (tenant === undefined) return `items[${i}] has no tenant_id, so its company cannot be checked`;
    if (tenant !== home) {
      return `items[${i}] carries tenant_id ${JSON.stringify(tenant)}, not ${JSON.stringify(home)}`;
    }
  }
  return undefined;
}
