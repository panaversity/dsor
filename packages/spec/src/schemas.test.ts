// Appendix A, proven. Every example validates, and every constraint the appendix
// says "the schema itself enforces" is shown to reject a broken document.
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import { describe, expect, it } from "vitest";
import { loadExample, loadSchema, schemaNames } from "./index.js";

// ajv-formats is CommonJS; under nodenext the callable sits on `.default`.
const addFormats = (addFormatsModule as unknown as { default: FormatsPlugin }).default;

type Json = Record<string, unknown>;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
for (const name of schemaNames()) ajv.addSchema(loadSchema(name) as Json);

const validate = (name: string, doc: unknown): boolean => {
  const fn = ajv.getSchema(`urn:dsor:schema:1.3:${name}`);
  if (!fn) throw new Error(`schema not registered: ${name}`);
  return fn(doc) as boolean;
};

const artifacts = schemaNames().filter((n) => n !== "common");

describe("DSOR-SCH-01: every example validates against its schema", () => {
  it.each(artifacts)("%s", (name) => {
    expect(validate(name, loadExample(name))).toBe(true);
  });

  it("covers the thirteen artifacts of Appendix A", () => {
    expect(artifacts).toHaveLength(13);
  });
});

/** A deep copy of an example that the test may break. */
const broken = (name: string, mutate: (doc: Json) => void): Json => {
  const doc = structuredClone(loadExample(name)) as Json;
  mutate(doc);
  return doc;
};
const child = (doc: Json, key: string): Json => doc[key] as Json;

const rejections: [rule: string, schema: string, mutate: (doc: Json) => void][] = [
  [
    "DSOR-MON-01: money value given as a number",
    "delegation",
    (d) => (child(child(d, "constraints"), "per_transaction_limit")["value"] = 50000),
  ],
  ["DSOR-OPR-02a: contract without a risk level", "operation-contract", (d) => delete d["risk"]],
  [
    "DSOR-UNK-03b: non-compensatable command without in-flight rules",
    "operation-contract",
    (d) => delete d["in_flight"],
  ],
  [
    "DSOR-APR-07: non-compensatable command without an approve_permission",
    "operation-contract",
    (d) => delete child(d, "authorization")["approve_permission"],
  ],
  ["DSOR-CTL-01a: control without a human owner", "control", (d) => delete d["owner"]],
  ["DSOR-CTL-02a: active control that nobody reviewed", "control", (d) => delete d["reviewed_by"]],
  [
    "DSOR-CTL-01b: governed authority without a content hash",
    "control",
    (d) => delete child(d, "authority")["content_hash"],
  ],
  [
    "DSOR-DEL-07: unattended request without a delegation",
    "security-context",
    (d) => delete d["delegation"],
  ],
  [
    "DSOR-DEL-08: unattended subject authority taken from a token",
    "security-context",
    (d) => (child(d, "subject_authority")["source"] = "token"),
  ],
  [
    "DSOR-APR-03e: critical approval with predicate binding",
    "approval",
    (d) => (d["risk"] = "critical"),
  ],
  [
    "DSOR-UNK-01b: OUTCOME_UNKNOWN marked safe to retry",
    "error-envelope",
    (d) => (d["retry"] = "safe_same_key"),
  ],
  [
    "DSOR-CNR-03c: shared connector without change detection",
    "connector",
    (d) => delete d["change_detection"],
  ],
  [
    "DSOR-SOD-09: owner-approval enabled without ceiling, cooling-off, or notification",
    "tenant-policy",
    (d) => (child(child(d, "sod"), "owner_approval")["enabled"] = true),
  ],
  [
    "DSOR-RID-01a: malformed canonical URI",
    "proposal",
    (d) => (d["uri"] = "dsor://acme corp/proposal/x"),
  ],
  [
    "DSOR-RP-07a: PENDING_APPROVAL result without a proposal URI",
    "result-envelope",
    (d) => delete d["proposal"],
  ],
  [
    "DSOR-SCH-02: unknown top-level field outside `extensions`",
    "event",
    (d) => (d["surprise"] = true),
  ],
];

describe("the schemas reject what Appendix A says they reject", () => {
  it.each(rejections)("%s", (_rule, schema, mutate) => {
    expect(validate(schema, broken(schema, mutate))).toBe(false);
  });
});
