// NEW IN STEP 43: the sign-in services each company trusts. A token is accepted only from an issuer
//   that the company configured, here, as authoritative (DSOR-IDN-04a). Start-up checks the file
//   before any caller can ask (step 43's README, claim C1, decision D3).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Principal } from "./principals.ts";

/**
 * One sign-in service: who signs its tokens, whom they are for, and where its public keys are. And,
 * after start-up, the algorithms it signs with and how old a token may be.
 */
export type Issuer = {
  issuer: string;
  audience: string;
  jwks: string;
  // Changed by the learner's R4 and R6, 2026-10-24: stated as a sign-in service only DSoR uses, and
  //   its own algorithms and the most age of a token. Left out, they are Neon's (step 43's README).
  dedicated_to_dsor?: true;
  algorithms?: readonly string[];
  max_age?: string;
};

// The algorithms an issuer may name: each one signs with a private key and checks with a public one.
//   Never a shared secret (HS…), which DSoR would have to hold, and never none (decision R4).
const ASYMMETRIC = [
  "EdDSA",
  "ES256",
  "ES384",
  "ES512",
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
];
// not copied: the specification sets no form for a token's age; this tutorial's own, as jose reads
//   it, at most 24 hours (decision R4).
const AGE = /^(\d{1,5})(s|m|h)$/;
const SECONDS = { s: 1, m: 60, h: 3600 } as const;

// What an issuer that names no algorithms and no age gets: Managed Better Auth's (decision D4).
const NEON_ALGORITHMS = ["EdDSA"];
const NEON_MAX_AGE = "15m";

/** Each company's issuers. */
export type Issuers = ReadonlyMap<string, readonly Issuer[]>;

export type IssuersSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../issuers.json", import.meta.url));

/** The issuers file: this step's own, unless a path is given. */
export function readIssuers(path: string = SHIPPED): IssuersSource {
  return { file: "issuers.json", text: readFileSync(path, "utf8") };
}

const ADDRESSES = ["issuer", "audience", "jwks"] as const;
const FIELDS: readonly string[] = [...ADDRESSES, "dedicated_to_dsor", "algorithms", "max_age"];

/**
 * The issuers in the file, and every problem with it: a company where people log in that names no
 * issuer, a company where nobody does, an address that is not https (or http on 127.0.0.1, for a
 * stand-in on this computer), a field the file does not know, and an issuer named twice.
 */
export function checkIssuers(
  source: IssuersSource,
  principals: Iterable<Principal>,
): { issuers: Issuers; problems: string[] } {
  const { file } = source;
  const problems: string[] = [];
  const issuers = new Map<string, Issuer[]>();
  const refused = new Set<string>();
  let data: unknown;
  try {
    data = JSON.parse(source.text);
  } catch (error) {
    return { issuers, problems: [`${file} is not JSON: ${(error as Error).message}`] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { issuers, problems: [`${file} must be one list of issuers for each company`] };
  }
  // The companies where a person logs in. Agents and system logins keep step 05's table until step
  //   44 (decision D1).
  const people = [...principals].filter((p) => p.type === "human");
  const working = new Set(people.flatMap((p) => p.memberships.map((m) => m.tenant_id)));
  for (const [tenant, list] of Object.entries(data)) {
    if (!working.has(tenant)) {
      problems.push(`${file}: ${tenant} is no company where people log in`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`${file}: ${tenant} must be a list of issuers`);
      refused.add(tenant);
      continue;
    }
    const kept: Issuer[] = [];
    list.forEach((entry: unknown, i: number) => {
      const where = `${file}: ${tenant}, issuer ${i + 1}`;
      const fields =
        typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
      const extra = Object.keys(fields).find((f) => !FIELDS.includes(f));
      if (extra !== undefined) {
        const only =
          "an issuer has only issuer, audience, jwks, dedicated_to_dsor, algorithms, and max_age";
        problems.push(`${where}: ${only}, not ${JSON.stringify(extra.slice(0, 60))}`);
        return;
      }
      const bad = ADDRESSES.find((f) => !isTrustedAddress(fields[f]));
      if (bad !== undefined) {
        problems.push(`${where}: ${bad} must be an https address, or http on 127.0.0.1`);
        return;
      }
      const rule = ruleProblem(fields);
      if (rule !== undefined) {
        problems.push(`${where}: ${rule}`);
        return;
      }
      const issuer = fields as Issuer;
      if (kept.some((k) => k.issuer === issuer.issuer)) {
        problems.push(`${file}: ${tenant} names ${issuer.issuer} twice`);
        return;
      }
      kept.push({
        issuer: issuer.issuer,
        audience: issuer.audience,
        jwks: issuer.jwks,
        dedicated_to_dsor: true,
        algorithms: [...(issuer.algorithms ?? NEON_ALGORITHMS)],
        max_age: issuer.max_age ?? NEON_MAX_AGE,
      });
    });
    if (kept.length === list.length && kept.length > 0) issuers.set(tenant, kept);
    else if (kept.length !== list.length) refused.add(tenant);
  }
  // One issuer, one meaning: the token check finds an issuer by its name alone (tokens.ts).
  const first = new Map<string, { tenant: string; issuer: Issuer }>();
  for (const [tenant, list] of issuers) {
    for (const issuer of list) {
      const seen = first.get(issuer.issuer);
      if (seen === undefined) first.set(issuer.issuer, { tenant, issuer });
      else if (JSON.stringify(seen.issuer) !== JSON.stringify(issuer)) {
        const why = `is set differently in ${tenant} than in ${seen.tenant}`;
        problems.push(`${file}: ${issuer.issuer} ${why}`);
      }
    }
  }
  for (const tenant of [...working].sort()) {
    // A company whose list was refused is named once, for its list, not again here.
    if (!issuers.has(tenant) && !refused.has(tenant)) {
      problems.push(`${file}: ${tenant}, where people log in, names no issuer`);
    }
  }
  return { issuers, problems };
}

// An address DSoR may trust: https anywhere, or plain http only on this computer, where the
//   stand-in for Managed Better Auth runs (decisions D3 and D9).
function isTrustedAddress(value: unknown): boolean {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.username !== "" || url.password !== "") return false;
  return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1");
}

// What is wrong with an issuer's own rules, or nothing: stated as dedicated to DSoR, and algorithms
//   and an age DSoR may accept (decisions R4 and R6).
function ruleProblem(fields: Record<string, unknown>): string | undefined {
  if (fields["dedicated_to_dsor"] !== true) {
    const why = "a sign-in service shared with another app makes that app's tokens DSoR tokens";
    return `dedicated_to_dsor must be true: ${why}`;
  }
  const algorithms = fields["algorithms"];
  if (algorithms !== undefined) {
    if (!Array.isArray(algorithms) || algorithms.length === 0) {
      return "algorithms must name at least one algorithm";
    }
    if (!algorithms.every((a) => typeof a === "string" && ASYMMETRIC.includes(a))) {
      const names = `${ASYMMETRIC.slice(0, -1).join(", ")}, or ${ASYMMETRIC.at(-1)}`;
      return `algorithms may name only ${names}: never a shared secret, never none`;
    }
  }
  const age = fields["max_age"];
  if (age !== undefined) {
    const found = typeof age === "string" ? AGE.exec(age) : null;
    const unit = found?.[2] as keyof typeof SECONDS | undefined;
    const seconds =
      found === null || unit === undefined ? Infinity : Number(found[1]) * SECONDS[unit];
    if (seconds <= 0 || seconds > 86_400) {
      return "max_age must be a number of seconds, minutes, or hours, such as 15m, and at most 24h";
    }
  }
  return undefined;
}
