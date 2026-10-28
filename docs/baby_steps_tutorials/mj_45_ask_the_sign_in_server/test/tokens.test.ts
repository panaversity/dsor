// A token counts only when it was made for DSoR: signed by the one trusted server,
// for DSoR's audience, with the dsor scope, from a client DSoR knows, and at most an hour old. Each
// test changes one thing, and every other check passes, so it proves that one check (DSOR-IDN-01,
// DSOR-RP-02b, DSOR-IDN-04a; step 44's README, claims C1 and C6, decisions 44-1, 44-9, Q2, R1, R2).
// A refused token names its cause, and, when its signature checked, who it speaks for: the record
// keeps both, and the caller hears neither (step 44's README, decision 44-11).
import { createHmac } from "node:crypto";
import type { JWTPayload } from "jose";
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

/** A refused token whose signature checked: its cause, and who it speaks for (44-11). */
const refused = (cause: string, signer: object = cfo()): object => ({ refused: cause, signer });
/** A refused token whose signature did not check: its cause, and nobody (44-11). */
const unsigned = (cause: string): object => ({ refused: cause });

describe("C1: a token made for DSoR, and only one", () => {
  it("DSOR-IDN-01: cfo_100's token, made for DSoR, with dsor and a listed client, gives the issuer, cfo_100, and the client", async () => {
    expect(await checkedLogin(await a.sign("cfo_100"), a.signIn, keys)).toStrictEqual(cfo());
  });

  it("DSOR-RP-02b: a token made for DSoR's test copy at http://127.0.0.1:8043, every other check passing, is refused", async () => {
    const token = await a.sign("cfo_100", { aud: ["http://127.0.0.1:8043", a.userinfo] });
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(refused("audience"));
  });

  it("DSOR-RP-02b: a token with no audience is refused", async () => {
    const token = await a.sign("cfo_100", { aud: undefined });
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(refused("audience"));
  });

  it("DSOR-RP-02b: a token whose aud lists DSoR and the class app is refused, because the class app could hand it on (44-9)", async () => {
    const token = await a.sign("cfo_100", { aud: [DSOR, "http://localhost:3020"] });
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(refused("audience"));
  });

  it("DSOR-RP-02b: a token whose aud is DSoR alone, or DSoR and the server's own userinfo address, counts (44-9)", async () => {
    const alone = await a.sign("cfo_100", { aud: DSOR });
    expect(await checkedLogin(alone, a.signIn, keys)).toStrictEqual(cfo());
    const both = await a.sign("cfo_100", { aud: [a.userinfo, DSOR] });
    expect(await checkedLogin(both, a.signIn, keys)).toStrictEqual(cfo());
  });

  it("DSOR-RP-02b: a token made only for the server's own userinfo address is refused: DSoR must be among its audiences", async () => {
    // 44-9 allows the userinfo address beside DSoR's, never in its place (the review's mutation
    //   sweep: no test had the userinfo address as a token's only audience).
    const token = await a.sign("cfo_100", { aud: a.userinfo });
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(refused("audience"));
  });

  it("Step 44, R2: a token without the dsor scope is refused, every other check passing", async () => {
    for (const scope of ["openid profile", "openid dsor-admin", "", undefined]) {
      const token = await a.sign("cfo_100", { scope });
      expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(refused("scope"));
    }
    const among = await a.sign("cfo_100", { scope: "openid dsor profile" });
    expect(await checkedLogin(among, a.signIn, keys)).toStrictEqual(cfo());
  });

  it("Step 44, R2: a token from a client not on DSoR's list is refused, though made for DSoR with the dsor scope", async () => {
    const token = await a.sign("cfo_100", { azp: "reports" });
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(
      refused("client", { ...cfo(), client: "reports" }),
    );
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
      expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(
        refused("client", { issuer: a.issuer, subject: "cfo_100" }),
      );
    }
  });

  it("DSOR-IDN-01: a token for cfo_100 whose act names an agent acting for her is refused: it is not her own login", async () => {
    // RFC 8693's act names who acts for the subject. Taken as cfo_100 herself, an agent's call
    //   would count as her own direct login, and her approval with it (the review's finding).
    const token = await a.sign("cfo_100", { act: { sub: "accounts-payable-fte" } });
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(refused("actor"));
  });

  it("Step 44, 44-11: a person or a client name over 200 bytes is never named, and such a subject is refused, so a record always fits", async () => {
    // 200 bytes is a name; 202 bytes, in two-byte letters, is not.
    const longest = "x".repeat(200);
    expect(await checkedLogin(await a.sign(longest), a.signIn, keys)).toStrictEqual({
      ...cfo(),
      subject: longest,
    });
    const tooLong = "é".repeat(101);
    expect(await checkedLogin(await a.sign(tooLong), a.signIn, keys)).toStrictEqual(
      refused("subject", { issuer: a.issuer, client: PEOPLE_APP }),
    );
    const app = await a.sign("cfo_100", { azp: "c".repeat(201) });
    expect(await checkedLogin(app, a.signIn, keys)).toStrictEqual(
      refused("client", { issuer: a.issuer, subject: "cfo_100" }),
    );
  });

  it("Step 44, Q2: 59 minutes after its iat a token counts; 61 minutes after, it is refused, though its exp is days away", async () => {
    const token = await a.sign("cfo_100", { exp: seconds() + 3 * 86_400 });
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + 59 * 60_000);
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(cfo());
    vi.setSystemTime(start + 61 * 60_000);
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(refused("too_old"));
  });

  it("Step 44, Q2: the age comes from sign-in.json: with 30m, a token counts 29 minutes after its iat, and not 31", async () => {
    const halfHour = { ...a.signIn, max_age: "30m" };
    const token = await a.sign("cfo_100", { exp: seconds() + 86_400 });
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + 29 * 60_000);
    expect(await checkedLogin(token, halfHour, keys)).toStrictEqual(cfo());
    vi.setSystemTime(start + 31 * 60_000);
    expect(await checkedLogin(token, halfHour, keys)).toStrictEqual(refused("too_old"));
  });
});

describe("C1, from step 43: what a token must be", () => {
  it("DSOR-IDN-04a: a perfect-looking token signed with another key, naming the trusted issuer, is refused", async () => {
    const forged = await stranger.sign("cfo_100", { iss: a.issuer }, { kid: "key-1" });
    expect(await checkedLogin(forged, a.signIn, keys)).toStrictEqual(unsigned("signature"));
  });

  it("DSOR-IDN-04a: a real token of another server is refused, and so is the trusted one's key under an issuer with a trailing slash", async () => {
    const theirs = await stranger.sign("cfo_100");
    expect(await checkedLogin(theirs, a.signIn, keys)).toStrictEqual(unsigned("signature"));
    const slash = await a.sign("cfo_100", { iss: `${a.issuer}/` });
    expect(await checkedLogin(slash, a.signIn, keys)).toStrictEqual(refused("issuer"));
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
    const token = `${head}.${body}.${mac}`;
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(unsigned("algorithm"));
  });

  it("Step 44, 44-1: a token signed with ES256 by a key its own server publishes is refused: RS256 only", async () => {
    const es = await startIssuer("ES256");
    const token = await es.sign("cfo_100");
    expect(await checkedLogin(token, es.signIn, remoteKeys())).toStrictEqual(unsigned("algorithm"));
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
    const token = `${head}.${body}.`;
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(unsigned("algorithm"));
  });

  it("Step 44, 44-1: a token with no subject is refused", async () => {
    expect(await checkedLogin(await a.sign(undefined), a.signIn, keys)).toStrictEqual(
      refused("subject", { issuer: a.issuer, client: PEOPLE_APP }),
    );
  });

  it("Step 44, 44-1: a subject that is empty, or not text, is refused, and never named", async () => {
    // jose checks only that a sub is there (the review's mutation sweep).
    for (const sub of ["", 42]) {
      // 42 is no text, which the type of sub does not allow, so it goes in as any claim would.
      const claims: Record<string, unknown> = { sub };
      const token = await a.sign(undefined, claims as JWTPayload);
      expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(
        refused("subject", { issuer: a.issuer, client: PEOPLE_APP }),
      );
    }
  });

  it("Step 44, 44-1: a token expired 10 or 6 seconds ago is refused; one expired 3 seconds ago counts, inside the 5 seconds for clocks", async () => {
    const old = await a.sign("cfo_100", { exp: seconds() - 10 });
    const pastSlack = await a.sign("cfo_100", { exp: seconds() - 6 });
    const justNow = await a.sign("cfo_100", { exp: seconds() - 3 });
    expect(await checkedLogin(old, a.signIn, keys)).toStrictEqual(refused("expired"));
    expect(await checkedLogin(pastSlack, a.signIn, keys)).toStrictEqual(refused("expired"));
    expect(await checkedLogin(justNow, a.signIn, keys)).toStrictEqual(cfo());
  });

  it("Step 44, 44-1: a token with no exp is refused, though its iat is fresh", async () => {
    const token = await a.sign("cfo_100", { exp: undefined });
    expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(refused("claims"));
  });

  it("Step 44, 44-1: a token issued a day from now, or with no iat, is refused", async () => {
    const tomorrow = await a.sign("cfo_100", { iat: seconds() + 86_400 });
    expect(await checkedLogin(tomorrow, a.signIn, keys)).toStrictEqual(refused("not_yet"));
    // Signed with the server's own key, so the missing iat, and nothing else, refuses it.
    const noIat = await a.sign("cfo_100", { iat: undefined, exp: seconds() + 900 });
    expect(await checkedLogin(noIat, a.signIn, keys)).toStrictEqual(refused("claims"));
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
      expect(await checkedLogin(token, a.signIn, keys)).toStrictEqual(unsigned("form"));
    },
  );

  it("Step 44, 44-1: an over-long token, or one not in the compact form, is refused before any key is fetched", async () => {
    // jose would refuse each of them too, but only after DSoR asked for the server's keys (the
    //   review's mutation sweep: the length and form checks could go, and every test passed).
    const fetched = vi.fn(keys);
    const long = `${"a".repeat(4096)}.${"b".repeat(4096)}.c`;
    for (const token of [long, "a.b", " a.b.c", "a.b+c.d"]) {
      expect(await checkedLogin(token, a.signIn, fetched)).toStrictEqual(unsigned("form"));
    }
    expect(fetched).not.toHaveBeenCalled();
  });
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

  // The review's mutation sweep: only a 503 and a closed port were tested, so a timeout, a page, or
  //   JSON that is not a key set could each be answered "log in first" with every test passing.
  it.each([
    ["answers after three seconds, past the two DSoR waits", "slow"],
    ["answers 200 with a page that is not JSON", "page"],
    ["answers 200 with JSON that is not a key set", "not-keys"],
  ] as const)(
    "Step 44, 44-1: a server that %s is unavailable; its tokens are not bad",
    async (_how, how) => {
      const b = await startIssuer();
      const token = await b.sign("cfo_100");
      b.answer(how);
      expect(await checkedLogin(token, b.signIn, remoteKeys())).toStrictEqual({
        unavailable: b.issuer,
      });
      await b.close();
    },
  );

  it("Step 44, 44-1: a token whose key the server does not publish is still a bad token, not an outage", async () => {
    const forged = await stranger.sign("cfo_100", { iss: a.issuer }, { kid: "no-such-key" });
    expect(await checkedLogin(forged, a.signIn, keys)).toStrictEqual(unsigned("signature"));
  });

  it("Step 44, 44-1: with the shipped cache, a key the server stops publishing still counts for ten minutes, and not after", async () => {
    const b = await startIssuer();
    const shipped = remoteKeys();
    const login = { issuer: b.issuer, subject: "cfo_100", client: PEOPLE_APP };
    const old = await b.sign("cfo_100", { exp: seconds() + 86_400 });
    expect(await checkedLogin(old, b.signIn, shipped)).toStrictEqual(login);
    await b.rotate();
    // Within ten minutes the kept keys still hold the old one, up to 599 seconds (the review's
    //   mutation sweep: a cache of one minute passed when only 0 and 601 seconds were checked).
    expect(await checkedLogin(old, b.signIn, shipped)).toStrictEqual(login);
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + 599_000);
    expect(await checkedLogin(old, b.signIn, shipped)).toStrictEqual(login);
    vi.setSystemTime(start + 601_000);
    expect(await checkedLogin(old, b.signIn, shipped)).toStrictEqual(unsigned("signature"));
    await b.close();
  });

  it("Step 44, 44-1: a key the server no longer publishes refuses its tokens, once the keys are fetched again", async () => {
    const b = await startIssuer();
    const fresh = remoteKeys({ cacheMaxAge: 0 });
    const login = { issuer: b.issuer, subject: "cfo_100", client: PEOPLE_APP };
    const before = await b.sign("cfo_100");
    expect(await checkedLogin(before, b.signIn, fresh)).toStrictEqual(login);
    await b.rotate();
    expect(await checkedLogin(before, b.signIn, fresh)).toStrictEqual(unsigned("signature"));
    expect(await checkedLogin(await b.sign("cfo_100"), b.signIn, fresh)).toStrictEqual(login);
    await b.close();
  });
});
