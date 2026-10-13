// Idempotency keys on the database. The unit tests prove the claims in memory. These prove them
// in dsor.idempotency, with real transactions and real parallel requests: fifty requests with
// one key make one draft, a replay reads the recorded answer, each part of the scope holds, by
// row-level security and by DSoR's own statements alone, the claim and the work commit together
// or not at all, an answer is written once, and a claim lasts at least 24 hours (step 20's
// README, C2 to C12).
// Each test uses a key of its own, made fresh, so no run meets another run's claims.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { Refusal, type Answer } from "../src/envelope.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbClaims, createDbLog } from "../src/postgres.ts";
import type { Handler } from "../src/registry.ts";
import { AGENT, FIRM_IN_456, FIRM_IN_789, OUR_EXTENSIONS, SUPERVISOR, keyed } from "./helpers.ts";
import {
  NO_PRIVILEGE,
  RUNTIME_URL,
  dbRegistry,
  newPool,
  ownerClaims,
  requestId,
  tryThenRollBack,
} from "./db.ts";

// The program's own pool, and the test's window into the database, both dsor_runtime.
const pool = newPool();
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

// PostgreSQL's code for a row that fails a CHECK.
const CHECK_FAILED = { code: "23514" };

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };
const INV_1009 = { invoice: "dsor://org_456/invoice/INV-1009" };

/** A key that no other run has used. */
function freshKey(name: string): string {
  return `${name}-${randomUUID().slice(0, 8)}`;
}

/** The id of the payment an answer drafted, or its code. */
function heard(answer: Answer): unknown {
  return "code" in answer ? answer.code : (answer.data as { id?: unknown }).id;
}

/** How many payments a company holds now, as dsor_runtime reads them inside it. */
async function payments(tenant = "org_456"): Promise<number> {
  const sql = "SELECT count(*)::int AS n FROM app.payments WHERE tenant_id = $1";
  return (await tryThenRollBack(observer, sql, tenant, [tenant])).rows[0]!["n"] as number;
}

/** The claims of this key, as dsor_runtime reads them inside the company. */
async function claimsOf(
  tenant: string,
  principal: string,
  key: string,
): Promise<pg.QueryResultRow[]> {
  const sql = `SELECT operation, payload_hash, request_id, answer FROM dsor.idempotency
                WHERE tenant_id = $1 AND principal = $2 AND idempotency_key = $3`;
  return (await tryThenRollBack(observer, sql, tenant, [tenant, principal, key])).rows;
}

/**
 * A pool whose clients refuse, once, the first statement that holds this text. The database and
 * its transactions are real; only that one statement never reaches it (§47), as in
 * test/audit.db.test.ts.
 */
function failingOnce(text: string): { pool: pg.Pool; fired: () => number } {
  const failing = new pg.Pool({ connectionString: RUNTIME_URL, max: 2 });
  let fired = 0;
  failing.on("connect", (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
    client.query = ((...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes(text) && fired === 0) {
        fired += 1;
        return Promise.reject(new Error(`fault injected: ${text} failed`));
      }
      return query(...args);
    }) as typeof client.query;
  });
  return { pool: failing, fired: () => fired };
}

describe("C2: fifty requests with one key make one draft", () => {
  // The map's "done when". A pool of its own, so many calls hold a connection at once.
  it(
    "DSOR-IDM-01b: fifty parallel requests from the agent with one key create one payment",
    { timeout: 120_000 },
    async () => {
      const many = new pg.Pool({ connectionString: RUNTIME_URL, max: 10 });
      try {
        const key = freshKey("pay-INV-1008-fifty");
        const before = await payments();
        const answers = await Promise.all(
          Array.from({ length: 50 }, () =>
            call(
              dbRegistry(many),
              createDbLog(many),
              keyed(AGENT, key),
              "payment.create",
              INV_1008,
            ),
          ),
        );
        const ids = new Set(answers.map(heard));
        expect([...ids]).toHaveLength(1);
        expect([...ids][0]).toMatch(/^PAY-\d+$/);
        expect((await payments()) - before).toBe(1);
        expect(await claimsOf("org_456", "accounts-payable-fte", key)).toHaveLength(1);
      } finally {
        await many.end();
      }
    },
  );
});

describe("C3 and C4: a replay, and a refusal, on the database", () => {
  it("DSOR-IDM-01c: the same key and the same request replay the recorded answer: one draft, and the claim holds it", async () => {
    const key = freshKey("pay-INV-1008-a");
    const first = requestId("s20-first");
    const before = await payments();
    const one = await call(
      registry,
      log,
      keyed({ ...AGENT, request_id: first }, key),
      "payment.create",
      INV_1008,
    );
    const retry = requestId("s20-retry");
    const two = await call(
      registry,
      log,
      keyed({ ...AGENT, request_id: retry }, key),
      "payment.create",
      INV_1008,
    );
    expect(heard(two)).toBe(heard(one));
    expect((await payments()) - before).toBe(1);
    // Decision 12: json keeps the first answer's text, so the replay's fields come in its order.
    // Found by the review: with jsonb, which sorts them, every test still passed.
    expect(Object.keys((two as { data: object }).data)).toStrictEqual(
      Object.keys((one as { data: object }).data),
    );
    // Decision 8: the replay's record names the first call. Found by the review: no database
    // test read a replay's record.
    const sql = `SELECT "authorization", result, extensions FROM dsor.audit
                  WHERE correlation->>'request_id' = $1`;
    expect((await tryThenRollBack(observer, sql, "org_456", [retry])).rows).toMatchObject([
      {
        authorization: "ALLOW",
        result: "ok",
        extensions: { [OUR_EXTENSIONS]: { idempotency: { key, replay_of: first } } },
      },
    ]);
    expect(await claimsOf("org_456", "accounts-payable-fte", key)).toMatchObject([
      {
        operation: "payment.create",
        payload_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        request_id: first,
        answer: { value: { id: heard(one), invoice_id: "INV-1008", status: "draft" } },
      },
    ]);
  });

  it("DSOR-IDM-01d: the key sent again for INV-1009 is refused with IDEMPOTENCY_CONFLICT, and nothing more is drafted", async () => {
    const key = freshKey("pay-INV-1008-b");
    await call(registry, log, keyed(AGENT, key), "payment.create", INV_1008);
    const before = await payments();
    const answer = await call(registry, log, keyed(AGENT, key), "payment.create", INV_1009);
    expect(answer).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", retry: "never" });
    expect(await payments()).toBe(before);
  });

  // Found by the review: a conflict thrown inside the transaction closed a working connection,
  // so any caller could make DSoR open a new one at every call.
  it("step 20's decision 6: ten conflicts in a row keep the pool's two connections", async () => {
    const counted = new pg.Pool({ connectionString: RUNTIME_URL, max: 2 });
    let opened = 0;
    counted.on("connect", () => {
      opened += 1;
    });
    try {
      const on = dbRegistry(counted);
      const to = createDbLog(counted);
      const key = freshKey("pay-INV-1008-n");
      await call(on, to, keyed(AGENT, key), "payment.create", INV_1008);
      for (let at = 0; at < 10; at += 1) {
        const answer = await call(on, to, keyed(AGENT, key), "payment.create", INV_1009);
        expect(answer).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      }
      expect(opened).toBeLessThanOrEqual(2);
    } finally {
      await counted.end();
    }
  });

  it("DSOR-IDM-01a: a command with no key drafts nothing", async () => {
    const before = await payments();
    const answer = await call(registry, log, AGENT, "payment.create", INV_1008);
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await payments()).toBe(before);
  });
});

describe("decision 9: a refusal from the code is kept, and replayed", () => {
  it("DSOR-IDM-01c: a draft for INV-1005, which is not issued, is refused twice with one key, and the claim keeps the refusal", async () => {
    const key = freshKey("pay-INV-1005");
    const input = { invoice: "dsor://org_456/invoice/INV-1005" };
    const one = await call(registry, log, keyed(AGENT, key), "payment.create", input);
    const two = await call(registry, log, keyed(AGENT, key), "payment.create", input);
    expect([heard(one), heard(two)]).toStrictEqual(["CONFLICT", "CONFLICT"]);
    expect(await claimsOf("org_456", "accounts-payable-fte", key)).toMatchObject([
      { answer: { refused: { code: "CONFLICT", label: "internal" } } },
    ]);
  });

  // The code drafts, then refuses. The savepoint undoes the draft, and the claim keeps the refusal.
  it("step 20's decision 9: code that drafts and then refuses leaves no draft, and its refusal in the claim", async () => {
    const draftsThenRefuses: Handler = async (input, company) => {
      await handlersFor()["payment.create"]!(input, company);
      throw new Refusal("CONFLICT", "changed its mind", "internal");
    };
    const refusing = dbRegistry(pool, undefined, {
      ...handlersFor(),
      "payment.create": draftsThenRefuses,
    });
    const key = freshKey("pay-INV-1008-i");
    const before = await payments();
    const answer = await call(refusing, log, keyed(AGENT, key), "payment.create", INV_1008);
    expect(answer).toMatchObject({ code: "CONFLICT", message: "changed its mind" });
    expect(await payments()).toBe(before);
    expect(await claimsOf("org_456", "accounts-payable-fte", key)).toMatchObject([
      { answer: { refused: { code: "CONFLICT", message: "changed its mind", label: "internal" } } },
    ]);
  });

  // The company check runs inside the claim, so a bug's answer rolls back its draft and its claim.
  it("step 20's decision 6: code that drafts and answers with a row of org_789 leaves no draft and no claim", async () => {
    const answersForAnother: Handler = async (input, company) => {
      await handlersFor()["payment.create"]!(input, company);
      return { tenant_id: "org_789", id: "PAY-1" };
    };
    const buggy = dbRegistry(pool, undefined, {
      ...handlersFor(),
      "payment.create": answersForAnother,
    });
    const key = freshKey("pay-INV-1008-j");
    const before = await payments();
    const answer = await call(buggy, log, keyed(AGENT, key), "payment.create", INV_1008);
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await payments()).toBe(before);
    expect(await claimsOf("org_456", "accounts-payable-fte", key)).toStrictEqual([]);
  });
});

describe("C5: each part of the scope, on the database", () => {
  // Found by the review: the caller and the operation could leave the primary key and the
  // statements, and every database test passed. Each claim is sent again afterwards, so a
  // statement that left a part out would read two claims.
  it("DSOR-IDM-01b: user_123's draft with the agent's key text is her own claim, and each retry hears its own draft", async () => {
    const key = freshKey("pay-INV-1008-l");
    const agents = heard(await call(registry, log, keyed(AGENT, key), "payment.create", INV_1008));
    const hers = heard(
      await call(registry, log, keyed(SUPERVISOR, key), "payment.create", INV_1008),
    );
    expect(hers).toMatch(/^PAY-\d+$/);
    expect(hers).not.toBe(agents);
    const agentAgain = await call(registry, log, keyed(AGENT, key), "payment.create", INV_1008);
    const herAgain = await call(registry, log, keyed(SUPERVISOR, key), "payment.create", INV_1008);
    expect([heard(agentAgain), heard(herAgain)]).toStrictEqual([agents, hers]);
  });

  it("DSOR-IDM-01b: user_123 cancels her draft with the key she drafted it with, and each retry hears its own answer", async () => {
    const key = freshKey("pay-INV-1008-m");
    const drafted = heard(
      await call(registry, log, keyed(SUPERVISOR, key), "payment.create", INV_1008),
    );
    const payment = { payment: `dsor://org_456/payment/${String(drafted)}` };
    const cancelled = await call(registry, log, keyed(SUPERVISOR, key), "payment.cancel", payment);
    expect(cancelled).toMatchObject({ data: { id: drafted, status: "cancelled" } });
    const createAgain = await call(
      registry,
      log,
      keyed(SUPERVISOR, key),
      "payment.create",
      INV_1008,
    );
    const cancelAgain = await call(
      registry,
      log,
      keyed(SUPERVISOR, key),
      "payment.cancel",
      payment,
    );
    expect(createAgain).toMatchObject({ data: { id: drafted, status: "draft" } });
    expect(cancelAgain).toMatchObject({ data: { id: drafted, status: "cancelled" } });
  });

  // DSoR's own lock alone: the owner runs the claim store, and no policy stops the owner. Found
  // by the review: row-level security hid a store that left the company out of its statements.
  it("DSOR-TEN-01b: the claim store, run by the owner, keeps firm-ap-fte's two claims apart by the company in its own statements", () => {
    expect(ownerClaims("store", freshKey("pay-owner"))).toStrictEqual({
      first: { value: { made_in: "org_456" } },
      second: { value: { made_in: "org_789" } },
      again: { value: { made_in: "org_789" }, replay_of: "req_owner_789" },
    });
  });

  // The database checks a key's form a second time, and a fingerprint's form. Found by the
  // review: no test reached these checks.
  it.each([
    ["key", "'pay INV-1008'", `'sha256:' || repeat('a', 64)`],
    ["fingerprint", "'pay-INV-1008'", "'sha1:abc'"],
  ])(
    "step 20's decision 2: the database refuses a claim whose %s is not well formed",
    async (_, key, hash) => {
      const sql = `INSERT INTO dsor.idempotency
                   (tenant_id, principal, operation, idempotency_key, payload_hash, request_id)
                 VALUES ('org_456', 'accounts-payable-fte', 'payment.create', ${key}, ${hash}, 'req_x')`;
      await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(CHECK_FAILED);
    },
  );
});

describe("the claim store alone", () => {
  // The pipeline never hands the store such a value: its company check refuses it first. The
  // store must not keep it either. Found by the review: the database kept {}, and every retry
  // failed, while memory let the retry run again.
  it("step 20's decision 6: work that answers with nothing JSON can keep leaves no claim", async () => {
    const key = freshKey("pay-INV-1008-o");
    const scope = {
      tenant: "org_456",
      principal: "accounts-payable-fte",
      operation: "payment.create",
      key,
    };
    const hash = `sha256:${"c".repeat(64)}`;
    await expect(
      createDbClaims(pool).run(scope, hash, requestId("s20-none"), async () => undefined),
    ).rejects.toThrow("the command's answer cannot be kept as JSON");
    expect(await claimsOf("org_456", "accounts-payable-fte", key)).toStrictEqual([]);
  });
});

describe("C5: the company, by row-level security", () => {
  it("DSOR-IDM-01b: firm-ap-fte's key text in org_789 is its own claim, and drafts in org_789", async () => {
    const key = freshKey("pay-INV-1008-c");
    await call(registry, log, keyed(AGENT, key), "payment.create", INV_1008);
    const before = await payments("org_789");
    const answer = await call(registry, log, keyed(FIRM_IN_789, key), "payment.create", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(heard(answer)).toMatch(/^PAY-\d+$/);
    expect((await payments("org_789")) - before).toBe(1);
    expect(await claimsOf("org_789", "firm-ap-fte", key)).toHaveLength(1);
  });

  it("DSOR-IDM-01b: firm-ap-fte sends one key in org_456 and in org_789, and drafts in each", async () => {
    const key = freshKey("pay-INV-1008-k");
    const before = [await payments("org_456"), await payments("org_789")];
    await call(registry, log, keyed(FIRM_IN_456, key), "payment.create", INV_1008);
    const answer = await call(registry, log, keyed(FIRM_IN_789, key), "payment.create", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(heard(answer)).toMatch(/^PAY-\d+$/);
    expect([
      (await payments("org_456")) - before[0]!,
      (await payments("org_789")) - before[1]!,
    ]).toStrictEqual([1, 1]);
    expect(await claimsOf("org_456", "firm-ap-fte", key)).toHaveLength(1);
    expect(await claimsOf("org_789", "firm-ap-fte", key)).toHaveLength(1);
  });

  it("DSOR-TEN-02a: as dsor_runtime inside org_789, org_456's claims are invisible, and with no company there are none", async () => {
    await call(registry, log, keyed(AGENT, freshKey("pay-INV-1008-d")), "payment.create", INV_1008);
    const sql = "SELECT count(*)::int AS n FROM dsor.idempotency WHERE tenant_id = 'org_456'";
    expect((await tryThenRollBack(observer, sql, "org_789")).rows[0]!["n"]).toBe(0);
    expect((await tryThenRollBack(observer, "SELECT * FROM dsor.idempotency")).rows).toStrictEqual(
      [],
    );
  });
});

describe("C6: the claim, the work, and the answer commit together, or none of them does", () => {
  it("step 20's decision 6: the draft fails: no claim and no draft stay, and a retry with the key drafts once", async () => {
    const { pool: failing, fired } = failingOnce("INSERT INTO app.payments");
    try {
      const key = freshKey("pay-INV-1008-e");
      const before = await payments();
      const lost = await call(
        dbRegistry(failing),
        log,
        keyed(AGENT, key),
        "payment.create",
        INV_1008,
      );
      expect(lost).toMatchObject({ code: "INTERNAL_ERROR" });
      expect(fired()).toBe(1);
      expect(await claimsOf("org_456", "accounts-payable-fte", key)).toStrictEqual([]);
      expect(await payments()).toBe(before);
      const retry = await call(registry, log, keyed(AGENT, key), "payment.create", INV_1008);
      expect(heard(retry)).toMatch(/^PAY-\d+$/);
      expect((await payments()) - before).toBe(1);
    } finally {
      await failing.end();
    }
  });

  it("step 20's decision 6: the recorded answer fails: no draft and no claim stay", async () => {
    const { pool: failing, fired } = failingOnce("UPDATE dsor.idempotency");
    try {
      const key = freshKey("pay-INV-1008-f");
      const before = await payments();
      const lost = await call(
        dbRegistry(failing),
        log,
        keyed(AGENT, key),
        "payment.create",
        INV_1008,
      );
      expect(lost).toMatchObject({ code: "INTERNAL_ERROR" });
      expect(fired()).toBe(1);
      expect(await payments()).toBe(before);
      expect(await claimsOf("org_456", "accounts-payable-fte", key)).toStrictEqual([]);
    } finally {
      await failing.end();
    }
  });
});

describe("decision 12: an answer is written once, and a claim never changes", () => {
  it("step 20's decision 12: dsor_runtime cannot change a recorded answer: the update touches no row", async () => {
    const key = freshKey("pay-INV-1008-g");
    await call(registry, log, keyed(AGENT, key), "payment.create", INV_1008);
    const sql = `UPDATE dsor.idempotency SET answer = '{"id": "PAY-1"}'
                  WHERE tenant_id = 'org_456' AND idempotency_key = $1`;
    expect((await tryThenRollBack(observer, sql, "org_456", [key])).rowCount).toBe(0);
  });

  it.each([
    ["fingerprint", "payload_hash = 'sha256:' || repeat('0', 64)"],
    ["key", "idempotency_key = 'another'"],
    ["first call", "request_id = 'req_other'"],
    ["time", "claimed_at = now()"],
  ])("step 20's decision 12: dsor_runtime cannot change a claim's %s", async (_, change) => {
    const sql = `UPDATE dsor.idempotency SET ${change} WHERE tenant_id = 'org_456'`;
    await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
  });

  it("step 20's decision 12: dsor_runtime cannot remove a claim", async () => {
    const sql = "DELETE FROM dsor.idempotency WHERE tenant_id = 'org_456'";
    await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
  });
});

describe("C8: a claim lasts at least 24 hours", () => {
  /** A draft with a fresh key, its claim moved back this many minutes, and the retry's answer. */
  async function retryAfter(
    minutes: number,
  ): Promise<{ one: Answer; two: Answer; drafts: number }> {
    const key = freshKey("pay-INV-1008-h");
    const before = await payments();
    const one = await call(registry, log, keyed(AGENT, key), "payment.create", INV_1008);
    const args = ["org_456", "accounts-payable-fte", "payment.create", key, String(minutes)];
    expect(ownerClaims("age", ...args)).toStrictEqual({ aged: 1 });
    // The claim really is that old, by the database's clock. Found by the mutation sweep: an
    // age command that moved nothing passed, because nothing deletes a claim.
    const sql = `SELECT now() - claimed_at >= make_interval(mins => $2) AS old
                   FROM dsor.idempotency WHERE tenant_id = 'org_456' AND idempotency_key = $1`;
    const aged = await tryThenRollBack(observer, sql, "org_456", [key, minutes]);
    expect(aged.rows).toStrictEqual([{ old: true }]);
    const two = await call(registry, log, keyed(AGENT, key), "payment.create", INV_1008);
    return { one, two, drafts: (await payments()) - before };
  }

  // The rule's minimum, to the minute: a clean-up that keeps claims for exactly 24 hours meets
  // it. Found by the review: the first version aged a claim by 25 hours, which proved decision 11.
  it("DSOR-IDM-02: a claim made 23 hours and 59 minutes ago still replays its answer", async () => {
    const { one, two, drafts } = await retryAfter(23 * 60 + 59);
    expect(heard(two)).toBe(heard(one));
    expect(drafts).toBe(1);
  });

  it("step 20's decision 11: claims are kept, so a claim made 25 hours ago still replays its answer", async () => {
    const { one, two, drafts } = await retryAfter(25 * 60);
    expect(heard(two)).toBe(heard(one));
    expect(drafts).toBe(1);
  });
});
