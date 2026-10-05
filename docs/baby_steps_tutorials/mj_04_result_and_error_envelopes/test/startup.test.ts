// Start-up. How the contract files are found, and the program itself.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contractFiles, readContracts } from "../src/registry.ts";
import { contract, shipped, without } from "./helpers.ts";

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

// No rule id: the program itself. Found by the review: nothing ran src/main.ts, so a
// start-up that skipped the registry passed every test.
describe("the program", () => {
  // NEW IN STEP 04: every answer the program prints is an envelope. The test waits up to
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
      expect(output).toMatch("correlation: { request_id: 'req_");
      expect(output).toMatch("dsor://org_456/invoice/INV-1008");
      expect(output).toMatch("{ tenant_id: 'org_456', entity: 'invoice', id: 'INV-1008' }");
      expect(output).toMatch("code: 'RESOURCE_NOT_FOUND'");
      expect(output).toMatch(`message: '"invoice.issue" is not built yet'`);
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
});
