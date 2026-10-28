// Run with  pnpm serve
// The front door as a program. It makes the same start-up checks as pnpm start: the contracts, the
// role table, the input schemas, the labels, the map of the store, the login, the database against
// the map, and the rules in dsor.controls. Then the routes against the contracts, and the notes a
// stopped program left. Then it listens on 127.0.0.1, port 8042 unless DSOR_HTTP_PORT names
// another, and every request is answered by call(), over the database, with dsor.audit as its log
// (DSOR-OPR-04a; step 42's README, claims C1, C2, and C7, decision D7).
// Since step 45, each company's directory is its lookup on its sign-in server, from lookups.json,
// with the company's key from the environment (step 45's README, C1 and D11).
import { fileURLToPath } from "node:url";
import { checkRoleSettings, readRoleSettings } from "./authority.ts";
import { readCatalog } from "./catalog.ts";
import { readInputs } from "./inputs.ts";
import { lookupDirectory } from "./lookup.ts";
import { checkLookups, keyVariable, readLookups } from "./lookups.ts";
import { storeDifferences } from "./inspector.ts";
import { readClassifications } from "./labels.ts";
import { handlersFor } from "./operations.ts";
import { readRoles } from "./permissions.ts";
import { logins } from "./principals.ts";
import { realLogins } from "./logins.ts";
import { audienceProblem, checkSignIn, readSignIn } from "./sign-in.ts";
import { remoteKeys } from "./tokens.ts";
import {
  createDbAnswers,
  createDbBrakes,
  createDbClaims,
  createDbControls,
  createDbInvoices,
  createDbLog,
  createDbPayments,
  createDbSlips,
  loadDotEnv,
  openPool,
  requireEnv,
  runtimeRoleProblems,
  sweepIntents,
} from "./postgres.ts";
import { buildRegistry, readContracts, type Registry } from "./registry.ts";
import { ownWorkFor } from "./revocation.ts";
import { checkRules } from "./rulebook.ts";
import { doorOver, listen } from "./server.ts";
import { checkStore, readStore } from "./store.ts";

/** Stops the program with this message, before any request is answered. */
function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

// NEW IN STEP 45: the companies with a role source, whose lookups pnpm serve asks. role-sources.json
//   is checked first, so a problem there is named as its own, not as a missing lookup.
const roleCheck = checkRoleSettings(readRoleSettings(), logins.values());
if (roleCheck.problems.length > 0) {
  refuse(`role-sources.json refused to start:\n  ${roleCheck.problems.join("\n  ")}`);
}
const companies = [...roleCheck.settings.keys()];
// And each company's key, which .env may set too.
loadDotEnv(["DSOR_DB_URL", "DSOR_HTTP_PORT", ...companies.map(keyVariable)]);
// No database named, no door: it never falls back to a log in memory (step 09's README, decision 15).
try {
  requireEnv("DSOR_DB_URL");
} catch (error) {
  refuse((error as Error).message);
}
const port = Number(process.env["DSOR_HTTP_PORT"] ?? "8042");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  refuse("DSOR_HTTP_PORT must be a port number, 1 to 65535");
}
const pool = openPool(process.env["DSOR_DB_URL"] ?? "");

// NEW IN STEP 45: each company's lookup on its sign-in server, from lookups.json, with the
//   company's key from the environment, checked before any caller can ask. No fake directory
//   answers here any more (step 45's README, C1 and D11).
const { lookups, problems: lookupProblems } = checkLookups(readLookups(), companies);
if (lookupProblems.length > 0) {
  refuse(`lookups.json refused to start:\n  ${lookupProblems.join("\n  ")}`);
}
const directories = new Map(
  [...lookups].map(([tenant, { address, key }]) => [
    tenant,
    lookupDirectory({ tenant, address, key }),
  ]),
);

// The registry over the database, with the company's rules in dsor.controls, which the claims read
//   inside their own transactions, as the database tests of step 28 on have it.
let registry: Registry;
try {
  const controls = createDbControls(pool);
  registry = buildRegistry(
    readContracts(fileURLToPath(new URL("../contracts", import.meta.url))),
    handlersFor(),
    readRoles(fileURLToPath(new URL("../roles.json", import.meta.url))),
    readInputs(),
    readClassifications(),
    createDbInvoices(pool),
    createDbPayments(pool),
    createDbSlips(pool),
    directories,
    readRoleSettings(),
    createDbClaims(pool, "database"),
    ownWorkFor(),
    createDbBrakes(pool),
    undefined,
    undefined,
    controls,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    // NEW IN STEP 45: the answers of each company's role source, in dsor.role_answers, shared
    // by every DSoR server and kept over a restart (step 45's README, D8). Through a pool of
    // their own: a release asks line ③'s question again inside its claim, which holds one of
    // this pool's connections, so one pool for both would let releases wait for each other
    // forever (found by step 45's database run).
    createDbAnswers(openPool(process.env["DSOR_DB_URL"] ?? "")),
  );
  const { problems } = checkStore(readStore());
  if (problems.length > 0)
    refuse(`the map of the store refused to start:\n  ${problems.join("\n  ")}`);
  // The one sign-in server DSoR trusts, from sign-in.json, checked before any
  //   caller can ask. A person signs in there with a token made for DSoR; an agent keeps its key
  //   (step 44's README, claims C4 and C5, decisions 44-2 and 44-6).
  const { signIn, problems: signInProblems } = checkSignIn(readSignIn());
  if (signIn === undefined)
    refuse(`sign-in.json refused to start:\n  ${signInProblems.join("\n  ")}`);
  // And made for this DSoR, at the port it listens on (decision 44-12).
  const elsewhere = audienceProblem(signIn, port);
  if (elsewhere !== undefined) refuse(`sign-in.json refused to start:\n  ${elsewhere}`);
  registry = { ...registry, logins: realLogins(signIn, remoteKeys()) };
} catch (error) {
  refuse((error as Error).message);
}

// The database: who the program logged in as, the tables against the map, the stored rules, and
//   the notes a stopped program left, each before any request (steps 09, 16, 28, and 36).
try {
  const login = await runtimeRoleProblems(pool);
  if (login.length > 0)
    refuse(`DSOR_DB_URL must log in as dsor_runtime. Refused: ${login.join("; ")}.`);
  const { map } = checkStore(readStore());
  const differences = storeDifferences(map, await readCatalog(pool));
  if (differences.length > 0) {
    refuse(`The database does not match store.json. Refused:\n  ${differences.join("\n  ")}`);
  }
  const rules = await checkRules(registry, registry.moneyPolicies.keys());
  if (rules.length > 0) refuse(`the rules refused to start:\n  ${rules.join("\n  ")}`);
  await sweepIntents(pool, registry.lifetimes.keys());
} catch (error) {
  refuse(`The database could not be checked. Refused: ${(error as Error).message}`);
}

// The door: its routes checked against the contracts, then 127.0.0.1 only (decisions D2 and D7).
try {
  const server = doorOver(registry, createDbLog(pool));
  const bound = await listen(server, "127.0.0.1", port);
  console.log(`DSoR's door listens on http://127.0.0.1:${bound}`);
  process.once("SIGINT", () => {
    server.close(() => void pool.end());
  });
} catch (error) {
  await pool.end().catch(() => {});
  refuse((error as Error).message);
}
