// NEW IN STEP 14: an answer from which fields were left out lists them, so the agent does
// not take a missing field for missing data (DSOR-CLS-02b; step 14's README, C3). Each
// entry has the result envelope's shape: { field, reason, treatment }.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { checkClassifications, readClassifications, type Kinds } from "../src/labels.ts";
import { show } from "../src/masking.ts";
import { call } from "../src/pipeline.ts";
import {
  AGENT,
  CFO,
  INV_1008_OF_456,
  PLANTED,
  PLANTED_MASKED,
  SUPERVISOR,
  log,
  omitted,
  registry,
  runAs,
} from "./helpers.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

// The tests' own check, built from the copied schema files, not imported from src.
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(loadSchema("common.schema.json"));
ajv.addSchema(loadSchema("result-envelope.schema.json"));
const passesRedactions = ajv.compile({
  $ref: "urn:dsor:schema:1.3:result-envelope#/properties/redactions",
});

/** The shipped labels, read the way start-up reads them. */
function shippedKinds(): Kinds {
  return checkClassifications(readClassifications()).kinds;
}

/** The answer's redactions, or "none" when the answer has no such field. */
function redactionsOf(answer: Answer): unknown {
  return "redactions" in answer ? answer.redactions : "none";
}

describe("C3: an answer with fields left out lists them", () => {
  it("DSOR-CLS-02b: the agent's INV-1008 lists amount, then open_amount, each omitted for its clearance", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", GET_1008);
    expect(redactionsOf(answer)).toStrictEqual([omitted("amount"), omitted("open_amount")]);
  });

  // Ten items, and each field is named once, as a path into the page.
  it("DSOR-CLS-02b: the agent's page lists items[].amount and items[].open_amount, each once", async () => {
    const answer = await call(registry, log, AGENT, "invoice.list", {});
    expect(redactionsOf(answer)).toStrictEqual([
      omitted("items[].amount"),
      omitted("items[].open_amount"),
    ]);
  });

  // Listed as <unlabelled>, never by its own key, which the code chose and could fill with
  // data (step 14's README, decision 4). Changed by the Stage 2 review: it was listed as
  // vendor_bank_account. Fixed from step 14 on.
  it("DSOR-CLS-01: a field with no label, left out of the agent's answer, is listed as <unlabelled>", async () => {
    const answer = await runAs(AGENT, async () => ({ ...PLANTED }));
    expect(answer).toMatchObject({ data: PLANTED_MASKED });
    expect(redactionsOf(answer)).toStrictEqual([omitted("<unlabelled>")]);
  });

  it("DSOR-CLS-02b: at public, every field of INV-1008 is listed, in order of field", () => {
    const { redactions } = show(INV_1008_OF_456, "Invoice", shippedKinds(), "public");
    expect(redactions).toStrictEqual(
      ["amount", "id", "open_amount", "status", "tenant_id", "vendor_id"].map(omitted),
    );
  });

  it("DSOR-CLS-02b: every redaction passes the result envelope's schema for redactions", async () => {
    for (const [name, input] of [
      ["invoice.get", GET_1008],
      ["invoice.list", {}],
    ] as const) {
      const redactions = redactionsOf(await call(registry, log, AGENT, name, input));
      expect(Array.isArray(redactions)).toBe(true);
      expect(passesRedactions(redactions), JSON.stringify(passesRedactions.errors)).toBe(true);
    }
  });
});

describe("C3: an answer with nothing left out lists nothing", () => {
  it.each([
    ["cfo_100", CFO],
    ["user_123", SUPERVISOR],
  ])("decision 4: %s's INV-1008 and page carry no redactions", async (_name, who) => {
    expect(redactionsOf(await call(registry, log, who, "invoice.get", GET_1008))).toBe("none");
    expect(redactionsOf(await call(registry, log, who, "invoice.list", {}))).toBe("none");
  });

  // Only when something was left out (step 14's README, decision 4). Guards, like the two
  // above: they pass with or without step 14's code, so their titles name the decision, not
  // the rule. Found by the review.
  it("decision 4: an agent's answer with nothing above its clearance carries no redactions", async () => {
    expect(redactionsOf(await runAs(AGENT, async () => ({ ...PLANTED_MASKED })))).toBe("none");
    const empty = await call(registry, log, AGENT, "invoice.list", { cursor: "INV-9999" });
    expect(empty).toMatchObject({ data: { items: [] } });
    expect(redactionsOf(empty)).toBe("none");
  });
});
