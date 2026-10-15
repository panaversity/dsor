// NEW IN STEP 32: a contract's preconditions, the conditions that must hold on the records line ⑨
// read, right now, or the command does not run (§21, line 9; step 32's README, decisions D3 to D5).
// Each is CEL, in Appendix B's environment, as a control's condition is (DSOR-CTL-05). They read
// only what DSoR read itself (DSOR-MOD-03), and only reads as fresh as the contract asks
// (DSOR-FRS-02a, DSOR-FRS-02b).
import { evaluateCondition, type Facts } from "./cel.ts";
import { Refusal } from "./envelope.ts";
import type { Freshness, FreshnessMode } from "./freshness.ts";
import type { Contract } from "./registry.ts";

type Preconditions = { freshness?: unknown; max_age_seconds?: unknown; predicates?: unknown };

/** The contract's preconditions, as written, or none. */
function preconditionsOf(contract: Contract): Preconditions {
  return (contract["preconditions"] as Preconditions | undefined) ?? {};
}

/** The contract's predicates, in its order. */
export function predicatesOf(contract: Contract): string[] {
  const listed = preconditionsOf(contract).predicates;
  return Array.isArray(listed) ? listed.map(String) : [];
}

/**
 * Start-up: a HIGH or CRITICAL command's preconditions are read current, unless the contract
 * explicitly permits bounded staleness, with its age (DSOR-FRS-02a).
 */
export function freshnessProblems(contracts: Iterable<Contract>): string[] {
  const problems: string[] = [];
  for (const contract of contracts) {
    const level = (contract["risk"] as { level?: unknown } | undefined)?.level;
    if (contract["kind"] !== "command" || (level !== "high" && level !== "critical")) continue;
    const { freshness, max_age_seconds } = preconditionsOf(contract);
    if (freshness === "current") continue;
    if (freshness === "bounded_staleness" && typeof max_age_seconds === "number") continue;
    problems.push(
      `${contract.id}: a ${level} command's preconditions must be read current, or with bounded_staleness and a max_age_seconds (DSOR-FRS-02a)`,
    );
  }
  return problems;
}

/**
 * Refuses with FRESHNESS_UNSATISFIABLE when a read line ⑨ made is less fresh than the contract
 * asks. DSoR never falls back to a cache: it refuses (DSOR-FRS-02b). The age is by DSoR's clock.
 */
export function checkFreshness(
  contract: Contract,
  labels: readonly Freshness[],
  now: number = Date.now(),
): void {
  const { freshness, max_age_seconds } = preconditionsOf(contract);
  for (const label of labels) {
    if (freshEnough(label, freshness, max_age_seconds, now)) continue;
    const why = `a read for ${contract.id} was ${label.mode} from ${label.connector}, and its preconditions ask for ${String(freshness)}`;
    throw new Refusal("FRESHNESS_UNSATISFIABLE", why, "internal");
  }
}

/** Whether one read meets what the contract asks. A mode the contract does not name asks nothing. */
function freshEnough(label: Freshness, asked: unknown, age: unknown, now: number): boolean {
  const mode: FreshnessMode = label.mode;
  if (asked === "current") return mode === "current";
  if (asked !== "bounded_staleness") return true;
  if (mode === "current") return true;
  if (mode !== "bounded_staleness" || typeof age !== "number") return false;
  // As moments, never as text. A read from the future is no fresher than one from now.
  const old = now - Date.parse(label.observed_at);
  return Number.isFinite(old) && old <= age * 1_000;
}

/**
 * Evaluates each predicate in the contract's order, on these facts, and refuses with CONFLICT at
 * the first that does not hold: §28 keeps CONFLICT for business-rule conflicts. One that cannot be
 * evaluated is false (DSOR-CTL-08). A precondition converts no currency in this step: a comparison
 * across two currencies cannot be evaluated, so it is false, the restrictive answer (DSOR-MON-04).
 */
export function checkPreconditions(contract: Contract, facts: Facts): void {
  for (const predicate of predicatesOf(contract)) {
    const answer = evaluateCondition(predicate, facts, undefined);
    if ("holds" in answer && answer.holds) continue;
    const failed = "error" in answer ? " (it could not be evaluated, so it counts as false)" : "";
    const why = `a precondition of ${contract.id} does not hold: ${predicate}${failed}`;
    throw new Refusal("CONFLICT", why, "internal");
  }
}
