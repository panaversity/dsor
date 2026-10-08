// Suspended slips. When a company's directory reports the person who signed a slip as
// suspended, deprovisioned, or not listed, DSoR suspends every active slip she signed in that
// company, in the call that heard it, with one record each (DSOR-IDN-07 in
// specs/dsor/02-security.md, section 12.1; step 19b's README, C1 to C4, C8, and C9). Here the
// slips and their records are in memory. test/suspended-slips.db.test.ts proves the
// suspensions in the database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Directory, Person } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { memorySlips, type MemorySlips, type Slip, type SlipStore } from "../src/slips.ts";
import {
  AGENT,
  DEL_100,
  DEL_101,
  DEL_102,
  FIRM_IN_456,
  FIRM_IN_789,
  INTAKE_SLIP,
  MASKED_1008_OF_789,
  STORY_SLIPS,
  SUPERVISOR,
  slipRegistry,
  storyDirectories,
} from "./helpers.ts";

const READ = { invoice: "dsor://org_456/invoice/INV-1008" };
const CREATE = { invoice: "dsor://org_456/invoice/INV-1008" };
const READ_789 = { invoice: "dsor://org_789/invoice/INV-1008" };

// user_123's slip in org_789, for firm-ap-fte, as in step 19's tests. It takes del_102's
// place, because one agent holds one slip in one company.
const DEL_103 = { ...DEL_102, id: "del_103", delegator: "user_123" };
// cfo_100's slip for intake-fte in org_456: someone else signed it.
const DEL_104 = { ...INTAKE_SLIP, id: "del_104", delegator: "cfo_100" };

const SUSPENDED: Person = { status: "suspended", roles: ["ap_supervisor"] };
const ACTIVE: Person = { status: "active", roles: ["ap_supervisor"] };

// The refusals, typed out rather than imported.
/** Step 19's refusal when the directory does not list the signer as active. */
function notActive(
  name: string,
  slip = "del_100",
  person = "user_123",
  tenant = "org_456",
): string {
  const whom = `whom the directory of ${tenant} does not list as active`;
  return `"${name}": slip ${slip} is signed by ${person}, ${whom}`;
}
/** Step 18's refusal when the slip's company does not list its signer. */
function notAPerson(name: string, slip = "del_100"): string {
  return `"${name}": slip ${slip} is signed by user_123, who is not a person in org_456`;
}
/** Step 18's refusal of a slip that is not active: here, a suspended one. */
function isSuspended(name: string, slip: string): string {
  return `"${name}": slip ${slip} is suspended, not active`;
}
/** The refusal when DSoR cannot confirm a suspension. It names no person and no word of the directory. */
const NOT_CONFIRMED =
  "DSoR could not confirm that this agent's slip is suspended, so it refuses the call";
const CANNOT_USE = "the directory of org_456 answered with something DSoR cannot use";

/** The record of one suspension, as step 19b's README, decisions 5 and 14, describe it. */
function suspension(
  delegation: string,
  word: string,
  correlation: Record<string, string>,
  as_of: string,
  tenant = "org_456",
): unknown {
  return {
    kind: "delegation_change",
    result: "suspended",
    reason: word,
    correlation,
    tenant,
    delegation,
    identity: {
      mode: "direct",
      subject: "dsor",
      actor_chain: [],
      subject_authority: { source: "role_source", as_of },
    },
  };
}

/** The story's registry with these slips, and org_456's directory saying this about user_123. */
function nightWith(slips: SlipStore, entry: Person | undefined) {
  const directories = storyDirectories();
  const org456 = directories.get("org_456")!;
  org456.set("user_123", entry);
  const rows: Payment[] = [];
  return { registry: slipRegistry(slips, undefined, rows, directories), directories, org456, rows };
}

/** A slip's status, as the store's own find reads it. */
async function statusOf(slips: SlipStore, tenant: string, agent: string): Promise<unknown> {
  return ((await slips.find(tenant, agent))?.slip as Slip | undefined)?.status;
}

/** The store in memory, counting each suspension asked of it, so a test can see one never tried. */
function counting(slips: MemorySlips): { store: SlipStore; tried: () => number } {
  let tried = 0;
  const store: SlipStore = {
    find: slips.find,
    suspend: async (tenant, delegator, why) => {
      tried += 1;
      return slips.suspend(tenant, delegator, why);
    },
  };
  return { store, tried: () => tried };
}

/** org_456's directory, giving this answer about any person: a shape the fake directory cannot make. */
function answering(fields: Record<string, unknown>): Directory {
  return {
    ask: async (person: string) => ({ tenant: "org_456", person, listed: true, ...fields }),
  };
}

// The clock of the story's week, faked, so a day takes no time. 2026-10-06 is the Tuesday.
/** Sets DSoR's clock to this time, in UTC. */
function at(time: string): void {
  vi.setSystemTime(new Date(`${time}:00Z`));
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

// The agent's correlation, as its call's own record has it (DSOR-COR-01a).
const THE_AGENTS = (request_id: string): Record<string, string> => ({
  request_id,
  agent_id: "accounts-payable-fte",
});

describe("C1: the directory reports user_123 as gone, and her active slips in org_456 are suspended in the same call", () => {
  it.each([
    ["suspended", SUSPENDED, "DELEGATION_REQUIRED", notActive],
    ["deprovisioned", { status: "deprovisioned", roles: [] }, "DELEGATION_REQUIRED", notActive],
    ["not listed", undefined, "AUTHORIZATION_DENIED", notAPerson],
  ])(
    "DSOR-IDN-07: user_123 is %s at 02:00 on Tuesday: the agent is refused as in step 19, and del_100 and del_101 are suspended, one record each",
    async (word, entry, code, message) => {
      const slips = memorySlips(STORY_SLIPS);
      const { registry } = nightWith(slips, entry);
      at("2026-10-06T02:00");
      const answer = await call(
        registry,
        createLog(),
        { ...AGENT, request_id: "req_tue_0200" },
        "invoice.get",
        READ,
      );
      expect(answer).toMatchObject({ code, message: message("invoice.get"), retry: "never" });
      expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("suspended");
      expect(await statusOf(slips, "org_456", "firm-ap-fte")).toBe("suspended");
      // As of 02:00, when DSoR asked the directory, and named with the agent's call.
      const time = "2026-10-06T02:00:00.000Z";
      expect(await slips.changes()).toStrictEqual([
        suspension("del_100", word, THE_AGENTS("req_tue_0200"), time),
        suspension("del_101", word, THE_AGENTS("req_tue_0200"), time),
      ]);
    },
  );

  it("DSOR-IDN-07: at 02:05 firm-ap-fte calls under del_101, and line ③ refuses it from the slip's own status, before the directory is asked", async () => {
    const slips = memorySlips(STORY_SLIPS);
    const { registry, org456 } = nightWith(slips, SUSPENDED);
    at("2026-10-06T02:00");
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    const asked = org456.asked();
    at("2026-10-06T02:05");
    const answer = await call(registry, createLog(), FIRM_IN_456, "invoice.get", READ);
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: isSuspended("invoice.get", "del_101"),
    });
    expect(org456.asked()).toBe(asked);
  });

  it("DSOR-IDN-07: only the slips she signed: cfo_100's slip for intake-fte stays active, with no record", async () => {
    const slips = memorySlips([...STORY_SLIPS, DEL_104]);
    const { registry } = nightWith(slips, SUSPENDED);
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    expect(await statusOf(slips, "org_456", "intake-fte")).toBe("active");
    expect((await slips.changes()).map((change) => change.delegation)).toStrictEqual([
      "del_100",
      "del_101",
    ]);
  });

  // Found by step 19b's sweep: nothing read the store's own answer.
  it("step 19b's decision 4: the store answers with the slips it suspended, and a second suspension of her slips changes nothing", async () => {
    const slips = memorySlips(STORY_SLIPS);
    const why = {
      word: "suspended",
      as_of: "2026-10-06T02:00:00.000Z",
      correlation: { request_id: "req_tue_0200" },
    };
    expect(await slips.suspend("org_456", "user_123", why)).toStrictEqual(["del_100", "del_101"]);
    expect(await slips.suspend("org_456", "user_123", why)).toStrictEqual([]);
    expect(await slips.changes()).toHaveLength(2);
  });
});

describe("C1 and decision 15: an answer that says she is not active needs no roles", () => {
  // A real directory often sends no roles for a person it removed. Found by step 19b's review.
  it("step 19b's decision 15: the directory says user_123 is deprovisioned and sends no roles: her slips are suspended", async () => {
    const slips = memorySlips(STORY_SLIPS);
    const directories = new Map<string, Directory>([
      ["org_456", answering({ status: "deprovisioned" })],
      ["org_789", storyDirectories().get("org_789")!],
    ]);
    const answer = await call(
      slipRegistry(slips, undefined, [], directories),
      createLog(),
      AGENT,
      "invoice.get",
      READ,
    );
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: notActive("invoice.get"),
    });
    expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("suspended");
    expect((await slips.changes()).map((change) => change.reason)).toStrictEqual([
      "deprovisioned",
      "deprovisioned",
    ]);
  });

  it.each([
    ["an active answer with no roles", { status: "active" }],
    ["roles that are not a list of words", { status: "suspended", roles: "ap_supervisor" }],
  ])(
    "step 19's decision 11: %s is still something DSoR cannot use, and nothing is suspended",
    async (_, fields) => {
      const slips = memorySlips(STORY_SLIPS);
      const directories = new Map<string, Directory>([
        ["org_456", answering(fields)],
        ["org_789", storyDirectories().get("org_789")!],
      ]);
      const answer = await call(
        slipRegistry(slips, undefined, [], directories),
        createLog(),
        AGENT,
        "invoice.get",
        READ,
      );
      expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
      expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("active");
      expect(await slips.changes()).toStrictEqual([]);
    },
  );
});

describe("C2: a suspension survives the signer's return", () => {
  // Break B1's story. Without a suspension, Thursday's draft is made: step 19's own gap.
  it("DSOR-IDN-07: suspended on Monday, refused on Tuesday, active again on Wednesday: on Thursday both agents are still refused, and no draft is made", async () => {
    const slips = memorySlips(STORY_SLIPS);
    at("2026-10-05T09:00");
    const { registry, org456, rows } = nightWith(slips, SUSPENDED);
    at("2026-10-06T02:00");
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    at("2026-10-07T09:00");
    org456.set("user_123", ACTIVE);
    at("2026-10-08T02:00");
    expect(
      await call(registry, createLog(), AGENT, "payment.create", {
        ...CREATE,
        expected_version: 1,
      }),
    ).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: isSuspended("payment.create", "del_100"),
    });
    expect(await call(registry, createLog(), FIRM_IN_456, "invoice.get", READ)).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: isSuspended("invoice.get", "del_101"),
    });
    expect(rows).toStrictEqual([]);
    expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("suspended");
  });
});

describe("C3: a suspension stays inside the company whose directory reported", () => {
  // Break B2's story, in memory.
  it("DSOR-IDN-03b: org_456's directory reports user_123 as suspended, and her del_103 in org_789 stays active, with no record", async () => {
    const slips = memorySlips([DEL_100, DEL_101, DEL_103]);
    const { registry } = nightWith(slips, SUSPENDED);
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    expect(await statusOf(slips, "org_789", "firm-ap-fte")).toBe("active");
    const changes = (await slips.changes()).map((change) => [change.tenant, change.delegation]);
    expect(changes).toStrictEqual([
      ["org_456", "del_100"],
      ["org_456", "del_101"],
    ]);
  });

  it("DSOR-IDN-04a: firm-ap-fte still reads in org_789 under del_103, where org_789's own directory lists user_123 as active", async () => {
    const slips = memorySlips([DEL_100, DEL_101, DEL_103]);
    const { registry, directories } = nightWith(slips, SUSPENDED);
    directories.get("org_789")!.set("user_123", ACTIVE);
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    expect(await call(registry, createLog(), FIRM_IN_789, "invoice.get", READ_789)).toMatchObject({
      data: MASKED_1008_OF_789,
    });
    expect(await statusOf(slips, "org_456", "firm-ap-fte")).toBe("suspended");
  });

  // The other way round: org_789's own report suspends org_789's slip only, in org_789. Found by
  // step 19b's sweep, which made every suspension happen in org_456 with every test green.
  it("DSOR-IDN-03b: org_789's directory reports user_700 as suspended: del_102 is suspended, in org_789, and org_456's slips stay active", async () => {
    const slips = memorySlips(STORY_SLIPS);
    const { registry, directories } = nightWith(slips, ACTIVE);
    directories.get("org_789")!.set("user_700", SUSPENDED);
    at("2026-10-06T02:00");
    const answer = await call(
      registry,
      createLog(),
      { ...FIRM_IN_789, request_id: "req_789" },
      "invoice.get",
      READ_789,
    );
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: notActive("invoice.get", "del_102", "user_700", "org_789"),
    });
    expect(await statusOf(slips, "org_789", "firm-ap-fte")).toBe("suspended");
    expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("active");
    expect(await statusOf(slips, "org_456", "firm-ap-fte")).toBe("active");
    expect(await slips.changes()).toStrictEqual([
      suspension(
        "del_102",
        "suspended",
        { request_id: "req_789", agent_id: "firm-ap-fte" },
        "2026-10-06T02:00:00.000Z",
        "org_789",
      ),
    ]);
  });
});

describe("C4: a suspension that cannot be confirmed gives INTERNAL_ERROR", () => {
  it("step 19b's decision 7: the store cannot write the suspension: the agent hears INTERNAL_ERROR, the call's record says so, and the store's words go nowhere", async () => {
    const slips = memorySlips(STORY_SLIPS);
    const broken: SlipStore = {
      find: slips.find,
      suspend: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.9:5432, password hunter2");
      },
    };
    const { registry } = nightWith(broken, SUSPENDED);
    const log = createLog();
    const answer = await call(registry, log, AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({
      code: "INTERNAL_ERROR",
      message: NOT_CONFIRMED,
      retry: "never",
    });
    expect(await log.records()).toMatchObject([
      { authorization: "DENY", result: "INTERNAL_ERROR", reason: NOT_CONFIRMED },
    ]);
    expect(JSON.stringify([answer, await log.records()])).not.toContain("hunter2");
    expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("active");
  });

  // The kept answer is the directory's word too (step 19b's README, "what follows"): a suspension
  // is tried on a usable answer, fresh or kept. Its record is as of the answer, not of the call.
  it("DSOR-IDN-07: the suspension failed at 02:00, and at 02:10 the directory is off: DSoR suspends her slips from the answer it kept, as of 02:00", async () => {
    const slips = memorySlips(STORY_SLIPS);
    let broken = true;
    const flaky: SlipStore = {
      find: slips.find,
      suspend: async (tenant, delegator, why) => {
        if (broken) throw new Error("the log is full");
        return slips.suspend(tenant, delegator, why);
      },
    };
    const { registry, org456 } = nightWith(flaky, SUSPENDED);
    at("2026-10-06T02:00");
    expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
      code: "INTERNAL_ERROR",
    });
    broken = false;
    org456.turn("off");
    at("2026-10-06T02:10");
    const answer = await call(
      registry,
      createLog(),
      { ...AGENT, request_id: "req_tue_0210" },
      "invoice.get",
      READ,
    );
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: notActive("invoice.get"),
    });
    const time = "2026-10-06T02:00:00.000Z";
    expect(await slips.changes()).toStrictEqual([
      suspension("del_100", "suspended", THE_AGENTS("req_tue_0210"), time),
      suspension("del_101", "suspended", THE_AGENTS("req_tue_0210"), time),
    ]);
  });
});

describe("C8: only slips whose status is active are suspended", () => {
  // Break B3's story: del_101 was torn up last week.
  it("DSOR-IDN-07: a torn-up slip stays revoked, and an expired one stays expired, with no record for either", async () => {
    const torn = { ...DEL_101, status: "revoked" };
    const old = { ...INTAKE_SLIP, status: "expired" };
    const slips = memorySlips([DEL_100, torn, old]);
    const { registry } = nightWith(slips, SUSPENDED);
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("suspended");
    expect(await statusOf(slips, "org_456", "firm-ap-fte")).toBe("revoked");
    expect(await statusOf(slips, "org_456", "intake-fte")).toBe("expired");
    expect((await slips.changes()).map((change) => change.delegation)).toStrictEqual(["del_100"]);
  });

  // A slip past its date whose status still says active is suspended too. Line ③ refuses it
  // either way, and if a person later moves its date, it stays stopped. Found by step 19b's
  // review: C8 said "an expired one" and meant its status.
  it("DSOR-IDN-07: a slip past its date whose status still says active is suspended too", async () => {
    const past = { ...INTAKE_SLIP, expires_at: "2001-01-01T00:00:00Z" };
    const slips = memorySlips([DEL_100, past]);
    const { registry } = nightWith(slips, SUSPENDED);
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    expect(await statusOf(slips, "org_456", "intake-fte")).toBe("suspended");
  });
});

// Each test counts the suspensions asked of the store, so "nothing changed" cannot pass for a
// suspension that was tried and found nothing. Found by step 19b's sweep.
describe("C9: no suspension is tried for an answer DSoR cannot use, for no answer, or for a person's own call", () => {
  it("step 19's decision 11: a directory that says on_leave gives INTERNAL_ERROR, and no suspension is tried", async () => {
    const slips = memorySlips(STORY_SLIPS);
    const { store, tried } = counting(slips);
    const { registry } = nightWith(store, { status: "on_leave", roles: ["ap_supervisor"] });
    expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
      code: "INTERNAL_ERROR",
      message: CANNOT_USE,
    });
    expect(tried()).toBe(0);
    expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("active");
  });

  it("DSOR-IDN-06: with the directory off and no answer kept, the agent is refused, and no suspension is tried", async () => {
    const slips = memorySlips(STORY_SLIPS);
    const { store, tried } = counting(slips);
    const { registry, org456 } = nightWith(store, SUSPENDED);
    org456.turn("off");
    expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
    });
    expect(tried()).toBe(0);
    expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("active");
  });

  it("step 19's decision 2: user_123 calls for herself while the directory says suspended: the directory is not asked, and no suspension is tried", async () => {
    const slips = memorySlips(STORY_SLIPS);
    const { store, tried } = counting(slips);
    const { registry, org456 } = nightWith(store, SUSPENDED);
    expect(await call(registry, createLog(), SUPERVISOR, "invoice.get", READ)).toMatchObject({
      data: { tenant_id: "org_456", id: "INV-1008" },
    });
    expect(org456.asked()).toBe(0);
    expect(tried()).toBe(0);
    expect(await statusOf(slips, "org_456", "accounts-payable-fte")).toBe("active");
  });
});
