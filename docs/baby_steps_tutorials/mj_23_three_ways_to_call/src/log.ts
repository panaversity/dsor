// The log of decisions, one record for every answer call gives, written before the answer
// leaves. DSOR-EXE-02 in specs/dsor/03-execution.md, section 21.
// This file holds the log in memory, for the unit tests. The log the program uses is a
// table in the database: createDbLog in postgres.ts.
import { randomUUID } from "node:crypto";
import type { Freshness, FreshnessMode } from "./freshness.ts";
import type { Label } from "./labels.ts";
import type { Answer, Correlation } from "./envelope.ts";
import type { Contract } from "./registry.ts";
import type { Mode } from "./request.ts";

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
      // A keyed command's key, and, for a replay, the request id of the first
      // call (step 20's README, decision 8).
      idempotency?: { key: string; replay_of?: string };
      // The command's proposal, so the decision and the records of its moves
      // can be found together (step 22's README, decision 5).
      proposal?: string;
      // NEW IN STEP 23: the mode a command was called in. The audit record has no field for it
      // (DSOR-SCH-02; step 23's README, decision 10).
      invocation_mode?: Mode;
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

// The log's third kind of record. Each move of a proposal leaves one, in the same
// transaction as the move, so a move and its record are both kept or neither is (DSOR-APR-01b).
// The log is the place DSOR-AUD-01 names (step 22's README, decision 4). A move allows and
// denies nothing, so the record has no authorization, as a change to a slip has none.
/** Who made one move of a proposal, in the audit record's own shape. */
export type Mover = {
  mode: "direct" | "unattended";
  subject: string;
  actor_chain: string[];
  subject_authority: { source: "token" | "role_source"; as_of: string };
};

/** The record of one move of a proposal. */
export type ProposalTransition = {
  kind: "proposal_transition";
  // The proposal's operation and its contract's version, such as payment.create@1.
  operation: string;
  // The state the proposal moved to.
  result: string;
  // Why it moved: the move's cause.
  reason: string;
  // The call that moved it: its whole correlation, as the call's own record has it.
  correlation: Correlation;
  tenant: string;
  // Who moved it: the caller for the first move, DSoR itself for the others.
  identity: Mover;
  // The proposal, by its URI, in the audit record's own field for what a record is about.
  resources: [string];
  // The state the proposal left, under this tutorial's own name: the audit record has no field
  // for it (DSOR-SCH-02). The first record, which makes the proposal, left no state.
  extensions?: { [namespace: string]: { from: string } };
};

/** The record of one move of a proposal. Both proposal stores build it here, so the record in memory and the row in dsor.audit have one shape. */
export function transitionOf(
  tenant: string,
  uri: string,
  operation: string,
  from: string | undefined,
  to: string,
  mover: Mover,
  cause: string,
  correlation: Correlation,
): ProposalTransition {
  return {
    kind: "proposal_transition",
    operation,
    result: to,
    reason: cause,
    // Copies, so a record cannot change with the call's correlation or its mover afterwards.
    correlation: { ...correlation },
    tenant,
    identity: structuredClone(mover),
    resources: [uri],
    ...(from === undefined ? {} : { extensions: { [OURS]: { from } } }),
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
  // NEW IN STEP 23: called reachedCode until step 22. True once DSoR's checks allowed the call.
  allowed: boolean,
  // The active tenant, once line ② has checked it.
  tenant: string | undefined,
  // The well-formed company the caller named, checked or not.
  claimed: string | undefined,
  // What the answer returned, when it returned data.
  read?: Read,
  // The slip an agent's call ran under, once line ③ found it.
  under?: Authority,
  // The key line ⑦ claimed, and, for a replay, the first call's request id.
  idempotency?: { key: string; replay_of?: string },
  // The command's proposal, once line ⑧ made it or a replay gave it back.
  proposal?: string,
  // NEW IN STEP 23: the mode line ① read. Only a command's record names it: a query has none.
  mode?: Mode,
): Decision {
  const refused = "code" in answer;
  // This tutorial's own fields, gathered in one place, so a command's record can name both
  // its label and its key (DSOR-SCH-02).
  // Gathered here, where each part used to set the whole extensions field.
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
    ...(proposal === undefined ? {} : { proposal }),
    ...(mode !== undefined && contract?.["kind"] === "command" ? { invocation_mode: mode } : {}),
  };
  return {
    kind: "decision",
    // A name with no contract has no version, so the record names no operation. The
    // refusal's message, in reason, says what was asked for.
    ...(contract === undefined
      ? {}
      : { operation: `${contract.id}@${String(contract["version"])}` }),
    authorization: allowed ? "ALLOW" : "DENY",
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
