// NEW IN STEP 28: the company's policies, as KSoR keeps them (decision 165).
//
// KSoR is the company's record of what it knows: its policies, in English, each with a version and
// a fingerprint of its text. A control says which policy sentence it came from, and which version.
// DSoR asks KSoR whether that is still the version in force, and never keeps the answer.
//
// This one is a fake, built like step 19's directory and step 26's rate service: one per company,
// which a test or the demo can give a new version of a policy, or switch off. A real one is KSoR
// itself, `panaversity/ksor`. What DSoR asks of it is the same.
//
// Rule DSOR-CTL-03a: DSoR MUST detect, within the bound of §44, that the authority a control cites
// has been superseded, and then mark the control `stale_authority` and notify its owner.

/** One version of one policy, as KSoR answers for it. */
export interface PolicyVersion {
  readonly uri: string;
  readonly version: number;
  /** A fingerprint of the text, so the same version with other words is told apart. */
  readonly content_hash: string;
  readonly text: string;
}

/** One company's KSoR. `current` throws when it cannot be reached, and says nothing for a policy it does not have. */
export interface PolicySource {
  readonly current: (uri: string) => PolicyVersion | undefined;
}

/** How a fake KSoR behaves. Everything left out is the plain case. */
export interface FakePolicies {
  /** Every ask throws, as a source that cannot be reached does. */
  readonly down?: boolean;
  /** Policies beside the story's, or in place of them, by address; `null` for one it no longer has. */
  readonly policies?: Readonly<Record<string, PolicyVersion | null>>;
}

/** The story's one policy: org_456's, version 4, the one migration 029's control came from. */
const STORY: Readonly<Record<string, PolicyVersion>> = Object.freeze({
  "ksor://org_456/finance/payment-approval-policy": Object.freeze({
    uri: "ksor://org_456/finance/payment-approval-policy",
    version: 4,
    content_hash: "sha256:9f2c1e7ab4d0",
    text: "Payments above 25,000 USD or equivalent require CFO approval.",
  }),
});

/** A fake KSoR for one company, with the story's policies, its own only, unless `fake` says otherwise. */
export function aPolicySource(tenant: string, fake: FakePolicies = {}): PolicySource {
  const policies: Readonly<Record<string, PolicyVersion | null>> = Object.freeze({
    ...STORY,
    ...fake.policies,
  });

  return Object.freeze({
    current: (uri: string): PolicyVersion | undefined => {
      if (fake.down === true) {
        throw new Error(`the KSoR of ${tenant} did not answer`);
      }

      // A company's KSoR holds its own policies only.
      const policy = Object.hasOwn(policies, uri) ? policies[uri] : undefined;

      return policy === null || policy === undefined || !uri.startsWith(`ksor://${tenant}/`)
        ? undefined
        : policy;
    },
  });
}

/** Each company's KSoR, where a test or the demo has set one. */
const configured = new Map<string, PolicySource>();

/** Give one company another KSoR, or `undefined` for its own fake again. */
export function usePolicySource(tenant: string, source: PolicySource | undefined): void {
  if (source === undefined) {
    configured.delete(tenant);
  } else {
    configured.set(tenant, source);
  }
}

/** The KSoR one company has. */
export function policySourceOf(tenant: string): PolicySource {
  return configured.get(tenant) ?? aPolicySource(tenant);
}
