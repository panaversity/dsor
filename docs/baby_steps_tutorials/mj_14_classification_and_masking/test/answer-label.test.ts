// NEW IN STEP 14: every query's answer carries a label, the highest among the fields it
// still contains after masking (DSOR-CLS-03; step 14's README, C4).
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { checkClassifications } from "../src/labels.ts";
import { show } from "../src/masking.ts";
import { call } from "../src/pipeline.ts";
import {
  AGENT,
  CFO,
  PLANTED,
  PLANTED_MASKED,
  SUPERVISOR,
  log,
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
const passesClassification = ajv.compile({
  $ref: "urn:dsor:schema:1.3:result-envelope#/properties/classification",
});

/** The answer's label, or "none" when the answer carries none. */
function labelOf(answer: Answer): unknown {
  return "classification" in answer ? answer.classification : "none";
}

describe("C4: every query's answer carries the highest label among the fields it contains", () => {
  // Break Y5: a label taken from the invoice before masking would say confidential here.
  it("DSOR-CLS-03: the agent's INV-1008 is internal: amount was left out, and nothing higher is left", async () => {
    expect(labelOf(await call(registry, log, AGENT, "invoice.get", GET_1008))).toBe("internal");
  });

  it("DSOR-CLS-03: a person's INV-1008 is confidential, because it holds amount", async () => {
    expect(labelOf(await call(registry, log, CFO, "invoice.get", GET_1008))).toBe("confidential");
  });

  it("DSOR-CLS-03: the agent's page is internal, and a person's is confidential", async () => {
    expect(labelOf(await call(registry, log, AGENT, "invoice.list", {}))).toBe("internal");
    expect(labelOf(await call(registry, log, CFO, "invoice.list", {}))).toBe("confidential");
  });

  // A page past the end holds no field, and its capped note is public.
  it("DSOR-CLS-03: an empty page is public, even for a person, with or without its capped note", async () => {
    const empty = await call(registry, log, CFO, "invoice.list", { cursor: "INV-9999" });
    expect(empty).toMatchObject({ data: { items: [] } });
    expect(labelOf(empty)).toBe("public");
    const capped = await call(registry, log, CFO, "invoice.list", {
      limit: 1000,
      cursor: "INV-9999",
    });
    expect(capped).toMatchObject({ data: { items: [], capped: { asked: 1000, max: 10 } } });
    expect(labelOf(capped)).toBe("public");
  });

  // Without the planted field the same answer is internal, so only the field that has no
  // label can make it confidential (step 14's README, C1).
  it("DSOR-CLS-01: a field with no label makes a person's answer confidential", async () => {
    expect(labelOf(await runAs(SUPERVISOR, async () => ({ ...PLANTED })))).toBe("confidential");
    expect(labelOf(await runAs(SUPERVISOR, async () => ({ ...PLANTED_MASKED })))).toBe(
      "internal",
    );
  });

  // No shipped field is restricted, so a file of the test's own gives one.
  it("DSOR-CLS-03: one restricted field makes the whole answer restricted", () => {
    const labels = { tenant_id: "internal", id: "public", iban: "restricted", name: "internal" };
    const text = JSON.stringify({ Payee: labels });
    const { kinds } = checkClassifications({ file: "classifications.json", text });
    const payee = {
      tenant_id: "org_456",
      id: "VENDOR-44",
      iban: "PK36SCBL0000001123456702",
      name: "Acme Supplies",
    };
    expect(show(payee, "Payee", kinds, undefined).classification).toBe("restricted");
    expect(show(payee, "Payee", kinds, "confidential").classification).toBe("internal");
  });

  it("DSOR-CLS-03: every label passes the result envelope's schema for classification", async () => {
    for (const who of [AGENT, CFO]) {
      const label = labelOf(await call(registry, log, who, "invoice.get", GET_1008));
      expect(passesClassification(label), `${String(label)}`).toBe(true);
    }
  });

  // The error envelope's schema has no field for a label (step 14's README, what the
  // specification asks, 7).
  it("DSOR-CLS-03: a refusal carries no label", async () => {
    const refused = await call(registry, log, CFO, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-9999",
    });
    expect(refused).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(labelOf(refused)).toBe("none");
  });
});
