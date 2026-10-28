// NEW IN STEP 45b: the sign-in server is protected on PostgreSQL too, where the kept answers live in
// dsor.role_answers (step 45b's README, D8, D9, D10). One registry is one DSoR server: its lookups
// in flight and its runs of failures are in its own memory. DSoR's clock runs for real here.
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

/** Keeps an answer about user_123, active as ap_supervisor, as DSoR asked for it 30 seconds ago. */
async function keptFrom30SecondsAgo(): Promise<void> {
  const at = Date.now() - 30_000;
  const answer = {
    tenant: "org_456",
    person: "user_123",
    status: "active",
    roles: ["ap_supervisor"],
    as_of: new Date(at).toISOString(),
  };
  await createDbAnswers(pool).keep("org_456", "user_123", { answer, at, asked: at });
}

/** The agent reads INV-1008 under del_100, on this DSoR server. */
function read(on: Registry): Promise<unknown> {
  return call(on, createLog(), AGENT, "invoice.get", INVOICE);
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

describe("C4, D8, and D10: the pause is in each DSoR server's memory, and the kept answers in PostgreSQL", () => {
  it("D10, D8: a paused DSoR server uses the kept answer at once, and another DSoR server still asks", async () => {
    await keptFrom30SecondsAgo();
    const paused = dsor();
    server.replyStatus(503);
    for (let call = 0; call < 5; call += 1) {
      expect(await read(paused)).toMatchObject({ data: MASKED_1008_OF_456 });
    }
    expect(server.asked()).toBe(5);
    server.hang();
    const start = performance.now();
    expect(await read(paused)).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(performance.now() - start).toBeLessThan(1000);
    expect(server.asked()).toBe(5);
    // A second DSoR server on the same database has seen no failure. It asks, waits its 2 seconds,
    // and uses the same kept answer.
    expect(await read(dsor())).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(6);
  });
});
