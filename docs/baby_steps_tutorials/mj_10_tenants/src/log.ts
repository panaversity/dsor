// The log of decisions, one record for every answer call gives, written before the answer
// leaves. DSOR-EXE-02 in specs/dsor/03-execution.md, section 21.
// This file holds the log in memory, for the unit tests. The log the program uses is a
// table in the database: createDbLog in postgres.ts.
import { randomUUID } from "node:crypto";
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
  // NEW IN STEP 10: the company the call worked in. None when the call was refused before
  // DSoR had checked one (step 10's README, decision 6).
  tenant?: string;
  // NEW IN STEP 10: fields this tutorial adds, under a name of its own (DSOR-SCH-02). Here
  // only the company a non-member asked for (step 10's README, decision 6).
  extensions?: { [namespace: string]: { requested_tenant: string } };
};

// The reverse domain name this tutorial's own record fields sit under (DSOR-SCH-02).
const OURS = "org.panaversity.steps";

/** One record in the log: a decision, with its id, its place in the log, and its time. */
export type DecisionRecord = Decision & { record_id: string; sequence: number; at: string };

// Both functions are async, so a log in memory and a log in a database
// have the same shape. add finishes only once the record is kept (step 09's README,
// decision 9).
/** The log has two functions: add a decision, and read a copy of every record. */
export type DecisionLog = {
  add: (decision: Decision) => Promise<void>;
  records: () => Promise<DecisionRecord[]>;
};

/** A new, empty log, held in memory. */
export function createLog(): DecisionLog {
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
  // NEW IN STEP 10: the active tenant, once line ② has checked it.
  tenant: string | undefined,
  // NEW IN STEP 10: the well-formed company the caller named, checked or not.
  claimed: string | undefined,
): Decision {
  const refused = "code" in answer;
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
    // A claim is kept only when no company was checked: line ② refused the one named.
    ...(tenant === undefined && claimed !== undefined
      ? { extensions: { [OURS]: { requested_tenant: claimed } } }
      : {}),
  };
}
