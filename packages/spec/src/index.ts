// The machine-readable half of the DSoR specification.
//
// The prose lives in specs/dsor/. This package holds what a program can check:
// the JSON Schemas (Appendix A), one validated example per schema, and the
// requirement registry that `pnpm guard --write` generates from the prose.
import { readdirSync, readFileSync } from "node:fs";

export const SPEC_VERSION = "1.4.0";

/** The `$id` prefix shared by every schema, e.g. `urn:dsor:schema:1.3:control`. */
export const SCHEMA_ID_PREFIX = "urn:dsor:schema:1.3:";

export type Level = "L1" | "L2" | "L3" | "RP" | "STACK";

export interface Requirement {
  /** Stable identifier, e.g. `DSOR-IDM-01c`. Never reused, never renumbered. */
  id: string;
  level: Level;
  /** Section number in the specification, e.g. `22`. */
  section: string;
  /** The normative sentence. It holds exactly one MUST or MUST NOT. */
  text: string;
  /** Repository path of the spec file that defines it. */
  file: string;
}

const at = (path: string): URL => new URL(`../${path}`, import.meta.url);
const readJson = (path: string): unknown => JSON.parse(readFileSync(at(path), "utf8"));

/** Schema names without the `.schema.json` suffix, e.g. `control`, `approval`. */
export function schemaNames(): string[] {
  return readdirSync(at("schemas/"))
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => f.replace(/\.schema\.json$/, ""))
    .sort();
}

export function loadSchema(name: string): unknown {
  return readJson(`schemas/${name}.schema.json`);
}

/** The validated example instance for a schema. `common` has none. */
export function loadExample(name: string): unknown {
  return readJson(`examples/${name}.example.json`);
}

export function loadRequirements(): Requirement[] {
  const registry = readJson("requirements.json") as { requirements: Requirement[] };
  return registry.requirements;
}
