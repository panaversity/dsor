// A program that crashes the moment it has answered. Not a test file:
// audit.db.test.ts starts it, and then looks for its record. Crash guarantees are proved
// by fault injection (§47 in specs/dsor/06-conformance.md).
// Run by the test as:  node test/crash-after-answer.ts <request id>
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readInputs } from "../src/inputs.ts";
import { handlersFor } from "../src/operations.ts";
import { readRoles } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, openPool, requireEnv } from "../src/postgres.ts";
import { buildRegistry, readContracts } from "../src/registry.ts";

const CONTRACTS = fileURLToPath(new URL("../contracts", import.meta.url));
const ROLES = fileURLToPath(new URL("../roles.json", import.meta.url));

const pool = openPool(requireEnv("DSOR_DB_URL"));
const registry = buildRegistry(
  readContracts(CONTRACTS),
  handlersFor(),
  readRoles(ROLES),
  readInputs(),
  createDbInvoices(pool),
);
// The agent's login token, as in main.ts, and the request id the test chose.
const request = { token: "tok_7f3a", tenant: "org_456", request_id: process.argv[2] };
const answer = await call(registry, createDbLog(pool), request, "invoice.get", {
  invoice: "dsor://org_456/invoice/INV-1008",
});

// writeSync, because on a pipe console.log may still be waiting when the process dies.
writeSync(1, JSON.stringify(answer));
// The crash: no pool.end(), no clean-up, nothing more written. SIGKILL cannot be caught.
process.kill(process.pid, "SIGKILL");
