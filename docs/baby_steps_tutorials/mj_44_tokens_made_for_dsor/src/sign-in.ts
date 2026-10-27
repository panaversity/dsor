// NEW IN STEP 44: the one sign-in server DSoR trusts, for every company, and what a token from it
//   must carry to be made for DSoR (DSOR-RP-02b, DSOR-IDN-04a). Start-up checks the file before any
//   caller can ask (step 44's README, claim C5, decisions 44-1, 44-2, 44-3, 44-9, Q2, R2).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The one sign-in server DSoR trusts, and what a token from it must carry. */
export type SignIn = {
  // The token's iss, exactly, and where that issuer publishes its public keys.
  issuer: string;
  jwks: string;
  // The algorithms a token may be signed with: never a shared secret, never none (decision 44-1).
  algorithms: readonly string[];
  // How long after its iat a token still counts, at most one hour, whatever its exp says (Q2).
  max_age: string;
  // DSoR's own address: the audience a token must name (DSOR-RP-02b; decision 44-3).
  audience: string;
  // The only other audiences a token may also name: the sign-in server's own userinfo address,
  //   which Better Auth adds when the client asks for openid (decision 44-9).
  other_audiences: readonly string[];
  // The scope a token must carry, and the clients DSoR knows (decision R2).
  scope: string;
  clients: readonly string[];
};

export type SignInSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../sign-in.json", import.meta.url));

/** The sign-in file: this step's own, unless a path is given. */
export function readSignIn(path: string = SHIPPED): SignInSource {
  return { file: "sign-in.json", text: readFileSync(path, "utf8") };
}

const FIELDS = [
  "issuer",
  "jwks",
  "algorithms",
  "max_age",
  "audience",
  "other_audiences",
  "scope",
  "clients",
] as const;

// The algorithms a token may name: each signs with a private key and checks with a public one.
//   Never a shared secret (HS…), which DSoR would have to hold, and never none (step 43's R4).
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
//   it (step 43's R4), now at most one hour (Q2).
const AGE = /^(\d{1,5})(s|m|h)$/;
const SECONDS = { s: 1, m: 60, h: 3600 } as const;
const HOUR = 3600;
// OpenID Connect's own scopes (Core, sections 5.4 and 11), which a sign-in server gives every app
//   that asks. A token carrying one says nothing about DSoR, so it can never be DSoR's scope (R2;
//   found by step 44's review: "scope": "openid" passed start-up, and the scope check meant nothing).
const EVERY_APPS = ["openid", "profile", "email", "offline_access", "phone", "address"];

const ADDRESS = "must be an https address, or http on this computer (127.0.0.1 or localhost)";

/**
 * The sign-in server in the file, and every problem with it: a field the file does not know, a
 * missing one, an address DSoR may not trust, an algorithm that is a shared secret or none, an age
 * over one hour, a scope that is not one word or is one every app is given, and a list of clients
 * that is empty or names one twice. With any problem, no sign-in server: DSoR does not start.
 */
export function checkSignIn(source: SignInSource): {
  signIn: SignIn | undefined;
  problems: string[];
} {
  const { file } = source;
  let data: unknown;
  try {
    data = JSON.parse(source.text);
  } catch (error) {
    return { signIn: undefined, problems: [`${file} is not JSON: ${(error as Error).message}`] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    const one = `${file} must be one object: the one sign-in server DSoR trusts`;
    return { signIn: undefined, problems: [one] };
  }
  const fields = data as Record<string, unknown>;
  const problems: string[] = [];
  const known: readonly string[] = FIELDS;
  for (const extra of Object.keys(fields).filter((f) => !known.includes(f))) {
    const only =
      "has only issuer, jwks, algorithms, max_age, audience, other_audiences, scope, and clients";
    problems.push(`${file} ${only}, not ${JSON.stringify(extra.slice(0, 60))}`);
  }
  for (const field of FIELDS) {
    if (!(field in fields)) {
      problems.push(`${file}: ${field} is missing`);
      continue;
    }
    const problem = fieldProblem(field, fields[field]);
    if (problem !== undefined) problems.push(`${file}: ${problem}`);
  }
  if (problems.length > 0) return { signIn: undefined, problems };
  const found = fields as SignIn;
  return {
    signIn: {
      issuer: found.issuer,
      jwks: found.jwks,
      algorithms: [...found.algorithms],
      max_age: found.max_age,
      audience: found.audience,
      other_audiences: [...found.other_audiences],
      scope: found.scope,
      clients: [...found.clients],
    },
    problems,
  };
}

// What is wrong with one field's value, or nothing.
function fieldProblem(field: (typeof FIELDS)[number], value: unknown): string | undefined {
  switch (field) {
    case "issuer":
    case "jwks":
    case "audience":
      return isTrustedAddress(value) ? undefined : `${field} ${ADDRESS}`;
    case "other_audiences":
      return Array.isArray(value) && value.every(isTrustedAddress)
        ? undefined
        : `other_audiences must be a list, each an https address, or http on this computer (127.0.0.1 or localhost)`;
    case "algorithms":
      return algorithmsProblem(value);
    case "max_age":
      return ageSeconds(value) === undefined
        ? "max_age must be a number of seconds, minutes, or hours, such as 1h, and at most 1h"
        : undefined;
    case "scope":
      // One scope token, as OAuth writes them: printable, with no space (RFC 6749, section 3.3).
      if (typeof value !== "string" || !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(value)) {
        return "scope must be one word, such as dsor";
      }
      return EVERY_APPS.includes(value)
        ? "scope must be DSoR's own, not one every app is given, such as openid"
        : undefined;
    case "clients":
      return clientsProblem(value);
  }
}

function algorithmsProblem(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return "algorithms must name at least one algorithm";
  }
  if (!value.every((a) => typeof a === "string" && ASYMMETRIC.includes(a))) {
    const names = `${ASYMMETRIC.slice(0, -1).join(", ")}, or ${ASYMMETRIC.at(-1)}`;
    return `algorithms may name only ${names}: never a shared secret, never none`;
  }
  return undefined;
}

function clientsProblem(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return "clients must name at least one client";
  }
  if (!value.every((c) => typeof c === "string" && c.length > 0)) {
    return "each client must be a name, not empty";
  }
  const twice = value.find((c, i) => value.indexOf(c) !== i);
  return twice === undefined ? undefined : `clients names ${JSON.stringify(twice)} twice`;
}

/**
 * What is wrong when the settings' audience is not this DSoR's own address: 127.0.0.1, where the
 * door listens (step 42's D7), at its port. A copy started on another port with these settings
 * would take tokens made for another DSoR (DSOR-RP-02b, "this DSoR deployment"; step 44's README,
 * decision 44-12, the learner's answer to the review's finding).
 */
export function audienceProblem(signIn: SignIn, port: number): string | undefined {
  const own = `http://127.0.0.1:${port}`;
  return signIn.audience === own
    ? undefined
    : `sign-in.json: audience is ${signIn.audience}, but this DSoR listens on ${own}`;
}

/** A token's most age in seconds, from a form such as 1h, or nothing when it is not one hour or less. */
export function ageSeconds(value: unknown): number | undefined {
  const found = typeof value === "string" ? AGE.exec(value) : null;
  const unit = found?.[2] as keyof typeof SECONDS | undefined;
  if (found === null || unit === undefined) return undefined;
  const seconds = Number(found[1]) * SECONDS[unit];
  return seconds > 0 && seconds <= HOUR ? seconds : undefined;
}

// An address DSoR may trust: https anywhere, or plain http only on this computer, where the
//   Panaversity SSO runs for the steps (decision 44-2). Never one that carries a name or password.
//   Changed in step 44: localhost too, because the SSO's branch names itself http://localhost:3011
//   in its own discovery document (found live 2026-10-27).
function isTrustedAddress(value: unknown): boolean {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
}
