// NEW IN STEP 45e: a company's answer may say what kind of account it is about, and whose ids it
// uses: `type` and `issuer` (step 45e's README, C1 and C6; D18, D20, D29, D30). An issuer that is not
// sign-in.json's is a fault, as an answer about someone else is. Until the servers send both
// fields, an answer without them is read as before (D30, the expand move). The agent drafts under
// del_100, so line ③ asks about user_123, the slip's signer.
import { describe, expect, it } from "vitest";
import { memoryAnswers } from "../src/answers.ts";
import type { Directory } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import { checkSignIn, readSignIn } from "../src/sign-in.ts";
import { AGENT, keyed, slipRegistry, storyDirectories } from "./helpers.ts";

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

/** A DSoR whose org_456 answers so, with these kept answers, and the payments it drafts. */
function dsor(answer: unknown, kept = memoryAnswers()): { registry: Registry; rows: Payment[] } {
  const rows: Payment[] = [];
  const directories = new Map<string, Directory>([
    ...storyDirectories(),
    ["org_456", answering(answer)],
  ]);
  return { registry: slipRegistry(undefined, undefined, rows, directories, kept), rows };
}

/** The agent drafts a payment of INV-1008 under del_100. */
function draft(registry: Registry): Promise<unknown> {
  return call(registry, createLog(), keyed(AGENT), "payment.create", CREATE);
}

describe("C1 and C6: the answer learns type and issuer, and does not need them yet", () => {
  it("D30: an answer without type and issuer still counts, as before this step (the expand move)", async () => {
    const { registry, rows } = dsor(aboutHer());
    expect(await draft(registry)).toMatchObject({ data: { status: "draft" } });
    expect(rows).toHaveLength(1);
  });

  it("D18, D20: an answer that says human, in sign-in.json's ids, counts", async () => {
    const { registry, rows } = dsor(aboutHer({ type: "human", issuer: SSO }));
    expect(await draft(registry)).toMatchObject({ data: { status: "draft" } });
    expect(rows).toHaveLength(1);
  });

  it("D18: each of §12's four types is a type DSoR can read", async () => {
    for (const type of ["human", "agent", "application", "system"]) {
      const { registry } = dsor(aboutHer({ type, issuer: SSO }));
      // Line ③ reads every one of them. What a type other than human may do is piece 4's.
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
      ["org_456", "user_123", { answer: aboutHer({}, minuteAgo), at: minuteAgo, asked: minuteAgo }],
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

  it("D20: an issuer that differs from sign-in.json's only by a slash at the end is another issuer", async () => {
    const { registry, rows } = dsor(aboutHer({ type: "human", issuer: `${SSO}/` }));
    expect(await draft(registry)).toMatchObject({ code: "INTERNAL_ERROR", message: CANNOT_USE });
    expect(rows).toStrictEqual([]);
  });
});
