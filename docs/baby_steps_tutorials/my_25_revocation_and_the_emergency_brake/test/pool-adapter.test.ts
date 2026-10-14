// STEP 11: the pool adapter, under the unit suite.
//
// `overPool` is the adapter the program uses against a real server, and the unit suite runs on
// PGlite, so nothing in `pnpm test` ever executed it. A mutation pass measured the consequence:
// skipping ROLLBACK, and saying the company for the session instead of the transaction, both
// passed every unit test. The database tier catches both — and CI never runs the database tier.
// So the adapter is driven here against a stub pool that records every statement it is handed
// and how the connection is given back.
//
// Rule DSOR-RP-01c: the tenant setting MUST be transaction-local.

import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { overPool } from "../src/database.ts";

interface Recorded {
  statements: string[];
  released: unknown[];
  connected: number;
}

/**
 * A pool of one stub client. `failOn` makes that statement throw; `rollbackFails` the ROLLBACK.
 * STEP 22, decision 158: `hold` may hand back a promise a statement waits for, and the
 * client listens for errors, as a turn's connection is made to (found by a second review).
 */
function aStubPool(
  options: {
    failOn?: string;
    rollbackFails?: boolean;
    hold?: (text: string) => Promise<void> | undefined;
  } = {},
): [Pool, Recorded] {
  const seen: Recorded = { statements: [], released: [], connected: 0 };
  const client = {
    query: async (text: string) => {
      seen.statements.push(text);
      await options.hold?.(text);

      if (text === options.failOn) {
        throw Object.assign(new Error("the server refused it"), { code: "23505" });
      }

      if (text === "ROLLBACK" && options.rollbackFails) {
        throw new Error("Connection terminated unexpectedly");
      }

      return { rows: [{ ok: true }] };
    },
    release: (dead?: boolean) => {
      seen.released.push(dead);
    },
    on: () => {},
    off: () => {},
  };
  const pool = {
    connect: async () => {
      seen.connected += 1;

      return client;
    },
    query: async (text: string) => {
      seen.statements.push(`plain: ${text}`);

      return { rows: [] };
    },
  };

  return [pool as unknown as Pool, seen];
}

describe("the pool adapter", () => {
  it("DSOR-RP-01c: a statement with a company is BEGIN, the company for this transaction, the statement, COMMIT", async () => {
    const [pool, seen] = aStubPool();

    const { rows } = await overPool(pool).query("SELECT 1", undefined, "org_456");

    expect(rows).toStrictEqual([{ ok: true }]);
    expect(seen.statements).toStrictEqual([
      "BEGIN",
      "SELECT set_config('dsor.tenant_id', $1, true)",
      "SELECT 1",
      "COMMIT",
    ]);
    expect(seen.released).toStrictEqual([false]); // handed back, and not destroyed
  });

  it("a statement the server refuses is rolled back, the error is the server's own, and the connection goes back usable", async () => {
    const [pool, seen] = aStubPool({ failOn: "SELECT 1" });

    await expect(overPool(pool).query("SELECT 1", undefined, "org_456")).rejects.toMatchObject({
      code: "23505",
    });
    expect(seen.statements.at(-1)).toBe("ROLLBACK");
    expect(seen.released).toStrictEqual([false]);
  });

  it("a connection that cannot even roll back is destroyed, not handed back", async () => {
    const [pool, seen] = aStubPool({ failOn: "SELECT 1", rollbackFails: true });

    await expect(overPool(pool).query("SELECT 1", undefined, "org_456")).rejects.toMatchObject({
      code: "23505", // still the statement's own error, not the ROLLBACK's
    });
    expect(seen.released).toStrictEqual([true]);
  });

  it("a statement with no company runs plainly, on whichever connection the pool picks", async () => {
    const [pool, seen] = aStubPool();

    await overPool(pool).query("SELECT current_user");

    expect(seen.connected).toBe(0);
    expect(seen.statements).toStrictEqual(["plain: SELECT current_user"]);
  });
});

describe("the pool adapter's turn at the log", () => {
  // STEP 22, decision 158, found by a second review: the pool's turn was tested only on a
  // real server, where READ COMMITTED is the default anyway, so a plain BEGIN passed every test.

  /** A stub pool's turn, which must exist. */
  const turnOf = (pool: Pool): NonNullable<ReturnType<typeof overPool>["inTurn"]> => {
    const turn = overPool(pool).inTurn;

    if (turn === undefined) {
      throw new Error("the pool takes no turns");
    }

    return turn;
  };

  it("DSOR-AUD-01: a turn is BEGIN at READ COMMITTED, the company and the turn in one statement, the work, COMMIT", async () => {
    const [pool, seen] = aStubPool();

    await turnOf(pool)("org_456", "audit:org_456", async (statements) => {
      await statements.query("SELECT 1");
    });

    expect(seen.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(seen.statements[1]).toContain("set_config('dsor.tenant_id', $1, true)");
    expect(seen.statements[1]).toContain(
      "set_config('idle_in_transaction_session_timeout', '10s', true)",
    );
    expect(seen.statements[1]).toContain(
      "pg_advisory_xact_lock(hashtext('dsor.audit'), hashtext($2))",
    );
    expect(seen.statements.slice(2)).toStrictEqual(["SELECT 1", "COMMIT"]);
    expect(seen.released).toStrictEqual([false]);
  });

  it("DSOR-AUD-01: a turn whose statement the server refuses is rolled back, and its connection goes back usable", async () => {
    const [pool, seen] = aStubPool({ failOn: "SELECT 1" });

    await expect(
      turnOf(pool)("org_456", "audit:org_456", async (statements) => {
        await statements.query("SELECT 1");
      }),
    ).rejects.toMatchObject({ code: "23505" });
    expect(seen.statements.at(-1)).toBe("ROLLBACK");
    expect(seen.released).toStrictEqual([false]);
  });

  it("DSOR-TEN-02a: a company's next turn waits in the program without a connection, and goes once the turn before it is taken", async () => {
    let give = (): void => {};
    const given = new Promise<void>((resolve) => {
      give = resolve;
    });
    let finish = (): void => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let held = false;
    const [pool, seen] = aStubPool({
      // The first turn of org_456 is not given until the test says so.
      hold: (text) => {
        if (!held && text.includes("hashtext($2)")) {
          held = true;

          return given;
        }

        return undefined;
      },
    });
    const turn = turnOf(pool);
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
    const first = turn("org_456", "audit:org_456", async () => {
      await finished;
    });
    const second = turn("org_456", "audit:org_456", async () => {});
    const other = turn("org_789", "audit:org_789", async () => {});

    await tick();
    // org_456's first waits for its turn on a connection; its second waits in the program, on none;
    // org_789 has a line of its own, and is done.
    await other;
    expect(seen.connected).toBe(2);

    give();
    await tick();
    // The first has its turn, and works on; the second has gone to wait for the next one.
    expect(seen.connected).toBe(3);

    finish();
    await first;
    await second;
  });
});
