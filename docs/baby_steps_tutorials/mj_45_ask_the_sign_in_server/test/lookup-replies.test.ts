// NEW IN STEP 45: what the lookup does with each kind of reply (step 45's README, C1, C5, C6, D10,
// D13, D14). The agent works under del_100, which user_123 signed, and DSoR asks a test sign-in
// server for org_456.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLog } from "../src/log.ts";
import { lookupDirectory } from "../src/lookup.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import { AGENT, MASKED_1008_OF_456, keyed, slipRegistry } from "./helpers.ts";
import { NIGHT } from "./role-source-list.ts";
import { startSignInServer, type SignInServer } from "./sign-in-server.ts";

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };

let server: SignInServer;
let rows: Payment[];
let registry: Registry;

/** A DSoR whose role source for org_456 is the test server's lookup, asked with this key. */
function dsorAsking(key: string): Registry {
  const lookup = lookupDirectory({ tenant: "org_456", address: server.address, key });
  return slipRegistry(undefined, undefined, rows, new Map([["org_456", lookup]]));
}

beforeEach(async () => {
  server = await startSignInServer("org_456", {
    user_123: { status: "active", roles: ["ap_supervisor"] },
    cfo_100: { status: "active", roles: ["CFO"] },
  });
  rows = [];
  registry = dsorAsking(server.key);
});

afterEach(async () => {
  await server.stop();
  vi.useRealTimers();
});

/** The agent reads INV-1008 under del_100. */
function read(): Promise<unknown> {
  return call(registry, createLog(), AGENT, "invoice.get", INVOICE);
}

/** The agent drafts a payment of INV-1008 under del_100. */
function pay(log = createLog()): Promise<unknown> {
  return call(registry, log, keyed(AGENT), "payment.create", { ...INVOICE, expected_version: 1 });
}

describe("C1 and D14: one request, for one company and one person, with that company's key", () => {
  it("DSOR-IDN-05: the agent's draft asks org_456's server once, about user_123, with org_456's key as a Bearer token", async () => {
    expect(await pay()).toMatchObject({ data: { status: "draft" } });
    expect(server.seen()).toStrictEqual([
      { tenant: "org_456", person: "user_123", authorization: `Bearer ${server.key}` },
    ]);
  });

  it("D14: a key that the server did not make for org_456 hears 401, which DSoR treats as a fault", async () => {
    registry = dsorAsking("dsor_test_org_789");
    expect(await read()).toMatchObject({ code: "INTERNAL_ERROR" });
  });
});

describe("C6: a reply that is neither an answer nor 'cannot answer now' is a fault", () => {
  it.each([401, 403, 404])("D2: a %i is INTERNAL_ERROR, and nothing is drafted", async (status) => {
    server.replyStatus(status);
    expect(await pay()).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(rows).toStrictEqual([]);
  });

  it("D2: a redirect is not followed, though it leads to a good answer: it is INTERNAL_ERROR", async () => {
    server.redirect(true);
    expect(await pay()).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(server.seen()).toHaveLength(1);
    expect(rows).toStrictEqual([]);
  });
});

describe("C5: a server that cannot answer now leaves the kept answer counting", () => {
  // Each second call comes 11 seconds after the good answer, past the 10 seconds an answer is
  // used again (D3), so DSoR asks the failing server. Only the date: the network needs real
  // timers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${NIGHT}T02:00:00Z`));
  });

  /** Moves DSoR's clock to 11 seconds after the good answer. */
  function elevenSecondsLater(): void {
    vi.setSystemTime(new Date(`${NIGHT}T02:00:11Z`));
  }

  it.each([429, 500, 503])(
    "DSOR-IDN-06: after a good answer, a %i is no answer, and the kept answer still counts",
    async (status) => {
      expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
      server.replyStatus(status);
      elevenSecondsLater();
      expect(await pay()).toMatchObject({ data: { status: "draft" } });
      expect(server.asked()).toBe(2);
    },
  );

  it("DSOR-IDN-06: after a good answer, no connection is no answer, and the kept answer still counts", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    await server.stop();
    elevenSecondsLater();
    expect(await pay()).toMatchObject({ data: { status: "draft" } });
  });

  it("D10: a server that never replies is no answer after 2 seconds, and DSoR does not ask again", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    server.hang();
    elevenSecondsLater();
    // The real time the call took: the date is faked, the performance clock is not.
    const started = performance.now();
    expect(await pay()).toMatchObject({ data: { status: "draft" } });
    const waited = performance.now() - started;
    expect(waited).toBeGreaterThanOrEqual(1900);
    expect(waited).toBeLessThan(4000);
    expect(server.asked()).toBe(2);
  }, 10_000);
});

describe("D13: an answer counts from the earlier of the server's time and the moment DSoR asked", () => {
  beforeEach(() => {
    // Only the date: the network needs real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${NIGHT}T02:00:00Z`));
  });

  it("D13: an as_of 30 seconds ahead of DSoR's clock counts, and the record names the moment DSoR asked", async () => {
    server.readAt(`${NIGHT}T02:00:30Z`);
    const log = createLog();
    expect(await pay(log)).toMatchObject({ data: { status: "draft" } });
    expect(await log.records()).toMatchObject([
      {
        identity: { subject_authority: { source: "role_source", as_of: `${NIGHT}T02:00:00.000Z` } },
      },
    ]);
  });

  it("D13: an answer whose facts were read at 01:40 is recorded as of 01:40", async () => {
    server.readAt(`${NIGHT}T01:40:00Z`);
    const log = createLog();
    expect(await pay(log)).toMatchObject({ data: { status: "draft" } });
    expect(await log.records()).toMatchObject([
      {
        identity: { subject_authority: { source: "role_source", as_of: `${NIGHT}T01:40:00.000Z` } },
      },
    ]);
  });
});
