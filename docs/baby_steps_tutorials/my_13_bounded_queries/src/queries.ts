// NEW IN STEP 13: the ceiling every query has, whatever the caller asks for.
//
// Measured on a copy of step 12 with a list written the obvious way: `{ limit: 1,000,000 }`
// returned all 50,002 of org_456's invoices, three megabytes, in a tenth of a second, because the
// caller set the size. §7.1: an agent in a loop should not be able to download the whole customer
// table. So the size is the server's. Two numbers, in one file, used in two places: the handler's
// SQL carries `LIMIT`, and the door refuses an answer that exceeds them anyway, so a query written
// next year that forgets its LIMIT is caught (database.ts's two-layer idea, one more time).
//
// The numbers are this step's own and provisional, like §44's ceilings: the specification names
// the rule and not the figures.
//
// Rule DSOR-QRY-01: DSoR MUST enforce a server-side maximum page size and maximum result size on
// every query, whether or not the client asks for a limit.

/** The most rows one page may hold. A caller who asks for more gets this many, and a `next`. */
export const MAX_PAGE_SIZE = 100;

/** The page size when the caller says nothing. */
export const DEFAULT_PAGE_SIZE = 25;

/** The most bytes one answer may hold, as JSON. A page of a hundred invoices is about a sixth of it. */
export const MAX_RESULT_BYTES: number = 64 * 1024;

/**
 * The page size a request gets: the caller's number, capped, or the default when there is none.
 *
 * Capped, not refused, because the rule says the server *enforces* a maximum: asking for a million
 * is an ordinary request that gets one page. A number that is not a whole number above zero is a
 * different thing — not a request for rows at all — and is refused as invalid input.
 */
export function pageSizeFrom(given: unknown): number | { readonly refused: string } {
  if (given === undefined) {
    return DEFAULT_PAGE_SIZE;
  }

  if (typeof given !== "number" || !Number.isInteger(given) || given < 1) {
    // A number is shown as itself: NaN and Infinity have no JSON, and a message built with
    // JSON.stringify said "got null" for both.
    const shown = typeof given === "number" ? String(given) : JSON.stringify(given);

    return { refused: `limit must be a whole number above zero, and got ${shown}` };
  }

  return Math.min(given, MAX_PAGE_SIZE);
}

/** How big an answer is, the way it would travel: as JSON. */
export function bytesOf(answer: unknown): number {
  return Buffer.byteLength(JSON.stringify(answer), "utf8");
}
