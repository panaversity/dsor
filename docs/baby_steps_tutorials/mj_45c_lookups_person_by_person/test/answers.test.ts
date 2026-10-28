// An answer is used again for up to 10 seconds, and the server is not asked (step
// 45's README, C7 and D3). The agent works under del_100, which user_123 signed, and DSoR asks a
// test sign-in server for org_456. Only the date is faked: the network needs real timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAnswers } from "../src/answers.ts";
import { createRoleSource, type RoleSettings } from "../src/authority.ts";
import { createLog } from "../src/log.ts";
import { lookupDirectory } from "../src/lookup.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import type { Slip } from "../src/slips.ts";
import { AGENT, DEL_100, MASKED_1008_OF_456, keyed, slipRegistry } from "./helpers.ts";
import {
  futureNewsForgotten,
  futureNewsGoes,
  laterAnswerStays,
  newerNewsStays,
} from "./kept-answers.ts";
import { NIGHT } from "./role-source-list.ts";
import { startSignInServer, type SignInServer } from "./sign-in-server.ts";

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };

let server: SignInServer;
let rows: Payment[];
let registry: Registry;

/** Sets DSoR's clock to this time of the story's night, in UTC. */
function at(time: string): void {
  vi.setSystemTime(new Date(`${NIGHT}T${time}Z`));
}

/** The lookup of org_456 on the test server. */
function lookup(): ReturnType<typeof lookupDirectory> {
  return lookupDirectory({ tenant: "org_456", address: server.address, key: server.key });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("02:00:00");
  server = await startSignInServer("org_456", {
    user_123: { status: "active", roles: ["ap_supervisor"] },
    cfo_100: { status: "active", roles: ["CFO"] },
  });
  rows = [];
  registry = slipRegistry(undefined, undefined, rows, new Map([["org_456", lookup()]]));
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

describe("C7 and D3: an answer is used again for up to 10 seconds", () => {
  it("D3: a call 9 seconds after the answer asks nothing, and a call 11 seconds after it asks again", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:09");
    expect(await pay()).toMatchObject({ data: { status: "draft" } });
    expect(server.asked()).toBe(1);
    at("02:00:11");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(2);
  });

  it("D3: user_123 leaves at 02:00:05; her agent still drafts at 02:00:09, and is refused at 02:00:10", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:05");
    server.set("user_123", { status: "gone", roles: [] });
    at("02:00:09");
    expect(await pay()).toMatchObject({ data: { status: "draft" } });
    at("02:00:10");
    expect(await pay()).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(rows).toHaveLength(1);
  });

  it("D3: the record of a call that used the answer again names the answer's as_of, not the call's time", async () => {
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:09");
    const log = createLog();
    expect(await pay(log)).toMatchObject({ data: { status: "draft" } });
    expect(await log.records()).toMatchObject([
      {
        identity: { subject_authority: { source: "role_source", as_of: `${NIGHT}T02:00:00.000Z` } },
      },
    ]);
  });

  it("D3: after DSoR's clock goes back, the answer is not used again: DSoR asks", async () => {
    at("02:00:10");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    at("02:00:05");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(2);
  });

  // Changed in step 45c: a fault is remembered for 10 seconds, as every reply is, so the call that
  //   asks again comes 10 seconds later (step 45c's README, D21).
  it("D3, D21: a fault is never used again as an answer: it is remembered as a fault for 10 seconds, and then DSoR asks, and the answer counts", async () => {
    server.answerAbout("cfo_100");
    expect(await read()).toMatchObject({ code: "INTERNAL_ERROR" });
    server.answerAbout(undefined);
    at("02:00:09");
    expect(await read()).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(server.asked()).toBe(1);
    at("02:00:10");
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(2);
  });

  it("D3: under a company bound of 5 seconds, an answer 6 seconds old is not used again: DSoR asks, and does not refuse", async () => {
    const settings: RoleSettings = new Map([
      ["org_456", { kind: "idp_lookup", max_staleness: "PT5S", ms: 5000 }],
    ]);
    const source = createRoleSource(settings, new Map([["org_456", lookup()]]));
    const slip = DEL_100 as Slip;
    expect(await source.authorityOf("org_456", slip, '"invoice.get"')).toMatchObject({
      roles: ["ap_supervisor"],
    });
    at("02:00:06");
    expect(await source.authorityOf("org_456", slip, '"invoice.get"')).toMatchObject({
      roles: ["ap_supervisor"],
      as_of: `${NIGHT}T02:00:06.000Z`,
    });
    expect(server.asked()).toBe(2);
  });
});

// Found by step 45's review: the role source's own reads of the kept answer, each with a store
//   the test plants and a directory it controls.
describe("the role source reads what DSoR keeps (step 19's README, decisions 14 and 15)", () => {
  const settings: RoleSettings = new Map([
    ["org_456", { kind: "idp_lookup", max_staleness: "PT1H", ms: 60 * 60 * 1000 }],
  ]);
  const slip = DEL_100 as Slip;
  /** An answer about user_123, with these roles and status, whose facts were read at this time. */
  const about = (time: string, roles: string[], status = "active") => ({
    tenant: "org_456",
    person: "user_123",
    status,
    roles: status === "active" ? roles : [],
    as_of: `${NIGHT}T${time}Z`,
  });
  const ms = (time: string): number => Date.parse(`${NIGHT}T${time}Z`);

  // Finding 4: a reply from a server that lags is older than what DSoR keeps.
  it("step 19's decision 14: DSoR keeps ap_clerk as of 02:00:05; a lagging server answers ap_supervisor as of 01:59:50; the kept, newer answer decides", async () => {
    at("02:00:20");
    const kept = memoryAnswers([
      [
        "org_456",
        "user_123",
        { answer: about("02:00:05", ["ap_clerk"]), at: ms("02:00:05"), asked: ms("02:00:05") },
      ],
    ]);
    const lagging = { ask: async (): Promise<unknown> => about("01:59:50", ["ap_supervisor"]) };
    const source = createRoleSource(settings, new Map([["org_456", lagging]]), kept);
    expect(await source.authorityOf("org_456", slip, '"invoice.get"')).toStrictEqual({
      roles: ["ap_clerk"],
      source: "role_source",
      as_of: `${NIGHT}T02:00:05.000Z`,
    });
  });

  it("step 19's decision 14: DSoR keeps user_123 gone as of 02:00:05; a lagging server answers her active; line ② still refuses her", async () => {
    at("02:00:20");
    const kept = memoryAnswers([
      [
        "org_456",
        "user_123",
        { answer: about("02:00:05", [], "gone"), at: ms("02:00:05"), asked: ms("02:00:05") },
      ],
    ]);
    const lagging = { ask: async (): Promise<unknown> => about("01:59:50", ["ap_supervisor"]) };
    const source = createRoleSource(settings, new Map([["org_456", lagging]]), kept);
    await expect(source.memberOf("org_456", "user_123", '"invoice.get"')).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });

  // Found by step 45's review, finding 3: org_999 is no longer served, though DSoR still keeps an
  //   answer about cfo_100 there from when it was. Its own words, "no role source for org_999",
  //   would tell her that DSoR knows the company.
  it("DSOR-ERR-01b: cfo_100 names org_999, which DSoR no longer serves, though it keeps an answer about her there: the words every stranger hears", async () => {
    at("02:00:00");
    const old = { ...about("01:59:00", ["CFO"]), tenant: "org_999", person: "cfo_100" };
    const kept = memoryAnswers([
      ["org_999", "cfo_100", { answer: old, at: ms("01:59:00"), asked: ms("01:59:00") }],
    ]);
    const source = createRoleSource(settings, new Map(), kept);
    await expect(source.memberOf("org_999", "cfo_100", '"invoice.list"')).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "the caller may not work in the tenant it named",
    });
  });

  // Mutation A9: a kept answer's age runs from when its facts were read, not from when DSoR asked.
  it("DSOR-IDN-06: a kept answer whose facts were read at 00:59, though DSoR asked at 01:59, is too old at 02:00 while the server is off", async () => {
    at("02:00:00");
    const kept = memoryAnswers([
      [
        "org_456",
        "user_123",
        { answer: about("00:59:00", ["ap_supervisor"]), at: ms("00:59:00"), asked: ms("01:59:00") },
      ],
    ]);
    const off = { ask: async (): Promise<unknown> => Promise.reject(new Error("off")) };
    const source = createRoleSource(settings, new Map([["org_456", off]]), kept);
    await expect(source.authorityOf("org_456", slip, '"invoice.get"')).rejects.toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
    });
  });

  // Mutation A10: while a call waits its 2 seconds, another DSoR server keeps a newer answer, and
  //   the waiting call reads the kept answer again before it gives up.
  it("D8: while the server hangs, another DSoR keeps an answer of 02:00; the waiting call uses it after its 2 seconds", async () => {
    at("02:00:00");
    const kept = memoryAnswers();
    const hangs = { ask: (): Promise<unknown> => new Promise(() => {}) };
    const source = createRoleSource(settings, new Map([["org_456", hangs]]), kept);
    const waiting = source.authorityOf("org_456", slip, '"invoice.get"');
    await new Promise((done) => setTimeout(done, 100));
    await kept.keep("org_456", "user_123", {
      answer: about("02:00:00", ["ap_supervisor"]),
      at: ms("02:00:00"),
      asked: ms("02:00:00"),
    });
    expect(await waiting).toMatchObject({ roles: ["ap_supervisor"] });
  }, 10_000);
});

describe("D8: the kept answers in memory keep the newer news (step 19's README, decision 14)", () => {
  it("step 19's decision 14: an answer whose facts are older never replaces one whose facts are newer", async () => {
    await newerNewsStays(memoryAnswers(), Date.now());
  });

  it("step 19's decision 14: a reply DSoR could not use forgets the kept answer, unless DSoR asked for that answer after the question that failed", async () => {
    await laterAnswerStays(memoryAnswers(), Date.now());
  });

  it("step 19's decision 15: an answer kept before DSoR's clock went back, whose facts are later than its clock now, is replaced by the next answer", async () => {
    await futureNewsGoes(memoryAnswers(), Date.now());
  });

  it("step 19's decision 15: a reply DSoR could not use forgets an answer kept before DSoR's clock went back, though it was asked for later than that reply", async () => {
    await futureNewsForgotten(memoryAnswers(), Date.now());
  });
});
