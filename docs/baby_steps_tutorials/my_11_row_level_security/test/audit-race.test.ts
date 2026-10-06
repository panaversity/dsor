// STEP 09: what a lost race does to the log.
//
// §47 says a guarantee about a race is proven by fault injection, not by reading the code. These
// tests do not hope for an unlucky interleaving — they force the exact one, by holding the first
// writer's tail read open until the second writer has finished all the way through.
//
// One PGlite connection cannot race itself, which is true and was used as a reason not to test
// this. It is the wrong conclusion: the interleaving does not need real concurrency, only control
// over the order, and a `Database` wrapper gives that. The real server's job is the UNIQUE
// constraint under genuine parallelism, and `audit.db.test.ts` still has it.
//
// Titled DSOR-AUD-04b and not 04a. 04a is about the runtime identity not being able to update or
// delete records, which is `test/database.test.ts`. 04b is the one these break: records MUST be
// tamper-evident through hash chaining, and a chain that reports an untampered log as broken is a
// failed tamper-evidence mechanism just as surely as one that misses real tampering.

import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { migrationsIn } from "../src/migrations.ts";
import {
  audit,
  resetClock,
  setClock,
  theHead,
  theLog,
  useDatabase,
  verifyChain,
  type Database,
  type DecisionToRecord,
} from "../src/audit.ts";
import { overPGlite } from "../src/database.ts";

let real: PGlite;
/** NEW IN STEP 11: `real`, as a connection whose statements can say their company. */
let connection: Database;

beforeEach(async () => {
  real = await PGlite.create();
  await real.exec("CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'local-throwaway-not-a-secret';");

  for (const migration of migrationsIn(fileURLToPath(new URL("../migrations", import.meta.url)))) {
    await real.exec(migration.sql);
  }

  connection = overPGlite(real);

  // A clock that never repeats. With the real one two writes can land in the same millisecond, and
  // an inversion would hide inside it — the test would pass and prove nothing.
  let tick = 0;

  setClock(() => new Date(Date.UTC(2026, 9, 4, 0, 0, tick++)).toISOString());
});

afterEach(async () => {
  resetClock();
  await real.close();
});

/**
 * Is this `audit`'s own tail read?
 *
 * Both halves are needed. `theHead` has `ORDER BY sequence DESC` in a subquery, and `theLog`
 * selects `AS at_position` — so either test alone also catches a read that is not the one being
 * gated. The first version of the ten-writer test matched on the first half only, counted
 * `theHead` as an eleventh writer, and died reaching past the end of the gate list.
 */
function isTheTailRead(sql: string): boolean {
  return sql.includes("AS at_position") && sql.includes("ORDER BY sequence DESC");
}

function aDecision(id: string): DecisionToRecord {
  return {
    kind: "decision",
    subject: "user_123",
    tenant: "org_456",
    requestId: id,
    operation: "invoice.get@1",
    authorization: "ALLOW",
    result: "ALLOWED",
  };
}

/**
 * The real database, with the **first** tail read held open until `release` is called.
 *
 * That is the whole fault: one writer gets as far as reading the tail and is stopped there while
 * another writer goes past it and commits.
 */
function withTheFirstTailReadHeld(): { db: Database; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstTail = true;

  const db: Database = {
    async query<T>(sql: string, params?: unknown[], tenant?: string) {
      if (firstTail && isTheTailRead(sql)) {
        firstTail = false;
        await gate;
      }

      return connection.query<T>(sql, params, tenant);
    },
  };

  return { db, release };
}

describe("a writer that loses the race", () => {
  it("DSOR-AUD-04b: the time never goes backwards when a writer is overtaken", async () => {
    const { db, release } = withTheFirstTailReadHeld();

    useDatabase(db);

    // `slow` gets to the tail read and stops. `fast` goes straight through and takes position 0.
    // Then `slow` is let go, reads the tail, and takes position 1.
    const slow = audit(aDecision("req_slow"));

    await audit(aDecision("req_fast"));
    release();
    await slow;

    const log = await theLog("org_456");

    expect(log).toHaveLength(2);
    expect(log[0]?.correlation.request_id).toBe("req_fast");
    expect(log[1]?.correlation.request_id).toBe("req_slow");

    // The point. Before the fix the clock was read before the tail, so `req_slow` carried a time
    // one second EARLIER than the record ahead of it:
    //
    //     seq 0  at 2026-10-04T00:00:01.000Z  req_fast
    //     seq 1  at 2026-10-04T00:00:00.000Z  req_slow
    //
    // At the time `verifyChain` rejected that and the chain was unverifiable for good; the check is
    // gone (decision 87) and the reason stands on its own: a log whose times contradict its order
    // is evidence that lies about the order of events. There used to be a second test here asserting
    // the chain verified; with the check gone it could not fail, so it went.
    expect(log[1]!.at >= log[0]!.at).toBe(true);
  });

  it("DSOR-AUD-04b: the clock is read after the tail, not before", async () => {
    // The ordering pinned directly, so a later change that moves the line back is caught here and
    // not only through its consequence. `audit` must read the tail, *then* ask the time, *then*
    // insert.
    const order: string[] = [];

    setClock(() => {
      order.push("clock");

      return new Date(Date.UTC(2026, 9, 4)).toISOString();
    });

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        order.push(sql.includes("INSERT") ? "insert" : isTheTailRead(sql) ? "tail" : "other");

        return connection.query<T>(sql, params, tenant);
      },
    });

    await audit(aDecision("req_1"));

    expect(order).toStrictEqual(["tail", "clock", "insert"]);
  });

  it("DSOR-AUD-04b: ten writers passing through in reverse order still leave one ordered chain", async () => {
    // The worst ordering there is, and the first version of this test got it wrong by leaving one
    // writer ungated — it raced ahead, two writers computed position 0, and the run died on
    // `audit_pkey` instead of testing anything.
    //
    // Every writer is held at its tail read. They arrive in creation order, and they are then let
    // through one at a time in the **reverse** of that order, each finishing before the next is
    // released. So nobody collides, and the order the records are written in is the exact opposite
    // of the order the writers started in.
    //
    // That is what separates the two versions of the code. Reading the clock before the tail gives
    // each writer a time fixed at creation, so position 0 would get the newest time and position 9
    // the oldest — every single link going backwards. Reading it after the tail gives each writer
    // its time as it passes, which is the order it is written in.
    const gates: Array<{ wait: Promise<void>; open: () => void }> = Array.from(
      { length: 10 },
      () => {
        let open!: () => void;
        const wait = new Promise<void>((resolve) => {
          open = resolve;
        });

        return { wait, open };
      },
    );
    let arrived = 0;

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        if (isTheTailRead(sql)) {
          // `audit` runs synchronously as far as this query, so `arrived` is creation order.
          await gates[arrived++]!.wait;
        }

        return connection.query<T>(sql, params, tenant);
      },
    });

    const writers = Array.from({ length: 10 }, (_unused, i) => audit(aDecision(`req_${i}`)));

    expect(arrived).toBe(10); // all ten are waiting at the tail read, none has gone past it

    for (let i = writers.length - 1; i >= 0; i--) {
      gates[i]!.open();
      await writers[i];
    }

    const log = await theLog("org_456");

    expect(log).toHaveLength(10);
    // Written in the reverse of the order they started: the last writer created holds position 0.
    expect(log.map((r) => r.correlation.request_id)).toStrictEqual([
      "req_9",
      "req_8",
      "req_7",
      "req_6",
      "req_5",
      "req_4",
      "req_3",
      "req_2",
      "req_1",
      "req_0",
    ]);

    for (let i = 1; i < log.length; i++) {
      expect(log[i]!.at >= log[i - 1]!.at, `record ${i} is older than ${i - 1}`).toBe(true);
    }

    expect(verifyChain(log, await theHead("org_456"))).toBe(true);
  });
});
