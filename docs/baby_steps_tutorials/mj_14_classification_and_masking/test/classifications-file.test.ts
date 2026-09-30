// NEW IN STEP 14: classifications.json gives every field its label, and start-up checks
// it as it checks roles.json (step 14's README, decision 1). No rule id: a label that is
// not one of the four stops the program, which is this tutorial's choice.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LABELS as FOUR, checkClassifications, readClassifications } from "../src/classification.ts";
import { readInputs } from "../src/inputs.ts";
import { buildRegistry } from "../src/registry.ts";
import { handlers, refusal, shipped, shippedRoles } from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const CONTRACTS = fileURLToPath(new URL("../contracts", import.meta.url));
const ROLES = fileURLToPath(new URL("../roles.json", import.meta.url));
const INPUTS = fileURLToPath(new URL("../inputs", import.meta.url));

// The labels, typed out again from step 14's README, decision 1, rather than read from
// the file, so a mistake in the file is not copied into the test.
const LABELS = {
  Invoice: {
    id: "internal",
    tenant_id: "internal",
    vendor_id: "internal",
    status: "internal",
    amount: "confidential",
    open_amount: "confidential",
  },
  InvoicePage: { items: "Invoice[]", next_cursor: "internal", capped: "public" },
};

/** A classifications file, as start-up would read it from disk. */
function file(text: string): { file: string; text: string } {
  return { file: "classifications.json", text };
}

/** The problems start-up finds in this table. */
function problemsIn(table: unknown): string[] {
  return checkClassifications(file(JSON.stringify(table))).problems;
}

/** The problem a value that is neither a label nor a list of a known kind gets. */
function notALabel(where: string, value: string): string {
  return `classifications.json: ${where} is ${value}, which is neither a label nor a list of a kind the file has`;
}

describe("decision 1: classifications.json, checked at start-up", () => {
  // The schema's own four words, in its own order: least sensitive first.
  it("the four labels, lowest first, are the ones the specification's schema lists", () => {
    const common = JSON.parse(
      readFileSync(new URL("../schemas/common.schema.json", import.meta.url), "utf8"),
    ) as { $defs: { classification: { enum: string[] } } };
    expect(FOUR).toStrictEqual(common.$defs.classification.enum);
  });

  it("the shipped file gives every field of an invoice and of a page its label, and passes", () => {
    const { kinds, problems } = checkClassifications(readClassifications());
    expect(problems).toStrictEqual([]);
    const asRead = Object.fromEntries(
      [...kinds].map(([kind, fields]) => [kind, Object.fromEntries(fields)]),
    );
    expect(asRead).toStrictEqual(LABELS);
  });

  // The four labels, as the schema writes them, and nothing else. INTERNAL in capitals is
  // how the specification's prose writes it, and the schema refuses it.
  it.each([
    ["secret", '"secret"'],
    ["INTERNAL", '"INTERNAL"'],
    ["", '""'],
    [3, "3"],
    [null, "null"],
  ])("the label %j stops start-up", (label, shown) => {
    expect(problemsIn({ ...LABELS, Invoice: { ...LABELS.Invoice, status: label } })).toStrictEqual(
      [notALabel("Invoice.status", shown)],
    );
  });

  it("a list of a kind the file does not have stops start-up", () => {
    const page = { ...LABELS.InvoicePage, items: "Vendor[]" };
    expect(problemsIn({ ...LABELS, InvoicePage: page })).toStrictEqual([
      notALabel("InvoicePage.items", '"Vendor[]"'),
    ]);
  });

  // JSON.parse keeps the last of two values and says nothing, so a second "amount" line
  // could quietly make amount public (step 06's lesson, for roles.json).
  it("a key written twice stops start-up", () => {
    const text = '{ "Invoice": { "id": "internal", "amount": "confidential", "amount": "public" } }';
    expect(checkClassifications(file(text)).problems).toStrictEqual([
      'classifications.json: "amount" is written twice in one object',
    ]);
  });

  it.each([
    ["text that is not JSON", "{", "classifications.json: not valid JSON"],
    [
      "a list",
      "[]",
      "classifications.json: must be an object that gives each kind its fields' labels",
    ],
    [
      "a kind that is not an object",
      '{ "Invoice": "internal" }',
      'classifications.json: the kind "Invoice" must be an object that gives each field a label',
    ],
  ])("%s stops start-up", (_what, text, problem) => {
    expect(checkClassifications(file(text)).problems).toStrictEqual([problem]);
  });

  it("the registry names the file's problems with every other problem, and refuses to build", () => {
    const bad = file(JSON.stringify({ ...LABELS, Invoice: { ...LABELS.Invoice, status: "secret" } }));
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, readInputs(), bad))).toBe(
      `the registry refused to start:\n  ${notALabel("Invoice.status", '"secret"')}`,
    );
  });

  // The file can be named after the inputs folder, so a test can start the program with a
  // broken one, as it does with the role table.
  it(
    "the program refuses to start with a broken classifications.json: it names the problem and exits with code 1",
    { timeout: 30_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-classifications-"));
      try {
        const path = join(dir, "classifications.json");
        const broken = { ...LABELS, Invoice: { ...LABELS.Invoice, amount: "SECRET" } };
        writeFileSync(path, JSON.stringify(broken));
        const run = spawnSync(process.execPath, [MAIN, CONTRACTS, ROLES, INPUTS, path], {
          encoding: "utf8",
          timeout: 25_000,
        });
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(notALabel("Invoice.amount", '"SECRET"'));
        expect(run.stdout).not.toMatch("operations:");
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );
});
