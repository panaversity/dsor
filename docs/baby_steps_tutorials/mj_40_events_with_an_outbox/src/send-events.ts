// NEW IN STEP 40: pnpm send-events. As DSoR's own login, dsor_runtime, it sends each company's
// unsent events, oldest first, to the company's own channel named in channels.json: a file of JSON
// lines in the events folder, or in the folder DSOR_EVENTS_DIR names. It exits 0 when every company
// sent all it took, 1 when a delivery failed, and 2 when it could not send. The login comes from
// .env and is never printed (DSOR-EVT-01a, DSOR-EVT-01d; step 40's README, decisions D8 and D9).
import { fileURLToPath } from "node:url";
import { checkChannels, fileChannel, readChannels } from "./channels.ts";
import { loadDotEnv, openPool, requireEnv } from "./postgres.ts";
import { createDbOutbox } from "./sender.ts";

/** What the script did: 0 sent, 1 a delivery failed, 2 not sent. */
async function sendAll(): Promise<0 | 1 | 2> {
  loadDotEnv(["DSOR_DB_URL", "DSOR_EVENTS_DIR"]);
  const { channels, problems } = checkChannels(readChannels());
  if (problems.length > 0) {
    for (const problem of problems) console.log(problem);
    console.log("not sent: channels.json is refused");
    return 2;
  }
  const named = process.env["DSOR_EVENTS_DIR"];
  const dir =
    named !== undefined && named !== ""
      ? named
      : fileURLToPath(new URL("../events/", import.meta.url));
  const pool = openPool(requireEnv("DSOR_DB_URL"));
  const outbox = createDbOutbox(pool);
  let failed = false;
  try {
    for (const [tenant, file] of channels) {
      const run = await outbox.send(tenant, fileChannel(dir, file));
      if (run.busy === true) {
        console.log(`${tenant}: another sender is at work, so this one sent nothing`);
        continue;
      }
      const n = run.sent.length;
      console.log(`${tenant}: sent ${n} event${n === 1 ? "" : "s"}`);
      if (run.failed !== undefined) {
        failed = true;
        console.log(`${tenant}: stopped at ${run.failed.event_id}: ${run.failed.why}`);
      }
    }
  } finally {
    await pool.end();
  }
  return failed ? 1 : 0;
}

try {
  process.exitCode = await sendAll();
} catch (error) {
  // Never the error itself: a connection error can repeat the login.
  console.log(
    `not sent: the outbox could not be read (${(error as { code?: string }).code ?? "error"})`,
  );
  process.exitCode = 2;
}
