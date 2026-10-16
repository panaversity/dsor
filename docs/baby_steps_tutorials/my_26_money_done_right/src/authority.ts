// STEP 18: what a person holds right now, asked at every decision (decision 127).
//
// An agent's power under a slip is never more than its signer's, at the moment of the decision. So
// DSoR asks where a person's permissions come from every time, and copies them nowhere: not into the
// slip, not into a cache. Ask at 09:00 and at 09:01, and a permission taken away in between is gone.
//
// STEP 19: asked of the company's directory, which can be out of date, or down, or missing
// (decision 129). DSoR does not guess then. It does not use the last answer it saw, which is exactly
// the months-old answer the rule exists for, and it does not fall back to a list of its own. It says
// the authority could not be established, and the command is refused.
//
// Rule DSOR-IDN-05: each tenant MUST configure a role source from which DSoR can read the current
// roles of a principal who is not present in the request.
// Rule DSOR-IDN-06: when the delegator's current authority cannot be established within the
// staleness bound, DSoR MUST deny the command.

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import { directoryOf } from "./directory.ts";

/** §44's staleness bound for the delegator's authority at L2: an answer older than this is none. */
export const STALENESS_BOUND_MS: number = 24 * 60 * 60 * 1000;

/** What a person holds in one company, and when the directory knew it. */
export interface Authority {
  readonly permissions: readonly string[];
  /** An exact ISO time, which the decision record keeps as `subject_authority.as_of`. */
  readonly asOf: string;
}

/**
 * How far ahead of this program's clock a directory's clock may be, and its answer still count
 * (decision 130). Two clocks never agree to the millisecond; a year ahead is not a clock difference.
 */
export const CLOCK_SKEW_MS: number = 5 * 60 * 1000;

/**
 * A time as RFC 3339 writes one, with its zone: `Z`, or an offset. Without a zone, JavaScript reads
 * a time in this host's zone, which is not the directory's (decision 130).
 */
// not copied: the specification's timestamp is the JSON Schema format date-time, which has no pattern
// to copy; this one asks for the zone that format requires.
// NEW IN STEP 26: exported, so that the rate service's time is asked the same (decision 159).
export const WITH_ITS_ZONE: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

// ajv-formats is CommonJS; under nodenext the callable sits on `.default`. Same cast, same reason,
// as in audit.ts.
const addFormats = (addFormatsModule as unknown as { default: FormatsPlugin }).default;
const ajv = new Ajv2020();

addFormats(ajv);

/**
 * The test the record itself puts a time to: the audit schema's `date-time` format, from RFC 3339.
 * Beside the zone, it asks that the day exist. JavaScript does not: it reads 31 September as
 * 1 October, a day the directory never said (decision 150).
 */
// NEW IN STEP 26: exported, for the rate service's time too (decision 159).
export const isARecordTime: ValidateFunction<string> = ajv.compile<string>({
  type: "string",
  format: "date-time",
});

/**
 * A person's authority could not be established: the case `DSOR-IDN-06` refuses.
 *
 * `stale` and `unusable` are answers DSoR has and cannot use, which waiting for a fresh one fixes;
 * `no_answer` and `no_directory` are no answer at all (decision 130). `asOf` is the directory's own
 * time, when it gave a usable one, so the record can say it.
 */
export class AuthorityNotEstablished extends Error {
  readonly why: "no_directory" | "no_answer" | "unusable" | "stale";
  readonly asOf: string | undefined;

  constructor(
    why: "no_directory" | "no_answer" | "unusable" | "stale",
    message: string,
    asOf?: string,
  ) {
    super(message);
    this.why = why;
    this.asOf = asOf;
  }
}

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
    throw new AuthorityNotEstablished("no_directory", `${tenant} has no directory to ask`);
  }

  let answer: unknown;

  try {
    answer = directory.lookup(person);
  } catch {
    throw new AuthorityNotEstablished("no_answer", `${tenant}'s directory did not answer`);
  }

  const saysNothing = new AuthorityNotEstablished(
    "unusable",
    `${tenant}'s directory gave an answer about ${person} that says nothing this program can use`,
  );

  // Copied first, then checked: what is checked is what is used. It was checked and then copied, and
  // a list that answered differently the second time was checked as one list and used as another
  // (decision 130). And each field is read once: `permissions` was still read twice, once to ask
  // whether it was a list and once to copy it, and a list the first time and text the second was
  // taken as a list of single letters (decision 150).
  let permissions: unknown;
  let asOf: unknown;

  try {
    const given = (answer ?? {}) as { readonly permissions?: unknown; readonly asOf?: unknown };
    const listed = given.permissions;

    permissions = Array.isArray(listed) ? [...listed] : listed;
    asOf = given.asOf;
  } catch {
    throw saysNothing;
  }

  if (
    !Array.isArray(permissions) ||
    !permissions.every((p) => typeof p === "string") ||
    typeof asOf !== "string" ||
    !WITH_ITS_ZONE.test(asOf) ||
    !isARecordTime(asOf) ||
    Number.isNaN(Date.parse(asOf))
  ) {
    throw saysNothing;
  }

  const knewAt = Date.parse(asOf);
  const age = Date.now() - knewAt;
  // The same moment, in the one spelling the record's schema reads: in UTC.
  const written = new Date(knewAt).toISOString();

  // And only a moment the record can hold. An offset ahead of UTC moves the first hour of the year
  // 0000 into the year before it, which JavaScript writes "-000001-12-31T23:00:00.000Z". The record
  // refused that time, so a healthy store answered EVIDENCE_STORE_UNAVAILABLE, and the refusal was
  // written nowhere (decision 150).
  if (!isARecordTime(written)) {
    throw saysNothing;
  }

  // At most 24 hours old, and not from the future beyond the clocks' difference. An answer dated a
  // year ahead counted as fresh, and would have until its date was a day past (decision 130).
  if (age > STALENESS_BOUND_MS) {
    throw new AuthorityNotEstablished(
      "stale",
      `${tenant}'s directory's answer about ${person} is more than 24 hours old`,
      written,
    );
  }

  if (age < -CLOCK_SKEW_MS) {
    throw saysNothing;
  }

  return Object.freeze({ permissions: Object.freeze(permissions as string[]), asOf: written });
}
