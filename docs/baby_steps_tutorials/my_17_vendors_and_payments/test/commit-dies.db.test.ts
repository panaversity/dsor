// STEP 11: a connection that dies during COMMIT, on a real server.
//
// Step 09 proved the lost-reply recovery with a fake database in front of PGlite. The pool adapter
// is new in this step, and it has a moment of its own that PGlite cannot show: the server commits,
// the reply to COMMIT never arrives, and the adapter is holding a connection it must not hand back
// dirty. These tests inject exactly that fault into a real `pg` client, and ask three things: is
// the row there, what is the caller told, and what state is the connection in afterwards.
//
// Runs only under `pnpm test:db`, with DSOR_DB_URL and DSOR_DB_OWNER_URL set.
//
// Rule DSOR-UNK-01b: an unknown outcome MUST be reported as unknown, never as success, failure, or
// a retryable error.

import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { audit, OutcomeUnknown, useDatabase, type DecisionToRecord } from "../src/audit.ts";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

let owner: Pool;
let application: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  application = new Pool({ connectionString: APPLICATION, max: 2 });
  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  await owner.query("DELETE FROM dsor.audit");
});

afterEach(async () => {
  await owner?.query("DELETE FROM dsor.audit");
});

afterAll(async () => {
  await application?.end();
  await owner?.end();
});

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
 * The real pool, with one fault: the COMMIT of the transaction that holds the INSERT runs on the
 * server, and then the client reports the connection gone. With `thenDead`, every statement after
 * it fails the same way — a server that restarted — so the recovery's own look is refused too.
 *
 * The INSERT's COMMIT, and not the first COMMIT on the connection: the writer reads the tail in a
 * transaction of its own before it inserts, and a first version of this fault killed that one. The
 * writer then threw before its recovery was reached — correctly, since nothing had been written —
 * and the test measured the wrong moment.
 */
function withACommitThatDies(thenDead: boolean): Pool {
  let died = false;
  const gone = (): Error =>
    Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" });

  const wrap = (client: PoolClient): PoolClient => {
    const wrapped = Object.create(client) as PoolClient;
    let holdsTheInsert = false;

    wrapped.query = (async (text: string, params?: unknown[]) => {
      if (died && thenDead) {
        throw gone();
      }

      if (text === "BEGIN") {
        holdsTheInsert = false;
      } else if (text.includes("INSERT")) {
        holdsTheInsert = true;
      }

      const result = await client.query(text, params);

      if (text === "COMMIT" && holdsTheInsert && !died) {
        died = true;

        throw gone();
      }

      return result;
    }) as PoolClient["query"];

    return wrapped;
  };

  return {
    connect: async () => {
      if (died && thenDead) {
        throw gone();
      }

      return wrap(await application.connect());
    },
    query: (text: string, params?: unknown[]) => application.query(text, params),
  } as unknown as Pool;
}

describe.skipIf(!haveAServer)("a connection that dies during COMMIT, on a real server", () => {
  it("DSOR-UNK-01b: the server committed, the reply was lost, and the recovery finds the record by looking", async () => {
    useDatabase(overPool(withACommitThatDies(false)));

    const record = await audit(aDecision("req_commit"));

    // The row is there — the server did commit — and the caller holds the record of it, not an
    // error that would have sent them to retry a decision already on record.
    const rows = await owner.query<{ record_id: string }>("SELECT record_id FROM dsor.audit");

    expect(rows.rows.map((r) => r.record_id)).toStrictEqual(["audit:org_456:0"]);
    expect(record?.record_id).toBe("audit:org_456:0");
  });

  it("DSOR-UNK-01b: when the connection then stays dead, the caller is told unknown, and the row is still there", async () => {
    useDatabase(overPool(withACommitThatDies(true)));

    await expect(audit(aDecision("req_commit"))).rejects.toBeInstanceOf(OutcomeUnknown);

    const rows = await owner.query<{ n: string }>("SELECT count(*)::text AS n FROM dsor.audit");

    expect(rows.rows[0]?.n).toBe("1"); // "retry safely" would have been a lie
  });

  it("DSOR-RP-01c: the connection the adapter handed back after the dead COMMIT carries no company", async () => {
    useDatabase(overPool(withACommitThatDies(false)));
    await audit(aDecision("req_commit"));

    // The real pool has two connections; ask both, by holding one while asking the other.
    const first = await application.connect();

    try {
      const a = await first.query<{ said: string | null }>(
        "SELECT current_setting('dsor.tenant_id', true) AS said",
      );
      const b = await application.query<{ said: string | null }>(
        "SELECT current_setting('dsor.tenant_id', true) AS said",
      );

      expect(a.rows[0]?.said ?? "").toBe("");
      expect(b.rows[0]?.said ?? "").toBe("");
    } finally {
      first.release();
    }
  });
});
