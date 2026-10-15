// The login: who is asking, and the rule that who you are never comes from the arguments.
//
//   Who you are comes from the login. Never from the arguments.
//
// The login arrives beside the request, not inside it. That separation is the whole
// lesson: arguments are data, and data can describe things but can never say who you are.
// Write `principal: "cfo_100"` into the arguments and nothing reads it.
//
// Rule DSOR-SRC-02a: DSoR MUST derive the security context only from the authenticated
// request envelope and its own control-plane store.
// Rule DSOR-IDN-01: every caller is normalized into a principal before any other
// processing.

import { refusal, type ErrorEnvelope } from "./envelopes.ts";
import { findPerson, type Principal } from "./people.ts";
import type { TenantClaim } from "./tenant.ts";

/**
 * The object's **own** `key`, when it is a string. `undefined` for everything else.
 *
 * Everything a caller sends is read through here, because every one of these is a real thing a
 * caller can send and none of them may throw:
 *
 * - `null`, a number, a string — `Login` is a TypeScript type and types are erased before Node
 *   runs, so what actually arrives is whatever the caller sent.
 * - a name the object only **inherits**, which is a name nobody in this program chose.
 * - a property that is a *getter* and throws when it is read. A hostile review found that one:
 *   `{ get loggedInAs() { throw new Error("boom") } }` used to come out of here as an exception
 *   rather than a refusal, and a stack trace is not an envelope a caller can act on.
 * - a `Proxy` whose traps throw. STEP 09, and it is the getter hole one layer further out:
 *   `Object.hasOwn` is not a passive question, it consults the object's own
 *   `getOwnPropertyDescriptor` trap, so it used to throw *before* the `try` below was reached.
 *   Measured: `callOperation THREW: boom`, and zero audit records written. A raw Error and an
 *   empty log, from one object a caller chose to send.
 *
 * Which is why every line that touches `from` is inside the `try` now, and why the early return
 * tests only `null` and `typeof`, the two questions an object cannot lie about or throw from.
 */
function ownString(from: unknown, key: string): string | undefined {
  if (from === null || typeof from !== "object") {
    return undefined;
  }

  try {
    if (!Object.hasOwn(from, key)) {
      return undefined;
    }

    const value = (from as Record<string, unknown>)[key];

    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A pretend login.
 *
 * One field, on purpose. There is nowhere to say "I am logged in as this person and also
 * acting as that agent". An agent acting *for* a person is a real thing in DSoR and needs a
 * permission slip — a delegation — which arrives in step 18.
 *
 * This does **not** meet DSOR-IDN-02a, and an earlier version of this comment claimed it
 * did. That rule says an agent must authenticate with its own credentials, never a human's
 * session. Nothing here authenticates, so `accounts-payable-fte` can simply send
 * `{ loggedInAs: "cfo_100" }` and be recorded as the CFO. One field stops a caller
 * *declaring* two identities; the rule is about one *borrowing* an identity that is not
 * theirs. Step 44, where an agent gets its own OAuth client and its own key.
 *
 * Nothing here is authentication. A real login proves who you are; this only says who you
 * claim to be, and the claim is believed. Step 43 makes it real for people and step 44 for
 * agents. What this step does hold
 * is the other half of DSOR-SRC-02a: whatever the arguments say is ignored.
 */
export interface Login {
  readonly loggedInAs: string;
  /**
   * STEP 10: which company this request is for, when the caller belongs to more than one.
   *
   * Part of the login, not of the arguments, for the same reason `loggedInAs` is: where you belong
   * is who you are. A caller with one company leaves it out. A caller with two must say, and must
   * say one of theirs — `tenantFor` in tenant.ts decides.
   */
  readonly tenant?: string;
}

/**
 * STEP 10: what the login says about which company it means.
 *
 * Read through `ownString`, like `loggedInAs`, so a getter that throws, an inherited name, and a
 * value that is not text are all handled — and a value that is present and not text is reported as
 * `malformed`, never as absent. An empty string is malformed too: it is not a company id.
 */
export function tenantClaimed(login: Login | undefined): TenantClaim {
  if (login === null || typeof login !== "object") {
    return { kind: "unnamed" };
  }

  let present: boolean;

  try {
    present = Object.hasOwn(login, "tenant");
  } catch {
    return { kind: "malformed" };
  }

  if (!present) {
    return { kind: "unnamed" };
  }

  const tenant = ownString(login, "tenant");

  return tenant === undefined || tenant === "" ? { kind: "malformed" } : { kind: "named", tenant };
}

/**
 * Turns a login into a principal, or refuses.
 *
 * Both refusals are `AUTHENTICATION_REQUIRED` with retry `never`: asking again without
 * logging in, or with the same unknown name, cannot start working. Something has to
 * change first.
 */
export function principalFrom(
  login: Login | undefined,
  requestId: string,
): { readonly principal: Principal } | { readonly refused: ErrorEnvelope } {
  // A login arrives from outside this program, so it is checked as **data**. `Login` is a
  // TypeScript type, and types are erased before Node runs: at run time what arrives here
  // can be `null`, a string, or an object whose `loggedInAs` is a number. The whole job of
  // this function is to refuse, so it must refuse those too rather than throw — a thrown
  // error is not an envelope, and a caller cannot act on a stack trace.
  //
  // `Object.hasOwn` is the second half. A name the object merely *inherits* is a name
  // nobody in this program chose, and an empty object would otherwise arrive carrying one.
  const claimed = ownString(login, "loggedInAs");

  if (claimed === undefined) {
    return { refused: refusal("AUTHENTICATION_REQUIRED", "nobody is logged in", requestId) };
  }

  const principal = findPerson(claimed);

  // Deliberately the same refusal for "no login" and "no such person". Saying "that name
  // does not exist here" would tell a stranger which names do, which is the shape
  // DSOR-ERR-01b is about. That rule needs permissions to state properly, in step 06.
  if (principal === undefined) {
    return {
      refused: refusal(
        "AUTHENTICATION_REQUIRED",
        `${JSON.stringify(claimed)} is not someone this program knows`,
        requestId,
      ),
    };
  }

  return { principal };
}
