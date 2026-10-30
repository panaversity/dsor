// Step 36b: a program killed at the COMMIT that would keep its decision record. Not a test file:
// sealed.db.test.ts starts it, and then looks at what it left. Crash guarantees are proved by
// fault injection (§47 in specs/dsor/06-conformance.md; step 36b's README, decision D4).
// Run by the test as:  node test/crash-at-the-record.ts <idempotency key> <request id>
// It drafts a payment of INV-9001 as user_123. Each query this program sends goes through a
// watcher. It marks the connection that keeps the claim's answer. Once the decision's bundle has
// been inserted, which only the decision record's write does, the next COMMIT on that marked
// connection, the claim's own, kills the process before PostgreSQL hears it. So a record written
// in a transaction of its own commits first, and is found without its work (break B2).
// A proposal's moves write rows into dsor.audit too, inside the claim, so the watcher does not
// look for those. Found while building: the first watcher did, and killed the claim on step 36's
// code; the second killed at the first COMMIT after the record, wherever it was, and B2 passed. So the record was written and never committed. What else was
// committed by then, the test finds out.
import { writeSync } from "node:fs";
import pg from "pg";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import { dbRegistry, newPool } from "./db.ts";
import { SUPERVISOR } from "./helpers.ts";

const [key, request] = process.argv.slice(2);
const query = pg.Client.prototype.query;
let recorded = false;
const claims = new WeakSet<object>();
// The watcher: a query's text is its first argument, or that argument's text field.
pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
  const first = args[0] as string | { text?: string } | undefined;
  const text = typeof first === "string" ? first : first?.text;
  if (typeof text === "string" && text.includes("UPDATE dsor.idempotency SET answer")) {
    claims.add(this);
  }
  if (typeof text === "string" && text.includes("INSERT INTO dsor.decision_bundles")) {
    recorded = true;
  } else if (recorded && text === "COMMIT" && claims.has(this)) {
    writeSync(1, "KILLED AT COMMIT\n");
    process.kill(process.pid, "SIGKILL");
  }
  return (query as (...a: unknown[]) => unknown).apply(this, args);
} as typeof query;

const pool = newPool();
await call(
  dbRegistry(pool),
  createDbLog(pool),
  { ...SUPERVISOR, idempotency_key: key, request_id: request },
  "payment.create",
  { invoice: "dsor://org_456/invoice/INV-9001", expected_version: 1 },
);
// Never reached: the watcher killed the process first.
writeSync(1, "ANSWERED\n");
