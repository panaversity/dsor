// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
import { greet } from "./greet.ts";
// STEP 06: the same invoice, asked for by two people, one line apart.
import { callOperation } from "./operations.ts";
import { countedWithoutARecord, theHead, theLog, verifyChain } from "./audit.ts";
import type { Freshness } from "./freshness.ts";
import type { Login } from "./login.ts";
import { openTheDatabase } from "./database.ts";
import { movedTo } from "./examples.ts";
import { contractsFromDisk, exampleRequestOf, loadRegistry } from "./registry.ts";
import { paymentsOf } from "./payment.ts";
import { aDirectory, useDirectory } from "./directory.ts";
import { activeSlipFor } from "./delegation.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

const THEIR_INV_1008 = "dsor://org_789/invoice/INV-1008";

const SUPERVISOR: Login = { loggedInAs: "user_123" };
// STEP 10: the agent works for two companies, so it says which one it is working for.
const AGENT: Login = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const AGENT_FOR_789: Login = { loggedInAs: "accounts-payable-fte", tenant: "org_789" };
const AGENT_UNSAID: Login = { loggedInAs: "accounts-payable-fte" };
const CFO: Login = { loggedInAs: "cfo_100" };

// STEP 14: what the door took out, if anything, on a line of its own under the answer.
// Under it and not beside it, because a review measured the one-line version at 135 columns: on a
// default Windows console the note wrapped away from the row it belongs to.
function withheld(redactions: readonly { field: string; reason: string }[] | undefined): string {
  return redactions === undefined || redactions.length === 0
    ? ""
    : `\n${" ".repeat(24)}withheld: ${redactions.map((r) => `${r.field} (${r.reason})`).join(", ")}`;
}

// STEP 15: how old a read is, on a line of its own under it: the mode, when, from where.
function howOld(freshness: Freshness): string {
  return `\n${" ".repeat(24)}${freshness.mode}, read at ${freshness.observed_at} from ${freshness.connector}`;
}

function show(answer: Awaited<ReturnType<typeof callOperation>>): string {
  const who = answer.askedBy.padEnd(21);

  if (answer.kind === "error") {
    const e = answer.envelope;

    return `${who} ${e.code.padEnd(24)} retry: ${e.retry.padEnd(20)} ${e.message}`;
  }

  if (answer.kind === "result") {
    const r = answer.envelope;
    // STEP 17: an invoice's receipt or a payment's: an address and a status either way.
    const row = r.data as { uri: string; status: string };

    // STEP 17: and whether its effect can be undone, which every receipt says now.
    return `${who} ${r.outcome.padEnd(24)} ${row.uri}  ${row.status.padEnd(9)}  ${r.semantics}${withheld(r.redactions)}`;
  }

  if (answer.kind === "page") {
    const p = answer.page;

    return `${who} ${`(a page, ${answer.classification})`.padEnd(24)} ${p.invoices.length} invoices${p.next === undefined ? ", the last page" : `, next after ${p.next}`}${withheld(answer.redactions)}${howOld(answer.freshness)}`;
  }

  const i = answer.invoice;

  // Padded, so that `issued` lines up whether the amount is there or withheld.
  const amount = (
    i.amount === undefined ? "(amount withheld)" : `${i.amount.value} ${i.amount.currency}`
  ).padEnd(17);

  // STEP 14: the answer's own label where "(no envelope)" used to be — a query's success
  // still has no envelope, and now it says how sensitive what it holds is.
  return `${who} ${`(${answer.classification})`.padEnd(24)} ${i.uri}  ${amount}  ${i.status}${withheld(answer.redactions)}${howOld(answer.freshness)}`;
}

const database = await openTheDatabase();

console.log(greet("accounts-payable-fte"));
// STEP 16: and the log is DSoR's own, in its own schema, not among the business's tables.
console.log(`The audit log is dsor.audit, in DSoR's own schema, in ${database.where}.`);
console.log();

// The same read, by two different callers. Switching is just a different login.
// STEP 14, and this is the step: the two lines are no longer the same. The supervisor's
// carries the amount and the label `confidential`; the agent's has the amount taken out, is
// labelled `internal` — the highest label among what is left — and says what was withheld and
// why. The agent is cleared for `internal`, and the amount of an invoice is confidential
// (src/classification.ts). The agent's answers go to a model provider; the amount does not.
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

// STEP 13, and this is the step. The first query that returns many rows, and the size of
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

// STEP 17, and this is the step. Every command says, in its contract and on every receipt,
// whether its effect can be undone. A payment is made as a draft, and a draft can be taken back:
// payment.create names payment.cancel as what undoes it. The agent makes a second payment for
// INV-1008 by mistake, though INV-1008 has PAY-901 already, and takes it back. Step 20 stops the
// duplicate before it is made; until then, a mistake that can be undone is one that can be put right.
console.log();
console.log("Can it be undone? Every command says so in its contract:");
console.log();

for (const contract of loadRegistry(contractsFromDisk()).values()) {
  if (contract.kind === "command") {
    const undo = contract.execution?.compensated_by;

    console.log(
      `  ${contract.id.padEnd(15)} ${contract.execution?.semantics}${undo === undefined ? "" : `, undone by ${undo.join(", ")}`}`,
    );
  }
}

console.log();
console.log("And on every receipt:");
console.log();

const twice = await callOperation(AGENT, "payment.create", {
  invoice: INV_1008,
  amount: { value: "31400.00", currency: "USD" },
});

console.log(show(twice));

if (twice.kind === "result") {
  const mistake = String(twice.envelope.data?.["uri"]);

  console.log(show(await callOperation(AGENT, "payment.cancel", { payment: mistake })));
  // And a second cancel is refused: payment.cancel changes only a draft.
  console.log(show(await callOperation(AGENT, "payment.cancel", { payment: mistake })));
}

console.log();
console.log("org_456's payments, as the database holds them now:");
console.log();

for (const payment of await paymentsOf("org_456")) {
  const amount = `${payment.amount.value} ${payment.amount.currency}`;

  console.log(
    `  ${payment.id}  ${payment.status.padEnd(9)}  ${amount.padEnd(13)}  pays ${payment.invoice} to ${payment.vendor}`,
  );
}

// STEP 18, and this is the step. Every command the agent sent above ran under a permission
// slip, del_100, which user_123 signed: DSoR found it, and worked out what the agent may do from it
// at each decision. Two more requests show the two halves of that: above the slip's limit is
// refused, and when user_123 loses a permission, the agent loses it on the very next request,
// with nothing in the slip changed. STEP 19: the company's directory says so, the fake one
// in `directory.ts`, which the demo may change as a test may.
console.log();
console.log("Under whose authority? The agent's commands run under a permission slip:");
console.log();

const found = await activeSlipFor("org_456", "accounts-payable-fte");

if (found.kind === "one") {
  const slip = found.slip;
  const limit = slip.perTransactionLimit;

  console.log(
    `  ${slip.id}  ${slip.delegator} for ${slip.delegate}: ${slip.permissions.join(", ")}`,
  );
  console.log(
    `  ${" ".repeat(slip.id.length)}  up to ${limit === undefined ? "any amount" : `${limit.value} ${limit.currency}`} a payment, until ${slip.expiresAt?.slice(0, 10) ?? "a time this program cannot read"}`,
  );
}

console.log();
console.log(
  show(
    await callOperation(AGENT, "payment.create", {
      invoice: INV_1009,
      amount: { value: "60000.00", currency: "USD" },
    }),
  ),
);
console.log();
console.log("user_123 moves to another team, and no longer holds payment:create:");
console.log();

// STEP 19: the company's directory says so; step 18 played its part through a seam.
useDirectory(
  "org_456",
  aDirectory("org_456", {
    holds: { user_123: ["invoice:read", "invoice:issue", "payment:cancel"] },
  }),
);

console.log(
  show(
    await callOperation(AGENT, "payment.create", {
      invoice: INV_1009,
      amount: { value: "2500.00", currency: "USD" },
    }),
  ),
);

useDirectory("org_456", undefined);

// STEP 19: at 2 a.m. nobody is logged in. The agent's first command under del_100 was
// user_123's authority, used by the agent, and the log says exactly that. Then two requests, each
// one decision: the company's directory switched off, and then answering with what it knew 25 hours
// ago. Both refused, not waved through (DSOR-DEL-08, DSOR-IDN-06, decision 129).
console.log();
console.log("At 2 a.m. nobody is logged in. Whose authority did the agent use?");
console.log();

const unattended = (await theLog("org_456")).find(
  (record) => record.kind === "decision" && record.identity.mode === "unattended",
);

if (unattended !== undefined) {
  const { identity } = unattended;
  const operation = unattended.operation ?? "(none resolved)";

  console.log(
    `  ${operation}  ${identity.mode}: ${identity.subject}'s authority, used by ${identity.actor_chain.join(", ")} under ${unattended.delegation ?? "no slip"}`,
  );
  console.log(
    `  ${" ".repeat(operation.length)}  what ${identity.subject} holds, from the company's directory as of ${identity.subject_authority.as_of}`,
  );
}

const aSmallPayment = {
  invoice: INV_1009,
  amount: { value: "2500.00", currency: "USD" },
};

console.log();
console.log("The company's directory is switched off:");
console.log();
useDirectory("org_456", aDirectory("org_456", { down: true }));
console.log(show(await callOperation(AGENT, "payment.create", aSmallPayment)));
console.log();
console.log("It answers again, with what it knew 25 hours ago:");
console.log();
useDirectory(
  "org_456",
  aDirectory("org_456", { asOf: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }),
);
console.log(show(await callOperation(AGENT, "payment.create", aSmallPayment)));
useDirectory("org_456", undefined);

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
    // STEP 14: a read that handed out confidential data is a record of its own, after the
    // decision that allowed it: `read` where a decision says ALLOW or DENY, and how many rows left.
    const rows = record.row_count;
    const isARead = record.kind === "classified_read";

    console.log(
      [
        String(record.sequence).padStart(2),
        (record.authorization ?? (isARead ? "read" : "-")).padEnd(5),
        (record.operation ?? "(none resolved)").padEnd(19),
        record.identity.subject.padEnd(21),
        (isARead
          ? `${record.result}, ${rows} ${rows === 1 ? "row" : "rows"}`
          : record.result
        ).padEnd(22),
        `${record.record_hash.slice(0, 14)}...`,
        // STEP 19: an unattended record's subject is the slip's signer, so the line says who
        // acted, and under which slip (decision 129).
        ...(record.identity.mode === "unattended"
          ? [
              `unattended: by ${record.identity.actor_chain.join(", ")} under ${record.delegation ?? "no slip"}`,
            ]
          : []),
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
