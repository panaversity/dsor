// NEW IN STEP 20: fifty requests with one key, racing on a real server (decision 131).
//
// PGlite has one connection, so fifty requests sent together reach it one after another. A pool of
// twenty connections against a real PostgreSQL lets them truly race, and the claim is one INSERT:
// the primary key lets exactly one in. The step's "done when", where it can fail.
//
// Runs only under `pnpm test:db`, with DSOR_DB_URL and DSOR_DB_OWNER_URL set, like pool.db.test.ts.
//
// Rule DSOR-IDM-01b: the key MUST be claimed by an atomic insert scoped to (tenant, calling
// principal, operation, key) that stores the payload hash.

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";
import { callOperation } from "../src/operations.ts";
import { useDatabase } from "../src/store.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const PAYMENT = {
  invoice: "dsor://org_456/invoice/INV-1009",
  amount: { value: "2500.00", currency: "USD" },
};

let owner: Pool;
let application: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  application = new Pool({ connectionString: APPLICATION, max: 20 });
  useDatabase(overPool(application));
});

afterAll(async () => {
  await application?.end();
  await owner?.end();
});

/** The payments for INV-1009 in org_456, asked as the owner, saying the company as the lock asks. */
async function paymentsFor1009(): Promise<number> {
  const client = await owner.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");

    const { rows } = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.payments WHERE tenant_id = 'org_456' AND invoice = 'INV-1009'",
    );

    await client.query("COMMIT");

    return Number(rows[0]?.n);
  } finally {
    client.release();
  }
}

describe.skipIf(!haveAServer)("fifty requests with one key, on a real pool", () => {
  it("DSOR-IDM-01b: make one payment, and every answer is its receipt", async () => {
    const before = await paymentsFor1009();
    // A new key every run: the database is kept, and so are the claims of the runs before.
    const key = `fifty-${randomUUID()}`;

    const answers = await Promise.all(
      Array.from({ length: 50 }, () =>
        callOperation(AGENT, "payment.create", PAYMENT, { idempotencyKey: key }),
      ),
    );

    expect(await paymentsFor1009()).toBe(before + 1);
    expect(answers.every((a) => a.kind === "result")).toBe(true);
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
  });
});
