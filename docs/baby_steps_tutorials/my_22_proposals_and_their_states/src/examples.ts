// STEP 12: the two things a test does with an example request.
//
// An example request is a request that works for org_456 as it stands. To test an operation with
// another company's address, a test moves every address in the example to that company; to check
// the move had something to move, it lists the addresses first. Both live here, in `src/`, so that
// the generated suite and the demo in main.ts use one implementation rather than two that drift.

/** Every `dsor://` address inside a value, at any depth — including one embedded in a longer string. */
export function addressesIn(value: unknown): string[] {
  if (typeof value === "string") {
    return value.match(/dsor:\/\/[^\s"'`]+/g) ?? [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(addressesIn);
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(addressesIn);
  }

  return [];
}

/** The same value, with every address in it moved from one company to another — at any depth. */
export function movedTo(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") {
    return value.replaceAll(`dsor://${from}/`, `dsor://${to}/`);
  }

  if (Array.isArray(value)) {
    return value.map((item) => movedTo(item, from, to));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, movedTo(item, from, to)]),
    );
  }

  return value;
}
