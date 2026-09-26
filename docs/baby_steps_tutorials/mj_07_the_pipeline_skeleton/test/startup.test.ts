// Start-up. How the contract files are found, and the program itself.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRoles } from "../src/permissions.ts";
import { contractFiles, readContracts } from "../src/registry.ts";
import { STARTING_ROLES, contract, notGranted, shipped, without } from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const CONTRACTS = fileURLToPath(new URL("../contracts", import.meta.url));

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

  it("the shipped folder holds the two contracts", () => {
    expect(shipped.map((s) => s.file)).toEqual(["invoice.get.json", "invoice.issue.json"]);
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
  // Every answer the program prints is an envelope. The test waits up to
  // 30 seconds. Found live 2026-09-26: on a busy machine, starting node took longer than
  // vitest's 5-second default, and the test failed with no bug in the code.
  it(
    "starts, reads INV-1008 through invoice.get, and prints every answer as an envelope",
    {
      timeout: 30_000,
    },
    () => {
      const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
      const output = execFileSync(process.execPath, [main], { encoding: "utf8" });
      expect(output).toMatch("operations: [ 'invoice.get', 'invoice.issue' ]");
      // Found by the review: "id: 'INV-1008'" also matches the address read back, so the
      // success envelope could go unprinted. "data: {" is only in the success.
      expect(output).toMatch("data: {");
      expect(output).toMatch("id: 'INV-1008'");
      // The correlation also names the caller, so it may not fit on one line.
      expect(output).toMatch(/request_id: 'req_/);
      expect(output).toMatch("agent_id: 'accounts-payable-fte'");
      expect(output).toMatch("dsor://org_456/invoice/INV-1008");
      expect(output).toMatch("{ tenant_id: 'org_456', entity: 'invoice', id: 'INV-1008' }");
      expect(output).toMatch("code: 'RESOURCE_NOT_FOUND'");
      // The agent may not issue. user_123 may, and hears "not built yet".
      expect(output).toMatch(`message: '${notGranted("invoice.issue", "invoice:issue")}'`);
      expect(output).toMatch(`message: '"invoice.issue" is not built yet'`);
      // NEW IN STEP 07: user_123 sends a bad input, and line ⑥ refuses it.
      expect(output).toMatch(
        `message: 'the input of "invoice.issue" is not valid: /invoice must match pattern`,
      );
      // A call with no login and a call that names the CFO are refused. The
      // CFO is never named as the caller. A person's own request id comes back with its id.
      expect(output).toMatch("code: 'AUTHENTICATION_REQUIRED'");
      expect(output).toMatch("code: 'AUTHORIZATION_DENIED'");
      expect(output).not.toMatch("principal_id: 'cfo_100'");
      expect(output).toMatch("{ request_id: 'ap-desk-7', principal_id: 'user_123' }");
    },
  );

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

  // NEW IN STEP 07. Found by the review: the role table's lesson, for the inputs folder.
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

  // NEW IN STEP 07: start-up checks that every contract's input schema has a file.
  it(
    "refuses to start when a contract's input schema has no file: it names it and exits with code 1",
    { timeout: 30_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-contracts-"));
      try {
        const renamed = { ...contract("invoice.get"), input: { schema: "InvoiceListRequest" } };
        writeFileSync(join(dir, "invoice.get.json"), JSON.stringify(renamed));
        const run = spawnSync(process.execPath, [MAIN, dir], { encoding: "utf8" });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(
          "invoice.get: its input schema InvoiceListRequest has no file inputs/InvoiceListRequest.schema.json",
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

  // Found by the review: a program that looked for roles.json in the
  // folder it was started from passed every test, because the tests start it from here.
  it("finds its own role table, whatever folder it is started from", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "dsor-elsewhere-"));
    try {
      const run = spawnSync(process.execPath, [MAIN], { cwd: dir, encoding: "utf8" });
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(`message: '${notGranted("invoice.issue", "invoice:issue")}'`);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

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
});
