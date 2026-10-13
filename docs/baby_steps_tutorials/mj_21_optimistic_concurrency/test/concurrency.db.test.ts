// Optimistic concurrency on the database. The unit tests prove the comparisons in memory. These
// prove them against the database's own versions: the trigger raises a version at each change,
// a change between DSoR's read and its write is caught by the write itself, two cancels at the
// same moment cannot both succeed, and dsor_runtime cannot set a version (step 21's README, C2
// to C11). The tests change INV-9001 only, an invoice of their own, which the owner adds before
// them and removes after (decision 12).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import { INVOICE_TRIGGER, PAYMENT_TRIGGER } from "./catalogs.ts";
import { AGENT, CFO, SUPERVISOR, keyed } from "./helpers.ts";
import {
  NO_PRIVILEGE,
  RUNTIME_URL,
  dbRegistry,
  newPool,
  ownerInvoices,
  tryThenRollBack,
} from "./db.ts";

// The program's own pool, and the test's window into the database, both dsor_runtime.
const pool = newPool();
const observer = newPool();
const registry = dbRegistry(pool);
const log = createDbLog(pool);

const INV_9001 = "dsor://org_456/invoice/INV-9001";

beforeAll(() => {
  expect(ownerInvoices("add")).toStrictEqual({ version: 1 });
});
afterAll(async () => {
  ownerInvoices("remove");
  await pool.end();
  await observer.end();
});

/** The refusal of a request decided on an older version of a record, typed out. */
function stale(record: string, now: number, decided: number): string {
  return `${record} is at version ${now}, and the request was decided on version ${decided}`;
}

/** The data of an answer, or its code when it was refused. */
function heard(answer: Answer): unknown {
  return "code" in answer ? answer.code : answer.data;
}

/** INV-9001's version now, as dsor_runtime reads it inside org_456. */
async function versionOf9001(): Promise<number> {
  const sql = "SELECT version FROM app.invoices WHERE tenant_id = 'org_456' AND id = 'INV-9001'";
  return (await tryThenRollBack(observer, sql, "org_456")).rows[0]!["version"] as number;
}

/** How many payments are drafted for INV-9001. */
async function draftsOf9001(): Promise<number> {
  const sql = "SELECT count(*)::int AS n FROM app.payments WHERE invoice_id = 'INV-9001'";
  return (await tryThenRollBack(observer, sql, "org_456")).rows[0]!["n"] as number;
}

/** user_123 drafts a payment for INV-9001 on its version now, and gives back the payment's id. */
async function draft9001(): Promise<string> {
  const answer = await call(registry, log, keyed(SUPERVISOR), "payment.create", {
    invoice: INV_9001,
    expected_version: await versionOf9001(),
  });
  const id = "data" in answer ? (answer.data as { id?: unknown }).id : undefined;
  if (typeof id !== "string") throw new Error(`no draft: ${JSON.stringify(answer)}`);
  return id;
}

describe("C2 and C7: a change outside DSoR raises the version, and a request on the old one is refused", () => {
  it("step 21's decision 2: the accounts system's credit note raises INV-9001's version by one, by the database's own trigger", async () => {
    const before = await versionOf9001();
    expect(ownerInvoices("credit", "450.00")).toStrictEqual({ version: before + 1 });
    expect(await versionOf9001()).toBe(before + 1);
  });

  // Found by the review: a trigger that kept a version its writer set passed every test.
  it("step 21's decision 2: the accounts system sets version 1 with its change, and the trigger raises the old version by one anyway", async () => {
    const before = await versionOf9001();
    expect(ownerInvoices("credit", "440.00", "1")).toStrictEqual({ version: before + 1 });
  });

  it("DSOR-CON-01b: the agent decided before the credit note: STALE_STATE, and no draft for INV-9001", async () => {
    const decided = await versionOf9001();
    ownerInvoices("credit", "400.00");
    const drafts = await draftsOf9001();
    const answer = await call(registry, log, keyed(AGENT), "payment.create", {
      invoice: INV_9001,
      expected_version: decided,
    });
    expect(answer).toMatchObject({
      code: "STALE_STATE",
      message: stale('invoice "INV-9001"', decided + 1, decided),
      retry: "after_state_refresh",
    });
    expect(await draftsOf9001()).toBe(drafts);
  });

  it("DSOR-CON-01b: the agent reads INV-9001 again, and drafts what is open now, on the version it read", async () => {
    ownerInvoices("credit", "300.00");
    const read = await call(registry, log, AGENT, "invoice.get", { invoice: INV_9001 });
    const { version } = heard(read) as { version: number };
    expect(read).toMatchObject({
      freshness: { connector: "postgres", resource_version: String(version) },
    });
    const answer = await call(registry, log, keyed(SUPERVISOR), "payment.create", {
      invoice: INV_9001,
      expected_version: version,
    });
    expect(heard(answer)).toMatchObject({
      invoice_id: "INV-9001",
      amount: { value: "300.00", currency: "USD" },
      status: "draft",
      version: 1,
    });
  });
});

describe("C3: a change between DSoR's read and its write is caught by the write", () => {
  // The fault: just before the draft's INSERT reaches the database, the accounts system's credit
  // note lands, and commits. The code had read INV-9001 a moment before, at the old version.
  it("DSOR-CON-01b: the credit note lands after the code read INV-9001 and before the draft is written: STALE_STATE, and no draft", async () => {
    const racing = new pg.Pool({ connectionString: RUNTIME_URL, max: 2 });
    let landed = false;
    racing.on("connect", (client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      client.query = ((...args: unknown[]) => {
        if (
          !landed &&
          typeof args[0] === "string" &&
          args[0].includes("INSERT INTO app.payments")
        ) {
          landed = true;
          ownerInvoices("credit", "250.00");
        }
        return query(...args);
      }) as typeof client.query;
    });
    try {
      const decided = await versionOf9001();
      const drafts = await draftsOf9001();
      const answer = await call(dbRegistry(racing), log, keyed(AGENT), "payment.create", {
        invoice: INV_9001,
        expected_version: decided,
      });
      expect(landed).toBe(true);
      expect(answer).toMatchObject({
        code: "STALE_STATE",
        message: stale('invoice "INV-9001"', decided + 1, decided),
      });
      expect(await draftsOf9001()).toBe(drafts);
    } finally {
      await racing.end();
    }
  });
});

// Found by the review: the check is the write only at READ COMMITTED. A database whose default
// is REPEATABLE READ gave each transaction one picture for its whole length, so the draft's
// check read the picture from before the credit note. DSoR now begins every transaction at
// READ COMMITTED itself (step 21's README, decision 6).
describe("decision 6, from the review: the check holds whatever the database's default level", () => {
  /** A pool whose connections default to REPEATABLE READ, as a database's setting would make them. */
  function repeatableRead(): pg.Pool {
    const strict = new pg.Pool({ connectionString: RUNTIME_URL, max: 4 });
    strict.on("connect", (client) => {
      void client.query("SET default_transaction_isolation = 'repeatable read'");
    });
    return strict;
  }

  it("DSOR-CON-01b: at a default of REPEATABLE READ, the credit note between the read and the write still gets STALE_STATE", async () => {
    const strict = repeatableRead();
    let landed = false;
    strict.on("connect", (client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      client.query = ((...args: unknown[]) => {
        if (
          !landed &&
          typeof args[0] === "string" &&
          args[0].includes("INSERT INTO app.payments")
        ) {
          landed = true;
          ownerInvoices("credit", "230.00");
        }
        return query(...args);
      }) as typeof client.query;
    });
    try {
      const decided = await versionOf9001();
      const drafts = await draftsOf9001();
      const answer = await call(dbRegistry(strict), log, keyed(AGENT), "payment.create", {
        invoice: INV_9001,
        expected_version: decided,
      });
      expect(landed).toBe(true);
      expect(answer).toMatchObject({ code: "STALE_STATE" });
      expect(await draftsOf9001()).toBe(drafts);
    } finally {
      await strict.end();
    }
  });

  it("DSOR-CON-01b: at a default of REPEATABLE READ, two cancels at once: one cancels, and the other hears STALE_STATE", async () => {
    const id = await draft9001();
    const strict = repeatableRead();
    try {
      const on = dbRegistry(strict);
      const to = createDbLog(strict);
      const cancel = { payment: `dsor://org_456/payment/${id}`, expected_version: 1 };
      const answers = await Promise.all([
        call(on, to, keyed(SUPERVISOR), "payment.cancel", cancel),
        call(on, to, keyed(SUPERVISOR), "payment.cancel", cancel),
      ]);
      const codes = answers.map((a) => ("code" in a ? a.code : "cancelled")).sort();
      expect(codes).toStrictEqual(["STALE_STATE", "cancelled"]);
    } finally {
      await strict.end();
    }
  });
});

describe("C4, C5, and C6: cancels on the database", () => {
  it("DSOR-CON-01b: a cancel decided on the draft's version 1 cancels it, and the database raises it to version 2", async () => {
    const id = await draft9001();
    const answer = await call(registry, log, keyed(SUPERVISOR), "payment.cancel", {
      payment: `dsor://org_456/payment/${id}`,
      expected_version: 1,
    });
    expect(heard(answer)).toMatchObject({ id, status: "cancelled", version: 2 });
  });

  it("DSOR-CON-01b: a second cancel on version 1 gets STALE_STATE, and one on version 2 gets CONFLICT", async () => {
    const id = await draft9001();
    const payment = `dsor://org_456/payment/${id}`;
    await call(registry, log, keyed(SUPERVISOR), "payment.cancel", {
      payment,
      expected_version: 1,
    });
    const onOne = await call(registry, log, keyed(SUPERVISOR), "payment.cancel", {
      payment,
      expected_version: 1,
    });
    const onTwo = await call(registry, log, keyed(SUPERVISOR), "payment.cancel", {
      payment,
      expected_version: 2,
    });
    expect(onOne).toMatchObject({ code: "STALE_STATE", message: stale(`payment "${id}"`, 2, 1) });
    expect(onTwo).toMatchObject({ code: "CONFLICT" });
  });

  // A payment changed outside DSoR, which is still a draft. Only the version tells that the
  // cancel was decided on facts that are gone. Found while planning break B4: with a status
  // check alone, every other test passed.
  it("DSOR-CON-01b: the accounts system amends a draft, which stays a draft at version 2: a cancel decided on version 1 gets STALE_STATE, and the draft stays", async () => {
    const id = await draft9001();
    expect(ownerInvoices("amend", id)).toStrictEqual({ version: 2 });
    const answer = await call(registry, log, keyed(SUPERVISOR), "payment.cancel", {
      payment: `dsor://org_456/payment/${id}`,
      expected_version: 1,
    });
    expect(answer).toMatchObject({ code: "STALE_STATE", message: stale(`payment "${id}"`, 2, 1) });
    const sql = "SELECT status, version FROM app.payments WHERE tenant_id = 'org_456' AND id = $1";
    expect((await tryThenRollBack(observer, sql, "org_456", [id])).rows).toStrictEqual([
      { status: "draft", version: 2 },
    ]);
  });

  // Real parallel requests, on two connections. The second UPDATE waits for the first, reads
  // the row again, and finds version 2.
  it("DSOR-CON-01b: two cancels decided on version 1, at the same moment: one cancels, and the other hears STALE_STATE", async () => {
    const id = await draft9001();
    const both = new pg.Pool({ connectionString: RUNTIME_URL, max: 4 });
    try {
      const on = dbRegistry(both);
      const to = createDbLog(both);
      const cancel = { payment: `dsor://org_456/payment/${id}`, expected_version: 1 };
      const answers = await Promise.all([
        call(on, to, keyed(SUPERVISOR), "payment.cancel", cancel),
        call(on, to, keyed(SUPERVISOR), "payment.cancel", cancel),
      ]);
      const codes = answers.map((a) => ("code" in a ? a.code : "cancelled")).sort();
      expect(codes).toStrictEqual(["STALE_STATE", "cancelled"]);
    } finally {
      await both.end();
    }
  });
});

describe("C7: no writer sets a version but the database", () => {
  it("step 21's decision 2: dsor_runtime cannot set a payment's version", async () => {
    const sql = "UPDATE app.payments SET version = 7 WHERE tenant_id = 'org_456'";
    await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
  });

  it("step 21's decision 2: dsor_runtime cannot change an invoice at all", async () => {
    const sql = "UPDATE app.invoices SET version = 7 WHERE tenant_id = 'org_456'";
    await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
  });
});

describe("C8 and C11: the version in a read, and the triggers in the catalog", () => {
  it("DSOR-FRS-01a: cfo_100's read of INV-1008 names its version, 1, as postgres read it", async () => {
    const answer = await call(registry, log, CFO, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toMatchObject({
      data: { version: 1 },
      freshness: { mode: "current", connector: "postgres", resource_version: "1" },
    });
  });

  it("step 21's decision 11: the database holds exactly the two triggers the map names", async () => {
    const sql = `SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t
                  WHERE NOT t.tgisinternal ORDER BY 1`;
    const { rows } = await tryThenRollBack(observer, sql);
    expect(rows.map((row) => row["def"])).toStrictEqual([INVOICE_TRIGGER, PAYMENT_TRIGGER]);
  });
});

// Found by the review: two branches of the draft's look had no test. Last in this file,
// because the second removes INV-9001 and adds it again.
describe("decision 6, from the review: what the look after an empty write says", () => {
  /** A pool whose next draft INSERT does something else first, or instead. */
  function aroundTheDraft(instead: (forward: () => Promise<unknown>) => Promise<unknown>): pg.Pool {
    const odd = new pg.Pool({ connectionString: RUNTIME_URL, max: 2 });
    let done = false;
    odd.on("connect", (client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      client.query = ((...args: unknown[]) => {
        if (!done && typeof args[0] === "string" && args[0].includes("INSERT INTO app.payments")) {
          done = true;
          return instead(() => query(...args));
        }
        return query(...args);
      }) as typeof client.query;
    });
    return odd;
  }

  // As a rule or a trigger would: the INSERT keeps no row, and the invoice is still at the
  // version. That is a bug, never a stale request, so the claim goes too.
  it("step 21's decision 6: the draft's INSERT keeps no row while the invoice is at its version: INTERNAL_ERROR, and no draft", async () => {
    const odd = aroundTheDraft(async () => ({ rows: [], rowCount: 0, command: "INSERT" }));
    try {
      const drafts = await draftsOf9001();
      const answer = await call(dbRegistry(odd), log, keyed(AGENT), "payment.create", {
        invoice: INV_9001,
        expected_version: await versionOf9001(),
      });
      expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
      expect(await draftsOf9001()).toBe(drafts);
    } finally {
      await odd.end();
    }
  });

  it("step 21's decision 6: INV-9001 is removed between the read and the write: RESOURCE_NOT_FOUND, not a version", async () => {
    const odd = aroundTheDraft(async (forward) => {
      ownerInvoices("remove");
      return forward();
    });
    try {
      const answer = await call(dbRegistry(odd), log, keyed(AGENT), "payment.create", {
        invoice: INV_9001,
        expected_version: await versionOf9001(),
      });
      expect(answer).toMatchObject({
        code: "RESOURCE_NOT_FOUND",
        message: 'no invoice "INV-9001"',
      });
    } finally {
      await odd.end();
      expect(ownerInvoices("add")).toStrictEqual({ version: 1 });
    }
  });
});
