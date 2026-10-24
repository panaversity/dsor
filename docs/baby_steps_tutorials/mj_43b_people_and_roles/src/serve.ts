// Run with  pnpm serve
// The front door as a program. It makes the same start-up checks as pnpm start: the contracts, the
// role table, the input schemas, the labels, the map of the store, the login, the database against
// the map, and the rules in dsor.controls. Then the routes against the contracts, and the notes a
// stopped program left. Then it listens on 127.0.0.1, port 8042 unless DSOR_HTTP_PORT names
// another, and every request is answered by call(), over the database, with dsor.audit as its log
// (DSOR-OPR-04a; step 42's README, claims C1, C2, and C7, decision D7).
import { fileURLToPath } from "node:url";
import { readRoleSettings } from "./authority.ts";
import { readCatalog } from "./catalog.ts";
import { readInputs } from "./inputs.ts";
import { storeDifferences } from "./inspector.ts";
import { readClassifications } from "./labels.ts";
import { handlersFor } from "./operations.ts";
import { readRoles } from "./permissions.ts";
import { checkIssuers, readIssuers } from "./issuers.ts";
import { realLogins } from "./logins.ts";
import { logins } from "./principals.ts";
import { remoteKeys } from "./tokens.ts";
import {
  createDbBrakes,
  createDbClaims,
  createDbControls,
  createDbInvoices,
  createDbBook,
  createDbPeople,
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

loadDotEnv(["DSOR_DB_URL", "DSOR_HTTP_PORT", "DSOR_ISSUERS_FILE", "DSOR_STAND_IN"]);
// No database named, no door: it never falls back to a log in memory (step 09's README, decision 15).
try {
  requireEnv("DSOR_DB_URL");
} catch (error) {
  refuse((error as Error).message);
}
// Changed in step 43: 0 picks a free port, as the test of the program does.
const port = Number(process.env["DSOR_HTTP_PORT"] ?? "8042");
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  refuse("DSOR_HTTP_PORT must be a port number, 0 to 65535");
}
const pool = openPool(process.env["DSOR_DB_URL"] ?? "");

// Changed in step 43b: no fake directory. Each company's role source is DSoR's own table of people,
//   dsor.people and dsor.role_grants, as role-sources.json says (step 43b's README, claim C2).
const people = createDbPeople(pool);

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
    new Map(),
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
    // NEW IN STEP 43b: and the table of people, which line ① and the role source read.
    people,
  );
  const { problems } = checkStore(readStore());
  if (problems.length > 0)
    refuse(`the map of the store refused to start:\n  ${problems.join("\n  ")}`);
  // NEW IN STEP 43: real logins for people: each company's issuers, checked before any caller, and
  //   DSoR's own links in dsor.logins. Agents and system logins keep step 05's table until step 44
  //   (step 43's README, decisions D1, D3, and D8).
  const issuers = checkIssuers(readIssuers(process.env["DSOR_ISSUERS_FILE"]), logins.values());
  if (issuers.problems.length > 0) {
    refuse(`the issuers refused to start:\n  ${issuers.problems.join("\n  ")}`);
  }
  // A stand-in on this computer is plain http, and anyone here who can sign in through it is anyone.
  //   So pnpm serve trusts one only when DSOR_STAND_IN=on says so, to learn with (the review's H1).
  const standIns = [...new Set([...issuers.issuers.values()].flat().map((i) => i.issuer))].filter(
    (address) => address.startsWith("http:"),
  );
  if (standIns.length > 0 && process.env["DSOR_STAND_IN"] !== "on") {
    const why =
      "is plain http on this computer: a stand-in, through which anyone here could sign in";
    refuse(
      `issuers.json names ${standIns.join(", ")}, which ${why}. Set DSOR_STAND_IN=on to learn with it`,
    );
  }
  if (standIns.length > 0)
    console.log(`DSOR_STAND_IN=on: trusting ${standIns.join(", ")}, to learn only`);
  registry = {
    ...registry,
    logins: realLogins(issuers.issuers, createDbBook(pool), remoteKeys()),
  };
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
