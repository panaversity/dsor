// The role source. When an agent calls, DSoR asks the directory of the slip's company about
// the person who signed it, at every call, and refuses when it cannot get a fresh enough
// answer (DSOR-IDN-05 and DSOR-IDN-06 in specs/dsor/02-security.md, section 12.1; step 19's
// README, C1 to C12).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRoleSettings,
  createRoleSource,
  keptKey,
  readRoleSettings,
  type Kept,
  type RoleSettingsSource,
} from "../src/authority.ts";
import type { Directory } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { logins } from "../src/principals.ts";
import { buildRegistry } from "../src/registry.ts";
import { memorySlips } from "../src/slips.ts";
import type { Slip } from "../src/slips.ts";
import {
  AGENT,
  CFO,
  DEL_100,
  DEL_101,
  DEL_102,
  FIRM_IN_456,
  FIRM_IN_789,
  MASKED_1008_OF_456,
  MASKED_1008_OF_789,
  STORY_SLIPS,
  SUPERVISOR,
  handlers,
  refusal,
  shipped,
  shippedRoles,
  slipRegistry,
  storyDirectories,
} from "./helpers.ts";

const CREATE = { invoice: "dsor://org_456/invoice/INV-1008" };
const READ = { invoice: "dsor://org_456/invoice/INV-1008" };
const READ_789 = { invoice: "dsor://org_789/invoice/INV-1008" };

// The five operations, each with a good input, so only line ③ can refuse.
const OPERATIONS: [string, unknown][] = [
  ["invoice.get", READ],
  ["invoice.list", { limit: 10 }],
  ["invoice.issue", READ],
  ["payment.create", CREATE],
  ["payment.cancel", { payment: "dsor://org_456/payment/PAY-901" }],
];

// The refusals of line ③'s last question, typed out rather than imported.
/** The message when no answer about the signer is fresh enough. It names no bound. */
function noFreshAnswer(
  name: string,
  person = "user_123",
  slip = "del_100",
  tenant = "org_456",
): string {
  const where = `from the directory of ${tenant} that is recent enough`;
  return `"${name}": DSoR has no answer about ${person}, who signed slip ${slip}, ${where}`;
}

/** The message when the directory does not list the signer as active, whatever it says. */
function notActive(name: string): string {
  const whom = "whom the directory of org_456 does not list as active";
  return `"${name}": slip del_100 is signed by user_123, ${whom}`;
}

/** The message when the slip's company does not list its signer. Step 18's, unchanged. */
function notAPerson(name: string, person: string, tenant = "org_456"): string {
  return `"${name}": slip del_100 is signed by ${person}, who is not a person in ${tenant}`;
}

const CANNOT_USE = "the directory of org_456 answered with something DSoR cannot use";

/** A settings file with this content. */
function settingsFile(data: unknown): RoleSettingsSource {
  return {
    file: "role-sources.json",
    text: typeof data === "string" ? data : JSON.stringify(data),
  };
}

/** Builds a registry with this settings file, and names what start-up refused. */
function startWith(settings: RoleSettingsSource): string {
  return refusal(() =>
    buildRegistry(
      shipped,
      handlers,
      shippedRoles,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      storyDirectories(),
      settings,
    ),
  );
}

const GOOD_456 = { kind: "idp_lookup", max_staleness: "PT1H" };
const GOOD_789 = { kind: "idp_lookup", max_staleness: "PT4H" };

// The clock of the story's night. Faked, so "75 minutes later" takes no time (step 19's
// README, decision 3).
const NIGHT = "2026-10-06";
/** Sets DSoR's clock to this time of the story's night, in UTC. */
function at(time: string): void {
  vi.setSystemTime(new Date(`${NIGHT}T${time}:00Z`));
}

describe("C1: each company has its own role source, or DSoR does not start", () => {
  it("DSOR-IDN-05: the shipped role-sources.json gives both companies a lookup, PT1H and PT4H", () => {
    const { settings, problems } = checkRoleSettings(readRoleSettings(), logins.values());
    expect(problems).toStrictEqual([]);
    expect([...settings]).toStrictEqual([
      ["org_456", { kind: "idp_lookup", max_staleness: "PT1H", ms: 3600000 }],
      ["org_789", { kind: "idp_lookup", max_staleness: "PT4H", ms: 14400000 }],
    ]);
  });

  it.each([
    [
      "a company where logins work, and no setting",
      { org_456: GOOD_456 },
      "org_789, where logins work, has no role source",
    ],
    [
      "a setting for a company where no login works",
      { org_456: GOOD_456, org_789: GOOD_789, org_999: GOOD_456 },
      "org_999 has a role source, but no login works there",
    ],
    [
      "a company id that is not one",
      { org_456: GOOD_456, org_789: GOOD_789, acme: GOOD_456 },
      '"acme" is not a company id like org_456',
    ],
    [
      "the kind scim",
      { org_456: { ...GOOD_456, kind: "scim" }, org_789: GOOD_789 },
      'org_456\'s kind "scim" is not built: step 19 asks a directory at each call, idp_lookup',
    ],
    [
      "the kind dsor_assignments",
      { org_456: { ...GOOD_456, kind: "dsor_assignments" }, org_789: GOOD_789 },
      'org_456\'s kind "dsor_assignments" is not built: step 19 asks a directory at each call, idp_lookup',
    ],
    [
      "a kind the schema does not know",
      { org_456: { ...GOOD_456, kind: "ldap" }, org_789: GOOD_789 },
      "org_456/kind must be equal to one of the allowed values",
    ],
    [
      "no kind",
      { org_456: { max_staleness: "PT1H" }, org_789: GOOD_789 },
      "org_456 must have required property 'kind'",
    ],
    [
      "no bound",
      { org_456: { kind: "idp_lookup" }, org_789: GOOD_789 },
      "org_456 must have required property 'max_staleness'",
    ],
    [
      "two days",
      { org_456: { ...GOOD_456, max_staleness: "P2D" }, org_789: GOOD_789 },
      'org_456\'s max_staleness "P2D" is over 24 hours, the most §44 allows at L2 (DSOR-BND-02)',
    ],
    [
      "a day and a second",
      { org_456: { ...GOOD_456, max_staleness: "P1DT1S" }, org_789: GOOD_789 },
      'org_456\'s max_staleness "P1DT1S" is over 24 hours, the most §44 allows at L2 (DSOR-BND-02)',
    ],
    [
      "a bound in words",
      { org_456: { ...GOOD_456, max_staleness: "an hour" }, org_789: GOOD_789 },
      "org_456/max_staleness must match pattern",
    ],
    [
      "a day and a minute",
      { org_456: { ...GOOD_456, max_staleness: "P1DT1M" }, org_789: GOOD_789 },
      'org_456\'s max_staleness "P1DT1M" is over 24 hours, the most §44 allows at L2 (DSOR-BND-02)',
    ],
    [
      "a setting that is not an object",
      { org_456: "PT1H", org_789: GOOD_789 },
      "org_456 must be object",
    ],
  ])("DSOR-IDN-05: start-up refuses %s, and names it", (_case, data, problem) => {
    expect(startWith(settingsFile(data))).toContain(`role-sources.json: ${problem}`);
  });

  it.each([
    ["text that is not JSON", "{ org_456: ", "role-sources.json: not valid JSON"],
    [
      "null",
      "null",
      "role-sources.json: must be an object that gives each company its role source",
    ],
    [
      "a list",
      "[]",
      "role-sources.json: must be an object that gives each company its role source",
    ],
    [
      "one company written twice",
      `{ "org_456": ${JSON.stringify(GOOD_456)}, "org_456": ${JSON.stringify(GOOD_456)}, "org_789": ${JSON.stringify(GOOD_789)} }`,
      'role-sources.json: "org_456" is written twice in one object',
    ],
  ])("DSOR-IDN-05: start-up refuses a settings file with %s", (_case, text, problem) => {
    expect(startWith(settingsFile(text))).toContain(problem);
  });

  it("DSOR-IDN-05: a bound in days, hours, minutes, and seconds is read whole", () => {
    const text = JSON.stringify({
      org_456: { ...GOOD_456, max_staleness: "P0DT1H30M15S" },
      org_789: GOOD_789,
    });
    const { settings, problems } = checkRoleSettings(settingsFile(text), logins.values());
    expect(problems).toStrictEqual([]);
    expect(settings.get("org_456")?.ms).toBe(5415000);
  });

  it("DSOR-BND-02: 24 hours exactly, and zero, are allowed: §44 lets a company set a tighter value", () => {
    for (const bound of ["P1D", "PT24H", "PT0S", "PT"]) {
      const data = { org_456: { ...GOOD_456, max_staleness: bound }, org_789: GOOD_789 };
      expect(startWith(settingsFile(data))).toBe("");
    }
  });
});

describe("C2: at every call from an agent, the signer's directory decides line ⑤", () => {
  it("DSOR-IDN-05: the agent's draft follows user_123's job in the directory, call by call, with no restart", async () => {
    const directories = storyDirectories();
    const org456 = directories.get("org_456")!;
    const rows: Payment[] = [];
    const registry = slipRegistry(undefined, undefined, rows, directories);
    expect(await call(registry, createLog(), AGENT, "payment.create", CREATE)).toMatchObject({
      data: { status: "draft" },
    });

    // 02:05: the directory moves user_123 to a job that may only read invoices.
    org456.set("user_123", { status: "active", roles: ["ap_clerk"] });
    const lines: number[] = [];
    expect(
      await call(registry, createLog(), AGENT, "payment.create", CREATE, (n) => lines.push(n)),
    ).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"payment.create" needs payment:create, which user_123, who signed slip del_100, does not hold now',
    });
    expect(lines).toStrictEqual([1, 2, 3, 5, 11]);
    // The read is still answered: del_100 lists invoice:read, and ap_clerk holds it.
    expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
      data: MASKED_1008_OF_456,
    });

    // Back to her old job: the next draft is made again.
    org456.set("user_123", { status: "active", roles: ["ap_supervisor"] });
    expect(await call(registry, createLog(), AGENT, "payment.create", CREATE)).toMatchObject({
      data: { status: "draft" },
    });
    expect(rows).toHaveLength(2);
    // One question for each of the four calls.
    expect(org456.asked()).toBe(4);
  });

  it("DSOR-DEL-02: a role the directory names and roles.json does not have grants nothing", async () => {
    const directories = storyDirectories();
    directories.get("org_456")!.set("user_123", { status: "active", roles: ["ap_lead"] });
    const answer = await call(
      slipRegistry(undefined, undefined, [], directories),
      createLog(),
      AGENT,
      "invoice.get",
      READ,
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"invoice.get" needs invoice:read, which user_123, who signed slip del_100, does not hold now',
    });
  });
});

describe("C3 and C4: with no answer, a kept answer counts only while it is younger than the bound", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    at("01:30");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A registry whose org_456 directory answered at 01:30, and then went off at 02:00. */
  async function offSince0200(rows: Payment[] = []) {
    const directories = storyDirectories();
    const registry = slipRegistry(undefined, undefined, rows, directories);
    expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
      data: MASKED_1008_OF_456,
    });
    at("02:00");
    directories.get("org_456")!.turn("off");
    return registry;
  }

  it("DSOR-IDN-06: with the directory off, a kept answer 40 minutes old counts, and the draft is made", async () => {
    const rows: Payment[] = [];
    const registry = await offSince0200(rows);
    at("02:10");
    const answer = await call(registry, createLog(), AGENT, "payment.create", CREATE);
    expect(answer).toMatchObject({ data: { status: "draft" } });
    expect(rows).toHaveLength(1);
  });

  it.each(OPERATIONS)(
    "DSOR-IDN-06: with the directory off and a kept answer 75 minutes old, %s is refused at line ③, recorded, with no draft",
    async (name, input) => {
      const rows: Payment[] = [];
      const registry = await offSince0200(rows);
      at("02:45");
      const log = createLog();
      const lines: number[] = [];
      const answer = await call(registry, log, AGENT, name, input, (n) => lines.push(n));
      expect(answer).toMatchObject({
        code: "FRESHNESS_UNSATISFIABLE",
        message: noFreshAnswer(name),
        retry: "after_delay",
      });
      expect(lines).toStrictEqual([1, 2, 3, 11]);
      const [record] = await log.records();
      expect(record).toMatchObject({ authorization: "DENY", result: "FRESHNESS_UNSATISFIABLE" });
      // A call refused at line ③ names no slip and no subject, as in step 18.
      expect(record).not.toHaveProperty("delegation");
      expect(record).not.toHaveProperty("identity");
      expect(rows).toStrictEqual([]);
    },
  );

  it.each(OPERATIONS)(
    "DSOR-IDN-06: with the directory off and no kept answer, %s is refused at line ③",
    async (name, input) => {
      const directories = storyDirectories();
      directories.get("org_456")!.turn("off");
      const lines: number[] = [];
      const answer = await call(
        slipRegistry(undefined, undefined, [], directories),
        createLog(),
        AGENT,
        name,
        input,
        (n) => lines.push(n),
      );
      expect(answer).toMatchObject({
        code: "FRESHNESS_UNSATISFIABLE",
        message: noFreshAnswer(name),
      });
      expect(lines).toStrictEqual([1, 2, 3, 11]);
    },
  );

  it("DSOR-IDN-06: a stuck directory holds a call 2 seconds at most, and then a kept answer 40 minutes old counts", async () => {
    const directories = storyDirectories();
    const registry = slipRegistry(undefined, undefined, [], directories);
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    directories.get("org_456")!.turn("stuck");
    at("02:10");
    let answered = false;
    const pending = call(registry, createLog(), AGENT, "payment.create", CREATE).then((a) => {
      answered = true;
      return a;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ data: { status: "draft" } });
  });

  it("DSOR-IDN-06: a kept answer a millisecond under 60 minutes old counts, and one exactly 60 minutes old does not", async () => {
    const registry = await offSince0200();
    vi.setSystemTime(new Date(`${NIGHT}T02:29:59.999Z`));
    expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
      data: MASKED_1008_OF_456,
    });
    at("02:30");
    expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
    });
  });

  it("step 19's decision 15: a kept answer from the future never counts: the clock went back", async () => {
    const registry = await offSince0200();
    at("00:30");
    expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
    });
  });

  it("DSOR-IDN-06: a directory that throws at once gives no answer, and no error of its own", async () => {
    const directories = new Map<string, Directory>([
      ...storyDirectories(),
      [
        "org_456",
        {
          ask: () => {
            throw new Error("refused at once");
          },
        },
      ],
    ]);
    const answer = await call(
      slipRegistry(undefined, undefined, [], directories),
      createLog(),
      AGENT,
      "invoice.get",
      READ,
    );
    expect(answer).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE", retry: "after_delay" });
  });

  it.each([
    [1999, "the new answer, ap_clerk", { code: "AUTHORIZATION_DENIED" }],
    [2001, "the kept answer, ap_supervisor", { data: { status: "draft" } }],
  ])(
    "step 19's decision 9: an answer that comes after %i ms: DSoR uses %s",
    async (ms, _used, expected) => {
      let late = false;
      const HER = { tenant: "org_456", person: "user_123", listed: true, status: "active" };
      const directory: Directory = {
        ask: async () =>
          late
            ? new Promise((resolve) =>
                setTimeout(() => resolve({ ...HER, roles: ["ap_clerk"] }), ms),
              )
            : { ...HER, roles: ["ap_supervisor"] },
      };
      const registry = slipRegistry(
        undefined,
        undefined,
        [],
        new Map<string, Directory>([...storyDirectories(), ["org_456", directory]]),
      );
      await call(registry, createLog(), AGENT, "invoice.get", READ);
      late = true;
      at("01:40");
      const pending = call(registry, createLog(), AGENT, "payment.create", CREATE);
      await vi.advanceTimersByTimeAsync(2001);
      expect(await pending).toMatchObject(expected);
    },
  );

  it("step 19's decision 9: a call the directory answered at once leaves no timer behind", async () => {
    await call(slipRegistry(), createLog(), AGENT, "invoice.get", READ);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("DSOR-IDN-05: a company with no directory is a fault in DSoR's set-up, not an outage", async () => {
    const answer = await call(
      slipRegistry(undefined, undefined, [], new Map()),
      createLog(),
      AGENT,
      "invoice.get",
      READ,
    );
    expect(answer).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "DSoR has no role source for org_456",
    });
  });

  it.each([
    ["is suspended", { status: "suspended", roles: ["ap_supervisor"] }, "DELEGATION_REQUIRED"],
    ["moves to ap_clerk", { status: "active", roles: ["ap_clerk"] }, "AUTHORIZATION_DENIED"],
    ["is no longer listed", undefined, "AUTHORIZATION_DENIED"],
  ])(
    "DSOR-IDN-06: user_123 %s at 01:40, the directory goes off at 01:45, and at 01:50 her agent is still refused",
    async (_change, entry, code) => {
      const directories = storyDirectories();
      const org456 = directories.get("org_456")!;
      const rows: Payment[] = [];
      const registry = slipRegistry(undefined, undefined, rows, directories);
      await call(registry, createLog(), AGENT, "invoice.get", READ);
      at("01:40");
      org456.set("user_123", entry);
      expect(await call(registry, createLog(), AGENT, "payment.create", CREATE)).toMatchObject({
        code,
      });
      at("01:45");
      org456.turn("off");
      at("01:50");
      expect(await call(registry, createLog(), AGENT, "payment.create", CREATE)).toMatchObject({
        code,
      });
      expect(rows).toStrictEqual([]);
    },
  );

  it("step 19's decision 14: an older answer that arrives late never replaces a newer kept one", async () => {
    // Question A goes first, and its answer, ap_supervisor, takes 300 ms. Question B goes 10 ms
    // later, and its answer, ap_clerk, the newer news, comes at once.
    const queue = [
      { roles: ["ap_supervisor"], after: 300 },
      { roles: ["ap_clerk"], after: 0 },
    ];
    let off = false;
    const directory: Directory = {
      ask: async () => {
        if (off) throw new Error("off");
        const { roles, after } = queue.shift()!;
        const answer = {
          tenant: "org_456",
          person: "user_123",
          listed: true,
          status: "active",
          roles,
        };
        if (after === 0) return answer;
        return new Promise((resolve) => setTimeout(() => resolve(answer), after));
      },
    };
    const registry = slipRegistry(
      undefined,
      undefined,
      [],
      new Map<string, Directory>([...storyDirectories(), ["org_456", directory]]),
    );
    const first = call(registry, createLog(), AGENT, "invoice.get", READ);
    await vi.advanceTimersByTimeAsync(10);
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    await vi.advanceTimersByTimeAsync(300);
    await first;
    // 01:35: the directory is off. The kept answer must be B's, ap_clerk.
    off = true;
    at("01:35");
    expect(await call(registry, createLog(), AGENT, "payment.create", CREATE)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });

  it("DSOR-IDN-06: a stuck directory and no kept answer: FRESHNESS_UNSATISFIABLE after 2 seconds, not never", async () => {
    const directories = storyDirectories();
    directories.get("org_456")!.turn("stuck");
    const pending = call(
      slipRegistry(undefined, undefined, [], directories),
      createLog(),
      AGENT,
      "payment.create",
      CREATE,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
      message: noFreshAnswer("payment.create"),
    });
  });
});

describe("C5 and C6: each company's bound, and each company's answers", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    at("00:10");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("DSOR-BND-02: a kept answer 2 hours old is refused in org_456 (PT1H) and counts in org_789 (PT4H)", async () => {
    const directories = storyDirectories();
    const registry = slipRegistry(undefined, undefined, [], directories);
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    await call(registry, createLog(), FIRM_IN_789, "invoice.get", READ_789);
    directories.get("org_456")!.turn("off");
    directories.get("org_789")!.turn("off");
    at("02:10");
    expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
    });
    expect(await call(registry, createLog(), FIRM_IN_789, "invoice.get", READ_789)).toMatchObject({
      data: MASKED_1008_OF_789,
    });
  });

  it("DSOR-TEN-02a: org_456's kept answer about user_123 never answers for a slip in org_789", async () => {
    // In org_789, firm-ap-fte works under del_103, a test slip that user_123 signed there.
    const DEL_103 = { ...DEL_102, id: "del_103", delegator: "user_123" };
    const directories = storyDirectories();
    const registry = slipRegistry(
      memorySlips([DEL_100, DEL_101, DEL_103]),
      undefined,
      [],
      directories,
    );
    // 00:10: the firm's agent reads in org_456 under del_101, so DSoR keeps org_456's answer
    // about user_123.
    expect(await call(registry, createLog(), FIRM_IN_456, "invoice.get", READ)).toMatchObject({
      data: MASKED_1008_OF_456,
    });
    directories.get("org_789")!.turn("off");
    at("00:20");
    const answer = await call(registry, createLog(), FIRM_IN_789, "invoice.get", READ_789);
    expect(answer).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
      message: noFreshAnswer("invoice.get", "user_123", "del_103", "org_789"),
    });
  });
});

describe("C7: a signer the directory reports as suspended or deprovisioned gives nothing", () => {
  it.each(
    ["suspended", "deprovisioned"].flatMap((status) =>
      OPERATIONS.map(([name, input]) => [status, name, input] as const),
    ),
  )(
    "step 19's decision 6: user_123 %s, %s is refused at line ③ with DELEGATION_REQUIRED, and del_100 stays active",
    async (status, name, input) => {
      const directories = storyDirectories();
      directories.get("org_456")!.set("user_123", { status, roles: ["ap_supervisor"] });
      const slips = memorySlips(STORY_SLIPS);
      const rows: Payment[] = [];
      const log = createLog();
      const lines: number[] = [];
      const answer = await call(
        slipRegistry(slips, undefined, rows, directories),
        log,
        AGENT,
        name,
        input,
        (n) => lines.push(n),
      );
      expect(answer).toMatchObject({
        code: "DELEGATION_REQUIRED",
        message: notActive(name),
        retry: "never",
      });
      expect(lines).toStrictEqual([1, 2, 3, 11]);
      expect(await log.records()).toMatchObject([{ result: "DELEGATION_REQUIRED" }]);
      expect(rows).toStrictEqual([]);
      // The slip itself is not suspended: that is step 19b's work (DSOR-IDN-07).
      expect(((await slips.find("org_456", "accounts-payable-fte"))?.slip as Slip).status).toBe(
        "active",
      );
    },
  );
});

describe("C8: only the directory speaks for the absent signer's job", () => {
  it.each([["user_700, who works only in org_789", "user_700"]])(
    "DSOR-IDN-03a: a slip in org_456 signed by %s, whom org_456's directory does not list, is refused at line ③",
    async (_who, signer) => {
      const lines: number[] = [];
      const answer = await call(
        slipRegistry(memorySlips([{ ...DEL_100, delegator: signer }])),
        createLog(),
        AGENT,
        "payment.create",
        CREATE,
        (n) => lines.push(n),
      );
      expect(answer).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: notAPerson("payment.create", signer),
      });
      expect(lines).toStrictEqual([1, 2, 3, 11]);
    },
  );

  it("DSOR-IDN-04b: DSoR's login table says ap_supervisor and the directory says ap_clerk: the directory decides", async () => {
    const directories = storyDirectories();
    directories.get("org_456")!.set("user_123", { status: "active", roles: ["ap_clerk"] });
    expect(logins.get("tok_2c91")?.memberships).toStrictEqual([
      { tenant_id: "org_456", roles: ["ap_supervisor"] },
    ]);
    const answer = await call(
      slipRegistry(undefined, undefined, [], directories),
      createLog(),
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("DSOR-IDN-04b: a signer whom org_456's directory lists counts, though DSoR's login table does not list her there", async () => {
    const directories = storyDirectories();
    directories.get("org_456")!.set("user_700", { status: "active", roles: ["ap_supervisor"] });
    const rows: Payment[] = [];
    const answer = await call(
      slipRegistry(
        memorySlips([{ ...DEL_100, delegator: "user_700" }]),
        undefined,
        rows,
        directories,
      ),
      createLog(),
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ data: { status: "draft" } });
    expect(rows).toHaveLength(1);
  });
});

describe("C13: only a person whom DSoR knows signs a slip", () => {
  it.each([
    ["the agent firm-ap-fte, though the directory lists it", "firm-ap-fte"],
    ["the agent that holds the slip", "accounts-payable-fte"],
    ["somebody DSoR does not know, though the directory lists them", "user_999"],
  ])(
    "step 19's decision 13: a slip signed by %s is refused at line ③, before the directory is asked",
    async (_who, signer) => {
      const directories = storyDirectories();
      const org456 = directories.get("org_456")!;
      // A real directory lists service accounts too.
      org456.set(signer, { status: "active", roles: ["ap_supervisor"] });
      const rows: Payment[] = [];
      const answer = await call(
        slipRegistry(
          memorySlips([{ ...DEL_100, delegator: signer }]),
          undefined,
          rows,
          directories,
        ),
        createLog(),
        AGENT,
        "payment.create",
        CREATE,
      );
      expect(answer).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: notAPerson("payment.create", signer),
      });
      expect(org456.asked()).toBe(0);
      expect(rows).toStrictEqual([]);
    },
  );
});

describe("C9: an agent's record names the source and time of its signer's authority", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    at("02:00");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("DSOR-DEL-10: a draft on a fresh answer records role_source, as of the time of the answer", async () => {
    const log = createLog();
    await call(slipRegistry(), log, AGENT, "payment.create", CREATE);
    expect(await log.records()).toMatchObject([
      {
        result: "ok",
        delegation: "del_100",
        identity: {
          mode: "unattended",
          subject: "user_123",
          actor_chain: ["accounts-payable-fte"],
          subject_authority: { source: "role_source", as_of: `${NIGHT}T02:00:00.000Z` },
        },
      },
    ]);
  });

  it("DSOR-DEL-10: a draft on a kept answer records the time of that answer, not of the call", async () => {
    const directories = storyDirectories();
    const registry = slipRegistry(undefined, undefined, [], directories);
    at("01:30");
    await call(registry, createLog(), AGENT, "invoice.get", READ);
    directories.get("org_456")!.turn("off");
    at("02:10");
    const log = createLog();
    await call(registry, log, AGENT, "payment.create", CREATE);
    const [record] = await log.records();
    expect(record?.identity?.subject_authority).toStrictEqual({
      source: "role_source",
      as_of: `${NIGHT}T01:30:00.000Z`,
    });
  });

  it("DSOR-DEL-10: a call refused at line ⑤ records the source and time too, because it passed line ③", async () => {
    const directories = storyDirectories();
    directories.get("org_456")!.set("user_123", { status: "active", roles: ["ap_clerk"] });
    const log = createLog();
    await call(
      slipRegistry(undefined, undefined, [], directories),
      log,
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(await log.records()).toMatchObject([
      {
        result: "AUTHORIZATION_DENIED",
        identity: { subject_authority: { source: "role_source", as_of: `${NIGHT}T02:00:00.000Z` } },
      },
    ]);
  });

  it("DSOR-DEL-10: a person's own record is unchanged: no identity, no slip", async () => {
    const log = createLog();
    await call(slipRegistry(), log, SUPERVISOR, "payment.create", CREATE);
    const [record] = await log.records();
    expect(record).toMatchObject({ result: "ok" });
    expect(record).not.toHaveProperty("identity");
    expect(record).not.toHaveProperty("delegation");
  });
});

describe("C10: an answer DSoR cannot use is a fault, and is never used", () => {
  // A directory of org_456 that answers whatever the test says.
  function answering(answer: unknown): Directory {
    return { ask: async () => structuredClone(answer) };
  }
  const ABOUT_HER = { tenant: "org_456", person: "user_123", listed: true, status: "active" };

  it.each([
    [
      "about cfo_100, when asked about user_123",
      { ...ABOUT_HER, person: "cfo_100", roles: ["CFO"] },
    ],
    [
      "for org_789, when asked for org_456",
      { ...ABOUT_HER, tenant: "org_789", roles: ["ap_supervisor"] },
    ],
    ["with the status on_leave", { ...ABOUT_HER, status: "on_leave", roles: ["ap_supervisor"] }],
    ["with no roles", ABOUT_HER],
    ["with a role that is not text", { ...ABOUT_HER, roles: [7] }],
    ["with listed as text", { ...ABOUT_HER, listed: "yes", roles: ["ap_supervisor"] }],
    ["that is text", "yes"],
    ["that is null", null],
  ])(
    "step 19's decision 11: an answer %s is refused at line ③ with INTERNAL_ERROR, recorded, with no draft",
    async (_case, answer) => {
      const directories = new Map<string, Directory>([
        ...storyDirectories(),
        ["org_456", answering(answer)],
      ]);
      const rows: Payment[] = [];
      const log = createLog();
      const lines: number[] = [];
      const result = await call(
        slipRegistry(undefined, undefined, rows, directories),
        log,
        AGENT,
        "payment.create",
        CREATE,
        (n) => lines.push(n),
      );
      expect(result).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
      expect(lines).toStrictEqual([1, 2, 3, 11]);
      expect(await log.records()).toMatchObject([{ result: "INTERNAL_ERROR" }]);
      expect(rows).toStrictEqual([]);
    },
  );

  it("step 19's decision 11: after an answer DSoR cannot use, the kept answer is forgotten too", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      let next: () => Promise<unknown> = async () => ({ ...ABOUT_HER, roles: ["ap_supervisor"] });
      const directories = new Map<string, Directory>([
        ...storyDirectories(),
        ["org_456", { ask: () => next() }],
      ]);
      const registry = slipRegistry(undefined, undefined, [], directories);
      at("01:30");
      await call(registry, createLog(), AGENT, "invoice.get", READ);
      // 01:40: a strange answer. It is a fault, and it is not used.
      at("01:40");
      next = async () => ({ ...ABOUT_HER, status: "on_leave", roles: ["ap_supervisor"] });
      expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
        code: "INTERNAL_ERROR",
      });
      // 01:50: no answer. The strange answer may have been news, so the answer of 01:30 does
      // not count any more: nothing kept is left.
      at("01:50");
      next = async () => {
        throw new Error("off");
      };
      expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
        code: "FRESHNESS_UNSATISFIABLE",
      });
      // 01:55: a clear answer again, and the agent works again.
      at("01:55");
      next = async () => ({ ...ABOUT_HER, roles: ["ap_supervisor"] });
      expect(await call(registry, createLog(), AGENT, "invoice.get", READ)).toMatchObject({
        data: MASKED_1008_OF_456,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("step 19's decision 17: DSoR reads an answer once, so roles that change between reads are read as they first were", async () => {
    let reads = 0;
    const tricky = {
      ...ABOUT_HER,
      get roles(): string[] {
        reads += 1;
        return reads === 1 ? ["ap_clerk"] : ["ap_supervisor"];
      },
    };
    const rows: Payment[] = [];
    const answer = await call(
      slipRegistry(
        undefined,
        undefined,
        rows,
        new Map<string, Directory>([
          ...storyDirectories(),
          ["org_456", { ask: async () => tricky }],
        ]),
      ),
      createLog(),
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(rows).toStrictEqual([]);
  });

  it("step 19's decision 17: an answer whose fields sit on its prototype is one DSoR cannot use", async () => {
    const hidden = Object.create({ ...ABOUT_HER, roles: ["ap_supervisor"] }) as unknown;
    const rows: Payment[] = [];
    const answer = await call(
      slipRegistry(
        undefined,
        undefined,
        rows,
        new Map<string, Directory>([
          ...storyDirectories(),
          ["org_456", { ask: async () => hidden }],
        ]),
      ),
      createLog(),
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-TEN-02a: a kept answer from another company is a fault, though it is kept under this company", async () => {
    const { settings } = checkRoleSettings(readRoleSettings(), logins.values());
    const off: Directory = {
      ask: async () => {
        throw new Error("off");
      },
    };
    const planted: Kept = { answer: { ...ABOUT_HER, roles: ["ap_supervisor"] }, at: Date.now() };
    const kept = new Map([[keptKey("org_789", "user_123"), planted]]);
    const source = createRoleSource(settings, new Map([["org_789", off]]), kept);
    const DEL_103 = { ...DEL_102, id: "del_103", delegator: "user_123" } as Slip;
    await expect(source.authorityOf("org_789", DEL_103, '"invoice.get"')).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "the directory of org_789 answered with something DSoR cannot use",
    });
  });
});

describe("C11: a person who calls for herself does not need the directory", () => {
  it("step 19's decision 2: with org_456's directory off, user_123's own draft is made, and cfo_100 reads INV-1008", async () => {
    const directories = storyDirectories();
    const org456 = directories.get("org_456")!;
    org456.turn("off");
    const rows: Payment[] = [];
    const registry = slipRegistry(undefined, undefined, rows, directories);
    expect(await call(registry, createLog(), SUPERVISOR, "payment.create", CREATE)).toMatchObject({
      data: { status: "draft" },
    });
    expect(await call(registry, createLog(), CFO, "invoice.get", READ)).toMatchObject({
      data: { id: "INV-1008", amount: { value: "31400.00", currency: "USD" } },
    });
    expect(rows).toHaveLength(1);
    expect(org456.asked()).toBe(0);
  });
});

describe("C12: line ③ asks the directory last", () => {
  it.each([
    [
      "arguments that name del_102",
      undefined,
      { ...CREATE, delegation: "del_102" },
      "AUTHORIZATION_DENIED",
      "the arguments name a slip the caller does not call under, in delegation",
    ],
    [
      "a torn-up slip",
      memorySlips(STORY_SLIPS.map((s) => (s.id === "del_100" ? { ...s, status: "revoked" } : s))),
      CREATE,
      "DELEGATION_REVOKED",
      '"payment.create": slip del_100 was torn up',
    ],
  ])(
    "step 19's decision 12: with the directory off and no kept answer, %s gets the refusal DSoR makes by itself",
    async (_case, slips, input, code, message) => {
      const directories = storyDirectories();
      const org456 = directories.get("org_456")!;
      org456.turn("off");
      const answer = await call(
        slipRegistry(slips, undefined, [], directories),
        createLog(),
        AGENT,
        "payment.create",
        input,
      );
      expect(answer).toMatchObject({ code, message });
      expect(org456.asked()).toBe(0);
    },
  );
});
