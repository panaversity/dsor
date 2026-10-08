// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
import { greet } from "./greet.ts";
// STEP 06: the same invoice, asked for by two people, one line apart.
import { callOperation } from "./operations.ts";
import { countedWithoutARecord, theHead, theLog, verifyChain } from "./audit.ts";
import type { Login } from "./login.ts";
import { openTheDatabase } from "./database.ts";
import { movedTo } from "./examples.ts";
import { contractsFromDisk, exampleRequestOf, loadRegistry } from "./registry.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

const THEIR_INV_1008 = "dsor://org_789/invoice/INV-1008";

const SUPERVISOR: Login = { loggedInAs: "user_123" };
// STEP 10: the agent works for two companies, so it says which one it is working for.
const AGENT: Login = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const AGENT_FOR_789: Login = { loggedInAs: "accounts-payable-fte", tenant: "org_789" };
const AGENT_UNSAID: Login = { loggedInAs: "accounts-payable-fte" };
const CFO: Login = { loggedInAs: "cfo_100" };

function show(answer: Awaited<ReturnType<typeof callOperation>>): string {
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

  if (answer.kind === "page") {
    const p = answer.page;

    return `${who} ${"(a page)".padEnd(24)} ${p.invoices.length} invoices${p.next === undefined ? ", the last page" : `, next after ${p.next}`}`;
  }

  const i = answer.invoice;

  return `${who} ${"(no envelope)".padEnd(24)} ${i.uri}  ${i.amount.value} ${i.amount.currency}  ${i.status}`;
}

const database = await openTheDatabase();

console.log(greet("accounts-payable-fte"));
console.log(`The audit log is in ${database.where}.`);
console.log();

// The same read, by two different callers. Switching is just a different login.
console.log(show(await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 })));
console.log(show(await callOperation(AGENT, "invoice.get", { invoice: INV_1008 })));
console.log();

// Step 05's point was that a principal written into the arguments is ignored. STEP 10: one
// that is NOT you is refused — DSOR-SRC-02b — and recorded as the DENY it is; one that is you still
// changes nothing.
console.log(
  show(await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008, principal: "cfo_100" })),
);
console.log();

// STEP 06, and this is the step in four lines. The CFO reads INV-1009 and is told what
// it is. She asks to issue it and is refused. Then the agent issues the very same invoice and
// it works. Nothing about the invoice changed between those lines -- only who asked.
console.log(show(await callOperation(CFO, "invoice.get", { invoice: INV_1009 })));
console.log(show(await callOperation(CFO, "invoice.issue", { invoice: INV_1009 })));
console.log(show(await callOperation(AGENT, "invoice.issue", { invoice: INV_1009 })));
console.log();

// And with nobody logged in, nothing is even looked at.
for (const [what, run] of [
  [
    "not logged in",
    async () => await callOperation(undefined, "invoice.get", { invoice: INV_1008 }),
  ],
  [
    "nobody by that name",
    async () => await callOperation({ loggedInAs: "nobody" }, "invoice.get", { invoice: INV_1008 }),
  ],
  [
    "logged in, bad address",
    async () => await callOperation(SUPERVISOR, "invoice.get", { invoice: "INV-1008" }),
  ],
  [
    "logged in, no contract",
    async () => await callOperation(SUPERVISOR, "execute_sql", { sql: "select 1" }),
  ],
  // Authority is settled before the address is read, so these two are the same refusal, word
  // for word -- and the caller cannot tell whether INV-9999 exists.
  [
    "denied, real invoice",
    async () => await callOperation(CFO, "invoice.issue", { invoice: INV_1008 }),
  ],
  [
    "denied, no such invoice",
    async () =>
      await callOperation(CFO, "invoice.issue", { invoice: "dsor://org_456/invoice/INV-9999" }),
  ],
] as const) {
  console.log(`${what.padEnd(23)} ${show(await run())}`);
}

// STEP 10, and this is the step. A second company, org_789, shares this program and this
// database. It has an INV-1008 of its own — the same number as org_456's, a different invoice — and
// the agent works for both companies, so every request it makes says which one it is working for.
console.log();
console.log("Two companies, one program:");
console.log();
console.log(show(await callOperation(AGENT, "invoice.get", { invoice: INV_1008 })));
console.log(show(await callOperation(AGENT_FOR_789, "invoice.get", { invoice: THEIR_INV_1008 })));
console.log();

// The three ways a request can fail to be inside one company, and what each is told.
//
// The agent that did not say which employer is refused before anything is looked at. user_123, who
// belongs to one company, is refused org_789's address — and org_000's, which does not exist, with
// the same words: the refusal echoes the address and says nothing else, not which company this is,
// not whether that one is real. And naming a company in the login that is not yours is refused too.
for (const [what, run] of [
  [
    "agent, company unsaid",
    async () => await callOperation(AGENT_UNSAID, "invoice.get", { invoice: INV_1008 }),
  ],
  [
    "their address, real",
    async () => await callOperation(SUPERVISOR, "invoice.get", { invoice: THEIR_INV_1008 }),
  ],
  [
    "their address, no such co",
    async () =>
      await callOperation(SUPERVISOR, "invoice.get", {
        invoice: "dsor://org_000/invoice/INV-1008",
      }),
  ],
  [
    "login names their company",
    async () =>
      await callOperation({ loggedInAs: "user_123", tenant: "org_789" }, "invoice.get", {
        invoice: THEIR_INV_1008,
      }),
  ],
] as const) {
  console.log(`${what.padEnd(26)} ${show(await run())}`);
}

// STEP 11, and this is the step. The query step 10 could not survive: an invoice number and
// no company. Step 10's lock is the WHERE the stores write, and this query has not got one. Run
// through the program's own connection, which is `dsor_runtime` under the policies of migration
// 005, it gets the company the statement said — and with none said, it gets nothing. Both answers
// are PostgreSQL's, not this program's, which is the point: the lock holds for the query somebody
// writes next year.
const FORGOT_THE_COMPANY =
  "SELECT tenant_id, id, amount_value::text AS amount, status FROM public.invoices WHERE id = $1";
interface Seen {
  tenant_id: string;
  id: string;
  amount: string;
  status: string;
}
const asLines = (rows: Seen[]): string =>
  rows.length === 0
    ? "(no rows)"
    : rows
        .map((r) => `${r.tenant_id}  ${r.id}  ${r.amount}  ${r.status}`)
        .join("\n" + " ".repeat(20));

console.log();
console.log("A forgotten WHERE, caught by the second lock:");
console.log();
console.log(`  ${FORGOT_THE_COMPANY}`);
console.log(
  `  for org_456:      ${asLines((await database.connection.query<Seen>(FORGOT_THE_COMPANY, ["INV-1008"], "org_456")).rows)}`,
);
console.log(
  `  no company said:  ${asLines((await database.connection.query<Seen>(FORGOT_THE_COMPANY, ["INV-1008"])).rows)}`,
);

// STEP 12, and this is the step. Every operation the registry holds, called with another
// company's address — not the two named here by hand, but whatever the registry says, from the
// example request each contract carries with every address in it moved to org_789. Add an
// operation and this loop grows by one line, and test/support/cross-tenant-suite.ts grows by six
// questions, without anyone editing either.
console.log();
console.log("Every operation, with another company's address:");
console.log();

for (const [id, contract] of loadRegistry(contractsFromDisk())) {
  const example = exampleRequestOf(contract);
  const theirs =
    example === undefined
      ? undefined
      : (movedTo(example, "org_456", "org_789") as Record<string, unknown>);

  console.log(
    `${id.padEnd(14)} ${theirs === undefined ? "(no example request in its contract)" : show(await callOperation(SUPERVISOR, id, theirs))}`,
  );
}

// NEW IN STEP 13, and this is the step. The first query that returns many rows, and the size of
// the answer is the server's. One invoice a page, so the page and its cursor can be seen on two
// invoices; then the cursor sent back; then a request for a million, which gets one page. With two
// invoices the page holds both, so the ceiling of a hundred is not visible here — the tests seed
// three hundred and watch it bite. What is visible is that the caller's number did not decide.
console.log();
console.log("A list, one page at a time, and the ceiling:");
console.log();

const firstPage = await callOperation(SUPERVISOR, "invoice.list", { limit: 1 });

console.log(`${"limit 1".padEnd(23)} ${show(firstPage)}`);

if (firstPage.kind === "page" && firstPage.page.next !== undefined) {
  console.log(
    `${"after the first".padEnd(23)} ${show(await callOperation(SUPERVISOR, "invoice.list", { after: firstPage.page.next, limit: 1 }))}`,
  );
}

// The label is built from the request it describes, so the two cannot drift apart: a review
// changed the million to a two and the line still read "limit 1,000,000".
const million = { limit: 1_000_000 };

console.log(
  `${`limit ${million.limit.toLocaleString("en-US")}`.padEnd(23)} ${show(await callOperation(SUPERVISOR, "invoice.list", million))}`,
);

// STEP 08: everything above already happened; this is what was written down while it did. Read the
// `authorization` column: the DENY lines are the ones a program that logged only its successes would
// have lost, and they are the most interesting lines here.
//
// STEP 10: one chain per company. org_789's log holds org_789's decisions and nothing of
// org_456's — and the agent's request that never said which employer is in BOTH, because both
// employers should know. `previous_hash` is the record before it in the same chain; change any line
// and every hash after it in that chain stops agreeing.
for (const company of ["org_456", "org_789"]) {
  console.log();
  console.log(`The audit log of ${company}:`);
  console.log();

  for (const record of await theLog(company)) {
    console.log(
      [
        String(record.sequence).padStart(2),
        (record.authorization ?? "-").padEnd(5),
        (record.operation ?? "(none resolved)").padEnd(19),
        record.identity.subject.padEnd(21),
        record.result.padEnd(22),
        `${record.record_hash.slice(0, 14)}...`,
      ].join("  "),
    );
  }

  const log = await theLog(company);

  console.log(
    `${company}: ${log.length} records, chain verifies against the head: ${verifyChain(log, await theHead(company))}`,
  );
}

console.log();
// Hash chaining proves no record was *edited*. It cannot prove none was *deleted from the end* — drop
// the last record and every link still holds, there is simply less of it. A checkpoint is what
// notices, and §30 names checkpoints beside hash chaining for exactly that.
//
// Be careful what the second line below demonstrates, because I claimed more than it shows. The log is
// read ONCE, into `whole`, and `tampered` is a copy of it with the last record removed. So this
// catches a shortened log you are **holding**, and that is all. A row deleted from the **table** moves
// `theHead("org_456")` with it, because `theHead("org_456")` is a query over that same table, and then the two agree
// again. §30 says the answer and says it as a SHOULD: anchor a checkpoint outside the store. This step
// has nowhere outside to put one, which is why `DSOR-AUD-04d` is not claimed.
const whole = await theLog("org_456");
const head = await theHead("org_456");
const tampered = whole.slice(0, whole.length - 1);

console.log(
  `drop one from the copy we are holding: the chain alone still says ${verifyChain(tampered)}, ` +
    `and against the head ${verifyChain(tampered, head)}`,
);
console.log(
  `${countedWithoutARecord()} refusals counted without a record, because nobody was logged in or nobody belonged to a company`,
);

await database.close();
