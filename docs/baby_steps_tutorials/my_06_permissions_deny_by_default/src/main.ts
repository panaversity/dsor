// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
import { greet } from "./greet.ts";
// NEW IN STEP 06: the same invoice, asked for by two people, one line apart.
import { callOperation } from "./operations.ts";
import type { Login } from "./login.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

const SUPERVISOR: Login = { loggedInAs: "user_123" };
const AGENT: Login = { loggedInAs: "accounts-payable-fte" };
const CFO: Login = { loggedInAs: "cfo_100" };

function show(answer: ReturnType<typeof callOperation>): string {
  const who = answer.askedBy.padEnd(21);

  if (answer.kind === "error") {
    const e = answer.envelope;

    return `${who} ${e.code.padEnd(24)} retry: ${e.retry.padEnd(20)} ${e.message}`;
  }

  if (answer.kind === "result") {
    const r = answer.envelope;
    const invoice = r.data as { uri: string; status: string };

    return `${who} ${r.outcome.padEnd(24)} ${invoice.uri}  ${invoice.status}`;
  }

  const i = answer.invoice;

  return `${who} ${"(no envelope)".padEnd(24)} ${i.uri}  ${i.amount.value} ${i.amount.currency}  ${i.status}`;
}

console.log(greet("accounts-payable-fte"));
console.log();

// The same read, by two different callers. Switching is just a different login.
console.log(show(callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 })));
console.log(show(callOperation(AGENT, "invoice.get", { invoice: INV_1008 })));
console.log();

// The step's whole point: a principal written into the arguments is ignored.
console.log(
  show(callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008, principal: "cfo_100" })),
);
console.log();

// NEW IN STEP 06, and this is the step in four lines. The CFO reads INV-1009 and is told what
// it is. She asks to issue it and is refused. Then the agent issues the very same invoice and
// it works. Nothing about the invoice changed between those lines -- only who asked.
console.log(show(callOperation(CFO, "invoice.get", { invoice: INV_1009 })));
console.log(show(callOperation(CFO, "invoice.issue", { invoice: INV_1009 })));
console.log(show(callOperation(AGENT, "invoice.issue", { invoice: INV_1009 })));
console.log();

// And with nobody logged in, nothing is even looked at.
for (const [what, run] of [
  ["not logged in", () => callOperation(undefined, "invoice.get", { invoice: INV_1008 })],
  [
    "nobody by that name",
    () => callOperation({ loggedInAs: "nobody" }, "invoice.get", { invoice: INV_1008 }),
  ],
  [
    "logged in, bad address",
    () => callOperation(SUPERVISOR, "invoice.get", { invoice: "INV-1008" }),
  ],
  ["logged in, no contract", () => callOperation(SUPERVISOR, "execute_sql", { sql: "select 1" })],
  // Authority is settled before the address is read, so these two are the same refusal, word
  // for word -- and the caller cannot tell whether INV-9999 exists.
  ["denied, real invoice", () => callOperation(CFO, "invoice.issue", { invoice: INV_1008 })],
  [
    "denied, no such invoice",
    () => callOperation(CFO, "invoice.issue", { invoice: "dsor://org_456/invoice/INV-9999" }),
  ],
] as const) {
  console.log(`${what.padEnd(23)} ${show(run())}`);
}
