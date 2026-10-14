// The program's own door, opened on a throwaway database, and two queries through it.
//
// Run with:  node scripts/door.ts
//
// This is the probe behind the README's Break-it blocks that show "as dsor_runtime" lines. It opens
// a fresh PostgreSQL on disk in a temporary folder through `openTheDatabase`, exactly as `pnpm start`
// does — migrations applied, dropped to the application's account, the start-up check passed — and
// runs the query that forgot the company, once for org_456 and once with no company said. Pass a
// folder as the first argument to open one you prepared as the owner instead, for example after
// `ALTER ROLE dsor_runtime BYPASSRLS`; the start-up check then says why it will not open it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTheDatabase } from "../src/database.ts";

const FORGOT_THE_COMPANY =
  "SELECT tenant_id FROM public.invoices WHERE id = 'INV-1008' ORDER BY tenant_id";

const given = process.argv[2];
const folder = given ?? mkdtempSync(join(tmpdir(), "dsor-door-"));

try {
  const door = await openTheDatabase(folder);

  console.log("opened a PostgreSQL on disk, as dsor_runtime");

  for (const [label, tenant] of [
    ["for org_456:     ", "org_456"],
    ["no company said: ", undefined],
  ] as const) {
    const { rows } = await door.connection.query<{ tenant_id: string }>(
      FORGOT_THE_COMPANY,
      undefined,
      tenant,
    );

    console.log(`${label} ${rows.map((r) => r.tenant_id).join(", ") || "(no rows)"}`);
  }

  await door.close();
} catch (refused) {
  console.log(`refused to start: ${(refused as Error).message}`);
} finally {
  if (given === undefined) {
    rmSync(folder, { recursive: true, force: true });
  }
}
