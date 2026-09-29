// Every record gets one permanent address.
//
//     dsor://org_456/invoice/INV-1008
//     ^^^^   ^^^^^^^ ^^^^^^^ ^^^^^^^^
//     scheme tenant  entity  id
//
// The same address is used in the API, the logs, the events and the approvals, so
// one invoice can be followed everywhere.
//
// Rule DSOR-RID-01a: every resource MUST have a canonical URI of this form.
// Rule DSOR-RID-01b: a display name, slug or alias MUST NOT appear in it.

/** The three parts of a canonical address. */
export interface ResourceUri {
  /** Which company. An id that never changes, never a name. */
  readonly tenant: string;
  /** What kind of thing: `invoice`, `vendor`, `payment`. */
  readonly entity: string;
  /** Which one: `INV-1008`. */
  readonly id: string;
}

// The shape of an address. Copied from the specification's own JSON Schema, at
// packages/spec/schemas/common.schema.json. The three bracketed groups are the
// three parts. `^` and `$` mean the whole text must be the address and nothing
// else, so a space or a stray word on either end is refused.
const CANONICAL_URI = /^dsor:\/\/([A-Za-z0-9_-]+)\/([a-z][a-z0-9_]*)\/([A-Za-z0-9_.-]+)$/;

// What a tenant id looks like HERE.
//
// This pattern is this deployment's own convention. Section 5 says a tenant id is
// "an immutable opaque identifier" and never says what one looks like, so the
// schema pattern above happily accepts `acme` — it is letters, exactly like
// `org_456` is letters and digits. Nothing in the text itself says "I am a name".
//
// That is why DSOR-RID-01b cannot be enforced by the shape check alone, and why
// this second pattern exists. A deployment that numbers its tenants differently
// changes this line and nothing else.
const TENANT_ID = /^org_[0-9]+$/;

/**
 * Reads an address and hands back its three parts, or refuses.
 *
 * Refusing is the important half. An address is how one invoice is followed from
 * the approval to the payment to the audit log, so an address that is wrong in any
 * way has to stop here rather than travel on.
 */
export function parseUri(uri: string): ResourceUri {
  const match = CANONICAL_URI.exec(uri);
  if (match === null) {
    throw new TypeError(`not a canonical URI: ${JSON.stringify(uri)}`);
  }

  // match[1], match[2] and match[3] are the three bracketed parts of the pattern.
  // TypeScript types them as "string or undefined", because it cannot see that the
  // pattern has exactly three groups. The `?? ""` is unreachable: if exec returned
  // something, all three groups matched. An empty tenant would be refused by the
  // check below; an empty entity or id could not get here, because the pattern
  // requires at least one character in each.
  const tenant = match[1] ?? "";
  const entity = match[2] ?? "";
  const id = match[3] ?? "";

  if (!TENANT_ID.test(tenant)) {
    throw new TypeError(`not a tenant id: ${JSON.stringify(tenant)}`);
  }

  return Object.freeze({ tenant, entity, id });
}

/**
 * Writes the address for a record.
 *
 * It reads back what it just wrote and checks the three parts came back unchanged.
 * Parsing alone is not enough. Building the text with `${...}` turns whatever it is
 * given into text first, so a missing id arrives as the word "undefined" and
 * `dsor://org_456/invoice/undefined` parses perfectly: a canonical, permanent
 * address for a record that does not exist. Types do not stop that, because Node
 * deletes them before it runs the file. Comparing the parts does.
 */
/**
 * The object's **own** `key`, when it is a string. Refuses everything else.
 *
 * Each part is read exactly **once**, through here, and the three locals below are the only
 * things the address is built from. Two reasons, both found by attacking this function:
 *
 * - A property can be a *getter*, and a getter can answer differently each time it is read.
 *   `formatUri` reads each part twice — once to build the address and once to compare it back —
 *   so an object that answers `INV-1008` then `INV-9999` made those two reads disagree. Reading
 *   once means the comparison is against the value that was actually used.
 * - A name the object merely **inherits** is a name nobody in this program chose. An object
 *   owning nothing at all used to mint a perfectly valid address from its prototype.
 */
function ownText(parts: object, key: "tenant" | "entity" | "id"): string {
  if (!Object.hasOwn(parts, key)) {
    throw new TypeError(`an address needs its own ${key}, and this object only inherits one`);
  }

  const value = (parts as Record<string, unknown>)[key];

  if (typeof value !== "string") {
    throw new TypeError(`an address needs a ${key} that is text, and got ${typeof value}`);
  }

  return value;
}

export function formatUri(parts: ResourceUri): string {
  const tenant = ownText(parts, "tenant");
  const entity = ownText(parts, "entity");
  const id = ownText(parts, "id");

  const uri = `dsor://${tenant}/${entity}/${id}`;
  const back = parseUri(uri);

  // Compared against the locals, not against `parts` — which is the point of reading once.
  //
  // Be honest about this compare: since each part is read through ownText, nothing that reaches
  // here can fail it. Every string that would read back differently — a slash inside a part, a
  // leading or trailing newline — makes parseUri refuse the address above. It was the original
  // fix for `${...}` coercing a missing id into the text "undefined", and ownText now catches
  // that earlier and catches more. It stays as the last line of defence, and because it is what
  // this step teaches, but no test can kill it. A guard that cannot be killed is worth a comment
  // rather than a quiet line.
  if (back.tenant !== tenant || back.entity !== entity || back.id !== id) {
    throw new TypeError(`address does not read back the same: ${JSON.stringify(uri)}`);
  }

  return uri;
}
