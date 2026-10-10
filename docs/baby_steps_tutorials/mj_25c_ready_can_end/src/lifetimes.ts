// NEW IN STEP 25c: each company's READY lifetime: how long a prepared draft may wait at READY before
// the sweep expires it (step 25c's README, decisions L2 and D2). It is read from
// ready-lifetimes.json at start-up and checked there, as role-sources.json is (step 19's README,
// decision 8). Each proposal keeps its own expiry, expires_at, which proposal.schema.json already
// has: the store sets it from its clock and this lifetime, when it makes the proposal.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { millisecondsOf } from "./authority.ts";
import { keysWrittenTwice } from "./json.ts";
import type { Principal } from "./principals.ts";
import { isTenantId } from "./uri.ts";

/** One company's READY lifetime, once start-up has checked it: the duration, and in milliseconds. */
export type Lifetime = { lifetime: string; ms: number };

/** Each company's READY lifetime, by company. */
export type Lifetimes = ReadonlyMap<string, Lifetime>;

/** The lifetimes file, as it was read from disk: its name and its text. */
export type LifetimesSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../ready-lifetimes.json", import.meta.url));

/** Reads the lifetimes file: this step's own, unless another is named. */
export function readLifetimes(path: string = SHIPPED): LifetimesSource {
  return { file: "ready-lifetimes.json", text: readFileSync(path, "utf8") };
}

// The specification's own pattern for a duration, so a lifetime is written as §9's max_rate_age
// and step 19's max_staleness are.
// copied from packages/spec/schemas/common.schema.json#/$defs/duration/pattern
const DURATION = /^P(?!$)([0-9]+D)?(T([0-9]+H)?([0-9]+M)?([0-9]+S)?)?$/;

// §44's longest life for an approval at L2 is 30 days (DSOR-APR-04a). A prepared draft waits no
// longer than an approval may (step 25c's README, decision L2).
const CEILING = 30 * 24 * 60 * 60 * 1000;

/** Checks each company's lifetime, and names every problem. */
export function checkLifetimes(
  source: LifetimesSource,
  principals: Iterable<Principal>,
): { lifetimes: Lifetimes; problems: string[] } {
  const { file, text } = source;
  const lifetimes = new Map<string, Lifetime>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { lifetimes, problems: [`${file}: not valid JSON`] };
  }
  // A list and null are objects in JavaScript too. Neither one names a company.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    const problem = `${file}: must be an object that gives each company its READY lifetime`;
    return { lifetimes, problems: [problem] };
  }
  // JSON.parse keeps the last of two lines for one company, and says nothing.
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  for (const [tenant, lifetime] of Object.entries(data)) {
    if (!isTenantId(tenant)) {
      problems.push(`${file}: ${JSON.stringify(tenant)} is not a company id like org_456`);
      continue;
    }
    const named = JSON.stringify(lifetime);
    if (typeof lifetime !== "string" || !DURATION.test(lifetime)) {
      problems.push(`${file}: ${tenant}'s lifetime ${named} is not a duration such as P7D`);
      continue;
    }
    // "PT" passes the specification's pattern too, and means nothing at all.
    const ms = millisecondsOf(lifetime);
    if (ms === 0) {
      const why = "is zero, so a READY proposal would expire as it is made";
      problems.push(`${file}: ${tenant}'s lifetime ${named} ${why}`);
      continue;
    }
    if (ms > CEILING) {
      const why = "is over 30 days, the longest §44 lets an approval live at L2";
      problems.push(`${file}: ${tenant}'s lifetime ${named} ${why}`);
      continue;
    }
    lifetimes.set(tenant, { lifetime, ms });
  }
  // Every company where a login works needs a lifetime, or no proposal could be made there.
  const companies = new Set<string>();
  for (const principal of principals) {
    for (const membership of principal.memberships) companies.add(membership.tenant_id);
  }
  for (const tenant of [...companies].sort()) {
    if (!Object.hasOwn(data, tenant)) {
      problems.push(`${file}: ${tenant} has no lifetime, and a login works there`);
    }
  }
  return { lifetimes, problems };
}
