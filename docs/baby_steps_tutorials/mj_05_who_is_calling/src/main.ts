// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
// The program checks every contract, then calls operations by name. NEW IN STEP 05: it
// prints one success and four refusals, each an envelope, and last the correlation of a
// call by user_123.
import { fileURLToPath } from "node:url";
import { invoiceUri, type Invoice } from "./invoice.ts";
import { handlers } from "./operations.ts";
import { buildRegistry, call, readContracts, type Registry } from "./registry.ts";
import type { RequestEnvelope } from "./request.ts";
import { parseUri } from "./uri.ts";

// Start-up checks every contract first. If one is broken, the program stops here and
// names every problem, before any caller can ask for anything.
// Another folder of contracts can be named on the command line, so a test can start the
// program with a broken one.
const CONTRACTS = process.argv[2] ?? fileURLToPath(new URL("../contracts", import.meta.url));
let registry: Registry;
try {
  registry = buildRegistry(readContracts(CONTRACTS), handlers);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
console.log("operations:", [...registry.contracts.keys()]);

// NEW IN STEP 05: every call carries a request envelope beside its arguments. This one
// holds the login token DSoR gave the agent (step 05's README, decision 2).
const AGENT: RequestEnvelope = { token: "tok_7f3a" };

// The answer is an envelope. A success carries the invoice as its data,
// and the request id DSoR made for this call.
const answer = call(registry, AGENT, "invoice.get", { id: "INV-1008" });
console.log(answer);

// The invoice's permanent address, and the address read back.
// The invoice is the answer's data. A refusal has no data.
if ("data" in answer) {
  const uri = invoiceUri(answer.data as Invoice);
  console.log(uri);
  console.log(parseUri(uri));
}

// A refusal comes back as an error envelope, never as a throw. Each one
// has a code, and the retry class the §28 table gives that code.
console.log(call(registry, AGENT, "invoice.get", { id: "INV-9999" }));
// invoice.issue has a contract but no code yet, so the call is refused.
console.log(call(registry, AGENT, "invoice.issue", { invoice: "dsor://org_456/invoice/INV-1008" }));

// NEW IN STEP 05: a call with no login token is refused before DSoR checks anything else.
console.log(call(registry, {}, "invoice.get", { id: "INV-1008" }));
// NEW IN STEP 05: the agent names the CFO in its arguments. DSoR still knows it is the
// agent, from its token, and refuses the call.
console.log(call(registry, AGENT, "invoice.get", { id: "INV-1008", principal: "cfo_100" }));
// NEW IN STEP 05: user_123 logs in with their own token, and labels the call with a request
// id of their own. The answer carries that id, and names user_123 as the caller.
const USER_123: RequestEnvelope = { token: "tok_2c91", request_id: "ap-desk-7" };
console.log(call(registry, USER_123, "invoice.get", { id: "INV-1008" }).correlation);
