// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
// The program checks every contract, and the role table, then calls operations by name.
// It prints one success and five refusals, each an envelope, and the correlation of a call
// by user_123. NEW IN STEP 07: start-up checks each operation's input schema too, and a
// sixth refusal shows line ⑥ of the checklist refusing a bad input.
import { fileURLToPath } from "node:url";
import { invoiceUri, type Invoice } from "./invoice.ts";
import { handlers } from "./operations.ts";
import { readRoles } from "./permissions.ts";
import { call } from "./pipeline.ts";
import { readInputs } from "./inputs.ts";
import { buildRegistry, readContracts, type Registry } from "./registry.ts";
import type { RequestEnvelope } from "./request.ts";
import { parseUri } from "./uri.ts";

// Start-up checks every contract first. If one is broken, the program stops here and
// names every problem, before any caller can ask for anything.
// Another folder of contracts can be named on the command line, so a test can start the
// program with a broken one.
const CONTRACTS = process.argv[2] ?? fileURLToPath(new URL("../contracts", import.meta.url));
// Start-up checks the role table too (step 06's README, decision 1). A role table can be
// named after the contracts folder, so a test can start with a broken one.
const ROLES = process.argv[3] ?? fileURLToPath(new URL("../roles.json", import.meta.url));
// NEW IN STEP 07: start-up checks the input schemas too. A folder of them can be named after
// the role table, so a test can start without one. With none named, the step's own is read.
const INPUTS: string | undefined = process.argv[4];
let registry: Registry;
try {
  registry = buildRegistry(
    readContracts(CONTRACTS),
    handlers,
    readRoles(ROLES),
    readInputs(INPUTS),
  );
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
console.log("operations:", [...registry.contracts.keys()]);

// Every call carries a request envelope beside its arguments. This one
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
// The agent's role grants invoice:read and not invoice:issue. NEW IN STEP 07: so this call
// is denied at line ⑤, before DSoR looks at the input or asks whether it is built.
console.log(call(registry, AGENT, "invoice.issue", { invoice: "dsor://org_456/invoice/INV-1008" }));

// A call with no login token is refused before DSoR checks anything else.
console.log(call(registry, {}, "invoice.get", { id: "INV-1008" }));
// The agent names the CFO in its arguments. DSoR still knows it is the
// agent, from its token, and refuses the call.
console.log(call(registry, AGENT, "invoice.get", { id: "INV-1008", principal: "cfo_100" }));
// user_123 logs in with their own token, and labels the call with a request
// id of their own. The answer carries that id, and names user_123 as the caller.
const USER_123: RequestEnvelope = { token: "tok_2c91", request_id: "ap-desk-7" };
console.log(call(registry, USER_123, "invoice.get", { id: "INV-1008" }).correlation);
// user_123 holds invoice:issue. NEW IN STEP 07: so the same call passes lines ①, ⑤, and ⑥.
// It is refused after them: invoice.issue has a contract but no code yet.
console.log(
  call(registry, USER_123, "invoice.issue", { invoice: "dsor://org_456/invoice/INV-1008" }),
);
// NEW IN STEP 07: user_123 sends an id where invoice.issue needs a canonical URI. Line ⑥
// refuses it, before DSoR asks whether invoice.issue is built.
console.log(call(registry, USER_123, "invoice.issue", { invoice: "INV-1008" }));
