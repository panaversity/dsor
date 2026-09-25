// NEW IN STEP 02: every record has one permanent address, its canonical URI.
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

/** Splits a canonical URI into its three parts, refusing anything else. */
export function parseUri(uri: string): ResourceParts {
  // Check the type first, as money() does. `.test()` turns a number into text.
  if (typeof uri !== "string" || !RESOURCE_URI.test(uri)) {
    throw new TypeError(`not a canonical URI: ${preview(uri)}`);
  }
  // The pattern matched, so the text after "dsor://" is exactly three parts.
  const [tenant_id, entity, id] = uri.slice(SCHEME.length).split("/");
  // The compiler cannot read a regex, so it does not know that. We check, rather than
  // tell it "trust me" with `!`.
  if (tenant_id === undefined || entity === undefined || id === undefined) {
    throw new TypeError(`not a canonical URI: ${preview(uri)}`);
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
  // A "/" inside a part would add a fourth part. Checking the result with the same
  // pattern means formatUri can never build a URI that parseUri would refuse.
  if (!RESOURCE_URI.test(uri)) {
    throw new TypeError(`not a canonical URI: ${preview(uri)}`);
  }
  return uri;
}

// The refused input may be anything, even something huge. Show a short piece of it.
function preview(input: unknown): string {
  return typeof input === "string" ? JSON.stringify(input.slice(0, 60)) : typeof input;
}
