// Start-up. How the contract files are found, and the program itself.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRoles } from "../src/permissions.ts";
import { contractFiles, readContracts } from "../src/registry.ts";
import { STARTING_ROLES, contract, shipped, without } from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const CONTRACTS = fileURLToPath(new URL("../contracts", import.meta.url));
// The step's own files, named on the command line before a map of the test's.
const ROLES = fileURLToPath(new URL("../roles.json", import.meta.url));
const INPUTS = fileURLToPath(new URL("../inputs", import.meta.url));
const CLASSIFICATIONS = fileURLToPath(new URL("../classifications.json", import.meta.url));
const STORE = fileURLToPath(new URL("../store.json", import.meta.url));

// No rule id: how start-up finds the contract files.
describe("reading the contracts folder", () => {
  // Found by the review: neither the order nor the .json filter was tested.
  it("reads only .json files, in name order", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsor-contracts-"));
    try {
      for (const file of ["z.json", "notes.txt", "a.json"]) writeFileSync(join(dir, file), "{}");
      expect(readContracts(dir).map((s) => s.file)).toEqual(["a.json", "z.json"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  // Found by step 04's review: macOS lists a folder by name, so the test above passed with
  // the sort deleted. This one hands the names over out of order.
  it("sorts the file names, whatever order the folder lists them in", () => {
    expect(contractFiles(["z.json", "notes.txt", "m.json", "a.json"])).toEqual([
      "a.json",
      "m.json",
      "z.json",
    ]);
  });

  // invoice.list is the third. Step 17's two commands follow, in name order.
  // And delegation.revoke. NEW IN STEP 25b: and the brake's two commands, first in name order.
  it("the shipped folder holds the eight contracts", () => {
    expect(shipped.map((s) => s.file)).toEqual([
      "control.lift.json",
      "control.suspend.json",
      "delegation.revoke.json",
      "invoice.get.json",
      "invoice.issue.json",
      "invoice.list.json",
      "payment.cancel.json",
      "payment.create.json",
    ]);
  });
});

// No rule id: how start-up reads the role table. Found by the review:
// code that named every table "roles.json", or by its whole path, passed every test.
describe("reading the role table", () => {
  it("names the table by its own file name, so a problem points at the right file", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsor-roles-"));
    try {
      writeFileSync(join(dir, "staff-roles.json"), "{}");
      expect(readRoles(join(dir, "staff-roles.json")).file).toBe("staff-roles.json");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// No rule id: the program itself. Found by the review: nothing ran src/main.ts, so a
// start-up that skipped the registry passed every test.
describe("the program", () => {
  // Found by step 04's review: no test started the program with a broken contract, so a
  // refused start-up that ended with exit code 0, "success", passed every test.
  it(
    "refuses to start with a broken contract: it names the problem and exits with code 1",
    { timeout: 30_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-contracts-"));
      try {
        const noRisk = without(contract("invoice.get"), "risk");
        writeFileSync(join(dir, "invoice.get.json"), JSON.stringify(noRisk));
        const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
        const run = spawnSync(process.execPath, [main, dir], { encoding: "utf8" });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch("invoice.get.json: must have required property 'risk'");
        expect(run.stderr).not.toMatch("TypeError");
        expect(run.stdout).not.toMatch("operations:");
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );

  // Found by the review: the role table's lesson, for the inputs folder.
  it(
    "refuses to start without its inputs folder: it names the folder and prints no stack trace",
    { timeout: 30_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-inputs-"));
      try {
        const missing = join(dir, "inputs");
        const roles = fileURLToPath(new URL("../roles.json", import.meta.url));
        const run = spawnSync(process.execPath, [MAIN, CONTRACTS, roles, missing], {
          encoding: "utf8",
        });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(missing);
        expect(run.stderr).not.toMatch(/^\s+at /m);
        expect(run.stdout).not.toMatch("operations:");
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );

  // Start-up checks that every contract's input schema has a file.
  it(
    "refuses to start when a contract's input schema has no file: it names it and exits with code 1",
    { timeout: 30_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-contracts-"));
      try {
        // InvoiceSearchRequest, because InvoiceListRequest has a file now.
        const renamed = { ...contract("invoice.get"), input: { schema: "InvoiceSearchRequest" } };
        writeFileSync(join(dir, "invoice.get.json"), JSON.stringify(renamed));
        const run = spawnSync(process.execPath, [MAIN, dir], { encoding: "utf8" });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(
          "invoice.get: its input schema InvoiceSearchRequest has no file inputs/InvoiceSearchRequest.schema.json",
        );
        expect(run.stdout).not.toMatch("operations:");
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );

  // Start-up checks the role table too (step 06's README, decision 1). The
  // shipped contracts are named first, because the role table comes after them.
  it(
    "refuses to start with a broken role table: it names the problem and exits with code 1",
    { timeout: 30_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-roles-"));
      try {
        const roles = join(dir, "roles.json");
        writeFileSync(roles, JSON.stringify({ ...STARTING_ROLES, CFO: ["invoice:*"] }));
        const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
        const contracts = fileURLToPath(new URL("../contracts", import.meta.url));
        const run = spawnSync(process.execPath, [main, contracts, roles], { encoding: "utf8" });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(`roles.json: the role "CFO" grants "invoice:*"`);
        expect(run.stdout).not.toMatch("operations:");
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );

  // Found by the review: a role table read outside the start-up checks
  // still stopped the program, but with a stack trace instead of the problem.
  it(
    "refuses to start without its role table: it names the file and prints no stack trace",
    {
      timeout: 30_000,
    },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-roles-"));
      try {
        const missing = join(dir, "roles.json");
        const run = spawnSync(process.execPath, [MAIN, CONTRACTS, missing], { encoding: "utf8" });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(missing);
        expect(run.stderr).not.toMatch(/^\s+at /m);
        expect(run.stdout).not.toMatch("operations:");
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );

  // Start-up checks the map too, with the other files, before it prints
  // operations: (step 16's README, C6). The map is named after the labels file. DSOR_DB_URL
  // is emptied, so a program that skipped the map would stop at the database, never use it.
  it(
    "step 16's decision 4: refuses to start with a broken map: it names every problem and exits with code 1",
    { timeout: 30_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-store-"));
      try {
        const map = JSON.parse(readFileSync(STORE, "utf8"));
        map.tables["dsor.audit"].runtime.table.push("UPDATE");
        map.schemas.dsor.runtime.push("CREATE");
        const broken = join(dir, "store.json");
        writeFileSync(broken, JSON.stringify(map));
        const run = spawnSync(
          process.execPath,
          [MAIN, CONTRACTS, ROLES, INPUTS, CLASSIFICATIONS, broken],
          { encoding: "utf8", env: { ...process.env, DSOR_DB_URL: "" } },
        );
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(
          "store.json: dsor.audit lists UPDATE, which an append-only table does not allow",
        );
        expect(run.stderr).toMatch(
          "store.json: the schema dsor lists CREATE, and a schema allows only USAGE",
        );
        expect(run.stderr).not.toMatch(/^\s+at /m);
        expect(run.stdout).not.toMatch("operations:");
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );

  it(
    "step 16's decision 4: refuses to start without its map: it names the file and prints no stack trace",
    { timeout: 30_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-store-"));
      try {
        const missing = join(dir, "store.json");
        const run = spawnSync(
          process.execPath,
          [MAIN, CONTRACTS, ROLES, INPUTS, CLASSIFICATIONS, missing],
          { encoding: "utf8", env: { ...process.env, DSOR_DB_URL: "" } },
        );
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(missing);
        expect(run.stderr).not.toMatch(/^\s+at /m);
        expect(run.stdout).not.toMatch("operations:");
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );

  // Found by the review: a database the program cannot reach stopped it with a stack trace.
  // It answered nothing, so it failed closed, but the problem was not named. Port 1 on this
  // machine refuses at once, so the test needs no database.
  it(
    "step 16's decision 4: refuses to start when the database cannot be reached: it names why, with no stack trace",
    { timeout: 30_000 },
    () => {
      const unreachable = "postgresql://dsor_runtime:nothing@127.0.0.1:1/neondb";
      const run = spawnSync(process.execPath, [MAIN], {
        encoding: "utf8",
        env: { ...process.env, DSOR_DB_URL: unreachable },
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch("ECONNREFUSED");
      expect(run.stderr).not.toMatch(/^\s+at /m);
      expect(run.stdout).not.toMatch("data: {");
    },
  );

  // The program needs the database now, and it never falls back to a log
  // in memory (step 09's README, decision 15). The empty variable is kept: .env does not
  // override a variable that is already set, even to "".
  it(
    "refuses to start without DSOR_DB_URL: it names the variable, after the start-up checks",
    { timeout: 30_000 },
    () => {
      const run = spawnSync(process.execPath, [MAIN], {
        encoding: "utf8",
        env: { ...process.env, DSOR_DB_URL: "" },
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch("DSOR_DB_URL is not set");
      expect(run.stderr).not.toMatch(/^\s+at /m);
      // The contracts were checked first, so a broken contract is named even with no database.
      expect(run.stdout).toMatch("operations:");
      expect(run.stdout).not.toMatch("data: {");
    },
  );
});
