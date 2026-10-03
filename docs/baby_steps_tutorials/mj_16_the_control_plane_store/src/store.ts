// NEW IN STEP 16: the map of DSoR's own store, store.json (step 16's README, decision 1).
// SHELL: the shape only. Every check answers "no problem" until the code is written.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

/** Whose a schema is: the company's, DSoR's, or nobody's. */
export type Side = "company" | "dsor" | "none";

/** One schema's line in the map: its side, and dsor_runtime's privileges on it. */
export type SchemaLine = { side: Side; runtime: string[] };

/** One table's line in the map: its kind, its company key, and dsor_runtime's privileges. */
export type TableLine = {
  kind: string;
  tenant: string | null;
  runtime: { table: string[]; columns: Record<string, string[]> };
};

/** The map, once start-up has checked it. */
export type StoreMap = {
  schemas: ReadonlyMap<string, SchemaLine>;
  tables: ReadonlyMap<string, TableLine>;
};

/** The map's file, as it was read from disk: its file name and its text. */
export type StoreSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../store.json", import.meta.url));

/** Reads the map: this step's own, unless another is named. */
export function readStore(path: string = SHIPPED): StoreSource {
  return { file: basename(path), text: readFileSync(path, "utf8") };
}

/** Checks the map, and names every problem. */
export function checkStore(_source: StoreSource): { map: StoreMap; problems: string[] } {
  return { map: { schemas: new Map(), tables: new Map() }, problems: [] };
}
