// NEW IN STEP 28b: where a rule came from, DSoR's side. Each rule cites the version of a policy it
// was built from, with the policy's fingerprint. DSoR asks the company's KSoR which version is in
// force: a switch-on asks, and so does the sweep (DSOR-CTL-03a in specs/dsor/02-security.md,
// section 17.4; step 28b's README, decisions D2 and D3). Never the rule's word, never the
// agent's. KSoR's side is in ksor.ts.
import type { Ksors } from "./ksor.ts";
import { preview } from "./registry.ts";

/** What DSoR heard about one policy: the version in force and its fingerprint, or why it heard nothing it can use. */
export type Heard =
  | { answered: true; version: number; content_hash: string }
  | { answered: false; why: string };

/** DSoR's question to one company's KSoR: which version of this policy is in force? */
export type PolicyLook = (uri: string) => Promise<Heard>;

// DSoR waits this long for one answer, and no longer, as it waits for a directory: a stuck KSoR
// must not hold a switch-on, or the sweep, for ever (step 19's README, decision 9).
const WAIT_MS = 2000;

// not copied: common.schema.json's hash, the form of a fingerprint that a rule may cite.
const FINGERPRINT = /^sha256:[A-Za-z0-9+/=_-]+$/;

/** KSoR's answer, or none when it fails or takes longer than WAIT_MS. */
async function answerWithin(
  ask: () => Promise<unknown>,
): Promise<{ answered: true; answer: unknown } | { answered: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ answered: false }>((resolve) => {
    timer = setTimeout(() => resolve({ answered: false }), WAIT_MS);
  });
  // A KSoR that fails, even at once, gives no answer. It never stops a call with an error of its
  // own.
  const asked = (async () => ask())().then(
    (answer) => ({ answered: true as const, answer }),
    () => ({ answered: false as const }),
  );
  try {
    return await Promise.race([asked, late]);
  } finally {
    // The timer goes, so a question that was answered at once leaves nothing behind.
    clearTimeout(timer);
  }
}

/** A copy of the answer, read once, or nothing if it cannot be copied, as a directory's is (step 19's README, decision 17). */
function copyOf(answer: unknown): unknown {
  try {
    return structuredClone(answer);
  } catch {
    return undefined;
  }
}

/** DSoR's question to the KSoR of this company, and of no other (step 28b's README, decision D2). */
export function policyLook(ksors: Ksors, tenant: string): PolicyLook {
  return async (uri: string): Promise<Heard> => {
    const ksor = ksors.get(tenant);
    if (ksor === undefined) return { answered: false, why: `DSoR has no KSoR for ${tenant}` };
    const asked = await answerWithin(() => ksor.ask(uri));
    if (!asked.answered) {
      return { answered: false, why: `the KSoR of ${tenant} gave no answer within 2 seconds` };
    }
    const cannotUse = `the KSoR of ${tenant} answered with something DSoR cannot use`;
    const copy = copyOf(asked.answer);
    if (typeof copy !== "object" || copy === null || Array.isArray(copy)) {
      return { answered: false, why: cannotUse };
    }
    const fields = copy as Record<string, unknown>;
    // An answer about another company, or another policy, answers another question.
    if (fields["tenant"] !== tenant || fields["uri"] !== uri) {
      return { answered: false, why: cannotUse };
    }
    // A policy KSoR does not list is no answer, not a change: this stand-in never withdraws a
    // policy (step 28b's README, decision D3).
    if (fields["listed"] === false) {
      return { answered: false, why: `the KSoR of ${tenant} does not list ${preview(uri)}` };
    }
    const { listed, version, content_hash } = fields;
    const counted = typeof version === "number" && Number.isInteger(version) && version >= 1;
    const printed = typeof content_hash === "string" && FINGERPRINT.test(content_hash);
    if (listed !== true || !counted || !printed) return { answered: false, why: cannotUse };
    return { answered: true, version, content_hash };
  };
}
