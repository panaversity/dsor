// The database keeps each company's invoices apart, and every record says
// whose it is (C2 and C6 in step 10's README, decisions 5, 6, and 8). The same claims as
// test/tenants.test.ts, asked of app.invoices and dsor.audit.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, openPool } from "../src/postgres.ts";
import {
  RUNTIME_URL,
  dbRegistry,
  newPool,
  ownerRowsFor,
  requestId,
  tryThenRollBack,
} from "./db.ts";
import {
  AGENT,
  CFO,
  INV_1008_OF_456,
  INV_1008_OF_789,
  INV_2001_OF_789,
  USER_700,
  withoutRequestId,
} from "./helpers.ts";

const pool = openPool(RUNTIME_URL);
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

describe("C2: a read in the database looks only inside the active company", () => {
  // NEW IN STEP 14: cfo_100 asks, a person, as user_700 does below. An agent's answer has
  // no amount (step 14's README, decision 5).
  it("DSOR-IDN-03b: org_456 reads INV-1008 from app.invoices: 31,400.00 USD", async () => {
    const answer = await call(registry, log, CFO, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect((answer as { data: unknown }).data).toStrictEqual(INV_1008_OF_456);
  });

  it("DSOR-IDN-03b: org_789 reads INV-1008 from app.invoices: 99,000.00 USD", async () => {
    const answer = await call(registry, log, USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect((answer as { data: unknown }).data).toStrictEqual(INV_1008_OF_789);
  });

  // The test U1 needs: with the company left out of the query, org_456 would find
  // org_789's INV-2001, because nothing else is called INV-2001.
  it("DSOR-IDN-03b: org_456 reading INV-2001 hears the same as for INV-9999", async () => {
    const theirs = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-2001",
    });
    const nobodys = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-9999",
    });
    expect(theirs).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    const asSent = JSON.stringify(withoutRequestId(nobodys)).replaceAll("INV-9999", "INV-2001");
    expect(JSON.stringify(withoutRequestId(theirs))).toBe(asSent);
  });

  it("DSOR-IDN-03b: the store finds an invoice by company and id together", async () => {
    const store = createDbInvoices(pool);
    expect(await store.get("org_789", "INV-2001")).toStrictEqual(INV_2001_OF_789);
    expect(await store.get("org_456", "INV-2001")).toBeUndefined();
    expect(await store.get("org_999", "INV-1008")).toBeUndefined();
  });
});

describe("C6: every invoice row and every audit record carries its company", () => {
  it("DSOR-TEN-01a: app.invoices.tenant_id is NOT NULL", async () => {
    const { rows } = await observer.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'invoices' AND column_name = 'tenant_id'`,
    );
    expect(rows).toStrictEqual([{ is_nullable: "NO" }]);
  });

  // The key is the pair, so both companies can have an INV-1008 (step 10's README,
  // decision 5).
  it("DSOR-TEN-01a: app.invoices is keyed by (tenant_id, id)", async () => {
    const { rows } = await observer.query(
      `SELECT a.attname AS column
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'app.invoices'::regclass AND i.indisprimary
        ORDER BY array_position(i.indkey::int2[], a.attnum)`,
    );
    expect(rows).toStrictEqual([{ column: "tenant_id" }, { column: "id" }]);
  });

  /** The tenant column of the one record this request id left, read inside a company. */
  async function tenantOf(company: string, request_id: string): Promise<unknown[]> {
    const { rows } = await tryThenRollBack(
      observer,
      `SELECT tenant FROM dsor.audit WHERE correlation->>'request_id' = $1`,
      company,
      [request_id],
    );
    return rows;
  }

  it("DSOR-TEN-01a: a call's record in dsor.audit names its company", async () => {
    const id = requestId("c6-tenant");
    await call(registry, log, { ...USER_700, request_id: id }, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(await tenantOf("org_789", id)).toStrictEqual([{ tenant: "org_789" }]);
  });

  it("DSOR-TEN-01a: a refusal with no login is recorded with no company", async () => {
    const id = requestId("c6-no-login");
    await call(registry, log, { tenant: "org_456", request_id: id }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    // No company, so only the owner can read it (step 11's README, decision 4).
    expect(ownerRowsFor(id)).toMatchObject([{ tenant: null }]);
  });

  // The company a non-member asked for, kept as a claim (step 10's README, decision 6).
  it("a non-member's refusal keeps the company it asked for under extensions, not as tenant", async () => {
    const id = requestId("c6-claim");
    await call(
      registry,
      log,
      { token: "tok_7f3a", tenant: "org_789", request_id: id },
      "invoice.get",
      {
        invoice: "dsor://org_789/invoice/INV-1008",
      },
    );
    // No company was checked, so only the owner can read it (step 11's README, decision 4).
    expect(ownerRowsFor(id)).toMatchObject([
      { tenant: null, extensions: { "org.panaversity.steps": { requested_tenant: "org_789" } } },
    ]);
  });

  // Step 02's form, kept by the database too (002_tenants.sql). Found by the review:
  // nothing tested the CHECK. dsor_runtime may insert this column, so it is the one to try.
  // Inside the company acme, so the policy lets the row through and only the CHECK can
  // refuse it (step 11's README, decision 4).
  it("DSOR-TEN-01a: dsor.audit refuses a tenant that is not org_ and digits", async () => {
    await expect(
      tryThenRollBack(
        observer,
        `INSERT INTO dsor.audit (record_id, kind, "authorization", result, correlation, tenant)
         VALUES ('aud_check', 'decision', 'DENY', 'ok', '{}', 'acme')`,
        "acme",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

// No rule id: how migrations run is step 10's decision 8, not a rule of DSoR.
describe("decision 8: each migration runs once", () => {
  const MIGRATE = fileURLToPath(new URL("../src/migrate.ts", import.meta.url));
  // The child reads the owner's key from .env itself. This test never holds it.
  function migrate(): { status: number | null; out: string } {
    const run = spawnSync(process.execPath, [MIGRATE], { encoding: "utf8", timeout: 60_000 });
    return { status: run.status, out: run.stdout + run.stderr };
  }

  it("a second pnpm migrate runs no file, and succeeds", () => {
    expect(migrate().status).toBe(0);
    const second = migrate();
    expect(second.out).toMatch("no migration to run");
    expect(second.out).not.toMatch(/migration \d+_\S+: done/);
    expect(second.status).toBe(0);
  }, 120_000);
});
