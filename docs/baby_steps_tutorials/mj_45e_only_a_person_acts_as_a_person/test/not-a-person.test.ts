// NEW IN STEP 45e: only a person acts as a person (step 45e's README, C2, C3, and C4; D27). Every
// token's login names a person, so DSoR takes the kind of account from her company's answer.
// svc_ap_bot is a script account: a program that signs in at org_456's sign-in server with a
// password, as a person does. org_456 lists it as its CFO. A non-person is a non-member: when
// org_456 says svc_ap_bot is an application, it reads nothing for itself, approves nothing, and a
// payment it prepared is thrown away at its release.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryAnswers } from "../src/answers.ts";
import type { FakeDirectory } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Principal } from "../src/principals.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  CFO,
  keyed,
  NOT_A_MEMBER,
  OUR_EXTENSIONS,
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
          [OUR_EXTENSIONS]: { requested_tenant: "org_456", not_a_person: "application" },
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
      expect(record?.extensions?.[OUR_EXTENSIONS]).toMatchObject({ not_a_person: type });
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
    const lax: Registry = {
      ...w.registry,
      roleSource: {
        ...w.registry.roleSource,
        memberOf: async () => ({
          roles: ["CFO"],
          source: "role_source",
          as_of: new Date().toISOString(),
          type: "application",
        }),
      },
    };
    const answer = await asSvc(() =>
      call(lax, w.log, keyed(SVC), "proposal.approve", { proposal: uri, payload_hash }),
    );
    // Line ⑤ refuses it, by the contract's people_only (step 25's README, decision D4).
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"proposal.approve" is for people only, and svc_ap_bot is not a person',
    });
    expect(await stateOf(w, id)).toBe("PENDING_APPROVAL");
  });
});

describe("C4: a release asks again about the person who asked for herself (D27)", () => {
  let rows: Payment[];
  let registry: Registry;
  let org456: FakeDirectory;

  /** Sets DSoR's clock to this time of the story's night, in UTC. */
  function at(time: string): void {
    vi.setSystemTime(new Date(`${NIGHT}T${time}Z`));
  }

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
    expect(
      await call(registry, createLog(), keyed(SUPERVISOR), "proposal.execute", { proposal }),
    ).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    expect(rows).toStrictEqual([]);
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
