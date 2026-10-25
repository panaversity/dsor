// Step 43: DSoR's table of links on PostgreSQL. A real login reaches the checklist over the
// database (DSOR-IDN-01, DSOR-IDN-04a; step 43's README, claim C8, decisions D5 and D9).
// Changed by the learner's R1 and R3: a link comes only from an invitation the login accepted, so
//   pnpm link-login is gone, and its tests with it. The book's own tests are in
//   invitations.db.test.ts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realLogins } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import { createDbBook, createDbLog } from "../src/postgres.ts";
import { remoteKeys } from "../src/tokens.ts";
import { dbRegistry, newPool } from "./db.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";

const pool = newPool();
let a: TestIssuer;
beforeAll(async () => {
  a = await startIssuer();
});
afterAll(async () => {
  await a.close();
  await pool.end();
});

describe("C8: the links on PostgreSQL", () => {
  it("DSOR-IDN-01: cfo_100's real token, linked by her invitation on PostgreSQL, reads INV-1008 through the checklist", async () => {
    const subject = `ba_${randomUUID()}`;
    const book = createDbBook(pool);
    // One live login for each person (the review's finding 1): another file may have linked her.
    await book.unlink("org_456", "cfo_100", { person: "admin_100", reason: "the logins test" });
    const { code } = await book.invite("org_456", "cfo_100", {
      person: "admin_100",
      reason: "the logins test",
    });
    expect(await book.redeem("org_456", code, { issuer: a.issuer, subject })).toBe("cfo_100");
    const issuers = new Map([
      ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
    ]);
    const registry = { ...dbRegistry(pool), logins: realLogins(issuers, book, remoteKeys()) };
    const answer = await call(
      registry,
      createDbLog(pool),
      { token: await a.sign(subject), tenant: "org_456" },
      "invoice.get",
      { invoice: "dsor://org_456/invoice/INV-1008" },
    );
    expect(answer).toMatchObject({
      data: { id: "INV-1008" },
      correlation: { principal_id: "cfo_100" },
    });
  });

  it("Step 43, D5: a login of no live link is no principal", async () => {
    expect(await createDbBook(pool).principalOf(a.issuer, `ba_${randomUUID()}`)).toBeUndefined();
  });
});
