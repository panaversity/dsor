// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
import { greet } from "./greet.ts";
// NEW IN STEP 03: nothing here imports getInvoice any more. Every read and every change
// goes through a named operation, and the registry refuses to load a bad contract, so a
// broken spec sheet stops this program before it prints anything at all.
import { callOperation, operationIds } from "./operations.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

const show = (invoice: ReturnType<typeof callOperation>): string =>
  invoice === undefined
    ? "not found"
    : `${invoice.uri}  ${invoice.amount.value} ${invoice.amount.currency}  ${invoice.status}`;

console.log(greet("accounts-payable-fte"));
console.log(`operations: ${operationIds().join(", ")}`);
console.log();

console.log(`invoice.get    ${show(callOperation("invoice.get", { invoice: INV_1008 }))}`);
console.log(`invoice.get    ${show(callOperation("invoice.get", { invoice: INV_1009 }))}`);
console.log();

// A command. INV-1009 is a draft, so this one is allowed.
console.log(`invoice.issue  ${show(callOperation("invoice.issue", { invoice: INV_1009 }))}`);
console.log();

// And the refusals. Each one is a TypeError today; in step 04 they become error
// envelopes with a code a caller can act on.
for (const [what, run] of [
  ["already issued", () => callOperation("invoice.issue", { invoice: INV_1008 })],
  [
    "wrong entity",
    () => callOperation("invoice.get", { invoice: "dsor://org_456/vendor/VENDOR-44" }),
  ],
  ["no contract", () => callOperation("execute_sql", { sql: "select 1" })],
] as const) {
  try {
    run();
    console.log(`refused? ${what}: it was allowed`);
  } catch (error) {
    console.log(`refused  ${what}: ${(error as Error).message}`);
  }
}
