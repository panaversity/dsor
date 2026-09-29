// NEW IN STEP 08: the log, on its own.
//
// Nothing here calls an operation. These tests are about what an audit record is, and about the
// chain that makes one hard to change quietly — before anything writes one.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  audit,
  AUDIT_SCHEMA_CHECKED,
  countedWithoutARecord,
  forgetTheLog,
  now,
  resetClock,
  setClock,
  theLog,
  validateAuditRecord,
  verifyChain,
  type AuditRecord,
  type DecisionToRecord,
} from "../src/audit.ts";

/** The parts of a record a caller supplies. The time, the sequence and the hashes are not theirs. */
function decision(over: Partial<DecisionToRecord> = {}): DecisionToRecord {
  return {
    kind: "decision",
    subject: "user_123",
    operation: "invoice.get@1",
    authorization: "ALLOW",
    result: "data",
    requestId: "req_1",
    ...over,
  };
}

/**
 * Write a record and insist one was written.
 *
 * `audit` returns `AuditRecord | undefined`, and this helper is where that costs something. It has
 * to: a caller must not be able to assume a record exists, because whether one is written is
 * `audit`'s decision and not the caller's.
 */
function recorded(over: Partial<DecisionToRecord> = {}): AuditRecord {
  const written = audit(decision(over));

  if (written === undefined) {
    throw new Error("expected a record to be written, and none was");
  }

  return written;
}

/**
 * The specification's copy of the schema, when this folder is sitting inside the dsor repository.
 *
 * `undefined` when it is not, and that case is real: a step is a self-contained project, and the
 * tutorial's own instructions say to copy one somewhere else and run `pnpm check` there. The first
 * version of the test below read the path unconditionally and a step outside the repository failed
 * with ENOENT — a test that made the step depend on its surroundings.
 */
const specCopy = new URL("../../../../packages/spec/schemas/audit-record.schema.json", import.meta.url);
const insideTheRepository = existsSync(specCopy);

describe("the audit log", () => {
  it("DSOR-AUD-01: the schema compiled, so a record can be checked against it", () => {
    expect(AUDIT_SCHEMA_CHECKED).toBe(true);
  });

  // Skipped rather than quietly passed when the repository is not there, so the test report says
  // which of the two things happened. A check that silently does nothing is worse than no check.
  it.skipIf(!insideTheRepository)(
    "DSOR-AUD-01: the schema is byte for byte the specification's own",
    () => {
      // A record validated against a schema of our own making would prove nothing about
      // DSOR-AUD-01. This is the test that says the schema was not quietly edited to fit the code.
      const ours = readFileSync(new URL("../src/schemas/audit-record.schema.json", import.meta.url));

      expect(ours.equals(readFileSync(specCopy))).toBe(true);
    },
  );

  it("DSOR-AUD-01: a record validates against audit-record.schema.json", () => {
    forgetTheLog();
    setClock(() => "2026-09-30T07:41:00.000Z");

    const written = recorded();

    expect(validateAuditRecord(written)).toBe(true);
    expect(written.at).toBe("2026-09-30T07:41:00.000Z");
    expect(written.tenant).toBe("org_456");
    expect(written.kind).toBe("decision");
    expect(written.identity.subject).toBe("user_123");
    expect(written.identity.subject_authority.as_of).toBe("2026-09-30T07:41:00.000Z");
    expect(written.correlation.request_id).toBe("req_1");
    resetClock();
  });

  // The chain, which is the whole reason a record is hard to change quietly. Each record's
  // previous_hash is the one before it, so editing any record breaks every hash after it.
  it("DSOR-AUD-01: each record's previous_hash is the record before it", () => {
    forgetTheLog();

    const first = recorded({ requestId: "req_1" });
    const second = recorded({ requestId: "req_2", authorization: "DENY" });
    const third = recorded({ requestId: "req_3" });

    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(third.sequence).toBe(2);

    // The first record has nothing before it, so it points at a hash of nothing.
    expect(first.previous_hash).toMatch(/^sha256:0+$/);
    expect(second.previous_hash).toBe(first.record_hash);
    expect(third.previous_hash).toBe(second.record_hash);

    // Every hash is different, so the hash is of the record and not of a constant.
    expect(new Set([first.record_hash, second.record_hash, third.record_hash]).size).toBe(3);
    expect(verifyChain(theLog())).toBe(true);
  });

  // What the chain is FOR. This is also the test that says what step 39 will make impossible
  // rather than merely detectable: here the log is an array in memory, so anyone holding a copy can
  // edit a record. What they cannot do is edit one and leave the chain agreeing with itself.
  it("DSOR-AUD-01: editing a record breaks the chain after it", () => {
    forgetTheLog();
    recorded({ requestId: "req_1" });
    recorded({ requestId: "req_2", authorization: "DENY", result: "AUTHORIZATION_DENIED" });
    recorded({ requestId: "req_3" });

    expect(verifyChain(theLog())).toBe(true);

    // Rewrite history: make the denial look like an allow.
    const tampered = theLog().map((record, at) =>
      at === 1 ? ({ ...record, authorization: "ALLOW", result: "data" } as AuditRecord) : record,
    );

    expect(verifyChain(tampered)).toBe(false);

    // A record removed altogether is caught too, because the sequence and the link both move.
    expect(verifyChain([...theLog().slice(0, 1), ...theLog().slice(2)])).toBe(false);

    // And so is a record moved, with nothing else touched.
    expect(verifyChain([theLog()[1]!, theLog()[0]!, theLog()[2]!])).toBe(false);
  });

  // Each of the two checks, pinned on its own. Without these, three overlapping checks were all
  // caught by the same two tests: mutating the sequence check away, and mutating the link check
  // away, left all 178 tests passing. A test that is caught by two checks proves neither.
  it("DSOR-AUD-01: an edit to the *last* record is caught, where no link follows it", () => {
    forgetTheLog();
    recorded({ requestId: "req_1" });
    recorded({ requestId: "req_2" });
    const last = recorded({ requestId: "req_3", authorization: "DENY", result: "POLICY_DENIED" });

    // Nothing comes after `last`, so there is no previous_hash anywhere that mentions it. Its
    // position is right and its link backwards is right. Only its own hash disagrees.
    const tampered: AuditRecord[] = [
      ...theLog().slice(0, 2),
      { ...last, authorization: "ALLOW", result: "data" } as AuditRecord,
    ];

    expect(tampered[2]!.sequence).toBe(2);
    expect(tampered[2]!.previous_hash).toBe(theLog()[1]!.record_hash);
    expect(verifyChain(tampered)).toBe(false);
  });

  it("DSOR-AUD-01: a genuine record from another history is caught", () => {
    // Two separate runs of the program. Every record in each is real: right sequence, right hash,
    // right link. The attack is to keep one and drop it into the other chain, which is what an
    // attacker with a backup and a database does.
    forgetTheLog();
    const mine0 = recorded({ requestId: "req_mine_0" });
    const mine1 = recorded({ requestId: "req_mine_1" });

    forgetTheLog();
    const theirs0 = recorded({ requestId: "req_theirs_0" });
    const theirs1 = recorded({ requestId: "req_theirs_1", authorization: "DENY" });

    expect(verifyChain([mine0, mine1])).toBe(true);
    expect(verifyChain([theirs0, theirs1])).toBe(true);

    // `theirs1` is untouched, and its sequence of 1 is correct for position 1.
    expect(theirs1.sequence).toBe(1);
    expect(validateAuditRecord(theirs1)).toBe(true);

    // It still does not belong, because it points backwards at a record that is not there.
    expect(verifyChain([mine0, theirs1])).toBe(false);
  });

  // Why the record is hashed from text with its keys sorted. Nothing in a single run can tell the
  // difference — a later step that reorders two lines in `audit` is what this protects, and that
  // step is not here to be tested. What *can* be tested is the property itself.
  it("DSOR-AUD-01: the hash is of the record's contents, not of its key order", () => {
    forgetTheLog();

    const written = recorded();
    const shuffled = Object.fromEntries(
      Object.entries(written).reverse(),
    ) as unknown as AuditRecord;

    expect(Object.keys(shuffled)).not.toEqual(Object.keys(written));
    expect(verifyChain([shuffled])).toBe(true);
  });

  it("DSOR-AUD-01: a log with one record, and an empty log, both verify", () => {
    forgetTheLog();
    expect(verifyChain(theLog())).toBe(true);
    recorded();
    expect(verifyChain(theLog())).toBe(true);
  });

  // Step 01's lesson, in a fifth place: `readonly` is erased before Node runs.
  it("a record handed out cannot be edited", () => {
    forgetTheLog();

    const written = recorded();

    expect(Object.isFrozen(written)).toBe(true);
    expect(() => {
      (written as { result: string }).result = "something else";
    }).toThrow(TypeError);

    // The nested parts too, because freezing the outside leaves the inside writable.
    expect(() => {
      (written.identity as { subject: string }).subject = "cfo_100";
    }).toThrow(TypeError);

    // Nor can the log itself be appended to by whoever reads it.
    expect(() => (theLog() as AuditRecord[]).push(written)).toThrow(TypeError);
  });

  // Decision 53. A caller who never logged in is counted, not recorded, because §29 says so and
  // because the reason is a real attack: an unauthenticated flood filling the audit store.
  it("DSOR-AUD-01: an unauthenticated refusal is counted and leaves no record", () => {
    forgetTheLog();
    expect(countedWithoutARecord()).toBe(0);

    recorded();
    expect(theLog()).toHaveLength(1);

    for (let i = 0; i < 100; i += 1) {
      const nothing = audit({
        kind: "decision",
        subject: undefined,
        requestId: `req_flood_${i}`,
        result: "AUTHENTICATION_REQUIRED",
      });

      expect(nothing).toBeUndefined();
    }

    expect(countedWithoutARecord()).toBe(100);
    expect(theLog()).toHaveLength(1);
    expect(verifyChain(theLog())).toBe(true);
  });

  // The clock is real, and the seam exists so a test can be exact and the README stable.
  it("DSOR-AUD-01: the time on a record comes from a real clock", () => {
    resetClock();

    const before = Date.now();
    const stamp = now();
    const after = Date.now();

    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const when = Date.parse(stamp);

    expect(when).toBeGreaterThanOrEqual(before);
    expect(when).toBeLessThanOrEqual(after);
  });

  it("DSOR-AUD-01: a record the schema would refuse is never kept", () => {
    forgetTheLog();

    // `invoice.get` with no version is not an operationRef, so the schema refuses it. The point is
    // what happens next: the log does not grow, and the sequence does not advance.
    expect(() => audit(decision({ operation: "invoice.get" }))).toThrow(/audit-record\.schema\.json/);
    expect(theLog()).toHaveLength(0);

    // The next good record is still sequence 0, so the refused one left no gap in the chain.
    expect(recorded().sequence).toBe(0);
    expect(verifyChain(theLog())).toBe(true);
  });
});
