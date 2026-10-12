// Where a rule came from, DSoR's side. Each rule cites the version of a policy it
// was built from, with the policy's fingerprint. DSoR asks the company's KSoR which version is in
// force: a switch-on asks, and so does the sweep, rule.check_authority, DSoR's own command, which
// marks each rule whose policy moved stale_authority and leaves its owner a notice (DSOR-CTL-03a in
// specs/dsor/02-security.md, section 17.4; step 28b's README, decisions D2 to D6). Never the
// rule's word, never the agent's. KSoR's side is in ksor.ts. Only dsor-scheduler, a system login
// holding rule:check, may sweep, which line ⑤ checks. A deployment's timer would call it at least
// once a day, the 24 hours of §44. This step builds no timer, as step 25c built none.
import { Refusal } from "./envelope.ts";
import type { Ksors } from "./ksor.ts";
import { preview } from "./registry.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { samePolicy, type InForce, type PolicyInForce, type RuleBy } from "./rulebook.ts";
import { parseUri } from "./uri.ts";

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

/**
 * Line ⑨: the company the sweep names must be the call's own, as the expiry sweep's must. The check
 * of the URIs refused another company's URI before line ⑥ (step 25c's README, decision D11).
 */
async function mayCheck(input: unknown, look: OwnLook): Promise<void> {
  const { id } = parseUri((input as { company: string }).company);
  if (id !== look.tenant) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no company ${preview(id)} here`, "internal");
  }
}

/** The policy a version cites in KSoR, and its version and fingerprint, or none for a rule that cites local. */
function citationOf(version: InForce): { uri: string; cited: PolicyInForce } | undefined {
  const { system, uri, version: number, content_hash } = version.authority;
  // A rule that cites local has no governed source, so nothing can supersede it (DSOR-CTL-01b).
  if (system !== "ksor" || typeof uri !== "string") return undefined;
  if (typeof number !== "number" || typeof content_hash !== "string") return undefined;
  return { uri, cited: { version: number, content_hash } };
}

/** The words of the notice to a version's owner: what changed, what DSoR did, and what to do. */
function noticeOf(version: InForce, uri: string, cited: number, now: PolicyInForce): string {
  const name = `Version ${version.version} of rule ${version.id}`;
  const where = JSON.stringify(uri);
  const todo = `Draft a version that cites version ${now.version}, and switch it on.`;
  if (version.stale !== undefined) {
    const moved = `KSoR now has version ${now.version} of ${where} in force`;
    return `${name} is stale_authority, and its policy moved again: ${moved}. ${todo}`;
  }
  const grace = `for its grace of ${version.stale_grace} as its on_stale says, ${version.on_stale}`;
  return (
    `${name} cites version ${cited} of ${where}, and KSoR now has version ${now.version} in ` +
    `force. DSoR marked it stale_authority. It still applies: ${grace}, and after that, on a ` +
    `high-risk operation, it asks a person at least. ${todo}`
  );
}

/**
 * The sweep's work, after line ⑩, inside the claim's transaction: every version in force that
 * cites a policy in KSoR, KSoR asked once for each policy, and each version whose policy moved
 * marked, under its rule's lock, with its record and a notice to its owner. A policy KSoR gave no
 * usable answer about marks nothing: DSoR marks only what it knows (step 28b's README, decisions
 * D3 to D6). It answers with counts, as the expiry sweep does.
 */
async function checkAuthority(_input: unknown, work: OwnStores): Promise<unknown> {
  const { tenant, caller, stores, correlation, now, ksor } = work;
  const cited = (await stores.controls.inForce(tenant)).flatMap((version) => {
    const citation = citationOf(version);
    return citation === undefined ? [] : [{ version, ...citation }];
  });
  const heard = new Map<string, Heard>();
  for (const { uri } of cited) {
    if (!heard.has(uri)) heard.set(uri, await ksor(uri));
  }
  // The record names the sweep's caller, as the expiry sweep's records do (step 25c's README,
  // decision D4).
  const words = "the policy it cites moved in KSoR";
  const by: RuleBy = { person: caller.id, as_of: now, words, correlation };
  let marked = 0;
  for (const { version, uri, cited: citation } of cited) {
    const answer = heard.get(uri);
    if (answer === undefined || !answer.answered) continue;
    const inForce = { version: answer.version, content_hash: answer.content_hash };
    // What DSoR last knew to be in force: the version the rule cites, or a stale one's mark.
    if (samePolicy(version.stale?.in_force ?? citation, inForce)) continue;
    await stores.controls.hold(tenant, version.id);
    const notice = noticeOf(version, uri, citation.version, inForce);
    const { id, version: number, stale } = version;
    if (await stores.controls.mark(tenant, id, number, stale, inForce, by, notice)) marked += 1;
  }
  const unanswered = [...heard.values()].filter((h) => !h.answered).length;
  return { tenant_id: tenant, asked: heard.size, unanswered, marked };
}

/**
 * Line ⑨ of a switch-on: KSoR confirms that the version of the policy that this version cites is
 * the one in force, with the fingerprint it cites. A version that cites local has nothing to
 * confirm. No answer DSoR can use refuses the switch-on for now; another version in force, or
 * another fingerprint, refuses it for good (step 28b's README, decision D12).
 */
export async function confirmCitation(
  name: string,
  version: InForce,
  ksor: PolicyLook,
): Promise<void> {
  const citation = citationOf(version);
  if (citation === undefined) return;
  const { uri, cited } = citation;
  const which = `version ${version.version} of rule ${version.id}`;
  const heard = await ksor(uri);
  if (!heard.answered) {
    const why = `DSoR cannot confirm with KSoR the policy that ${which} cites: ${heard.why}`;
    throw new Refusal("FRESHNESS_UNSATISFIABLE", `${name}: ${why}`, "internal");
  }
  const cites = `${which} cites version ${cited.version} of ${JSON.stringify(uri)}`;
  if (heard.version !== cited.version) {
    const why = `${cites}, and KSoR has version ${heard.version} in force`;
    throw new Refusal("VALIDATION_FAILED", `${name}: ${why}`, "internal");
  }
  if (heard.content_hash !== cited.content_hash) {
    const theirs = `KSoR's version ${heard.version} has ${heard.content_hash}`;
    const why = `${cites} with the fingerprint ${cited.content_hash}, and ${theirs}`;
    throw new Refusal("VALIDATION_FAILED", `${name}: ${why}`, "internal");
  }
}

/** DSoR's own work for the sweep. */
export function driftWorkFor(): Record<string, OwnWork> {
  return { "rule.check_authority": { check: mayCheck, change: checkAuthority } };
}
