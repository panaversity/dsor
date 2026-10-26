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

/**
 * Who signed in, when the token was made for DSoR: signed by a key the trusted server publishes,
 * with an allowed algorithm, its iss that server, its aud DSoR (and nothing else but the server's
 * own userinfo address), not expired and at most max_age after its iat (5 seconds for clocks), with
 * the scope, a client on DSoR's list, and a subject. Else none. It never throws: every reason a
 * token fails is the same "no login" (decision 44-1).
 */
export async function checkedLogin(
  token: unknown,
  signIn: SignIn,
  keys: KeySets,
  now: () => number = Date.now,
): Promise<Login | Unavailable | undefined> {
  if (typeof token !== "string" || token.length > LONGEST || !JWT.test(token)) return undefined;
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
    return keysUnreachable(error) ? { unavailable: signIn.issuer } : undefined;
  }
  if (!onlyAllowedAudiences(payload.aud, signIn)) return undefined;
  if (!hasScope(payload["scope"], signIn.scope)) return undefined;
  const client = clientOf(payload);
  if (client === undefined || !signIn.clients.includes(client)) return undefined;
  if (typeof payload.sub !== "string" || payload.sub === "") return undefined;
  return { issuer: signIn.issuer, subject: payload.sub, client };
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
