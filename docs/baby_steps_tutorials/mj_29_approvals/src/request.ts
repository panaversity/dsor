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
// And the command's idempotency key, which its caller chose (step 20's README,
// decision 1).
// And the way the command is called, its mode (step 23's README, decision 4).
export type RequestEnvelope = {
  token?: unknown;
  tenant?: unknown;
  request_id?: unknown;
  idempotency_key?: unknown;
  mode?: unknown;
};

// The three ways to call a command (§7.3). execute does it, propose_only prepares
// a proposal that waits for a release, and validate_only is a dry run that changes nothing.
/** One of the three invocation modes of §7.3. */
export type Mode = "execute" | "propose_only" | "validate_only";
const MODES: readonly string[] = ["execute", "propose_only", "validate_only"];

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
// And idempotency_key (step 20's README, decision 1).
// And mode.
const ENVELOPE_FIELDS = ["token", "tenant", "request_id", "idempotency_key", "mode"];

/** Refuses an envelope that carries any field besides token, tenant, request_id, idempotency_key, and mode. */
export function checkEnvelopeFields(request: RequestEnvelope): void {
  // The envelope comes from outside the program, so it may not even be an object.
  if (typeof request !== "object" || request === null) return;
  const extra = Object.keys(request).find((field) => !ENVELOPE_FIELDS.includes(field));
  if (extra !== undefined) {
    // The name is the caller's text, so only a short piece of it is shown.
    const allowed =
      "the request envelope may carry only token, tenant, request_id, idempotency_key, and mode";
    throw new Refusal("VALIDATION_FAILED", `${allowed}, not ${JSON.stringify(extra.slice(0, 60))}`);
  }
}

// An idempotency key is text of 1 to 128 characters: ASCII letters, digits, and
// the four marks . _ : -. Enough for a UUID, a ULID, or "pay-INV-1008-a". No flag: with i or u,
// a sign such as the Kelvin sign would pass as a letter, and with m, a key could end in a new
// line.
// not copied: the specification sets no pattern for an idempotency key; this is the tutorial's
// own rule (step 20's README, decision 2).
const KEY = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The idempotency key the envelope carries, read once. None is fine here: line ⑦ decides
 * whether the operation needs one. A key that is not well formed is refused.
 */
export function checkedKey(request: RequestEnvelope): string | undefined {
  // The envelope comes from outside the program, so it may even be null.
  const sent = request?.idempotency_key;
  if (sent === undefined) return undefined;
  if (typeof sent !== "string" || !KEY.test(sent)) {
    const rule = "1 to 128 characters: letters, digits, and . _ : -";
    throw new Refusal("VALIDATION_FAILED", `an idempotency_key must be ${rule}`);
  }
  return sent;
}

/**
 * The mode the envelope names, read once, or none: then the operation decides, and a command runs
 * in execute mode. A mode that is not one of the three is refused, and so is a dry run that
 * carries an idempotency key, which line ① read just before.
 */
// A dry run claims nothing, so a key on it would promise a replay that never
// comes, as a key on a query would (step 23's README, decisions 4 and 6).
export function checkedMode(request: RequestEnvelope, key: string | undefined): Mode | undefined {
  // The envelope comes from outside the program, so it may even be null.
  const sent = request?.mode;
  if (sent === undefined) return undefined;
  if (typeof sent !== "string" || !MODES.includes(sent)) {
    throw new Refusal(
      "VALIDATION_FAILED",
      "a mode must be execute, propose_only, or validate_only",
    );
  }
  if (sent === "validate_only" && key !== undefined) {
    const why = "a validate_only call takes no idempotency_key: a dry run claims nothing";
    throw new Refusal("VALIDATION_FAILED", why);
  }
  return sent as Mode;
}

/** Refuses a request id that DSoR cannot use. A call that sends none is fine. */
export function checkRequestId(request: RequestEnvelope): void {
  if (request?.request_id !== undefined && usableRequestId(request) === undefined) {
    const rule = "text of 1 to 128 characters, well-formed, with no control characters";
    throw new Refusal("VALIDATION_FAILED", `a request_id must be ${rule}`);
  }
}
