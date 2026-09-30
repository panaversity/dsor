// NEW IN STEP 13: DSoR, not the caller, decides how many rows one answer holds
// (DSOR-QRY-01 in specs/dsor/01-model.md, section 7.1).

// This tutorial's number, not the specification's. It is small so that a dozen invoices
// show the cut (step 13's README, decision 2).
/** The most rows one page holds, whatever the caller asks for. */
export const MAX_ROWS = 10;

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
  const page: Page<T> = { items };
  // A row past the page means another page follows, from the last row of this one.
  const last = items[items.length - 1];
  if (rows.length > size && last !== undefined) page.next_cursor = last.id;
  // A cut the page did not mention would look like the whole list (step 13's README, "Why
  // it matters").
  if (limit !== undefined && limit > MAX_ROWS) page.capped = { asked: limit, max: MAX_ROWS };
  return page;
}
