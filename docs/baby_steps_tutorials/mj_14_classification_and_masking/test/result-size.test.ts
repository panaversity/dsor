// No query's result is larger than 64 KiB (DSOR-QRY-01; step 13's README,
// C2 and decision 3). The result is the answer's data, as JSON text, counted in bytes.
// Each test plants a fake query, test.run, whose code the test writes.
// NEW IN STEP 14: user_123 asks, a person. An agent's answer is masked before it is
// measured, and the fields these fake rows carry have no label, so an agent would get none
// of them (step 14's README, decisions 3 and 5).
import { describe, expect, it } from "vitest";
import { createLog } from "../src/log.ts";
import { pageOf } from "../src/pages.ts";
import { call } from "../src/pipeline.ts";
import { SUPERVISOR, THE_SUPERVISOR, correlationFor, registryWith, runAs } from "./helpers.ts";

// 64 KiB, typed out again rather than imported from src.
const LIMIT = 65536;

// The refusal every too-large result gets, typed out again rather than imported.
const TOO_LARGE = {
  code: "UNSUPPORTED_CAPABILITY",
  message: "the answer is larger than DSoR gives in one call",
  retry: "never",
  correlation: correlationFor(THE_SUPERVISOR),
};

/** A row of about `kib` KiB: an id, and text to make it large. */
function row(n: number, kib: number): { id: string; text: string } {
  return { id: `ROW-${String(n).padStart(2, "0")}`, text: "x".repeat(kib * 1024) };
}

/** The size of a result as step 13's decision 3 counts it: its JSON text, in UTF-8 bytes. */
function bytes(data: unknown): number {
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

describe("C2: no query's result is larger than 64 KiB", () => {
  it("DSOR-QRY-01: a list whose rows are 10 KiB each stops at 6 rows, under 64 KiB, with a cursor from there", async () => {
    // Eleven rows, as a list reads them: one more than a page of 10.
    const rows = Array.from({ length: 11 }, (_, i) => row(i + 1, 10));
    const answer = await runAs(SUPERVISOR, async () => pageOf(rows, undefined));
    expect("data" in answer).toBe(true);
    const page = (answer as { data: { items: { id: string }[]; next_cursor?: string } }).data;
    expect(page.items.map(({ id }) => id)).toStrictEqual([
      "ROW-01",
      "ROW-02",
      "ROW-03",
      "ROW-04",
      "ROW-05",
      "ROW-06",
    ]);
    expect(page.next_cursor).toBe("ROW-06");
    expect(bytes(page)).toBeLessThanOrEqual(LIMIT);
    // The seventh row would have taken it past.
    expect(bytes({ ...page, items: rows.slice(0, 7) })).toBeGreaterThan(LIMIT);
  });

  it("DSOR-QRY-01: a query whose one result is 100 KiB is refused with UNSUPPORTED_CAPABILITY", async () => {
    expect(await runAs(SUPERVISOR, async () => ({ text: "x".repeat(100 * 1024) }))).toStrictEqual(TOO_LARGE);
  });

  // A page keeps its first row whatever its size, so the cursor always moves. The pipeline
  // then refuses the page (step 13's README, decision 3).
  it("DSOR-QRY-01: a page whose first row alone is larger than 64 KiB is refused, not sent", async () => {
    const rows = [row(1, 100), row(2, 1)];
    expect(await runAs(SUPERVISOR, async () => pageOf(rows, undefined))).toStrictEqual(TOO_LARGE);
  });

  // A string of n characters x is n + 2 bytes of JSON, with its two quotes.
  it("DSOR-QRY-01: a result of exactly 64 KiB is answered", async () => {
    const answer = await runAs(SUPERVISOR, async () => "x".repeat(LIMIT - 2));
    expect(answer).toStrictEqual({
      data: "x".repeat(LIMIT - 2),
      correlation: correlationFor(THE_SUPERVISOR),
    });
  });

  it("DSOR-QRY-01: a result one byte over 64 KiB is refused", async () => {
    expect(await runAs(SUPERVISOR, async () => "x".repeat(LIMIT - 1))).toStrictEqual(TOO_LARGE);
  });

  // é is one character and two bytes. A check of the text's length would let this through.
  it("DSOR-QRY-01: the size is counted in bytes, not characters: 40,000 × é is 80,002 bytes, and refused", async () => {
    expect(await runAs(SUPERVISOR, async () => "é".repeat(40000))).toStrictEqual(TOO_LARGE);
  });

  // The code ran, so the record says ALLOW, with the refusal as its result (step 08's
  // README, decision 5).
  it("DSOR-EXE-02: a result refused for its size is recorded like every other answer", async () => {
    const log = createLog();
    const registry = registryWith(async () => "x".repeat(LIMIT));
    const input = { invoice: "dsor://org_456/invoice/INV-1008" };
    const answer = await call(registry, log, SUPERVISOR, "test.run", input);
    expect(await log.records()).toMatchObject([
      {
        operation: "test.run@1",
        authorization: "ALLOW",
        result: "UNSUPPORTED_CAPABILITY",
        reason: TOO_LARGE.message,
        correlation: answer.correlation,
      },
    ]);
  });

  // Found by the sweep: with `more = true` deleted from pageOf, the last page lost the rows
  // it cut, and no cursor led to them.
  it("DSOR-QRY-01: a last page cut for size still gives a cursor, so no row is lost", async () => {
    // Three rows of 30 KiB: all that is left, so no row past the page was read.
    const rows = [row(1, 30), row(2, 30), row(3, 30)];
    const answer = await runAs(SUPERVISOR, async () => pageOf(rows, undefined));
    expect(idsIn(answer)).toStrictEqual({ items: ["ROW-01", "ROW-02"], next_cursor: "ROW-02" });
  });

  // Found by the sweep: pageOf measured the rows without the cursor, so a page that fits
  // only without it was sent whole, then refused.
  it("DSOR-QRY-01: the cursor's own bytes count: a page that fits only without its cursor loses its last row", async () => {
    const rows = sized(LIMIT - 5);
    expect(bytes({ items: rows.slice(0, 2) })).toBeLessThanOrEqual(LIMIT);
    expect(bytes({ items: rows.slice(0, 2), next_cursor: "ROW-02" })).toBeGreaterThan(LIMIT);
    const answer = await runAs(SUPERVISOR, async () => pageOf(rows, undefined));
    expect(idsIn(answer)).toStrictEqual({ items: ["ROW-01"], next_cursor: "ROW-01" });
  });

  it("DSOR-QRY-01: a page of exactly 64 KiB, its cursor included, keeps both its rows", async () => {
    const rows = sized(LIMIT - bytes({ next_cursor: "ROW-02" }) + 1);
    expect(bytes({ items: rows.slice(0, 2), next_cursor: "ROW-02" })).toBe(LIMIT);
    const answer = await runAs(SUPERVISOR, async () => pageOf(rows, undefined));
    expect(idsIn(answer)).toStrictEqual({ items: ["ROW-01", "ROW-02"], next_cursor: "ROW-02" });
  });

  // capped is about the limit, not the size (step 13's README, decision 3). Found by the
  // sweep: `max: items.length` passed every test.
  it("DSOR-QRY-01: a page cut by its limit and then by size says capped at 10, and holds 6", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(i + 1, 10));
    const answer = await runAs(SUPERVISOR, async () => pageOf(rows, 50));
    expect(idsIn(answer)).toStrictEqual({
      items: ["ROW-01", "ROW-02", "ROW-03", "ROW-04", "ROW-05", "ROW-06"],
      next_cursor: "ROW-06",
      capped: { asked: 50, max: 10 },
    });
  });

  // Found by the sweep: without `?? ""`, a result of nothing could not be measured, and the
  // answer became INTERNAL_ERROR.
  it("DSOR-QRY-01: a query whose code returns nothing is answered, as before this step", async () => {
    expect(await runAs(SUPERVISOR, async () => undefined)).toStrictEqual({
      data: undefined,
      correlation: correlationFor(THE_SUPERVISOR),
    });
  });
});

/** The answer's page with its items cut down to their ids, or the refusal as it is. */
function idsIn(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null || !("data" in answer)) return answer;
  const { items, ...rest } = answer.data as { items: { id: string }[] };
  return { items: items.map(({ id }) => id), ...rest };
}

/**
 * Three rows. The first two, as a page with no cursor, take exactly `target` bytes. The
 * third is small, and is there so that another page follows.
 */
function sized(target: number): { id: string; text: string }[] {
  const empty = bytes({ items: [row(1, 0), row(2, 0)] });
  const first = row(1, 20);
  const second = { id: "ROW-02", text: "x".repeat(target - empty - first.text.length) };
  return [first, second, row(3, 0)];
}
