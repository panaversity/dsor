// Start-up. How the contract files are found, and the program itself.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readContracts } from "../src/registry.ts";
import { shipped } from "./helpers.ts";

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
});
