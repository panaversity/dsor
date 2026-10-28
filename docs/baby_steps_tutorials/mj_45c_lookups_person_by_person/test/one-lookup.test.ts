// Calls about the same company and person share one lookup in flight, on each DSoR
// server (step 45b's README, C1 to C3, and D9). The agent works under del_100, which user_123
// signed, and DSoR asks a test sign-in server for org_456, which can hold its replies until the test
// sends them. Only the date is faked: the network needs real timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAnswers } from "../src/answers.ts";
import { createLog } from "../src/log.ts";
import { lookupDirectory } from "../src/lookup.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  CFO,
  FIRM_IN_456,
  MASKED_1008_OF_456,
  SUPERVISOR,
  slipRegistry,
} from "./helpers.ts";
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
function read(caller: RequestEnvelope = AGENT, log = createLog()): Promise<unknown> {
  return call(registry, log, caller, "invoice.get", INVOICE);
}

/** Waits this many milliseconds of real time. DSoR's clock, the faked date, does not move. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits until this server has taken this many requests, and then a moment more, so that a call
 * that would ask too has asked. Not vi.waitFor: it moves a faked clock on at each try.
 */
async function asked(running: SignInServer, count: number): Promise<void> {
  while (running.asked() < count) await wait(10);
  await wait(50);
}

describe("C1 and D9: calls about the same person share one lookup in flight", () => {
  it("D9: at 02:00:11, fifty calls under del_100 at the same moment make one lookup, and all fifty read INV-1008", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:11");
    server.hold();
    const fifty = Array.from({ length: 50 }, () => read());
    await asked(server, 2);
    expect(server.asked()).toBe(2);
    server.release();
    for (const answer of await Promise.all(fifty)) {
      expect(answer).toMatchObject({ data: MASKED_1008_OF_456 });
    }
    expect(server.asked()).toBe(2);
  });

  it("D9: when that one lookup gets no reply within 2 seconds, all fifty use the kept answer, and the server was asked once", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:11");
    server.hang();
    const fifty = Array.from({ length: 50 }, () => read());
    for (const answer of await Promise.all(fifty)) {
      expect(answer).toMatchObject({ data: MASKED_1008_OF_456 });
    }
    expect(server.asked()).toBe(2);
  });

  // Changed in step 45c: a failed lookup is remembered for 10 seconds, as every reply is (step
  //   45c's README, D21), so the next call after a 503 asks 10 seconds later, not at once.
  it("D9, D21: once a lookup has ended, the next call asks again: 10 seconds after a 503, and 11 seconds after an answer", async () => {
    server.replyStatus(503);
    expect(await read()).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    server.replyStatus(undefined);
    at("02:00:10");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(2);
    at("02:00:21");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(3);
  });
});

describe("C2 and DSOR-TEN-02a: a call about someone else asks on its own", () => {
  it("D9: cfo_100's own call does not wait for the lookup about user_123: two lookups are in flight", async () => {
    server.hold();
    const agent = read();
    const cfo = read(CFO);
    await asked(server, 2);
    expect(
      server
        .seen()
        .map((request) => request.person)
        .sort(),
    ).toStrictEqual(["cfo_100", "user_123"]);
    server.release();
    expect(await agent).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(await cfo).toHaveProperty("data");
  });

  it("DSOR-TEN-02a: user_123's own call naming org_789 asks org_789's server, while org_456's lookup about her is in flight", async () => {
    const server789 = await startSignInServer("org_789", {
      user_700: { status: "active", roles: ["ap_supervisor"] },
    });
    try {
      const both = new Map([
        ["org_456", lookupOf(server)],
        ["org_789", lookupOf(server789, "org_789")],
      ]);
      registry = slipRegistry(undefined, undefined, [], both);
      server.hold();
      const agent = read();
      await asked(server, 1);
      // At that moment user_123 calls DSoR herself, naming org_789, where she never worked.
      expect(await read({ ...SUPERVISOR, tenant: "org_789" })).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: STRANGER,
      });
      expect(server789.seen()).toMatchObject([{ tenant: "org_789", person: "user_123" }]);
      server.release();
      expect(await agent).toMatchObject({ data: MASKED_1008_OF_456 });
      expect(server.asked()).toBe(1);
    } finally {
      await server789.stop();
    }
  });
});

describe("C3 and D9: each call that waited checks the shared answer as its own", () => {
  it("D9: when the shared answer is about cfo_100, every call that waited for it is refused with INTERNAL_ERROR", async () => {
    server.answerAbout("cfo_100");
    server.hold();
    const three = [read(), read(), read()];
    await asked(server, 1);
    server.release();
    for (const answer of await Promise.all(three)) {
      expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    }
    expect(server.asked()).toBe(1);
  });

  it("D9, D13: a call that came 1.5 seconds after the lookup was sent records the answer as of the moment it was sent", async () => {
    server.hold();
    const first = read();
    await asked(server, 1);
    at("02:00:01.500");
    const log = createLog();
    const second = read(AGENT, log);
    // The server reads its facts at 02:00:01.8, after both calls came.
    server.readAt(`${NIGHT}T02:00:01.800Z`);
    await wait(50);
    server.release();
    expect(await first).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(await second).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(1);
    expect(await log.records()).toMatchObject([
      {
        identity: { subject_authority: { source: "role_source", as_of: `${NIGHT}T02:00:00.000Z` } },
      },
    ]);
  });

  /** The first read at 02:00:00 sends a lookup that the server holds; a second read comes at this time and waits for it. */
  async function secondWaitsAt(time: string): Promise<[Promise<unknown>, Promise<unknown>]> {
    server.hold();
    const first = read();
    await asked(server, 1);
    at(time);
    const second = read();
    await wait(50);
    return [first, second];
  }

  it("D3, D9: an answer a call waited for is used again for 10 seconds from the moment DSoR asked, not from when that call came", async () => {
    const [first, second] = await secondWaitsAt("02:00:01.500");
    server.release();
    await Promise.all([first, second]);
    at("02:00:10.500");
    await read();
    expect(server.asked()).toBe(2);
  });

  it("D9, DSOR-IDN-06: a call that waited measures the company's bound from the moment the lookup was sent", async () => {
    const [first, second] = await secondWaitsAt("02:00:01");
    // Read 59 minutes 59.5 seconds before DSoR asked: under org_456's hour then, over it a second later.
    server.readAt(`${NIGHT}T01:00:00.500Z`);
    server.release();
    expect(await first).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(await second).toMatchObject({ data: MASKED_1008_OF_456 });
  });

  it("D9, D4: a call that waited measures the one minute ahead from the moment the lookup was sent", async () => {
    const [first, second] = await secondWaitsAt("02:00:01");
    // 60.5 seconds after DSoR asked: a fault, though under a minute after the second call came.
    server.readAt(`${NIGHT}T02:01:00.500Z`);
    server.release();
    expect(await first).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await second).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("D9: a fault that a call waited for forgets only an answer DSoR asked for before the lookup was sent (step 19's README, decision 14)", async () => {
    const answers = memoryAnswers();
    registry = slipRegistry(
      undefined,
      undefined,
      [],
      new Map([["org_456", lookupOf(server)]]),
      answers,
    );
    server.answerAbout("cfo_100");
    const [first, second] = await secondWaitsAt("02:00:01");
    // Meanwhile another DSoR server, which asked at 02:00:00.5, keeps its newer answer.
    const as_of = `${NIGHT}T02:00:00.500Z`;
    const newer = {
      tenant: "org_456",
      person: "user_123",
      status: "active",
      roles: ["ap_clerk"],
      as_of,
    };
    await answers.keep("org_456", "user_123", {
      answer: newer,
      at: Date.parse(as_of),
      asked: Date.parse(as_of),
    });
    server.release();
    expect(await first).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await second).toMatchObject({ code: "INTERNAL_ERROR" });
    expect((await answers.get("org_456", "user_123"))?.answer).toStrictEqual(newer);
  });

  it("D9: del_100 and del_101, both signed by user_123, share one gone answer, and each refusal names its own slip", async () => {
    server.set("user_123", { status: "gone", roles: [] });
    server.hold();
    const ours = read();
    const firms = read(FIRM_IN_456);
    await asked(server, 1);
    server.release();
    const [our, firm] = (await Promise.all([ours, firms])) as { code: string; message: string }[];
    expect(our).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(firm).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(our?.message).toContain("del_100");
    expect(our?.message).not.toContain("del_101");
    expect(firm?.message).toContain("del_101");
    expect(firm?.message).not.toContain("del_100");
    expect(server.asked()).toBe(1);
  });
});
