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

/** A pool of one stub client. `failOn` makes that statement throw; `rollbackFails` the ROLLBACK. */
function aStubPool(options: { failOn?: string; rollbackFails?: boolean } = {}): [Pool, Recorded] {
  const seen: Recorded = { statements: [], released: [], connected: 0 };
  const client = {
    query: async (text: string) => {
      seen.statements.push(text);

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
