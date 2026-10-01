// NEW IN STEP 15: an answer built from several reads is only as fresh as its stalest part:
// the weakest mode and the oldest observed_at (step 15's README, C5 and decision 6). The
// order, from strongest: current, bounded_staleness, connector_defined, observational.
import { describe, expect, it } from "vitest";
import type { Company } from "../src/company.ts";
import { CFO } from "./helpers.ts";
import { freshnessOf, relabelled, runOver } from "./stores.ts";

// A planted operation that reads INV-1008 twice, and answers with the first copy.
async function readsTwice(_input: unknown, company: Company): Promise<unknown> {
  const first = await company.invoices.get("INV-1008");
  await company.invoices.get("INV-1008");
  return first;
}

/** The label of the answer when the two reads carry these two labels, in this order. */
async function labelOfTwoReads(first: object, second: object): Promise<unknown> {
  return freshnessOf(await runOver(relabelled([first, second]), CFO, readsTwice));
}

const at = (time: string): string => `2026-10-01T${time}.000Z`;
const CURRENT = { mode: "current", observed_at: at("09:00:00"), connector: "memory" };
const BOUNDED = { mode: "bounded_staleness", observed_at: at("08:59:30"), connector: "warehouse" };
const DEFINED = { mode: "connector_defined", observed_at: at("08:30:00"), connector: "crm" };
const CACHED = { mode: "observational", observed_at: at("08:00:00"), connector: "cache" };

describe("C5: several reads give the stalest label", () => {
  it("decision 6: a current read and then an observational one give observational, with the older time", async () => {
    expect(await labelOfTwoReads(CURRENT, CACHED)).toStrictEqual(CACHED);
  });

  it("decision 6: the same two reads in the other order give the same label", async () => {
    expect(await labelOfTwoReads(CACHED, CURRENT)).toStrictEqual(CACHED);
  });

  // Each pair, weaker one second and then first, so neither "the first read wins" nor "the
  // last read wins" passes.
  const pairs: [string, object, object][] = [
    ["bounded_staleness is weaker than current", CURRENT, BOUNDED],
    ["connector_defined is weaker than bounded_staleness", BOUNDED, DEFINED],
    ["observational is weaker than connector_defined", DEFINED, CACHED],
  ];
  for (const [what, stronger, weaker] of pairs) {
    it(`decision 6: ${what}, in either order`, async () => {
      expect(await labelOfTwoReads(stronger, weaker)).toStrictEqual(weaker);
      expect(await labelOfTwoReads(weaker, stronger)).toStrictEqual(weaker);
    });
  }

  // The weakest mode and the oldest time come from two different reads here. The label
  // takes each from its own read, and the connector from the oldest read.
  it("decision 6: the weakest mode and the oldest time are each taken from their own read", async () => {
    const older = {
      mode: "bounded_staleness",
      observed_at: at("07:00:00"),
      connector: "warehouse",
    };
    const weaker = { mode: "observational", observed_at: at("08:45:00"), connector: "cache" };
    const expected = { mode: "observational", observed_at: at("07:00:00"), connector: "warehouse" };
    expect(await labelOfTwoReads(older, weaker)).toStrictEqual(expected);
    expect(await labelOfTwoReads(weaker, older)).toStrictEqual(expected);
  });

  // Found by the mutation sweep, 2026-10-02: the design said nothing about a tie, so taking
  // the last of two equal times passed. On a tie, the first read's connector (decision 6).
  it("decision 6: when two reads have the same oldest time, the connector is the first of them", async () => {
    const warehouse = { mode: "bounded_staleness", observed_at: at("08:30:00"), connector: "warehouse" };
    const crm = { mode: "bounded_staleness", observed_at: at("08:30:00"), connector: "crm" };
    expect(await labelOfTwoReads(warehouse, crm)).toStrictEqual(warehouse);
    expect(await labelOfTwoReads(crm, warehouse)).toStrictEqual(crm);
  });

  // 09:00 at +05:00 is 04:00 in UTC, older than 05:00 in UTC, though its text sorts after
  // it. Times are compared as moments, never as text. The label keeps the time as its
  // store wrote it.
  it("decision 6: the oldest time is the earliest moment, whatever time zone each store writes", async () => {
    const pakistan = {
      mode: "bounded_staleness",
      observed_at: "2026-10-01T09:00:00+05:00",
      connector: "warehouse",
    };
    const utc = { mode: "bounded_staleness", observed_at: at("05:00:00"), connector: "crm" };
    expect(await labelOfTwoReads(utc, pakistan)).toStrictEqual(pakistan);
    expect(await labelOfTwoReads(pakistan, utc)).toStrictEqual(pakistan);
  });
});
