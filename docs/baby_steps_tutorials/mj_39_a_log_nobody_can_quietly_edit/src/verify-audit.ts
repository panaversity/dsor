// NEW IN STEP 39: pnpm verify-audit. It reads every chain of DSoR's log, and each chain's head, as
// the database's owner, read only, recomputes every fingerprint, and names the first broken record
// of each chain. It exits 0 when every chain is whole, 1 when one is not, and 2 when it could not
// check: a login that cannot see every record would see an empty log and call it whole (found by
// step 39's review, H1). The owner's login comes from .env and is never printed (DSOR-AUD-04b;
// step 39's README, decision D4).
import pg from "pg";
import { readChains, readHeads, verifyChains } from "./audit-chain.ts";
import { loadDotEnv, requireEnv } from "./postgres.ts";

/** What the script found: 0 whole, 1 broken, 2 not checked. */
async function check(): Promise<0 | 1 | 2> {
  loadDotEnv(["DSOR_MIGRATION_URL"]);
  const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
  const client = await owner.connect();
  try {
    await client.query("BEGIN READ ONLY");
    // The log forces row-level security, so only a login that bypasses it sees every record.
    const { rows } = await client.query<{ sees: boolean }>(
      "SELECT rolsuper OR rolbypassrls AS sees FROM pg_roles WHERE rolname = current_user",
    );
    if (rows[0]?.sees !== true) {
      console.log(
        "not checked: this login cannot see every record of the log (it needs BYPASSRLS)",
      );
      return 2;
    }
    const reports = verifyChains(await readChains(client), await readHeads(client));
    await client.query("COMMIT");
    let broken = false;
    for (const { chain, records, broken: at } of reports) {
      if (at === undefined) {
        console.log(`${chain}: whole, ${records} records`);
      } else {
        broken = true;
        const where = `place ${at.position}, record ${at.record_id ?? "?"}`;
        console.log(`${chain}: broken at ${where}: ${at.why}`);
      }
    }
    if (reports.length === 0) console.log("the log holds no record");
    // What a chain cannot see, said every time (step 39's README, claim C6).
    console.log(
      "not checked: a chain and its head rewritten from an edit on, or a new record the owner adds (step 39b)",
    );
    return broken ? 1 : 0;
  } finally {
    client.release();
    await owner.end();
  }
}

try {
  process.exitCode = await check();
} catch (error) {
  // Never the error itself: a connection error can repeat the login.
  console.log(
    `not checked: the log could not be read (${(error as { code?: string }).code ?? "error"})`,
  );
  process.exitCode = 2;
}
