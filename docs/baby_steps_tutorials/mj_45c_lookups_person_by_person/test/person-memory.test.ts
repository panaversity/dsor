// NEW IN STEP 45c: every reply about a person is remembered for 10 seconds, and a person whose
// lookups keep failing waits twice as long each time (step 45c's README, C1, C2, C6, D21, D22). The
// agent works under del_100, which user_123 signed, and DSoR asks a test sign-in server for org_456.
// Only the date is faked: the network needs real timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Directory } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import { lookupDirectory } from "../src/lookup.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, MASKED_1008_OF_456, slipRegistry } from "./helpers.ts";
import { NIGHT } from "./role-source-list.ts";
import { startSignInServer, type SignInServer } from "./sign-in-server.ts";

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };

let server: SignInServer;
let registry: Registry;

/** Sets DSoR's clock to this time of the story's night, in UTC. */
function at(time: string): void {
  vi.setSystemTime(new Date(`${NIGHT}T${time}Z`));
}

/** The lookup of org_456 on the test server. */
function lookup(): Directory {
  return lookupDirectory({ tenant: "org_456", address: server.address, key: server.key });
}

/** The test server, except that it errors on this person's record: a stand-in for one broken row. */
function brokenFor(person: string, inner: Directory): Directory {
  return {
    ask: (asked) =>
      asked === person
        ? Promise.reject(new Error(`the record of ${person} errors`))
        : inner.ask(asked),
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("02:00:00");
  server = await startSignInServer("org_456", {
    user_123: { status: "active", roles: ["ap_supervisor"] },
    cfo_100: { status: "active", roles: ["CFO"] },
  });
  registry = slipRegistry(undefined, undefined, [], new Map([["org_456", lookup()]]));
});

afterEach(async () => {
  await server.stop();
  vi.useRealTimers();
});

/** Someone reads INV-1008: the agent under del_100, unless another caller is named. */
function read(caller: RequestEnvelope = AGENT): Promise<unknown> {
  return call(registry, createLog(), caller, "invoice.get", INVOICE);
}

describe("C1 and D21: every reply about a person is remembered for 10 seconds", () => {
  it("D21: after a 503 at 02:00:00, a read at 02:00:09 asks nothing and reads on the kept answer, and one at 02:00:10 asks", async () => {
    at("01:59:00");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:00");
    server.replyStatus(503);
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(2);
    at("02:00:09");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(2);
    at("02:00:10");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(3);
  });

  it("D21: after a 403, nine more reads in 9 seconds ask nothing, and each hears INTERNAL_ERROR", async () => {
    server.replyStatus(403);
    for (let second = 0; second < 10; second += 1) {
      at(`02:00:0${second}`);
      expect(await read()).toMatchObject({ code: "INTERNAL_ERROR" });
    }
    expect(server.asked()).toBe(1);
  });

  it("D21: after an answer too old to use, a read within 10 seconds asks nothing and is refused the same", async () => {
    server.readAt(`${NIGHT}T00:59:00.000Z`);
    expect(await read()).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    at("02:00:05");
    expect(await read()).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(server.asked()).toBe(1);
  });

  it("D21, DSOR-TEN-02a: a failure about user_123 holds no question back about cfo_100", async () => {
    registry = slipRegistry(
      undefined,
      undefined,
      [],
      new Map([["org_456", brokenFor("user_123", lookup())]]),
    );
    await read();
    at("02:00:03");
    expect(await read(CFO)).toHaveProperty("data");
    expect(server.seen().map((request) => request.person)).toStrictEqual(["cfo_100"]);
  });

  it("D21: a memory made later than DSoR's clock now came before a clock went back, and is not used (step 19's README, decision 15)", async () => {
    server.replyStatus(503);
    await read();
    at("01:00:00");
    await read();
    expect(server.asked()).toBe(2);
  });
});

describe("C2 and D22: a person whose lookups keep failing waits twice as long each time", () => {
  /**
   * The seconds after 02:00:00 at which DSoR asked about user_123, while the agent reads every 5
   * seconds. Every question this step expects falls on a multiple of 10 seconds.
   */
  async function asksUntil(last: number): Promise<number[]> {
    const asks: number[] = [];
    for (let second = 0; second <= last; second += 5) {
      vi.setSystemTime(new Date(Date.parse(`${NIGHT}T02:00:00Z`) + second * 1000));
      const before = server.asked();
      expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
      if (server.asked() > before) asks.push(second);
    }
    return asks;
  }

  /** The waits, in seconds, between the questions in this list. */
  function waits(asks: number[]): number[] {
    return asks.slice(1).map((second, index) => second - asks[index]!);
  }

  it("D22: while user_123's lookups keep failing, DSoR waits 10, 20, 40, 80, and 160 seconds between its questions about her, then 5 minutes", async () => {
    // DSoR's answer about her, kept at 02:00:00, under the hour all along.
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:10");
    server.replyStatus(503);
    const asks = await asksUntil(920);
    expect(asks).toStrictEqual([10, 20, 40, 80, 160, 320, 620, 920]);
    expect(waits(asks)).toStrictEqual([10, 20, 40, 80, 160, 300, 300]);
  });

  it("D22: her failures count on when another person's call comes between them: her second wait is 20 seconds", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:10");
    server.replyStatus(503);
    await read();
    // Her first failure is remembered until 02:00:20. At 02:00:25, cfo_100 calls in between.
    at("02:00:25");
    await read(CFO);
    at("02:00:26");
    await read();
    expect(server.asked()).toBe(4);
    // Her second failure, at 02:00:26, waits 20 seconds: until 02:00:46.
    at("02:00:45");
    await read();
    expect(server.asked()).toBe(4);
    at("02:00:46");
    await read();
    expect(server.asked()).toBe(5);
  });

  it("D22: a reply starts her over: after it, the first failure waits 10 seconds again", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:10");
    server.replyStatus(503);
    // Failures at 10, 20, and 40: the third is remembered until 80.
    expect(await asksUntil(79)).toStrictEqual([10, 20, 40]);
    server.replyStatus(undefined);
    const asks: number[] = [];
    for (const second of [80, 85, 89, 90, 95, 99, 100]) {
      // The answer at 80 is used again until 90; then the server fails again.
      if (second === 90) server.replyStatus(503);
      vi.setSystemTime(new Date(Date.parse(`${NIGHT}T02:00:00Z`) + second * 1000));
      const before = server.asked();
      await read();
      if (server.asked() > before) asks.push(second);
    }
    expect(asks).toStrictEqual([80, 90, 100]);
  });
});
