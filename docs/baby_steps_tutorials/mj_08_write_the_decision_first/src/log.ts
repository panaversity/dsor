// NEW IN STEP 08: the log of decisions, one record for every answer call gives, written
// before the answer leaves. DSOR-EXE-02 in specs/dsor/03-execution.md, section 21.
// It lives in memory, so it is lost when the program stops. Step 09 moves it into a database.
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
};

/** One record in the log: a decision, with its id, its place in the log, and its time. */
export type DecisionRecord = Decision & { record_id: string; sequence: number; at: string };

/** The log has two functions: add a decision, and read a copy of every record. */
export type DecisionLog = {
  add: (decision: Decision) => void;
  records: () => DecisionRecord[];
};

/** A new, empty log, held in memory. */
export function createLog(): DecisionLog {
  // Only the two functions below can reach this list, so nothing else can change or
  // remove a record (step 08's README, decision 6).
  const kept: DecisionRecord[] = [];
  // Frozen, so nobody who holds the log can replace add with a function that writes
  // nothing. Found by step 08's review.
  return Object.freeze({
    add: (decision: Decision): void => {
      // A copy, so a caller that changes its decision, or the answer that shares its
      // correlation, cannot change the record afterwards.
      const record_id = `aud_${randomUUID()}`;
      const at = new Date().toISOString();
      kept.push({ record_id, sequence: kept.length + 1, at, ...structuredClone(decision) });
    },
    // A copy too, so a reader cannot change what it read.
    records: (): DecisionRecord[] => structuredClone(kept),
  });
}

// NEW IN STEP 08: what the record says about an answer (step 08's README, decision 5).
/** What the record says about an answer. */
export function decisionOf(
  answer: Answer,
  contract: Contract | undefined,
  reachedCode: boolean,
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
  };
}
