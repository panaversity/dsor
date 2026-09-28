// The request envelope travels beside a call's arguments, never inside
// them. It carries the login token that says who is calling, and an optional request id
// that labels the call. DSOR-SRC-02a in specs/dsor/02-security.md, section 11, and
// DSOR-COR-01b in specs/dsor/03-execution.md, section 32.
import { Refusal } from "./envelope.ts";

/**
 * What travels beside the arguments: who is calling, and which call this is. It comes
 * from outside the program, so its fields have no types yet.
 */
export type RequestEnvelope = { token?: unknown; request_id?: unknown };

/** The request id the caller sent, when DSoR can use it (step 05's README, decision 6). */
export function usableRequestId(request: RequestEnvelope): string | undefined {
  // The envelope comes from outside the program, so it may even be null.
  const sent = request?.request_id;
  // Text of 1 to 128 characters. JavaScript's length counts an emoji as two.
  if (typeof sent !== "string" || sent.length < 1 || sent.length > 128) return undefined;
  // NEW IN STEP 09: text Postgres can keep. jsonb refuses the NUL character and half of an
  // emoji, so such an id made the record fail and left no evidence of the call. Found by
  // step 09's review (step 09's README, decision 16).
  return sent.isWellFormed() && !CONTROL.test(sent) ? sent : undefined;
}

// Control characters: NUL, a new line, a tab, and the rest of Unicode's "Cc" group.
// not copied: the specification sets no pattern for a request id; this is the tutorial's
// own rule (step 09's README, decision 16).
const CONTROL = /\p{Cc}/u;

/** Refuses a request id that DSoR cannot use. A call that sends none is fine. */
export function checkRequestId(request: RequestEnvelope): void {
  if (request?.request_id !== undefined && usableRequestId(request) === undefined) {
    const rule = "text of 1 to 128 characters, well-formed, with no control characters";
    throw new Refusal("VALIDATION_FAILED", `a request_id must be ${rule}`);
  }
}
