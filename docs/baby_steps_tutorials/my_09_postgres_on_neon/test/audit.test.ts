// NEW IN STEP 08: the log, on its own.
//
// Nothing here calls an operation. These tests are about what an audit record is, and about the
// chain that makes one hard to change quietly — before anything writes one.

import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  audit,
  AUDIT_SCHEMA_FIELDS,
  countedWithoutARecord,
  forgetTheLog,
  now,
  resetClock,
  setClock,
  theHead,
  theLog,
  validateAuditRecord,
  verifyChain,
  type AuditRecord,
  type DecisionToRecord,
} from "../src/audit.ts";
import { aDatabase } from "./support/database.ts";

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
async function recorded(over: Partial<DecisionToRecord> = {}): Promise<AuditRecord> {
  const written = await audit(decision(over));

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
const specCopy = new URL(
  "../../../../packages/spec/schemas/audit-record.schema.json",
  import.meta.url,
);
const insideTheRepository = existsSync(specCopy);

// NEW IN STEP 09: the log lives in a database, so these tests need one. A single PGlite for the
// whole file — creating one costs about 350ms, and one per test would turn this suite into minutes.
let db: Awaited<ReturnType<typeof aDatabase>>;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("the audit log", () => {
  it("DSOR-SCH-01: the compiled schema refuses records, so it is doing work", async () => {
    // A count off the compiled schema, not `true`. A review deleted the compile guard and every test
    // still passed, because the old sentinel was a literal — lesson 12, in the one file that had not
    // learned it.
    // The exact number the schema declares, counted here from the file rather than remembered. A
    // review set the constant to a plausible literal and `toBeGreaterThan(15)` accepted it.
    const declared = JSON.parse(
      readFileSync(new URL("../src/schemas/audit-record.schema.json", import.meta.url), "utf8"),
    ) as { properties: Record<string, unknown> };

    expect(AUDIT_SCHEMA_FIELDS).toBe(Object.keys(declared.properties).length);

    await forgetTheLog();
    const good = await recorded();

    // The assertions a stub schema cannot pass. Each of these is one required field or one pattern.
    expect(validateAuditRecord(good)).toBe(true);
    expect(validateAuditRecord({})).toBe(false);
    expect(validateAuditRecord({ ...good, sequence: -1 })).toBe(false);
    expect(validateAuditRecord({ ...good, at: "the day before yesterday" })).toBe(false);
    expect(validateAuditRecord({ ...good, record_hash: "not-a-hash" })).toBe(false);
    expect(validateAuditRecord({ ...good, kind: "gossip" })).toBe(false);
    expect(validateAuditRecord({ ...good, smuggled: true })).toBe(false);
    expect(validateAuditRecord({ ...good, identity: { ...good.identity, mode: "sideways" } })).toBe(
      false,
    );
  });

  // Skipped rather than quietly passed when the repository is not there, so the test report says
  // which of the two things happened. A check that silently does nothing is worse than no check.
  it.skipIf(!insideTheRepository)(
    "DSOR-AUD-01: the schema is byte for byte the specification's own",
    () => {
      // A record validated against a schema of our own making would prove nothing about
      // DSOR-AUD-01. This is the test that says the schema was not quietly edited to fit the code.
      const ours = readFileSync(
        new URL("../src/schemas/audit-record.schema.json", import.meta.url),
      );

      expect(ours.equals(readFileSync(specCopy))).toBe(true);
    },
  );

  it("DSOR-AUD-01: a record validates against audit-record.schema.json", async () => {
    await forgetTheLog();
    setClock(() => "2026-09-30T07:41:00.000Z");

    const written = await recorded();

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
  it("DSOR-AUD-04b: each record's previous_hash is the record before it", async () => {
    await forgetTheLog();

    const first = await recorded({ requestId: "req_1" });
    const second = await recorded({ requestId: "req_2", authorization: "DENY" });
    const third = await recorded({ requestId: "req_3" });

    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(third.sequence).toBe(2);

    // The first record has nothing before it, so it points at a hash of nothing.
    expect(first.previous_hash).toMatch(/^sha256:0+$/);
    expect(second.previous_hash).toBe(first.record_hash);
    expect(third.previous_hash).toBe(second.record_hash);

    // Every hash is different, so the hash is of the record and not of a constant.
    expect(new Set([first.record_hash, second.record_hash, third.record_hash]).size).toBe(3);
    expect(verifyChain(await theLog())).toBe(true);
  });

  // What the chain is FOR. This is also the test that says what step 39 will make impossible
  // rather than merely detectable: here the log is an array in memory, so anyone holding a copy can
  // edit a record. What they cannot do is edit one and leave the chain agreeing with itself.
  it("DSOR-AUD-04b: editing a record breaks the chain after it", async () => {
    await forgetTheLog();
    await recorded({ requestId: "req_1" });
    await recorded({ requestId: "req_2", authorization: "DENY", result: "AUTHORIZATION_DENIED" });
    await recorded({ requestId: "req_3" });

    expect(verifyChain(await theLog())).toBe(true);

    // Rewrite history: make the denial look like an allow.
    const tampered = (await theLog()).map((record, at) =>
      at === 1 ? ({ ...record, authorization: "ALLOW", result: "data" } as AuditRecord) : record,
    );

    expect(verifyChain(tampered)).toBe(false);

    // A record removed altogether is caught too, because the sequence and the link both move.
    expect(verifyChain([...(await theLog()).slice(0, 1), ...(await theLog()).slice(2)])).toBe(
      false,
    );

    // And so is a record moved, with nothing else touched.
    expect(verifyChain([(await theLog())[1]!, (await theLog())[0]!, (await theLog())[2]!])).toBe(
      false,
    );
  });

  // Each of the two checks, pinned on its own. Without these, three overlapping checks were all
  // caught by the same two tests: mutating the sequence check away, and mutating the link check
  // away, left all 178 tests passing. A test that is caught by two checks proves neither.
  it("DSOR-AUD-04b: an edit to the *last* record is caught, where no link follows it", async () => {
    await forgetTheLog();
    await recorded({ requestId: "req_1" });
    await recorded({ requestId: "req_2" });
    const last = await recorded({
      requestId: "req_3",
      authorization: "DENY",
      result: "POLICY_DENIED",
    });

    // Nothing comes after `last`, so there is no previous_hash anywhere that mentions it. Its
    // position is right and its link backwards is right. Only its own hash disagrees.
    const tampered: AuditRecord[] = [
      ...(await theLog()).slice(0, 2),
      { ...last, authorization: "ALLOW", result: "data" } as AuditRecord,
    ];

    expect(tampered[2]!.sequence).toBe(2);
    expect(tampered[2]!.previous_hash).toBe((await theLog())[1]!.record_hash);
    expect(verifyChain(tampered)).toBe(false);
  });

  it("DSOR-AUD-04b: a genuine record from another history is caught", async () => {
    // Two separate runs of the program. Every record in each is real: right sequence, right hash,
    // right link. The attack is to keep one and drop it into the other chain, which is what an
    // attacker with a backup and a database does.
    await forgetTheLog();
    const mine0 = await recorded({ requestId: "req_mine_0" });
    const mine1 = await recorded({ requestId: "req_mine_1" });

    await forgetTheLog();
    const theirs0 = await recorded({ requestId: "req_theirs_0" });
    const theirs1 = await recorded({ requestId: "req_theirs_1", authorization: "DENY" });

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
  it("DSOR-AUD-04b: the hash is of the record's contents, not of its key order", async () => {
    await forgetTheLog();

    const written = await recorded();
    const shuffled = Object.fromEntries(
      Object.entries(written).reverse(),
    ) as unknown as AuditRecord;

    expect(Object.keys(shuffled)).not.toEqual(Object.keys(written));
    expect(verifyChain([shuffled])).toBe(true);

    // The **nested** objects too. This test only reversed the top level, so removing the recursive
    // half of the sort left all 223 tests passing — a review built a record whose `identity` keys
    // arrived in a different order and it still verified. `canonical` sorts at every depth, and this
    // is the input that says so.
    const nested = {
      ...written,
      identity: Object.fromEntries(Object.entries(written.identity).reverse()),
      correlation: Object.fromEntries(Object.entries(written.correlation).reverse()),
    } as unknown as AuditRecord;

    expect(Object.keys(nested.identity)).not.toEqual(Object.keys(written.identity));
    expect(verifyChain([nested])).toBe(true);
  });

  /**
   * The checkpoint's limit, pinned — because I claimed more than it does.
   *
   * `theHead()` is a query over the same table it is meant to vouch for. Delete a row from the table
   * and the head moves with it, so the two agree again:
   *
   *     3 records, head count 3, last sha256:6feaa09…   verifies: true
   *     DELETE the last row
   *     2 records, head count 2, last sha256:934d65b…   verifies: TRUE
   *
   * Step 08 held the head in a module variable updated on each write, which was independent of the
   * log and did catch this. Making it a query fixed a real problem — a variable is reset by every
   * restart, so after the thing step 09 exists for it would vouch for nothing — and introduced this
   * one, and I shipped the new behaviour while repeating the old claim.
   *
   * What the head still catches: a log **handed to you** that has been shortened, and a head read
   * before the deletion. §30 says the real answer as a SHOULD — *"anchor checkpoints outside the
   * control-plane store"* — and this step has nowhere outside to put one, so `DSOR-AUD-04d` is not
   * claimed. This test is here so that the day something anchors it, this failure says so.
   */
  it("a head read after a deletion agrees with the shortened log, which is the limit", async () => {
    await forgetTheLog();
    await recorded({ requestId: "req_1" });
    await recorded({ requestId: "req_2" });
    const beforeTheDeletion = await theHead();

    await recorded({ requestId: "req_3" });

    const head = await theHead();

    expect(await verifyChain(await theLog(), head)).toBe(true);

    // Delete the newest row, as only the owner can.
    await db.exec("DELETE FROM audit WHERE sequence = (SELECT max(sequence) FROM audit)");

    const shortened = await theLog();

    expect(shortened).toHaveLength(2);

    // A head read NOW moves with the table, so it agrees. This is the limit.
    expect(await verifyChain(shortened, await theHead())).toBe(true);

    // A head from before the deletion catches it, and so does the one read before record 3.
    expect(await verifyChain(shortened, head)).toBe(false);
    expect(await verifyChain(shortened, beforeTheDeletion)).toBe(true);
  });

  // The emptiest case, which had no test: a fresh log checked against its own fresh head. `lastHashOf`
  // has to answer the genesis hash for an empty run, and a review flipped that `=== 0` with all 223
  // tests passing — an empty log would have been reported as a broken chain.
  it("DSOR-AUD-04b: an empty log verifies against an empty head", async () => {
    await forgetTheLog();

    expect((await theHead()).count).toBe(0);
    expect((await theHead()).lastHash).toMatch(/^sha256:0+$/);
    expect(verifyChain(await theLog(), await theHead())).toBe(true);

    // And one record in, the head has moved on, so the empty case is not a special-case shortcut.
    await recorded();
    expect(verifyChain(await theLog(), await theHead())).toBe(true);
    expect(verifyChain([], await theHead())).toBe(false);
  });

  it("DSOR-AUD-04b: a log with one record, and an empty log, both verify", async () => {
    await forgetTheLog();
    expect(verifyChain(await theLog())).toBe(true);
    await recorded();
    expect(verifyChain(await theLog())).toBe(true);
  });

  // Step 01's lesson, in a fifth place: `readonly` is erased before Node runs. `Object.freeze` is
  // shallow, so every nested part needs its own — and a review found that three of the five freezes
  // had no test at all, which means three of them could have been deleted silently.
  //
  // No requirement id on this one on purpose. `Object.freeze` on a JavaScript object is not
  // `REVOKE UPDATE` on a table, and `DSOR-AUD-04a` is about the second. Step 09 gives the
  // application's database user no UPDATE on the log; step 39 hardens it.
  it("a record handed out cannot be edited, at any depth", async () => {
    await forgetTheLog();

    const written = await recorded();

    for (const part of [
      written,
      written.identity,
      written.identity.actor_chain,
      written.identity.subject_authority,
      written.correlation,
    ]) {
      expect(Object.isFrozen(part)).toBe(true);
    }

    expect(() => {
      (written as { result: string }).result = "something else";
    }).toThrow(TypeError);
    expect(() => {
      (written.identity as { subject: string }).subject = "cfo_100";
    }).toThrow(TypeError);
    expect(() => {
      (written.identity.subject_authority as { source: string }).source = "token";
    }).toThrow(TypeError);
    expect(() => {
      (written.identity.actor_chain as string[]).push("accounts-payable-fte");
    }).toThrow(TypeError);
    expect(() => {
      (written.correlation as { principal_id: string }).principal_id = "cfo_100";
    }).toThrow(TypeError);
  });

  // Three records, not one. On a one-element array `sort` and `reverse` report success because they
  // are no-ops and never write — a review pointed out that a test written with one record would pass
  // against an unfrozen copy.
  it("the log handed out cannot be reordered or appended to", async () => {
    await forgetTheLog();
    await recorded({ requestId: "req_1" });
    await recorded({ requestId: "req_2" });
    await recorded({ requestId: "req_3" });

    const order = (await theLog()).map((record) => record.correlation.request_id);

    for (const wreck of [
      (log: AuditRecord[]) => log.push(log[0]!),
      (log: AuditRecord[]) => log.reverse(),
      (log: AuditRecord[]) => log.sort(() => -1),
      (log: AuditRecord[]) => log.splice(0, 1),
      (log: AuditRecord[]) => {
        log.length = 0;
      },
      (log: AuditRecord[]) => {
        log[0] = log[2]!;
      },
    ]) {
      // Hoisted out of the arrow, because `expect(() => …)` takes a plain function and an `await`
      // cannot live in one. One array, wrecked repeatedly, which is what the test meant anyway.
      const handedOut = (await theLog()) as AuditRecord[];

      expect(() => wreck(handedOut)).toThrow(TypeError);
    }

    // And the real log is untouched by all of that.
    //
    // NEW IN STEP 09: this assertion means something weaker than it did, and is kept for what it
    // still covers. In step 08 `theLog()` handed out the array the program was writing to, so the
    // freeze was the only thing between a reader and the log. Now it hands out rows built fresh from
    // a query, so mutating them could not reach the database whatever we did — the freeze stops a
    // caller fooling *itself*, and the log is protected by having no UPDATE and no DELETE.
    expect((await theLog()).map((record) => record.correlation.request_id)).toEqual(order);
    expect(verifyChain(await theLog(), await theHead())).toBe(true);
  });

  /**
   * The cheapest attack there is, and it used to be invisible.
   *
   * `verifyChain` walks forward from the genesis hash, so it can only judge the records it is given.
   * A review dropped the last record — the one holding a denial — and got `true`. Then dropped two.
   * Then handed it an empty log: `true`. Chaining is evidence a record was not *edited*; it is no
   * evidence at all that one was not *deleted from the end*. §30 names checkpoints beside hash
   * chaining for exactly this reason, and `await theHead()` is the smallest checkpoint there is.
   */
  it("DSOR-AUD-04b: dropping records off the end is caught, but only against the head", async () => {
    await forgetTheLog();
    await recorded({ requestId: "req_1" });
    await recorded({ requestId: "req_2", authorization: "DENY", result: "POLICY_DENIED" });
    await recorded({ requestId: "req_3" });

    expect(verifyChain(await theLog(), await theHead())).toBe(true);
    expect((await theHead()).count).toBe(3);
    expect((await theHead()).lastHash).toBe((await theLog())[2]!.record_hash);

    // Drop the denial and everything after it. Every link still holds, every hash still matches.
    const truncated = (await theLog()).slice(0, 1);

    expect(verifyChain(truncated)).toBe(true);
    expect(verifyChain(truncated, await theHead())).toBe(false);

    // And the emptiest version of the same attack.
    expect(verifyChain([])).toBe(true);
    expect(verifyChain([], await theHead())).toBe(false);

    // The head is not fooled by a log of the right length either: a two-record log padded back to
    // three with a copy of an earlier record fails on the link, and on the head's last hash.
    const padded = [(await theLog())[0]!, (await theLog())[1]!, (await theLog())[1]!];

    expect(verifyChain(padded, await theHead())).toBe(false);
  });

  /**
   * Lesson 16 for the third time: "read the caller's data once" is a rule about every function the
   * data reaches, and `audit` was the one that had not applied it.
   *
   * A review handed it a getter that answered differently on each read. `decision.subject` was read
   * three times — to choose record-or-count, for `identity.subject`, for `correlation.principal_id` —
   * so the gate saw one person and the record blamed another. Schema-valid. Chain verifies.
   */
  it("DSOR-MOD-04: a field that answers differently on a second read cannot split a record", async () => {
    await forgetTheLog();

    let reads = 0;
    const shifty: DecisionToRecord = {
      kind: "decision",
      get subject(): string {
        reads += 1;

        return reads === 1 ? "user_123" : "cfo_100";
      },
      requestId: "req_1",
      result: "ALLOWED",
      authorization: "ALLOW",
      operation: "invoice.get@1",
    };

    const written = await audit(shifty);

    if (written === undefined) {
      throw new Error("expected a record");
    }

    // Read once, so every part of the record names the same person — the one the gate saw.
    expect(reads).toBe(1);
    expect(written.identity.subject).toBe("user_123");
    expect(written.correlation.principal_id).toBe("user_123");
    expect(verifyChain(await theLog(), await theHead())).toBe(true);
  });

  /**
   * The attack `hashOf` was open to before it walked the schema's field list.
   *
   * `JSON.stringify` calls `toJSON` **before** a replacer ever runs. So an object could read one way
   * to every reader and serialise another way to the hash, keep the original `record_hash`, and
   * verify. Fields `JSON.stringify` drops came along for free and were readable afterwards.
   */
  it("DSOR-AUD-04b: a record that lies about its own contents does not verify", async () => {
    await forgetTheLog();

    const real = await recorded({ authorization: "DENY", result: "POLICY_DENIED" });

    // Reads as an ALLOW; serialises as the original DENY. Same record_hash.
    const twoFaced = {
      ...real,
      authorization: "ALLOW",
      result: "ALLOWED",
      toJSON: () => real,
    } as unknown as AuditRecord;

    expect(twoFaced.authorization).toBe("ALLOW");
    expect(verifyChain([twoFaced])).toBe(false);

    // And a field smuggled in beside the declared ones: not in the schema, so the record is refused.
    const smuggled = { ...real, card: "4111111111111111" } as unknown as AuditRecord;

    expect(verifyChain([smuggled])).toBe(false);

    // The version the schema cannot see. `additionalProperties: false` walks own *enumerable* keys,
    // and `JSON.stringify` calls `toJSON` whether it is enumerable or not — so a hidden one passes
    // validation and rewrites the hashed bytes. Only walking the schema's field list catches this.
    const hidden = { ...real, authorization: "ALLOW", result: "ALLOWED" } as unknown as AuditRecord;

    Object.defineProperty(hidden, "toJSON", { value: () => real, enumerable: false });

    expect(validateAuditRecord(hidden)).toBe(true);
    expect(hidden.authorization).toBe("ALLOW");
    expect(verifyChain([hidden])).toBe(false);
  });

  // The authenticated flood. Decision 53 guarded the unauthenticated half by counting; one principal
  // who is *supposed* to be recorded fills the log far faster, by making each record enormous.
  it("DSOR-AUD-01: caller text in a record is capped, and says how much was dropped", async () => {
    await forgetTheLog();

    const written = await recorded({ reason: "x".repeat(2_000_000) });

    expect(written.reason!.length).toBeLessThan(600);
    expect(written.reason).toMatch(/2000000 characters, 1999500 dropped/);
    expect(validateAuditRecord(written)).toBe(true);
    expect(verifyChain(await theLog(), await theHead())).toBe(true);
  });

  // A verifier that crashes on hostile input rather than answering `false` is a shape a caller gets
  // wrong exactly once.
  it("DSOR-AUD-04b: verifyChain answers false for rubbish instead of throwing", () => {
    for (const rubbish of [
      [null],
      [undefined],
      // A hole in a sparse array, which reads as undefined and is not the same thing as a missing key.
      Array.from<AuditRecord>({ length: 2 }),
      [{} as AuditRecord],
    ]) {
      expect(verifyChain(rubbish as readonly AuditRecord[])).toBe(false);
    }
  });

  // A backdated record is hashed *from* the backdated time, so checks 2 and 3 cannot see it. "Later
  // than the one before" is a relationship between neighbours, which is what this function is for.
  it("DSOR-AUD-04b: a record whose time runs backwards does not verify", async () => {
    await forgetTheLog();

    setClock(() => "2026-09-30T10:00:00.000Z");
    await recorded({ requestId: "req_1" });
    setClock(() => "2019-01-01T00:00:00.000Z");
    const backdated = await recorded({ requestId: "req_2" });
    resetClock();

    // It is a genuine record: schema-valid, correctly linked, correctly hashed.
    expect(validateAuditRecord(backdated)).toBe(true);
    expect(backdated.previous_hash).toBe((await theLog())[0]!.record_hash);
    expect(verifyChain(await theLog())).toBe(false);

    // Equal times are fine, because a fixed clock gives them.
    await forgetTheLog();
    setClock(() => "2026-09-30T10:00:00.000Z");
    await recorded({ requestId: "req_1" });
    await recorded({ requestId: "req_2" });
    expect(verifyChain(await theLog(), await theHead())).toBe(true);
    resetClock();
  });

  // Every field `audit` chooses, not just the ones a caller passes. A review mutated `chain`,
  // `record_id`, `identity.mode`, `actor_chain` and `subject_authority.source` one at a time and no
  // test noticed any of them: the hash proves a field was not changed after writing, never that the
  // right value was written.
  it("DSOR-AUD-01: the fields DSoR chooses are the ones DSoR means", async () => {
    await forgetTheLog();
    setClock(() => "2026-09-30T07:41:00.000Z");

    const written = await recorded();

    expect(written.chain).toBe("audit:org_456");
    // NEW IN STEP 09: `${chain}:${sequence}`, with no reset counter in it. Step 08 needed one
    // because `forgetTheLog` rewound the sequence while the old records were still in the array.
    // Here the reset is a DELETE, so the id it frees belongs to nothing.
    expect(written.record_id).toBe("audit:org_456:0");
    expect(written.tenant).toBe("org_456");
    expect(written.kind).toBe("decision");
    expect(written.correlation.tenant_id).toBe("org_456");

    // `direct` with an empty actor chain, because nothing acts on anyone's behalf yet, and
    // `role_source` because step 06's roles come from a table rather than a signed token. Step 42
    // is where `on_behalf_of` and a chain with an agent in it become true.
    expect(written.identity.mode).toBe("direct");
    expect(written.identity.actor_chain).toEqual([]);
    expect(written.identity.subject_authority.source).toBe("role_source");
    expect(written.identity.subject_authority.as_of).toBe("2026-09-30T07:41:00.000Z");
    resetClock();
  });

  /**
   * A record id repeats after a reset, and in step 09 that is correct rather than a regression.
   *
   * Step 08 could not allow it: `forgetTheLog` rewound the sequence while the records it had already
   * handed out were still in the array, so two live decisions could carry one id. That is why the id
   * had a reset counter in it.
   *
   * Here the reset is `DELETE FROM audit`. The id is freed because the record holding it is gone, so
   * reusing it collides with nothing — and the PRIMARY KEY is what guarantees that, not our care.
   * Also worth saying plainly: nothing in a real deployment deletes, because the application's own
   * account has no DELETE. Only a test holding the owner's connection can reach this at all.
   */
  it("DSOR-AUD-01: a record id is unique among the records that exist", async () => {
    await forgetTheLog();
    const first = await recorded({ requestId: "req_1" });
    const second = await recorded({ requestId: "req_2" });

    expect(second.record_id).not.toBe(first.record_id);

    // After a reset the numbering starts again, and the id it reuses belongs to nothing.
    await forgetTheLog();
    const afterReset = await recorded({ requestId: "req_3" });

    expect(afterReset.sequence).toBe(0);
    expect(afterReset.record_id).toBe(first.record_id);
    expect(await theLog()).toHaveLength(1);
  });

  // Decision 53. A caller who never logged in is counted, not recorded, because §29 says so and
  // because the reason is a real attack: an unauthenticated flood filling the audit store.
  it("DSOR-AUD-01: an unauthenticated refusal is counted and leaves no record", async () => {
    await forgetTheLog();
    expect(countedWithoutARecord()).toBe(0);

    await recorded();
    expect(await theLog()).toHaveLength(1);

    for (let i = 0; i < 100; i += 1) {
      const nothing = await audit({
        kind: "decision",
        subject: undefined,
        requestId: `req_flood_${i}`,
        result: "AUTHENTICATION_REQUIRED",
      });

      expect(nothing).toBeUndefined();
    }

    expect(countedWithoutARecord()).toBe(100);
    expect(await theLog()).toHaveLength(1);
    expect(verifyChain(await theLog())).toBe(true);
  });

  // The clock is real, and the seam exists so a test can be exact and the README stable.
  it("DSOR-COR-01b: the time on a record comes from a real clock", () => {
    resetClock();

    const before = Date.now();
    const stamp = now();
    const after = Date.now();

    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const when = Date.parse(stamp);

    expect(when).toBeGreaterThanOrEqual(before);
    expect(when).toBeLessThanOrEqual(after);
  });

  it("DSOR-AUD-01: a record the schema would refuse is never kept", async () => {
    await forgetTheLog();

    // `invoice.get` with no version is not an operationRef, so the schema refuses it. The point is
    // what happens next: the log does not grow, and the sequence does not advance.
    // `.rejects`, because `audit` writes a row and therefore returns a promise. A `.toThrow` here
    // would pass without ever running the call.
    await expect(audit(decision({ operation: "invoice.get" }))).rejects.toThrow(
      /audit-record\.schema\.json/,
    );
    expect(await theLog()).toHaveLength(0);

    // The next good record is still sequence 0, so the refused one left no gap in the chain.
    expect((await recorded()).sequence).toBe(0);
    expect(verifyChain(await theLog())).toBe(true);
  });
  /**
   * Every field of a record, changed one at a time, and every change caught.
   *
   * `hashOf` walks `FIELDS` — the schema's own property list — and copies each value into the
   * snapshot it hashes, skipping only `record_hash`. Nothing tested that the walk reaches every
   * field, and a field the hash did not cover would be a field an attacker could rewrite with the
   * chain still verifying.
   *
   * Each substitution below is **schema-valid**, which the test asserts before it checks anything
   * else. Without that, a change could be caught by `validateAuditRecord` rather than by the hash,
   * and the test would pass while proving nothing about the tamper-evidence.
   *
   * Almost every field here is caught by check 2, the record's own hash, and that is the point:
   * `sequence` and `chain` once had checks of their own and they were removed because both are
   * inside the record and therefore inside the hash. This test is the standing evidence for that
   * reasoning — if the hash ever stopped covering a field, the field would have no other guard, and
   * the line here would go red.
   */
  it("DSOR-AUD-04b: no single field can be changed without the chain noticing", async () => {
    await forgetTheLog();

    // Every optional field filled, so the loop below has something to change in each of them.
    const original = await recorded({
      requestId: "req_1",
      operation: "invoice.issue@1",
      authorization: "DENY",
      result: "AUTHORIZATION_DENIED",
      reason: "the CFO may not issue invoices",
      payloadHash: `sha256:${"a".repeat(64)}`,
    });

    expect(verifyChain([original], await theHead())).toBe(true);

    const instead: Record<string, unknown> = {
      record_id: "audit:org_456:99",
      chain: "audit:org_999",
      sequence: 7,
      previous_hash: `sha256:${"1".repeat(64)}`,
      record_hash: `sha256:${"2".repeat(64)}`,
      at: "2030-01-01T00:00:00.000Z",
      tenant: "org_999",
      kind: "classified_read",
      identity: { ...original.identity, subject: "cfo_100" },
      operation: "invoice.get@1",
      payload_hash: `sha256:${"b".repeat(64)}`,
      authorization: "ALLOW",
      result: "ALLOWED",
      reason: "a different reason entirely",
      correlation: { ...original.correlation, request_id: "req_999" },
    };

    // Every field this record actually carries is covered here, so a field the writer starts
    // filling in later makes this fail rather than slip through untested.
    //
    // Not every field the *schema* declares: it has 24 properties and a decision record uses 15.
    // The other nine belong to the record kinds this step does not write — proposal transitions and
    // classified reads arrive in later steps, and they will bring their own cases here.
    expect(Object.keys(instead).sort()).toStrictEqual(Object.keys(original).sort());
    expect(Object.keys(instead).length).toBeLessThan(AUDIT_SCHEMA_FIELDS);

    for (const [field, value] of Object.entries(instead)) {
      const tampered = { ...original, [field]: value } as AuditRecord;

      // Really changed, and still a valid record — so whatever catches it is the tamper-evidence
      // and not the schema.
      expect(tampered[field as keyof AuditRecord], field).not.toStrictEqual(
        original[field as keyof AuditRecord],
      );
      expect(validateAuditRecord(tampered), `${field} is still schema-valid`).toBe(true);

      expect(verifyChain([tampered]), `changing ${field} went unnoticed`).toBe(false);
      expect(verifyChain([tampered], await theHead()), `changing ${field} vs the head`).toBe(false);
    }
  });
});
