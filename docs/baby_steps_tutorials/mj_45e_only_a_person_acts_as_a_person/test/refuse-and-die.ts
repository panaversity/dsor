// A sender killed in the middle of a run in which one payment was refused, after
// its failed try was written and before the run's commit. Not a test file: event-tries.db.test.ts
// starts it, and then looks at what it left. A failed try is kept in the run's transaction, so the
// kill leaves none (step 40c's README, decision D8; found by its review, M3). Run by the test as:
//   node test/refuse-and-die.ts <refused payment id>
// It sends org_456's unsent events. An event about the refused payment fails; the next event, any
// other, kills the process before its delivery returns.
import { writeSync } from "node:fs";
import { createDbOutbox } from "../src/sender.ts";
import { newPool } from "./db.ts";

const [refused] = process.argv.slice(2);
await createDbOutbox(newPool()).send(
  "org_456",
  async (event) => {
    if (event.resource === `dsor://org_456/payment/${refused}`) {
      throw new Error("the accounts system answers 422: no vendor VENDOR-31");
    }
    process.kill(process.pid, "SIGKILL");
  },
  1000,
);
// Never reached: the second delivery killed the process first.
writeSync(1, "COMMITTED\n");
