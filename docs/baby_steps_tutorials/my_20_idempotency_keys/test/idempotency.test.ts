// NEW IN STEP 20: the idempotency key.
//
// Networks fail and clients retry. The caller names each logical request with a key; DSoR claims the
// key with one INSERT and keeps the request's fingerprint and its answer beside it. The same key and
// the same request get the same answer, and nothing runs twice (decision 131).
//
// These tests use the program's own door, with the keys they mean. The other tests use the one in
// support/door.ts, which hands every call a fresh key as a careful client would.
//
// Rule DSOR-TEN-02a: caches, idempotency records, counters, holds, proposals, events, and audit
// partitions MUST be keyed by tenant.
// Rule DSOR-IDM-01a: every state-changing command in execute or propose_only mode MUST carry an
// idempotency key.
// Rule DSOR-IDM-01b: the key MUST be claimed by an atomic insert scoped to (tenant, calling
// principal, operation, key) that stores the payload hash.
// Rule DSOR-IDM-01c: a request whose key is already claimed with the same payload hash MUST return
// the recorded status or result without re-execution.
// Rule DSOR-IDM-01d: a request whose key is already claimed with a different payload hash MUST be
// refused with IDEMPOTENCY_CONFLICT.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClock, setClock, theLog } from "../src/audit.ts";
import type { ErrorEnvelope } from "../src/envelopes.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { paymentsOf } from "../src/payment.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const SUPERVISOR = { loggedInAs: "user_123" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";
const PAYMENT = Object.freeze({ invoice: INV_1009, amount: { value: "2500.00", currency: "USD" } });

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
  await forgetTheLog("org_456");
  // The claims of the tests before, which would otherwise answer this test's requests: the keys
  // here are meant, and some repeat between tests. As the owner; the application may delete none.
  await asTheOwner(() => db.exec("DELETE FROM dsor.idempotency_keys"));
});

afterEach(() => {
  resetClock();
});

function refusalOf(answer: OperationAnswer): ErrorEnvelope {
  if (answer.kind !== "error") {
    throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
  }

  return answer.envelope;
}

const pay = (
  key: unknown,
  args: object = PAYMENT,
  login: object = AGENT,
): Promise<OperationAnswer> =>
  callOperation(login as never, "payment.create", args as Record<string, unknown>, {
    idempotencyKey: key,
  });

/** The payments made for INV-1009, which the story starts with none of. */
const paymentsFor1009 = async (): Promise<number> =>
  (await paymentsOf("org_456")).filter((p) => p.invoice === INV_1009).length;

const decisions = async (): Promise<string[]> =>
  (await theLog("org_456"))
    .filter((r) => r.kind === "decision")
    .map((r) => `${r.authorization} ${r.result}`);

/** What a statement as the application did, with org_456 said: "allowed", or PostgreSQL's refusal. */
async function asTheApplication(sql: string): Promise<string> {
  try {
    await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await tx.query(sql);
    });

    return "allowed";
  } catch (error) {
    return (error as Error).message;
  }
}

const A_CLAIM = `INSERT INTO dsor.idempotency_keys (tenant, principal, operation, key, payload_hash)
                 VALUES ('org_456', 'accounts-payable-fte', 'payment.create', 'k1', 'sha256:x')`;

describe("the claims, in DSoR's own store", () => {
  it("DSOR-TEN-02a: the claims are keyed by company, under the second lock, forced, and a statement with no company sees none", async () => {
    const { rows } = await db.query<{ on: boolean; forced: boolean }>(
      "SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'dsor.idempotency_keys'::regclass",
    );

    expect(rows[0]).toStrictEqual({ on: true, forced: true });
    expect(await asTheApplication(A_CLAIM)).toBe("allowed");
    expect((await db.query("SELECT key FROM dsor.idempotency_keys")).rows).toStrictEqual([]);
  });

  it("DSOR-IDM-01b: one company, one caller, one operation, one key: a second claim of it is refused by the database", async () => {
    const second = A_CLAIM.replace("'k1'", "'k2'");

    expect(await asTheApplication(second)).toBe("allowed");
    expect(await asTheApplication(second)).toMatch(/duplicate key value/);
  });

  it("DSOR-IDM-01b: the application claims a key and writes its answer, and nothing else", async () => {
    const mine = A_CLAIM.replace("'k1'", "'k3'");

    expect(await asTheApplication(mine)).toBe("allowed");
    expect(
      await asTheApplication(
        `UPDATE dsor.idempotency_keys SET answer = '{"kind": "result"}' WHERE key = 'k3'`,
      ),
    ).toBe("allowed");

    for (const sql of [
      "DELETE FROM dsor.idempotency_keys WHERE key = 'k3'",
      "UPDATE dsor.idempotency_keys SET payload_hash = 'sha256:y' WHERE key = 'k3'",
      "UPDATE dsor.idempotency_keys SET key = 'k4' WHERE key = 'k3'",
      `INSERT INTO dsor.idempotency_keys (tenant, principal, operation, key, payload_hash, answer)
       VALUES ('org_456', 'accounts-payable-fte', 'payment.create', 'k5', 'sha256:x', '{}')`,
    ]) {
      expect(await asTheApplication(sql), sql).toMatch(/permission denied/);
    }
  });
});

describe("a command carries a key", () => {
  it("DSOR-IDM-01a: a command without an idempotency key is refused, and nothing is made", async () => {
    const refusal = refusalOf(await callOperation(AGENT, "payment.create", PAYMENT));

    expect(refusal.code).toBe("VALIDATION_FAILED");
    expect(refusal.message).toMatch(/idempotency key/);
    expect(await paymentsFor1009()).toBe(0);
  });

  it("DSOR-IDM-01a: a key that is not 1 to 128 letters, digits, dots, underscores, colons or dashes is refused", async () => {
    for (const key of ["", " ", "a".repeat(129), "pay me", "pay\n", 42, null, { key: "k" }]) {
      expect(refusalOf(await pay(key)).code, JSON.stringify(key)).toBe("VALIDATION_FAILED");
    }

    expect(await paymentsFor1009()).toBe(0);
  });

  it("a query changes nothing and needs no key", async () => {
    expect((await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 })).kind).toBe(
      "data",
    );
  });
});

describe("the same key and the same request", () => {
  it("DSOR-IDM-01c: sent twice, one payment, and the second answer is the first, word for word", async () => {
    const first = await pay("pay-1009-once");
    const second = await pay("pay-1009-once");

    expect(first.kind).toBe("result");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(await paymentsFor1009()).toBe(1);
  });

  it("DSOR-IDM-01c: nothing runs again, and no second decision is recorded", async () => {
    await pay("pay-1009-once");
    await pay("pay-1009-once");

    expect(await decisions()).toStrictEqual(["ALLOW ALLOWED"]);
  });

  it("DSOR-IDM-01c: a recorded refusal is given again like any other answer", async () => {
    const over = { ...PAYMENT, amount: { value: "60000.00", currency: "USD" } };
    const first = await pay("too-much", over);

    expect(refusalOf(first).code).toBe("LIMIT_EXCEEDED");

    // The limit is raised in between. The same request with the same key still gets what it got:
    // after a person changes the limit, the caller asks again with a new key (§22).
    await asTheOwner(() =>
      db.exec(
        "UPDATE dsor.delegations SET per_transaction_limit_value = 100000 WHERE id = 'del_100'",
      ),
    );

    expect(JSON.stringify(await pay("too-much", over))).toBe(JSON.stringify(first));
    expect((await pay("too-much-again", over)).kind).toBe("result");
  });

  it("a different key is a different request: two keys, two payments", async () => {
    await pay("first");
    await pay("second");

    expect(await paymentsFor1009()).toBe(2);
  });
});

describe("the same key and a different request", () => {
  it("DSOR-IDM-01d: another amount under the same key is refused, and the refusal is recorded", async () => {
    await pay("pay-1009");

    const refusal = refusalOf(
      await pay("pay-1009", { ...PAYMENT, amount: { value: "2600.00", currency: "USD" } }),
    );

    expect(refusal.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(refusal.retry).toBe("never");
    expect(await paymentsFor1009()).toBe(1);
    expect(await decisions()).toStrictEqual(["ALLOW ALLOWED", "DENY IDEMPOTENCY_CONFLICT"]);
  });
});

describe("whose key it is", () => {
  it("DSOR-IDM-01b: the claim keeps the company, the caller who logged in, the operation, the key and the fingerprint", async () => {
    const answer = await pay("pay-1009");

    if (answer.kind !== "result") {
      throw new Error(`expected a receipt, got ${JSON.stringify(answer)}`);
    }

    const { rows } = await asTheOwner(() =>
      db.query(
        `SELECT tenant, principal, operation, key, payload_hash, answer IS NOT NULL AS answered
           FROM dsor.idempotency_keys WHERE key = 'pay-1009'`,
      ),
    );

    expect(rows).toStrictEqual([
      {
        tenant: "org_456",
        principal: "accounts-payable-fte",
        operation: "payment.create",
        key: "pay-1009",
        payload_hash: answer.envelope.payload_hash,
        answered: true,
      },
    ]);
  });

  it("DSOR-IDM-01b: the same key from another caller, or for another operation, is another claim", async () => {
    await pay("same-words");
    await pay("same-words", PAYMENT, SUPERVISOR);

    expect(await paymentsFor1009()).toBe(2);
    expect(
      (
        await callOperation(
          AGENT,
          "invoice.issue",
          { invoice: INV_1009 },
          { idempotencyKey: "same-words" },
        )
      ).kind,
    ).toBe("result");
  });
});

describe("fifty at once", () => {
  it("DSOR-IDM-01b: fifty requests with one key, sent together, make one payment, and all fifty get its receipt", async () => {
    // The step's "done when". In this tier one database connection takes the fifty in turn, and the
    // database tier races them for real.
    const answers = await Promise.all(Array.from({ length: 50 }, () => pay("fifty-at-once")));

    expect(await paymentsFor1009()).toBe(1);
    expect(answers.every((a) => a.kind === "result")).toBe(true);
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });
});

describe("a claim on a request that never ran", () => {
  it("DSOR-IDM-01c: refused EVIDENCE_STORE_UNAVAILABLE after its claim, the same request with the same key runs once it can", async () => {
    // A clock that is not a time: the decision cannot be written, so nothing runs, and the answer
    // says the same request may be sent again. The claim is released, or that would be a lie.
    setClock(() => "not a time");

    const first = refusalOf(await pay("store-was-down"));

    expect(first.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(first.retry).toBe("safe_same_key");

    resetClock();

    expect((await pay("store-was-down")).kind).toBe("result");
    expect(await paymentsFor1009()).toBe(1);
  });
});
