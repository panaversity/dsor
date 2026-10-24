// Since step 43: a signed token, checked. DSoR takes nothing in it on trust: it finds the issuer
//   the token names in its own list, checks the signature with a key that issuer publishes, then
//   the algorithm, the audience, the time, and the subject. What it gives back is only who signed
//   in, and where: never a role (DSOR-IDN-01, DSOR-IDN-04a, DSOR-IDN-04b; step 43's README, claims
//   C2 and C7, decisions D2, D4, and D7).
import { createRemoteJWKSet, decodeJwt, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Issuer, Issuers } from "./issuers.ts";

/** Who signed in: the issuer, as DSoR's list names it, and the subject, the user's id there. */
export type Login = { issuer: string; subject: string };

/**
 * Changed by the learner's R5: a token DSoR could not check because the issuer's keys could not be
 * fetched. Not a bad token: the caller hears an outage, and may try again.
 */
export type Unavailable = { unavailable: string };

/** The published keys of an issuer, fetched and kept by their address. */
export type KeySets = (jwks: string) => JWTVerifyGetKey;

/**
 * Keys fetched from each issuer's address, kept for cacheMaxAge, and fetched again at once for a key
 * name the kept set lacks. Two seconds to answer, or the keys count as unreachable.
 */
export function remoteKeys(options: { cacheMaxAge?: number } = {}): KeySets {
  const sets = new Map<string, JWTVerifyGetKey>();
  return (jwks) => {
    let set = sets.get(jwks);
    if (set === undefined) {
      set = createRemoteJWKSet(new URL(jwks), {
        timeoutDuration: 2000,
        // Ten minutes, jose's own: a key the issuer stops publishing still works until then.
        cacheMaxAge: options.cacheMaxAge ?? 600_000,
      });
      sets.set(jwks, set);
    }
    return set;
  };
}

// Three parts of base64url, separated by dots. A longer text is no token Managed Better Auth gives.
// not copied: the specification sets no pattern for a token; this is the compact form of a JWT
//   (RFC 7519), checked before jose reads it (step 43's README, decision D4).
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const LONGEST = 8192;

/**
 * Who signed in, when the token is a signed token of a configured issuer, signed with a key it
 * publishes, with EdDSA, for its audience, not expired and at most 15 minutes old (5 seconds for
 * clocks), with a subject. Else
 * none. It never throws: every reason a token fails is the same "no login" (decision D7).
 */
export async function checkedLogin(
  token: unknown,
  issuers: Issuers,
  keys: KeySets,
  now: () => number = Date.now,
): Promise<Login | Unavailable | undefined> {
  if (typeof token !== "string" || token.length > LONGEST || !JWT.test(token)) return undefined;
  // The issuer the token names, read before any check, only to choose which issuer's keys to
  //   check it with. Nothing else is read from an unchecked token.
  let named: unknown;
  try {
    named = decodeJwt(token).iss;
  } catch {
    return undefined;
  }
  const issuer = issuerNamed(issuers, named);
  if (issuer === undefined) return undefined;
  try {
    const { payload } = await jwtVerify(token, keys(issuer.jwks), {
      issuer: issuer.issuer,
      audience: issuer.audience,
      // Changed by the learner's R4: the issuer's own algorithms and age, Neon's when it names none
      //   (EdDSA and 15 minutes). An iat is always required, so a token whose exp says the year 3000
      //   still ends (the review's L3).
      algorithms: [...(issuer.algorithms ?? ["EdDSA"])],
      requiredClaims: ["sub", "exp", "iat"],
      maxTokenAge: issuer.max_age ?? "15m",
      clockTolerance: 5,
      currentDate: new Date(now()),
    });
    if (typeof payload.sub !== "string" || payload.sub === "") return undefined;
    return { issuer: issuer.issuer, subject: payload.sub };
  } catch (error) {
    // Keys that did not come, or came broken, are an outage of the issuer, not a bad token. A key
    //   the issuer does not publish, a wrong signature, or a wrong claim is a bad token (R5).
    return keysUnreachable(error) ? { unavailable: issuer.issuer } : undefined;
  }
}

// The configured issuer of this exact name, in any company. Start-up made sure that an issuer two
//   companies name has the same audience and keys in both (issuers.ts).
function issuerNamed(issuers: Issuers, named: unknown): Issuer | undefined {
  if (typeof named !== "string") return undefined;
  for (const list of issuers.values()) {
    const found = list.find((i) => i.issuer === named);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Whether jose failed to get the issuer's keys: a timeout, an answer that is not 200, keys that are
//   not a key set, or no answer at all. Everything else jose throws is about the token (R5).
function keysUnreachable(error: unknown): boolean {
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return true;
  if (!(error instanceof errors.JOSEError)) return true;
  return error.code === "ERR_JOSE_GENERIC" && /JSON Web Key Set HTTP response/.test(error.message);
}
