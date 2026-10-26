// NEW IN STEP 44: a token counts only when it was made for DSoR: signed by the one trusted server,
// for DSoR's audience, with the dsor scope, from a client DSoR knows, and at most an hour old. Each
// test changes one thing, and every other check passes, so it proves that one check (DSOR-IDN-01,
// DSOR-RP-02b, DSOR-IDN-04a; step 44's README, claims C1 and C6, decisions 44-1, 44-9, Q2, R1, R2).
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { checkedLogin, remoteKeys } from "../src/tokens.ts";
import { DSOR, PEOPLE_APP, startIssuer, type TestIssuer } from "./issuer.ts";

let a: TestIssuer;
let stranger: TestIssuer;
beforeAll(async () => {
  a = await startIssuer();
  stranger = await startIssuer();
});
afterAll(async () => {
  await a.close();
  await stranger.close();
});
afterEach(() => {
  vi.useRealTimers();
});

const keys = remoteKeys();
const seconds = (): number => Math.floor(Date.now() / 1000);
const part = (x: unknown): string => Buffer.from(JSON.stringify(x)).toString("base64url");

/** Who a good token of server a says is calling. */
const cfo = (): { issuer: string; subject: string; client: string } => ({
  issuer: a.issuer,
  subject: "cfo_100",
  client: PEOPLE_APP,
});

describe("C1: a token made for DSoR, and only one", () => {
  it("DSOR-IDN-01: cfo_100's token, made for DSoR, with dsor and a listed client, gives the issuer, cfo_100, and the client", async () => {
    expect(await checkedLogin(await a.sign("cfo_100"), a.signIn, keys)).toStrictEqual(cfo());
  });

  it("DSOR-RP-02b: a token made for DSoR's test copy at http://127.0.0.1:8043, every other check passing, is refused", async () => {
    const token = await a.sign("cfo_100", { aud: ["http://127.0.0.1:8043", a.userinfo] });
    expect(await checkedLogin(token, a.signIn, keys)).toBeUndefined();
  });

  it("DSOR-RP-02b: a token with no audience is refused", async () => {
    const token = await a.sign("cfo_100", { aud: undefined });
    expect(await checkedLogin(token, a.signIn, keys)).toBeUndefined();
  });

  it("DSOR-RP-02b: a token whose aud lists DSoR and the class app is refused, because the class app could hand it on (44-9)", async () => {
    const token = await a.sign("cfo_100", { aud: [DSOR, "http://localhost:3020"] });
    expect(await checkedLogin(token, a.signIn, keys)).toBeUndefined();
  });

  it("DSOR-RP-02b: a token whose aud is DSoR alone, or DSoR and the server's own userinfo address, counts (44-9)", async () => {
    const alone = await a.sign("cfo_100", { aud: DSOR });
    expect(await checkedLogin(alone, a.signIn, keys)).toStrictEqual(cfo());
    const both = await a.sign("cfo_100", { aud: [a.userinfo, DSOR] });
    expect(await checkedLogin(both, a.signIn, keys)).toStrictEqual(cfo());
  });

  it("Step 44, R2: a token without the dsor scope is refused, every other check passing", async () => {
    for (const scope of ["openid profile", "openid dsor-admin", "", undefined]) {
      const token = await a.sign("cfo_100", { scope });
      expect(await checkedLogin(token, a.signIn, keys)).toBeUndefined();
    }
    const among = await a.sign("cfo_100", { scope: "openid dsor profile" });
    expect(await checkedLogin(among, a.signIn, keys)).toStrictEqual(cfo());
  });

  it("Step 44, R2: a token from a client not on DSoR's list is refused, though made for DSoR with the dsor scope", async () => {
    const token = await a.sign("cfo_100", { azp: "reports" });
    expect(await checkedLogin(token, a.signIn, keys)).toBeUndefined();
  });

  it("Step 44, R1: a client named by azp alone, by client_id alone, or by both and the same, counts", async () => {
    const byAzp = await a.sign("cfo_100");
    const byClientId = await a.sign("cfo_100", { azp: undefined, client_id: PEOPLE_APP });
    const byBoth = await a.sign("cfo_100", { client_id: PEOPLE_APP });
    for (const token of [byAzp, byClientId, byBoth]) {
      expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(cfo());
    }
  });

  it("Step 44, R1: a client named twice, differently, is refused, and so is a token that names no client", async () => {
    const tokens = [
      await a.sign("cfo_100", { client_id: "reports" }),
      await a.sign("cfo_100", { client_id: PEOPLE_APP, azp: "reports" }),
      await a.sign("cfo_100", { azp: undefined }),
      await a.sign("cfo_100", { azp: "" }),
      await a.sign("cfo_100", { azp: 42 }),
    ];
    for (const token of tokens) {
      expect(await checkedLogin(token, a.signIn, keys)).toBeUndefined();
    }
  });

  it("Step 44, Q2: 59 minutes after its iat a token counts; 61 minutes after, it is refused, though its exp is days away", async () => {
    const token = await a.sign("cfo_100", { exp: seconds() + 3 * 86_400 });
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + 59 * 60_000);
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(cfo());
    vi.setSystemTime(start + 61 * 60_000);
    expect(await checkedLogin(token, a.signIn, keys)).toBeUndefined();
  });
});

describe("C1, from step 43: what a token must be", () => {
  it("DSOR-IDN-04a: a perfect-looking token signed with another key, naming the trusted issuer, is refused", async () => {
    const forged = await stranger.sign("cfo_100", { iss: a.issuer }, { kid: "key-1" });
    expect(await checkedLogin(forged, a.signIn, keys)).toBeUndefined();
  });

  it("DSOR-IDN-04a: a real token of another server is refused, and so is the trusted one's key under an issuer with a trailing slash", async () => {
    expect(await checkedLogin(await stranger.sign("cfo_100"), a.signIn, keys)).toBeUndefined();
    const slash = await a.sign("cfo_100", { iss: `${a.issuer}/` });
    expect(await checkedLogin(slash, a.signIn, keys)).toBeUndefined();
  });

  it("Step 44, 44-1: a token that names HS256, signed with the server's public key as a secret, is refused", async () => {
    const res = await fetch(a.jwks);
    const { keys: published } = (await res.json()) as { keys: { n: string }[] };
    const head = part({ alg: "HS256", kid: "key-1", typ: "JWT" });
    const body = part({
      iss: a.issuer,
      aud: DSOR,
      sub: "cfo_100",
      scope: "dsor",
      azp: PEOPLE_APP,
      iat: seconds(),
      exp: seconds() + 900,
    });
    const mac = createHmac("sha256", published[0]?.n ?? "")
      .update(`${head}.${body}`)
      .digest("base64url");
    expect(await checkedLogin(`${head}.${body}.${mac}`, a.signIn, keys)).toBeUndefined();
  });

  it("Step 44, 44-1: a token signed with ES256 by a key its own server publishes is refused: RS256 only", async () => {
    const es = await startIssuer("ES256");
    expect(await checkedLogin(await es.sign("cfo_100"), es.signIn, remoteKeys())).toBeUndefined();
    await es.close();
  });

  it("Step 44, 44-1: a token that names no algorithm, with no signature, is refused", async () => {
    const head = part({ alg: "none", typ: "JWT" });
    const body = part({
      iss: a.issuer,
      aud: DSOR,
      sub: "cfo_100",
      scope: "dsor",
      azp: PEOPLE_APP,
      iat: seconds(),
      exp: seconds() + 900,
    });
    expect(await checkedLogin(`${head}.${body}.`, a.signIn, keys)).toBeUndefined();
  });

  it("Step 44, 44-1: a token with no subject is refused", async () => {
    expect(await checkedLogin(await a.sign(undefined), a.signIn, keys)).toBeUndefined();
  });

  it("Step 44, 44-1: a token expired 10 seconds ago is refused; one expired 3 seconds ago counts, inside the 5 seconds for clocks", async () => {
    const old = await a.sign("cfo_100", { exp: seconds() - 10 });
    const justNow = await a.sign("cfo_100", { exp: seconds() - 3 });
    expect(await checkedLogin(old, a.signIn, keys)).toBeUndefined();
    expect(await checkedLogin(justNow, a.signIn, keys)).toStrictEqual(cfo());
  });

  it("Step 44, 44-1: a token issued a day from now, or with no iat, is refused", async () => {
    const tomorrow = await a.sign("cfo_100", { iat: seconds() + 86_400 });
    expect(await checkedLogin(tomorrow, a.signIn, keys)).toBeUndefined();
    const head = part({ alg: "RS256", kid: "key-1", typ: "JWT" });
    const body = part({
      iss: a.issuer,
      aud: DSOR,
      sub: "cfo_100",
      scope: "dsor",
      azp: PEOPLE_APP,
      exp: seconds() + 900,
    });
    expect(await checkedLogin(`${head}.${body}.x`, a.signIn, keys)).toBeUndefined();
  });

  it.each([
    ["undefined", undefined],
    ["42", 42],
    ["tok_d4e8", "tok_d4e8"],
    ["a.b", "a.b"],
    ["a.b.c", "a.b.c"],
    ["a text of 20,000 characters", "x".repeat(20000)],
  ])(
    "Step 44, 44-1: %s is no signed token, and is refused without a throw",
    async (_label, token) => {
      expect(await checkedLogin(token, a.signIn, keys)).toBeUndefined();
    },
  );
});

describe("C6: keys that cannot be fetched are an outage, not a bad token", () => {
  it("Step 44, 44-1: when the server's keys cannot be fetched, the token is not refused as bad: the server is unavailable", async () => {
    const b = await startIssuer();
    const token = await b.sign("cfo_100");
    b.down(true);
    expect(await checkedLogin(token, b.signIn, remoteKeys())).toStrictEqual({
      unavailable: b.issuer,
    });
    await b.close();
    expect(await checkedLogin(token, b.signIn, remoteKeys())).toStrictEqual({
      unavailable: b.issuer,
    });
  });

  it("Step 44, 44-1: a token whose key the server does not publish is still a bad token, not an outage", async () => {
    const forged = await stranger.sign("cfo_100", { iss: a.issuer }, { kid: "no-such-key" });
    expect(await checkedLogin(forged, a.signIn, keys)).toBeUndefined();
  });

  it("Step 44, 44-1: with the shipped cache, a key the server stops publishing still counts for ten minutes, and not after", async () => {
    const b = await startIssuer();
    const shipped = remoteKeys();
    const old = await b.sign("cfo_100", { exp: seconds() + 86_400 });
    expect(await checkedLogin(old, b.signIn, shipped)).not.toBeUndefined();
    await b.rotate();
    // Within ten minutes the kept keys still hold the old one.
    expect(await checkedLogin(old, b.signIn, shipped)).not.toBeUndefined();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 601_000);
    expect(await checkedLogin(old, b.signIn, shipped)).toBeUndefined();
    await b.close();
  });

  it("Step 44, 44-1: a key the server no longer publishes refuses its tokens, once the keys are fetched again", async () => {
    const b = await startIssuer();
    const fresh = remoteKeys({ cacheMaxAge: 0 });
    const before = await b.sign("cfo_100");
    expect(await checkedLogin(before, b.signIn, fresh)).not.toBeUndefined();
    await b.rotate();
    expect(await checkedLogin(before, b.signIn, fresh)).toBeUndefined();
    expect(await checkedLogin(await b.sign("cfo_100"), b.signIn, fresh)).not.toBeUndefined();
    await b.close();
  });
});
