// NEW IN STEP 45b: the sign-in server is protected on PostgreSQL too, where the kept answers live in
// dsor.role_answers (step 45b's README, D8, D9). One registry is one DSoR server: its lookups in
// flight are in its own memory. DSoR's clock runs for real here.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLog } from "../src/log.ts";
import { lookupDirectory } from "../src/lookup.ts";
import { call } from "../src/pipeline.ts";
import { createDbAnswers } from "../src/postgres.ts";
import type { Registry } from "../src/registry.ts";
import { AGENT, MASKED_1008_OF_456, storyDirectories } from "./helpers.ts";
import { dbRegistry, newPool } from "./db.ts";
import { startSignInServer, type SignInServer } from "./sign-in-server.ts";

const pool = newPool();
afterAll(async () => {
  await pool.end();
});

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };

let server: SignInServer;

/** A DSoR server on the test database whose role source for org_456 is the test server's lookup. */
function dsor(): Registry {
  const lookup = lookupDirectory({ tenant: "org_456", address: server.address, key: server.key });
  return dbRegistry(pool, new Map([...storyDirectories(), ["org_456", lookup]]));
}

/** Waits this many milliseconds. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(async () => {
  server = await startSignInServer("org_456", {
    user_123: { status: "active", roles: ["ap_supervisor"] },
  });
  // Each test starts with no kept answer about user_123: the row stays from test to test.
  await createDbAnswers(pool).forget("org_456", "user_123", Date.parse("9999-12-31T00:00:00Z"));
});

afterEach(async () => {
  await server.stop();
});

describe("C1, D8, and D9: one lookup in flight, with the kept answers in PostgreSQL", () => {
  it("D9, D8: fifty calls at once on one DSoR server make one lookup, and all fifty read INV-1008", async () => {
    const one = dsor();
    server.hold();
    const fifty = Array.from({ length: 50 }, () =>
      call(one, createLog(), AGENT, "invoice.get", INVOICE),
    );
    while (server.asked() < 1) await wait(10);
    // Each call reads the database before line ③ asks: a moment for every one of them to get there.
    await wait(1000);
    expect(server.asked()).toBe(1);
    server.release();
    for (const answer of await Promise.all(fifty)) {
      expect(answer).toMatchObject({ data: MASKED_1008_OF_456 });
    }
    expect(server.asked()).toBe(1);
  });
});
