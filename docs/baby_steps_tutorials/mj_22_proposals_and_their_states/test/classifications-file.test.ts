// Classifications.json gives every field its label, and start-up checks
// it as it checks roles.json (step 14's README, decision 1). No rule id: a label that is
// not one of the four stops the program, which is this tutorial's choice.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LABELS as FOUR, checkClassifications, readClassifications } from "../src/labels.ts";
import { readInputs } from "../src/inputs.ts";
import { buildRegistry } from "../src/registry.ts";
import { contract, handlers, refusal, shipped, shippedRoles, source } from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const CONTRACTS = fileURLToPath(new URL("../contracts", import.meta.url));
const ROLES = fileURLToPath(new URL("../roles.json", import.meta.url));
const INPUTS = fileURLToPath(new URL("../inputs", import.meta.url));

// The labels, typed out again from step 14's README, decision 1, rather than read from
// the file, so a mistake in the file is not copied into the test. Changed by the Stage 2
// review: amount, open_amount, and capped hold objects, so each names its kind beside its
// own label, and each kind has lines of its own. invoice.issue's result has a kind too.
const LABELS = {
  Invoice: {
    id: "internal",
    tenant_id: "internal",
    vendor_id: "internal",
    status: "internal",
    amount: "confidential Money",
    open_amount: "confidential Money",
    // Since step 21 (step 21's README, decision 9).
    version: "internal",
  },
  Money: { value: "confidential", currency: "confidential" },
  InvoicePage: { items: "Invoice[]", next_cursor: "internal", capped: "public Capped" },
  Capped: { asked: "public", max: "public" },
  // A payment, labelled as an invoice is: its amount confidential, the rest internal (step
  // 17's README, decision 15).
  Payment: {
    id: "internal",
    tenant_id: "internal",
    invoice_id: "internal",
    vendor_id: "internal",
    status: "internal",
    amount: "confidential Money",
    version: "internal",
  },
  InvoiceIssueResult: {},
};

/** A classifications file, as start-up would read it from disk. */
function file(text: string): { file: string; text: string } {
  return { file: "classifications.json", text };
}

/** The problems start-up finds in this table. */
function problemsIn(table: unknown): string[] {
  return checkClassifications(file(JSON.stringify(table))).problems;
}

/** The problem a value that is not a label, a label and a known kind, or a list of one gets. */
function notALabel(where: string, value: string): string {
  return `classifications.json: ${where} is ${value}, which is not a label, a label and a kind the file has, or a list of a kind the file has`;
}

describe("decision 1: classifications.json, checked at start-up", () => {
  // The schema's own four words, in its own order: least sensitive first.
  it("the four labels, lowest first, are the ones the specification's schema lists", () => {
    const common = JSON.parse(
      readFileSync(new URL("../schemas/common.schema.json", import.meta.url), "utf8"),
    ) as { $defs: { classification: { enum: string[] } } };
    expect(FOUR).toStrictEqual(common.$defs.classification.enum);
  });

  it("the shipped file gives every field of an invoice, a page, and a payment its label, and passes", () => {
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
    expect(problemsIn({ ...LABELS, Invoice: { ...LABELS.Invoice, status: label } })).toStrictEqual([
      notALabel("Invoice.status", shown),
    ]);
  });

  it("a list of a kind the file does not have stops start-up", () => {
    const page = { ...LABELS.InvoicePage, items: "Vendor[]" };
    expect(problemsIn({ ...LABELS, InvoicePage: page })).toStrictEqual([
      notALabel("InvoicePage.items", '"Vendor[]"'),
    ]);
  });

  // A field that holds an object names its kind after its own label. Each part is checked,
  // as a label alone is. Found by the Stage 2 review, and fixed from step 14 on.
  it.each([
    ["a kind the file does not have", "confidential Vendor"],
    ["a label that is not one of the four", "secret Money"],
    ["the label in capitals", "CONFIDENTIAL Money"],
    ["the kind with no label", "Money"],
    ["three words", "confidential Money now"],
    ["a list with a label", "confidential Money[]"],
  ])("a label and a kind with %s stops start-up", (_what, line) => {
    const invoice = { ...LABELS.Invoice, amount: line };
    expect(problemsIn({ ...LABELS, Invoice: invoice })).toStrictEqual([
      notALabel("Invoice.amount", JSON.stringify(line)),
    ]);
  });

  // Every contract's output kind must have its lines, or its answer would be masked by
  // "confidential" alone, and name no row in its record (step 14's README, decisions 1
  // and 7). Found by the Stage 2 review, and fixed from step 14 on.
  it("a contract whose output kind the file does not have stops start-up, naming the contract", () => {
    // A vendor, which no step has labelled yet. Step 17's Payment has its lines now.
    const vendor = {
      ...contract("invoice.get"),
      id: "vendor.get",
      output: { schema: "Vendor" },
    };
    expect(refusal(() => buildRegistry([...shipped, source(vendor)], handlers, shippedRoles))).toBe(
      'the registry refused to start:\n  vendor.get: its output kind "Vendor" has no entry in classifications.json',
    );
  });

  it("the shipped contracts' output kinds are each in the file: invoice.issue's too", () => {
    const { InvoiceIssueResult: _left_out, ...without } = LABELS;
    const labels = file(JSON.stringify(without));
    expect(
      refusal(() => buildRegistry(shipped, handlers, shippedRoles, readInputs(), labels)),
    ).toBe(
      'the registry refused to start:\n  invoice.issue: its output kind "InvoiceIssueResult" has no entry in classifications.json',
    );
  });

  // JSON.parse keeps the last of two values and says nothing, so a second "amount" line
  // could quietly make amount public (step 06's lesson, for roles.json).
  it("a key written twice stops start-up", () => {
    const text =
      '{ "Invoice": { "id": "internal", "amount": "confidential", "amount": "public" } }';
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
    const bad = file(
      JSON.stringify({ ...LABELS, Invoice: { ...LABELS.Invoice, status: "secret" } }),
    );
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
