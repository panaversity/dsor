// Run with  pnpm serve
// The front door as a program. It makes the same start-up checks as pnpm start: the contracts, the
// role table, the input schemas, the labels, the map of the store, the login, the database against
// the map, and the rules in dsor.controls. Then the routes against the contracts, and the notes a
// stopped program left. Then it listens on 127.0.0.1, port 8042 unless DSOR_HTTP_PORT names
// another, and every request is answered by call(), over the database, with dsor.audit as its log
// (DSOR-OPR-04a; step 42's README, claims C1, C2, and C7, decision D7).
import { fileURLToPath } from "node:url";
import { checkRoleSettings, readRoleSettings } from "./authority.ts";
import { readCatalog } from "./catalog.ts";
import { readInputs } from "./inputs.ts";
import { storeDifferences } from "./inspector.ts";
import { readClassifications } from "./labels.ts";
import { handlersFor } from "./operations.ts";
import { checkRoles, readRoles } from "./permissions.ts";
import { companyPeople, copyLogins, issuerProblems } from "./company-people.ts";
import { createDbClients, createDbCopy, createDbHeard } from "./postgres-copy.ts";
import { checkRoleMaps, readRoleMaps } from "./role-maps.ts";
import { scimDoorOver } from "./scim-door.ts";
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

loadDotEnv([
  "DSOR_DB_URL",
  "DSOR_HTTP_PORT",
  "DSOR_ISSUERS_FILE",
  "DSOR_STAND_IN",
  "DSOR_ROLE_SOURCES_FILE",
  // NEW IN STEP 43c: each company's role map, the SCIM door's port, and the host names it answers.
  "DSOR_ROLE_MAPS_FILE",
  "DSOR_SCIM_PORT",
  "DSOR_SCIM_HOSTS",
]);
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

// Since step 43b: each company's role source, from role-sources.json, or the file that
//   DSOR_ROLE_SOURCES_FILE names, as DSOR_ISSUERS_FILE names the issuers. pnpm serve asks no directory,
//   so a company whose role source is idp_lookup is refused here, at start-up, not at its first
//   agent call (the code review of step 43b, finding 4).
const roleSources = readRoleSettings(process.env["DSOR_ROLE_SOURCES_FILE"] || undefined);
// Changed in step 43c: or scim, the copy its own directory pushes through the SCIM door.
const settings = checkRoleSettings(roleSources, logins.values()).settings;
const askingNobody = [...settings.entries()].filter(([, setting]) => setting.kind === "idp_lookup");
for (const [tenant, setting] of askingNobody) {
  refuse(
    `role-sources.json: ${tenant}'s role source is ${setting.kind}, and pnpm serve has no directory to ask: name dsor_assignments or scim`,
  );
}

// Changed in step 43b: no fake directory. Each company's role source is DSoR's own table of people,
//   dsor.people and dsor.role_grants, as role-sources.json says (step 43b's README, claim C2).
// NEW IN STEP 43c: or, for a company on scim, its directory's copy, through its role map, while its
//   directory has spoken within max_staleness (step 43c's README, claims C4 and C5).
const roleTable = readRoles(fileURLToPath(new URL("../roles.json", import.meta.url)));
const roleMaps = readRoleMaps(process.env["DSOR_ROLE_MAPS_FILE"] || undefined);
const maps = checkRoleMaps(roleMaps, settings, checkRoles(roleTable, logins.values()).roles).maps;
const people = companyPeople(createDbPeople(pool), createDbCopy(pool), {
  settings,
  maps,
  heard: createDbHeard(pool),
});

// The registry over the database, with the company's rules in dsor.controls, which the claims read
//   inside their own transactions, as the database tests of step 28 on have it.
let registry: Registry;
try {
  const controls = createDbControls(pool);
  registry = buildRegistry(
    readContracts(fileURLToPath(new URL("../contracts", import.meta.url))),
    handlersFor(),
    roleTable,
    readInputs(),
    readClassifications(),
    createDbInvoices(pool),
    createDbPayments(pool),
    createDbSlips(pool),
    new Map(),
    roleSources,
    // Changed in step 43c: and the companies on their own directories, so a claim reads their copies.
    createDbClaims(pool, "database", { settings, maps }),
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
    // Since step 43b: and the table of people, which line ① and the role source read.
    people,
    // NEW IN STEP 43c: and the role maps, which start-up checks with the role sources.
    roleMaps,
  );
  const { problems } = checkStore(readStore());
  if (problems.length > 0)
    refuse(`the map of the store refused to start:\n  ${problems.join("\n  ")}`);
  // Since step 43: real logins for people: each company's issuers, checked before any caller, and
  //   DSoR's own links in dsor.logins. Agents and system logins keep step 05's table until step 44
  //   (step 43's README, decisions D1, D3, and D8).
  const issuers = checkIssuers(readIssuers(process.env["DSOR_ISSUERS_FILE"]), logins.values());
  // Changed in step 43c: and a company on its own directory has an issuer of its own (the review of
  //   step 43c, finding 6).
  const issuerRefusals = [...issuers.problems, ...issuerProblems(settings, issuers.issuers)];
  if (issuerRefusals.length > 0) {
    refuse(`the issuers refused to start:\n  ${issuerRefusals.join("\n  ")}`);
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
    // Changed in step 43c: and a login no link names may be a person a directory pushed, by her uuid
    //   (step 43c's README, claim C6).
    logins: realLogins(
      issuers.issuers,
      createDbBook(pool),
      remoteKeys(),
      Date.now,
      copyLogins(createDbCopy(pool), settings, issuers.issuers),
    ),
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
  // NEW IN STEP 43c: and, when a company is on its own directory, the SCIM door, for directories only,
  //   on 127.0.0.1 too, answering the host names DSOR_SCIM_HOSTS gives, such as host.lima.internal:8044
  //   (step 43c's README, claim C2, decision D7).
  const onDirectories = [...settings.values()].some((setting) => setting.kind === "scim");
  const scim = onDirectories
    ? scimDoorOver(
        registry,
        createDbLog(pool),
        createDbClients(pool),
        (process.env["DSOR_SCIM_HOSTS"] ?? "").split(",").filter((host) => host !== ""),
      )
    : undefined;
  if (scim !== undefined) {
    const scimPort = await listen(
      scim,
      "127.0.0.1",
      Number(process.env["DSOR_SCIM_PORT"] ?? "8044"),
    );
    console.log(`DSoR's SCIM door listens on http://127.0.0.1:${scimPort}/scim/v2/`);
  }
  process.once("SIGINT", () => {
    scim?.close();
    server.close(() => void pool.end());
  });
} catch (error) {
  await pool.end().catch(() => {});
  refuse((error as Error).message);
}
