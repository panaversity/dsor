// NEW IN STEP 44: a signed token, checked against the one sign-in server DSoR trusts. DSoR takes
//   nothing in it on trust: the signature with a key that server publishes, then the algorithm, the
//   issuer, the audience, the time, the scope, the client, and the subject. What it gives back is
//   only who signed in, and through which client: never a role (DSOR-IDN-01, DSOR-RP-02b,
//   DSOR-IDN-04a, DSOR-IDN-04b; step 44's README, claims C1 and C6, decisions 44-1, 44-9, R1, R2).
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { SignIn } from "./sign-in.ts";

/** Who signed in: the issuer, the subject (the person's id there), and the client that asked. */
export type Login = { issuer: string; subject: string; client: string };

/**
 * A token DSoR could not check because the server's keys could not be fetched. Not a bad token: the
 * caller hears an outage, and may try again (step 43's R5, kept by decision 44-1).
 */
export type Unavailable = { unavailable: string };

/**
 * Why a token was refused, from a short list. The caller never hears it: every bad token hears the
 * same answer (44-1). The record keeps it, so an administrator can tell an app replaying the CFO's
 * token from a token that is only old (step 44's README, decision 44-11). "unlisted" is the one
 * src/logins.ts gives: a good token for nobody in DSoR's table (44-10).
 */
export type Cause =
  | "form"
  | "algorithm"
  | "signature"
  | "issuer"
  | "audience"
  | "expired"
  | "too_old"
  | "not_yet"
  | "claims"
  | "scope"
  | "client"
  | "subject"
  | "unlisted";

/**
 * Who a refused token speaks for, once its signature checked: the server whose key signed it, and
 * the person and the client it names, when each is a name short enough to keep. Never the token.
 */
export type Signer = { issuer: string; subject?: string; client?: string };

/** A refused token: why, and who it speaks for when its signature checked (decision 44-11). */
export type Refused = { refused: Cause; signer?: Signer };

/** The published keys of a server, fetched and kept by their address. */
export type KeySets = (jwks: string) => JWTVerifyGetKey;

/**
 * Keys fetched from the server's address, kept for cacheMaxAge, and fetched again at once for a key
 * name the kept set lacks. Two seconds to answer, or the keys count as unreachable.
 */
export function remoteKeys(options: { cacheMaxAge?: number } = {}): KeySets {
  const sets = new Map<string, JWTVerifyGetKey>();
  return (jwks) => {
    let set = sets.get(jwks);
    if (set === undefined) {
      set = createRemoteJWKSet(new URL(jwks), {
        timeoutDuration: 2000,
        // Ten minutes, jose's own: a key the server stops publishing still works until then.
        cacheMaxAge: options.cacheMaxAge ?? 600_000,
      });
      sets.set(jwks, set);
    }
    return set;
  };
}

// Three parts of base64url, separated by dots, and not longer than 8192 characters.
// not copied: the specification sets no pattern for a token; this is the compact form of a JWT
//   (RFC 7519), checked before jose reads it (step 43's README, decision D4).
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const LONGEST = 8192;
// The longest person or client name a record keeps, in bytes, so a record always fits the
//   database's 1 KiB for this tutorial's own fields (migration 003b; the review's finding on 44-10).
const LONGEST_NAME = 200;

/**
 * Who signed in, when the token was made for DSoR: signed by a key the trusted server publishes,
 * with an allowed algorithm, its iss that server, its aud DSoR (and nothing else but the server's
 * own userinfo address), not expired and at most max_age after its iat (5 seconds for clocks), with
 * the scope, a client on DSoR's list, and a subject. Else the cause, and who the token speaks for
 * once its signature checked. It never throws: the caller hears one "no login" for every cause
 * (decisions 44-1 and 44-11).
 */
export async function checkedLogin(
  token: unknown,
  signIn: SignIn,
  keys: KeySets,
  now: () => number = Date.now,
): Promise<Login | Unavailable | Refused> {
  if (typeof token !== "string" || token.length > LONGEST || !JWT.test(token)) {
    return { refused: "form" };
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keys(signIn.jwks), {
      issuer: signIn.issuer,
      // jose checks that DSoR's address is one of the audiences (DSOR-RP-02b).
      audience: signIn.audience,
      algorithms: [...signIn.algorithms],
      // An iat is always required, so a token whose exp says the year 3000 still ends (Q2).
      requiredClaims: ["sub", "exp", "iat"],
      maxTokenAge: signIn.max_age,
      clockTolerance: 5,
      currentDate: new Date(now()),
    }));
  } catch (error) {
    // Keys that did not come, or came broken, are an outage of the server, not a bad token. A key
    //   the server does not publish, a wrong signature, or a wrong claim is a bad token.
    if (keysUnreachable(error)) return { unavailable: signIn.issuer };
    return refusal(causeOf(error), signIn, checkedPayload(error));
  }
  if (!onlyAllowedAudiences(payload.aud, signIn)) return refusal("audience", signIn, payload);
  if (!hasScope(payload["scope"], signIn.scope)) return refusal("scope", signIn, payload);
  const client = clientOf(payload);
  if (client === undefined || !signIn.clients.includes(client)) {
    return refusal("client", signIn, payload);
  }
  const subject = nameOf(payload.sub);
  if (subject === undefined) return refusal("subject", signIn, payload);
  return { issuer: signIn.issuer, subject, client };
}

// A refusal, and, for a token whose signature checked, who it speaks for. The person and the client
//   are kept only as names short enough for the record; the token itself never is (44-11).
function refusal(cause: Cause, signIn: SignIn, payload: JWTPayload | undefined): Refused {
  if (payload === undefined) return { refused: cause };
  const subject = nameOf(payload.sub);
  const client = nameOf(clientOf(payload));
  return {
    refused: cause,
    signer: {
      issuer: signIn.issuer,
      ...(subject === undefined ? {} : { subject }),
      ...(client === undefined ? {} : { client }),
    },
  };
}

// A name, not empty, and at most LONGEST_NAME bytes in UTF-8, or none.
function nameOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return Buffer.byteLength(value, "utf8") <= LONGEST_NAME ? value : undefined;
}

// jose checks the signature before any claim, so a claim it refused belongs to a token whose
//   signature checked, and its error carries the claims. Any other error has none to name.
function checkedPayload(error: unknown): JWTPayload | undefined {
  const claimFailed =
    error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired;
  return claimFailed ? error.payload : undefined;
}

// Why jose refused a token, by the kind of its error and the claim it names.
function causeOf(error: unknown): Cause {
  if (error instanceof errors.JOSEAlgNotAllowed) return "algorithm";
  if (
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWSSignatureVerificationFailed
  ) {
    return "signature";
  }
  if (error instanceof errors.JWTExpired) return error.claim === "iat" ? "too_old" : "expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "aud") return "audience";
    if (error.claim === "iss") return "issuer";
    if (error.claim === "sub") return "subject";
    const timed = error.claim === "iat" || error.claim === "nbf";
    return timed && error.reason === "check_failed" ? "not_yet" : "claims";
  }
  return "form";
}

// Every audience the token names is DSoR's, or one the settings allow beside it: a token also made
//   for another app is refused, because that app received it too and could hand it on (44-9).
function onlyAllowedAudiences(aud: JWTPayload["aud"], signIn: SignIn): boolean {
  const named = typeof aud === "string" ? [aud] : (aud ?? []);
  return named.every((a) => a === signIn.audience || signIn.other_audiences.includes(a));
}

// The scope claim is a list of words separated by spaces (RFC 8693, section 4.2). The word must be
//   there whole: "dsor-admin" is not "dsor" (decision R2).
function hasScope(scope: unknown, wanted: string): boolean {
  return typeof scope === "string" && scope.split(" ").includes(wanted);
}

// The client, named in client_id (RFC 9068) or azp (OpenID Connect), and the same in both when both
//   are there. Neither, an empty name, or two different names: no client (decision R1).
function clientOf(payload: JWTPayload): string | undefined {
  const named = [payload["client_id"], payload["azp"]].filter((c) => c !== undefined);
  if (named.length === 0) return undefined;
  const [first] = named;
  if (typeof first !== "string" || first === "") return undefined;
  return named.every((c) => c === first) ? first : undefined;
}

// Whether jose failed to get the server's keys: a timeout, an answer that is not 200, keys that are
//   not a key set, or no answer at all. Everything else jose throws is about the token.
function keysUnreachable(error: unknown): boolean {
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return true;
  if (!(error instanceof errors.JOSEError)) return true;
  return error.code === "ERR_JOSE_GENERIC" && /JSON Web Key Set HTTP response/.test(error.message);
}
