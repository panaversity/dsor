// NEW IN STEP 45e: a company's answer may say what kind of account it is about, and whose ids it
// uses: `type` and `issuer` (step 45e's README, C1 and C6; D18, D20, D29, D30). An issuer that is not
// sign-in.json's is a fault, as an answer about someone else is. The servers send both fields
// now, so an answer without either is a fault too (D30, the contract move). The agent drafts under
// del_100, so line ③ asks about user_123, the slip's signer.
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { memoryAnswers } from "../src/answers.ts";
import { createRoleSource, type RoleSettings } from "../src/authority.ts";
import type { Directory } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import { checkSignIn, readSignIn } from "../src/sign-in.ts";
import type { Slip } from "../src/slips.ts";
import {
  AGENT,
  DEL_100,
  keyed,
  NOT_A_MEMBER,
  slipRegistry,
  storyDirectories,
  SUPERVISOR,
} from "./helpers.ts";
import { NIGHT } from "./role-source-list.ts";

const CREATE = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
const CANNOT_USE = "the directory of org_456 answered with something DSoR cannot use";
// The server whose ids DSoR's tokens use, from sign-in.json (D20).
const SSO = checkSignIn(readSignIn()).signIn!.issuer;
// org_456's HR server, which gives ids of its own (step 45e's README, "Why it matters", run 3).
const HR = "https://hr.org456.example";

/** An answer about user_123, active as ap_supervisor, read at this time, with these changes. */
function aboutHer(fields: Record<string, unknown> = {}, at = Date.now()): Record<string, unknown> {
  return {
    tenant: "org_456",
    person: "user_123",
    status: "active",
    roles: ["ap_supervisor"],
    as_of: new Date(at).toISOString(),
    ...fields,
  };
}

/** org_456's directory, which gives this answer to every question. */
function answering(answer: unknown): Directory {
  return { ask: async () => structuredClone(answer) };
}

/** A DSoR whose org_456 answers so, or asks this directory, with these kept answers, and its drafts. */
function dsor(
  answer: unknown,
  kept = memoryAnswers(),
  directory: Directory = answering(answer),
): { registry: Registry; rows: Payment[] } {
  const rows: Payment[] = [];
  const directories = new Map<string, Directory>([...storyDirectories(), ["org_456", directory]]);
  return { registry: slipRegistry(undefined, undefined, rows, directories, kept), rows };
}

/** The agent drafts a payment of INV-1008 under del_100. */
function draft(registry: Registry): Promise<unknown> {
  return call(registry, createLog(), keyed(AGENT), "payment.create", CREATE);
}

describe("C1 and C6: the answer carries type and issuer, and needs both", () => {
  it("D30: an answer without a type is a fault, now that the servers send one (the contract move)", async () => {
    const { registry, rows } = dsor(aboutHer({ issuer: SSO }));
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(rows).toStrictEqual([]);
  });

  it("D30: an answer without an issuer is a fault too", async () => {
    const { registry, rows } = dsor(aboutHer({ type: "human" }));
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(rows).toStrictEqual([]);
  });

  it("D18, D20: an answer that says human, in sign-in.json's ids, counts", async () => {
    const { registry, rows } = dsor(aboutHer({ type: "human", issuer: SSO }));
    expect(await draft(registry)).toMatchObject({ data: { status: "draft" } });
    expect(rows).toHaveLength(1);
  });

  it("D18: each of §12's four types is a type DSoR can read", async () => {
    for (const type of ["human", "agent", "application", "system"]) {
      const { registry } = dsor(aboutHer({ type, issuer: SSO }));
      // Line ③ reads every one of them. A type other than human is refused for what it is, not
      //   as an answer DSoR cannot use (step 45e's README, C5).
      expect(await draft(registry)).not.toMatchObject({ message: CANNOT_USE });
    }
  });

  it("D18: an answer with a type that is not one of §12's four is a fault", async () => {
    const { registry, rows } = dsor(aboutHer({ type: "robot", issuer: SSO }));
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(rows).toStrictEqual([]);
  });
});

describe("C1: an answer in another server's ids is a fault (D29)", () => {
  it("D29: an answer with org_456's HR server as its issuer is a fault, and DSoR's kept answer about her is erased", async () => {
    const minuteAgo = Date.now() - 60_000;
    const kept = memoryAnswers([
      [
        "org_456",
        "user_123",
        {
          answer: aboutHer({ type: "human", issuer: SSO }, minuteAgo),
          at: minuteAgo,
          asked: minuteAgo,
        },
      ],
    ]);
    const { registry, rows } = dsor(aboutHer({ type: "human", issuer: HR }), kept);
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(rows).toStrictEqual([]);
    expect(await kept.get("org_456", "user_123")).toBeUndefined();
  });

  it("D29: a kept answer in another server's ids is never used, even within the 10 seconds, and goes", async () => {
    const fiveAgo = Date.now() - 5_000;
    const stale = aboutHer({ type: "human", issuer: HR }, fiveAgo);
    const kept = memoryAnswers([
      ["org_456", "user_123", { answer: stale, at: fiveAgo, asked: fiveAgo }],
    ]);
    // The directory would answer well: DSoR does not ask it, since its kept answer is 5 seconds old.
    const { registry, rows } = dsor(aboutHer({ type: "human", issuer: SSO }), kept);
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(rows).toStrictEqual([]);
    expect(await kept.get("org_456", "user_123")).toBeUndefined();
  });

  // Found by step 45e's review, mutation M20: no test compared the issuer in another case.
  it("D20: an issuer that differs from sign-in.json's only in its case is another issuer", async () => {
    const { registry, rows } = dsor(aboutHer({ type: "human", issuer: SSO.toUpperCase() }));
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(rows).toStrictEqual([]);
  });

  // Found by step 45e's review, mutation M16: a reply in another server's ids is one no call can
  //   use, so it is remembered for 10 seconds, as every such reply is (step 45c's README, D21).
  it("D29: a reply in another server's ids is remembered for 10 seconds: a second draft right after asks the server nothing", async () => {
    let asked = 0;
    const hr: Directory = {
      ask: async () => {
        asked += 1;
        return aboutHer({ type: "human", issuer: HR });
      },
    };
    const { registry } = dsor(undefined, undefined, hr);
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(asked).toBe(1);
  });

  // Found by step 45e's review, mutation M17: an answer DSoR keeps in another server's ids is no
  //   answer about her, so her own call is a stranger's, and hears the stranger's words.
  it("D29: user_123, whose kept answer of 5 seconds ago is in another server's ids, reads INV-1008 for herself: the stranger's words, not INTERNAL_ERROR", async () => {
    const fiveAgo = Date.now() - 5_000;
    const stale = aboutHer({ type: "human", issuer: HR }, fiveAgo);
    const kept = memoryAnswers([
      ["org_456", "user_123", { answer: stale, at: fiveAgo, asked: fiveAgo }],
    ]);
    const { registry } = dsor(aboutHer({ type: "human", issuer: HR }), kept);
    const read = { invoice: "dsor://org_456/invoice/INV-1008" };
    expect(await call(registry, createLog(), SUPERVISOR, "invoice.get", read)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: NOT_A_MEMBER,
    });
  });

  // Found by step 45e's review, mutation M15: the newer answer DSoR keeps decides over a lagging
  //   reply (step 19's README, decision 14), but only in sign-in.json's ids.
  it("D29: DSoR keeps CFO for user_123 as of 02:00:05, in another server's ids; a lagging server answers ap_supervisor as of 01:59:50, in sign-in.json's: the lagging answer decides", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    vi.setSystemTime(new Date(`${NIGHT}T02:00:20Z`));
    const at = (time: string): number => Date.parse(`${NIGHT}T${time}Z`);
    const newer = aboutHer({ type: "human", issuer: HR, roles: ["CFO"] }, at("02:00:05"));
    const kept = memoryAnswers([
      ["org_456", "user_123", { answer: newer, at: at("02:00:05"), asked: at("02:00:05") }],
    ]);
    const lagging = aboutHer({ type: "human", issuer: SSO }, at("01:59:50"));
    const settings: RoleSettings = new Map([
      ["org_456", { kind: "idp_lookup", max_staleness: "PT1H", ms: 60 * 60 * 1000 }],
    ]);
    const source = createRoleSource(settings, new Map([["org_456", answering(lagging)]]), kept);
    expect(await source.authorityOf("org_456", DEL_100 as Slip, '"invoice.get"')).toMatchObject({
      roles: ["ap_supervisor"],
      as_of: `${NIGHT}T01:59:50.000Z`,
    });
  });

  it("D20: an issuer that differs from sign-in.json's only by a slash at the end is another issuer", async () => {
    const { registry, rows } = dsor(aboutHer({ type: "human", issuer: `${SSO}/` }));
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(rows).toStrictEqual([]);
  });
});
