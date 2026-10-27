// NEW IN STEP 44: the one sign-in server DSoR trusts, in sign-in.json, checked at start-up
// (DSOR-RP-02b, DSOR-IDN-04a; step 44's README, claim C5, decisions 44-1, 44-2, 44-3, 44-9, Q2, R2).
import { describe, expect, it } from "vitest";
import { audienceProblem, checkSignIn, readSignIn, type SignIn } from "../src/sign-in.ts";

// The Panaversity SSO's branch feat/sso-dsor-fix-list, served on this computer. Its own discovery
//   document names its issuer http://localhost:3011 (found live 2026-10-27), so that is the issuer.
const SSO = "http://localhost:3011";
const GOOD = {
  issuer: SSO,
  jwks: `${SSO}/api/auth/jwks`,
  algorithms: ["RS256"],
  max_age: "1h",
  audience: "http://127.0.0.1:8042",
  other_audiences: [`${SSO}/api/auth/oauth2/userinfo`],
  scope: "dsor",
  clients: ["dsor-people"],
};

/** The problems of a file with this content. */
function problemsOf(data: unknown): string[] {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return checkSignIn({ file: "sign-in.json", text }).problems;
}

/** The good file, with these fields changed. */
function goodWith(change: Record<string, unknown>): Record<string, unknown> {
  return { ...GOOD, ...change };
}

const ADDRESS = "must be an https address, or http on this computer (127.0.0.1 or localhost)";

describe("C5: sign-in.json, checked at start-up", () => {
  it("Step 44, 44-2: the shipped sign-in.json passes, and names the Panaversity SSO's branch on this computer", () => {
    const { signIn, problems } = checkSignIn(readSignIn());
    expect(problems).toStrictEqual([]);
    expect(signIn).toStrictEqual(GOOD);
  });

  it("DSOR-RP-02b: start-up refuses a file with no audience, or an audience that is not an address", () => {
    const { audience: _gone, ...none } = GOOD;
    expect(problemsOf(none)).toStrictEqual(["sign-in.json: audience is missing"]);
    expect(problemsOf(goodWith({ audience: "dsor" }))).toStrictEqual([
      `sign-in.json: audience ${ADDRESS}`,
    ]);
  });

  it("Step 44, 44-1: start-up refuses none and every shared-secret algorithm, such as HS256", () => {
    const only =
      "sign-in.json: algorithms may name only EdDSA, ES256, ES384, ES512, RS256, RS384, RS512, PS256, PS384, or PS512: never a shared secret, never none";
    expect(problemsOf(goodWith({ algorithms: ["none"] }))).toStrictEqual([only]);
    expect(problemsOf(goodWith({ algorithms: ["RS256", "HS256"] }))).toStrictEqual([only]);
    expect(problemsOf(goodWith({ algorithms: [] }))).toStrictEqual([
      "sign-in.json: algorithms must name at least one algorithm",
    ]);
  });

  it("Step 44, Q2: start-up refuses an age over one hour; 1h, 60m, and 3600s pass", () => {
    const age =
      "sign-in.json: max_age must be a number of seconds, minutes, or hours, such as 1h, and at most 1h";
    for (const fine of ["1h", "60m", "3600s", "15m"]) {
      expect(problemsOf(goodWith({ max_age: fine }))).toStrictEqual([]);
    }
    // x1h and 1hx: the age is the whole value, not a part of it (the review's mutation sweep).
    for (const bad of ["61m", "2h", "3601s", "0s", "PT1H", 3600, "x1h", "1hx"]) {
      expect(problemsOf(goodWith({ max_age: bad }))).toStrictEqual([age]);
    }
  });

  it("Step 44, R2: start-up refuses a file with no dsor scope, an empty scope, or two scopes in one", () => {
    const { scope: _gone, ...none } = GOOD;
    expect(problemsOf(none)).toStrictEqual(["sign-in.json: scope is missing"]);
    const word = "sign-in.json: scope must be one word, such as dsor";
    expect(problemsOf(goodWith({ scope: "" }))).toStrictEqual([word]);
    expect(problemsOf(goodWith({ scope: "dsor openid" }))).toStrictEqual([word]);
    // A quote and a backslash are no part of a scope's word (RFC 6749, section 3.3).
    expect(problemsOf(goodWith({ scope: 'ds"or' }))).toStrictEqual([word]);
    expect(problemsOf(goodWith({ scope: "ds\\or" }))).toStrictEqual([word]);
  });

  it("Step 44, R2: start-up refuses a scope every app is given, such as openid, which says nothing about DSoR", () => {
    // OpenID Connect's own scopes (Core, sections 5.4 and 11). With one of them, R2's scope check
    //   would pass every app's token (found by step 44's review).
    const own =
      "sign-in.json: scope must be DSoR's own, not one every app is given, such as openid";
    for (const shared of ["openid", "profile", "email", "offline_access", "phone", "address"]) {
      expect(problemsOf(goodWith({ scope: shared }))).toStrictEqual([own]);
    }
  });

  it("Step 44, R2: start-up refuses an empty list of clients, an empty name, and a client named twice", () => {
    expect(problemsOf(goodWith({ clients: [] }))).toStrictEqual([
      "sign-in.json: clients must name at least one client",
    ]);
    expect(problemsOf(goodWith({ clients: ["dsor-people", ""] }))).toStrictEqual([
      "sign-in.json: each client must be a name, not empty",
    ]);
    expect(problemsOf(goodWith({ clients: ["dsor-people", "dsor-people"] }))).toStrictEqual([
      'sign-in.json: clients names "dsor-people" twice',
    ]);
  });

  it("Step 44, 44-2: start-up refuses an issuer or a keys address that is not https, or http on this computer", () => {
    expect(problemsOf(goodWith({ issuer: "http://sso.example.com" }))).toStrictEqual([
      `sign-in.json: issuer ${ADDRESS}`,
    ]);
    expect(problemsOf(goodWith({ jwks: "/api/auth/jwks" }))).toStrictEqual([
      `sign-in.json: jwks ${ADDRESS}`,
    ]);
    expect(problemsOf(goodWith({ issuer: "https://user:secret@sso.example.com" }))).toStrictEqual([
      `sign-in.json: issuer ${ADDRESS}`,
    ]);
    // A password with no name, and a scheme that is not http, even on this computer.
    expect(problemsOf(goodWith({ issuer: "https://:secret@sso.example.com" }))).toStrictEqual([
      `sign-in.json: issuer ${ADDRESS}`,
    ]);
    expect(problemsOf(goodWith({ jwks: "ftp://localhost:3011/api/auth/jwks" }))).toStrictEqual([
      `sign-in.json: jwks ${ADDRESS}`,
    ]);
    expect(problemsOf(goodWith({ issuer: "https://auth.panaversity.org" }))).toStrictEqual([]);
  });

  it("Step 44, 44-2: with any problem, the file gives no sign-in server at all, so pnpm serve cannot start on part of one", () => {
    const { audience: _gone, ...noAudience } = GOOD;
    const bad = [
      noAudience,
      goodWith({ algorithms: ["HS256"] }),
      goodWith({ max_age: "2h" }),
      goodWith({ scope: "openid" }),
      goodWith({ clients: [] }),
      goodWith({ issuer: "http://sso.example.com" }),
      goodWith({ dedicated_to_dsor: true }),
    ];
    for (const data of bad) {
      const { signIn, problems } = checkSignIn({
        file: "sign-in.json",
        text: JSON.stringify(data),
      });
      expect(problems).toHaveLength(1);
      expect(signIn).toBeUndefined();
    }
  });

  it("Step 44, 44-9: other_audiences must be a list of addresses, and an empty list passes", () => {
    expect(problemsOf(goodWith({ other_audiences: [] }))).toStrictEqual([]);
    const list =
      "sign-in.json: other_audiences must be a list, each an https address, or http on this computer (127.0.0.1 or localhost)";
    expect(problemsOf(goodWith({ other_audiences: "http://localhost:3011" }))).toStrictEqual([
      list,
    ]);
    expect(problemsOf(goodWith({ other_audiences: ["the class app"] }))).toStrictEqual([list]);
  });

  it("Step 44: a field the file does not know, and a missing one, are refused", () => {
    expect(problemsOf(goodWith({ dedicated_to_dsor: true }))).toStrictEqual([
      'sign-in.json has only issuer, jwks, algorithms, max_age, audience, other_audiences, scope, and clients, not "dedicated_to_dsor"',
    ]);
    const { jwks: _gone, ...none } = GOOD;
    expect(problemsOf(none)).toStrictEqual(["sign-in.json: jwks is missing"]);
  });

  it("DSOR-RP-02b: a DSoR starts only when its audience is its own address, so a copy on 8043 takes no token made for 8042 (44-12)", () => {
    const shipped = checkSignIn(readSignIn()).signIn as SignIn;
    expect(audienceProblem(shipped, 8042)).toBeUndefined();
    expect(audienceProblem(shipped, 8043)).toBe(
      "sign-in.json: audience is http://127.0.0.1:8042, but this DSoR listens on http://127.0.0.1:8043",
    );
    // The door listens on 127.0.0.1 only (step 42's D7), so localhost is another address.
    const named = { ...shipped, audience: "http://localhost:8042" };
    expect(audienceProblem(named, 8042)).toBe(
      "sign-in.json: audience is http://localhost:8042, but this DSoR listens on http://127.0.0.1:8042",
    );
  });

  it("Step 44: a file that is not JSON, or not one object, is refused", () => {
    expect(problemsOf("{ issuer:")[0]).toMatch(/^sign-in\.json is not JSON: /);
    const one = "sign-in.json must be one object: the one sign-in server DSoR trusts";
    expect(problemsOf([GOOD])).toStrictEqual([one]);
    expect(problemsOf("null")).toStrictEqual([one]);
  });
});
