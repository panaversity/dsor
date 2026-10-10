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
// DSoR suspends both her slips. Then it prints the log: the records it can read,
// one company at a time, and how many it cannot read. Last, it shows that a log which
// cannot take a record turns a "yes" into a refusal. Found by the Stage 2 review: this
// header described step 13's program, and left out the masking and cfo_100's read.
// The log and the invoices are tables in the database named by
// DSOR_DB_URL, in this step's .env. Run `pnpm migrate` once first.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readRoleSettings } from "./authority.ts";
import { readClassifications } from "./labels.ts";
import type { Answer } from "./envelope.ts";
import { readCatalog } from "./catalog.ts";
import { storeDifferences } from "./inspector.ts";
import { invoiceUri, invoices, memoryInvoices, type Invoice } from "./invoice.ts";
import { memoryPayments, type Payment } from "./payment.ts";
import { createLog, type DecisionLog } from "./log.ts";
import { handlersFor } from "./operations.ts";
import { readRoles } from "./permissions.ts";
import { call } from "./pipeline.ts";
import { readInputs } from "./inputs.ts";
import {
  createDbBrakes,
  createDbClaims,
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
import type { RequestEnvelope } from "./request.ts";
import { checkStore, readStore, type StoreMap } from "./store.ts";
import { memorySlips } from "./slips.ts";
import { fakeDirectory } from "./directory.ts";
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
  );
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
const PREPARE = { ...withKey(AGENT, "prepare-INV-1008"), mode: "propose_only" };
const prepared = await ask(PREPARE, "payment.create", DRAFT_1008);
console.log("the agent prepares a draft:", prepared);
await showProposal(prepared);
// The same key, sent to execute, is refused: a key keeps its mode (outcome 3).
const executeIt = await ask(withKey(AGENT, "prepare-INV-1008"), "payment.create", DRAFT_1008);
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
const CLERK_PREPARES = { ...withKey(AGENT, "prepare-INV-1008-clerk"), mode: "propose_only" };
console.log(
  "ap_clerk, the agent prepares:",
  heard(await ask(CLERK_PREPARES, "payment.create", DRAFT_1008)),
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

// NEW IN STEP 26: money in two currencies, told in memory with a clock of its own. dsor-rates loads
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
