// Vendors in the database: app.vendors, the accounts system's table, which DSoR reads inside the
// company's transaction and never writes (step 32's README, decision D1).
import { afterAll, describe, expect, it } from "vitest";
import { createDbInvoices, openPool } from "../src/postgres.ts";
import { NO_PRIVILEGE, RUNTIME_URL, ownerInvoices, tryThenRollBack } from "./db.ts";

const pool = openPool(RUNTIME_URL);
afterAll(async () => {
  await pool.end();
});

describe("C1: vendors come from app.vendors, inside the company (step 32's README, decision D1)", () => {
  // Its version is not pinned: each run of the test below raises it twice.
  it("DSOR-MOD-03: the store reads VENDOR-44 of org_456 from app.vendors, approved, with a current label and its version", async () => {
    const { vendor, freshness } = await createDbInvoices(pool).vendor("org_456", "VENDOR-44");
    expect(vendor).toStrictEqual({
      tenant_id: "org_456",
      id: "VENDOR-44",
      status: "approved",
      version: expect.any(Number),
    });
    expect(freshness).toMatchObject({
      mode: "current",
      connector: "postgres",
      resource_version: String(vendor!.version),
    });
  });

  it("DSOR-TEN-01b: org_789 does not see org_456's VENDOR-44, nor org_456 org_789's VENDOR-77, and no company sees none", async () => {
    const store = createDbInvoices(pool);
    expect((await store.vendor("org_789", "VENDOR-44")).vendor).toBeUndefined();
    expect((await store.vendor("org_456", "VENDOR-77")).vendor).toBeUndefined();
    const { rows } = await tryThenRollBack(pool, "SELECT count(*)::int AS n FROM app.vendors");
    expect(rows).toStrictEqual([{ n: 0 }]);
  });

  it.each([
    ["changes a status", "UPDATE app.vendors SET status = 'suspended' WHERE id = 'VENDOR-44'"],
    [
      "adds a vendor",
      "INSERT INTO app.vendors (tenant_id, id, status) VALUES ('org_456', 'VENDOR-99', 'approved')",
    ],
    ["removes one", "DELETE FROM app.vendors WHERE id = 'VENDOR-44'"],
  ])("Step 32: dsor_runtime never %s: vendors are the accounts system's", async (_what, sql) => {
    await expect(tryThenRollBack(pool, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
  });

  it("Step 32: when the accounts team suspends VENDOR-44, the next read says suspended, one version on", async () => {
    const store = createDbInvoices(pool);
    const before = (await store.vendor("org_456", "VENDOR-44")).vendor!.version;
    try {
      expect(ownerInvoices("vendor", "VENDOR-44", "suspended")).toStrictEqual({
        version: before + 1,
      });
      expect((await store.vendor("org_456", "VENDOR-44")).vendor).toMatchObject({
        status: "suspended",
        version: before + 1,
      });
    } finally {
      ownerInvoices("vendor", "VENDOR-44", "approved");
    }
    expect((await store.vendor("org_456", "VENDOR-44")).vendor).toMatchObject({
      status: "approved",
    });
  });
});
