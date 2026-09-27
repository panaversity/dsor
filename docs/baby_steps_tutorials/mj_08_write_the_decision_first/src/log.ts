// The log of decisions: one record for every answer call gives, written before the
// answer leaves. DSOR-EXE-02 in specs/dsor/03-execution.md, section 21.
import type { Correlation } from "./envelope.ts";

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

/** The log has two doors: add a decision, and read a copy of every record. */
export type DecisionLog = {
  add: (decision: Decision) => void;
  records: () => DecisionRecord[];
};

/** A new, empty log, held in memory. */
export function createLog(): DecisionLog {
  const notYet = (): never => {
    throw new Error("the decision log is not built yet");
  };
  return { add: notYet, records: notYet };
}
