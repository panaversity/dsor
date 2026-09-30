// NEW IN STEP 13: DSoR, not the caller, decides how many rows and how many bytes one
// answer holds (DSOR-QRY-01 in specs/dsor/01-model.md, section 7.1).
import { Refusal } from "./envelope.ts";

// This tutorial's number, not the specification's. It is small so that a dozen invoices
// show the cut (step 13's README, decision 2).
/** The most rows one page holds, whatever the caller asks for. */
export const MAX_ROWS = 10;

// 64 KiB, this tutorial's number too. It counts the result, the answer's data, and not
// the correlation beside it, which DSoR writes itself (step 13's README, decision 3).
/** The most bytes one query's result may hold, as JSON text. */
export const MAX_BYTES: number = 64 * 1024;

/** The size of a result as JSON text, in bytes. A character such as é takes two. */
export function resultBytes(data: unknown): number {
  return Buffer.byteLength(JSON.stringify(data) ?? "", "utf8");
}

// The pipeline's check, after line ⑨, for every query whoever wrote its code. §28 has no
// code for "too large": UNSUPPORTED_CAPABILITY is the closest, and asking again gets the
// same answer (step 13's README, decision 3).
/** Refuses a result larger than DSoR gives in one call. */
export function checkResultSize(data: unknown): void {
  if (resultBytes(data) > MAX_BYTES) {
    throw new Refusal("UNSUPPORTED_CAPABILITY", "the answer is larger than DSoR gives in one call");
  }
}

/** One page of a list: its rows, where the next page starts, and whether the limit was cut. */
export type Page<T> = {
  items: T[];
  // The id of the page's last row. Absent on the last page (step 13's README, decision 4).
  next_cursor?: string;
  // What the caller asked for, and what DSoR gave instead (step 13's README, decision 2).
  capped?: { asked: number; max: number };
};

/** How many rows a page holds: the caller's limit, cut down to DSoR's maximum. */
export function pageSize(limit: number | undefined): number {
  // No limit is not "everything". It is DSoR's maximum.
  return Math.min(limit ?? MAX_ROWS, MAX_ROWS);
}

/** One page of rows, which were read one row past the page's size. */
export function pageOf<T extends { id: string }>(rows: T[], limit: number | undefined): Page<T> {
  const size = pageSize(limit);
  const items = rows.slice(0, size);
  // A row past the page means another page follows.
  let more = rows.length > size;
  // Then the bytes: rows come off the end until the result fits, and the next page starts
  // there. Never the first row: a page with no row and a cursor would send the caller back
  // to the same place forever. A first row that is too large alone is refused by
  // checkResultSize (step 13's README, decision 3).
  while (items.length > 1 && resultBytes(page(items, more, limit)) > MAX_BYTES) {
    items.pop();
    more = true;
  }
  return page(items, more, limit);
}

// The page these rows make.
function page<T extends { id: string }>(
  items: T[],
  more: boolean,
  limit: number | undefined,
): Page<T> {
  const made: Page<T> = { items };
  // Another page follows, from the last row of this one.
  const last = items[items.length - 1];
  if (more && last !== undefined) made.next_cursor = last.id;
  // A cut the page did not mention would look like the whole list (step 13's README, "Why
  // it matters").
  if (limit !== undefined && limit > MAX_ROWS) made.capped = { asked: limit, max: MAX_ROWS };
  return made;
}
