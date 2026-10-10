// STEP 18: what a person holds right now, asked at every decision (decision 127).
//
// An agent's power under a slip is never more than its signer's, at the moment of the decision. So
// DSoR asks where a person's permissions come from every time, and copies them nowhere: not into the
// slip, not into a cache. Ask at 09:00 and at 09:01, and a permission taken away in between is gone.
//
// NEW IN STEP 19: asked of the company's directory, which can be out of date, or down, or missing
// (decision 129). DSoR does not guess then. It does not use the last answer it saw, which is exactly
// the months-old answer the rule exists for, and it does not fall back to a list of its own. It says
// the authority could not be established, and the command is refused.
//
// Rule DSOR-IDN-05: each tenant MUST configure a role source from which DSoR can read the current
// roles of a principal who is not present in the request.
// Rule DSOR-IDN-06: when the delegator's current authority cannot be established within the
// staleness bound, DSoR MUST deny the command.

import { directoryOf } from "./directory.ts";

/** §44's staleness bound for the delegator's authority at L2: an answer older than this is none. */
export const STALENESS_BOUND_MS: number = 24 * 60 * 60 * 1000;

/** What a person holds in one company, and when the directory knew it. */
export interface Authority {
  readonly permissions: readonly string[];
  /** An exact ISO time, which the decision record keeps as `subject_authority.as_of`. */
  readonly asOf: string;
}

/** A person's authority could not be established: the case `DSOR-IDN-06` refuses. */
export class AuthorityNotEstablished extends Error {}

/**
 * What one person holds in one company at this moment, by that company's directory.
 *
 * Throws `AuthorityNotEstablished` for a company with no directory (DSOR-IDN-05), a directory that
 * does not answer, an answer that is not a list of permissions and a time, and an answer older than
 * the staleness bound (DSOR-IDN-06). Never the last answer seen.
 */
export function authorityNow(person: string, tenant: string): Authority {
  const directory = directoryOf(tenant);

  if (directory === null) {
    throw new AuthorityNotEstablished(`${tenant} has no directory to ask`);
  }

  let answer: unknown;

  try {
    answer = directory.lookup(person);
  } catch {
    throw new AuthorityNotEstablished(`${tenant}'s directory did not answer`);
  }

  const { permissions, asOf } = (answer ?? {}) as Partial<Authority>;

  if (
    !Array.isArray(permissions) ||
    !permissions.every((p) => typeof p === "string") ||
    typeof asOf !== "string"
  ) {
    throw new AuthorityNotEstablished(`${tenant}'s directory gave an answer that says nothing`);
  }

  // "Is the answer at most 24 hours old?", asked so that every answer but yes refuses: a time the
  // program cannot read is NaN, and `NaN <= bound` is false, which decision 128 learned the hard way.
  if (!(Date.now() - Date.parse(asOf) <= STALENESS_BOUND_MS)) {
    throw new AuthorityNotEstablished(
      `${tenant}'s directory last knew what ${person} holds at ${asOf}, more than 24 hours ago`,
    );
  }

  // Written down in the one spelling the record's schema reads, whatever spelling the directory used.
  return Object.freeze({
    permissions: Object.freeze([...permissions]),
    asOf: new Date(Date.parse(asOf)).toISOString(),
  });
}
