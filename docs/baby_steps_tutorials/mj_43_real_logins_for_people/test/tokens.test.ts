// Step 43: a signed token is accepted only when its issuer is one a company configured, its
// signature checks against a key that issuer publishes, and its algorithm, audience, subject, and
// time are right. Anything else is no login at all (DSOR-IDN-01, DSOR-IDN-04a; step 43's README,
// claims C2 and C7, decisions D4 and D7).
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
