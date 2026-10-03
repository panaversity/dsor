// NEW IN STEP 09: who the program connects as.
//
// These tests exist because 280 others did not catch the thing they catch. `002_runtime_user.sql`
// takes UPDATE, DELETE and TRUNCATE away from `dsor_runtime`, and `audit-permissions.test.ts`
// proved it — by running `SET ROLE dsor_runtime` first. The program never ran that line. It opened
// the database as `postgres`, a superuser, and a superuser is allowed everything regardless of any
// GRANT. The log the demo wrote was fully rewritable by the demo.
//
// A test that borrows the right identity proves the GRANT. Only a test that uses the program's own
// connection proves the program.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { APPLICATION_ROLE, openTheDatabase, refuseIfItCanRewriteHistory } from "../src/database.ts";
import { audit, theLog, type Database } from "../src/audit.ts";
import { aDatabase } from "./support/database.ts";

/** A throwaway directory, so these tests never touch the demo database `pnpm start` keeps. */
let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "dsor-db-test-"));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** What the connection the program is holding says about itself. */
async function identity(db: Database): Promise<{
  who: string;
  superuser: boolean;
  update: boolean;
  del: boolean;
  truncate: boolean;
}> {
  const { rows } = await db.query<{
    who: string;
    superuser: boolean;
    update: boolean;
    del: boolean;
    truncate: boolean;
  }>(
    `SELECT current_user AS who,
            COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS superuser,
            has_table_privilege(current_user, 'public.audit', 'UPDATE')   AS update,
            has_table_privilege(current_user, 'public.audit', 'DELETE')   AS del,
            has_table_privilege(current_user, 'public.audit', 'TRUNCATE') AS truncate`,
  );

  return rows[0]!;
}

describe("the identity the program itself connects as", () => {
  it("DSOR-AUD-04a: the program does not run as a superuser", async () => {
    const opened = await openTheDatabase(folder);

    // Asked through the module the program writes its log with, not through a fresh connection:
    // a fresh connection would be a different session, and `SET ROLE` is per session.
    const me = await identity(opened.connection);

    expect(me.who).toBe(APPLICATION_ROLE);
    expect(me.superuser).toBe(false);

    await opened.close();
  });

  it("DSOR-AUD-04a: the program's own connection may not UPDATE, DELETE or TRUNCATE the log", async () => {
    const opened = await openTheDatabase(folder);
    const db = opened.connection;
    const me = await identity(db);

    expect([me.update, me.del, me.truncate]).toStrictEqual([false, false, false]);

    // And not only according to `has_table_privilege`: actually attempted, and actually refused.
    for (const forbidden of [
      "UPDATE audit SET result = 'rewritten'",
      "DELETE FROM audit",
      "TRUNCATE audit",
    ]) {
      await expect(db.query(forbidden)).rejects.toThrow(/permission denied/i);
    }

    await opened.close();
  });

  it("DSOR-AUD-01: the application's account can still do the program's actual job", async () => {
    // The fix would be worthless if it took away a right the program needs. INSERT and SELECT are
    // all `recordDecision` and `theLog` use, and this is what says so.
    const opened = await openTheDatabase(folder);

    await audit({
      kind: "decision",
      subject: "user_123",
      requestId: "req_1",
      operation: "invoice.get@1",
      authorization: "ALLOW",
      result: "OK",
    });

    const log = await theLog();

    expect(log).toHaveLength(1);
    expect(log[0]?.identity.subject).toBe("user_123");

    await opened.close();
  });

  it("DSOR-AUD-04a: a second run reaches the same database and is still the application", async () => {
    // The role is set per connection, so it has to be set again on every open. Forgetting that
    // would leave the first run restricted and every later run a superuser.
    const first = await openTheDatabase(folder);
    await audit({
      kind: "decision",
      subject: "user_123",
      requestId: "req_1",
      operation: "invoice.get@1",
      authorization: "ALLOW",
      result: "OK",
    });
    await first.close();

    const second = await openTheDatabase(folder);
    const me = await identity(second.connection);

    expect(me.who).toBe(APPLICATION_ROLE);
    expect(await theLog()).toHaveLength(1);

    await second.close();
  });

  it("the program says which account it is using, so a reader is not guessing", async () => {
    const opened = await openTheDatabase(folder);

    expect(opened.where).toContain(APPLICATION_ROLE);

    await opened.close();
  });
});

describe("refuseIfItCanRewriteHistory", () => {
  it("DSOR-AUD-04a: refuses a connection that may rewrite the audit table", async () => {
    // The owner's connection, which is what the program used to hold.
    const db = await aDatabase();

    await expect(refuseIfItCanRewriteHistory(db)).rejects.toThrow(
      /may UPDATE, DELETE, TRUNCATE the audit table/,
    );
    // And it says what to do about it, not only that something is wrong.
    await expect(refuseIfItCanRewriteHistory(db)).rejects.toThrow(/DSOR_DB_URL/);

    await db.close();
  });

  it("DSOR-AUD-04a: a superuser who owns nothing is caught, though no GRANT names it", async () => {
    // This is the case a privilege *listing* misses, and I had the reason wrong until I measured
    // it. `information_schema.table_privileges` does carry a row for the table's OWNER, so a
    // listing catches `postgres`. What it has no row for is a superuser who owns nothing — and
    // that role may still do everything, because superuser bypasses every privilege check.
    //
    //   owner (postgres):      listed grants = 1   has_table_privilege = true
    //   superuser, not owner:  listed grants = 0   has_table_privilege = true   <-- the gap
    //   dsor_runtime:          listed grants = 0   has_table_privilege = false
    //
    // So the check asks `has_table_privilege` and not the catalogue. Measured 2026-10-04.
    const db = await aDatabase();

    await db.exec("CREATE ROLE auditor_gone_rogue WITH SUPERUSER;");
    await db.exec("SET ROLE auditor_gone_rogue");

    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.table_privileges
       WHERE table_name = 'audit' AND grantee = current_user AND privilege_type = 'UPDATE'`,
    );

    expect(rows[0]?.n).toBe(0); // no GRANT anywhere names this role...
    await expect(refuseIfItCanRewriteHistory(db)).rejects.toThrow(/may UPDATE/); // ...and it may.

    await db.close();
  });

  it("DSOR-AUD-04a: accepts the application's account", async () => {
    const db = await aDatabase();

    await db.exec(`SET ROLE ${APPLICATION_ROLE}`);

    await expect(refuseIfItCanRewriteHistory(db)).resolves.toBeUndefined();

    await db.close();
  });

  it("DSOR-AUD-04a: a database that answers nothing is refused, not trusted", async () => {
    // Fail closed. An unanswered question about a guarantee is not a yes.
    const silent: Database = {
      query: async <T>() => ({ rows: [] as T[] }),
    };

    await expect(refuseIfItCanRewriteHistory(silent)).rejects.toThrow(/did not say who/);
  });

  it("DSOR-AUD-04a: a right reached through role membership is caught too", async () => {
    // `dsor_runtime` has no UPDATE of its own. Make it a member of a role that does, and
    // `has_table_privilege` follows the membership — which is why the check asks PostgreSQL
    // instead of reading the GRANT list.
    const db = await PGlite.create();

    await db.exec("CREATE ROLE dsor_runtime;");
    await db.exec("CREATE TABLE audit (result TEXT);");
    await db.exec("CREATE ROLE editor;");
    await db.exec("GRANT UPDATE ON audit TO editor;");
    await db.exec("GRANT editor TO dsor_runtime;");
    await db.exec(`SET ROLE ${APPLICATION_ROLE}`);

    await expect(refuseIfItCanRewriteHistory(db)).rejects.toThrow(/may UPDATE/);

    await db.close();
  });
});
