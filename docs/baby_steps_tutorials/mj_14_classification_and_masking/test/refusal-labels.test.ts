// NEW IN STEP 14, from the review: a refusal from the operation's code is masked too. Its
// message is text, and the code can put company data in it (DSOR-CLS-02a, DSOR-AUD-05a;
// step 14's README, decision 8).
import { describe, expect, it } from "vitest";
import { Refusal } from "../src/envelope.ts";
import { createLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, SUPERVISOR, log, registry, registryWith } from "./helpers.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

// A refusal that tells the amount, and the message that replaces it, typed out again.
const TELLS_AMOUNT = "INV-1008 still has 31400.00 USD open";
const WITHHELD = "the operation refused the call, and its reason is above the caller's clearance";

/** Calls test.run as this caller, whose code refuses with CONFLICT and this message. */
async function refusedBy(
  who: RequestEnvelope,
  message: string,
  label?: "public" | "internal" | "confidential" | "restricted",
): Promise<{ answer: unknown; records: string }> {
  const kept = createLog();
  const registry = registryWith(() => {
    throw label === undefined ? new Refusal("CONFLICT", message) : new Refusal("CONFLICT", message, label);
  });
  const answer = await call(registry, kept, who, "test.run", GET_1008);
  return { answer, records: JSON.stringify(await kept.records()) };
}

describe("decision 8: a refusal from the operation's code is masked", () => {
  it("DSOR-CLS-02a: a refusal from the code is confidential unless labelled, so the agent hears its code with a fixed message", async () => {
    const { answer, records } = await refusedBy(AGENT, TELLS_AMOUNT);
    expect(answer).toMatchObject({ code: "CONFLICT", message: WITHHELD, retry: "never" });
    expect(JSON.stringify(answer)).not.toContain("31400.00");
    // The record keeps what the caller heard, as since step 08.
    expect(records).not.toContain("31400.00");
    expect(records).toContain(WITHHELD);
  });

  it("DSOR-AUD-05a: a refusal labelled restricted is replaced for a person too, so no record holds it", async () => {
    const { answer, records } = await refusedBy(SUPERVISOR, TELLS_AMOUNT, "restricted");
    expect(answer).toMatchObject({ code: "CONFLICT", message: WITHHELD });
    expect(records).not.toContain("31400.00");
  });

  // A person is not masked (decision 5), below restricted.
  it("decision 8: user_123 hears a confidential refusal whole", async () => {
    const { answer } = await refusedBy(SUPERVISOR, TELLS_AMOUNT);
    expect(answer).toMatchObject({ code: "CONFLICT", message: TELLS_AMOUNT });
  });

  it("decision 8: the agent hears a refusal labelled internal whole", async () => {
    const { answer } = await refusedBy(AGENT, "INV-1008 is paid already", "internal");
    expect(answer).toMatchObject({ code: "CONFLICT", message: "INV-1008 is paid already" });
  });

  // It repeats only the id the caller sent, so the code labels it internal.
  it("decision 8: invoice.get's not-found still reaches the agent word for word", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-9999",
    });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND", message: 'no invoice "INV-9999"' });
  });
});
