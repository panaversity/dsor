// STEP 09: who the program connects as.
//
// These tests exist because 280 others did not catch the thing they catch. `002_runtime_user.sql`
// takes UPDATE, DELETE and TRUNCATE away from `dsor_runtime`, and `audit-permissions.test.ts`
// proved it — by running `SET ROLE dsor_runtime` first. The program never ran that line. It opened
// the database as `postgres`, a superuser, and a superuser is allowed everything regardless of any
// GRANT. The log the demo wrote was fully rewritable by the demo.
//
// A test that borrows the right identity proves the GRANT. Only a test that uses the program's own
// connection proves the program.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import {
  APPLICATION_ROLE,
  openTheDatabase,
  refuseIfItCanRewriteHistory,
  withoutCredentials,
} from "../src/database.ts";
import { audit, theLog, type Database } from "../src/audit.ts";
import { aDatabase } from "./support/database.ts";

/** A throwaway directory, so these tests never touch the demo database `pnpm start` keeps. */
let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "dsor-db-test-"));

  // Pinned to the on-disk route. `openTheDatabase` reads `DSOR_DB_URL` before it looks at `folder`,
  // so with that variable exported in the shell these tests would silently run against whatever
  // server it names — writing real rows into a shared audit log and proving things about that
  // server instead of about the route they are named after. A review measured it: with a bogus
  // URL exported, five of these tests failed inside `openTheDatabase`; with a valid one, three
  // would have written to the real table. `pnpm check` does not read `.env`, so only an exported
  // variable reaches here — which a `source .env`, direnv, or a CI secret would do.
  vi.stubEnv("DSOR_DB_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
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

    // The route this file is about, asserted rather than assumed — by the display string a reader
    // sees, and by the fact behind it: the on-disk route writes PostgreSQL's files into `folder`.
    expect(opened.where).toContain("on disk");
    expect(readdirSync(folder).length).toBeGreaterThan(0);
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
      tenant: "org_456",
      requestId: "req_1",
      operation: "invoice.get@1",
      authorization: "ALLOW",
      result: "OK",
    });

    const log = await theLog("org_456");

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
      tenant: "org_456",
      requestId: "req_1",
      operation: "invoice.get@1",
      authorization: "ALLOW",
      result: "OK",
    });
    await first.close();

    const second = await openTheDatabase(folder);
    const me = await identity(second.connection);

    expect(me.who).toBe(APPLICATION_ROLE);
    expect(await theLog("org_456")).toHaveLength(1);

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

  it("accepts the application's account", async () => {
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

  it("DSOR-AUD-04a: an answer that is neither true nor false is refused, not read as false", async () => {
    // `a OR b OR c` in SQL is NULL when any operand is NULL and the rest are false. A guard written
    // `if (answer.may)` reads NULL — or a missing column — as "may not", which is the one branch
    // here that fails open. The sibling test above covers no row at all; this covers a row that
    // does not answer the question.
    for (const evasive of [
      { who: "x" },
      { who: "x", may: null },
      { who: "x", may: undefined },
      { who: "x", may: false, may_by_set_role: null },
      { who: "x", may: false, may_by_set_role: false, may_by_function: null, has_trigger: false },
      { who: "x", may: false, may_by_set_role: false, may_by_function: false },
      { may: false, may_by_set_role: false, may_by_function: false, has_trigger: false }, // no `who`
    ]) {
      const db: Database = {
        query: async <T>() => ({ rows: [evasive as T] }),
      };

      await expect(refuseIfItCanRewriteHistory(db), JSON.stringify(evasive)).rejects.toThrow();
    }
  });

  it("DSOR-AUD-04a: a right one SET ROLE away is caught, though no privilege check can see it", async () => {
    // `GRANT editor TO dsor_runtime WITH INHERIT FALSE`: the application holds nothing itself, and
    // `has_table_privilege` says so — truthfully. It is also one `SET ROLE editor` away from UPDATE.
    // A review measured the sequence: privilege check false, SET ROLE, UPDATE succeeded.
    // `pg_has_role(current_user, role, 'MEMBER')` sees membership whether or not it is inherited.
    const db = await PGlite.create();

    await db.exec("CREATE ROLE dsor_runtime;");
    await db.exec("CREATE TABLE audit (result TEXT);");
    await db.exec("CREATE ROLE editor;");
    await db.exec("GRANT UPDATE ON audit TO editor;");
    await db.exec("GRANT editor TO dsor_runtime WITH INHERIT FALSE;");
    await db.exec(`SET ROLE ${APPLICATION_ROLE}`);

    // Not testing nothing: the privilege check alone really does say "may not".
    const { rows } = await db.query<{ may: boolean }>(
      "SELECT has_table_privilege(current_user, 'public.audit', 'UPDATE') AS may",
    );

    expect(rows[0]?.may).toBe(false);

    await expect(refuseIfItCanRewriteHistory(db)).rejects.toThrow(/SET ROLE away/);

    await db.close();
  });

  it("DSOR-AUD-04a: a SECURITY DEFINER function that can rewrite the log is caught", async () => {
    // The owner writes a helper. It runs with the owner's rights, and EXECUTE on it goes to PUBLIC
    // by default. The application holds no privilege on the table and the privilege check says so —
    // and one `SELECT rewrite(...)` changes a row. Measured before the check existed:
    //
    //     privilege says: may=false       after SECURITY DEFINER call, result = REWRITTEN
    const db = await aDatabase();

    await db.exec(`CREATE FUNCTION rewrite(t text) RETURNS void LANGUAGE sql SECURITY DEFINER
                   AS $$ UPDATE public.audit SET result = t $$;`);
    await db.exec(`SET ROLE ${APPLICATION_ROLE}`);

    // Not testing nothing: the privilege check alone really does say "may not".
    const { rows } = await db.query<{ may: boolean }>(
      "SELECT has_table_privilege(current_user, 'public.audit', 'UPDATE') AS may",
    );

    expect(rows[0]?.may).toBe(false);

    await expect(refuseIfItCanRewriteHistory(db)).rejects.toThrow(/SECURITY DEFINER/);

    await db.close();
  });

  it("DSOR-AUD-04a: a SECURITY DEFINER function whose owner cannot rewrite the log is not a reason", async () => {
    // The check is about the owner's rights, not about the keyword. A helper owned by a role with
    // no UPDATE is harmless, and refusing it would be a check that fails closed on everything.
    const db = await aDatabase();

    await db.exec("CREATE ROLE helper_owner;");
    await db.exec(
      `CREATE FUNCTION harmless() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;`,
    );
    await db.exec("ALTER FUNCTION harmless() OWNER TO helper_owner;");
    await db.exec(`SET ROLE ${APPLICATION_ROLE}`);

    await expect(refuseIfItCanRewriteHistory(db)).resolves.toBeUndefined();

    await db.close();
  });

  it("DSOR-AUD-04a: a trigger on the audit table is refused", async () => {
    // Code the owner attached to the table, running inside every INSERT this program makes, with the
    // owner's rights. A BEFORE INSERT trigger rewrites the row on its way in; an AFTER trigger could
    // do anything at all. This step expects none, and says so rather than hoping.
    const db = await aDatabase();

    await db.exec(`CREATE FUNCTION tamper() RETURNS trigger LANGUAGE plpgsql
                   AS $$ BEGIN NEW.result := 'TAMPERED'; RETURN NEW; END $$;
                   CREATE TRIGGER t BEFORE INSERT ON public.audit FOR EACH ROW EXECUTE FUNCTION tamper();`);
    await db.exec(`SET ROLE ${APPLICATION_ROLE}`);

    await expect(refuseIfItCanRewriteHistory(db)).rejects.toThrow(/trigger/);

    await db.close();
  });

  it("DSOR-TEN-01a: an application that may move or delete invoices is refused at start-up", async () => {
    // A critic's next attack: GRANT INSERT, UPDATE, DELETE ON public.invoices TO dsor_runtime and
    // the program started happily, because the check looked at the audit table only.
    for (const grant of [
      "GRANT UPDATE (tenant_id) ON public.invoices TO dsor_runtime",
      "GRANT UPDATE (id) ON public.invoices TO dsor_runtime",
      "GRANT DELETE ON public.invoices TO dsor_runtime",
      "GRANT INSERT ON public.invoices TO dsor_runtime",
    ]) {
      const db = await aDatabase();

      await db.exec(grant);
      await db.exec(`SET ROLE ${APPLICATION_ROLE}`);

      await expect(refuseIfItCanRewriteHistory(db), grant).rejects.toThrow(/invoices/);

      await db.close();
    }
  });

  it("DSOR-AUD-04a: a right reached through inherited role membership is caught too", async () => {
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

describe("what the program prints about where its log is", () => {
  it("the printed location never contains the password, even one with an @ in it", () => {
    // The first mask was `url.replace(/\/\/[^@]*@/, "//…@")`, and `pa@ss-word` came out as
    // `…@ss-word@host`. `main.ts` prints this line. Parsing as a URL takes the last `@` as the
    // delimiter, the way the driver does.
    const shown = withoutCredentials(
      "postgres://neon_user:pa@ss-word@ep-1.neon.tech/dsor?sslmode=require",
    );

    expect(shown).toBe("postgres://…@ep-1.neon.tech/dsor");
    expect(shown).not.toContain("neon_user");
    expect(shown).not.toContain("ss-word");
    expect(withoutCredentials("not a url at all")).not.toContain("not a url");
  });
});

describe("the one door to the audit log's database", () => {
  it("DSOR-AUD-04a: nothing in src/ points the log at a connection except openTheDatabase", () => {
    // `refuseIfItCanRewriteHistory` runs inside `openTheDatabase` and nowhere else. `useDatabase`
    // itself checks nothing — the tests hand it the owner's connection on purpose. So the guarantee
    // is only as wide as the set of call sites, and this is what keeps that set at one.
    //
    // Counted as an identifier, every file, every depth — not as a statement-position call. The
    // first version matched `^\s*useDatabase\(` one directory deep, and two reviewers planted
    // `const point = useDatabase; point(db)`, `log.useDatabase(db)`, `() => useDatabase(db)`,
    // `void useDatabase(db)` and a file in a subdirectory past it. An identifier count cannot be
    // dodged by any of those; only `audit["use" + "Database"]` would, and that is not a shape anyone
    // writes by accident. The exact numbers are pinned so a new mention anywhere is a visible act:
    // NEW IN STEP 10: store.ts holds the definition now, its error string, and one comment, because
    // the invoices needed the same handle; audit.ts holds the re-export and one comment; database.ts
    // holds the import, its two calls, and one comment that names the function. A comment counts, on purpose — the number
    // is a tripwire, not a measure of doors, and a tripwire that ignores comments is one a comment
    // can be used to hide behind.
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const mentions: Record<string, number> = {};

    for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }

      const path = join(entry.parentPath, entry.name);
      const count = readFileSync(path, "utf8").match(/\buseDatabase\b/g)?.length ?? 0;

      if (count > 0) {
        mentions[path.slice(src.length + 1)] = count;
      }
    }

    expect(mentions).toStrictEqual({ "audit.ts": 2, "database.ts": 4, "store.ts": 4 });
  });
});
