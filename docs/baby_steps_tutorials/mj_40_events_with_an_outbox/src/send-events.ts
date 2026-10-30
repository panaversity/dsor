// NEW IN STEP 40: pnpm send-events. As DSoR's own login, dsor_runtime, it sends each company's
// unsent events, oldest first, to the company's own channel named in channels.json: a file of JSON
// lines in the events folder, or in the folder DSOR_EVENTS_DIR names. It exits 0 when every company
// sent all it took, 1 when a delivery or a company's run failed, and 2 when it could not send at
// all. A company that fails never stops the next. The login comes from .env and is never printed
// (DSOR-EVT-01a, DSOR-EVT-01d; step 40's README, decisions D8 and D9).
import { fileURLToPath } from "node:url";
import { checkChannels, readChannels } from "./channels.ts";
import { loadDotEnv, openPool, requireEnv } from "./postgres.ts";
import { createDbOutbox, sendEach } from "./sender.ts";

/** What the script did: 0 sent, 1 a delivery or a company's run failed, 2 not sent. */
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
  try {
    return await sendEach(createDbOutbox(pool), channels, dir, (line) => console.log(line));
  } finally {
    await pool.end();
  }
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
