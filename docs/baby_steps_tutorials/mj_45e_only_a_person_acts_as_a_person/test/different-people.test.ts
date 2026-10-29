// The company's pause counts different people. One person's failures count once,
// and a person who waits for her next lookup is never the trial (step 45c's README, C3, D25). The
// agent works under del_100, which user_123 signed, and DSoR asks a test sign-in server for
// org_456. A stand-in in front of it errors on one person's record. Only the date is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAnswers, type Kept } from "../src/answers.ts";
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
// The person whose record the stand-in errors on, if any, and how often DSoR asked about her.
let broken: string | undefined;
let brokenAsks: number;

/** The time of the story's night, in UTC. */
function time(clock: string): number {
  return Date.parse(`${NIGHT}T${clock}Z`);
}

/** Sets DSoR's clock to this time of the story's night. */
function at(clock: string): void {
  vi.setSystemTime(new Date(time(clock)));
}

/** The test server for org_456, except that it errors on the broken person's record. */
function withBrokenRecord(): Directory {
  const inner = lookupDirectory({ tenant: "org_456", address: server.address, key: server.key });
  return {
    ask: (person) => {
      if (person !== broken) return inner.ask(person);
      brokenAsks += 1;
      return Promise.reject(new Error(`the record of ${person} errors`));
    },
  };
}

/** DSoR's answer about user_123, kept at 01:59, so her agent reads on it while her lookups fail. */
function keptAt0159(): [string, string, Kept] {
  const answer = {
    tenant: "org_456",
    person: "user_123",
    status: "active",
    roles: ["ap_supervisor"],
    as_of: `${NIGHT}T01:59:00Z`,
  };
  return ["org_456", "user_123", { answer, at: time("01:59:00"), asked: time("01:59:00") }];
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("02:00:00");
  broken = undefined;
  brokenAsks = 0;
  server = await startSignInServer("org_456", {
    user_123: { status: "active", roles: ["ap_supervisor"] },
    cfo_100: { status: "active", roles: ["CFO"] },
  });
  // Changed after step 45c's review: a stranger's failures do not count (finding 3), so the people
  //   whose lookups fail in these runs are people DSoR knows, with an answer kept at 01:00.
  const known = ["user_201", "user_202", "user_203", "user_204", "user_205", "user_206"].map(
    (person): [string, string, Kept] => {
      const answer = {
        tenant: "org_456",
        person,
        status: "active",
        roles: ["ap_clerk"],
        as_of: `${NIGHT}T01:00:00Z`,
      };
      return ["org_456", person, { answer, at: time("01:00:00"), asked: time("01:00:00") }];
    },
  );
  const answers = memoryAnswers([keptAt0159(), ...known]);
  registry = slipRegistry(
    undefined,
    undefined,
    [],
    new Map([["org_456", withBrokenRecord()]]),
    answers,
  );
});

afterEach(async () => {
  await server.stop();
  vi.useRealTimers();
});

/** Someone reads INV-1008: the agent under del_100, unless another caller is named. */
function read(caller: RequestEnvelope = AGENT): Promise<unknown> {
  return call(registry, createLog(), caller, "invoice.get", INVOICE);
}

/** One person's own call naming org_456, at line ②: whatever she hears, DSoR asks about her. */
async function line2(person: string): Promise<void> {
  await registry.roleSource.memberOf("org_456", person, '"invoice.get"').catch(() => undefined);
}

/** How many times the server was asked about this person. */
function asksAbout(person: string): number {
  return server.seen().filter((request) => request.person === person).length;
}

describe("C3 and D25: the company's pause counts different people", () => {
  it("D25: user_123's record errors, and her lookups fail five times in a row: org_456 does not pause, and cfo_100 is asked about", async () => {
    broken = "user_123";
    // By her backoff, DSoR asks about her at 02:00:00, 02:00:10, 02:00:30, 02:01:10, and 02:02:30.
    for (const clock of ["02:00:00", "02:00:10", "02:00:30", "02:01:10", "02:02:30"]) {
      at(clock);
      expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    }
    expect(brokenAsks).toBe(5);
    at("02:02:31");
    expect(await read(CFO)).toHaveProperty("data");
    expect(asksAbout("cfo_100")).toBe(1);
  });

  it("D25: four people's failures, and the first of them again, start no pause; a fifth person's does", async () => {
    server.replyStatus(503);
    for (const person of ["user_201", "user_202", "user_203", "user_204"]) await line2(person);
    // Her failure is remembered until 02:00:10. Then she is asked again, and fails again: still four.
    at("02:00:10");
    await line2("user_201");
    expect(server.asked()).toBe(5);
    await line2("user_205");
    expect(server.asked()).toBe(6);
    // The fifth person: org_456 is paused, and the next person is not asked about.
    await line2("user_206");
    expect(server.asked()).toBe(6);
  });

  it("D25: after an outage, user_123, waiting for her next lookup, is never the trial, and cfo_100's call is (break B3's story)", async () => {
    // 02:00:00 to 02:00:04: the SSO is down for everyone, and five people's calls fail.
    server.replyStatus(503);
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    for (const [second, person] of [
      [1, "user_201"],
      [2, "user_202"],
      [3, "user_203"],
      [4, "user_204"],
    ] as const) {
      vi.setSystemTime(new Date(time("02:00:00") + second * 1000));
      await line2(person);
    }
    // From 02:00:30 the SSO answers again, except on user_123's record. Her agent reads every 10
    // seconds; cfo_100, with no answer kept about her, tries every 30 seconds.
    const heard: string[] = [];
    for (let second = 5; second <= 300; second += 5) {
      vi.setSystemTime(new Date(time("02:00:00") + second * 1000));
      if (second === 30) {
        server.replyStatus(undefined);
        broken = "user_123";
      }
      if (second % 10 === 0) await read();
      if (second % 30 === 5) {
        const answer = (await read(CFO)) as { data?: unknown };
        heard.push(answer.data === undefined ? "refused" : "reads");
      }
    }
    expect(heard[0]).toBe("refused");
    expect(heard.slice(1)).toStrictEqual(Array.from({ length: heard.length - 1 }, () => "reads"));
  });

  it("D25: a stranger's failures do not count: ten sign-up accounts whose lookups fail start no pause (found by step 45c's review, finding 3)", async () => {
    server.replyStatus(503);
    for (let i = 1; i <= 10; i += 1) await line2(`signup_${i}`);
    expect(server.asked()).toBe(10);
    // Not paused: the agent's call asks about user_123.
    await read();
    expect(server.asked()).toBe(11);
  });

  it("D25: a stranger's failed trial does not start the pause again: the next call asks (found by step 45c's review, finding 3)", async () => {
    server.replyStatus(503);
    for (const person of ["user_201", "user_202", "user_203", "user_204", "user_205"]) {
      await line2(person);
    }
    expect(server.asked()).toBe(5);
    // 02:00:10, the pause is over. A sign-up account's call is the trial, and fails.
    at("02:00:10");
    await line2("signup_1");
    expect(server.asked()).toBe(6);
    // Its failure does not count, so no pause starts again: the agent's call is the next trial.
    await read();
    expect(server.asked()).toBe(7);
  });

  it("D23, D25: when the pause ends, a call over the budget is no trial, and leaves the trial to the next call", async () => {
    for (let i = 1; i <= 20; i += 1) await line2(`signup_${i}`);
    expect(server.asked()).toBe(20);
    server.replyStatus(503);
    for (const person of ["user_201", "user_202", "user_203", "user_204", "user_205"]) {
      await line2(person);
    }
    expect(server.asked()).toBe(25);
    at("02:00:10");
    // The 21st sign-up account: no budget left, so no question, and no trial.
    await line2("signup_21");
    expect(server.asked()).toBe(25);
    await read();
    expect(server.asked()).toBe(26);
  });
});
