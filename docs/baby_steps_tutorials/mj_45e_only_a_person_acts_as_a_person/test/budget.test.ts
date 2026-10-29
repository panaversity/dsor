// Each DSoR server sends at most 20 lookups in any minute, for each company, about
// people it knows nothing about, from their own calls at line ②. Over the budget, a call sends no
// question and hears the stranger's words at once (step 45c's README, C4 to C6, D23, D24). DSoR asks
// a test sign-in server for org_456. Only the date is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAnswers, type Kept } from "../src/answers.ts";
import type { Directory } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import { lookupDirectory } from "../src/lookup.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, MASKED_1008_OF_456, SUPERVISOR, keyed, slipRegistry } from "./helpers.ts";
import { NIGHT } from "./role-source-list.ts";
import { startSignInServer, type SignInServer } from "./sign-in-server.ts";

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };
const STRANGER = "the caller may not work in the tenant it named";

let server: SignInServer;
let registry: Registry;

/** The time of the story's night, in UTC. */
function time(clock: string): number {
  return Date.parse(`${NIGHT}T${clock}Z`);
}

/** Sets DSoR's clock to this time of the story's night. */
function at(clock: string): void {
  vi.setSystemTime(new Date(time(clock)));
}

/** The lookup of one company on a test server. */
function lookupOf(running: SignInServer, tenant = "org_456"): Directory {
  return lookupDirectory({ tenant, address: running.address, key: running.key });
}

/** An answer about this person, active with these roles, kept as DSoR asked for it at that time. */
function keptAbout(person: string, clock: string, roles: string[]): [string, string, Kept] {
  const answer = {
    tenant: "org_456",
    person,
    status: "active",
    roles,
    as_of: `${NIGHT}T${clock}Z`,
  };
  return ["org_456", person, { answer, at: time(clock), asked: time(clock) }];
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("09:00:00");
  server = await startSignInServer("org_456", {
    user_123: { status: "active", roles: ["ap_supervisor"] },
    user_124: { status: "active", roles: ["ap_supervisor"] },
    cfo_100: { status: "active", roles: ["CFO"] },
    ...Object.fromEntries(
      KNOWN.map((person) => [person, { status: "active", roles: ["ap_clerk"] }]),
    ),
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

// People DSoR knows: it kept an active answer about each at 01:00. Their failures count toward
// the pause; a stranger's do not (found by step 45c's review, finding 3).
const KNOWN = ["user_201", "user_202", "user_203", "user_204", "user_205"];

/** Answers about the people DSoR knows, kept at 01:00, and any others given. */
function knownAnswers(...more: [string, string, Kept][]): ReturnType<typeof memoryAnswers> {
  return memoryAnswers([
    ...KNOWN.map((person) => keptAbout(person, "01:00:00", ["ap_clerk"])),
    ...more,
  ]);
}

/** People who signed up at the SSO, none of them in org_456: signup_001, signup_002, … */
function signUps(count: number, from = 1): string[] {
  return Array.from({ length: count }, (_, i) => `signup_${String(from + i).padStart(3, "0")}`);
}

/** Each person's own call naming org_456, at once, at line ②: what each one hears. */
function line2(people: string[], tenant = "org_456"): Promise<unknown[]> {
  return Promise.all(
    people.map((person) =>
      registry.roleSource.memberOf(tenant, person, '"invoice.get"').then(
        () => "let in",
        (refusal: unknown) => refusal,
      ),
    ),
  );
}

describe("C4 and D23: 20 lookups a minute about people DSoR knows nothing about", () => {
  it("D23: 25 people DSoR knows nothing about call at once: 20 questions, and all 25 hear the stranger's words", async () => {
    for (const heard of await line2(signUps(25))) {
      expect(heard).toMatchObject({ code: "AUTHORIZATION_DENIED", message: STRANGER });
    }
    expect(server.asked()).toBe(20);
  });

  it("D23: the budget is for any minute: at 09:00:59.999 no question, and at 09:01:00, 20 more", async () => {
    await line2(signUps(25));
    at("09:00:59.999");
    await line2(signUps(1, 26));
    expect(server.asked()).toBe(20);
    at("09:01:00");
    await line2(signUps(25, 27));
    expect(server.asked()).toBe(40);
  });

  it("D23: cfo_100, whose active answer DSoR kept at 06:00, three hours old, is asked about though the budget is used up (break B2's story)", async () => {
    const answers = memoryAnswers([keptAbout("cfo_100", "06:00:00", ["CFO"])]);
    registry = slipRegistry(
      undefined,
      undefined,
      [],
      new Map([["org_456", lookupOf(server)]]),
      answers,
    );
    await line2(signUps(200));
    expect(server.asked()).toBe(20);
    at("09:00:05");
    expect(await read(CFO)).toHaveProperty("data");
    expect(server.asked()).toBe(21);
  });

  it("D23: an agent's call is never held back: line ③ asks about user_123 though the budget is used up", async () => {
    await line2(signUps(20));
    expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
    expect(server.asked()).toBe(21);
  });
});

describe("C5 and D24: over the budget, the stranger's words at once", () => {
  it("DSOR-ERR-01b: over the budget, a call hears the stranger's words at once, with no question, and five such calls start no pause (D24)", async () => {
    await line2(signUps(20));
    server.hang();
    const start = performance.now();
    for (const heard of await line2(signUps(5, 21))) {
      expect(heard).toMatchObject({ code: "AUTHORIZATION_DENIED", message: STRANGER });
    }
    expect(performance.now() - start).toBeLessThan(500);
    expect(server.asked()).toBe(20);
    // No pause: the agent's call still asks, and waits its 2 seconds for the server that hangs.
    await read();
    expect(server.asked()).toBe(21);
  });
});

describe("C6 and DSOR-TEN-02a: each company has its own budget", () => {
  it("DSOR-TEN-02a: org_456's budget used up holds back no lookup for org_789", async () => {
    const server789 = await startSignInServer("org_789", {
      user_700: { status: "active", roles: ["ap_supervisor"] },
    });
    try {
      const both = new Map([
        ["org_456", lookupOf(server)],
        ["org_789", lookupOf(server789, "org_789")],
      ]);
      registry = slipRegistry(undefined, undefined, [], both);
      await line2(signUps(25));
      await line2(signUps(1, 26), "org_789");
      expect(server.asked()).toBe(20);
      expect(server789.asked()).toBe(1);
    } finally {
      await server789.stop();
    }
  });
});

// Found by step 45c's review, finding 1: a release asks about the person who made the request, who
// is not the caller. That question spends no budget, and a company that cannot answer now leaves
// the proposal waiting. user_124 is a second AP supervisor of org_456, with a key of her own.
describe("C4: a release asks about the person who made the request, and spends no budget", () => {
  /** A DSoR whose logins know user_124's key too. */
  function withUser124(): Registry {
    const base = slipRegistry(undefined, undefined, [], new Map([["org_456", lookupOf(server)]]));
    return {
      ...base,
      logins: {
        ...base.logins,
        find: async (token: string) =>
          token === "tok_x124"
            ? { id: "user_124", type: "human" as const, memberships: [] }
            : base.logins.find(token),
      },
    } as Registry;
  }
  const USER_124 = { token: "tok_x124", tenant: "org_456" };
  const DRAFT = { ...INVOICE, expected_version: 1 };

  /** user_123 prepares a payment of INV-1008, and a 403 at 02:01 erases DSoR's answer about her. */
  async function preparedThenForgotten(): Promise<string> {
    at("02:00:00");
    const log = createLog();
    const prepared = await call(
      registry,
      log,
      { ...keyed(SUPERVISOR), mode: "propose_only" },
      "payment.create",
      DRAFT,
    );
    expect(prepared).toMatchObject({ outcome: "READY" });
    at("02:00:30");
    expect(await call(registry, log, USER_124, "invoice.get", INVOICE)).toHaveProperty("data");
    at("02:01:00");
    server.replyStatus(403);
    expect(await call(registry, log, SUPERVISOR, "invoice.get", INVOICE)).toMatchObject({
      code: "INTERNAL_ERROR",
    });
    server.replyStatus(undefined);
    return (prepared as { proposal: string }).proposal;
  }

  it("D23: 20 sign-up accounts use up the budget, and user_124's release of user_123's waiting payment still commits", async () => {
    registry = withUser124();
    const proposal = await preparedThenForgotten();
    at("02:02:00");
    await line2(signUps(20));
    at("02:02:01");
    const released = await call(registry, createLog(), keyed(USER_124), "proposal.execute", {
      proposal,
    });
    expect(released).toMatchObject({ outcome: "COMMITTED" });
  });

  it("DSOR-IDN-06: at a release, a company that cannot answer now about its requester leaves the proposal waiting, though DSoR knows nothing about her now (a bug since step 45)", async () => {
    registry = withUser124();
    const proposal = await preparedThenForgotten();
    // user_124's own answer is used again for 10 seconds; then the SSO fails.
    at("02:02:00");
    expect(await call(registry, createLog(), USER_124, "invoice.get", INVOICE)).toHaveProperty(
      "data",
    );
    server.replyStatus(503);
    at("02:02:01");
    const once = keyed(USER_124);
    expect(await call(registry, createLog(), once, "proposal.execute", { proposal })).toMatchObject(
      {
        code: "FRESHNESS_UNSATISFIABLE",
      },
    );
    // The SSO is back, and once the failure is no longer remembered, the same key releases it.
    server.replyStatus(undefined);
    at("02:02:31");
    expect(await call(registry, createLog(), once, "proposal.execute", { proposal })).toMatchObject(
      {
        outcome: "COMMITTED",
      },
    );
  });
});

describe("D26: a stranger's own calls use the answer that she is gone for 10 minutes", () => {
  it("D26: the same 20 sign-up accounts call again a minute later, the budget fresh: no question, and the stranger's words", async () => {
    await line2(signUps(20));
    expect(server.asked()).toBe(20);
    at("09:01:00");
    for (const heard of await line2(signUps(20))) {
      expect(heard).toMatchObject({ code: "AUTHORIZATION_DENIED", message: STRANGER });
    }
    expect(server.asked()).toBe(20);
  });

  it("D26: 10 minutes after her answer, a sign-up account is asked about again", async () => {
    await line2(signUps(1));
    at("09:09:59.999");
    await line2(signUps(1));
    expect(server.asked()).toBe(1);
    at("09:10:00");
    await line2(signUps(1));
    expect(server.asked()).toBe(2);
  });
});

describe("C4 and C5, from the review: the budget's edges", () => {
  it("D24: a call over the budget is not remembered: once the minute rolls on, the same stranger is asked about", async () => {
    await line2(signUps(20));
    at("09:00:55");
    await line2(["latecomer"]);
    expect(server.asked()).toBe(20);
    at("09:01:01");
    await line2(["latecomer"]);
    expect(server.asked()).toBe(21);
  });

  it("D23: budget moments from before a clock went back are dropped: the next stranger is asked about", async () => {
    await line2(signUps(20));
    at("08:00:00");
    await line2(["latecomer"]);
    expect(server.asked()).toBe(21);
  });

  it("D23, D25: during a pause, a stranger's call spends no budget: 20 strangers after it are all asked about", async () => {
    registry = slipRegistry(
      undefined,
      undefined,
      [],
      new Map([["org_456", lookupOf(server)]]),
      knownAnswers(),
    );
    server.replyStatus(503);
    await line2(KNOWN);
    expect(server.asked()).toBe(5);
    // Paused until 09:00:10. Strangers call during it, and nothing is asked.
    at("09:00:05");
    await line2(signUps(25));
    expect(server.asked()).toBe(5);
    // 09:00:10: someone DSoR knows is the trial, and is answered: the run ends.
    server.replyStatus(undefined);
    at("09:00:10");
    await line2(["user_201"]);
    expect(server.asked()).toBe(6);
    at("09:00:11");
    await line2(signUps(20, 26));
    expect(server.asked()).toBe(26);
  });
});
