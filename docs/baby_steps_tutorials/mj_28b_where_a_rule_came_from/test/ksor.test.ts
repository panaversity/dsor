// The stand-in for KSoR, and DSoR's question to it: which version of this policy is in force
// (step 28b's README, claim C1, decisions D1 to D3). DSoR waits 2 seconds at most, and uses only
// an answer about the company and the policy it asked about, in a shape it can read.
import { afterEach, describe, expect, it, vi } from "vitest";
import { policyLook } from "../src/drift.ts";
import { fakeKsor, fingerprintOf, NO_KSORS, type Ksor } from "../src/ksor.ts";

const POLICY = "ksor://org_456/finance/payment-approval-policy";
// Version 4, which version 8 of high-value-payment cites, with the fingerprint it cites.
const V4 = {
  version: 4,
  text: "Payments above 25,000 USD or equivalent require CFO approval.",
  content_hash: "sha256:9f2c1e7ab4d0",
};
const V5_TEXT = "Payments above 20,000 USD or equivalent require CFO approval.";

/** org_456's KSoR, as the story begins: version 4 of the payment-approval policy in force. */
function storyKsor() {
  return fakeKsor("org_456", { [POLICY]: [V4] });
}

/** DSoR's question to this KSoR, as org_456's. */
function lookAt(ksor: Ksor) {
  return policyLook(new Map([["org_456", ksor]]), "org_456");
}

/** A KSoR that answers this, whatever it is asked. */
function answering(answer: unknown): Ksor {
  return { ask: async () => answer };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("C1: DSoR asks the company's KSoR which version of a policy is in force (step 28b's README, decisions D1 and D2)", () => {
  it("DSOR-CTL-03a: org_456's KSoR has version 4 of the payment-approval policy in force, with the fingerprint that version 8 cites", async () => {
    expect(await lookAt(storyKsor())(POLICY)).toStrictEqual({
      answered: true,
      version: 4,
      content_hash: "sha256:9f2c1e7ab4d0",
    });
  });

  it("DSOR-CTL-03a: once the finance team publishes version 5, KSoR has version 5 in force, with the SHA-256 of its own text", async () => {
    const ksor = storyKsor();
    expect(ksor.publish(POLICY, V5_TEXT)).toStrictEqual({
      version: 5,
      text: V5_TEXT,
      content_hash: fingerprintOf(V5_TEXT),
    });
    expect(await lookAt(ksor)(POLICY)).toStrictEqual({
      answered: true,
      version: 5,
      content_hash: fingerprintOf(V5_TEXT),
    });
    expect(fingerprintOf(V5_TEXT)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fingerprintOf(V5_TEXT)).not.toBe(fingerprintOf(V4.text));
  });

  it("Step 28b: a policy that KSoR does not list is no answer, and DSoR says so (decision D3)", async () => {
    const travel = "ksor://org_456/finance/travel-policy";
    expect(await lookAt(storyKsor())(travel)).toStrictEqual({
      answered: false,
      why: 'the KSoR of org_456 does not list "ksor://org_456/finance/travel-policy"',
    });
  });

  it("Step 28b: a KSoR that is off is no answer, and DSoR does not wait for it", async () => {
    const ksor = storyKsor();
    ksor.turn("off");
    expect(await lookAt(ksor)(POLICY)).toStrictEqual({
      answered: false,
      why: "the KSoR of org_456 gave no answer within 2 seconds",
    });
    expect(ksor.asked()).toBe(1);
  });

  it("Step 28b: a stuck KSoR holds DSoR's question 2 seconds at most, and then it is no answer (decision D2)", async () => {
    vi.useFakeTimers();
    const ksor = storyKsor();
    ksor.turn("stuck");
    let heard: unknown;
    const pending = lookAt(ksor)(POLICY).then((answer) => {
      heard = answer;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(heard).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(heard).toStrictEqual({
      answered: false,
      why: "the KSoR of org_456 gave no answer within 2 seconds",
    });
  });

  it("Step 28b: a company with no KSoR is no answer", async () => {
    expect(await policyLook(NO_KSORS, "org_456")(POLICY)).toStrictEqual({
      answered: false,
      why: "DSoR has no KSoR for org_456",
    });
  });

  it("Step 28b: DSoR asks the KSoR of the call's own company only: org_789's KSoR is never asked about org_456's policy", async () => {
    const theirs = fakeKsor("org_789", { [POLICY]: [V4] });
    const look = policyLook(new Map([["org_789", theirs]]), "org_456");
    expect(await look(POLICY)).toStrictEqual({
      answered: false,
      why: "DSoR has no KSoR for org_456",
    });
    expect(theirs.asked()).toBe(0);
  });

  const good = { tenant: "org_456", uri: POLICY, listed: true, version: 4 };
  it.each([
    [
      "an answer about another company",
      { ...good, tenant: "org_789", content_hash: V4.content_hash },
    ],
    [
      "an answer about another policy",
      { ...good, uri: `${POLICY}-old`, content_hash: V4.content_hash },
    ],
    ["a version 0", { ...good, version: 0, content_hash: V4.content_hash }],
    [
      "a version that is not a whole number",
      { ...good, version: 4.5, content_hash: V4.content_hash },
    ],
    ["a version written as text", { ...good, version: "4", content_hash: V4.content_hash }],
    ["a fingerprint of another kind", { ...good, content_hash: "md5:9f2c1e7ab4d0" }],
    ["no fingerprint", good],
    ["no word on whether it lists the policy", { tenant: "org_456", uri: POLICY, version: 4 }],
    ["null", null],
    ["a list", [good]],
    ["an answer that cannot be copied", { ...good, content_hash: V4.content_hash, f: () => 1 }],
  ])(
    "Step 28b: %s is an answer DSoR cannot use, so it is no answer (decision D2)",
    async (_, answer) => {
      expect(await lookAt(answering(answer))(POLICY)).toStrictEqual({
        answered: false,
        why: "the KSoR of org_456 answered with something DSoR cannot use",
      });
    },
  );

  it("Step 28b: DSoR reads KSoR's answer once: an answer that changes as it is read is used as it was copied", async () => {
    let reads = 0;
    const changing = {
      tenant: "org_456",
      uri: POLICY,
      listed: true,
      content_hash: V4.content_hash,
      get version() {
        reads += 1;
        return reads === 1 ? 4 : 9;
      },
    };
    expect(await lookAt(answering(changing))(POLICY)).toStrictEqual({
      answered: true,
      version: 4,
      content_hash: V4.content_hash,
    });
    expect(reads).toBe(1);
  });
});
