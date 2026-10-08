// NEW IN STEP 14: the record of a read, on a real server, as the real application login.
//
// The in-process tests prove the record is written and what it holds. Two things only a real
// database can prove: that `dsor_runtime` may write the two new columns and still may not change
// them — migration 006's GRANT is column by column, like step 09's — and that the record lands in
// the real table, inside the real chain, through a pooled connection.
//
// Rule DSOR-CLS-05: reads that return CONFIDENTIAL or RESTRICTED data MUST be audited with
// principal, actor chain, operation, resource scope, and row count.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theHead, theLog, verifyChain } from "../src/audit.ts";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner, migrationsIn } from "../src/migrations.ts";
import { callOperation } from "../src/operations.ts";
import { useDatabase } from "../src/store.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const TUTORIAL = "com.panaversity.tutorial";

let owner: Pool;
let application: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  application = new Pool({ connectionString: APPLICATION, max: 2 });
  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  useDatabase(overPool(application));
});

/** The rows as the story starts, and an empty log, as the owner. */
async function putTheStoryBack(): Promise<void> {
  await owner.query("DELETE FROM public.invoices WHERE tenant_id IN ('org_456', 'org_789')");

  for (const migration of migrationsIn(fileURLToPath(new URL("../migrations", import.meta.url)))) {
    if (migration.name === "004_running_example.sql") {
      await owner.query(migration.sql);
    }
  }

  await owner.query("DELETE FROM public.audit WHERE tenant IN ('org_456', 'org_789')");
}

beforeEach(async () => {
  if (haveAServer) {
    await putTheStoryBack();
  }
});

afterAll(async () => {
  if (haveAServer) {
    await putTheStoryBack();
  }

  await application?.end();
  await owner?.end();
});

describe.skipIf(!haveAServer)("the record of a read, against a real server", () => {
  it("DSOR-CLS-05: the supervisor's read lands in the real table, after its decision, with the row and the count", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    expect(answer.kind).toBe("data");

    const log = await theLog("org_456");

    expect(log.map((r) => r.kind)).toStrictEqual(["decision", "classified_read"]);
    expect(log[1]?.resources).toStrictEqual([INV_1008]);
    expect((log[1]?.extensions?.[TUTORIAL] as { row_count: number }).row_count).toBe(1);
    expect(verifyChain(log, await theHead("org_456"))).toBe(true);

    // As the owner, straight from the table: the columns hold what the record says.
    const { rows } = await owner.query<{ resources: string[]; extensions: Record<string, unknown> }>(
      "SELECT resources, extensions FROM public.audit WHERE tenant = 'org_456' AND kind = 'classified_read'",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.resources).toStrictEqual([INV_1008]);
  });

  it("the agent's read of the same invoice left as internal and is one record, the decision", async () => {
    await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });

    expect((await theLog("org_456")).map((r) => r.kind)).toStrictEqual(["decision"]);
  });

  it("migration 006: the application may write the two new columns and still may not change them", async () => {
    const { rows } = await owner.query<{ column: string; insert: boolean; update: boolean }>(
      `SELECT c.column_name AS "column",
              has_column_privilege('dsor_runtime', 'public.audit', c.column_name, 'INSERT') AS insert,
              has_column_privilege('dsor_runtime', 'public.audit', c.column_name, 'UPDATE') AS update
       FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'audit'
         AND c.column_name IN ('resources', 'extensions', 'recorded_at')
       ORDER BY c.column_name`,
    );

    expect(rows).toStrictEqual([
      { column: "extensions", insert: true, update: false },
      { column: "recorded_at", insert: false, update: false }, // step 09's witness, still unreachable
      { column: "resources", insert: true, update: false },
    ]);
  });
});
