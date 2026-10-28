// After five failures in a row from one company's sign-in server, this DSoR server
// asks it nothing for 10 seconds, and then lets one call try it again (step 45b's README, C4 to C7,
// D10, D16, and D17). The agent works under del_100, which user_123 signed, and DSoR asks a test
// sign-in server for org_456. Only the date is faked: the network needs real timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Directory } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import { lookupDirectory } from "../src/lookup.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, MASKED_1008_OF_456, USER_700, slipRegistry } from "./helpers.ts";
import { NIGHT } from "./role-source-list.ts";
import { startSignInServer, type SignInServer } from "./sign-in-server.ts";

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };
const STRANGER = "the caller may not work in the tenant it named";

let server: SignInServer;
let registry: Registry;

/** Sets DSoR's clock to this time of the story's night, in UTC. */
function at(time: string): void {
  vi.setSystemTime(new Date(`${NIGHT}T${time}Z`));
}

/** The lookup of one company on a test server. */
function lookupOf(running: SignInServer, tenant = "org_456"): ReturnType<typeof lookupDirectory> {
  return lookupDirectory({ tenant, address: running.address, key: running.key });
}

/** Waits this many milliseconds of real time. DSoR's clock, the faked date, does not move. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until this server has taken this many requests, and then a moment more. */
async function asked(running: SignInServer, count: number): Promise<void> {
  while (running.asked() < count) await wait(10);
  await wait(50);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("02:00:00");
  server = await startSignInServer("org_456", {
    user_123: { status: "active", roles: ["ap_supervisor"] },
    cfo_100: { status: "active", roles: ["CFO"] },
  });
  registry = slipRegistry(undefined, undefined, [], new Map([["org_456", lookupOf(server)]]));
});

afterEach(async () => {
  await server.stop();
  vi.useRealTimers();
});

/** Someone reads INV-1008: the agent under del_100, unless another caller is named. */
function read(caller: RequestEnvelope = AGENT): Promise<unknown> {
  return call(registry, createLog(), caller, "invoice.get", INVOICE);
}

/** What one call heard, and how long it took in real time. */
async function timed(caller: RequestEnvelope = AGENT): Promise<{ heard: unknown; ms: number }> {
  const start = performance.now();
  const heard = await read(caller);
  return { heard, ms: performance.now() - start };
}

/** A directory the test drives: each question waits until the test fails it or answers it. */
function driven(): {
  directory: Directory;
  asked: () => number;
  fail: (person: string) => Promise<void>;
  answer: (person: string, roles: string[]) => Promise<void>;
} {
  const waiting = new Map<string, { settle: (value: unknown) => void; drop: () => void }[]>();
  let questions = 0;
  /** The oldest question about this person, once it has come. */
  async function next(
    person: string,
  ): Promise<{ settle: (value: unknown) => void; drop: () => void }> {
    while ((waiting.get(person) ?? []).length === 0) await wait(5);
    return waiting.get(person)!.shift()!;
  }
  return {
    directory: {
      ask: (person) => {
        questions += 1;
        return new Promise((settle, reject) => {
          const drop = (): void =>
            reject(new Error(`the directory cannot answer about ${person} now`));
          waiting.set(person, [...(waiting.get(person) ?? []), { settle, drop }]);
        });
      },
    },
    asked: () => questions,
    fail: async (person) => (await next(person)).drop(),
    answer: async (person, roles) => {
      const as_of = new Date().toISOString();
      (await next(person)).settle({ tenant: "org_456", person, status: "active", roles, as_of });
    },
  };
}

/** Five calls in a row under del_100, while the server replies with this status. */
async function fiveCalls(status = 503): Promise<unknown[]> {
  server.replyStatus(status);
  const heard: unknown[] = [];
  for (let call = 0; call < 5; call += 1) heard.push(await read());
  return heard;
}

describe("C4 and D10: after five failures in a row, the server is asked nothing for 10 seconds", () => {
  it("D10: one lookup is one failure, however many calls waited for it: after fifty calls share one 503, cfo_100 is still asked about", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:11");
    server.replyStatus(503);
    server.hold();
    const fifty = Array.from({ length: 50 }, () => read());
    await asked(server, 2);
    server.release();
    for (const heard of await Promise.all(fifty)) {
      expect(heard).toMatchObject({ data: MASKED_1008_OF_456 });
    }
    server.replyStatus(undefined);
    at("02:00:14");
    expect(await read(CFO)).toHaveProperty("data");
    expect(server.asked()).toBe(3);
  });

  it("D10: after five 503s in a row, the server is asked nothing, and a call with a kept answer under the hour uses it at once", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:11");
    for (const heard of await fiveCalls()) {
      expect(heard).toMatchObject({ data: MASKED_1008_OF_456 });
    }
    expect(server.asked()).toBe(6);
    server.hang();
    const { heard, ms } = await timed();
    expect(heard).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(ms).toBeLessThan(500);
    expect(server.asked()).toBe(6);
  });

  it("DSOR-IDN-06: during the pause, a call with no kept answer is refused with FRESHNESS_UNSATISFIABLE at once, though the server hangs", async () => {
    for (const heard of await fiveCalls()) {
      expect(heard).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    }
    server.hang();
    const { heard, ms } = await timed();
    expect(heard).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(ms).toBeLessThan(500);
    expect(server.asked()).toBe(5);
  });

  it("D10: four failures, a reply, and four failures start no pause: the next call asks", async () => {
    server.replyStatus(503);
    for (let call = 0; call < 4; call += 1) await read();
    server.replyStatus(undefined);
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:11");
    server.replyStatus(503);
    for (let call = 0; call < 4; call += 1) {
      expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    }
    expect(server.asked()).toBe(9);
    await read();
    expect(server.asked()).toBe(10);
  });

  it("D10: the pause lasts 10 seconds: at 02:00:20.999 the server is not asked, and at 02:00:21 one call asks", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:11");
    await fiveCalls();
    at("02:00:20.999");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(6);
    at("02:00:21");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(7);
  });

  it("D10: a pause that began later than DSoR's clock now came before a clock went back, and ends: the next call asks (step 19's README, decision 15)", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:11");
    await fiveCalls();
    expect(server.asked()).toBe(6);
    // The clock is set back an hour. The pause, until 02:00:21, would otherwise last an hour and ten
    // seconds, with no lookup at all.
    at("01:00:11");
    server.replyStatus(undefined);
    await read();
    expect(server.asked()).toBe(7);
  });

  it("D10: one failure starts no trial: the calls about user_123 and cfo_100 that follow both ask at once", async () => {
    server.replyStatus(503);
    await read();
    server.replyStatus(undefined);
    server.hold();
    const both = [read(), read(CFO)];
    await asked(server, 3);
    expect(server.asked()).toBe(3);
    server.release();
    await Promise.all(both);
  });

  it("D10: the pause runs 10 seconds from the fifth failure, not from the moment its lookup was sent", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:11");
    server.replyStatus(503);
    for (let call = 0; call < 4; call += 1) await read();
    // The fifth lookup is sent at 02:00:11, and gets no reply: it fails 2 seconds later, at 02:00:13.
    server.hang();
    const fifth = read();
    await asked(server, 6);
    at("02:00:13");
    expect(await fifth).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:22");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(6);
  });

  it("D10: a failure after the fifth, from a lookup already in flight, starts the pause again from its own moment", async () => {
    const drive = driven();
    registry = slipRegistry(undefined, undefined, [], new Map([["org_456", drive.directory]]));
    for (let call = 0; call < 4; call += 1) {
      const heard = read();
      await drive.fail("user_123");
      await heard;
    }
    const agent = read();
    const cfo = read(CFO);
    await drive.fail("user_123");
    // The agent's call ends after DSoR has counted the fifth failure, at 02:00:00.
    await agent;
    at("02:00:03");
    await drive.fail("cfo_100");
    await cfo;
    expect(drive.asked()).toBe(6);
    // The fifth failure, at 02:00:00, paused until 02:00:10; the sixth, at 02:00:03, until 02:00:13.
    at("02:00:11");
    expect(await read()).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(drive.asked()).toBe(6);
  });

  it("D10: during the pause, cfo_100, of whom DSoR keeps no answer, hears the stranger's words at once", async () => {
    await fiveCalls();
    server.hang();
    const { heard, ms } = await timed(CFO);
    expect(heard).toMatchObject({ code: "AUTHORIZATION_DENIED", message: STRANGER });
    expect(ms).toBeLessThan(500);
    expect(server.asked()).toBe(5);
  });
});

describe("C5 and D16: when the pause is over, one call tries the server again", () => {
  /** Kept answers about user_123 and cfo_100 from 02:00:00, and a pause from 02:00:11 to 02:00:21. */
  async function pausedUntil21(): Promise<void> {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(await read(CFO)).toHaveProperty("data");
    at("02:00:11");
    await fiveCalls();
    expect(server.asked()).toBe(7);
    at("02:00:21");
  }

  it("D16: one call asks, and a call about cfo_100 meanwhile asks nothing and uses her kept answer at once", async () => {
    await pausedUntil21();
    server.replyStatus(undefined);
    server.hold();
    const trial = read();
    await asked(server, 8);
    const { heard, ms } = await timed(CFO);
    expect(heard).toHaveProperty("data");
    expect(ms).toBeLessThan(500);
    expect(server.asked()).toBe(8);
    server.release();
    expect(await trial).toMatchObject({ data: MASKED_1008_OF_456 });
  });

  it("D16: a call about the trial's own person waits for the trial's answer", async () => {
    await pausedUntil21();
    server.replyStatus(undefined);
    server.set("user_123", { status: "gone", roles: [] });
    server.hold();
    const trial = read();
    await asked(server, 8);
    const second = read();
    await wait(50);
    server.release();
    expect(await trial).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(await second).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(server.asked()).toBe(8);
  });

  it("D16: a trial that fails starts a new pause at once: the next call asks nothing until 02:00:31", async () => {
    await pausedUntil21();
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(8);
    expect(await read(CFO)).toHaveProperty("data");
    expect(server.asked()).toBe(8);
    at("02:00:30.999");
    await read();
    expect(server.asked()).toBe(8);
    at("02:00:31");
    await read();
    expect(server.asked()).toBe(9);
  });

  it("D16: after a trial that got a reply, the next outage pauses again, and its trial asks", async () => {
    await pausedUntil21();
    server.replyStatus(undefined);
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(8);
    at("02:00:32");
    await fiveCalls();
    expect(server.asked()).toBe(13);
    at("02:00:42");
    await read();
    expect(server.asked()).toBe(14);
  });

  it("D16: a trial that gets a reply ends the pause: the next call about cfo_100 asks as usual", async () => {
    await pausedUntil21();
    server.replyStatus(undefined);
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(8);
    expect(await read(CFO)).toHaveProperty("data");
    expect(server.asked()).toBe(9);
  });
});

describe("C6 and D17: any reply ends the run", () => {
  it("D17: a reply that comes during the pause ends it: the next call asks at once", async () => {
    const drive = driven();
    registry = slipRegistry(undefined, undefined, [], new Map([["org_456", drive.directory]]));
    const cfo = read(CFO);
    for (let call = 0; call < 5; call += 1) {
      const heard = read();
      await drive.fail("user_123");
      await heard;
    }
    // The pause began with the fifth failure. cfo_100's lookup, sent before it, now gets its reply.
    await drive.answer("cfo_100", ["CFO"]);
    expect(await cfo).toHaveProperty("data");
    const heard = read();
    await drive.fail("user_123");
    await heard;
    expect(drive.asked()).toBe(7);
  });

  it("D17: five 403s in a row start no pause: cfo_100's call asks, and is refused with INTERNAL_ERROR", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(await read(CFO)).toHaveProperty("data");
    at("02:00:11");
    for (const heard of await fiveCalls(403)) {
      expect(heard).toMatchObject({ code: "INTERNAL_ERROR" });
    }
    at("02:00:12");
    expect(await read(CFO)).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(server.asked()).toBe(8);
  });

  it("D17: four 503s, a 403, and four 503s start no pause: the next call asks", async () => {
    server.replyStatus(503);
    for (let call = 0; call < 4; call += 1) await read();
    server.replyStatus(403);
    expect(await read()).toMatchObject({ code: "INTERNAL_ERROR" });
    server.replyStatus(503);
    for (let call = 0; call < 4; call += 1) await read();
    expect(server.asked()).toBe(9);
    await read();
    expect(server.asked()).toBe(10);
  });
});

describe("C7 and DSOR-TEN-02a: each company has its own run and its own pause", () => {
  it("DSOR-TEN-02a: while org_456's server is paused, org_789's server is still asked", async () => {
    const server789 = await startSignInServer("org_789", {
      user_700: { status: "active", roles: ["ap_supervisor"] },
    });
    try {
      const both = new Map([
        ["org_456", lookupOf(server)],
        ["org_789", lookupOf(server789, "org_789")],
      ]);
      registry = slipRegistry(undefined, undefined, [], both);
      await fiveCalls();
      expect(server.asked()).toBe(5);
      const invoice = { invoice: "dsor://org_789/invoice/INV-1008" };
      expect(await call(registry, createLog(), USER_700, "invoice.get", invoice)).toHaveProperty(
        "data",
      );
      expect(server789.asked()).toBe(1);
    } finally {
      await server789.stop();
    }
  });
});
