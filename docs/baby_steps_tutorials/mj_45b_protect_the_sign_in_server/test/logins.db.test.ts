// The token records of decision 44-11, on PostgreSQL. This tutorial's own fields must
// fit the 1 KiB dsor.audit allows them (migration 003b). A record that did not fit could not be kept,
// and the caller would hear an outage instead of its refusal (DSOR-EXE-02; step 44's README, decision
// 44-11, and the review's finding on 44-10).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realLogins } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import type { Registry } from "../src/registry.ts";
import { remoteKeys } from "../src/tokens.ts";
import { dbRegistry, newPool, ownerRowsFor, requestId } from "./db.ts";
import { LOG_IN_FIRST, OUR_EXTENSIONS } from "./helpers.ts";
import { PEOPLE_APP, startIssuer, type TestIssuer } from "./issuer.ts";

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

const pool = newPool();
let sso: TestIssuer;
// pnpm serve's world, over the database: a person's token from the test's sign-in server.
let served: Registry;
beforeAll(async () => {
  sso = await startIssuer();
  served = { ...dbRegistry(pool), logins: realLogins(sso.signIn, remoteKeys()) };
});
afterAll(async () => {
  await sso.close();
  await pool.end();
});

describe("44-11 on the database: a token's record fits, and is kept", () => {
  it("Step 44, 44-11: a refused token naming a person and an app of 200 bytes each is kept, with its cause", async () => {
    const request_id = requestId("token-refused");
    // The longest names a record keeps: 200 bytes each, in two-byte letters.
    const subject = "é".repeat(100);
    const client = "ü".repeat(100);
    const token = await sso.sign(subject, { azp: client });
    const request = { token, tenant: "org_456", request_id };
    const answer = await call(served, createDbLog(pool), request, "invoice.get", INV_1008);
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED", message: LOG_IN_FIRST });
    const rows = ownerRowsFor(request_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["extensions"]).toStrictEqual({
      [OUR_EXTENSIONS]: {
        refused_token: { cause: "client", issuer: sso.issuer, subject, client },
      },
    });
  });

  it("Step 44, 44-11: an allowed read with a token keeps the issuer and the app beside the read's label", async () => {
    const request_id = requestId("token-allowed");
    const request = { token: await sso.sign("cfo_100"), tenant: "org_456", request_id };
    const answer = await call(served, createDbLog(pool), request, "invoice.get", INV_1008);
    expect(answer).toHaveProperty("data");
    const rows = ownerRowsFor(request_id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["extensions"]).toMatchObject({
      [OUR_EXTENSIONS]: { login: { issuer: sso.issuer, client: PEOPLE_APP } },
    });
  });
});
