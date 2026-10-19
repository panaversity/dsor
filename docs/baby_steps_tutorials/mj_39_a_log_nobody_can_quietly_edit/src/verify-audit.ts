// NEW IN STEP 39: pnpm verify-audit. It reads every chain of DSoR's log as the database's owner,
// read only, recomputes every fingerprint, and names the first broken record of each chain. It
// exits 0 when every chain is whole, and 1 when one is not. The owner's login comes from .env and
// is never printed (DSOR-AUD-04b; step 39's README, decision D4).
import pg from "pg";
import { readChains, verifyChains } from "./audit-chain.ts";
import { loadDotEnv, requireEnv } from "./postgres.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
const client = await owner.connect();
let broken = false;
try {
  await client.query("BEGIN READ ONLY");
  const reports = verifyChains(await readChains(client));
  await client.query("COMMIT");
  for (const { chain, records, broken: at } of reports) {
    if (at === undefined) {
      console.log(`${chain}: whole, ${records} records`);
    } else {
      broken = true;
      console.log(
        `${chain}: broken at place ${at.position}, record ${at.record_id ?? "?"}: ${at.why}`,
      );
    }
  }
  if (reports.length === 0) console.log("the log holds no record");
  // What a chain cannot see, said every time (step 39's README, claim C6).
  console.log(
    "not checked: a chain rewritten from an edit on, or its newest records removed (step 39b)",
  );
} finally {
  client.release();
  await owner.end();
}
process.exitCode = broken ? 1 : 0;
