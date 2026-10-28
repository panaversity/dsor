// NEW IN STEP 45c: each DSoR server sends at most 20 lookups in any minute, for each company, about
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
import { AGENT, CFO, MASKED_1008_OF_456, slipRegistry } from "./helpers.ts";
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
  it("D24, DSOR-ERR-01b: over the budget, a call hears the stranger's words at once, with no question, and five such calls start no pause", async () => {
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
