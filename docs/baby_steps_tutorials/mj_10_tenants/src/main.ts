// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
// The program checks every contract, and the role table, then calls operations by name.
// It prints one success and six refusals, each an envelope, and the correlation of a call
// by user_123. Then it prints the log, one record for every call, and shows that a log
// which cannot take a record turns a "yes" into a refusal.
// NEW IN STEP 09: the log and the invoices are tables in the database named by
// DSOR_DB_URL, in this step's .env. Run `pnpm migrate` once first.
import { fileURLToPath } from "node:url";
import type { Answer } from "./envelope.ts";
import { invoiceUri, type Invoice } from "./invoice.ts";
import type { DecisionLog } from "./log.ts";
import { handlersFor } from "./operations.ts";
import { readRoles } from "./permissions.ts";
import { call } from "./pipeline.ts";
import { readInputs } from "./inputs.ts";
import {
  createDbInvoices,
  createDbLog,
  loadDotEnv,
  openPool,
  requireEnv,
  runtimeRoleProblems,
} from "./postgres.ts";
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
// Start-up checks the input schemas too. A folder of them can be named after
// the role table, so a test can start without one. With none named, the step's own is read.
const INPUTS: string | undefined = process.argv[4];
// NEW IN STEP 09: the pool is made before the checks, because the operations are built
// with the invoices it reads. It connects only at its first query, after every check.
// Only DSOR_DB_URL: the owner's key stays in the file (step 09's README, decision 4).
loadDotEnv(["DSOR_DB_URL"]);
const pool = openPool(process.env["DSOR_DB_URL"] ?? "");
let registry: Registry;
try {
  registry = buildRegistry(
    readContracts(CONTRACTS),
    handlersFor(createDbInvoices(pool)),
    readRoles(ROLES),
    readInputs(INPUTS),
  );
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
console.log("operations:", [...registry.contracts.keys()]);

// NEW IN STEP 09: no database named, no program. It never falls back to a log in memory,
// because a missing secret must not quietly mean evidence lost on a crash (step 09's
// README, decision 15).
try {
  requireEnv("DSOR_DB_URL");
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

// NEW IN STEP 09: the program checks who it logged in as, before any call, and refuses to
// run as a user that could change the log. It fails closed (step 09's README, decision 17).
const problems = await runtimeRoleProblems(pool);
if (problems.length > 0) {
  console.error(`DSOR_DB_URL must log in as dsor_runtime. Refused: ${problems.join("; ")}.`);
  await pool.end();
  process.exit(1);
}

// NEW IN STEP 09: the log every decision is written to is the table dsor.audit.
const log = createDbLog(pool);

// NEW IN STEP 09: every answer is kept, so the program can find its own records later.
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
const AGENT: RequestEnvelope = { token: "tok_7f3a" };

// The answer is an envelope. A success carries the invoice as its data,
// and the request id DSoR made for this call.
const answer = await ask(AGENT, "invoice.get", { id: "INV-1008" });
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
console.log(await ask(AGENT, "invoice.get", { id: "INV-9999" }));
// The agent's role grants invoice:read and not invoice:issue. So this call
// is denied at line ⑤, before DSoR looks at the input or asks whether it is built.
console.log(await ask(AGENT, "invoice.issue", { invoice: "dsor://org_456/invoice/INV-1008" }));

// A call with no login token is refused before DSoR checks anything else.
console.log(await ask({}, "invoice.get", { id: "INV-1008" }));
// The agent names the CFO in its arguments. DSoR still knows it is the
// agent, from its token, and refuses the call.
console.log(await ask(AGENT, "invoice.get", { id: "INV-1008", principal: "cfo_100" }));
// user_123 logs in with their own token, and labels the call with a request
// id of their own. The answer carries that id, and names user_123 as the caller.
const USER_123: RequestEnvelope = { token: "tok_2c91", request_id: "ap-desk-7" };
console.log((await ask(USER_123, "invoice.get", { id: "INV-1008" })).correlation);
// user_123 holds invoice:issue. So the same call passes lines ①, ⑤, and ⑥.
// It is refused after them: invoice.issue has a contract but no code yet.
console.log(await ask(USER_123, "invoice.issue", { invoice: "dsor://org_456/invoice/INV-1008" }));
// user_123 sends an id where invoice.issue needs a canonical URI. Line ⑥
// refuses it, before DSoR asks whether invoice.issue is built.
console.log(await ask(USER_123, "invoice.issue", { invoice: "INV-1008" }));

// Every call above left one record in the log before its answer was returned, the
// refusals too. NEW IN STEP 09: the table holds the records of every run, so the program
// picks out its own by request id. user_123's "ap-desk-7" comes back on every run, so
// only the last records are this run's. The first record in full, then one line for each.
const ids = new Set(answers.map((a) => a.correlation.request_id));
const all = await log.records();
const records = all.filter((r) => ids.has(r.correlation.request_id)).slice(-answers.length);
console.log(records[0]);
for (const { sequence, operation, authorization, result } of records) {
  console.log(sequence, operation ?? "(no contract)", authorization, result);
}

// A log that cannot take a record. This call would succeed, but with no record there is
// no answer (DSOR-EXE-03b).
const full: DecisionLog = {
  add: async () => {
    throw new Error("disk full");
  },
  records: async () => [],
};
console.log(await ask(AGENT, "invoice.get", { id: "INV-1008" }, full));

// NEW IN STEP 09: close the pool's connections, or Node would wait for them forever.
await pool.end();
