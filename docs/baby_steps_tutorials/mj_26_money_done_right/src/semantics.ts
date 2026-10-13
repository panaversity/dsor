// Execution semantics, the label that answers "can this be undone?".
// Every command declares one in its contract (DSOR-EXE-05a), and its answer states it
// (DSOR-EXE-05b). specs/dsor/03-execution.md, section 24.
import type { Roles } from "./permissions.ts";
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

/**
 * Every problem with the undo lists the contracts write. A list must name at least one
 * operation, and each must be another command, with a contract and with code, whose
 * permission some role grants, so that DSoR can run it through the whole checklist
 * (DSOR-EXE-05c; step 17's README, decision 8).
 */
export function undoProblems(
  contracts: ReadonlyMap<string, Contract>,
  code: ReadonlyMap<string, unknown>,
  roles: Roles,
): string[] {
  const problems: string[] = [];
  for (const contract of contracts.values()) {
    // The schema makes a compensatable or saga command write a list, and makes each entry an
    // operation's id. It accepts an empty list and any id, so those are checked here. A list
    // that a contract writes under another label is checked too (decision 8).
    const list = (contract["execution"] as { compensated_by?: unknown } | undefined)
      ?.compensated_by;
    if (list === undefined) continue;
    // The label would say "can be undone", and nothing could undo it.
    if (!Array.isArray(list) || list.length === 0) {
      problems.push(`${contract.id}: compensated_by is empty, so it names nothing that undoes it`);
      continue;
    }
    for (const name of list as string[]) {
      const why = whyNotAnUndo(name, contract.id, contracts, code, roles);
      if (why !== undefined) {
        problems.push(`${contract.id}: compensated_by names ${JSON.stringify(name)}, ${why}`);
      }
    }
  }
  return problems;
}

// Why this operation cannot undo the other one, or undefined when it can.
function whyNotAnUndo(
  name: string,
  undone: string,
  contracts: ReadonlyMap<string, Contract>,
  code: ReadonlyMap<string, unknown>,
  roles: Roles,
): string | undefined {
  if (name === undone) return "which is the operation itself";
  const undo = contracts.get(name);
  if (undo === undefined) return "which has no contract";
  // A query changes nothing, so it undoes nothing. Anything but a command is refused: when
  // the answer is missing, the answer is no.
  if (undo["kind"] !== "command") return "which is a query";
  // A contract with no code cannot be run, so it cannot undo anything.
  if (!code.has(name)) return "which has no code";
  // An undo that nobody may run undoes nothing, whoever asks. One role is enough. Found by
  // step 17's review: with payment:cancel taken from every role, payment.create still said
  // "compensatable", and every cancel was refused.
  const needed = (undo["authorization"] as { permission?: unknown } | undefined)?.permission;
  const granted = [...roles.values()].some((grants) => grants.has(String(needed)));
  if (!granted) return "which no role may run";
  return undefined;
}
