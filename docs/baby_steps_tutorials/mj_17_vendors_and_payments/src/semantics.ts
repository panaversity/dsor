// NEW IN STEP 17: execution semantics, the label that answers "can this be undone?".
// Every command declares one in its contract (DSOR-EXE-05a), and its answer states it
// (DSOR-EXE-05b). specs/dsor/03-execution.md, section 24.
import type { Contract } from "./registry.ts";

/** The five labels of §24, written as common.schema.json writes them, in lower case. */
export type Semantics = "atomic" | "compensatable" | "saga" | "best_effort" | "non_compensatable";

const SEMANTICS: readonly string[] = [
  "atomic",
  "compensatable",
  "saga",
  "best_effort",
  "non_compensatable",
];

/**
 * The semantics a command's contract declares. Start-up has checked every contract against
 * the schema, so a command with none is a bug in how its registry was built.
 */
export function semanticsOf(contract: Contract): Semantics {
  // From the contract, never from the code's answer: the code cannot choose its own label
  // (step 17's README, C2).
  const declared = (contract["execution"] as { semantics?: unknown } | undefined)?.semantics;
  if (typeof declared !== "string" || !SEMANTICS.includes(declared)) {
    throw new Error("the command's contract declares no execution semantics");
  }
  return declared as Semantics;
}
