// The log of decisions, one record for every answer call gives, written before the answer
// leaves. DSOR-EXE-02 in specs/dsor/03-execution.md, section 21.
// This file holds the log in memory, for the unit tests. The log the program uses is a
// table in the database: createDbLog in postgres.ts.
import { randomUUID } from "node:crypto";
import type { Freshness, FreshnessMode } from "./freshness.ts";
import type { Label } from "./labels.ts";
import type { Answer, Correlation } from "./envelope.ts";
import type { Contract } from "./registry.ts";

// The audit record's own field names, where this step can fill them honestly (step 08's
// README, decision 5).
/** What call decided about one request. The log adds the rest of the record. */
export type Decision = {
  kind: "decision";
  operation?: string;
  authorization: "ALLOW" | "DENY";
  result: string;
  reason?: string;
  correlation: Correlation;
  // The company the call worked in. None when the call was refused before
  // DSoR had checked one (step 10's README, decision 6).
  tenant?: string;
  // Fields this tutorial adds, under a name of its own (DSOR-SCH-02): the company a
  // non-member asked for (step 10's README, decision 6), or the label of what a read
  // returned (step 14's README, decision 7).
  // And the mode and time of what a read returned (step 15's README, decision
  // 7).
  extensions?: {
    [namespace: string]: {
      requested_tenant?: string;
      classification?: Label;
      freshness?: { mode: FreshnessMode; observed_at: string };
      // NEW IN STEP 20: a keyed command's key, and, for a replay, the request id of the first
      // call (step 20's README, decision 8).
      idempotency?: { key: string; replay_of?: string };
    };
  };
  // What a read returned, in the audit record's own fields (DSOR-CLS-05).
  resources?: string[];
  row_count?: number;
  // Which connector served the read, in the audit record's own field.
  connector?: string;
  // An agent's call names the slip it ran under, and the person who signed
  // it, in the audit record's own fields (step 18's README, decision 8).
  delegation?: string;
  identity?: {
    mode: "unattended";
    subject: string;
    actor_chain: string[];
    // Where DSoR learned what the subject holds, and as of when (step 19's
    // README, decision 7).
    subject_authority: { source: "role_source"; as_of: string };
  };
};

// And where DSoR learned what the signer holds, and as of when: her
// company's directory, at the time of the answer DSoR used (step 19's README, decision 7).
/** Whose authority an agent's call ran under: its slip, the person who signed it, the agent, and the source and time of her authority. */
export type Authority = {
  delegation: string;
  subject: string;
  actor: string;
  source: "role_source";
  as_of: string;
};

// The log's second kind of record. When a company's directory reports the
// person who signed a slip as gone, DSoR suspends the slip and records the change. Nothing was
// allowed or denied, so the record has no authorization (step 19b's README, decisions 5 and
// 10).
/** Why DSoR suspends a person's slips: the directory's word, the time of its answer, and the call that heard it. */
export type SuspendReason = { word: string; as_of: string; correlation: Correlation };

/** The record of one slip that DSoR suspended. */
export type DelegationChange = {
  kind: "delegation_change";
  result: "suspended";
  // The directory's word: suspended, deprovisioned, or not listed. For the people who read
  // the log, never for the agent.
  reason: string;
  // The call that heard it: its whole correlation, as the call's own record has it
  // (DSOR-COR-01a; step 19b's README, decision 14).
  correlation: Correlation;
  tenant: string;
  delegation: string;
  // DSoR itself made the change, on the word of the company's directory.
  identity: {
    mode: "direct";
    subject: "dsor";
    actor_chain: [];
    subject_authority: { source: "role_source"; as_of: string };
  };
};

// One record for each slip suspended. Both slip stores build it here, so the
// record in memory and the row in dsor.audit have one shape (step 19b's README, decision 5).
/** The record of one slip that DSoR suspended. */
export function changeOf(tenant: string, delegation: string, why: SuspendReason): DelegationChange {
  return {
    kind: "delegation_change",
    result: "suspended",
    reason: why.word,
    // A copy, so a record cannot change with the call's correlation afterwards.
    correlation: { ...why.correlation },
    tenant,
    delegation,
    identity: {
      mode: "direct",
      subject: "dsor",
      actor_chain: [],
      subject_authority: { source: "role_source", as_of: why.as_of },
    },
  };
}

// What a query's answer returned, for its record (step 14's README,
// decision 7).
/** The URIs a read returned, the label of its answer, and how fresh it was. */
// And its freshness (step 15's README, decision 7). A command's answer has
// no freshness, so its record names its rows and its label only (step 17's README,
// decision 2).
export type Read = { resources: string[]; classification: Label; freshness?: Freshness };

// The reverse domain name this tutorial's own record fields sit under (DSOR-SCH-02).
const OURS = "org.panaversity.steps";

/** One record in the log: a decision, with its id, its place in the log, and its time. */
export type DecisionRecord = Decision & { record_id: string; sequence: number; at: string };

// add is async, so a log in memory and a log in a database have the same shape. add
// finishes only once the record is kept (step 09's README, decision 9).
// What every log shares is add, the one function call uses. How a log is
// read depends on where it is kept: the database log reads one company at a time (step
// 11's README, decision 6).
/** What call needs of a log: add a decision. */
export type DecisionLog = { add: (decision: Decision) => Promise<void> };

/** The log in memory, for the unit tests: add a decision, and read a copy of every record. */
export type MemoryLog = DecisionLog & { records: () => Promise<DecisionRecord[]> };

/** A new, empty log, held in memory. */
export function createLog(): MemoryLog {
  // Only the two functions below can reach this list, so nothing else can change or
  // remove a record (step 08's README, decision 6).
  const kept: DecisionRecord[] = [];
  // Frozen, so nobody who holds the log can replace add with a function that writes
  // nothing. Found by step 08's review.
  return Object.freeze({
    add: async (decision: Decision): Promise<void> => {
      // A copy, so a caller that changes its decision, or the answer that shares its
      // correlation, cannot change the record afterwards.
      const record_id = `aud_${randomUUID()}`;
      const at = new Date().toISOString();
      kept.push({ record_id, sequence: kept.length + 1, at, ...structuredClone(decision) });
    },
    // A copy too, so a reader cannot change what it read.
    records: async (): Promise<DecisionRecord[]> => structuredClone(kept),
  });
}

// What the record says about an answer (step 08's README, decision 5).
/** What the record says about an answer. */
export function decisionOf(
  answer: Answer,
  contract: Contract | undefined,
  reachedCode: boolean,
  // The active tenant, once line ② has checked it.
  tenant: string | undefined,
  // The well-formed company the caller named, checked or not.
  claimed: string | undefined,
  // What the answer returned, when it returned data.
  read?: Read,
  // The slip an agent's call ran under, once line ③ found it.
  under?: Authority,
  // NEW IN STEP 20: the key line ⑦ claimed, and, for a replay, the first call's request id.
  idempotency?: { key: string; replay_of?: string },
): Decision {
  const refused = "code" in answer;
  // This tutorial's own fields, gathered in one place, so a command's record can name both
  // its label and its key (DSOR-SCH-02).
  // NEW IN STEP 20: gathered here, where each part used to set the whole extensions field.
  const ours = {
    // A claim is kept only when no company was checked: line ② refused the one named.
    ...(tenant === undefined && claimed !== undefined ? { requested_tenant: claimed } : {}),
    // The answer's label and freshness, beside its rows below. The connector has a field of
    // its own in the audit record, and the mode and time do not (step 15's README, decision 7).
    ...(read === undefined
      ? {}
      : {
          classification: read.classification,
          ...(read.freshness === undefined
            ? {}
            : {
                freshness: { mode: read.freshness.mode, observed_at: read.freshness.observed_at },
              }),
        }),
    // The key, never the fingerprint or the answer: those stay in the claim (step 20's README,
    // decision 8).
    ...(idempotency === undefined ? {} : { idempotency: { ...idempotency } }),
  };
  return {
    kind: "decision",
    // A name with no contract has no version, so the record names no operation. The
    // refusal's message, in reason, says what was asked for.
    ...(contract === undefined
      ? {}
      : { operation: `${contract.id}@${String(contract["version"])}` }),
    authorization: reachedCode ? "ALLOW" : "DENY",
    // What the caller heard: "ok", or the code, and its message as the reason.
    result: refused ? answer.code : "ok",
    ...(refused ? { reason: answer.message } : {}),
    correlation: answer.correlation,
    ...(tenant === undefined ? {} : { tenant }),
    // An agent's call names the slip it ran under, and the person who signed
    // it, in the audit record's own fields. A person's record, and a refusal before line ③
    // found a slip, name neither (step 18's README, decision 8).
    ...(under === undefined
      ? {}
      : {
          delegation: under.delegation,
          identity: {
            mode: "unattended",
            subject: under.subject,
            actor_chain: [under.actor],
            // Her company's directory, and the time of the answer DSoR used
            // (DSOR-DEL-10; step 19's README, decision 7).
            subject_authority: { source: under.source, as_of: under.as_of },
          },
        }),
    // Who, what, and how many (DSOR-CLS-05). URIs, a count, and a label,
    // never a value read (DSOR-AUD-05a). A read returns data only after line ②, so a
    // claimed company is never beside it.
    ...(read === undefined
      ? {}
      : {
          resources: read.resources,
          row_count: read.resources.length,
          // The answer's freshness: its connector, in the record's own field.
          ...(read.freshness === undefined ? {} : { connector: read.freshness.connector }),
        }),
    ...(Object.keys(ours).length === 0 ? {} : { extensions: { [OURS]: ours } }),
  };
}
