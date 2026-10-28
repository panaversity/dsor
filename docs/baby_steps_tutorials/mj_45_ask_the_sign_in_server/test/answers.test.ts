// NEW IN STEP 45: an answer is used again for up to 10 seconds, and the server is not asked (step
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
import { futureNewsGoes, laterAnswerStays, newerNewsStays } from "./kept-answers.ts";
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

  it("D3: a fault is never used again: after an answer about cfo_100, the next call asks, and counts", async () => {
    server.answerAbout("cfo_100");
    expect(await read()).toMatchObject({ code: "INTERNAL_ERROR" });
    server.answerAbout(undefined);
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
});
