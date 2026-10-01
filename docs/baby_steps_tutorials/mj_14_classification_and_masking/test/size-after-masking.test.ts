// NEW IN STEP 14, from the review: the 64 KiB is measured on what leaves for the caller:
// the data after masking, and the list of what was withheld, which holds field names
// taken from the data (DSOR-QRY-01; step 14's README, decision 5).
import { describe, expect, it } from "vitest";
import { AGENT, PLANTED_MASKED, THE_AGENT, correlationFor, runAs } from "./helpers.ts";

// The refusal every too-large result gets, typed out again rather than imported.
const TOO_LARGE = {
  code: "UNSUPPORTED_CAPABILITY",
  message: "the answer is larger than DSoR gives in one call",
  retry: "never",
  correlation: correlationFor(THE_AGENT),
};

/** This many fields with no label, each named hidden_0, hidden_1, and so on. */
function unlabelled(count: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`hidden_${i}`, i]));
}

describe("decision 5: the 64 KiB counts what leaves for the caller", () => {
  // Found by the review: every step 13 size test asks as a person now.
  it("DSOR-QRY-01: an agent's answer whose visible fields pass 64 KiB is refused", async () => {
    const large = { ...PLANTED_MASKED, status: "x".repeat(70 * 1024) };
    expect(await runAs(AGENT, async () => large)).toStrictEqual(TOO_LARGE);
  });

  // Found by the review: 2,000 unlabelled fields gave an answer of 241,105 bytes.
  it("DSOR-QRY-01: the list of what was withheld counts: 2,000 unlabelled fields are refused", async () => {
    const answer = await runAs(AGENT, async () => ({ ...PLANTED_MASKED, ...unlabelled(2000) }));
    expect(answer).toStrictEqual(TOO_LARGE);
  });

  // Each part fits alone. A check that measured them one at a time would let it through.
  it("DSOR-QRY-01: the data and the list are counted together, not one at a time", async () => {
    const data = { ...PLANTED_MASKED, status: "x".repeat(40 * 1024) };
    const answer = await runAs(AGENT, async () => ({ ...data, ...unlabelled(600) }));
    expect(answer).toStrictEqual(TOO_LARGE);
  });
});
