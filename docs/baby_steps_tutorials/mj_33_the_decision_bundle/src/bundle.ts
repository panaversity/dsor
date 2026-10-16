// NEW IN STEP 33: the decision bundle, one file of facts for one decision about a command, in the
// shape of the specification's decision-bundle.schema.json (DSOR-AUD-03a in
// specs/dsor/03-execution.md, section 29; step 33's README, decisions D1 to D14). The record says
// what happened to a call. The bundle says why: who asked under which slip, each rule with its
// version, each record line ⑨ read with its version, each conversion, the approvals counted, and how
// the call ended. Every field but agent_asserted is a fact DSoR established itself (D4).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AgentAsserted } from "./asserted.ts";
import type { BoundRead } from "./bound.ts";
import type { Claimed } from "./claims.ts";
import type { ControlOutcome } from "./controls.ts";
import { convertUp, rateBetween, type Converted } from "./exchange.ts";
import type { Conversion } from "./limits.ts";
import type { Decision } from "./log.ts";
import type { Money } from "./money.ts";
import type { Requester } from "./proposals.ts";
import type { Contract } from "./registry.ts";
import type { Counted } from "./release.ts";
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
  // What the agent said about itself, as line ① checked it. Only the record and the bundle are
  //   given it, never a check (D11, D12).
  asserted?: AgentAsserted;
  // Who asks, and under whose authority, once line ③ has passed. Before then there is no bundle
  //   (D1).
  asker?: Requester;
  // At a release, once line ⑧ has loaded the proposal: the contract of the stored request, which
  //   the release decides (D8).
  decided?: Contract;
  // Each record line ⑨ read, as it read it, a record that was not there too (D5).
  state: StateRead[];
  // Each amount line ⑩ converted, and the currency it went into, as the rules and the limits
  //   converted them (D6).
  converted: Converted[];
  // At a release, the approvals it counted (D7).
  counted?: Counted;
  // How the work ended, once the claim has given its outcome back (D9).
  executed: Executed;
};

/** A new, empty notebook of evidence, for one call. */
export function newEvidence(): Evidence {
  return { state: [], converted: [], executed: "not_executed" };
}

/** One read of line ⑨, as the bundle names it: its label's mode in capitals, as the schema writes it. */
export function stateReadOf(read: BoundRead): StateRead {
  const freshness = read.label.mode.toUpperCase() as StateRead["freshness"];
  return {
    uri: read.uri,
    ...(read.version === undefined ? {} : { version: read.version }),
    observed_at: read.label.observed_at,
    freshness,
  };
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
  // The request decided: at a release, the stored one, once line ⑧ has loaded it (D8).
  const decided = evidence.decided ?? called;
  const { counted } = evidence;
  return {
    decision_id: `dec_${randomUUID()}`,
    operation: `${decided.id}@${String(decided["version"])}`,
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
      // Each rule, with the approvals that met it at a release (D7).
      controls: (decision.controls ?? []).map((control) => {
        const met = counted?.satisfied[control.id] ?? [];
        return {
          ...structuredClone(control),
          ...(met.length === 0 ? {} : { satisfied_by: [...met] }),
        };
      }),
    },
    money: { conversions: conversionsOf(evidence.converted, ours.conversion) },
    state: structuredClone(evidence.state),
    ...(counted === undefined ? {} : approvalOf(counted)),
    sod_mode: "standard",
    // What the agent said about itself, apart from every fact above and below (D11).
    ...(evidence.asserted === undefined
      ? {}
      : { agent_asserted: structuredClone(evidence.asserted) }),
    execution: {
      // The proposal's id is the key of its execution (DSOR-IDM-04). A dry run has none.
      ...(proposal === undefined ? {} : { idempotency_key: parseUri(proposal).id }),
      semantics: semanticsOf(decided),
      result: evidence.executed,
    },
    extensions: { [OURS]: ownFields(decision) },
  };
}

/**
 * The approvals a release counted, as the bundle's one approval: the first, by id, the fingerprint
 * they all bind, and every approver, in the order given. One person approves a proposal once (step
 * 29's D3), so no approver is named twice. None when nothing was counted (D7).
 */
function approvalOf(counted: Counted): { approval?: DecisionBundle["approval"] } {
  const [first] = counted.approvals;
  if (first === undefined) return {};
  const approvers = counted.approvals.flatMap((a) => a.approvers.map((who) => who.principal));
  return {
    approval: {
      id: first.id,
      payload_hash: first.payload_hash,
      approvers,
    },
  };
}

/**
 * Each conversion the decision used, once, in the order it was made: the amount, the amount in the
 * other currency rounded up at the sixth place as a booking is, the rate to at most twelve places,
 * and the sheet's source and time (DSOR-MON-05). None without the sheet line ⑩ converted with.
 */
function conversionsOf(
  converted: readonly Converted[],
  sheet: Conversion | undefined,
): MoneyConversion[] {
  if (sheet === undefined) return [];
  const seen = new Set<string>();
  const named: MoneyConversion[] = [];
  for (const { from, to } of converted) {
    const key = `${from.value} ${from.currency} ${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const into = convertUp(from, to, sheet);
    const rate = rateBetween(from.currency, to, sheet);
    // The sheet converted this amount a moment ago, so neither can be missing but by a bug.
    if (into === undefined || rate === undefined)
      throw new Error(`no rate from ${from.currency} to ${to}`);
    named.push({
      from: { ...from },
      to: into,
      rate,
      source: sheet.source,
      as_of: sheet.published_at,
    });
  }
  return named;
}

/** What the schema has no field for, under this tutorial's own name, as in the record (D13). */
function ownFields(decision: Decision): Record<string, unknown> {
  const ours = decision.extensions?.[OURS] ?? {};
  const { invocation_mode, idempotency, denied_by, stale, approved_under } = ours;
  const { conversion, unconvertible } = ours;
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
    // The sheet's own lines that line ⑩ converted with, so the exact answer can be worked out
    //   again, and which currency had no usable rate, and why (step 26's D7 and L7; D6).
    ...(conversion === undefined ? {} : { sheet: structuredClone(conversion) }),
    ...(unconvertible === undefined ? {} : { unconvertible: { ...unconvertible } }),
    // Each rule that refused, with its own reason, and each stale rule with the version of its
    //   policy in force, as the record names them (step 27's D13, step 28b's D11).
    ...(denied_by === undefined ? {} : { denied_by: structuredClone(denied_by) }),
    ...(stale === undefined ? {} : { stale: structuredClone(stale) }),
    // At a release, the version of each rule the request was decided under, beside the version in
    //   controls: both versions, as DSOR-APR-03d asks.
    ...(approved_under === undefined ? {} : { approved_under: structuredClone(approved_under) }),
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
