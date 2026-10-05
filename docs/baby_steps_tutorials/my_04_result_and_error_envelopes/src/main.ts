// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
import { greet } from "./greet.ts";
import { callOperation, operationIds } from "./operations.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

// NEW IN STEP 04: one place that reads an answer, because every answer now has a shape.
// A refusal says its code and whether a retry could help. A command's success says what
// it committed. A read hands back the invoice, which is the one case with no envelope.
function show(answer: ReturnType<typeof callOperation>): string {
  if (answer.kind === "error") {
    const e = answer.envelope;

    return `${e.code.padEnd(24)} retry: ${e.retry.padEnd(20)} ${e.message}`;
  }

  if (answer.kind === "result") {
    const r = answer.envelope;
    const invoice = r.data as { uri: string; status: string };

    return `${r.outcome.padEnd(24)} ${invoice.uri}  ${invoice.status}\n${" ".repeat(25)}proposal ${r.proposal}\n${" ".repeat(25)}payload  ${r.payload_hash.slice(0, 23)}…`;
  }

  return `${"(no envelope)".padEnd(24)} ${answer.invoice.uri}  ${answer.invoice.amount.value} ${answer.invoice.amount.currency}  ${answer.invoice.status}`;
}

console.log(greet("accounts-payable-fte"));
console.log(`operations: ${operationIds().join(", ")}`);
console.log();

console.log(show(callOperation("invoice.get", { invoice: INV_1008 })));
console.log(show(callOperation("invoice.get", { invoice: INV_1009 })));
console.log();

// The command, and then the same command again.
console.log(show(callOperation("invoice.issue", { invoice: INV_1009 })));
console.log(show(callOperation("invoice.issue", { invoice: INV_1009 })));
console.log();

// Every other way of being refused, each with the code a caller can act on.
for (const [id, args] of [
  ["invoice.get", { invoice: "dsor://org_456/invoice/INV-9999" }],
  ["invoice.get", { invoice: "dsor://org_999/invoice/INV-1008" }],
  ["invoice.get", { invoice: "dsor://org_456/vendor/VENDOR-44" }],
  ["invoice.get", { invoice: "INV-1008" }],
  ["execute_sql", { sql: "select 1" }],
] as const) {
  console.log(show(callOperation(id, args)));
}
