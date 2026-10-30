// NEW IN STEP 14, from the review: the 64 KiB is measured on what leaves for the caller:
// the data after masking, and the list of what was withheld, which holds field names
// taken from the data (DSOR-QRY-01; step 14's README, decision 5).
import { describe, expect, it } from "vitest";
import type { ClassificationSource } from "../src/labels.ts";
import {
  AGENT,
  PLANTED_MASKED,
  THE_AGENT,
  correlationFor,
  labelsWith,
  omitted,
  runAs,
} from "./helpers.ts";

// The refusal every too-large result gets, typed out again rather than imported.
const TOO_LARGE = {
  code: "UNSUPPORTED_CAPABILITY",
  message: "the answer is larger than DSoR gives in one call",
  retry: "never",
  correlation: correlationFor(THE_AGENT),
};

/** This many fields, each named hidden_0, hidden_1, and so on. */
function hidden(count: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`hidden_${i}`, i]));
}

// The shipped labels, with these fields declared confidential on an invoice. Since the
// Stage 2 review, a key the file does not declare is listed once as <unlabelled>, so only
// declared fields can make the list long (step 14's README, decision 4).
/** The labels, with the first `count` hidden fields declared confidential. */
function declared(count: number): ClassificationSource {
  const lines = Object.fromEntries(Object.keys(hidden(count)).map((f) => [f, "confidential"]));
  return labelsWith({ Invoice: lines });
}

describe("decision 5: the 64 KiB counts what leaves for the caller", () => {
  // Found by the review: every step 13 size test asks as a person now.
  it("DSOR-QRY-01: an agent's answer whose visible fields pass 64 KiB is refused", async () => {
    const large = { ...PLANTED_MASKED, status: "x".repeat(70 * 1024) };
    expect(await runAs(AGENT, async () => large)).toStrictEqual(TOO_LARGE);
  });

  // Found by the review: 2,000 unlabelled fields gave an answer of 241,105 bytes. Since the
  // Stage 2 review, the 2,000 are declared, each listed by its name. Found by the Stage 2
  // review, and fixed from step 14 on.
  it("DSOR-QRY-01: the list of what was withheld counts: 2,000 confidential fields left out are refused", async () => {
    const answer = await runAs(
      AGENT,
      async () => ({ ...PLANTED_MASKED, ...hidden(2000) }),
      "Invoice",
      declared(2000),
    );
    expect(answer).toStrictEqual(TOO_LARGE);
  });

  // Each part fits alone. A check that measured them one at a time would let it through.
  it("DSOR-QRY-01: the data and the list are counted together, not one at a time", async () => {
    const data = { ...PLANTED_MASKED, status: "x".repeat(40 * 1024) };
    const answer = await runAs(
      AGENT,
      async () => ({ ...data, ...hidden(600) }),
      "Invoice",
      declared(600),
    );
    expect(answer).toStrictEqual(TOO_LARGE);
  });

  // The 2,000 fields the review planted, undeclared, are now one entry, <unlabelled>: the
  // list names where something was withheld, never each key (step 14's README, decision 4).
  // Found by the Stage 2 review, and fixed from step 14 on.
  it("DSOR-CLS-02b: 2,000 keys the file does not declare are listed once, as <unlabelled>, and the answer fits", async () => {
    const answer = await runAs(AGENT, async () => ({ ...PLANTED_MASKED, ...hidden(2000) }));
    expect(answer).toStrictEqual({
      data: PLANTED_MASKED,
      classification: "internal",
      redactions: [omitted("<unlabelled>")],
      correlation: correlationFor(THE_AGENT),
    });
  });
});
