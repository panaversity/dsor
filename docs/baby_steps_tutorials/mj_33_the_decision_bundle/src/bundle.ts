// NEW IN STEP 33: the decision bundle, one file of facts for one decision about a command, in the
// shape of the specification's decision-bundle.schema.json (DSOR-AUD-03a in
// specs/dsor/03-execution.md, section 29; step 33's README, decisions D1 to D14). The record says
// what happened to a call. The bundle says why: who asked under which slip, each rule with its
// version, each record line ⑨ read with its version, each conversion, the approvals counted, and how
// the call ended. Every field but agent_asserted is a fact DSoR established itself (D4).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Claimed } from "./claims.ts";
import type { ControlOutcome } from "./controls.ts";
import type { Decision } from "./log.ts";
import type { Money } from "./money.ts";
import type { Requester } from "./proposals.ts";
import type { Contract } from "./registry.ts";
import { semanticsOf, type Semantics } from "./semantics.ts";
import { parseUri } from "./uri.ts";

/** One rule line ⑩ evaluated, as the record names it, and the approvals that met it at a release. */
export type BundleControl = ControlOutcome & { satisfied_by?: string[] };

/** One record line ⑨ read: its address, its version when there was a record, and its read's label. */
export type StateRead = {
  uri: string;
  version?: number | string;
  observed_at: string;
  freshness: "CURRENT" | "BOUNDED_STALENESS" | "CONNECTOR_DEFINED" | "OBSERVATIONAL";
};

/** One amount line ⑩ converted into another currency, with the rate, its source, and its time. */
export type MoneyConversion = {
  from: Money;
  to: Money;
  rate: string;
  source: string;
  as_of: string;
};

/** How the call's work ended: it ran and was kept, it ran and said no, or it never ran (D9). */
export type Executed = "committed" | "failed" | "not_executed";

/** One decision bundle, in the shape of decision-bundle.schema.json. */
export type DecisionBundle = {
  decision_id: string;
  operation: string;
  proposal?: string;
  tenant: string;
  identity: {
    mode: "direct" | "unattended";
    subject: string;
    actor_chain: string[];
    subject_authority: { source: "token" | "role_source"; as_of: string };
  };
  authority: {
    delegation?: string;
    authorization: "ALLOW" | "DENY";
    controls: BundleControl[];
  };
  money: { conversions: MoneyConversion[] };
  state: StateRead[];
  approval?: { id: string; payload_hash: string; approvers: string[] };
  sod_mode: "standard";
  agent_asserted?: Record<string, unknown>;
  execution: { idempotency_key?: string; semantics: Semantics; result: Executed };
  extensions?: { [namespace: string]: Record<string, unknown> };
};

/** A bundle as the log keeps it: with the time the store gave it when it was sealed (D3). */
export type SealedBundle = DecisionBundle & { sealed_at: string };

/**
 * The notebook of evidence: what one call writes down as it goes through the checklist, for its
 * bundle. Only the checklist holds it, as only the checklist holds the notebook of reads (step 15).
 */
export type Evidence = {
  // Who asks, and under whose authority, once line ③ has passed. Before then there is no bundle
  //   (D1).
  asker?: Requester;
  // How the work ended, once the claim has given its outcome back (D9).
  executed: Executed;
};

/** A new, empty notebook of evidence, for one call. */
export function newEvidence(): Evidence {
  return { executed: "not_executed" };
}

/**
 * How the claim's work ended, for the bundle: committed when the work ran and was kept, failed when
 * it ran and refused, and not_executed for a replay, which ran nothing, and for a refusal before the
 * work, which lines ⑧ to ⑩ gave (D9).
 */
export function executedOf(claimed: Claimed): Executed {
  if (claimed.replay_of !== undefined) return "not_executed";
  if ("value" in claimed) return "committed";
  if ("refused" in claimed && claimed.denied !== true) return "failed";
  return "not_executed";
}

// The reverse domain name this tutorial's own fields sit under, as in the record (DSOR-SCH-02).
const OURS = "org.panaversity.steps";

/**
 * The bundle of one decision, or none when no bundle is due: a query, or a call refused before line
 * ③ passed (D1). Built from the record DSoR is about to write, and from the notebook of evidence.
 */
export function bundleOf(
  decision: Decision,
  evidence: Evidence,
  // The operation called, whose contract line ③ to line ⑤ read. None for a name with no contract.
  called: Contract | undefined,
): DecisionBundle | undefined {
  const { asker } = evidence;
  if (called?.["kind"] !== "command" || asker === undefined || decision.tenant === undefined) {
    return undefined;
  }
  const ours = decision.extensions?.[OURS] ?? {};
  const proposal = ours.proposal;
  return {
    decision_id: `dec_${randomUUID()}`,
    operation: `${called.id}@${String(called["version"])}`,
    ...(proposal === undefined ? {} : { proposal }),
    tenant: decision.tenant,
    identity: {
      mode: asker.identity_mode,
      subject: asker.subject,
      actor_chain: [...asker.actor_chain],
      subject_authority: { ...asker.subject_authority },
    },
    authority: {
      ...(asker.delegation === undefined ? {} : { delegation: asker.delegation }),
      authorization: decision.authorization,
      controls: structuredClone(decision.controls ?? []),
    },
    money: { conversions: [] },
    state: [],
    sod_mode: "standard",
    execution: {
      // The proposal's id is the key of its execution (DSOR-IDM-04). A dry run has none.
      ...(proposal === undefined ? {} : { idempotency_key: parseUri(proposal).id }),
      semantics: semanticsOf(called),
      result: evidence.executed,
    },
    extensions: { [OURS]: ownFields(decision) },
  };
}

/** What the schema has no field for, under this tutorial's own name, as in the record (D13). */
function ownFields(decision: Decision): Record<string, unknown> {
  const ours = decision.extensions?.[OURS] ?? {};
  const { invocation_mode, idempotency } = ours;
  return {
    // The call, so its bundle and its record can be found together.
    correlation: structuredClone(decision.correlation),
    // What the caller heard, and why, which the bundle's schema has no field for.
    answer: {
      result: decision.result,
      ...(decision.reason === undefined ? {} : { reason: decision.reason }),
    },
    ...(invocation_mode === undefined ? {} : { invocation_mode }),
    ...(idempotency === undefined ? {} : { idempotency: { ...idempotency } }),
  };
}

// The specification's schemas, copied byte for byte (step 03's README, decision 3). The options are
// those of controls.ts: name every problem, and never change what is checked. validateFormats is
// off, as there, so a time's "date-time" is not checked here: DSoR writes every time in a bundle
// from its own clock, or from a label that step 15's checkedLabel checked.
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
const ajv = new Ajv2020({
  allErrors: true,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
  validateFormats: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
const passesSchema = ajv.compile(loadSchema("decision-bundle.schema.json"));

/** Every way the bundle fails decision-bundle.schema.json, in words. None when it passes. */
export function bundleProblems(bundle: unknown): string[] {
  if (passesSchema(bundle)) return [];
  return (passesSchema.errors ?? []).map(
    (error) => `${error.instancePath || "the bundle"} ${error.message ?? "is not valid"}`,
  );
}

/** Refuses a bundle that fails its schema: the store cannot take it (D2). */
export function checkBundle(bundle: unknown): void {
  const problems = bundleProblems(bundle);
  if (problems.length > 0) {
    throw new Error(`the bundle does not validate: ${problems.join("; ")}`);
  }
}
