// NEW IN STEP 21: optimistic concurrency. A command names the version of the record its caller
// decided on, and DSoR refuses with STALE_STATE when the record has moved on (DSOR-CON-01a and
// DSOR-CON-01b in specs/dsor/03-execution.md, section 23; step 21's README, decisions 5, 7, and
// 10). The comparison is made by each command's code, and by the store at the moment it writes.
import { Refusal } from "./envelope.ts";
import type { InputSource } from "./inputs.ts";
import type { Contract } from "./registry.ts";

/**
 * The refusal of a request decided on another version of a record: read again, and decide
 * again. Internal, as the record's version is (step 21's README, decision 9).
 */
export function staleRefusal(record: string, now: number, decided: number): Refusal {
  const message = `${record} is at version ${now}, and the request was decided on version ${decided}`;
  return new Refusal("STALE_STATE", message, "internal");
}

// The largest version app.invoices and app.payments can hold: PostgreSQL's integer.
const LARGEST = 2147483647;

// The strategies of operation-contract.schema.json that this step keeps. The schema makes every
// command name one (DSOR-CON-01a). none asks for nothing, so there is nothing to build.
const BUILT = ["optimistic", "none"];

/**
 * Every command whose strategy this step does not build, and every optimistic command whose
 * input schema does not require expected_version, a whole number from 1 to 2147483647. A contract
 * promises its callers what DSoR does, so start-up refuses a promise it cannot keep.
 */
export function concurrencyProblems(
  contracts: Iterable<Contract>,
  sources: readonly InputSource[],
): string[] {
  const problems: string[] = [];
  for (const contract of contracts) {
    if (contract["kind"] !== "command") continue;
    const strategy = (contract["concurrency"] as { strategy?: unknown } | undefined)?.strategy;
    if (typeof strategy !== "string") continue; // the contract schema has refused it already
    if (!BUILT.includes(strategy)) {
      const named = JSON.stringify(strategy);
      problems.push(
        `${contract.id}: the concurrency strategy ${named} is not built yet (DSOR-CON-01a)`,
      );
    } else if (strategy === "optimistic" && !asksForVersion(contract, sources)) {
      const needs =
        "an optimistic command's input must require expected_version, a whole number from 1 to 2147483647";
      problems.push(`${contract.id}: ${needs} (DSOR-CON-01b)`);
    }
  }
  return problems;
}

// True when the contract's input schema requires expected_version, an integer of at least 1.
// A schema with no file, or one that is not JSON, has a problem of its own in checkInputs.
function asksForVersion(contract: Contract, sources: readonly InputSource[]): boolean {
  const file = `${(contract["input"] as { schema: string }).schema}.schema.json`;
  const text = sources.find((source) => source.file === file)?.text;
  if (text === undefined) return true;
  let schema: unknown;
  try {
    schema = JSON.parse(text);
  } catch {
    return true;
  }
  const { required, properties } = (schema ?? {}) as {
    required?: unknown;
    properties?: { expected_version?: { type?: unknown; minimum?: unknown; maximum?: unknown } };
  };
  const version = properties?.expected_version;
  // And no larger than the database's integer column holds. Found by the review: a larger
  // version reached the database, and the cancel failed with INTERNAL_ERROR.
  return (
    Array.isArray(required) &&
    required.includes("expected_version") &&
    version?.type === "integer" &&
    typeof version.minimum === "number" &&
    version.minimum >= 1 &&
    typeof version.maximum === "number" &&
    version.maximum <= LARGEST
  );
}
