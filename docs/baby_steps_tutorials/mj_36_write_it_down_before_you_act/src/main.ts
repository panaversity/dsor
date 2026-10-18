// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
// The program checks every contract, the role table, the input schemas, the labels, and
// the map of its own store. Then it checks the database against the map, and calls
// operations by name. The agent reads INV-1008 and gets it without its amounts,
// with a list of what was left out and a label. cfo_100, a person, reads the same invoice
// whole. Then it prints the invoice's URI, six refusals, each an envelope, and the
// correlation of a call by user_123. Then the firm's agent reads INV-1008 in each of its
// two companies, without amounts, and two calls cross from one company into another and
// are refused. Then the agent asks invoice.list for a million invoices, and gets ten, a
// note that its limit was cut, and a cursor. Then user_123 drafts a payment
// for INV-1008 and cancels it twice. Then the agent drafts one too, under
// del_100, user_123's permission slip. Then the night. The agent drafts
// again, and its record says that user_123's authority came from her company's directory,
// and as of when. The directory moves her to ap_clerk and back, and goes off, and DSoR
// restarts while it is off. Since step 20 every command carries an idempotency key: the agent's
// answer for INV-1009 is lost, and its retry with the same key hears the same draft; the same
// key for INV-1008 is refused; and after the restart, user_123's retry of her first draft hears
// the answer DSoR recorded. Since step 22 every command's answer names its proposal: the program
// shows user_123's draft's proposal with its four moves, and the FAILED proposal of a refused
// cancel. Since step 23 a command can be called three ways: the agent's dry run answers VALIDATED
// and writes nothing, its draft prepared in propose_only mode waits READY, the same key sent to
// execute is refused, and as ap_clerk it may still prepare. Since step 24, the day's limit, told
// in memory after the changed payee: seven drafts at once, six made and one refused, and a dry run
// of an eighth refused too. Since step 25, the tear-up of del_100, in memory, and since step 25b,
// the emergency brake, in memory. The tear-up cancels the agent's prepared draft
// too, and a prepared draft that nobody releases expires after its company's lifetime, when
// dsor-scheduler sweeps, in memory with a clock of its own. Then the suspension, in memory: the
// directory suspends her, and
// DSoR suspends both her slips. Since step 26, money in two currencies, in memory: dsor-rates
// loads Tuesday's sheet, the agent drafts bills in euros, pounds, and rupees, and on Saturday the
// sheet is too old. Since step 27, the company's rule, in memory: payments above 25,000 USD wait
// for the CFO, a bill in yen that no sheet lists waits too, a dry run says so, and a week later the
// sweep expires the waiting payments. Since step 28, start-up checks the rules in dsor.controls
// too, and who may switch a rule on, in memory: cfo_100, the rule's owner, drafts version 9, and
// admin_100 drafts version 10 and cannot switch it on; the agent cannot either; a version with the
// quick rule fails its test; cfo_100 switches version 9 on, suspends it, and switches it on again,
// and each change applies to the next payment. Since step 28b, where a rule came from, in memory
// with a stand-in for KSoR: the finance team publishes version 5 of the payment-approval policy,
// dsor-scheduler's sweep marks version 8 stale and leaves cfo_100 a notice, every payment waits
// for the CFO until cfo_100 switches on a version that cites version 5, and a version that still
// cites version 4 cannot be switched on. Since step 29, approvals, in memory: the agent, and
// admin_100, whom the rule does not ask, cannot approve INV-1008's 31,400.00 USD; cfo_100 cannot
// with another request's fingerprint, and can with its own; and with a second rule on, INV-2012
// waits for the CFO and a tenant administrator both. Since step 30, who may not approve, in
// memory: with a third rule on, an AP supervisor approves payments above 10,000 USD. user_123, an
// AP supervisor, may not approve the agent's INV-1012, since user_123 signed del_100, nor INV-2013,
// which user_123 asked for; cfo_100 is not an AP supervisor; and the agent approves nothing. Since
// step 31, the release, in memory, in a world of its own: the agent releases INV-1008, which cfo_100
// approved, and it is paid; cfo_100 switches on a version of the CFO's rule that asks for two CFOs,
// and INV-2012's release is invalidated, its booking back; a release that sends another invoice is
// refused; and user_123 releases a payment the agent prepared. Then it prints the log: the records
// it can read,
// one company at a time, and how many it cannot read. Last, it shows that a log which
// cannot take a record turns a "yes" into a refusal. Found by the Stage 2 review: this
// header described step 13's program, and left out the masking and cfo_100's read.
// The log and the invoices are tables in the database named by
// DSOR_DB_URL, in this step's .env. Run `pnpm migrate` once first.
import { createFakeBank, type FakeBank } from "./bank.ts";
import { readConnectors, type ConnectorsSource } from "./connectors.ts";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readRoleSettings } from "./authority.ts";
import { readClassifications } from "./labels.ts";
import type { Answer } from "./envelope.ts";
import { readCatalog } from "./catalog.ts";
import { storeDifferences } from "./inspector.ts";
import { invoiceUri, invoices, memoryInvoices, type Invoice } from "./invoice.ts";
import { vendors } from "./vendor.ts";
import { memoryPayments, type Payment } from "./payment.ts";
import { bundleProblems, type SealedBundle } from "./bundle.ts";
import { createLog, type DecisionLog } from "./log.ts";
import { handlersFor } from "./operations.ts";
import { readRoles } from "./permissions.ts";
import { call } from "./pipeline.ts";
import { readInputs } from "./inputs.ts";
import {
  createDbBrakes,
  createDbClaims,
  sweepIntents,
  createDbControls,
  createDbInvoices,
  createDbLog,
  createDbPayments,
  createDbProposals,
  createDbSlips,
  loadDotEnv,
  openPool,
  requireEnv,
  runtimeRoleProblems,
} from "./postgres.ts";
import { memoryBrakes } from "./brakes.ts";
import { memoryClaims } from "./claims.ts";
import { memoryReservations } from "./limits.ts";
import { money } from "./money.ts";
import { memoryProposals } from "./proposals.ts";
import { memoryRates } from "./rates.ts";
import { ownWorkFor } from "./revocation.ts";
import { buildRegistry, readContracts, type Registry } from "./registry.ts";
// The stories of the earlier steps keep their idea, with no rule of the company in
// their way: each of their worlds gives no controls. Step 27's own story gives the shipped file
// (step 27's README, decision D16).
import { readControls } from "./controls.ts";
// The rules live in a store. The earlier steps' worlds give an empty one, and the
// story of the company's rule gives a store in memory, filled from controls.json (step 28's README,
// decisions D3 and D18).
import { checkRules, memoryControls, NO_CONTROLS, type MemoryControls } from "./rulebook.ts";
import type { RequestEnvelope } from "./request.ts";
import { checkStore, readStore, type StoreMap } from "./store.ts";
import { memorySlips } from "./slips.ts";
import { fakeDirectory } from "./directory.ts";
import { fakeKsor, type FakeKsor } from "./ksor.ts";
import { parseUri } from "./uri.ts";

// Start-up checks every contract first. If one is broken, the program stops here and
// names every problem, before any caller can ask for anything.
// Another folder of contracts can be named on the command line, so a test can start the
// program with a broken one.
const CONTRACTS = process.argv[2] ?? fileURLToPath(new URL("../contracts", import.meta.url));
// Start-up checks the role table too (step 06's README, decision 1). A role table can be
// named after the contracts folder, so a test can start with a broken one.
const ROLES = process.argv[3] ?? fileURLToPath(new URL("../roles.json", import.meta.url));
// Start-up checks the input schemas too. A folder of them can be named after
// the role table, so a test can start without one. With none named, the step's own is read.
const INPUTS: string | undefined = process.argv[4];
// Start-up checks the labels too (step 14's README, decision 1). A file of
// them can be named after the inputs folder, so a test can start with a broken one.
const CLASSIFICATIONS: string | undefined = process.argv[5];
// Start-up checks the map of its store too (step 16's README, decision 4).
// A map can be named after the labels file, so a test can start with a broken one.
const STORE: string | undefined = process.argv[6];
// Start-up checks each company's controls too, and runs their tests (step 27's
// README, decision D2). A file of them can be named after the map, so a test can start with a
// broken one.
const CONTROLS: string | undefined = process.argv[7];
// The pool is made before the checks, because the registry holds the store
// of invoices it reads. It connects only at its first query, after every check.
// Only DSOR_DB_URL: the owner's key stays in the file (step 09's README, decision 4).
loadDotEnv(["DSOR_DB_URL"]);
const pool = openPool(process.env["DSOR_DB_URL"] ?? "");
// Each company's staff directory, fake, with the story's people. DSoR asks it
// about the person who signed an agent's slip, at every call (step 19's README, decisions 1
// and 2). Each company's setting is in role-sources.json, checked at start-up (decision 8).
const directory456 = fakeDirectory("org_456", {
  user_123: { status: "active", roles: ["ap_supervisor"] },
  cfo_100: { status: "active", roles: ["CFO"] },
});
const directory789 = fakeDirectory("org_789", {
  user_700: { status: "active", roles: ["ap_supervisor"] },
});
const directories = new Map([
  ["org_456", directory456],
  ["org_789", directory789],
]);
let registry: Registry;
let store: StoreMap;
// The store of the company's rules for the program's own story.
let storyRules: MemoryControls;
try {
  registry = buildRegistry(
    readContracts(CONTRACTS),
    handlersFor(),
    readRoles(ROLES),
    readInputs(INPUTS),
    readClassifications(CLASSIFICATIONS),
    // The registry holds the store, and the code gets only the active company's invoices
    // (step 10's README, decision 13). Found by the Stage 2 review, and fixed from step 10 on.
    createDbInvoices(pool),
    // And the payments the commands write, in app.payments.
    createDbPayments(pool),
    // And the permission slips, in dsor.delegations (step 18's README,
    // decision 3).
    createDbSlips(pool),
    // And each company's directory.
    directories,
    readRoleSettings(),
    // And the claims of idempotency keys, in dsor.idempotency (step 20's
    // README, decision 6).
    createDbClaims(pool),
    // And DSoR's own work, the tear-up of a slip (step 25's README, decision D2).
    // And the brake's two commands, in the same map.
    ownWorkFor(),
    // And the brakes, in dsor.brakes, which line ④ reads (step 25b's README,
    // decision D5).
    createDbBrakes(pool),
    undefined,
    undefined,
    NO_CONTROLS,
  );
  // And each company's controls, with their tests, before any caller can ask. The
  //   worlds of the stories give no controls, so the earlier steps' stories keep their idea, and
  //   this check stands on its own: the files, and DSoR's own work, with no store (step 27's
  //   README, decisions D2 and D16).
  // Controls.json fills the story's store, and start-up checks every version in
  //   it, with the contracts and the money policies the registry checked. A file that is not one
  //   stops start-up as it is read (step 28's README, decisions D3 and D6).
  storyRules = memoryControls(readControls(CONTROLS));
  const ruleProblems = await checkRules(
    { ...registry, controls: storyRules },
    storyRules.companies(),
  );
  if (ruleProblems.length > 0) {
    throw new Error(`the rules refused to start:\n  ${ruleProblems.join("\n  ")}`);
  }
  // A broken map stops start-up here, with the other files, before the
  // program logs in (step 16's README, C7).
  const { map, problems } = checkStore(readStore(STORE));
  if (problems.length > 0) {
    throw new Error(`the map of the store refused to start:\n  ${problems.join("\n  ")}`);
  }
  store = map;
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
console.log("operations:", [...registry.contracts.keys()]);
// The earlier steps' stories, on the database too, run with no controls, so each
// keeps its idea: there the agent's 31,400.00 USD for INV-1008 is paid without the CFO. The program
// says so before the first story. Found by step 27's review, finding H1: nothing said it (step 27's
// README, decision D16).
console.log(
  "controls.json passed its tests; the stories of steps 09 to 26 run with no controls, and the company's rule has its own story",
);

// No database named, no program. It never falls back to a log in memory,
// because a missing secret must not quietly mean evidence lost on a crash (step 09's
// README, decision 15).
try {
  requireEnv("DSOR_DB_URL");
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

// Both checks below read the database, which may be out of reach. Then the
// program stops with the database's message, never a stack trace, and answers nothing.
// Found by the review.
let problems: string[];
let differences: string[];
try {
  // The program checks who it logged in as, before any call, and refuses to
  // run as a user that could change the log. It fails closed (step 09's README, decision 17).
  problems = await runtimeRoleProblems(pool);
  // Then the database against the map. After the login check, because a wrong login
  // would make every privilege the inspector reads someone else's (step 16's README,
  // decision 4).
  differences = problems.length > 0 ? [] : storeDifferences(store, await readCatalog(pool));
} catch (error) {
  console.error(`The database could not be checked. Refused: ${(error as Error).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}
if (problems.length > 0) {
  console.error(`DSOR_DB_URL must log in as dsor_runtime. Refused: ${problems.join("; ")}.`);
  await pool.end();
  process.exit(1);
}

// On any difference with the map, the program refuses to start, and names
// each one. It fails closed, as the login check does (step 16's README, C6).
if (differences.length > 0) {
  console.error(`The database does not match store.json. Refused:\n  ${differences.join("\n  ")}`);
  await pool.end();
  process.exit(1);
}

// And every version in dsor.controls, as start-up checks the story's store: the
// rules of each company that DSoR counts money for, which is each company where a login works. A
// row that someone changed by hand stops start-up here. The stories of the earlier steps still run
// with no rule: their world gives an empty store (step 28's README, decisions D6 and D18).
let storedRules: string[];
try {
  const stored = { ...registry, controls: createDbControls(pool) };
  storedRules = await checkRules(stored, registry.moneyPolicies.keys());
} catch (error) {
  console.error(
    `The rules in dsor.controls could not be checked. Refused: ${(error as Error).message}`,
  );
  await pool.end().catch(() => {});
  process.exit(1);
}
if (storedRules.length > 0) {
  console.error(`the rules refused to start:\n  ${storedRules.join("\n  ")}`);
  await pool.end();
  process.exit(1);
}
console.log(
  "dsor.controls passed its checks too; the program's stories keep their rules in memory",
);

// NEW IN STEP 36: before any call, and after the login and the map are checked, every note with
//   no outcome, left by a program that stopped while it paid, is ended OUTCOME_UNKNOWN, with its
//   proposal and its claim (DSOR-EXE-04b; step 36's README, decision D4).
try {
  const swept = await sweepIntents(pool, registry.lifetimes.keys());
  console.log(`start-up: ${swept} note(s) with no outcome, each now OUTCOME_UNKNOWN`);
} catch (error) {
  console.error(`The notes could not be swept. Refused: ${(error as Error).message}`);
  await pool.end().catch(() => {});
  process.exit(1);
}

// The log every decision is written to is the table dsor.audit.
const log = createDbLog(pool);

// Every answer is kept, so the program can find its own records later.
const answers: Answer[] = [];
async function ask(
  who: RequestEnvelope,
  name: string,
  input: unknown,
  to: DecisionLog = log,
): Promise<Answer> {
  const answer = await call(registry, to, who, name, input);
  answers.push(answer);
  return answer;
}

// Every call carries a request envelope beside its arguments. This one
// holds the login token DSoR gave the agent (step 05's README, decision 2).
// And the company the call works in (step 10's README, decision 1).
const AGENT: RequestEnvelope = { token: "tok_7f3a", tenant: "org_456" };

// The answer is an envelope. A success carries the invoice as its data,
// and the request id DSoR made for this call.
// invoice.get takes the invoice's canonical URI, as invoice.issue does
// (step 12's README, decision 1).
const answer = await ask(AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" });
console.log(answer);
// The answer names INV-1008's version. Every command below sends the version its
// caller read, as expected_version (step 21's README, decision 13).
const read1008 = "data" in answer ? (answer.data as { version: number }).version : 0;
const DRAFT_1008 = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: read1008 };
// The agent's INV-1008 above has no amount and no open_amount. cfo_100, a
// person, asks for the same invoice and gets it whole (step 14's README, outcome 5).
const CFO: RequestEnvelope = { token: "tok_d4e8", tenant: "org_456" };
const whole = await ask(CFO, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" });
if ("data" in whole) console.log(whole.data);

// The invoice's permanent address, and the address read back.
// The invoice is the answer's data. A refusal has no data.
if ("data" in answer) {
  const uri = invoiceUri(answer.data as Invoice);
  console.log(uri);
  console.log(parseUri(uri));
}

// A refusal comes back as an error envelope, never as a throw. Each one
// has a code, and the retry class the §28 table gives that code.
console.log(await ask(AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-9999" }));
// invoice.issue is a command. Since step 18 the agent calls under del_100, user_123's slip,
// which lists no invoice:issue, so line ⑤ refuses it (step 18's README, decision 5).
console.log(
  await ask(AGENT, "invoice.issue", {
    invoice: "dsor://org_456/invoice/INV-1008",
    expected_version: 1,
  }),
);

// A call with no login token is refused before DSoR checks anything else.
console.log(await ask({}, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" }));
// The agent names the CFO in its arguments. DSoR still knows it is the
// agent, from its token, and refuses the call.
console.log(
  await ask(AGENT, "invoice.get", {
    invoice: "dsor://org_456/invoice/INV-1008",
    principal: "cfo_100",
  }),
);
// user_123 logs in with their own token, and labels the call with a request
// id of their own. The answer carries that id, and names user_123 as the caller.
const USER_123: RequestEnvelope = { token: "tok_2c91", tenant: "org_456", request_id: "ap-desk-7" };
console.log(
  (await ask(USER_123, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" })).correlation,
);
// user_123 holds invoice:issue. So the same call passes lines ①, ⑤, and ⑥.
// It is refused after them: invoice.issue has a contract but no code yet.
console.log(
  await ask(USER_123, "invoice.issue", {
    invoice: "dsor://org_456/invoice/INV-1008",
    expected_version: 1,
  }),
);
// user_123 sends an id where invoice.issue needs a canonical URI. Line ⑥
// refuses it, before DSoR asks whether invoice.issue is built.
console.log(await ask(USER_123, "invoice.issue", { invoice: "INV-1008", expected_version: 1 }));

// A second company, org_789. An accounting firm's agent works for both.
// Asked for INV-1008, each company gets its own invoice (step 10's README, outcome 2).
const FIRM_IN_456: RequestEnvelope = { token: "tok_9b52", tenant: "org_456" };
const FIRM_IN_789: RequestEnvelope = { token: "tok_9b52", tenant: "org_789" };
// Each company's INV-1008 has a URI of its own, which names the company.
const READS = [
  [FIRM_IN_456, "dsor://org_456/invoice/INV-1008"],
  [FIRM_IN_789, "dsor://org_789/invoice/INV-1008"],
] as const;
for (const [firm, invoice] of READS) {
  const read = await ask(firm, "invoice.get", { invoice });
  // The firm's agent gets no amount. The vendor says whose invoice it is.
  if ("data" in read) {
    const { tenant_id, id, vendor_id } = read.data as Invoice;
    console.log(tenant_id, id, vendor_id);
  }
}
// The org_456 agent asks to work in org_789, where it is no member. The
// answer is the same as for a company that does not exist.
console.log(
  await ask({ ...AGENT, tenant: "org_789" }, "invoice.get", {
    invoice: "dsor://org_789/invoice/INV-1008",
  }),
);
// User_123, working in org_456, names org_789's invoice. Refused with
// TENANT_MISMATCH, before DSoR asks whether invoice.issue is built.
console.log(
  await ask(USER_123, "invoice.issue", {
    invoice: "dsor://org_789/invoice/INV-1008",
    expected_version: 1,
  }),
);

// The agent asks for a million invoices. DSoR's maximum wins: ten, a note
// that the limit was cut, and a cursor for the rest (step 13's README, outcome 2).
const listed = await ask(AGENT, "invoice.list", { limit: 1000000 });
if ("data" in listed) {
  const { items, ...rest } = listed.data as { items: Invoice[] };
  console.log(items.map(({ id }) => id).join(" "), rest);
}

// Every command carries an idempotency key that its caller chose. The database
// keeps the claims of every run, so each run's keys end with a part of their own. A second run
// drafts again, and never hears the first run's answers (step 20's README, decision 3).
const RUN = randomUUID().slice(0, 8);
/** The envelope, with a key made from this name and this run. */
function withKey(who: RequestEnvelope, name: string): RequestEnvelope {
  return { ...who, idempotency_key: `${name}-${RUN}` };
}

// The first commands. user_123 drafts a payment for INV-1008. DSoR reads the
// invoice's open amount and vendor itself, and the answer says the draft can be undone:
// compensatable (step 17's README, outcomes 2 and 4). The database numbers it: PAY-901 on a
// fresh branch, a higher number on each run after.
const drafted = await ask(withKey(USER_123, "pay-INV-1008-desk"), "payment.create", DRAFT_1008);
console.log(drafted);
// The draft's answer names its proposal. DSoR keeps it, with every move: who
// made it, and why (step 22's README, outcome 1).
const keptProposals = createDbProposals(pool);
async function showProposal(answer: Answer): Promise<void> {
  if (!("proposal" in answer) || answer.proposal === undefined) return;
  const id = answer.proposal.slice(answer.proposal.lastIndexOf("/") + 1);
  const kept = await keptProposals.get("org_456", id);
  console.log(`its proposal, ${kept?.state ?? "not found"}:`, answer.proposal);
  for (const move of kept?.transitions ?? []) {
    console.log(`  ${move.from ?? "(new)"} → ${move.to}, by ${move.actor}: ${move.cause}`);
  }
}
await showProposal(drafted);
if ("data" in drafted) {
  const { id, version } = drafted.data as Payment;
  const payment = `dsor://org_456/payment/${id}`;
  // The undo, through the same checklist. Its answer says atomic.
  console.log(
    await ask(withKey(USER_123, "cancel-1"), "payment.cancel", {
      payment,
      expected_version: version,
    }),
  );
  // A second cancel, decided on the draft's version, which the first cancel
  // changed: STALE_STATE. Then one decided on the version that refusal named: the payment is
  // not a draft any more, so the business rule refuses it (step 21's README, outcome 5).
  console.log(
    await ask(withKey(USER_123, "cancel-2"), "payment.cancel", {
      payment,
      expected_version: version,
    }),
  );
  const notADraft = await ask(withKey(USER_123, "cancel-3"), "payment.cancel", {
    payment,
    expected_version: version + 1,
  });
  console.log(notADraft);
  // The code refused it, so its proposal ended FAILED, and stays so.
  await showProposal(notADraft);
}
// The agent drafts a payment under del_100, which lists payment:create, and
// user_123, who signed it, holds it now. Its answer leaves out the amount (step 18's README,
// outcome 1).
console.log(await ask(withKey(AGENT, "pay-INV-1008-day"), "payment.create", DRAFT_1008));

// Three ways to call. The agent asks first, with a dry run: would a draft for
// INV-1008 be allowed? DSoR runs its checks, answers VALIDATED, and writes nothing but the
// decision's record: no claim, no proposal, no draft (step 23's README, outcome 1).
const dry = await ask({ ...AGENT, mode: "validate_only" }, "payment.create", DRAFT_1008);
console.log("the agent's dry run:", dry);
// Then it prepares the draft, in propose_only mode. The proposal waits READY, and no draft is
// written. proposal.execute, which releases it, comes in step 31 (outcome 2).
// Of INV-1012, 22,750.00 USD. A prepared draft is in flight, and one attempt at a
//   time would refuse the night's drafts of INV-1008 below (DSOR-EXC-01; step 32's README,
//   decision D6). The story's invoices stay at version 1.
const DRAFT_1012 = { invoice: "dsor://org_456/invoice/INV-1012", expected_version: 1 };
const PREPARE = { ...withKey(AGENT, "prepare-INV-1012"), mode: "propose_only" };
const prepared = await ask(PREPARE, "payment.create", DRAFT_1012);
console.log("the agent prepares a draft:", prepared);
await showProposal(prepared);
// The same key, sent to execute, is refused: a key keeps its mode (outcome 3).
const executeIt = await ask(withKey(AGENT, "prepare-INV-1012"), "payment.create", DRAFT_1012);
console.log("the same key, to execute:", heard(executeIt));

// The night. Nobody is logged in, and the agent works under del_100. At every
// call DSoR asks org_456's directory about user_123, who signed it (step 19's README,
// outcomes 1 to 5).
/** What the caller heard, in one line. */
function heard(answer: Answer): string {
  if ("data" in answer) return `answered, ${String((answer.data as { id?: unknown }).id)}`;
  // A proposal that waits, or a dry run's yes, has no data: its outcome says it.
  if ("outcome" in answer) return answer.outcome;
  return `${answer.code}: ${answer.message}`;
}
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };
// The agent drafts, and its record says where user_123's authority came from, and as of when.
const night = await ask(withKey(AGENT, "pay-INV-1008-night"), "payment.create", DRAFT_1008);
console.log("night, the agent drafts:", heard(night));
const nightRecord = (await log.records("org_456")).find(
  (r) => r.correlation.request_id === night.correlation.request_id,
);
console.log("its record's identity:", nightRecord?.identity);
// 02:10, the network loses DSoR's answer to the agent's draft for INV-1009. The
// agent sends the same request again, with the same key. DSoR finds the claim and gives back
// the answer it recorded, and runs nothing: one draft (step 20's README, outcome 1).
// The agent reads INV-1009 first, for its version (step 21's README, decision 13).
const read1009 = await ask(AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1009" });
const INV_1009 = {
  invoice: "dsor://org_456/invoice/INV-1009",
  expected_version: "data" in read1009 ? (read1009.data as { version: number }).version : 0,
};
const lostAnswer = await ask(withKey(AGENT, "pay-INV-1009"), "payment.create", INV_1009);
console.log("02:10, the agent drafts, and the answer is lost:", heard(lostAnswer));
const retried = await ask(withKey(AGENT, "pay-INV-1009"), "payment.create", INV_1009);
console.log("02:11, the retry with the same key hears:", heard(retried));
// The same key, sent again for INV-1008, is refused, and nothing is drafted (outcome 3).
const reused = await ask(withKey(AGENT, "pay-INV-1009"), "payment.create", DRAFT_1008);
console.log("the same key, for INV-1008:", heard(reused));
// The directory moves user_123 to ap_clerk. The agent's draft is refused at line ⑤, and its
// read is still answered: ap_clerk may read invoices (step 19's README, outcome 2).
directory456.set("user_123", { status: "active", roles: ["ap_clerk"] });
console.log(
  "ap_clerk, the agent drafts:",
  heard(await ask(withKey(AGENT, "pay-INV-1008-clerk"), "payment.create", DRAFT_1008)),
);
console.log("ap_clerk, the agent reads:", heard(await ask(AGENT, "invoice.get", INV_1008)));
// Ap_clerk holds payment:create.propose, so the agent may still prepare the draft,
// which waits READY for a person to release (step 23's README, outcome 4).
// Of INV-1004, 27,300.00 USD, since INV-1012's prepared draft is in flight.
const CLERK_PREPARES = { ...withKey(AGENT, "prepare-INV-1004-clerk"), mode: "propose_only" };
const DRAFT_1004 = { invoice: "dsor://org_456/invoice/INV-1004", expected_version: 1 };
console.log(
  "ap_clerk, the agent prepares:",
  heard(await ask(CLERK_PREPARES, "payment.create", DRAFT_1004)),
);
// No suspension on the database. Since step 19b, the directory's "suspended"
// suspends her slips, and a suspension in the shared database is permanent, so the next run's
// agent would be refused. It is told in memory, after the restart (step 19b's README,
// decision 11).
// She is back to ap_supervisor, and then the directory goes off. DSoR uses the answer it kept a
// moment ago, which is far under org_456's one hour (step 19's README, decision 3).
directory456.set("user_123", { status: "active", roles: ["ap_supervisor"] });
console.log(
  "ap_supervisor again, the agent reads:",
  heard(await ask(AGENT, "invoice.get", INV_1008)),
);
directory456.turn("off");
console.log("directory off, the agent reads:", heard(await ask(AGENT, "invoice.get", INV_1008)));
// DSoR restarts while the directory is off. The kept answers lived in memory, so they are
// gone, and the agent is refused. user_123 calls for herself, and needs no directory
// (decisions 2 and 3).
const restarted = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  createDbInvoices(pool),
  createDbPayments(pool),
  createDbSlips(pool),
  directories,
  readRoleSettings(),
  // The same claims, in the database.
  createDbClaims(pool),
  // And DSoR's own work.
  ownWorkFor(),
  // And the same brakes, in the database.
  createDbBrakes(pool),
  undefined,
  undefined,
  NO_CONTROLS,
);
const agentAfter = await call(restarted, log, AGENT, "invoice.get", INV_1008);
const herOwn = await call(
  restarted,
  log,
  { token: "tok_2c91", tenant: "org_456" },
  "invoice.get",
  INV_1008,
);
answers.push(agentAfter, herOwn);
console.log("after a restart, the agent reads:", heard(agentAfter));
console.log("after a restart, user_123 reads:", heard(herOwn));
// The claims are in the database, so the restart forgot none. user_123 sends
// her first draft's request again, with its key, and hears the answer DSoR recorded then: a
// draft, though she has cancelled it since (step 20's README, decision 7).
const herRetry = await call(
  restarted,
  log,
  withKey(USER_123, "pay-INV-1008-desk"),
  "payment.create",
  DRAFT_1008,
);
answers.push(herRetry);
const status = "data" in herRetry ? (herRetry.data as Payment).status : "";
console.log("after a restart, user_123's retry of her draft:", heard(herRetry), status);
directory456.turn("on");

// The suspension, told in memory. A suspension in the shared database is
// permanent, and nothing in DSoR lifts one yet. So this part copies del_100 and del_101 from the
// database into slips in memory, beside a directory, invoices, payments, and a log in memory.
// Nothing here writes to the database. The database tests prove the real suspensions (step 19b's
// README, decision 11).
console.log("the suspension, in memory, so the database's slips stay active:");
const fromDatabase = createDbSlips(pool);
const copies = [
  (await fromDatabase.find("org_456", "accounts-payable-fte"))?.slip,
  (await fromDatabase.find("org_456", "firm-ap-fte"))?.slip,
];
const slipsInMemory = memorySlips(copies.filter((slip) => slip !== undefined));
const tuesday456 = fakeDirectory("org_456", {
  user_123: { status: "suspended", roles: ["ap_supervisor"] },
  cfo_100: { status: "active", roles: ["CFO"] },
});
const inMemory = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  memoryInvoices(),
  memoryPayments(),
  slipsInMemory,
  new Map([
    ["org_456", tuesday456],
    ["org_789", directory789],
  ]),
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  NO_CONTROLS,
);
const memoryLog = createLog();
// Tuesday, 02:00: the directory says she is suspended. Line ③ suspends both her slips, with a
// record each, and refuses as in step 19 (step 19b's README, outcome 1).
const tuesday = await call(inMemory, memoryLog, AGENT, "invoice.get", INV_1008);
console.log("  suspended, the agent reads:", heard(tuesday));
for (const change of await slipsInMemory.changes()) {
  console.log(
    `  ${change.delegation} is ${change.result}, on the directory's word: ${change.reason}`,
  );
}
// 02:05: the firm's agent calls under del_101. Line ③ refuses it from the slip's own status,
// before the directory is asked (outcome 2).
const askedBefore = tuesday456.asked();
const FIRM: RequestEnvelope = { token: "tok_9b52", tenant: "org_456" };
const firm = await call(inMemory, memoryLog, FIRM, "invoice.get", INV_1008);
const asked = tuesday456.asked() - askedBefore;
console.log(`  the firm's agent reads: ${heard(firm)} (the directory was asked ${asked} times)`);
// Thursday: she is active again. The suspensions stay until a person lifts them (outcome 3).
tuesday456.set("user_123", { status: "active", roles: ["ap_supervisor"] });
const thursday = await call(inMemory, memoryLog, AGENT, "invoice.get", INV_1008);
console.log("  active again, the agent reads:", heard(thursday));

// The changed payee, told in memory. dsor_runtime must not change an invoice,
// so somebody in org_456 changes a copy of the story's invoices, in memory, beside fresh copies
// of the database's slips. Nothing here writes to the database (step 21's README, decision 13).
console.log("the changed payee, in memory, because DSoR changes no invoice:");
const ledger = structuredClone(invoices);
const notePayments: Payment[] = [];
const accounts = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  memoryInvoices(ledger),
  memoryPayments(notePayments),
  memorySlips(copies.filter((slip) => slip !== undefined)),
  directories,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  NO_CONTROLS,
);
const noteLog = createLog();
/** INV-1008 as the agent reads it in the ledger: its version and its vendor. */
async function agentReads(): Promise<{ version: number; vendor_id: string }> {
  const read = await call(accounts, noteLog, AGENT, "invoice.get", INV_1008);
  return "data" in read ? (read.data as Invoice) : { version: 0, vendor_id: "" };
}
// 02:05: the agent reads INV-1008, from VENDOR-44, a vendor it knows, and decides to pay.
const before = await agentReads();
console.log(`  02:05, the agent reads INV-1008: version ${before.version}, ${before.vendor_id}`);
// 02:06: somebody changes the payee, and the version goes up, as the database's trigger does.
const inLedger = ledger.find((i) => i.tenant_id === "org_456" && i.id === "INV-1008")!;
inLedger.vendor_id = "VENDOR-99";
inLedger.version += 1;
console.log(`  02:06, the payee changes: INV-1008 is version ${inLedger.version}, VENDOR-99`);
// 02:07: the agent's draft, decided on the version before the change, is refused.
const late = await call(accounts, noteLog, withKey(AGENT, "pay-INV-1008-payee"), "payment.create", {
  invoice: "dsor://org_456/invoice/INV-1008",
  expected_version: before.version,
});
console.log(`  02:07, the agent drafts on version ${before.version}:`, heard(late));
// 02:08: it reads again, and decides again: a payee it does not know is for a person, so it
// drafts nothing. Step 20 would have drafted 31,400.00 USD to VENDOR-99.
const after = await agentReads();
console.log(
  `  02:08, the agent reads again: version ${after.version}, ${after.vendor_id}. Drafts: ${notePayments.length}`,
);

// The day's limit, told in memory. A day's spending in the shared database would
// carry from run to run, so the story's del_100 keeps no limits there (step 24's README, decision
// 12). Here a copy of del_100 carries the limits of §13's example: 50,000 USD in one payment, and
// 200,000 USD in one day. Nothing here writes to the database.
console.log("the day's limit, in memory, because a day's spending in the database carries on:");
const LIMITS = {
  per_transaction_limit: { value: "50000", currency: "USD" },
  cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: "USD" } }],
};
const limited = copies[0] === undefined ? [] : [{ ...(copies[0] as object), constraints: LIMITS }];
const limitInvoices = memoryInvoices(structuredClone(invoices));
const limitPayments = memoryPayments([]);
// The claim reads the slip again, so it gets the slips that line ③ reads (step 25c's README, decision D12).
const limitSlips = memorySlips(limited);
const dayLimits = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  limitInvoices,
  limitPayments,
  limitSlips,
  directories,
  readRoleSettings(),
  memoryClaims(limitInvoices, limitPayments, undefined, undefined, limitSlips),
  undefined,
  undefined,
  undefined,
  undefined,
  NO_CONTROLS,
);
const dayLog = createLog();
const DRAFT_IN_MEMORY = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
// 02:00: seven drafts of INV-1008, 31,400.00 USD each, at the same moment. Six fit in the day's
// 200,000.00 USD, and the seventh would pass it (step 24's README, outcome 1).
const seven = await Promise.all(
  Array.from({ length: 7 }, (_, i) =>
    call(dayLimits, dayLog, withKey(AGENT, `limit-${i}`), "payment.create", DRAFT_IN_MEMORY),
  ),
);
const made = seven.filter((one) => "outcome" in one && one.outcome === "COMMITTED").length;
const refusedOne = seven.find((one) => "code" in one);
const refusedWord = refusedOne === undefined ? "none" : heard(refusedOne);
console.log(`  seven drafts of 31,400.00 USD at once: ${made} made, and ${refusedWord}`);
// 02:01: a dry run of an eighth hears the refusal the real call would hear, and reserves nothing
// (outcome 4).
const eighth = await call(
  dayLimits,
  dayLog,
  { ...AGENT, mode: "validate_only" },
  "payment.create",
  DRAFT_IN_MEMORY,
);
console.log("  a dry run of an eighth:", heard(eighth));

// The tear-up, told in memory. A torn-up slip never comes back, and the program
// runs many times, so the shared database's del_100 is never torn up (step 25's README, decision
// D9). Here a copy of del_100, with the day's limits, is torn up in a world of its own.
console.log("tearing up the slip, in memory, because a torn-up slip never comes back:");
const tearInvoices = memoryInvoices(structuredClone(invoices));
const tearPayments = memoryPayments([]);
const tearProposals = memoryProposals();
const tearReservations = memoryReservations();
const tearSlips = memorySlips(limited);
const tearWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  tearInvoices,
  tearPayments,
  tearSlips,
  directories,
  readRoleSettings(),
  memoryClaims(tearInvoices, tearPayments, tearProposals, tearReservations, tearSlips),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  NO_CONTROLS,
);
const tearLog = createLog();
const DEL_100_URI = "dsor://org_456/delegation/del_100";
const TEAR_UP = { slip: DEL_100_URI, reason: "the agent drafted for a vendor it should not pay" };
// 03:00: the agent prepares a draft. It waits in READY, and holds 31,400.00 USD of the day.
const preparedDraft = await call(
  tearWorld,
  tearLog,
  { ...withKey(AGENT, "tear-prepare"), mode: "propose_only" },
  "payment.create",
  DRAFT_IN_MEMORY,
);
console.log("  03:00, the agent prepares a draft:", heard(preparedDraft));
// 03:10: the CFO did not sign del_100 and is not a tenant administrator, so line ⑨ refuses the CFO.
// user_123 signed it, and tears it up (DSOR-DEL-04a).
const cfoTries = await call(
  tearWorld,
  tearLog,
  withKey(CFO, "tear-cfo"),
  "delegation.revoke",
  TEAR_UP,
);
console.log("  03:10, the CFO tries to tear up del_100:", heard(cfoTries));
const tornUp = await call(
  tearWorld,
  tearLog,
  withKey({ token: "tok_2c91", tenant: "org_456" }, "tear-up"),
  "delegation.revoke",
  TEAR_UP,
);
console.log("  03:10, user_123 tears up del_100:", heard(tornUp));
// 03:11: the agent's next call is refused (DSOR-DEL-04b).
const afterTearUp = await call(
  tearWorld,
  tearLog,
  withKey(AGENT, "tear-after"),
  "payment.create",
  DRAFT_IN_MEMORY,
);
console.log("  03:11, the agent drafts again:", heard(afterTearUp));
// The prepared draft went with the slip. Until step 25c it waited on at READY
// (step 25's README, decision L4). Its booking went back to the day (step 25c's README, claim C2).
const preparedId =
  "proposal" in preparedDraft ? String(preparedDraft.proposal).split("/").at(-1) : "";
const afterTear = await tearProposals.get("org_456", preparedId ?? "");
const bookingAfterTear = await tearReservations.get("org_456", preparedId ?? "");
console.log(
  `  the prepared draft: ${afterTear?.state ?? "none"}, its booking ${bookingAfterTear?.state ?? "none"}`,
);

// The emergency brake, told in memory. The program runs many times, and a brake
// left on in the shared database would stop the agent there (step 25b's README, decision D12).
console.log("the emergency brake, in memory, so the database's agents keep working:");
const brakeInvoices = memoryInvoices(structuredClone(invoices));
const brakePayments = memoryPayments([]);
const firmIn789 = (await fromDatabase.find("org_789", "firm-ap-fte"))?.slip;
const brakeSlips = memorySlips([...copies, firmIn789].filter((slip) => slip !== undefined));
const brakes = memoryBrakes();
const brakeWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  brakeInvoices,
  brakePayments,
  brakeSlips,
  directories,
  readRoleSettings(),
  // The claims pull and lift in the same brakes that line ④ reads.
  memoryClaims(
    brakeInvoices,
    brakePayments,
    memoryProposals(),
    memoryReservations(),
    brakeSlips,
    brakes,
  ),
  ownWorkFor(),
  brakes,
  undefined,
  undefined,
  NO_CONTROLS,
);
const brakeLog = createLog();
const brakeCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(brakeWorld, brakeLog, who, name, input);
/** A pull or a lift, as the caller heard it: the brake's state, or the refusal. */
function brakeHeard(answer: Answer): string {
  if (!("data" in answer)) return heard(answer);
  return `answered, the brake is ${String((answer.data as { status?: unknown }).status)}`;
}
const SUPERVISOR_123: RequestEnvelope = { token: "tok_2c91", tenant: "org_456" };
const ADMIN_100: RequestEnvelope = { token: "tok_a100", tenant: "org_456" };
const ON_THE_AGENT = {
  target: "dsor://org_456/agent/accounts-payable-fte",
  reason: "the agent drafts one payment after another",
};
// 03:10: user_123 pulls the brake. From the next call on, each command from the agent is refused
// at line ④, and its reads and every person's calls go on (DSOR-OPS-01a, DSOR-OPS-01b).
const pulled = await brakeCall(
  withKey(SUPERVISOR_123, "brake-on"),
  "control.suspend",
  ON_THE_AGENT,
);
console.log("  03:10, user_123 pulls the brake on accounts-payable-fte:", brakeHeard(pulled));
const brakedDraft = await brakeCall(
  withKey(AGENT, "brake-draft"),
  "payment.create",
  DRAFT_IN_MEMORY,
);
console.log("  03:11, the agent drafts:", heard(brakedDraft));
console.log(
  "  03:11, the agent reads INV-1008:",
  heard(await brakeCall(AGENT, "invoice.get", INV_1008)),
);
const personDraft = await brakeCall(
  withKey(SUPERVISOR_123, "brake-person"),
  "payment.create",
  DRAFT_IN_MEMORY,
);
console.log("  03:11, user_123 drafts:", heard(personDraft));
// 03:12: the agent cannot lift its own brake, and the CFO, who holds no control:suspend, cannot
// either (DSOR-OPS-01d).
const selfLift = await brakeCall(withKey(AGENT, "brake-self"), "control.lift", ON_THE_AGENT);
console.log("  03:12, the agent tries to lift its own brake:", heard(selfLift));
const cfoLift = await brakeCall(withKey(CFO, "brake-cfo"), "control.lift", ON_THE_AGENT);
console.log("  03:12, the CFO tries to lift it:", heard(cfoLift));
// 08:00: user_123 lifts it, and the agent works again.
const morning = { ...ON_THE_AGENT, reason: "the invoice was at fault, not the agent" };
const lifted = await brakeCall(withKey(SUPERVISOR_123, "brake-off"), "control.lift", morning);
console.log("  08:00, user_123 lifts it:", brakeHeard(lifted));
const againDraft = await brakeCall(
  withKey(AGENT, "brake-again"),
  "payment.create",
  DRAFT_IN_MEMORY,
);
console.log("  08:01, the agent drafts again:", heard(againDraft));
// 08:05: admin_100 freezes org_456. Every agent of org_456 stops, and none of org_789.
const audit = {
  target: "dsor://org_456/tenant/org_456",
  reason: "every agent waits for the audit",
};
const frozen = await brakeCall(withKey(ADMIN_100, "freeze"), "control.suspend", audit);
console.log("  08:05, admin_100 freezes org_456:", brakeHeard(frozen));
const FIRM_456: RequestEnvelope = { token: "tok_9b52", tenant: "org_456" };
const FIRM_789: RequestEnvelope = { token: "tok_9b52", tenant: "org_789" };
const firmHere = await brakeCall(
  withKey(FIRM_456, "freeze-456"),
  "payment.create",
  DRAFT_IN_MEMORY,
);
console.log("  08:06, firm-ap-fte drafts in org_456:", heard(firmHere));
const theirs = { invoice: "dsor://org_789/invoice/INV-2001", expected_version: 1 };
const firmThere = await brakeCall(withKey(FIRM_789, "freeze-789"), "payment.create", theirs);
console.log("  08:06, firm-ap-fte drafts in org_789:", heard(firmThere));

// A prepared draft that nobody releases, told in memory with a clock of its own,
// because the program cannot wait a week. org_456's lifetime is P7D, in ready-lifetimes.json. The
// program calls the sweep as dsor-scheduler at 00:00 on two nights, as a deployment's timer would,
// and the sweep expires each READY proposal past its time and gives its booking back (step 25c's
// README, decisions L2, L3, D1).
console.log("a prepared draft that nobody releases, in memory, with a clock of its own:");
const clock = { now: Date.parse("2026-10-07T03:00:00Z") };
const expiryInvoices = memoryInvoices(structuredClone(invoices));
const expiryPayments = memoryPayments([]);
const expiryProposals = memoryProposals(() => clock.now);
const expiryReservations = memoryReservations(() => clock.now);
const expirySlips = memorySlips(limited);
const expiryWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  expiryInvoices,
  expiryPayments,
  expirySlips,
  directories,
  readRoleSettings(),
  memoryClaims(expiryInvoices, expiryPayments, expiryProposals, expiryReservations, expirySlips),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  NO_CONTROLS,
);
const expiryLog = createLog();
const expiryCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(expiryWorld, expiryLog, who, name, input);
/** A sweep, as its caller heard it: how many proposals it expired, or the refusal. */
function sweepHeard(answer: Answer): string {
  if (!("data" in answer)) return heard(answer);
  return `answered, ${String((answer.data as { expired?: unknown }).expired)} expired`;
}
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const ORG_456 = { company: "dsor://org_456/tenant/org_456" };
// Wednesday 03:00: the agent prepares a draft. It waits at READY, and holds 31,400.00 USD.
const unreleased = await expiryCall(
  { ...withKey(AGENT, "expiry-prepare"), mode: "propose_only" },
  "payment.create",
  DRAFT_IN_MEMORY,
);
const unreleasedId = "proposal" in unreleased ? String(unreleased.proposal).split("/").at(-1) : "";
const madeAt = await expiryProposals.get("org_456", unreleasedId ?? "");
console.log("  Wednesday 03:00, the agent prepares a draft:", heard(unreleased));
console.log(`  it expires at ${madeAt?.expires_at ?? "none"}`);
// Thursday 00:00: the first night. Nothing is past its time, so nothing expires.
clock.now = Date.parse("2026-10-08T00:00:00Z");
const firstNight = await expiryCall(withKey(SCHEDULER, "sweep-1"), "proposal.expire_due", ORG_456);
console.log("  Thursday 00:00, dsor-scheduler sweeps org_456:", sweepHeard(firstNight));
// Thursday 09:00: user_123 tries. The sweep is for DSoR's own system logins only, and user_123 is
// a person (step 25c's README, decision D14).
clock.now = Date.parse("2026-10-08T09:00:00Z");
const byHand = await expiryCall(
  withKey(SUPERVISOR_123, "sweep-123"),
  "proposal.expire_due",
  ORG_456,
);
console.log("  Thursday 09:00, user_123 tries to sweep:", sweepHeard(byHand));
// A week later: past its time. The sweep expires it, and its booking goes back to the day.
clock.now = Date.parse("2026-10-15T00:00:00Z");
const weekLater = await expiryCall(withKey(SCHEDULER, "sweep-8"), "proposal.expire_due", ORG_456);
console.log("  next Thursday 00:00, dsor-scheduler sweeps org_456:", sweepHeard(weekLater));
const expired = await expiryProposals.get("org_456", unreleasedId ?? "");
const bookingAfterExpiry = await expiryReservations.get("org_456", unreleasedId ?? "");
console.log(
  `  the prepared draft: ${expired?.state ?? "none"}, its booking ${bookingAfterExpiry?.state ?? "none"}`,
);

// Money in two currencies, told in memory with a clock of its own. dsor-rates loads
// Tuesday's sheet of ecb-daily, and the agent drafts three bills of VENDOR-44 in other currencies,
// under del_100's 50,000.00 USD for one payment and 200,000.00 USD for one day. The bills live in
// this world only (step 26's README, decisions L1, L5, L6, D1, and D14).
console.log("money in two currencies, in memory, with a clock of its own:");
const moneyClock = { now: Date.parse("2026-10-06T15:00:00Z") };
/** One of VENDOR-44's bills to org_456, in its own currency. */
function bill(id: string, value: string, currency: string): Invoice {
  const amount = money(value, currency);
  const fields = { vendor_id: "VENDOR-44", amount, open_amount: amount, status: "issued" };
  return { tenant_id: "org_456", id, ...fields, version: 1 } as Invoice;
}
const moneyInvoices = memoryInvoices([
  ...structuredClone(invoices),
  bill("INV-2002", "9000.00", "EUR"),
  bill("INV-2003", "49000.00", "GBP"),
  bill("INV-2004", "14000000.00", "PKR"),
]);
const moneyPayments = memoryPayments([]);
const moneyProposals = memoryProposals(() => moneyClock.now);
const moneyReservations = memoryReservations(() => moneyClock.now);
const moneyRates = memoryRates(() => moneyClock.now);
const moneySlips = memorySlips(limited);
const moneyWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  moneyInvoices,
  moneyPayments,
  moneySlips,
  directories,
  readRoleSettings(),
  memoryClaims(
    moneyInvoices,
    moneyPayments,
    moneyProposals,
    moneyReservations,
    moneySlips,
    undefined,
    moneyRates,
  ),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  NO_CONTROLS,
);
const moneyLog = createLog();
const moneyCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(moneyWorld, moneyLog, who, name, input);
const RATE_LOADER: RequestEnvelope = { token: "tok_3b8f", tenant: "org_456" };
// Tuesday's sheet, as the European Central Bank writes it: how much of each currency 1 EUR buys.
const TUESDAY_SHEET = {
  company: "dsor://org_456/tenant/org_456",
  source: "ecb-daily",
  base: "EUR",
  published_at: "2026-10-06T14:00:00Z",
  rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
};
/** A load, as its caller heard it: the sheet it wrote, or the refusal. */
function loadHeard(answer: Answer): string {
  if (!("data" in answer)) return heard(answer);
  const { source, currencies } = answer.data as { source?: unknown; currencies?: unknown };
  return `answered, a sheet of ${String(source)} with ${String(currencies)} currencies`;
}
const byPerson = await moneyCall(withKey(SUPERVISOR_123, "rates-123"), "rate.load", TUESDAY_SHEET);
console.log("  Tuesday 15:00, user_123 tries to load rates:", loadHeard(byPerson));
const byLoader = await moneyCall(withKey(RATE_LOADER, "rates-tue"), "rate.load", TUESDAY_SHEET);
console.log("  Tuesday 15:00, dsor-rates loads Tuesday's sheet:", loadHeard(byLoader));
const moneyDraft = (id: string, key: string): Promise<Answer> =>
  moneyCall(withKey(AGENT, key), "payment.create", {
    invoice: `dsor://org_456/invoice/${id}`,
    expected_version: 1,
  });
// Five minutes later, the agent drafts. Found by step 26's review: the clock said 15:00.
moneyClock.now = Date.parse("2026-10-06T15:05:00Z");
for (const [id, amount] of [
  ["INV-2002", "9,000.00 EUR"],
  ["INV-2003", "49,000.00 GBP"],
  ["INV-2004", "14,000,000.00 PKR"],
] as const) {
  const answer = await moneyDraft(id, `money-${id}`);
  console.log(`  Tuesday 15:05, the agent drafts ${id}, ${amount}:`, heard(answer));
}
const dayTotal = await moneyReservations.used("org_456", "del_100", "USD");
console.log(`  the day's total under del_100: ${dayTotal} USD`);
// Saturday 09:00: Tuesday's sheet is older than org_456's P3D, and no newer sheet came.
moneyClock.now = Date.parse("2026-10-10T09:00:00Z");
const saturday = await moneyDraft("INV-2002", "money-saturday");
console.log("  Saturday 09:00, the agent drafts INV-2002 again:", heard(saturday));
// The agent's words name no currency, which its clearance hides. The decision's record names the
// currency and the cause (step 26's review, finding H1).
const saturdayRecord = (await moneyLog.records()).find(
  (r) => r.kind === "decision" && r.correlation.request_id === saturday.correlation.request_id,
);
const why = saturdayRecord?.extensions?.["org.panaversity.steps"]?.unconvertible;
console.log(`  its record says why: no usable rate for ${why?.currency} (${why?.why})`);

// The company's rule, told in memory with a clock of its own. org_456's control
// high-value-payment v8 says that a payment above 25,000.00 USD needs the CFO. Start-up checked it
// and ran its five tests. Tuesday's sheet converts, and del_100 still allows 50,000.00 USD for one
// payment (step 27's README, the story's numbers).
console.log("the company's rule, in memory, with a clock of its own:");
const ruleClock = { now: Date.parse("2026-10-06T15:05:00Z") };
const ruleInvoices = memoryInvoices([
  ...structuredClone(invoices),
  bill("INV-2002", "9000.00", "EUR"),
  bill("INV-2003", "49000.00", "GBP"),
  bill("INV-2004", "14000000.00", "PKR"),
  bill("INV-2006", "100000", "JPY"),
]);
const rulePayments = memoryPayments([]);
const ruleProposals = memoryProposals(() => ruleClock.now);
const ruleReservations = memoryReservations(() => ruleClock.now);
const ruleRates = memoryRates(() => ruleClock.now);
const ruleSlips = memorySlips(limited);
const ruleWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  ruleInvoices,
  rulePayments,
  ruleSlips,
  directories,
  readRoleSettings(),
  memoryClaims(
    ruleInvoices,
    rulePayments,
    ruleProposals,
    ruleReservations,
    ruleSlips,
    undefined,
    ruleRates,
    // And the same store of rules as the registry below.
    storyRules,
  ),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  // The controls.json start-up checked, the first world of the program that has the company's
  // rules.
  // In the store that controls.json filled, which start-up checked.
  storyRules,
);
const ruleLog = createLog();
const ruleCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(ruleWorld, ruleLog, who, name, input);
await ruleRates.load("org_456", {
  source: "ecb-daily",
  base: "EUR",
  published_at: "2026-10-06T14:00:00.000Z",
  rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
});
/** A call that waits, as its caller heard it: whose approval it needs, and until when. */
function waitHeard(answer: Answer): string {
  if (!("outcome" in answer) || answer.outcome !== "PENDING_APPROVAL") return heard(answer);
  const needs = answer.requires
    .map((r) => `${r.approval.role} x${r.approval.quorum} (${r.control})`)
    .join(", ");
  return `PENDING_APPROVAL, needs ${needs}, until ${answer.expires_at}`;
}
const ruleDraft = (who: RequestEnvelope, id: string, key: string): Promise<Answer> =>
  ruleCall(withKey(who, key), "payment.create", {
    invoice: `dsor://org_456/invoice/${id}`,
    expected_version: 1,
  });
const waitingFor1008 = await ruleDraft(AGENT, "INV-1008", "rule-INV-1008");
console.log(
  "  Tuesday 15:05, the agent drafts INV-1008, 31,400.00 USD:",
  waitHeard(waitingFor1008),
);
for (const [id, amount] of [
  ["INV-2002", "9,000.00 EUR"],
  ["INV-2004", "14,000,000.00 PKR"],
  ["INV-2003", "49,000.00 GBP"],
] as const) {
  const answer = await ruleDraft(AGENT, id, `rule-${id}`);
  console.log(`  Tuesday 15:05, the agent drafts ${id}, ${amount}:`, waitHeard(answer));
}
// A person's own call meets the rule too (step 27's README, decision D15). No sheet lists JPY, so
// the condition cannot be checked, and the effect applies (DSOR-CTL-07).
const ownJpy = await ruleDraft(SUPERVISOR_123, "INV-2006", "rule-INV-2006");
console.log("  Tuesday 15:05, user_123 drafts INV-2006, 100,000 JPY:", waitHeard(ownJpy));
const ruleRecordOf = async (answer: Answer) =>
  (await ruleLog.records()).find(
    (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
  );
for (const [what, answer] of [
  ["INV-1008's", waitingFor1008],
  ["INV-2006's", ownJpy],
] as const) {
  const record = await ruleRecordOf(answer);
  for (const control of record?.controls ?? []) {
    const error =
      control.evaluation_error === undefined ? "" : `, error: ${control.evaluation_error}`;
    console.log(
      `  ${what} record: ${record?.authorization} ${record?.result}, ${control.id} v${control.version} ${control.outcome}${error}`,
    );
  }
}
// A dry run says what the real call would get, and books nothing (step 27's README, decision D12).
// Of INV-1004, 27,300.00 USD, since INV-1008 waits above, in flight, and a dry
//   run of it would hear CONFLICT (DSOR-EXC-01; step 32's README, decision D6).
const dry1008 = await ruleCall({ ...AGENT, mode: "validate_only" }, "payment.create", {
  invoice: "dsor://org_456/invoice/INV-1004",
  expected_version: 1,
});
console.log(
  "  a dry run of INV-1004:",
  "decision" in dry1008 ? `${dry1008.outcome}, ${dry1008.decision}` : heard(dry1008),
);
console.log(
  `  the day's total under del_100: ${await ruleReservations.used("org_456", "del_100", "USD")} USD`,
);
// Nobody approves in this story: step 29's own story below does. A week later the waiting payments
// are past their time, and the sweep expires them and gives their bookings back (step 27's README,
// decision D11).
ruleClock.now = Date.parse("2026-10-13T15:05:00Z");
const ruleSweep = await ruleCall(withKey(SCHEDULER, "rule-sweep"), "proposal.expire_due", ORG_456);
console.log("  a week later, dsor-scheduler sweeps org_456:", sweepHeard(ruleSweep));
const ruleId = String("proposal" in waitingFor1008 ? waitingFor1008.proposal : "")
  .split("/")
  .at(-1)!;
const ruleExpired = await ruleProposals.get("org_456", ruleId);
const ruleBooking = await ruleReservations.get("org_456", ruleId);
console.log(
  `  INV-1008's payment: ${ruleExpired?.state ?? "none"}, its booking ${ruleBooking?.state ?? "none"}`,
);

// Who may switch a rule on, in memory, in a world of its own whose store starts
// from controls.json, as start-up checked it. Version 8 asks for the CFO above 25,000.00 USD.
// cfo_100, its owner, drafts version 9, above 20,000.00 USD. admin_100, a tenant administrator,
// drafts version 10, which says false and names admin_100 its owner, and cannot switch it on. The
// agent cannot switch anything on. A version with step 27's quick rule fails its test. cfo_100
// switches version 9 on, suspends it, and switches it on again, and each change applies to the
// agent's next payment (step 28's README, the story's numbers).
console.log("who may switch a rule on, in memory, with a store of its own:");
const lifeClock = { now: Date.parse("2026-10-06T15:05:00Z") };
const lifeInvoices = memoryInvoices([
  ...structuredClone(invoices),
  // Above version 9's 20,000.00 USD and below version 8's 25,000.00 USD, so it shows which answers.
  bill("INV-2007", "21000.00", "USD"),
]);
const lifePayments = memoryPayments([]);
const lifeProposals = memoryProposals(() => lifeClock.now);
const lifeReservations = memoryReservations(() => lifeClock.now);
const lifeRates = memoryRates(() => lifeClock.now);
const lifeSlips = memorySlips(limited);
// The file start-up checked fills this world's own store, which its registry and its claims share.
const lifeRules = memoryControls(readControls(CONTROLS));
// Each company's KSoR, a stand-in. org_456's has version 4 of its
// payment-approval policy in force, with the fingerprint version 8 cites; org_789's rules cite
// local. A switch-on asks it (step 28b's README, decisions D1 and D12).
const PAYMENT_POLICY = "ksor://org_456/finance/payment-approval-policy";
/** Each company's KSoR as a story begins. */
function storyKsors(): Map<string, FakeKsor> {
  const text = "Payments above 25,000 USD or equivalent require CFO approval.";
  const v4 = { version: 4, text, content_hash: "sha256:9f2c1e7ab4d0" };
  return new Map([
    ["org_456", fakeKsor("org_456", { [PAYMENT_POLICY]: [v4] })],
    ["org_789", fakeKsor("org_789", {})],
  ]);
}
const lifeWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  lifeInvoices,
  lifePayments,
  lifeSlips,
  directories,
  readRoleSettings(),
  memoryClaims(
    lifeInvoices,
    lifePayments,
    lifeProposals,
    lifeReservations,
    lifeSlips,
    undefined,
    lifeRates,
    lifeRules,
  ),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  lifeRules,
  storyKsors(),
);
const lifeLog = createLog();
const lifeCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(lifeWorld, lifeLog, who, name, input);
const CFO_100: RequestEnvelope = { token: "tok_d4e8", tenant: "org_456" };
const RULE = "dsor://org_456/rule/high-value-payment";
/** A rule command's answer, as its caller heard it: the version and its status, or the refusal. */
function ruleHeard(answer: Answer): string {
  if (!("data" in answer)) return heard(answer);
  const { version, status, retired } = answer.data as Record<string, unknown>;
  const after = retired === undefined ? "" : `, version ${String(retired)} retired`;
  return `version ${String(version)}, ${String(status)}${after}`;
}
let lifeKeys = 0;
/** Someone asks for a rule command on the story's rule, with a key of its own. */
const lifeRule = (who: RequestEnvelope, name: string, fields: Record<string, unknown>) =>
  lifeCall(withKey(who, `life-${++lifeKeys}`), name, { rule: RULE, ...fields });
/** The agent drafts a payment of one of org_456's bills, with a key of its own. */
const lifePay = (id: string): Promise<Answer> =>
  lifeCall(withKey(AGENT, `life-${id}`), "payment.create", {
    invoice: `dsor://org_456/invoice/${id}`,
    expected_version: 1,
  });
// Version 8, as the file start-up checked writes it.
const VERSION_8 = (JSON.parse(readControls(CONTROLS).text) as { org_456: object[] }).org_456[0];
// The fields of a rule's text, which a draft gives. DSoR sets the other six (step 28's README,
// decision D11).
const TEXT = [
  "operation",
  "condition",
  "effect",
  "authority",
  "owner",
  "on_stale",
  "stale_grace",
  "tests",
  "extensions",
];
/** Version 8's text, without the six fields DSoR sets, with these changes. */
function textWith(changes: Record<string, unknown>): Record<string, unknown> {
  const text = Object.entries(VERSION_8 ?? {}).filter(([field]) => TEXT.includes(field));
  return { ...Object.fromEntries(text), ...changes };
}
const usd = (value: string) => ({ invoice: { open_amount: { value, currency: "USD" } } });
const pkr = (value: string) => ({ invoice: { open_amount: { value, currency: "PKR" } } });
// Version 9's tests move with its line: 5,000,000.00 PKR at 280 is 17,857.14 USD, below it.
const NINE_TESTS = [
  { state: usd("20000.00"), expect: "ALLOW" },
  { state: usd("20000.01"), expect: "REQUIRE_APPROVAL" },
  { state: pkr("50000000.00"), rates: { PKR: "280" }, expect: "REQUIRE_APPROVAL" },
  { state: pkr("5000000.00"), rates: { PKR: "280" }, expect: "ALLOW" },
  {
    state: { invoice: { open_amount: { value: "100.00", currency: "XXX" } } },
    expect: "REQUIRE_APPROVAL",
  },
];
const ABOVE_20000 = 'dsor_exceeds(state.invoice.open_amount, dsor_money("20000", "USD"))';
const QUICK =
  'double(state.invoice.open_amount.value) > 20000.0 && state.invoice.open_amount.currency == "USD"';
console.log("  the agent drafts INV-1012, 22,750.00 USD:", waitHeard(await lifePay("INV-1012")));
const nine = await lifeRule(CFO_100, "rule.draft", {
  draft: textWith({ condition: ABOVE_20000, tests: NINE_TESTS }),
  reason: "the board lowered the line to 20,000 USD",
});
console.log("  cfo_100 drafts the rule above 20,000.00 USD:", ruleHeard(nine));
const ten = await lifeRule(ADMIN_100, "rule.draft", {
  draft: textWith({ condition: "false", owner: "admin_100", tests: [{ expect: "ALLOW" }] }),
  reason: "no more waiting for the CFO",
});
console.log("  admin_100 drafts the rule false, naming admin_100 its owner:", ruleHeard(ten));
const tenOn = await lifeRule(ADMIN_100, "rule.activate", { version: 10, reason: "switch it on" });
console.log("  admin_100 switches version 10 on:", ruleHeard(tenOn));
const agentOn = await lifeCall(withKey(AGENT, "life-agent"), "rule.activate", {
  rule: RULE,
  version: 9,
  reason: "the agent's own idea",
});
console.log("  the agent switches version 9 on:", ruleHeard(agentOn));
const quick = await lifeRule(CFO_100, "rule.draft", {
  draft: textWith({ condition: QUICK, tests: NINE_TESTS }),
  reason: "a quicker rule",
});
console.log("  cfo_100 drafts step 27's quick rule:", ruleHeard(quick));
const quickOn = await lifeRule(CFO_100, "rule.activate", { version: 11, reason: "switch it on" });
console.log("  cfo_100 switches version 11 on:", ruleHeard(quickOn));
const nineOn = await lifeRule(CFO_100, "rule.activate", { version: 9, reason: "the new line" });
console.log("  cfo_100 switches version 9 on:", ruleHeard(nineOn));
console.log("  the agent drafts INV-2007, 21,000.00 USD:", waitHeard(await lifePay("INV-2007")));
const nineOff = await lifeRule(CFO_100, "rule.suspend", { version: 9, reason: "audit week" });
console.log("  cfo_100 suspends version 9:", ruleHeard(nineOff));
console.log("  the agent drafts INV-1008, 31,400.00 USD:", waitHeard(await lifePay("INV-1008")));
const nineBack = await lifeRule(CFO_100, "rule.activate", { version: 9, reason: "audit over" });
console.log("  cfo_100 switches version 9 on again:", ruleHeard(nineBack));
console.log("  the agent drafts INV-1004, 27,300.00 USD:", waitHeard(await lifePay("INV-1004")));
// Each change left its record, in the change's own transaction (step 28's README, decision D14).
for (const change of await lifeRules.records()) {
  const { version, from } = change.extensions["org.panaversity.steps"] ?? {};
  const left = from === undefined ? "new" : `from ${from}`;
  console.log(
    `  the record: version ${String(version)} ${change.result}, ${left}, by ${change.identity.subject}: ${change.reason}`,
  );
}

// Where a rule came from, in memory, with a store and a KSoR of its own.
// dsor-scheduler sweeps, and finds version 4 of the policy in force. The finance team publishes
// version 5 in KSoR: above 20,000 USD. Version 8 pays the agent's 21,000.00 USD until the next
// sweep, which marks version 8 stale and leaves cfo_100 a notice. Then version 8 asks for the CFO
// on every payment, as its on_stale says, and the record names the policy's version in force.
// cfo_100 cannot switch on a version that still cites version 4; a version that cites version 5
// switches on, and retires version 8 (step 28b's README, the story's numbers).
console.log("where a rule came from, in memory, with a store and a KSoR of its own:");
const driftInvoices = memoryInvoices([
  ...structuredClone(invoices),
  // Above version 5's 20,000.00 USD and below version 4's 25,000.00 USD, so they show which
  // answers. And one small payment, and one under both lines.
  bill("INV-2007", "21000.00", "USD"),
  bill("INV-2008", "21000.00", "USD"),
  bill("INV-2009", "900.00", "USD"),
  bill("INV-2010", "19500.00", "USD"),
  bill("INV-2011", "21000.00", "USD"),
]);
const driftPayments = memoryPayments([]);
const driftSlips = memorySlips(limited);
const driftRates = memoryRates(() => lifeClock.now);
const driftRules = memoryControls(readControls(CONTROLS));
const driftKsors = storyKsors();
const driftWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  driftInvoices,
  driftPayments,
  driftSlips,
  directories,
  readRoleSettings(),
  memoryClaims(
    driftInvoices,
    driftPayments,
    memoryProposals(() => lifeClock.now),
    memoryReservations(() => lifeClock.now),
    driftSlips,
    undefined,
    driftRates,
    driftRules,
  ),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  driftRules,
  driftKsors,
);
const driftLog = createLog();
const driftCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(driftWorld, driftLog, who, name, input);
let driftKeys = 0;
/** Someone asks for a rule command on the story's rule, in this world, with a key of its own. */
const driftRule = (who: RequestEnvelope, name: string, fields: Record<string, unknown>) =>
  driftCall(withKey(who, `drift-${++driftKeys}`), name, { rule: RULE, ...fields });
/** The agent drafts a payment of one of org_456's bills, in this world. */
const driftPay = (id: string): Promise<Answer> =>
  driftCall(withKey(AGENT, `drift-${id}`), "payment.create", {
    invoice: `dsor://org_456/invoice/${id}`,
    expected_version: 1,
  });
/** dsor-scheduler sweeps org_456, and what it answered. */
async function driftSweep(): Promise<string> {
  const company = { company: "dsor://org_456/tenant/org_456" };
  const key = withKey(SCHEDULER, `drift-sweep-${++driftKeys}`);
  const answer = await driftCall(key, "rule.check_authority", company);
  if (!("data" in answer)) return heard(answer);
  const { asked, unanswered, marked } = answer.data as Record<string, number>;
  const policies = asked === 1 ? "policy" : "policies";
  return `asked about ${asked} ${policies}, ${unanswered} unanswered, marked ${marked}`;
}
console.log("  dsor-scheduler sweeps org_456:", await driftSweep());
const above20000 = "Payments above 20,000 USD or equivalent require CFO approval.";
const v5 = driftKsors.get("org_456")!.publish(PAYMENT_POLICY, above20000);
console.log(
  `  the finance team publishes version ${v5.version} of the payment-approval policy in KSoR: above 20,000 USD`,
);
console.log("  the agent drafts INV-2007, 21,000.00 USD:", waitHeard(await driftPay("INV-2007")));
console.log("  dsor-scheduler sweeps org_456:", await driftSweep());
for (const notice of await driftRules.notices()) {
  console.log(`  the notice to ${notice.to}: ${notice.words}`);
}
const staleDraft = await driftPay("INV-2008");
console.log("  the agent drafts INV-2008, 21,000.00 USD:", waitHeard(staleDraft));
console.log("  the agent drafts INV-2009, 900.00 USD:", waitHeard(await driftPay("INV-2009")));
// The record names the version that version 8 cites, marked superseded, and beside it the policy's
// version in force (DSOR-CTL-04; step 28b's README, decision D11).
const staleRecord = (await driftLog.records()).find(
  (r) => r.kind === "decision" && r.correlation.request_id === staleDraft.correlation.request_id,
);
const staleBeside = staleRecord?.extensions?.["org.panaversity.steps"]?.stale ?? [];
for (const c of staleRecord?.controls ?? []) {
  const cites = `cites version ${String(c.authority["version"])}`;
  const superseded = `superseded_version ${String(c.superseded_version)}`;
  const inForce = staleBeside.find((s) => s.control === c.id)?.in_force.version;
  const beside = `and beside it the policy's version ${String(inForce)} in force`;
  console.log(
    `  INV-2008's record: ${c.id} version ${c.version}, ${c.outcome}, ${cites}, ${superseded}, ${beside}`,
  );
}
const still4 = await driftRule(CFO_100, "rule.draft", {
  draft: textWith({ condition: ABOVE_20000, tests: NINE_TESTS }),
  reason: "the board lowered the line to 20,000 USD",
});
console.log(
  "  cfo_100 drafts version 9 above 20,000.00 USD, still citing version 4:",
  ruleHeard(still4),
);
const still4On = await driftRule(CFO_100, "rule.activate", { version: 9, reason: "the new line" });
console.log("  cfo_100 switches version 9 on:", ruleHeard(still4On));
const cited = (VERSION_8 as { authority: Record<string, unknown> }).authority;
const citing5 = { ...cited, version: v5.version, content_hash: v5.content_hash };
const cites5 = await driftRule(CFO_100, "rule.draft", {
  draft: textWith({ condition: ABOVE_20000, tests: NINE_TESTS, authority: citing5 }),
  reason: "version 5 of the policy",
});
console.log(
  "  cfo_100 drafts version 10 above 20,000.00 USD, citing version 5:",
  ruleHeard(cites5),
);
const cites5On = await driftRule(CFO_100, "rule.activate", { version: 10, reason: "version 5" });
console.log("  cfo_100 switches version 10 on:", ruleHeard(cites5On));
console.log("  the agent drafts INV-2010, 19,500.00 USD:", waitHeard(await driftPay("INV-2010")));
console.log("  the agent drafts INV-2011, 21,000.00 USD:", waitHeard(await driftPay("INV-2011")));

// Approvals, in memory, with a store of their own (step 29's README, the story's
// numbers). The agent drafts INV-1008, 31,400.00 USD, and it waits for the CFO. The agent cannot
// approve its own payment, and neither can admin_100, whom the rule does not ask. cfo_100 approves
// it first with the fingerprint of the 900.00 USD payment, and DSoR refuses; then with its own, and
// it is APPROVED. Then cfo_100 switches on a second rule of org_456's own, and INV-2012, 35,000.00
// USD, waits for the CFO and a tenant administrator: one approval is not enough. Nothing releases
// an approved payment in this world, so nothing more is drafted. Changed in step 31: the release
// has scenes of its own, below, in a world of their own.
console.log("approvals, in memory, with a store of their own:");
const approvalInvoices = memoryInvoices([
  ...structuredClone(invoices),
  bill("INV-2009", "900.00", "USD"),
  // Above both rules' lines.
  bill("INV-2012", "35000.00", "USD"),
  // Above the AP supervisor's line, and below the CFO's.
  bill("INV-2013", "12000.00", "USD"),
]);
const approvalDrafted: Payment[] = [];
const approvalPayments = memoryPayments(approvalDrafted);
const approvalSlips = memorySlips(limited);
const approvalProposals = memoryProposals(() => lifeClock.now);
const approvalRules = memoryControls(readControls(CONTROLS));
const approvalWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  approvalInvoices,
  approvalPayments,
  approvalSlips,
  directories,
  readRoleSettings(),
  memoryClaims(
    approvalInvoices,
    approvalPayments,
    approvalProposals,
    memoryReservations(() => lifeClock.now),
    approvalSlips,
    undefined,
    memoryRates(() => lifeClock.now),
    approvalRules,
  ),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  approvalRules,
  storyKsors(),
);
const approvalLog = createLog();
const approvalCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(approvalWorld, approvalLog, who, name, input);
let approvalKeys = 0;
/** The agent drafts a payment of one of org_456's bills, in this world. */
const approvalPay = (id: string): Promise<Answer> =>
  approvalCall(withKey(AGENT, `approval-${id}`), "payment.create", {
    invoice: `dsor://org_456/invoice/${id}`,
    expected_version: 1,
  });
/** The proposal an answer names, as an approval screen reads it from DSoR's own store. */
async function screenOf(answer: Answer): Promise<{ uri: string; payload_hash: string }> {
  const id =
    String("proposal" in answer ? answer.proposal : "")
      .split("/")
      .at(-1) ?? "";
  const kept = await approvalProposals.get("org_456", id);
  if (kept === undefined) throw new Error("the story's proposal is not there");
  return { uri: kept.uri, payload_hash: kept.payload_hash };
}
/** Someone approves a proposal with a fingerprint, with a key of its own, and what they heard. */
async function approveAs(who: RequestEnvelope, uri: string, payload_hash: string): Promise<string> {
  const key = withKey(who, `approval-${++approvalKeys}`);
  const answer = await approvalCall(key, "proposal.approve", { proposal: uri, payload_hash });
  if (!("data" in answer)) return heard(answer);
  const { id, state, waits_for } = answer.data as {
    id: string;
    state: string;
    waits_for: { approval: { role: string } }[];
  };
  if (state === "APPROVED") return `APPROVED, by approval ${id}`;
  return `${state}, still waits for ${waits_for.map((r) => r.approval.role).join(" and ")}`;
}
const small = await approvalPay("INV-2009");
console.log("  the agent drafts INV-2009, 900.00 USD:", waitHeard(small));
const large = await approvalPay("INV-1008");
console.log("  the agent drafts INV-1008, 31,400.00 USD:", waitHeard(large));
// An approval screen reads both from DSoR's store: its address, and the fingerprint of its request.
const largeScreen = await screenOf(large);
const smallScreen = await screenOf(small);
const approveLarge = (who: RequestEnvelope, payload_hash = largeScreen.payload_hash) =>
  approveAs(who, largeScreen.uri, payload_hash);
console.log("  the agent approves its own payment:", await approveLarge(AGENT));
console.log("  admin_100 approves it:", await approveLarge(ADMIN_100));
console.log(
  "  cfo_100 approves it, with the 900.00 USD payment's fingerprint:",
  await approveLarge(CFO_100, smallScreen.payload_hash),
);
console.log("  cfo_100 approves it, with its own fingerprint:", await approveLarge(CFO_100));
console.log("  cfo_100 approves it again:", await approveLarge(CFO_100));
// A second rule of org_456's own, with no policy in KSoR behind it: local (DSOR-CTL-01b).
const ADMIN_RULE = "dsor://org_456/rule/admin-above-30000";
const adminDraft = await approvalCall(withKey(CFO_100, "approval-rule-draft"), "rule.draft", {
  rule: ADMIN_RULE,
  draft: textWith({
    condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
    effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
    authority: { system: "local" },
    tests: [
      { state: usd("30000.00"), expect: "ALLOW" },
      { state: usd("30000.01"), expect: "REQUIRE_APPROVAL" },
    ],
  }),
  reason: "a tenant administrator approves every payment above 30,000 USD too",
});
console.log("  cfo_100 drafts admin-above-30000, a rule of org_456's own:", ruleHeard(adminDraft));
const adminOn = await approvalCall(withKey(CFO_100, "approval-rule-on"), "rule.activate", {
  rule: ADMIN_RULE,
  version: 1,
  reason: "the board asked for a second pair of eyes",
});
console.log("  cfo_100 switches it on:", ruleHeard(adminOn));
const both = await approvalPay("INV-2012");
console.log("  the agent drafts INV-2012, 35,000.00 USD:", waitHeard(both));
const bothScreen = await screenOf(both);
console.log(
  "  cfo_100 approves it:",
  await approveAs(CFO_100, bothScreen.uri, bothScreen.payload_hash),
);
console.log(
  "  admin_100 approves it:",
  await approveAs(ADMIN_100, bothScreen.uri, bothScreen.payload_hash),
);
// Approved is not paid: proposal.execute releases an approved proposal, in step 31's scenes below.
console.log(
  `  payments drafted: ${approvalDrafted.length}, INV-2009's; the approved ones wait for their release`,
);

// Who may not approve, in the same world (step 30's README, the story's numbers).
// cfo_100 writes and switches on a third rule of org_456's own: above 10,000 USD, one AP supervisor
// approves (decision D6). user_123 is the company's only AP supervisor, and signed del_100, the
// agent's slip. So no one may approve the agent's INV-1012, or user_123's own INV-2013, and both wait
// until they expire: the price of segregation of duties in a small team.
console.log("who may not approve, in memory, in the same world:");
const SUPERVISOR_RULE = "dsor://org_456/rule/supervisor-above-10000";
const supervisorDraft = await approvalCall(withKey(CFO_100, "sod-rule-draft"), "rule.draft", {
  rule: SUPERVISOR_RULE,
  draft: textWith({
    condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("10000", "USD"))',
    effect: { require_approval: { role: "ap_supervisor", quorum: 1 } },
    authority: { system: "local" },
    tests: [
      { state: usd("10000.00"), expect: "ALLOW" },
      { state: usd("10000.01"), expect: "REQUIRE_APPROVAL" },
    ],
  }),
  reason: "an AP supervisor approves every payment above 10,000 USD",
});
console.log(
  "  cfo_100 drafts supervisor-above-10000, a rule of org_456's own:",
  ruleHeard(supervisorDraft),
);
const supervisorOn = await approvalCall(withKey(CFO_100, "sod-rule-on"), "rule.activate", {
  rule: SUPERVISOR_RULE,
  version: 1,
  reason: "a second pair of eyes on every payment above 10,000 USD",
});
console.log("  cfo_100 switches it on:", ruleHeard(supervisorOn));
const agents = await approvalPay("INV-1012");
console.log("  the agent drafts INV-1012, 22,750.00 USD:", waitHeard(agents));
const agentsScreen = await screenOf(agents);
console.log(
  "  user_123, who signed del_100, approves it:",
  await approveAs(SUPERVISOR_123, agentsScreen.uri, agentsScreen.payload_hash),
);
console.log(
  "  cfo_100 approves it:",
  await approveAs(CFO_100, agentsScreen.uri, agentsScreen.payload_hash),
);
const own = await approvalCall(withKey(SUPERVISOR_123, "sod-INV-2013"), "payment.create", {
  invoice: "dsor://org_456/invoice/INV-2013",
  expected_version: 1,
});
console.log("  user_123 drafts INV-2013, 12,000.00 USD, on their own login:", waitHeard(own));
const ownScreen = await screenOf(own);
console.log(
  "  user_123 approves it:",
  await approveAs(SUPERVISOR_123, ownScreen.uri, ownScreen.payload_hash),
);
console.log(
  "  the agent approves INV-1012:",
  await approveAs(AGENT, agentsScreen.uri, agentsScreen.payload_hash),
);
/** The state of the proposal an answer names, as DSoR keeps it. */
async function stateOfAnswer(answer: Answer): Promise<string> {
  const id =
    String("proposal" in answer ? answer.proposal : "")
      .split("/")
      .at(-1) ?? "";
  return (await approvalProposals.get("org_456", id))?.state ?? "not there";
}
// Found by step 30's review, finding L6: this line was a fixed sentence, and a break of segregation
// of duties would have left it as it was. The states come from DSoR's store now.
console.log(
  `  INV-1012's proposal: ${await stateOfAnswer(agents)}, INV-2013's: ${await stateOfAnswer(own)};` +
    " org_456 has no AP supervisor outside their chains",
);

// The release, in memory, in a world of its own (step 31's README, decision D11
//   and the story's numbers). The world above has two more rules on, switched on after INV-1008
//   was approved, so its release would be invalidated there. Here only the CFO's rule is on at
//   first. The agent releases INV-1008, which cfo_100 approved, and the payment is drafted. Then
//   INV-2012 is approved by the CFO and a tenant administrator, and cfo_100 switches on a version
//   that asks for two CFOs: its release is invalidated, and its booking goes back to the day. A
//   release that sends a new invoice is refused at line ⑥. Last, user_123 releases a payment that
//   the agent prepared in propose_only mode.
console.log("releases, in memory, in a world of their own:");
const releaseInvoices = memoryInvoices([
  ...structuredClone(invoices),
  bill("INV-2012", "35000.00", "USD"),
]);
const releaseDrafted: Payment[] = [];
const releasePayments = memoryPayments(releaseDrafted);
const releaseSlips = memorySlips(limited);
const releaseProposals = memoryProposals(() => lifeClock.now);
const releaseBookings = memoryReservations(() => lifeClock.now);
const releaseRules = memoryControls(readControls(CONTROLS));
const releaseWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  releaseInvoices,
  releasePayments,
  releaseSlips,
  directories,
  readRoleSettings(),
  memoryClaims(
    releaseInvoices,
    releasePayments,
    releaseProposals,
    releaseBookings,
    releaseSlips,
    undefined,
    memoryRates(() => lifeClock.now),
    releaseRules,
  ),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  releaseRules,
  storyKsors(),
);
const releaseLog = createLog();
let releaseKeys = 0;
/** One call in this world, with a key of its own unless the envelope names a mode. */
const releaseCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(releaseWorld, releaseLog, withKey(who, `release-${++releaseKeys}`), name, input);
/** The proposal an answer names, as DSoR keeps it. */
async function keptOf(answer: Answer) {
  const id =
    String("proposal" in answer ? answer.proposal : "")
      .split("/")
      .at(-1) ?? "";
  const kept = await releaseProposals.get("org_456", id);
  if (kept === undefined) throw new Error("the story's proposal is not there");
  return kept;
}
/** Someone approves the proposal an answer names, with its own fingerprint, and what DSoR says. */
async function approvesIt(who: RequestEnvelope, answer: Answer): Promise<string> {
  const { uri, payload_hash } = await keptOf(answer);
  const approval = await releaseCall(who, "proposal.approve", { proposal: uri, payload_hash });
  if (!("data" in approval)) return heard(approval);
  return String((approval.data as { state: string }).state);
}
/** Someone releases the proposal an answer names, and what they hear, with the payment drafted. */
async function releasesIt(who: RequestEnvelope, answer: Answer, more = {}): Promise<string> {
  const { uri } = await keptOf(answer);
  const released = await releaseCall(who, "proposal.execute", { proposal: uri, ...more });
  if (!("outcome" in released)) return heard(released);
  const last = releaseDrafted.at(-1);
  const paid =
    last === undefined
      ? ""
      : `, ${last.invoice_id} ${last.amount.value} ${last.amount.currency} drafted`;
  return `${released.outcome}${paid}`;
}
/** The proposal's state, and its booking's, as DSoR keeps them. */
async function endOf(answer: Answer): Promise<string> {
  const kept = await keptOf(answer);
  const id = kept.uri.split("/").at(-1) ?? "";
  const booking = (await releaseBookings.get("org_456", id))?.state ?? "none";
  return `${kept.state}, its booking ${booking}`;
}
const toRelease = await releaseCall(AGENT, "payment.create", {
  invoice: "dsor://org_456/invoice/INV-1008",
  expected_version: 1,
});
console.log("  the agent drafts INV-1008, 31,400.00 USD:", waitHeard(toRelease));
console.log("  cfo_100 approves it:", await approvesIt(CFO_100, toRelease));
console.log("  the agent releases it:", await releasesIt(AGENT, toRelease));
console.log("  INV-1008's proposal:", await endOf(toRelease));
// The second rule, as in step 29's scenes, so INV-2012 waits for two people.
const releaseAdminRule = await releaseCall(CFO_100, "rule.draft", {
  rule: ADMIN_RULE,
  draft: textWith({
    condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
    effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
    authority: { system: "local" },
    tests: [
      { state: usd("30000.00"), expect: "ALLOW" },
      { state: usd("30000.01"), expect: "REQUIRE_APPROVAL" },
    ],
  }),
  reason: "a tenant administrator approves every payment above 30,000 USD too",
});
const releaseAdminOn = await releaseCall(CFO_100, "rule.activate", {
  rule: ADMIN_RULE,
  version: (releaseAdminRule as { data: { version: number } }).data.version,
  reason: "the board asked for a second pair of eyes",
});
console.log("  cfo_100 switches on admin-above-30000:", ruleHeard(releaseAdminOn));
const twoPeople = await releaseCall(AGENT, "payment.create", {
  invoice: "dsor://org_456/invoice/INV-2012",
  expected_version: 1,
});
console.log("  the agent drafts INV-2012, 35,000.00 USD:", waitHeard(twoPeople));
console.log("  cfo_100 approves it:", await approvesIt(CFO_100, twoPeople));
console.log("  admin_100 approves it:", await approvesIt(ADMIN_100, twoPeople));
// On Thursday, a stricter version of the CFO's rule: two CFOs, above the same line.
const twoCfos = await releaseCall(CFO_100, "rule.draft", {
  rule: RULE,
  draft: textWith({ effect: { require_approval: { role: "CFO", quorum: 2 } } }),
  reason: "two CFOs approve every payment above 25,000 USD",
});
const twoCfosOn = await releaseCall(CFO_100, "rule.activate", {
  rule: RULE,
  version: (twoCfos as { data: { version: number } }).data.version,
  reason: "the board asked for two CFOs",
});
console.log("  cfo_100 switches on a version that asks for two CFOs:", ruleHeard(twoCfosOn));
console.log("  the agent releases INV-2012:", await releasesIt(AGENT, twoPeople));
console.log("  INV-2012's proposal:", await endOf(twoPeople));
// The release takes the proposal's address and nothing else (DSOR-APR-13).
console.log(
  "  the agent releases INV-1008's proposal and sends invoice INV-1002 with it:",
  await releasesIt(AGENT, toRelease, { invoice: "dsor://org_456/invoice/INV-1002" }),
);
const prepared1009 = await call(
  releaseWorld,
  releaseLog,
  { ...withKey(AGENT, "release-prepare-INV-1009"), mode: "propose_only" },
  "payment.create",
  { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 },
);
console.log(
  "  the agent prepares INV-1009, 7,425.00 USD, in propose_only mode:",
  heard(prepared1009),
);
console.log("  user_123 releases it:", await releasesIt(SUPERVISOR_123, prepared1009));
console.log(
  `  payments drafted in this world: ${releaseDrafted.map((p) => p.invoice_id).join(", ")}`,
);

// Preconditions and one attempt at a time, in memory, in a world of its own
//   (step 32's README, decision D12 and the story's numbers). The agent asks twice for INV-1008:
//   the second attempt is refused, naming the first, which waits for the CFO. cfo_100 approves it,
//   the accounts team suspends VENDOR-44, and the agent's release reads the vendor again: the
//   proposal is invalidated, and its booking goes back to the day. Last, user_123 asks for a
//   payment of INV-1005, a draft invoice, and the contract's precondition refuses it.
console.log("preconditions and one attempt at a time, in memory, in a world of their own:");
const attemptVendors = structuredClone(vendors);
const attemptInvoices = memoryInvoices(structuredClone(invoices), attemptVendors);
const attemptDrafted: Payment[] = [];
const attemptPayments = memoryPayments(attemptDrafted);
const attemptSlips = memorySlips(limited);
const attemptProposals = memoryProposals(() => lifeClock.now);
const attemptBookings = memoryReservations(() => lifeClock.now);
const attemptRules = memoryControls(readControls(CONTROLS));
const attemptWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  attemptInvoices,
  attemptPayments,
  attemptSlips,
  directories,
  readRoleSettings(),
  memoryClaims(
    attemptInvoices,
    attemptPayments,
    attemptProposals,
    attemptBookings,
    attemptSlips,
    undefined,
    memoryRates(() => lifeClock.now),
    attemptRules,
  ),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  attemptRules,
  storyKsors(),
);
const attemptLog = createLog();
let attemptKeys = 0;
/** One call in this world, with a key of its own. */
const attemptCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(attemptWorld, attemptLog, withKey(who, `attempt-${++attemptKeys}`), name, input);
const ofInvoice = (id: string) => ({
  invoice: `dsor://org_456/invoice/${id}`,
  expected_version: 1,
});
const firstAttempt = await attemptCall(AGENT, "payment.create", ofInvoice("INV-1008"));
console.log("  the agent drafts INV-1008, 31,400.00 USD:", waitHeard(firstAttempt));
const secondAttempt = await attemptCall(AGENT, "payment.create", ofInvoice("INV-1008"));
console.log("  the agent drafts INV-1008 again, with a new key:", heard(secondAttempt));
const firstId =
  String("proposal" in firstAttempt ? firstAttempt.proposal : "")
    .split("/")
    .at(-1) ?? "";
const firstKept = await attemptProposals.get("org_456", firstId);
if (firstKept === undefined) throw new Error("the story's proposal is not there");
const attemptApproval = await attemptCall(CFO_100, "proposal.approve", {
  proposal: firstKept.uri,
  payload_hash: firstKept.payload_hash,
});
console.log(
  "  cfo_100 approves the first:",
  "data" in attemptApproval
    ? String((attemptApproval.data as { state: string }).state)
    : heard(attemptApproval),
);
attemptVendors.find((v) => v.tenant_id === "org_456" && v.id === "VENDOR-44")!.status = "suspended";
console.log("  the accounts team suspends VENDOR-44");
const attemptRelease = await attemptCall(AGENT, "proposal.execute", { proposal: firstKept.uri });
console.log("  the agent releases INV-1008:", heard(attemptRelease));
const attemptEnd = await attemptProposals.get("org_456", firstId);
const attemptBooking = (await attemptBookings.get("org_456", firstId))?.state ?? "none";
console.log(`  INV-1008's proposal: ${attemptEnd?.state}, its booking ${attemptBooking}`);
const draftInvoice = await attemptCall(SUPERVISOR_123, "payment.create", ofInvoice("INV-1005"));
console.log("  user_123 drafts INV-1005, a draft invoice:", heard(draftInvoice));
console.log(`  payments drafted in this world: ${attemptDrafted.length}`);

// The decision bundle, in memory, in a world of its own, on Tuesday's sheet of
//   ecb-daily (step 33's README, the story's numbers). The agent drafts INV-1008, and says why: a
//   weekly payment run, with the skill it used. cfo_100 approves it, and the agent releases it. The
//   release's bundle names who asked, the rule and the approval that met it, what DSoR read, and
//   how it ended, and keeps the agent's words apart. Then INV-2002, in EUR, names its conversion,
//   and the agent's "the CFO agreed by phone" changes nothing for INV-1004.
console.log("the decision bundle, in memory, in a world of its own:");
const bundleClock = { now: Date.parse("2026-10-06T15:05:00Z") };
const bundleInvoices = memoryInvoices(
  [...structuredClone(invoices), bill("INV-2002", "9000.00", "EUR")],
  structuredClone(vendors),
);
const bundlePayments = memoryPayments([]);
const bundleSlips = memorySlips(limited);
const bundleProposals = memoryProposals(() => bundleClock.now);
const bundleRates = memoryRates(() => bundleClock.now);
const bundleRules = memoryControls(readControls(CONTROLS));
const bundleWorld = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(INPUTS),
  readClassifications(CLASSIFICATIONS),
  bundleInvoices,
  bundlePayments,
  bundleSlips,
  directories,
  readRoleSettings(),
  memoryClaims(
    bundleInvoices,
    bundlePayments,
    bundleProposals,
    memoryReservations(() => bundleClock.now),
    bundleSlips,
    undefined,
    bundleRates,
    bundleRules,
  ),
  ownWorkFor(),
  undefined,
  undefined,
  undefined,
  bundleRules,
  storyKsors(),
);
await bundleRates.load("org_456", {
  source: "ecb-daily",
  base: "EUR",
  published_at: "2026-10-06T14:00:00.000Z",
  rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
});
const bundleLog = createLog();
let bundleKeys = 0;
/** One call in this world, with a key of its own, and what the agent says about itself. */
const bundleCall = (
  who: RequestEnvelope,
  name: string,
  input: unknown,
  said?: Record<string, unknown>,
): Promise<Answer> => {
  const envelope = withKey(who, `bundle-${++bundleKeys}`);
  return call(
    bundleWorld,
    bundleLog,
    said === undefined ? envelope : { ...envelope, agent_asserted: said },
    name,
    input,
  );
};
const WEEKLY = {
  skill: { uri: "viking://agent/skills/vendor-payment", version: 3, hash: "sha256:c0ffee5k111" },
  purpose: "weekly payment run",
};
const bundleDraft = await bundleCall(AGENT, "payment.create", ofInvoice("INV-1008"), WEEKLY);
console.log(
  "  the agent drafts INV-1008, 31,400.00 USD, for a weekly payment run:",
  waitHeard(bundleDraft),
);
const bundleId =
  String("proposal" in bundleDraft ? bundleDraft.proposal : "")
    .split("/")
    .at(-1) ?? "";
const bundleKept = await bundleProposals.get("org_456", bundleId);
if (bundleKept === undefined) throw new Error("the story's proposal is not there");
const bundleYes = await bundleCall(CFO_100, "proposal.approve", {
  proposal: bundleKept.uri,
  payload_hash: bundleKept.payload_hash,
});
console.log("  cfo_100 approves it:", heard(bundleYes));
const bundleRelease = await bundleCall(AGENT, "proposal.execute", { proposal: bundleKept.uri });
console.log("  the agent releases INV-1008:", heard(bundleRelease));
/** The bundle of the last call in this world. */
async function lastBundleOf(): Promise<SealedBundle> {
  const last = (await bundleLog.records()).at(-1)!;
  const found = (await bundleLog.bundles()).find((b) => b.decision_id === last.decision_bundle);
  if (found === undefined) throw new Error("the last call left no bundle");
  return found;
}
const released = await lastBundleOf();
const { identity, authority } = released;
console.log(`  the release's bundle: ${released.operation}, ${released.execution.result}`);
console.log(
  `    who: ${identity.mode}, ${identity.subject} through ${identity.actor_chain.join(", ")}, under ${String(authority.delegation)}`,
);
for (const rule of authority.controls) {
  console.log(
    `    rule: ${rule.id} version ${rule.version}, ${rule.outcome}, met by ${String(rule.satisfied_by)}`,
  );
}
console.log(
  `    approval: ${String(released.approval?.id)}, by ${String(released.approval?.approvers)}`,
);
for (const read of released.state) {
  console.log(`    read: ${read.uri} version ${String(read.version)}, ${read.freshness}`);
}
console.log(
  `    money: ${released.money.conversions.length === 0 ? "nothing converted" : "converted"}`,
);
// Each bundle keeps the words of its own call: the draft's, the agent's purpose and skill; the
//   release's, none, since the agent said nothing when it released (step 33's README, D11).
console.log(
  `    the agent says, in this call: ${JSON.stringify(released.agent_asserted ?? "nothing")}`,
);
const draftBundle = (await bundleLog.bundles())[0];
console.log(
  `  the draft's bundle keeps what the agent said then: ${JSON.stringify(draftBundle?.agent_asserted)}`,
);
const euros = await bundleCall(AGENT, "payment.create", ofInvoice("INV-2002"));
console.log("  the agent drafts INV-2002, 9,000.00 EUR:", heard(euros));
for (const { from, to, rate, source, as_of } of (await lastBundleOf()).money.conversions) {
  console.log(
    `    money: ${from.value} ${from.currency} is ${to.value} ${to.currency}, at ${rate}, from ${source}, as of ${as_of}`,
  );
}
const byPhone = await bundleCall(AGENT, "payment.create", ofInvoice("INV-1004"), {
  rationale: "the CFO agreed by phone",
});
console.log(
  '  the agent drafts INV-1004, 27,300.00 USD, saying "the CFO agreed by phone":',
  waitHeard(byPhone),
);
const kept = await bundleLog.bundles();
const valid = kept.filter((b) => bundleProblems(b).length === 0).length;
console.log(
  `  bundles in this world: ${kept.length}, ${valid} of them valid against decision-bundle.schema.json`,
);

// Connectors, in memory, in worlds of their own (step 34's README, the story's
//   numbers). The shipped declaration, and what each operation on the company's records needs from
//   it. Then org_789 keeps its records behind a connector of its own, which cannot undo a
//   half-finished job: org_789's calls are refused at line ④, and org_456's are not. Then the
//   default connector cannot undo one: DSoR does not start.
console.log("connectors, in memory, in worlds of their own:");
const shippedConnectors = JSON.parse(readConnectors().text) as {
  connectors: Record<string, unknown>[];
};
const accounting = shippedConnectors.connectors[0]!;
const says = Object.entries(accounting["capabilities"] as Record<string, unknown>)
  .map(([name, value]) => `${name} ${Array.isArray(value) ? value.join("/") : String(value)}`)
  .join(", ");
console.log(`  ${String(accounting["id"])}, ${String(accounting["write_exclusivity"])}: ${says}`);
/** A world whose connectors file is this one, with the story's rule, on Tuesday's sheet. */
// Changed in step 35: and this fake bank, these payments, and these proposals, which step 35's
//   scene reads.
async function connectorWorld(
  connectors: ConnectorsSource,
  fake: FakeBank = createFakeBank(),
  drafted: Payment[] = [],
  kept: ReturnType<typeof memoryProposals> = memoryProposals(() =>
    Date.parse("2026-10-06T15:05:00Z"),
  ),
) {
  const clock = { now: Date.parse("2026-10-06T15:05:00Z") };
  const store = memoryInvoices(structuredClone(invoices), structuredClone(vendors));
  const paid = memoryPayments(drafted);
  const slips = memorySlips(limited);
  const rates = memoryRates(() => clock.now);
  const rules = memoryControls(readControls(CONTROLS));
  const world = buildRegistry(
    readContracts(CONTRACTS),
    handlersFor(),
    readRoles(ROLES),
    readInputs(INPUTS),
    readClassifications(CLASSIFICATIONS),
    store,
    paid,
    slips,
    directories,
    readRoleSettings(),
    memoryClaims(
      store,
      paid,
      kept,
      memoryReservations(() => clock.now),
      slips,
      undefined,
      rates,
      rules,
    ),
    ownWorkFor(),
    undefined,
    undefined,
    undefined,
    rules,
    storyKsors(),
    connectors,
    new Map([["fake-bank", { bank: fake, waitMs: 200 }]]),
  );
  await rates.load("org_456", {
    source: "ecb-daily",
    base: "EUR",
    published_at: "2026-10-06T14:00:00.000Z",
    rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
  });
  return world;
}
const shippedWorld = await connectorWorld(readConnectors());
for (const [operation, needs] of shippedWorld.plugs.needs) {
  const listed = needs.map((need) => need.join(" or ")).join(", ");
  console.log(`  ${operation} needs: ${listed === "" ? "nothing beyond a read" : listed}`);
}
const cannotUndo = { ...(accounting["capabilities"] as object), transactions: false };
const own789 = { ...accounting, id: "accounting-789", capabilities: cannotUndo };
// Changed in step 35: each company names its bank too.
const fakeBankDeclared = shippedConnectors.connectors[1]!;
const split = JSON.stringify({
  connectors: [accounting, own789, fakeBankDeclared],
  companies: {
    "*": { records: "accounting", bank: "fake-bank" },
    org_789: { records: "accounting-789", bank: "fake-bank" },
  },
});
const splitWorld = await connectorWorld({ file: "connectors.json", text: split });
// Why org_789's connector is out of service is for the people who run DSoR: start-up says it, and
//   no caller hears it (step 34's review, F3).
for (const warning of splitWorld.plugs.warnings) console.log(`  start-up warns: ${warning}`);
const splitLog = createLog();
let splitKeys = 0;
const splitCall = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  call(splitWorld, splitLog, withKey(who, `connector-${++splitKeys}`), name, input);
// user_700, a person of org_789, so line ③ passes and line ④ is the line that answers.
const USER_700: RequestEnvelope = { token: "tok_e1a7", tenant: "org_789" };
console.log(
  "  org_789's connector cannot undo a job; user_700 reads org_789's INV-2002:",
  heard(
    await call(splitWorld, splitLog, USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-2002",
    }),
  ),
);
console.log(
  "  the agent drafts org_456's INV-1008, 31,400.00 USD:",
  waitHeard(await splitCall(AGENT, "payment.create", ofInvoice("INV-1008"))),
);
const brokenDefault = JSON.stringify({
  connectors: [{ ...accounting, capabilities: cannotUndo }, fakeBankDeclared],
  companies: { "*": { records: "accounting", bank: "fake-bank" } },
});
try {
  await connectorWorld({ file: "connectors.json", text: brokenDefault });
  console.log("  the default connector cannot undo a job: DSoR started");
} catch (error) {
  const [, first] = (error as Error).message.split("\n");
  console.log(
    `  the default connector cannot undo a job: DSoR does not start:\n  ${String(first)}`,
  );
}

// A fake bank, in memory, in a world of its own (step 35's README, the story's
//   numbers). The agent drafts INV-1008, cfo_100 approves it, and the agent releases PAY-901. Then
//   user_123 sends PAY-901 through the bank, on a good day. On a silent day, PAY-902 of INV-1002 is
//   OUTCOME_UNKNOWN, and a second attempt is refused. On a broken day, PAY-903 of INV-1009 is safe
//   to send again with the same key.
console.log("a fake bank, in memory, in a world of its own:");
const fakeBank = createFakeBank();
const bankDrafted: Payment[] = [];
const bankKept = memoryProposals(() => Date.parse("2026-10-06T15:05:00Z"));
const bankWorld = await connectorWorld(readConnectors(), fakeBank, bankDrafted, bankKept);
const bankLog = createLog();
let bankKeys = 0;
const bankCall = (who: RequestEnvelope, name: string, input: unknown, key?: string) =>
  call(bankWorld, bankLog, withKey(who, key ?? `bank-${++bankKeys}`), name, input);
const toPay = (invoice: string, payment: string) => ({
  invoice: `dsor://org_456/invoice/${invoice}`,
  payment: `dsor://org_456/payment/${payment}`,
  expected_version: 1,
});
const lastTransfer = (): string => {
  const transfer = fakeBank.transfers().at(-1);
  if (transfer === undefined) return "none";
  const { reference, amount, vendor, payment, key } = transfer;
  return `${reference}: ${amount.value} ${amount.currency} to ${vendor} for ${payment}, key ${key.slice(0, 16)}…`;
};
const bankDraft = await bankCall(AGENT, "payment.create", ofInvoice("INV-1008"));
console.log("  the agent drafts INV-1008, 31,400.00 USD:", waitHeard(bankDraft));
const bankId =
  String("proposal" in bankDraft ? bankDraft.proposal : "")
    .split("/")
    .at(-1) ?? "";
const bankWaiting = await bankKept.get("org_456", bankId);
if (bankWaiting === undefined) throw new Error("the story's proposal is not there");
const bankYes = await bankCall(CFO_100, "proposal.approve", {
  proposal: bankWaiting.uri,
  payload_hash: bankWaiting.payload_hash,
});
console.log("  cfo_100 approves it:", heard(bankYes));
console.log(
  "  the agent releases it:",
  heard(await bankCall(AGENT, "proposal.execute", { proposal: bankWaiting.uri })),
);
console.log(
  "  a good day; user_123 sends PAY-901:",
  heard(await bankCall(SUPERVISOR_123, "payment.execute", toPay("INV-1008", "PAY-901"))),
);
console.log(`    the bank sent ${lastTransfer()}`);
const draft1002 = await bankCall(SUPERVISOR_123, "payment.create", ofInvoice("INV-1002"));
console.log("  user_123 drafts INV-1002, 8,900.50 USD:", heard(draft1002));
fakeBank.mode = "silent";
const silent = await bankCall(SUPERVISOR_123, "payment.execute", toPay("INV-1002", "PAY-902"));
console.log("  a silent day; user_123 sends PAY-902:", heard(silent));
console.log(`    the bank sent ${lastTransfer()}`);
fakeBank.mode = "good";
console.log(
  "  the bank is back; user_123 tries PAY-902 again with a new key:",
  heard(await bankCall(SUPERVISOR_123, "payment.execute", toPay("INV-1002", "PAY-902"))),
);
console.log(`  transfers the bank made: ${fakeBank.transfers().length}`);
const draft1009 = await bankCall(SUPERVISOR_123, "payment.create", ofInvoice("INV-1009"));
console.log("  user_123 drafts INV-1009, 7,425.00 USD:", heard(draft1009));
fakeBank.mode = "broken";
const broken = await bankCall(
  SUPERVISOR_123,
  "payment.execute",
  toPay("INV-1009", "PAY-903"),
  "send-903",
);
console.log("  a broken day; user_123 sends PAY-903:", heard(broken));
fakeBank.mode = "good";
console.log(
  "  the bank is back; the same request, the same key:",
  heard(
    await bankCall(SUPERVISOR_123, "payment.execute", toPay("INV-1009", "PAY-903"), "send-903"),
  ),
);
console.log(`    the bank sent ${lastTransfer()}`);
console.log(`  transfers the bank made: ${fakeBank.transfers().length}`);
console.log(`  payments: ${bankDrafted.map((p) => `${p.id} ${p.status}`).join(", ")}`);

// Every call above left one record in the log before its answer was returned, the
// refusals too. dsor_runtime reads one company at a time, and never a
// record with no company (step 11's README, decisions 4 and 6). So the program reads the
// two companies its calls worked in, and puts their records in the order of their numbers.
const readable = [...(await log.records("org_456")), ...(await log.records("org_789"))].sort(
  (a, b) => a.sequence - b.sequence,
);
// The table holds the records of every run, so the program picks out its own by request
// id. user_123's "ap-desk-7" comes back on every run, so this run's records start at the
// record of its first call, whose request id DSoR made and no other run has.
const ids = new Set(answers.map((a) => a.correlation.request_id));
const first = readable.find((r) => r.correlation.request_id === answers[0]!.correlation.request_id);
const records = readable.filter(
  (r) => ids.has(r.correlation.request_id) && r.sequence >= (first?.sequence ?? Infinity),
);
// The first record in full, then one line for each, with the company it was made in.
// To every depth, so the read's freshness under extensions shows.
console.dir(records[0], { depth: null });
for (const { sequence, operation, authorization, result, tenant } of records) {
  console.log(sequence, operation ?? "(no contract)", authorization, result, tenant);
}
// And how many of them name a bundle, which the database kept in the same
//   transaction (step 33's README, D2).
const naming = records.filter((r) => r.decision_bundle !== undefined).length;
console.log(`${naming} of the records it reads name a decision bundle`);
// The records it could not read. The program did not see them. It knows they were written
// because an answer leaves only after its record is committed (DSOR-EXE-02). Found by the
// review: this line used to state them as if it had read them.
const n = answers.length;
console.log(
  `${n} calls answered, so ${n} records were written. dsor_runtime reads ${records.length}` +
    ` of them, in org_456 and org_789, and cannot read the other ${n - records.length}`,
);

// A log that cannot take a record. This call would succeed, but with no record there is
// no answer (DSOR-EXE-03b).
const full: DecisionLog = {
  add: async () => {
    throw new Error("disk full");
  },
};
console.log(await ask(AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" }, full));

// Close the pool's connections, or Node would wait for them forever.
await pool.end();
