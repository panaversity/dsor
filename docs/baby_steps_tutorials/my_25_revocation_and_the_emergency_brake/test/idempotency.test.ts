// STEP 20: the idempotency key.
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
import { type ErrorEnvelope, refusal } from "../src/envelopes.ts";
import {
  callOperation,
  type Handler,
  makeDoor,
  type OperationAnswer,
  PIPELINE,
} from "../src/operations.ts";
import { createPayment, paymentsOf } from "../src/payment.ts";
import { aDirectory, useDirectory } from "../src/directory.ts";
import { overPGlite } from "../src/database.ts";
import { contractsFromDisk, loadRegistry } from "../src/registry.ts";
import { useDatabase } from "../src/store.ts";
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
  useDirectory("org_456", undefined);
  useDirectory("org_789", undefined);
  // The real connection again, after a test that put a broken one in front of it.
  useDatabase(overPGlite(db));
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

describe("an answer once kept", () => {
  /** How many rows a statement as the application changed, with org_456 said. */
  async function changedAsTheApplication(sql: string): Promise<number> {
    return db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");

      return (await tx.query(sql)).affectedRows ?? 0;
    });
  }

  it("DSOR-IDM-01c: is never rewritten by the application, nor released; a released one may be taken back", async () => {
    // Decision 132: with the right to write an answer and nothing else, DSoR's own role wrote
    // {"released": true} over a kept receipt, and the same request then made a second payment.
    await asTheApplication(A_CLAIM.replace("'k1'", "'k6'"));

    expect(
      await changedAsTheApplication(
        `UPDATE dsor.idempotency_keys SET answer = '{"kind": "result"}' WHERE key = 'k6'`,
      ),
    ).toBe(1);

    for (const answer of [`'{"released": true}'`, "NULL", `'{"kind": "error"}'`]) {
      expect(
        await changedAsTheApplication(
          `UPDATE dsor.idempotency_keys SET answer = ${answer} WHERE key = 'k6'`,
        ),
        answer,
      ).toBe(0);
    }

    await asTheApplication(A_CLAIM.replace("'k1'", "'k7'"));

    expect(
      await changedAsTheApplication(
        `UPDATE dsor.idempotency_keys SET answer = '{"released": true}' WHERE key = 'k7'`,
      ),
    ).toBe(1);
    expect(
      await changedAsTheApplication(
        `UPDATE dsor.idempotency_keys SET answer = NULL WHERE key = 'k7'`,
      ),
    ).toBe(1);
  });

  it("DSOR-IDM-01c: a replayed answer that is not this caller's, or not an answer, is refused as the program's own error", async () => {
    // Decision 132: an answer written with `askedBy: "cfo_100"` was handed out by the replay.
    const first = await pay("forged");

    expect(first.kind).toBe("result");

    for (const forged of [{ ...first, askedBy: "cfo_100" }, { kind: "nonsense" }]) {
      await asTheOwner(() =>
        db.query("UPDATE dsor.idempotency_keys SET answer = $1 WHERE key = 'forged'", [
          JSON.stringify(forged),
        ]),
      );

      expect(refusalOf(await pay("forged")).code, JSON.stringify(forged)).toBe("INTERNAL_ERROR");
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

  it("DSOR-IDM-01a: a key is the request's own: one inherited, one in the arguments, or one that cannot be read is no key", async () => {
    // Decision 132: a key inherited through a prototype was taken as the key.
    const inherited = Object.create({ idempotencyKey: "from-a-prototype" }) as object;
    const throwing = {
      get idempotencyKey(): string {
        throw new Error("no");
      },
    };

    for (const [what, answer] of [
      ["inherited", await callOperation(AGENT, "payment.create", PAYMENT, inherited as never)],
      ["a getter that throws", await callOperation(AGENT, "payment.create", PAYMENT, throwing)],
      [
        "inside the arguments",
        await callOperation(AGENT, "payment.create", { ...PAYMENT, idempotencyKey: "in-the-args" }),
      ],
    ] as const) {
      expect(refusalOf(answer).code, what).toBe("VALIDATION_FAILED");
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
          { invoice: INV_1009, expected_version: 1 },
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

describe("a claim with no answer", () => {
  it("DSOR-IDM-01c: the same request waits for it, and is then told only what is known", async () => {
    // Decision 132: a claim whose first request never recorded an answer told every retry the first
    // request "has not finished", which nobody knew. The two-second wait running out is pinned too.
    const measured = await pay("to-learn-the-fingerprint");

    if (measured.kind !== "result") {
      throw new Error(`expected a receipt, got ${JSON.stringify(measured)}`);
    }

    await asTheOwner(() =>
      db.query(
        `INSERT INTO dsor.idempotency_keys (tenant, principal, operation, key, payload_hash)
         VALUES ('org_456', 'accounts-payable-fte', 'payment.create', 'no-answer', $1)`,
        [measured.envelope.payload_hash],
      ),
    );

    const started = Date.now();
    const refusal = refusalOf(await pay("no-answer"));

    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(refusal.code).toBe("OUTCOME_UNKNOWN");
    expect(refusal.message).toMatch(/no answer is recorded/);
    expect(refusal.message).not.toMatch(/has not finished/);
    expect(await paymentsFor1009()).toBe(1);
  });

  it("DSOR-IDM-01d: a different request under it is refused at once, and never waits", async () => {
    // Decision 151: a key is claimed while its first request runs, and the rule says a different
    // request under a claimed key is refused. claimKey compares the fingerprint before it waits for
    // a claim with no answer. In the other order, a 9,999.00 request waited two seconds and was told
    // OUTCOME_UNKNOWN, and every other test stayed green.
    const measured = await pay("to-learn-the-fingerprint");

    if (measured.kind !== "result") {
      throw new Error(`expected a receipt, got ${JSON.stringify(measured)}`);
    }

    await asTheOwner(() =>
      db.query(
        `INSERT INTO dsor.idempotency_keys (tenant, principal, operation, key, payload_hash)
         VALUES ('org_456', 'accounts-payable-fte', 'payment.create', 'no-answer', $1)`,
        [measured.envelope.payload_hash],
      ),
    );

    const other = { ...PAYMENT, amount: { value: "9999.00", currency: "USD" } };
    const started = Date.now();
    const refusal = refusalOf(await pay("no-answer", other));

    expect(refusal.code).toBe("IDEMPOTENCY_CONFLICT");
    // Well under the two-second wait: refused before any waiting.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await paymentsFor1009()).toBe(1);
  });
});

describe("a claim whose reply was lost", () => {
  it("DSOR-IDM-01c: the caller is told only what is known, and the key runs nothing", async () => {
    // Decision 151: decision 132 took "it is safe to send again" out of this message, because the
    // claim may have been made with its reply lost, and then the key holds a claim with no answer.
    // No test reached the message, so it could have gone back with every test green.
    const real = overPGlite(db);
    let lost = false;

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        const result = await real.query<T>(sql, params, tenant);

        // The claim is made, and its reply is lost on the way back.
        if (!lost && sql.includes("INSERT INTO dsor.idempotency_keys")) {
          lost = true;

          throw new Error("Connection terminated unexpectedly");
        }

        return result;
      },
    });

    const first = refusalOf(await pay("claim-reply-lost"));

    expect(first.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(first.message).toMatch(/could not be claimed, or the claim could not be confirmed/);
    expect(first.message).not.toMatch(/safe to send again/);

    // The key holds a claim with no answer: the same request waits, is told nobody knows, and does
    // not run. The README names this dead key; reconciliation, step 37, is what clears it.
    expect(refusalOf(await pay("claim-reply-lost")).code).toBe("OUTCOME_UNKNOWN");
    expect(await paymentsFor1009()).toBe(0);
  });
});

describe("a claim is released only when nothing ran", () => {
  it("DSOR-IDM-01c: a handler that ran and then answered 'safe to send again' is not run again under its key", async () => {
    // Decision 132: the door released a claim on any safe_same_key answer, one a handler gave after
    // it had run included. This handler makes the payment and then says the bank did not confirm
    // it, the common mistake §25.2 names; three attempts under one key made three payments.
    const careless: Handler = async (_args, _contract, askedBy, tenant, _hash, requestId) => {
      await createPayment(tenant, "INV-1009", { value: "2500.00", currency: "USD" });

      return {
        kind: "error",
        askedBy,
        envelope: refusal("TRANSACTION_FAILED", "the bank did not confirm it", requestId, askedBy),
      };
    };
    const door = makeDoor(PIPELINE, { "payment.create": careless });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await door(AGENT, "payment.create", PAYMENT, { idempotencyKey: "careless" });
    }

    expect(await paymentsFor1009()).toBe(1);
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

  it("DSOR-IDM-01d: after a release, a different request with the key is refused, not handed the claim", async () => {
    // Decision 132: the retake asks for the same fingerprint. Without it, a 9,999.00 request took the
    // released claim and ran, and the first request was then handed its receipt.
    setClock(() => "not a time");
    await pay("released");
    resetClock();

    const other = { ...PAYMENT, amount: { value: "9999.00", currency: "USD" } };

    expect(refusalOf(await pay("released", other)).code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await pay("released")).kind).toBe("result");
    expect(await paymentsFor1009()).toBe(1);
  });

  it("DSOR-IDM-01b: fifty retries after a release take the claim back once, and make one payment", async () => {
    // Decision 131's "of two retries only one does", which no test said.
    setClock(() => "not a time");
    await pay("fifty-retries");
    resetClock();

    const answers = await Promise.all(Array.from({ length: 50 }, () => pay("fifty-retries")));

    expect(await paymentsFor1009()).toBe(1);
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });
});

describe("an answer whose write fails", () => {
  /** What a released claim holds, as idempotency.ts writes it. */
  const RELEASED = '{"released": true}';
  /** settleKey's statement: it writes an answer on a claim, or releases the claim. */
  const writesTheAnswer = (sql: string): boolean => sql.includes("SET answer = $5");

  it("DSOR-IDM-01c: a release whose reply was lost is not written again over the claim the same request took back", async () => {
    // Decision 151. The door tried every failed write once more, a release too, and the second try
    // changes any claim that has no answer yet. Here the release is written and its reply is lost.
    // Before the door hears of it, the same request is sent again and takes the released claim
    // back, so the claim has no answer again, and it is the second request's now. A second try
    // released it while that request ran. Its receipt was then written nowhere, and a third request
    // with the key made a second payment (measured: two payments under one key).
    const real = overPGlite(db);
    const released = Promise.withResolvers<void>();
    const takenBack = Promise.withResolvers<void>();
    let lost = false;

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        const result = await real.query<T>(sql, params, tenant);

        if (sql.includes("SET answer = NULL") && result.rows.length === 1) {
          takenBack.resolve();
        }

        // The first release is written, and its reply is lost on the way back. The door hears of
        // it only after the second request has taken the claim back.
        if (!lost && writesTheAnswer(sql) && params?.[4] === RELEASED) {
          lost = true;
          released.resolve();
          await takenBack.promise;

          throw new Error("Connection terminated unexpectedly");
        }

        return result;
      },
    });

    // The first request: the decision cannot be written, so it is refused at §21.11, and nothing
    // ran, so its claim is released.
    setClock(() => "not a time");

    const first = pay("lost-release");

    // Until the release is written. A door that never releases ends the first request without
    // one, and this test fails here, at once, rather than by its timeout.
    await Promise.race([released.promise, first]);

    expect(lost, "the first request's claim was released").toBe(true);

    // The store is back, and the same request is sent again, with the same key.
    resetClock();

    const second = await pay("lost-release");

    // The lost reply reaches the first request's door, even if nothing took the claim back.
    takenBack.resolve();

    expect(refusalOf(await first).code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(second.kind).toBe("result");

    // A third time, later: the second request's receipt, word for word, and nothing runs.
    const third = await pay("lost-release");

    expect(await paymentsFor1009()).toBe(1);
    expect(JSON.stringify(third)).toBe(JSON.stringify(second));
  });

  it("DSOR-IDM-01c: a kept answer whose first write fails is written by the second try", async () => {
    // Decision 151: a kept answer is still tried once more, because a claim left with no answer is
    // a key no retry can use. The second try cannot meet another request's claim: only a released
    // claim is taken back, and a claim waiting for a kept answer was never released.
    const real = overPGlite(db);
    let failed = false;

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        // The first write of a kept answer never reaches the server.
        if (!failed && writesTheAnswer(sql) && params?.[4] !== RELEASED) {
          failed = true;

          throw Object.assign(new Error("Connection terminated unexpectedly"), {
            code: "ECONNRESET",
          });
        }

        return real.query<T>(sql, params, tenant);
      },
    });

    const first = await pay("written-by-the-second-try");

    expect(first.kind).toBe("result");
    expect(JSON.stringify(await pay("written-by-the-second-try"))).toBe(JSON.stringify(first));
    expect(await paymentsFor1009()).toBe(1);
  });
});

describe("a replay is a request like any other", () => {
  it("DSOR-IDM-01c: a replay after the slip expired, was revoked, or its signer lost the permission is refused like any request (§22)", async () => {
    // Decision 132: the key is claimed at §21.7, after §21.3 to §21.5, so a replay meets the
    // authority as it is now. A door that looked the key up first would pass every other test.
    const first = await pay("before-the-change");

    expect(first.kind).toBe("result");

    const changes: readonly (readonly [string, () => Promise<unknown>, string])[] = [
      [
        "expired",
        () =>
          asTheOwner(() =>
            db.exec(
              "UPDATE dsor.delegations SET expires_at = '2020-01-01T00:00:00Z' WHERE id = 'del_100'",
            ),
          ),
        "DELEGATION_EXPIRED",
      ],
      [
        "revoked",
        () =>
          asTheOwner(() =>
            db.exec("UPDATE dsor.delegations SET status = 'revoked' WHERE id = 'del_100'"),
          ),
        "DELEGATION_REQUIRED",
      ],
      [
        "the signer lost payment:create",
        async () =>
          useDirectory(
            "org_456",
            aDirectory("org_456", { holds: { user_123: ["invoice:read", "payment:cancel"] } }),
          ),
        "AUTHORIZATION_DENIED",
      ],
    ];

    for (const [what, change, code] of changes) {
      await resetTheStory();
      useDirectory("org_456", undefined);
      await change();

      expect(refusalOf(await pay("before-the-change")).code, what).toBe(code);
    }

    await resetTheStory();
    useDirectory("org_456", undefined);

    expect(JSON.stringify(await pay("before-the-change"))).toBe(JSON.stringify(first));
  });
});

describe("the same key in two companies", () => {
  it("DSOR-TEN-02a: is two claims, and two payments", async () => {
    // The agent works for both companies. In org_789 nobody in the story can sign, so the test
    // makes a signer there, as the cross-tenant suite does.
    await asTheOwner(() =>
      db.exec(`INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, modes, status, expires_at)
               VALUES ('org_789', 'del_789', 'user_789', 'accounts-payable-fte', ARRAY['payment:create'],
                       ARRAY['unattended'], 'active', '2099-12-31T23:59:59Z')`),
    );
    useDirectory("org_789", aDirectory("org_789", { holds: { user_789: ["payment:create"] } }));

    const before789 = (await paymentsOf("org_789")).length;

    expect((await pay("same-in-both")).kind).toBe("result");
    expect(
      (
        await pay(
          "same-in-both",
          { invoice: "dsor://org_789/invoice/INV-1009", amount: PAYMENT.amount },
          { loggedInAs: "accounts-payable-fte", tenant: "org_789" },
        )
      ).kind,
    ).toBe("result");
    expect(await paymentsFor1009()).toBe(1);
    expect((await paymentsOf("org_789")).length).toBe(before789 + 1);
  });
});

describe("the registry", () => {
  it("DSOR-IDM-01a: refuses a command whose contract says it needs no key", () => {
    const saysNo = contractsFromDisk().map((c) =>
      c.expectedId === "payment.create"
        ? { ...c, document: { ...(c.document as object), idempotency: { required: false } } }
        : c,
    );

    expect(() => loadRegistry(saysNo)).toThrow(
      /payment\.create is a command, and its contract says it needs no idempotency key/,
    );
  });
});
