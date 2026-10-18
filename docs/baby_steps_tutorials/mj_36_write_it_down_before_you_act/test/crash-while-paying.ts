// Step 36: a program killed while the bank holds its payment. Not a test file: intents.db.test.ts
// starts it, and then looks at what it left. Crash guarantees are proved by fault injection (§47 in
// specs/dsor/06-conformance.md; step 36's README, decision D6).
// Run by the test as:  node test/crash-while-paying.ts <payment id> <idempotency key>
// It sends the payment as user_123. Its bank takes the order, prints SENT and the bank's key, and
// then the process is killed, before the bank can answer: no clean-up, nothing more written.
import { writeSync } from "node:fs";
import { createFakeBank } from "../src/bank.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import { dbRegistry, newPool } from "./db.ts";
import { keyed, SUPERVISOR } from "./helpers.ts";

const [payment, key] = process.argv.slice(2);
const pool = newPool();
const bank = createFakeBank();
const pay = bank.pay;
bank.pay = async (bankKey, order) => {
  await pay(bankKey, order);
  // writeSync, because on a pipe console.log may still be waiting when the process dies.
  writeSync(1, `SENT ${bankKey}\n`);
  // The crash: SIGKILL cannot be caught, and the bank's answer never comes back.
  process.kill(process.pid, "SIGKILL");
  return new Promise(() => {});
};
const none = undefined;
const registry = dbRegistry(
  pool,
  none,
  none,
  none,
  none,
  none,
  none,
  none,
  new Map([["fake-bank", { bank, waitMs: 5000 }]]),
);
await call(registry, createDbLog(pool), keyed(SUPERVISOR, key), "payment.execute", {
  invoice: "dsor://org_456/invoice/INV-9001",
  payment: `dsor://org_456/payment/${payment}`,
  expected_version: 1,
});
// Never reached: the bank killed the process first.
writeSync(1, "ANSWERED\n");
