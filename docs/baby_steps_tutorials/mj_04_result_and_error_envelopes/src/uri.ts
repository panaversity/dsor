// Every record has one permanent address, its canonical URI.
// DSOR-RID-01a in specs/dsor/01-model.md, section 5.

/** The three parts of a canonical URI: dsor://{tenant_id}/{entity}/{id}. */
export type ResourceParts = { tenant_id: string; entity: string; id: string };

// "dsor://", then three parts with one "/" between them. The tenant and the id are
// letters, digits, "_" and "-" (the id may also hold "."). The entity starts with a
// lowercase letter. No part may be empty or hold a "/", so there are always exactly
// three. Inside the dsor repository, `pnpm guard` checks that it still matches:
// copied from packages/spec/schemas/common.schema.json#/$defs/resourceUri/pattern
const RESOURCE_URI = /^dsor:\/\/[A-Za-z0-9_\-]+\/[a-z][a-z0-9_]*\/[A-Za-z0-9_.\-]+$/;

const SCHEME = "dsor://";

// DSOR-RID-01b. The schema's pattern above accepts "acme" as a tenant,
// because a name and an id are both letters. So step 02 fixes one form for every
// tenant id: "org_" and digits, like org_456. The names people use, like acme, do not
// have that form, so they are refused. (A name made to look like "org_457" would pass.
// The pattern checks the form of the text, not where it came from.) This is stricter
// than the schema, never looser: every id it accepts, the schema accepts too. The
// digits are never read as a number, so org_0456 is a different id from org_456.
const TENANT_ID = /^org_[0-9]+$/;

/** Splits a canonical URI into its three parts, refusing anything else. */
export function parseUri(uri: string): ResourceParts {
  // Check the type first, as money() does. `.test()` turns anything into text before it
  // matches, so a String object holding a valid URI would match.
  if (typeof uri !== "string" || !RESOURCE_URI.test(uri)) {
    throw new TypeError(`not a canonical URI: ${preview(uri)}`);
  }
  // The pattern matched, so the text after "dsor://" is exactly three parts.
  const [tenant_id, entity, id] = uri.slice(SCHEME.length).split("/");
  // The compiler cannot read a pattern, so it does not know that. We check here, rather
  // than overrule the compiler with `!`.
  if (tenant_id === undefined || entity === undefined || id === undefined) {
    throw new TypeError(`not a canonical URI: ${preview(uri)}`);
  }
  if (!TENANT_ID.test(tenant_id)) {
    throw new TypeError(`tenant_id must be an id like org_456, not a name: ${preview(tenant_id)}`);
  }
  return { tenant_id, entity, id };
}

/** Builds a canonical URI from its three parts, refusing parts that would not parse. */
export function formatUri(parts: ResourceParts): string {
  const { tenant_id, entity, id } = parts;
  if ([tenant_id, entity, id].some((part) => typeof part !== "string")) {
    throw new TypeError("not a canonical URI: every part must be a string");
  }
  const uri = `${SCHEME}${tenant_id}/${entity}/${id}`;
  // A "/" inside a part would add a fourth part, and a name would pass the shape.
  // Reading the result back with parseUri means formatUri can never build a URI that
  // parseUri would refuse.
  parseUri(uri);
  return uri;
}

// The refused input may be anything, even something huge. Show a short piece of it.
function preview(input: unknown): string {
  return typeof input === "string" ? JSON.stringify(input.slice(0, 60)) : typeof input;
}
