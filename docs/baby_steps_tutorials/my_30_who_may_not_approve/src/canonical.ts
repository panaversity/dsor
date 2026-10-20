// STEP 29: one way to write a request, so one request has one fingerprint (decision 167).
//
// JSON can write the same request many ways: its fields in another order, a number as 4.50 or 4.5,
// a character as itself or as B. An approval is tied to a fingerprint of the exact request, and
// a fingerprint of the text as it was sent differs for each of those spellings: the CFO could approve
// one while the program held another. RFC 8785, the JSON Canonicalization Scheme, picks one spelling.
// JavaScript's own JSON.stringify already writes numbers and strings the way RFC 8785 asks, so what
// is left is the order of the keys, and text that is not valid Unicode, which has no canonical form.
//
// The log has a canonical form of its own, in audit.ts, which never refuses: evidence is always
// written. A request with no canonical form is refused instead, at §21.6, before anything is decided.
//
// Rule DSOR-APR-02b: The payload hash MUST be computed over the RFC 8785 (JCS) canonical JSON of the
// stored input.

/** A value with no canonical form, and why. */
export class NotCanonical extends Error {}

/**
 * The RFC 8785 text of a JSON value: every object's keys sorted by their UTF-16 code units, which is
 * how JavaScript compares strings, and each number and string as JSON.stringify writes it. Throws
 * `NotCanonical` for a number JSON cannot write, and for text, a key or a value, that is not valid
 * Unicode: half of a surrogate pair, alone.
 *
 * Written out by hand, not by JSON.stringify with a replacer that sorts. A replacer has to hand back
 * an object, and JavaScript lists an object's number-like keys first whatever order they were put in,
 * so `{"\r": 1, "1": 1}` came out with "1" first, where RFC 8785 puts "\r" first. The test of the
 * RFC's own example of sorting caught it.
 */
export function canonicalJson(value: unknown): string {
  const written = write(value, "the request");

  if (written === undefined) {
    throw new NotCanonical("the request is not a JSON value");
  }

  return written;
}

/** One value's text, or `undefined` for what JSON leaves out of an object: undefined, a function. */
function write(value: unknown, where: string): string | undefined {
  // As JSON.stringify does: a value that knows how to write itself, a Date, is asked once.
  const held =
    value !== null &&
    typeof value === "object" &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
      ? (value as { toJSON: (key: string) => unknown }).toJSON(where)
      : value;

  if (held === null || typeof held === "boolean") {
    return JSON.stringify(held);
  }

  if (typeof held === "number") {
    if (!Number.isFinite(held)) {
      throw new NotCanonical(`${where} is ${String(held)}`);
    }

    return JSON.stringify(held);
  }

  if (typeof held === "string") {
    if (!held.isWellFormed()) {
      throw new NotCanonical(`${where} holds text that is not valid Unicode`);
    }

    return JSON.stringify(held);
  }

  if (typeof held === "bigint") {
    throw new NotCanonical(`${where} is a number JSON cannot write`);
  }

  if (held === undefined || typeof held === "function" || typeof held === "symbol") {
    return undefined;
  }

  if (Array.isArray(held)) {
    // As JSON.stringify does: what an object would leave out is null in a list.
    return `[${held.map((item, at) => write(item, `${where}[${at}]`) ?? "null").join(",")}]`;
  }

  // Each field read once, by Object.entries, in the order RFC 8785 asks for.
  const fields: string[] = [];

  for (const [name, inner] of Object.entries(held as Record<string, unknown>).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )) {
    if (!name.isWellFormed()) {
      throw new NotCanonical("a field's name is not valid Unicode");
    }

    const text = write(inner, name);

    if (text !== undefined) {
      fields.push(`${JSON.stringify(name)}:${text}`);
    }
  }

  return `{${fields.join(",")}}`;
}
