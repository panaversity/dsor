// The request envelope travels beside a call's arguments, never inside
// them. It carries the login token that says who is calling, and an optional request id
// that labels the call. DSOR-SRC-02a in specs/dsor/02-security.md, section 11, and
// DSOR-COR-01b in specs/dsor/03-execution.md, section 32.
import { Refusal } from "./envelope.ts";

/**
 * What travels beside the arguments: who is calling, in which company, and which call
 * this is. It comes from outside the program, so its fields have no types yet.
 */
// The company the call works in (step 10's README, decision 1).
export type RequestEnvelope = { token?: unknown; tenant?: unknown; request_id?: unknown };

/** The request id the caller sent, when DSoR can use it (step 05's README, decision 6). */
export function usableRequestId(request: RequestEnvelope): string | undefined {
  // The envelope comes from outside the program, so it may even be null.
  const sent = request?.request_id;
  // Text of 1 to 128 characters. JavaScript's length counts an emoji as two.
  if (typeof sent !== "string" || sent.length < 1 || sent.length > 128) return undefined;
  // Text Postgres can keep. jsonb refuses the NUL character and half of an
  // emoji, so such an id made the record fail and left no evidence of the call. Found by
  // step 09's review (step 09's README, decision 16).
  return sent.isWellFormed() && !CONTROL.test(sent) ? sent : undefined;
}

// Control characters: NUL, a new line, a tab, and the rest of Unicode's "Cc" group.
// not copied: the specification sets no pattern for a request id; this is the tutorial's
// own rule (step 09's README, decision 16).
const CONTROL = /\p{Cc}/u;

// The envelope is closed. The list says what is allowed, so no other
// spelling of a company, or of anything else, can ride along unread (step 10's README,
// decision 11).
const ENVELOPE_FIELDS = ["token", "tenant", "request_id"];

/** Refuses an envelope that carries any field besides token, tenant, and request_id. */
export function checkEnvelopeFields(request: RequestEnvelope): void {
  // The envelope comes from outside the program, so it may not even be an object.
  if (typeof request !== "object" || request === null) return;
  const extra = Object.keys(request).find((field) => !ENVELOPE_FIELDS.includes(field));
  if (extra !== undefined) {
    // The name is the caller's text, so only a short piece of it is shown.
    const allowed = "the request envelope may carry only token, tenant, and request_id";
    throw new Refusal("VALIDATION_FAILED", `${allowed}, not ${JSON.stringify(extra.slice(0, 60))}`);
  }
}

/** Refuses a request id that DSoR cannot use. A call that sends none is fine. */
export function checkRequestId(request: RequestEnvelope): void {
  if (request?.request_id !== undefined && usableRequestId(request) === undefined) {
    const rule = "text of 1 to 128 characters, well-formed, with no control characters";
    throw new Refusal("VALIDATION_FAILED", `a request_id must be ${rule}`);
  }
}
