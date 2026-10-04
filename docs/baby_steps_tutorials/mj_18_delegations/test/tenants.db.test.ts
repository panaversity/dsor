// The database keeps each company's invoices apart, and every record says
// whose it is (C2 and C6 in step 10's README, decisions 5, 6, and 8). The same claims as
// test/tenants.test.ts, asked of app.invoices and dsor.audit.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { companyOf } from "../src/company.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, createDbSlips, openPool } from "../src/postgres.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import { parseUri } from "../src/uri.ts";
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
  UNEXPECTED,
  USER_700,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  forComparing,
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
  // Cfo_100 asks, a person, as user_700 does below. An agent's answer has
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
    const asSent = JSON.stringify(forComparing(nobodys)).replaceAll("INV-9999", "INV-2001");
    expect(JSON.stringify(forComparing(theirs))).toBe(asSent);
  });

  it("DSOR-IDN-03b: the store finds an invoice by company and id together", async () => {
    // The store gives the invoice beside its read's label.
    const store = createDbInvoices(pool);
    const found = async (tenant: string, id: string): Promise<unknown> =>
      (await store.get(tenant, id)).invoice;
    expect(await found("org_789", "INV-2001")).toStrictEqual(INV_2001_OF_789);
    expect(await found("org_456", "INV-2001")).toBeUndefined();
    expect(await found("org_999", "INV-1008")).toBeUndefined();
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

  /** An INSERT dsor_runtime may make, whose extensions keep this company as a claim. */
  function claimOf(tenantSql: string): string {
    return `INSERT INTO dsor.audit (record_id, kind, "authorization", result, correlation, extensions)
            VALUES ('aud_check', 'decision', 'DENY', 'ok', '{}',
                    jsonb_build_object('org.panaversity.steps',
                                       jsonb_build_object('requested_tenant', ${tenantSql})))`;
  }

  // The second guard, if the code ever keeps a large claim again: migration 003b. The test
  // is rolled back, so it never adds to the log (step 10's README, decision 12). With no
  // company set, as the program writes a claim, so the policy lets the row through and only
  // the CHECK can refuse it (step 11's README, decision 4). Found by the Stage 2 review, and
  // fixed from step 10 on.
  it("step 10's decision 12: dsor.audit refuses an extensions larger than 1 KiB, with 23514", async () => {
    await expect(
      tryThenRollBack(observer, claimOf(`'org_' || repeat('9', 2048)`)),
    ).rejects.toMatchObject({ code: "23514", constraint: "audit_extensions_size" });
  });

  // The limit itself, measured as the CHECK measures it: 1,024 bytes is kept, 1,025 is not.
  // Found by a hostile pass on the Stage 2 review's fix: 2 KB alone would let a limit of
  // 4,096 pass.
  it("step 10's decision 12: an extensions of 1,024 bytes is kept, and one of 1,025 is refused", async () => {
    const claim = (digits: number): string => `'org_' || repeat('9', ${digits})`;
    const size = async (digits: number): Promise<unknown> => {
      const { rows } = await observer.query(
        `SELECT octet_length(jsonb_build_object('org.panaversity.steps',
                  jsonb_build_object('requested_tenant', ${claim(digits)}))::text) AS bytes`,
      );
      return rows[0].bytes;
    };
    expect([await size(969), await size(970)]).toStrictEqual([1024, 1025]);
    await expect(tryThenRollBack(observer, claimOf(claim(969)))).resolves.toMatchObject({
      rowCount: 1,
    });
    await expect(tryThenRollBack(observer, claimOf(claim(970)))).rejects.toMatchObject({
      code: "23514",
      constraint: "audit_extensions_size",
    });
  });

  it("step 10's decision 12: the largest claim the code can keep, 18 digits, fits", async () => {
    await expect(
      tryThenRollBack(observer, claimOf(`'org_' || repeat('9', 18)`)),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  // The review's run: a refusal of 212 bytes left a record of 1,000,433 bytes. The record
  // has no company, so only the owner can read it, and the owner measures it as the CHECK
  // does (step 11's README, decision 4). Found by the Stage 2 review, and fixed from step
  // 10 on.
  it("step 10's decision 12: a company of a million digits leaves a small record in dsor.audit, with no claim", async () => {
    const id = requestId("f2-flood");
    const request = { token: "tok_7f3a", tenant: `org_${"9".repeat(1_000_000)}`, request_id: id };
    const answer = await call(registry, log, request, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    const rows = ownerRowsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant: null, extensions: null });
    expect(rows[0]!["bytes"]).toBeLessThan(1024);
  });
});

describe("C8: in the database, the code reaches only the active company, and its answer must belong to it", () => {
  // The store the code gets, against app.invoices. A second argument changes nothing (step
  // 10's README, decision 13). Each read runs inside the bound company's transaction, so
  // the database's lock filters by that company too (step 11's README, decision 3). Found
  // by the Stage 2 review, and fixed from step 10 on.
  it("DSOR-IDN-03b: the store the code gets reads only its own company in app.invoices, whatever it is given", async () => {
    const store = createDbInvoices(pool);
    const in456 = companyOf(store, "org_456");
    expect(await companyOf(store, "org_789").invoices.get("INV-2001")).toStrictEqual(
      INV_2001_OF_789,
    );
    expect(await in456.invoices.get("INV-2001")).toBeUndefined();
    // @ts-expect-error: get takes an id and nothing more.
    expect(await in456.invoices.get("INV-2001", "org_789")).toBeUndefined();
    // @ts-expect-error: the other way round, too.
    expect(await in456.invoices.get("org_789", "INV-2001")).toBeUndefined();
  });

  // The same for the list, which invoice.list reads through. Found by the Stage 2 review,
  // and fixed from step 13 on.
  it("DSOR-IDN-03b: the list the code gets reads only its own company in app.invoices, whatever it is given", async () => {
    const store = createDbInvoices(pool);
    const in456 = companyOf(store, "org_456");
    const companies = async (listed: Promise<{ tenant_id: string }[]>): Promise<string[]> => [
      ...new Set((await listed).map(({ tenant_id }) => tenant_id)),
    ];
    expect(await companies(companyOf(store, "org_789").invoices.list(undefined, 20))).toStrictEqual(
      ["org_789"],
    );
    expect(await companies(in456.invoices.list(undefined, 20))).toStrictEqual(["org_456"]);
    // @ts-expect-error: list takes a place and a count, and nothing more.
    expect(await in456.invoices.list(undefined, 20, "org_789")).toHaveLength(12);
    // @ts-expect-error: the store's own order, with the company first. Nothing sorts after
    // the place "org_789" in org_456's list.
    expect(await in456.invoices.list("org_789", undefined, 20)).toStrictEqual([]);
  });

  // Code that makes a store of its own reads org_789's INV-2001 from inside org_456. The
  // database's lock does not stop it: that store sets org_789 for its own read, so the
  // policy shows org_789's rows. Its answer gives it away: INTERNAL_ERROR, recorded as
  // ALLOW, and nothing of the row leaks (step 10's README, decision 14). Found by the
  // Stage 2 review, and fixed from step 10 on.
  it("step 10's decision 14: code that reads org_789 through a store of its own fails with INTERNAL_ERROR, recorded as ALLOW", async () => {
    const itsOwn = createDbInvoices(pool);
    // The invoice, out of what the store gives.
    const reachesAround: Handler = async (input) =>
      (await itsOwn.get("org_789", parseUri((input as { invoice: string }).invoice).id)).invoice;
    // The shipped code, with invoice.get replaced. Since step 17, start-up refuses a registry
    // whose payment.create names an undo with no code (step 17's README, decision 8).
    const planted = buildRegistry(
      shipped,
      { ...handlersFor(), "invoice.get": reachesAround },
      shippedRoles,
      shippedInputs,
      shippedLabels,
      createDbInvoices(pool),
      undefined,
      // Step 18: and the slips, so the agent reaches the code (step 18's README, decision 2).
      createDbSlips(pool),
    );
    const id = requestId("c8-foreign-row");
    const answer = await call(planted, log, { ...AGENT, request_id: id }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-2001",
    });
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
    expect(JSON.stringify(answer)).not.toMatch(/VENDOR-77|12500|org_789/);
    // Read inside org_456: dsor_runtime reads only the company it has set (step 11's
    // README, decision 4). Step 14 names what a read returned in its record. This one
    // returned nothing, so its record names no resource and no row (step 14's README,
    // decision 7).
    const { rows } = await tryThenRollBack(
      observer,
      `SELECT "authorization", result, tenant, resources, row_count FROM dsor.audit
        WHERE correlation->>'request_id' = $1`,
      "org_456",
      [id],
    );
    expect(rows).toStrictEqual([
      {
        authorization: "ALLOW",
        result: "INTERNAL_ERROR",
        tenant: "org_456",
        resources: null,
        row_count: null,
      },
    ]);
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
