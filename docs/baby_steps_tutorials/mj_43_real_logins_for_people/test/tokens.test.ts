// Step 43: a signed token is accepted only when its issuer is one a company configured, its
// signature checks against a key that issuer publishes, and its algorithm, audience, subject, and
// time are right. Anything else is no login at all (DSOR-IDN-01, DSOR-IDN-04a; step 43's README,
// claims C2 and C7, decisions D4 and D7).
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Issuers } from "../src/issuers.ts";
import { checkedLogin, remoteKeys } from "../src/tokens.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";

let a: TestIssuer;
let stranger: TestIssuer;
let issuers: Issuers;
beforeAll(async () => {
  a = await startIssuer();
  stranger = await startIssuer();
  issuers = new Map([["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]]]);
});
afterAll(async () => {
  await a.close();
  await stranger.close();
});

const keys = remoteKeys();
const seconds = (): number => Math.floor(Date.now() / 1000);
const part = (x: unknown): string => Buffer.from(JSON.stringify(x)).toString("base64url");

describe("C2: what a token must be", () => {
  it("DSOR-IDN-01: a token of a configured issuer, signed with its key, gives its issuer and subject", async () => {
    const token = await a.sign("ba_user_8c1f");
    expect(await checkedLogin(token, issuers, keys)).toStrictEqual({
      issuer: a.issuer,
      subject: "ba_user_8c1f",
    });
  });

  it("DSOR-IDN-04a: a perfect-looking token signed with another key, naming the configured issuer, is refused", async () => {
    const forged = await stranger.sign(
      "ba_user_8c1f",
      { iss: a.issuer, aud: a.audience },
      { kid: "key-1" },
    );
    expect(await checkedLogin(forged, issuers, keys)).toBeUndefined();
  });

  it("DSOR-IDN-04a: a real token of an issuer no company configured is refused", async () => {
    expect(await checkedLogin(await stranger.sign("ba_user_8c1f"), issuers, keys)).toBeUndefined();
  });

  it("Step 43, D4: a token that names HS256, signed with the issuer's public key as a secret, is refused", async () => {
    const res = await fetch(a.jwks);
    const { keys: published } = (await res.json()) as { keys: { x: string }[] };
    const head = part({ alg: "HS256", kid: "key-1", typ: "JWT" });
    const body = part({
      iss: a.issuer,
      aud: a.audience,
      sub: "ba_user_8c1f",
      exp: seconds() + 900,
    });
    const mac = createHmac("sha256", published[0]?.x ?? "")
      .update(`${head}.${body}`)
      .digest("base64url");
    expect(await checkedLogin(`${head}.${body}.${mac}`, issuers, keys)).toBeUndefined();
  });

  it("Step 43, D4: a token signed with ES256 by a key its own issuer publishes is refused: EdDSA only", async () => {
    // Found by break B2: jose already refuses none, and HS256 against an Ed25519 key, so only an
    //   issuer that publishes a key of another kind shows the list of algorithms at work.
    const es = await startIssuer("ES256");
    const only = new Map([
      ["org_456", [{ issuer: es.issuer, audience: es.audience, jwks: es.jwks }]],
    ]);
    expect(await checkedLogin(await es.sign("ba_8c1f"), only, remoteKeys())).toBeUndefined();
    await es.close();
  });

  it("Step 43, D4: a token that names no algorithm, with no signature, is refused", async () => {
    const head = part({ alg: "none", typ: "JWT" });
    const body = part({
      iss: a.issuer,
      aud: a.audience,
      sub: "ba_user_8c1f",
      exp: seconds() + 900,
    });
    expect(await checkedLogin(`${head}.${body}.`, issuers, keys)).toBeUndefined();
  });

  it("Step 43, D4: a token for another audience is refused", async () => {
    const token = await a.sign("ba_user_8c1f", { aud: "https://another-app.example" });
    expect(await checkedLogin(token, issuers, keys)).toBeUndefined();
  });

  it("Step 43, D4: a token with no subject is refused", async () => {
    expect(await checkedLogin(await a.sign(undefined), issuers, keys)).toBeUndefined();
  });

  it("Step 43, D4: a token expired 10 seconds ago is refused; one expired 3 seconds ago passes, inside the 5 seconds for clocks", async () => {
    const old = await a.sign("ba_user_8c1f", { exp: seconds() - 10 });
    const justNow = await a.sign("ba_user_8c1f", { exp: seconds() - 3 });
    expect(await checkedLogin(old, issuers, keys)).toBeUndefined();
    expect(await checkedLogin(justNow, issuers, keys)).toStrictEqual({
      issuer: a.issuer,
      subject: "ba_user_8c1f",
    });
  });

  it.each([undefined, 42, "tok_d4e8", "a.b", "a.b.c", "x".repeat(20000)])(
    "Step 43, D7: %s is no signed token, and is refused without a throw",
    async (token) => {
      expect(await checkedLogin(token, issuers, keys)).toBeUndefined();
    },
  );
});

describe("C7: how long a key and a token count (the review's M1 and L3)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Step 43, D2: with the shipped cache, a key the issuer stops publishing still counts for ten minutes, and not after", async () => {
    const b = await startIssuer();
    const only = new Map([["org_456", [{ issuer: b.issuer, audience: b.audience, jwks: b.jwks }]]]);
    const shipped = remoteKeys();
    const old = await b.sign("ba_8c1f");
    expect(await checkedLogin(old, only, shipped)).not.toBeUndefined();
    await b.rotate();
    // Within ten minutes the kept keys still hold the old one.
    expect(await checkedLogin(old, only, shipped)).not.toBeUndefined();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 601_000);
    expect(await checkedLogin(old, only, shipped)).toBeUndefined();
    await b.close();
  });

  it("Step 43, D4: a token is no older than fifteen minutes, whatever its exp says", async () => {
    const forever = await a.sign("ba_8c1f", { exp: Date.parse("3000-01-01T00:00:00Z") / 1000 });
    expect(await checkedLogin(forever, issuers, keys)).not.toBeUndefined();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(await checkedLogin(forever, issuers, keys)).toBeUndefined();
  });

  it("Step 43, D4: a token issued a day from now, or with no iat, is refused", async () => {
    const tomorrow = await a.sign("ba_8c1f", { iat: seconds() + 86_400 });
    expect(await checkedLogin(tomorrow, issuers, keys)).toBeUndefined();
    const head = part({ alg: "EdDSA", kid: "key-1", typ: "JWT" });
    const body = part({ iss: a.issuer, aud: a.audience, sub: "ba_8c1f", exp: seconds() + 900 });
    // No iat, and no valid signature either: the check of the claims is what the B-test below needs.
    expect(await checkedLogin(`${head}.${body}.x`, issuers, keys)).toBeUndefined();
  });
});

describe("R4: each issuer's own algorithms and age", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Step 43, R4: an issuer that names RS256, as Entra ID signs, has its RS256 tokens accepted", async () => {
    const rs = await startIssuer("RS256");
    const only = new Map([
      [
        "org_456",
        [{ issuer: rs.issuer, audience: rs.audience, jwks: rs.jwks, algorithms: ["RS256"] }],
      ],
    ]);
    expect(await checkedLogin(await rs.sign("entra_user"), only, remoteKeys())).toStrictEqual({
      issuer: rs.issuer,
      subject: "entra_user",
    });
    await rs.close();
  });

  it("Step 43, R4: an issuer allowed 60 minutes accepts a token 30 minutes old; Neon's 15 would not", async () => {
    const hour = new Map([
      ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks, max_age: "60m" }]],
    ]);
    const token = await a.sign("ba_8c1f", { exp: seconds() + 3600 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 30 * 60_000);
    expect(await checkedLogin(token, hour, keys)).not.toBeUndefined();
    expect(await checkedLogin(token, issuers, keys)).toBeUndefined();
  });
});

describe("C7: fail closed", () => {
  it("Step 43, D7: when the issuer's keys cannot be fetched, a good token is refused", async () => {
    const b = await startIssuer();
    const only = new Map([["org_456", [{ issuer: b.issuer, audience: b.audience, jwks: b.jwks }]]]);
    const token = await b.sign("ba_user_8c1f");
    b.down(true);
    expect(await checkedLogin(token, only, remoteKeys())).toBeUndefined();
    await b.close();
  });

  it("Step 43, D2: a key the issuer no longer publishes refuses its tokens, once the keys are fetched again", async () => {
    const b = await startIssuer();
    const only = new Map([["org_456", [{ issuer: b.issuer, audience: b.audience, jwks: b.jwks }]]]);
    const fresh = remoteKeys({ cacheMaxAge: 0 });
    const before = await b.sign("ba_user_8c1f");
    expect(await checkedLogin(before, only, fresh)).not.toBeUndefined();
    await b.rotate();
    expect(await checkedLogin(before, only, fresh)).toBeUndefined();
    expect(await checkedLogin(await b.sign("ba_user_8c1f"), only, fresh)).not.toBeUndefined();
    await b.close();
  });
});
