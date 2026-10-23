// Step 43, revised by the learner: a person joins by an invitation code. An admin invites; the
// person's first call with a signed token and the code links their login, at line ①, in one step;
// unlinking ends it on the next call (DSOR-IDN-01; step 43's README, revisions R1, R2, and R7).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { memoryLoginBook, realLogins, type MemoryLoginBook } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { remoteKeys } from "../src/tokens.ts";
import { keyed } from "./helpers.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

let a: TestIssuer;
beforeAll(async () => {
  a = await startIssuer();
});
afterAll(async () => {
  await a.close();
});

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };
const BY = { person: "admin_100", reason: "a step 43 test" };

/** A world of step 29's rules, with real logins and a book of links and invitations in memory. */
async function bookWorld(clock?: { now: number }) {
  const w: RuleWorld = await ruleWorldOnTuesday();
  const issuers = new Map([
    ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
    ["org_789", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
  ]);
  const book: MemoryLoginBook = memoryLoginBook([], () => clock?.now ?? Date.now());
  const registry: Registry = { ...w.registry, logins: realLogins(issuers, book, remoteKeys()) };
  const ask = (who: RequestEnvelope): Promise<Answer> =>
    call(registry, w.log, who, "invoice.get", INV_1008);
  return { w, book, registry, ask };
}

describe("R1: the first call with the code links the login", () => {
  it("DSOR-IDN-01: invited as cfo_100, a new login's first call with the code is cfo_100, and so is the next without it", async () => {
    const { book, ask } = await bookWorld();
    const { code } = await book.invite("org_456", "cfo_100", BY);
    const token = await a.sign("ba_new_cfo");
    expect(await ask({ token, tenant: "org_456", invitation: code })).toMatchObject({
      correlation: { principal_id: "cfo_100" },
    });
    expect(await ask({ token, tenant: "org_456" })).toMatchObject({
      correlation: { principal_id: "cfo_100" },
    });
    const [invitation] = await book.invitations();
    expect(invitation).toMatchObject({
      person: "cfo_100",
      accepted_by: { issuer: a.issuer, subject: "ba_new_cfo" },
    });
  });

  it("Step 43, R1: a code works once: a second login with the same code is no caller", async () => {
    const { book, ask } = await bookWorld();
    const { code } = await book.invite("org_456", "cfo_100", BY);
    await ask({ token: await a.sign("ba_first"), tenant: "org_456", invitation: code });
    const second = await ask({
      token: await a.sign("ba_second"),
      tenant: "org_456",
      invitation: code,
    });
    expect(second).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("Step 43, R1: a wrong code, and no code at all, give a new login no caller", async () => {
    const { book, ask } = await bookWorld();
    await book.invite("org_456", "cfo_100", BY);
    const token = await a.sign("ba_new");
    expect(await ask({ token, tenant: "org_456", invitation: "A".repeat(22) })).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(await ask({ token, tenant: "org_456" })).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("Step 43, R1: a code older than seven days is no caller", async () => {
    const clock = { now: Date.now() };
    const { book, ask } = await bookWorld(clock);
    const { code } = await book.invite("org_456", "cfo_100", BY);
    clock.now += 7 * 86_400_000 + 1000;
    expect(
      await ask({ token: await a.sign("ba_late"), tenant: "org_456", invitation: code }),
    ).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("Step 43, R1: org_456's code, sent with org_789 as the company, is no caller", async () => {
    const { book, ask } = await bookWorld();
    const { code } = await book.invite("org_456", "cfo_100", BY);
    expect(
      await ask({ token: await a.sign("ba_new"), tenant: "org_789", invitation: code }),
    ).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect((await book.invitations())[0]?.accepted_by).toBeUndefined();
  });

  it("Step 43, R1: a code sent in a company that does not trust the token's issuer links nothing", async () => {
    const other = await startIssuer();
    try {
      const w: RuleWorld = await ruleWorldOnTuesday();
      // org_789 trusts the second issuer only; org_456 trusts the first.
      const issuers = new Map([
        ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
        ["org_789", [{ issuer: other.issuer, audience: other.audience, jwks: other.jwks }]],
      ]);
      const book: MemoryLoginBook = memoryLoginBook([]);
      const registry: Registry = { ...w.registry, logins: realLogins(issuers, book, remoteKeys()) };
      const { code } = await book.invite("org_789", "user_700", BY);
      const answer = await call(
        registry,
        w.log,
        keyed({ token: await a.sign("ba_stranger"), tenant: "org_789", invitation: code }),
        "invoice.get",
        { invoice: "dsor://org_789/invoice/INV-2002" },
      );
      expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
      expect((await book.invitations())[0]?.accepted_by).toBeUndefined();
    } finally {
      await other.close();
    }
  });

  it("Step 43, R2: a login linked already never accepts a code: an admin's own login stays the admin, and the invitation stays open", async () => {
    const { book, ask } = await bookWorld();
    const admin = await book.invite("org_456", "admin_100", BY);
    const token = await a.sign("ba_admin");
    await ask({ token, tenant: "org_456", invitation: admin.code });
    const cfo = await book.invite("org_456", "cfo_100", BY);
    expect(await ask({ token, tenant: "org_456", invitation: cfo.code })).toMatchObject({
      correlation: { principal_id: "admin_100" },
    });
    expect(
      (await book.invitations()).find((i) => i.person === "cfo_100")?.accepted_by,
    ).toBeUndefined();
  });
});

describe("R7: unlinking is the off-switch", () => {
  it("DSOR-IDN-01: once cfo_100 is unlinked, her next call is no caller, and her open invitations are cancelled", async () => {
    const { book, ask } = await bookWorld();
    const { code } = await book.invite("org_456", "cfo_100", BY);
    const token = await a.sign("ba_cfo");
    await ask({ token, tenant: "org_456", invitation: code });
    const spare = await book.invite("org_456", "cfo_100", BY);
    expect(await book.unlink("org_456", "cfo_100", BY)).toStrictEqual({
      logins: 1,
      invitations: 1,
    });
    expect(await ask({ token, tenant: "org_456" })).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(
      await ask({ token: await a.sign("ba_other"), tenant: "org_456", invitation: spare.code }),
    ).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("Step 43, R7: an unlinked login may be invited again, and joins again", async () => {
    const { book, ask } = await bookWorld();
    const token = await a.sign("ba_cfo");
    await ask({
      token,
      tenant: "org_456",
      invitation: (await book.invite("org_456", "cfo_100", BY)).code,
    });
    await book.unlink("org_456", "cfo_100", BY);
    const again = await book.invite("org_456", "cfo_100", BY);
    expect(await ask({ token, tenant: "org_456", invitation: again.code })).toMatchObject({
      correlation: { principal_id: "cfo_100" },
    });
  });
});

describe("R1: the invitation's code", () => {
  it("Step 43, R1: a code is 22 letters of base64url, new each time, and the book keeps only its hash", async () => {
    const { book } = await bookWorld();
    const one = await book.invite("org_456", "cfo_100", BY);
    const two = await book.invite("org_456", "cfo_100", BY);
    expect(one.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(one.code).not.toBe(two.code);
    expect(JSON.stringify(await book.invitations())).not.toContain(one.code);
  });
});
