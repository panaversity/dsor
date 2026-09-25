// NEW IN STEP 03: every operation has a name and a contract, checked at start-up.
// DSOR-OPR-01, DSOR-OPR-02a, DSOR-OPR-02b in specs/dsor/01-model.md, section 7.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One contract file, as it was read from disk: its name and its text. */
export type ContractSource = { file: string; text: string };

/** A contract that passed the schema. It is kept exactly as it was written. */
export type Contract = { readonly id: string; readonly [field: string]: unknown };

/** The code that runs an operation. */
export type Handler = (input: unknown) => unknown;

/** Every operation this program knows, each with its contract, and code for some. */
export type Registry = {
  contracts: ReadonlyMap<string, Contract>;
  handlers: ReadonlyMap<string, Handler>;
};

/** Reads every contract file in a folder. */
export function readContracts(dir: string): ContractSource[] {
  // Sorted, so the problems are always named in the same order.
  const files = readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
  return files.map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }));
}

/** Checks every contract and every handler, and refuses to build if anything is wrong. */
export function buildRegistry(
  _sources: ContractSource[],
  _handlers: Record<string, Handler>,
): Registry {
  return { contracts: new Map(), handlers: new Map() }; // RED: not built yet
}

/** Runs an operation by its name. */
export function call(_registry: Registry, _name: string, _input: unknown): unknown {
  throw new Error("not built yet"); // RED
}
