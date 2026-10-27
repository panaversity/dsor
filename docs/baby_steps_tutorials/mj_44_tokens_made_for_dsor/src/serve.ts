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
import { fakeDirectory } from "./directory.ts";
import { readInputs } from "./inputs.ts";
import { storeDifferences } from "./inspector.ts";
import { readClassifications } from "./labels.ts";
import { handlersFor } from "./operations.ts";
import { readRoles } from "./permissions.ts";
import { realLogins } from "./logins.ts";
import { checkSignIn, readSignIn } from "./sign-in.ts";
import { remoteKeys } from "./tokens.ts";
import {
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

loadDotEnv(["DSOR_DB_URL", "DSOR_HTTP_PORT"]);
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

// Each company's staff directory, fake, with the story's people, as pnpm start has them.
const directories = new Map([
  [
    "org_456",
    fakeDirectory("org_456", {
      user_123: { status: "active", roles: ["ap_supervisor"] },
      cfo_100: { status: "active", roles: ["CFO"] },
    }),
  ],
  [
    "org_789",
    fakeDirectory("org_789", { user_700: { status: "active", roles: ["ap_supervisor"] } }),
  ],
]);

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
  );
  const { problems } = checkStore(readStore());
  if (problems.length > 0)
    refuse(`the map of the store refused to start:\n  ${problems.join("\n  ")}`);
  // NEW IN STEP 44: the one sign-in server DSoR trusts, from sign-in.json, checked before any
  //   caller can ask. A person signs in there with a token made for DSoR; an agent keeps its key
  //   (step 44's README, claims C4 and C5, decisions 44-2 and 44-6).
  const { signIn, problems: signInProblems } = checkSignIn(readSignIn());
  if (signIn === undefined)
    refuse(`sign-in.json refused to start:\n  ${signInProblems.join("\n  ")}`);
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
