// NEW IN STEP 12: the cross-tenant suite (DSOR-TEN-02b). Not a test file itself: the
// tests in cross-tenant.test.ts and cross-tenant.db.test.ts run it.
// A stub for now: it attacks nothing and finds nothing, so the tests can fail first.
import type { Answer } from "../src/envelope.ts";
import type { DecisionLog } from "../src/log.ts";
import type { ContractSource, Registry } from "../src/registry.ts";

/** A principal the suite attacks as: its id, and the login token DSoR gave it. */
export type Attacker = { id: string; token: string };

/** One URI of org_456 in an example, and the three requests that swap it. */
export type Swap = { uri: string; requests: unknown[] };

/** What the suite did, and every problem it found. No findings means a pass. */
export type Report = { attacked: string[]; attacks: string[]; findings: string[] };

/** Every example request in a folder. */
export function readExamples(): ContractSource[] {
  return [];
}

/** Every principal whose roles in org_456 grant the operation's permission. */
export function attackersOf(_registry: Registry, _operation: string): Attacker[] {
  return [];
}

/** For each URI of org_456 in the example, the three requests that swap only it. */
export function swaps(_example: unknown): Swap[] {
  return [];
}

/** Why this answer to a foreign request is a finding, or undefined when it is a pass. */
export function judge(_answer: Answer): string | undefined {
  return undefined;
}

/** Why these answers are a finding, or undefined when they are the same. */
export function compare(_answers: Answer[]): string | undefined {
  return undefined;
}

/** Attacks every operation in the registry, and gives back what it found. */
export async function crossTenantSuite(
  _registry: Registry,
  _log: DecisionLog,
  _examples: ContractSource[],
): Promise<Report> {
  return { attacked: [], attacks: [], findings: [] };
}
