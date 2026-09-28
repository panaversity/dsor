// The login: who is asking.
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
): { readonly principal: Principal } | { readonly refused: ErrorEnvelope } {
  // A login arrives from outside this program, so it is checked as **data**. `Login` is a
  // TypeScript type, and types are erased before Node runs: at run time what arrives here
  // can be `null`, a string, or an object whose `loggedInAs` is a number. The whole job of
  // this function is to refuse, so it must refuse those too rather than throw — a thrown
  // error is not an envelope, and a caller cannot act on a stack trace.
  //
  // `Object.hasOwn` is the second half. A name the object merely *inherits* is a name
  // nobody in this program chose, and an empty object would otherwise arrive carrying one.
  if (typeof login?.loggedInAs !== "string" || !Object.hasOwn(login, "loggedInAs")) {
    return { refused: refusal("AUTHENTICATION_REQUIRED", "nobody is logged in") };
  }

  const principal = findPerson(login.loggedInAs);

  // Deliberately the same refusal for "no login" and "no such person". Saying "that name
  // does not exist here" would tell a stranger which names do, which is the shape
  // DSOR-ERR-01b is about. That rule needs permissions to state properly, in step 06.
  if (principal === undefined) {
    return {
      refused: refusal(
        "AUTHENTICATION_REQUIRED",
        `${JSON.stringify(login.loggedInAs)} is not someone this program knows`,
      ),
    };
  }

  return { principal };
}
