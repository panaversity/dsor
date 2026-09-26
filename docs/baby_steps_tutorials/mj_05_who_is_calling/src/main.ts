// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
// The program checks every contract, then calls operations by name. Every answer it
// prints is an envelope: one success, then two refusals.
import { fileURLToPath } from "node:url";
import { invoiceUri, type Invoice } from "./invoice.ts";
import { handlers } from "./operations.ts";
import { buildRegistry, call, readContracts, type Registry } from "./registry.ts";
import { parseUri } from "./uri.ts";

// Start-up checks every contract first. If one is broken, the program stops here and
// names every problem, before any caller can ask for anything.
const CONTRACTS = fileURLToPath(new URL("../contracts", import.meta.url));
let registry: Registry;
try {
  registry = buildRegistry(readContracts(CONTRACTS), handlers);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
console.log("operations:", [...registry.contracts.keys()]);

// NEW IN STEP 04: the answer is an envelope. A success carries the invoice as its data,
// and the request id DSoR made for this call.
const answer = call(registry, "invoice.get", { id: "INV-1008" });
console.log(answer);

// The invoice's permanent address, and the address read back.
// NEW IN STEP 04: the invoice is the answer's data. A refusal has no data.
if ("data" in answer) {
  const uri = invoiceUri(answer.data as Invoice);
  console.log(uri);
  console.log(parseUri(uri));
}

// NEW IN STEP 04: a refusal comes back as an error envelope, never as a throw. Each one
// has a code, and the retry class the §28 table gives that code.
console.log(call(registry, "invoice.get", { id: "INV-9999" }));
// invoice.issue has a contract but no code yet, so the call is refused.
console.log(call(registry, "invoice.issue", { invoice: "dsor://org_456/invoice/INV-1008" }));
