// NEW IN STEP 45e: only a person acts as a person (step 45e's README, C2 to C5; D27 and D28). Every
// token's login names a person, so DSoR takes the kind of account from her company's answer.
// svc_ap_bot is a script account: a program that signs in at org_456's sign-in server with a
// password, as a person does. org_456 lists it as its CFO. A non-person is a non-member: when
// org_456 says svc_ap_bot is an application, it reads nothing for itself, approves nothing, and a
// payment it prepared is thrown away at its release. And no agent works under a slip it signed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAnswers } from "../src/answers.ts";
import { createRoleSource, type RoleSettings } from "../src/authority.ts";
import type { Directory, FakeDirectory } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Principal } from "../src/principals.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { memorySlips, type MemorySlips, type Slip } from "../src/slips.ts";
import {
  A_PERSON,
  AGENT,
  CFO,
  contract,
  DEL_100,
  DEL_101,
  DEL_102,
  FIRM_IN_456,
  INTAKE_SLIP,
  keyed,
  NOT_A_MEMBER,
  OUR_EXTENSIONS,
  shippedWith,
  slipRegistry,
  storyDirectories,
  SUPERVISOR,
  withPlanted,
} from "./helpers.ts";
import { NIGHT } from "./role-source-list.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };
const DRAFT = { ...INVOICE, expected_version: 1 };
// svc_ap_bot's key at the stand-in sign-in server. It names svc_ap_bot and nothing more, and DSoR
// calls it a person, as it calls the subject of every token (step 45's README, D7).
const SVC_KEY = "tok_svc_ap_bot";
const SVC: RequestEnvelope = { token: SVC_KEY, tenant: "org_456" };
const SVC_LOGIN: Principal = { id: "svc_ap_bot", type: "human", memberships: [] };

/** svc_ap_bot makes this call, with its key. */
function asSvc<T>(run: () => Promise<T>): Promise<T> {
  return withPlanted(SVC_KEY, SVC_LOGIN, run);
}

/** A world where org_456 lists svc_ap_bot as its CFO, and says it is this kind of account. */
async function worldWhere(type: string): Promise<RuleWorld> {
  const w = await ruleWorldOnTuesday();
  w.directories.get("org_456")!.set("svc_ap_bot", { status: "active", roles: ["CFO"], type });
  return w;
}

/** The agent drafts PAY-901, the payment of INV-1008, which waits for the CFO's approval. */
async function waiting(w: RuleWorld): Promise<{ id: string; uri: string; payload_hash: string }> {
  const answer = await w.draft("INV-1008");
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const id = String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
  const kept = (await w.proposals.get("org_456", id))!;
  return { id, uri: kept.uri, payload_hash: kept.payload_hash };
}

/** The state of the proposal now. */
async function stateOf(w: RuleWorld, id: string): Promise<string | undefined> {
  return (await w.proposals.get("org_456", id))?.state;
}

/** The world's registry with a role source that calls svc_ap_bot a member, and an application. */
function lax(w: RuleWorld): Registry {
  const memberOf = async () => ({
    roles: ["CFO"],
    source: "role_source" as const,
    as_of: new Date().toISOString(),
    type: "application" as const,
  });
  return { ...w.registry, roleSource: { ...w.registry.roleSource, memberOf } };
}

/** Sets DSoR's clock to this time of the story's night, in UTC. */
function at(time: string): void {
  vi.setSystemTime(new Date(`${NIGHT}T${time}Z`));
}

describe("C2: a person's own call counts only when her company says she is human (D27)", () => {
  it("D27: svc_ap_bot, which org_456 says is an application, reads INV-1008 for itself: it hears the stranger's words, and only the record names application", async () => {
    const w = await worldWhere("application");
    const answer = await asSvc(() => w.ask(SVC, "invoice.get", INVOICE));
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED", message: NOT_A_MEMBER });
    expect(JSON.stringify(answer)).not.toContain("application");
    expect(await w.log.records()).toMatchObject([
      {
        result: "AUTHORIZATION_DENIED",
        correlation: { principal_id: "svc_ap_bot" },
        extensions: {
          [OUR_EXTENSIONS]: {
            requested_tenant: "org_456",
            not_a_person: { person: "svc_ap_bot", type: "application" },
          },
        },
      },
    ]);
  });

  it("D27: an account that org_456 says is an agent, or a system job, hears the same words, and its record names its type", async () => {
    for (const type of ["agent", "system"]) {
      const w = await worldWhere(type);
      const answer = await asSvc(() => w.ask(SVC, "invoice.get", INVOICE));
      expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED", message: NOT_A_MEMBER });
      const [record] = await w.log.records();
      expect(record?.extensions?.[OUR_EXTENSIONS]).toMatchObject({
        not_a_person: { person: "svc_ap_bot", type },
      });
    }
  });

  it("D27: the same account, when org_456 says it is human, reads INV-1008, and its record names no type", async () => {
    const w = await worldWhere("human");
    expect(await asSvc(() => w.ask(SVC, "invoice.get", INVOICE))).toMatchObject({
      data: { id: "INV-1008" },
    });
    const [record] = await w.log.records();
    expect(record?.extensions?.[OUR_EXTENSIONS] ?? {}).not.toHaveProperty("not_a_person");
  });

  // As step 45's review, finding 3, decided for a stranger: DSoR knows a non-person as no member,
  //   so an outage tells it nothing a stranger does not hear.
  it("DSOR-ERR-01b: svc_ap_bot, which DSoR last heard two hours ago is an application, calls while org_456's server is off: the stranger's words. A person in its place hears that DSoR has no recent answer", async () => {
    const twoHoursAgo = Date.now() - 2 * 3_600_000;
    const heard = [
      ["application", { code: "AUTHORIZATION_DENIED", message: NOT_A_MEMBER }],
      ["human", { code: "FRESHNESS_UNSATISFIABLE" }],
    ] as const;
    for (const [type, words] of heard) {
      const answer = {
        tenant: "org_456",
        person: "svc_ap_bot",
        status: "active",
        roles: ["CFO"],
        as_of: new Date(twoHoursAgo).toISOString(),
        type,
        issuer: A_PERSON.issuer,
      };
      const kept = memoryAnswers([
        ["org_456", "svc_ap_bot", { answer, at: twoHoursAgo, asked: twoHoursAgo }],
      ]);
      const directories = storyDirectories();
      directories.get("org_456")!.turn("off");
      const registry = slipRegistry(undefined, undefined, [], directories, kept);
      expect(
        await asSvc(() => call(registry, createLog(), SVC, "invoice.get", INVOICE)),
      ).toMatchObject(words);
    }
  });
});

describe("C2 and D32: a non-person's own calls use its answer for 10 minutes, as a stranger's do", () => {
  const READ = { invoice: "dsor://org_456/invoice/INV-1008" };
  const BOTS = ["bot_1", "bot_2", "bot_3", "bot_4"];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("02:00:00");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** This account reads INV-1008 for itself, with a key that names it as every login names a person. */
  function readsAs(registry: Registry, id: string): Promise<unknown> {
    const login: Principal = { id, type: "human", memberships: [] };
    const envelope = { token: `tok_${id}`, tenant: "org_456" };
    return withPlanted(`tok_${id}`, login, () =>
      call(registry, createLog(), envelope, "invoice.get", READ),
    );
  }

  // Found by step 45e's review, finding 2: at 10 seconds, four scripts used up the budget in 50
  //   seconds, and a new person heard the stranger's words.
  it("D32: four accounts that org_456 says are applications read every 10 seconds for 50 seconds: org_456 is asked about each once, and user_124, a new person, reads INV-1008", async () => {
    const directories = storyDirectories();
    const org456 = directories.get("org_456")!;
    for (const bot of BOTS) {
      org456.set(bot, { status: "active", roles: ["ap_clerk"], type: "application" });
    }
    org456.set("user_124", { status: "active", roles: ["ap_clerk"], type: "human" });
    const registry = slipRegistry(undefined, undefined, [], directories);
    const before = org456.asked();
    for (const second of ["00", "10", "20", "30", "40", "50"]) {
      at(`02:00:${second}`);
      for (const bot of BOTS) {
        expect(await readsAs(registry, bot)).toMatchObject({ message: NOT_A_MEMBER });
      }
    }
    expect(org456.asked() - before).toBe(4);
    at("02:00:51");
    expect(await readsAs(registry, "user_124")).toMatchObject({ data: { id: "INV-1008" } });
  });

  it("D32: org_456 fixes svc_ap_bot's mark to human at 02:00:30. Its own reads hear the stranger's words until 02:10:00, 10 minutes after DSoR asked, and then it reads", async () => {
    const directories = storyDirectories();
    const org456 = directories.get("org_456")!;
    org456.set("svc_ap_bot", { status: "active", roles: ["CFO"], type: "application" });
    const registry = slipRegistry(undefined, undefined, [], directories);
    expect(await readsAs(registry, "svc_ap_bot")).toMatchObject({ message: NOT_A_MEMBER });
    at("02:00:30");
    org456.set("svc_ap_bot", { status: "active", roles: ["CFO"], type: "human" });
    at("02:09:59");
    expect(await readsAs(registry, "svc_ap_bot")).toMatchObject({ message: NOT_A_MEMBER });
    at("02:10:00");
    expect(await readsAs(registry, "svc_ap_bot")).toMatchObject({ data: { id: "INV-1008" } });
  });
});

describe("C3: an approval counts only from an account its company says is human (DSOR-SOD-01a, DSOR-SOD-01b)", () => {
  it("DSOR-SOD-01b: svc_ap_bot, which org_456 lists as its CFO and says is an application, approves PAY-901: it is refused, and PAY-901 still waits", async () => {
    const w = await worldWhere("application");
    const { id, uri, payload_hash } = await waiting(w);
    const answer = await asSvc(() =>
      w.ask(keyed(SVC), "proposal.approve", { proposal: uri, payload_hash }),
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED", message: NOT_A_MEMBER });
    expect(await stateOf(w, id)).toBe("PENDING_APPROVAL");
  });

  it("DSOR-SOD-01a: an account that org_456 lists as its CFO and says is an agent approves PAY-901: it is refused, and PAY-901 still waits", async () => {
    const w = await worldWhere("agent");
    const { id, uri, payload_hash } = await waiting(w);
    const answer = await asSvc(() =>
      w.ask(keyed(SVC), "proposal.approve", { proposal: uri, payload_hash }),
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED", message: NOT_A_MEMBER });
    expect(await stateOf(w, id)).toBe("PENDING_APPROVAL");
  });

  it("DSOR-SOD-01b: cfo_100, whom org_456 says is human, approves PAY-901: APPROVED", async () => {
    const w = await ruleWorldOnTuesday();
    w.directories
      .get("org_456")!
      .set("cfo_100", { status: "active", roles: ["CFO"], type: "human" });
    const { id, uri, payload_hash } = await waiting(w);
    expect(
      await w.ask(keyed(CFO), "proposal.approve", { proposal: uri, payload_hash }),
    ).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
    expect(await stateOf(w, id)).toBe("APPROVED");
  });

  // Line ② writes the company's type on the caller, so the checks after it never rest on the
  //   login's guess. A role source that lets an application through shows it.
  it("DSOR-SOD-01b: the approval reads the type that line ② found, never the login's: with a role source that calls svc_ap_bot a member and an application, PAY-901 still waits", async () => {
    const w = await worldWhere("application");
    const { id, uri, payload_hash } = await waiting(w);
    const answer = await asSvc(() =>
      call(lax(w), w.log, keyed(SVC), "proposal.approve", { proposal: uri, payload_hash }),
    );
    // Line ⑤ refuses it, by the contract's people_only (step 25's README, decision D4).
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"proposal.approve" is for people only, and svc_ap_bot is not a person',
    });
    expect(await stateOf(w, id)).toBe("PENDING_APPROVAL");
  });
});

// Found by step 45e's review, finding 5: line ⑤ refused the test above, so the approval's own guard
//   at line ⑨ was proven only with DSoR's own system logins. With people_only gone, it is reached.
describe("C3: the approval's own guard reads the type that line ② found", () => {
  it("DSOR-SOD-01b: with people_only gone from the contract too, and a role source that calls svc_ap_bot a member and an application, line ⑨ refuses it: not a person, and PAY-901 still waits", async () => {
    const { extensions: _gone, ...approve } = contract("proposal.approve");
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, shippedWith(approve));
    w.directories
      .get("org_456")!
      .set("svc_ap_bot", { status: "active", roles: ["CFO"], type: "application" });
    const { id, uri, payload_hash } = await waiting(w);
    const answer = await asSvc(() =>
      call(lax(w), w.log, keyed(SVC), "proposal.approve", { proposal: uri, payload_hash }),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"proposal.approve" is accepted only from a person, on their own login',
    });
    expect(await stateOf(w, id)).toBe("PENDING_APPROVAL");
  });
});

describe("C3 at a release: DSoR asks each approver's company again (D31; DSOR-APR-03a)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T15:05:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** While org_456 says svc_ap_bot is human, it approves PAY-901, which is APPROVED then. */
  async function approvedBySvc(w: RuleWorld): Promise<{ id: string; uri: string }> {
    const { id, uri, payload_hash } = await waiting(w);
    const answer = await asSvc(() =>
      w.ask(keyed(SVC), "proposal.approve", { proposal: uri, payload_hash }),
    );
    expect(answer).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
    // 11 seconds later, so the release asks again, and does not use the answer of 10 seconds ago
    //   (step 45's README, D3).
    vi.setSystemTime(new Date("2026-10-06T15:05:11Z"));
    return { id, uri };
  }

  it("D31: svc_ap_bot approves PAY-901 while org_456 says human. Once org_456 says application, the agent's release throws PAY-901 away, and the record names svc_ap_bot's type", async () => {
    const w = await worldWhere("human");
    const { id, uri } = await approvedBySvc(w);
    w.directories
      .get("org_456")!
      .set("svc_ap_bot", { status: "active", roles: ["CFO"], type: "application" });
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: `proposal ${id} is INVALIDATED: SOD_VIOLATION`,
    });
    expect(await stateOf(w, id)).toBe("INVALIDATED");
    expect(w.drafted).toStrictEqual([]);
    const record = (await w.log.records()).at(-1);
    expect(record?.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      not_a_person: { person: "svc_ap_bot", type: "application" },
    });
  });

  it("D31: the same release, while org_456 still says svc_ap_bot is human, pays", async () => {
    const w = await worldWhere("human");
    const { uri } = await approvedBySvc(w);
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    expect(w.drafted).toHaveLength(1);
  });

  it("D31: when org_456 cannot answer about the approver at the release, PAY-901 waits, still APPROVED", async () => {
    const w = await worldWhere("human");
    const { id, uri } = await approvedBySvc(w);
    // Another DSoR server, which keeps no answers yet, and whose question about svc_ap_bot fails.
    const base = w.directories.get("org_456")!;
    const failing: Directory = {
      ask: async (who: string) => {
        if (who === "svc_ap_bot") throw new Error("the lookup about svc_ap_bot fails");
        return base.ask(who);
      },
    };
    const settings: RoleSettings = new Map([
      ["org_456", { kind: "idp_lookup", max_staleness: "PT1H", ms: 3_600_000 }],
    ]);
    const other: Registry = {
      ...w.registry,
      roleSource: createRoleSource(settings, new Map([["org_456", failing]])),
    };
    expect(
      await call(other, w.log, keyed(AGENT), "proposal.execute", { proposal: uri }),
    ).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(await stateOf(w, id)).toBe("APPROVED");
    expect(w.drafted).toStrictEqual([]);
  });
});

describe("C4: a release asks again about the person who asked for herself (D27)", () => {
  let rows: Payment[];
  let registry: Registry;
  let org456: FakeDirectory;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("02:00:00");
    const directories = storyDirectories();
    org456 = directories.get("org_456")!;
    rows = [];
    registry = slipRegistry(undefined, undefined, rows, directories);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** At 02:00, while org_456 says it is human, svc_ap_bot prepares a payment of INV-1008. */
  async function prepared(): Promise<string> {
    org456.set("svc_ap_bot", { status: "active", roles: ["ap_supervisor"], type: "human" });
    const answer = await asSvc(() =>
      call(registry, createLog(), { ...keyed(SVC), mode: "propose_only" }, "payment.create", DRAFT),
    );
    expect(answer).toMatchObject({ outcome: "READY" });
    return "proposal" in answer ? String(answer.proposal) : "";
  }

  it("D27: svc_ap_bot prepares a payment of INV-1008 at 02:00. At 02:00:11 org_456 says it is an application, and user_123's release throws the payment away", async () => {
    const proposal = await prepared();
    at("02:00:11");
    org456.set("svc_ap_bot", { status: "active", roles: ["ap_supervisor"], type: "application" });
    const log = createLog();
    expect(
      await call(registry, log, keyed(SUPERVISOR), "proposal.execute", { proposal }),
    ).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    expect(rows).toStrictEqual([]);
    // Found by step 45e's review, finding 3: D27's record names the type at a release too, and
    //   whose it is, since the caller here is user_123.
    const [record] = await log.records();
    expect(record?.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      not_a_person: { person: "svc_ap_bot", type: "application" },
    });
  });

  it("D27: the same release, while org_456 still says svc_ap_bot is human, pays", async () => {
    const proposal = await prepared();
    at("02:00:11");
    expect(
      await call(registry, createLog(), keyed(SUPERVISOR), "proposal.execute", { proposal }),
    ).toMatchObject({ outcome: "COMMITTED" });
    expect(rows).toHaveLength(1);
  });
});

describe("C5: a slip counts only while its company says its signer is human (D28)", () => {
  // svc_ap_bot signed two slips in org_456: del_101, firm-ap-fte's, and del_190, intake-fte's.
  //   user_123 signed del_100, the story's slip for accounts-payable-fte.
  const SIGNED = [
    DEL_100,
    { ...DEL_101, delegator: "svc_ap_bot" },
    DEL_102,
    { ...INTAKE_SLIP, delegator: "svc_ap_bot" },
  ];
  // Step 19's words for a signer who left, with one word more: they are true for both.
  const NOT_AN_ACTIVE_PERSON = "whom the directory of org_456 does not list as an active person";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("02:00:00");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The story's registry with those slips, and org_456 saying svc_ap_bot is this kind of account. */
  function signedBySvc(type: string) {
    const slips = memorySlips(SIGNED);
    const directories = storyDirectories();
    const org456 = directories.get("org_456")!;
    org456.set("svc_ap_bot", { status: "active", roles: ["ap_supervisor"], type });
    const rows: Payment[] = [];
    return { slips, org456, rows, registry: slipRegistry(slips, undefined, rows, directories) };
  }

  /** The status of the slip this agent holds in org_456, as the store reads it. */
  async function statusOf(slips: MemorySlips, agent: string): Promise<unknown> {
    return ((await slips.find("org_456", agent))?.slip as Slip | undefined)?.status;
  }

  it("D28: firm-ap-fte reads INV-1008 under del_101, which svc_ap_bot signed and org_456 says is an application: DELEGATION_REQUIRED, and both slips svc_ap_bot signed in org_456 are suspended, each with a record that names application", async () => {
    const { slips, registry } = signedBySvc("application");
    expect(await call(registry, createLog(), FIRM_IN_456, "invoice.get", INVOICE)).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: `"invoice.get": slip del_101 is signed by svc_ap_bot, ${NOT_AN_ACTIVE_PERSON}`,
    });
    expect(await statusOf(slips, "firm-ap-fte")).toBe("suspended");
    expect(await statusOf(slips, "intake-fte")).toBe("suspended");
    expect(await statusOf(slips, "accounts-payable-fte")).toBe("active");
    expect(await slips.changes()).toMatchObject([
      { result: "suspended", reason: "application", tenant: "org_456", delegation: "del_101" },
      { result: "suspended", reason: "application", tenant: "org_456", delegation: "del_190" },
    ]);
  });

  it("D28: the same slip reads INV-1008 while org_456 says svc_ap_bot is human, and nothing is suspended", async () => {
    const { slips, registry } = signedBySvc("human");
    expect(await call(registry, createLog(), FIRM_IN_456, "invoice.get", INVOICE)).toMatchObject({
      data: { id: "INV-1008" },
    });
    expect(await slips.changes()).toStrictEqual([]);
  });

  // The check again at a release asks about the slip's signer too (step 31's README, D1).
  it("D28: firm-ap-fte prepares a payment of INV-1008 under del_101 at 02:00. At 02:00:11 org_456 says svc_ap_bot is an application, and user_123's release throws the payment away", async () => {
    const { org456, rows, registry } = signedBySvc("human");
    const log = createLog();
    const prepared = await call(
      registry,
      log,
      { ...keyed(FIRM_IN_456), mode: "propose_only" },
      "payment.create",
      DRAFT,
    );
    expect(prepared).toMatchObject({ outcome: "READY" });
    at("02:00:11");
    org456.set("svc_ap_bot", { status: "active", roles: ["ap_supervisor"], type: "application" });
    const proposal = "proposal" in prepared ? String(prepared.proposal) : "";
    expect(
      await call(registry, log, keyed(SUPERVISOR), "proposal.execute", { proposal }),
    ).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    expect(rows).toStrictEqual([]);
  });
});
