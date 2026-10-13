// NEW IN STEP 28b: a company's KSoR, the record of what the company knows, its policies among it.
// Each policy has versions, and each version a fingerprint of its exact text. DSoR asks it one
// question: which version of this policy is in force (DSOR-CTL-03a in specs/dsor/02-security.md,
// section 17.4). This one is fake: a stand-in that this tutorial writes itself, inside DSoR's
// program, with switches for a new version, "off", and "stuck", as step 19 wrote a stand-in for
// each company's directory. A real KSoR is a system of its own, reached over a network (step 28b's
// README, decision D1). DSoR's side of the question is in drift.ts.
import { createHash } from "node:crypto";

/** One version of a policy: its number, its text, and its fingerprint. */
export type PolicyVersion = { version: number; text: string; content_hash: string };

// KSoR answers with whatever it answers. DSoR checks the answer before it uses it, so the answer
// has no type here, as a directory's has none (step 19's README, decision 11).
/** A company's KSoR, as DSoR reaches it: one question, about one policy. */
export type Ksor = { ask: (uri: string) => Promise<unknown> };

/** Each company's KSoR, by company. */
export type Ksors = ReadonlyMap<string, Ksor>;

// A registry built with no KSoR knows no policy. A version that cites one cannot be switched on,
// and the sweep hears no answer (step 28b's README, decisions D4 and D12).
/** No KSoR for any company. */
export const NO_KSORS: Ksors = new Map();

/** The fingerprint of a policy's text, as KSoR computes it: sha256, and the SHA-256 of the text. */
export function fingerprintOf(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** A fake KSoR, with the switches that the story and the tests use. */
export type FakeKsor = Ksor & {
  /** Adds the next version of a policy, with this text, and gives it back. */
  publish: (uri: string, text: string) => PolicyVersion;
  /** Turns KSoR on, off, or stuck. */
  turn: (state: "on" | "off" | "stuck") => void;
  /** How many questions KSoR has been asked. */
  asked: () => number;
};

/**
 * A fake KSoR of one company, holding these versions of each policy. The newest version of a
 * policy is the one in force. It starts on. A version given here keeps the fingerprint it is
 * given: the story's version 4 came before this stand-in, with the short fingerprint of the
 * specification's example.
 */
export function fakeKsor(tenant: string, policies: Record<string, PolicyVersion[]>): FakeKsor {
  // A copy, so a caller that changes its own list cannot change KSoR afterwards.
  const kept = new Map(Object.entries(structuredClone(policies)));
  let state: "on" | "off" | "stuck" = "on";
  let questions = 0;
  /** The version in force: the one with the highest number. */
  const inForce = (uri: string): PolicyVersion | undefined =>
    (kept.get(uri) ?? []).reduce<PolicyVersion | undefined>(
      (newest, v) => (newest === undefined || v.version > newest.version ? v : newest),
      undefined,
    );
  return Object.freeze({
    ask: async (uri: string): Promise<unknown> => {
      questions += 1;
      // Off: the question fails at once, like a network that refuses to connect.
      if (state === "off") throw new Error(`the KSoR of ${tenant} is off`);
      // Stuck: the question is taken and never answered.
      if (state === "stuck") return new Promise<never>(() => {});
      // The answer names the company and the policy it is about, so DSoR can check that it
      // answers the question it asked, as a directory's does (step 19's README, C10).
      const version = inForce(uri);
      if (version === undefined) return { tenant, uri, listed: false };
      const { version: number, content_hash } = version;
      return { tenant, uri, listed: true, version: number, content_hash };
    },
    publish: (uri: string, text: string): PolicyVersion => {
      const next = (inForce(uri)?.version ?? 0) + 1;
      const version = { version: next, text, content_hash: fingerprintOf(text) };
      kept.set(uri, [...(kept.get(uri) ?? []), version]);
      return structuredClone(version);
    },
    turn: (to: "on" | "off" | "stuck"): void => {
      state = to;
    },
    asked: (): number => questions,
  });
}
