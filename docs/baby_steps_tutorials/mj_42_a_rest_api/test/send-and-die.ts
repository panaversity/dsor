// Step 40: a sender killed after its first delivery, before it marks the event sent. Not a test
// file: outbox.db.test.ts starts it, and then looks at what it left. A delivery guarantee is proved
// by fault injection (§47 in specs/dsor/06-conformance.md; step 40's README, claim C7).
// Run by the test as:  node test/send-and-die.ts <events folder>
// It sends org_456's unsent events to <events folder>/org_456.jsonl. The first event is written to
// the file, and then the process kills itself, so the transaction that would mark it sent never
// commits.
import { writeSync } from "node:fs";
import { fileChannel } from "../src/channels.ts";
import { createDbOutbox } from "../src/sender.ts";
import { newPool } from "./db.ts";

const [dir] = process.argv.slice(2);
const deliver = fileChannel(dir!, "org_456.jsonl");
await createDbOutbox(newPool()).send("org_456", async (event) => {
  await deliver(event);
  process.kill(process.pid, "SIGKILL");
});
// Never reached: the delivery killed the process first.
writeSync(1, "MARKED\n");
