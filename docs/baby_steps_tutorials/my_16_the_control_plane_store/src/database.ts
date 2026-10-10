// STEP 09: where the program's database comes from, and who it connects as.
//
// Two shapes, and the program does not care which it gets, because both run the same SQL.
//
//   - `DSOR_DB_URL` is set: connect to it. That is Neon, or any PostgreSQL. This is the real thing,
//     and the connection string lives in `.env`, which is in `.gitignore` and never committed.
//   - nothing is set: open a PostgreSQL **on disk, in this folder**, through PGlite.
//
// The second is not a fallback to pretending. PGlite is the PostgreSQL engine compiled to
// WebAssembly, and pointed at a directory it keeps its data there — so `pnpm start` twice shows the
// log from the first run still present in the second. That is step 09's whole claim, demonstrated by
// running the program rather than asserted in a README.
//
// WHO THE PROGRAM IS matters as much as which database it opens, and this is the part I got wrong
// first. `002_runtime_user.sql` takes UPDATE and DELETE away from `dsor_runtime`, and the tests
// proved that works — but they proved it by running `SET ROLE dsor_runtime` themselves. The program
// never did. On the PGlite route it opened the database as `postgres`, a superuser, and a superuser
// is allowed everything no matter what any GRANT says. So the audit log the demo wrote was fully
// rewritable by the demo, and 280 green tests did not notice, because not one of them asked who the
// program had connected as. `becomeTheApplication` and `refuseIfItCanRewriteHistory` below are the
// fix, and `test/database.test.ts` is the test that would have caught it.

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { applyMigrations, type Runner } from "./migrations.ts";
import { useDatabase, type Database } from "./audit.ts";

/**
 * STEP 11: PGlite, as a connection that can say the company.
 *
 * A statement with a company runs inside `db.transaction`, which is a real BEGIN … COMMIT on
 * PGlite's one connection, with `set_config(…, true)` as its first statement — `true` meaning
 * "until this transaction ends". A statement with none runs plainly. Nothing else changes: the
 * SQL, the parameters and the rows are passed through untouched.
 */
export function overPGlite(db: PGlite): Database {
  return {
    query: <T>(sql: string, params?: unknown[], tenant?: string): Promise<{ rows: T[] }> =>
      tenant === undefined
        ? db.query<T>(sql, params)
        : db.transaction(async (tx) => {
            await tx.query("SELECT set_config('dsor.tenant_id', $1, true)", [tenant]);

            return tx.query<T>(sql, params);
          }),
  };
}

/**
 * STEP 11: a `pg` pool, as a connection that can say the company.
 *
 * This is where the second trap on the map lives. `pool.query` hands each statement to whichever
 * connection is free, so a company set on one connection would be met again by a stranger's
 * statement later. A statement with a company therefore takes one connection out of the pool,
 * opens a transaction on it, says the company for that transaction only, runs, commits, and hands
 * the connection back — clean, because the setting died with the transaction.
 */
export function overPool(pool: Pool): Database {
  return {
    async query<T>(sql: string, params?: unknown[], tenant?: string): Promise<{ rows: T[] }> {
      if (tenant === undefined) {
        const plain = await pool.query(sql, params);

        return { rows: plain.rows as T[] };
      }

      const client = await pool.connect();
      let dead = false;

      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('dsor.tenant_id', $1, true)", [tenant]);

        const result = await client.query(sql, params);

        await client.query("COMMIT");

        return { rows: result.rows as T[] };
      } catch (failure) {
        // A statement the server refused leaves a usable connection in an aborted transaction;
        // ROLLBACK clears it. A connection that is gone cannot even do that, and is discarded
        // rather than returned to the pool for the next statement to find.
        try {
          await client.query("ROLLBACK");
        } catch {
          dead = true;
        }

        throw failure;
      } finally {
        client.release(dead);
      }
    },
  };
}

/** Where the on-disk demo database lives. In .gitignore: it is this machine's, not the project's. */
const LOCAL = fileURLToPath(new URL("../.local-database", import.meta.url));

/** The account the application runs as. Created by a human on a real server; see the README. */
export const APPLICATION_ROLE = "dsor_runtime";

/** The three rights that would let the program rewrite its own history. */
const FORBIDDEN = ["UPDATE", "DELETE", "TRUNCATE"] as const;

/**
 * Stop the program if the connection it is about to use holds UPDATE, DELETE or TRUNCATE on
 * `dsor.audit`.
 *
 * That sentence is narrower than "could rewrite the audit log" on purpose. `has_table_privilege`
 * answers for the *privilege*, not for every *route* to the effect: a `SECURITY DEFINER` function
 * or a trigger owned by the table's owner would rewrite rows on the application's behalf, and this
 * check would stay green. No such function exists today, and `EXECUTE` on a new one goes to
 * `PUBLIC` by default — so the first helper a later migration adds is the moment to remember this.
 *
 * This asks PostgreSQL, not the migration file and not a GRANT listing: `has_table_privilege`
 * answers for the role the program is actually connected as, and it counts every route to the
 * right — a direct GRANT, a grant to `PUBLIC`, a right inherited through role membership, and
 * being a superuser, which is the one a `SELECT ... FROM information_schema.table_privileges`
 * query misses completely.
 *
 * A connection string that points at the table's owner is a configuration mistake, not a
 * preference, so the program refuses to start rather than writing a log it could quietly edit.
 */
export async function refuseIfItCanRewriteHistory(db: Database): Promise<void> {
  // STEP 11: both tenant tables exist, asked before anything else, because every question below is
  // about them, and a missing table would turn those answers into NULLs that an evaluation showed
  // the guards could misread. NEW IN STEP 16: asked on its own as well. It was a column of the
  // query below, which also asks `has_table_privilege(…, 'dsor.audit', …)`, and that is an error
  // for a name that is not there: on a server that missed migration 008, a review measured
  // `schema "dsor" does not exist`, and the words below never appeared. `to_regclass` says NULL.
  const { rows: present } = await db.query<{ tables_present: boolean }>(
    `SELECT to_regclass('public.invoices') IS NOT NULL AND to_regclass('dsor.audit') IS NOT NULL
              AS tables_present`,
  );

  // No row at all is a question not answered, and is refused as that, like the one below.
  if (present[0] === undefined) {
    throw new Error(
      "the database did not say whether the tenant tables exist, so nothing it says about them " +
        "can be trusted; refusing to start",
    );
  }

  if (present[0].tables_present !== true) {
    throw new Error(
      `a tenant table is missing: public.invoices and dsor.audit must both exist before the ` +
        `program runs. Apply the migrations.`,
    );
  }

  const held = (role: string): string =>
    FORBIDDEN.map((p) => `has_table_privilege(${role}, 'dsor.audit', '${p}')`).join(" OR ");
  const { rows } = await db.query<{
    who: string;
    may: boolean;
    may_by_set_role: boolean;
    may_by_function: boolean;
    has_trigger: boolean;
  }>(
    `SELECT current_user AS who,
            ${held("current_user")} AS may,
            EXISTS (
              SELECT 1 FROM pg_roles r
              WHERE r.rolname <> current_user
                AND pg_has_role(current_user, r.oid, 'MEMBER')
                AND (${held("r.oid")})
            ) AS may_by_set_role,
            EXISTS (
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.prosecdef
                AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                -- Whoever may call it. This asked \`has_function_privilege(current_user, …,
                -- 'EXECUTE')\` until an evaluation measured three ways round that: EXECUTE held
                -- through an INHERIT FALSE membership, an aggregate whose transition function is
                -- the helper, and a trigger that fires it under the application's own UPDATE. A
                -- helper whose owner skips the lock is refused for existing, not for being callable.
                AND (
                  (${held("p.proowner")})
                  -- STEP 11: or an owner the second lock does not apply to. A helper owned
                  -- by a BYPASSRLS role reads every company's rows while holding no right the
                  -- checks above would see; a review measured it. The owner of a tenant table, or
                  -- a member of it, may drop the policy from inside the helper.
                  OR EXISTS (SELECT 1 FROM pg_roles o WHERE o.oid = p.proowner
                              AND (o.rolsuper OR o.rolbypassrls))
                  OR EXISTS (SELECT 1 FROM pg_class c
                              WHERE c.oid IN (to_regclass('public.invoices'), to_regclass('dsor.audit'))
                                AND pg_has_role(p.proowner, c.relowner, 'MEMBER'))
                  -- NEW IN STEP 16: or of the schema one is in, who may drop the table from inside
                  -- the helper. A review measured the owner of dsor dropping the log.
                  OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                              WHERE c.oid IN (to_regclass('public.invoices'), to_regclass('dsor.audit'))
                                AND pg_has_role(p.proowner, ns.nspowner, 'MEMBER'))
                )
            ) AS may_by_function,
            EXISTS (
              SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid IN (to_regclass('public.invoices'), to_regclass('dsor.audit'))
                AND NOT t.tgisinternal
            ) AS has_trigger`,
  );

  const answer = rows[0];

  // No row at all means the question was not answered, and an unanswered question about a
  // guarantee is not a yes. Fail closed (AGENTS.md: never weaken a guarantee to simplify). A row
  // that does not say who it is answered a different question, and is refused the same way.
  if (answer === undefined || typeof answer.who !== "string") {
    throw new Error(
      "the database did not say who this connection is, so the audit log cannot be trusted to be " +
        "append-only; refusing to start",
    );
  }

  // `!== false`, not truthiness. `a OR b OR c` in SQL is NULL when any operand is NULL and the rest
  // are false, and a NULL read as "may not" would be the one branch here that fails open.
  if (answer.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, which may ${FORBIDDEN.join(", ")} the audit table. ` +
        `An append-only log kept by an account that can rewrite it is not append-only. Point ` +
        `DSOR_DB_URL at the \`${APPLICATION_ROLE}\` account, not at the owner. ` +
        `See migrations/002_runtime_user.sql.`,
    );
  }

  // The route `has_table_privilege` cannot see. A role granted `WITH INHERIT FALSE` membership of a
  // role that may UPDATE holds nothing itself — and is one `SET ROLE` away from holding everything.
  // `pg_has_role(…, 'MEMBER')` answers for membership whether or not it is inherited. A hostile
  // review measured the hole: privilege check false, `SET ROLE editor`, `UPDATE audit` succeeded.
  if (answer.may_by_set_role !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, which is a member of a role that may ` +
        `${FORBIDDEN.join(", ")} the audit table — one SET ROLE away from rewriting it. ` +
        `Revoke that membership from \`${APPLICATION_ROLE}\`.`,
    );
  }

  // The two routes no privilege check sees, because they are not privileges. A SECURITY DEFINER
  // function runs with its *owner's* rights, and `EXECUTE` on a new function goes to PUBLIC by
  // default — so the first helper a later migration adds would let the application rewrite the log
  // while holding nothing. Measured: privilege check false, `SELECT rewrite('REWRITTEN')`, row
  // changed. And a trigger on the table is code the owner attached that runs inside every INSERT
  // this program makes, with the owner's rights; this program expects none. Both were README limit
  // 3 for a day, as routes the check "would not notice". Now it does, and a later step that wants
  // either has to come here and say so.
  if (answer.may_by_function !== false) {
    throw new Error(
      `there is a SECURITY DEFINER function whose owner may ${FORBIDDEN.join(", ")} the audit ` +
        `table, skips the row-level lock, or owns a tenant table or the schema it is in — a ` +
        `rewrite, a read or a drop by proxy for whoever reaches it, through a grant, a membership, ` +
        `an aggregate or a trigger. This program expects no such helper. Drop the function, or ` +
        `give it an owner that holds nothing.`,
    );
  }

  if (answer.has_trigger !== false) {
    throw new Error(
      `a tenant table has a trigger on it, and this program expects none: code attached to the ` +
        `log or the invoices runs inside this program's own statements with its owner's rights — ` +
        `an evaluation measured a trigger on the invoices smuggling every company's rows out ` +
        `through the application's own UPDATE. Drop the trigger, or change this check deliberately.`,
    );
  }

  // STEP 10: the invoices table too. The application may change an invoice's status and
  // nothing else — a row's company and number are its identity (DSOR-TEN-01a) — and it may neither
  // add nor remove rows. An administrator who grants more has made the same kind of mistake as
  // pointing DSOR_DB_URL at the owner, and a critic's next attack was exactly that grant.
  const { rows: invoices } = await db.query<{ may: boolean }>(
    `SELECT has_column_privilege(current_user, 'public.invoices', 'tenant_id', 'UPDATE')
         OR has_column_privilege(current_user, 'public.invoices', 'id', 'UPDATE')
         OR has_table_privilege(current_user, 'public.invoices', 'INSERT')
         OR has_table_privilege(current_user, 'public.invoices', 'DELETE')
         OR has_table_privilege(current_user, 'public.invoices', 'TRUNCATE') AS may`,
  );

  if (invoices[0]?.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may move, renumber, add or delete invoices. ` +
        `The application may change an invoice's status and nothing else. See ` +
        `migrations/003_invoices.sql.`,
    );
  }

  // STEP 11: the questions no privilege check answers.
  //
  // Everything above asks what the connection MAY DO. Row-level security can be skipped by an
  // account that may do nothing extra at all: BYPASSRLS is a property of the role, not a right on
  // a table, so every check above says "may not" while every policy does nothing. Measured before
  // this check existed — `ALTER ROLE dsor_runtime BYPASSRLS`, same grants, and the forgotten
  // query came back with both companies. A superuser skips the policies too, and is already
  // refused above, because a superuser may UPDATE.
  //
  // `bypassing_roles` is the third trap on the map. A role made in Neon's Console is a member of
  // `neon_superuser`, which holds BYPASSRLS. Measured 2026-10-06: the member is still filtered,
  // because PostgreSQL passes privileges through membership and never attributes — and it is one
  // `SET ROLE neon_superuser` away from not being, exactly step 09's `editor` hole again.
  //
  // `owns_tenant_table` is the rule's own words. Direct ownership is caught above, since an owner
  // may do everything to its table; ownership one SET ROLE away (`WITH INHERIT FALSE`) is not, and
  // the owner may drop the policy. `locked` is the lock itself: a program that relies on the
  // database to hide rows, run against a database where it does not, would leak quietly.
  //
  // `locked` asks for the one policy the migration wrote, word for word, and nothing beside it.
  // "Is there a policy" was the first version, and a review measured why it is not enough:
  // policies are permissive and OR'd together, so one more that says `true` — for everyone, or
  // `TO dsor_runtime` — opens the table while "is there a policy" still says yes. The expressions
  // are compared as PostgreSQL prints them back, so a server that printed them differently would
  // refuse to start rather than let an unchecked policy through. And `reads_beyond` is the view
  // trap the same review measured: a view runs with its owner's rights, and its owner skips the
  // lock, so a view over the invoices shows every company to whoever may SELECT from it. The
  // application may read the two tenant tables and nothing else.
  const { rows: lock } = await db.query<{
    bypasses: boolean;
    bypassing_roles: string | null;
    owns_tenant_table: boolean;
    owns_schema: string | null;
    creates_in: string | null;
    locked: boolean;
    reads_beyond: string | null;
    already_said: string | null;
  }>(
    `WITH tenant_table (rel, col) AS (
       VALUES (to_regclass('public.invoices'), 'tenant_id'), (to_regclass('dsor.audit'), 'tenant')
     ),
     policy_text (rel, qual) AS (
       SELECT rel, '(' || col || ' = current_setting(''dsor.tenant_id''::text, true))' FROM tenant_table
     )
     SELECT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses,
            (SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) FROM pg_roles r
              WHERE r.rolname <> current_user
                AND pg_has_role(current_user, r.oid, 'MEMBER')
                AND r.rolbypassrls) AS bypassing_roles,
            EXISTS (
              SELECT 1 FROM pg_class c JOIN tenant_table t ON t.rel = c.oid
              WHERE pg_has_role(current_user, c.relowner, 'MEMBER')
            ) AS owns_tenant_table,
            -- NEW IN STEP 16: the schema each tenant table is in, and who owns it (decision 123).
            (SELECT string_agg(ns.nspname, ', ' ORDER BY ns.nspname)
               FROM pg_class c JOIN tenant_table t ON t.rel = c.oid
               JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE pg_has_role(current_user, ns.nspowner, 'MEMBER')) AS owns_schema,
            -- NEW IN STEP 16: the schemas it may create things in, itself or one SET ROLE away.
            (SELECT string_agg(DISTINCT ns.nspname, ', ' ORDER BY ns.nspname)
               FROM pg_namespace ns CROSS JOIN pg_roles r
              WHERE ns.nspname IN ('dsor', 'public')
                AND pg_has_role(current_user, r.oid, 'MEMBER')
                AND has_schema_privilege(r.oid, ns.oid, 'CREATE')) AS creates_in,
            (SELECT bool_and(
                c.relrowsecurity AND c.relforcerowsecurity
                AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) = 1
                AND EXISTS (
                  SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = c.oid
                    AND p.polcmd = '*' AND p.polpermissive AND p.polroles = '{0}'::oid[]
                    AND pg_get_expr(p.polqual, p.polrelid) = pt.qual
                    AND pg_get_expr(p.polwithcheck, p.polrelid) = pt.qual
                ))
               FROM pg_class c JOIN policy_text pt ON pt.rel = c.oid) AS locked,
            (SELECT string_agg(ns.nspname || '.' || c.relname, ', ' ORDER BY 1)
               FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
                AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
                AND ns.nspname NOT LIKE 'pg_toast%'
                -- A session's own temporary relations are its own: a temp view runs with the
                -- rights of whoever made it, which is the application, and is filtered like it.
                AND ns.nspname NOT LIKE 'pg_temp%'
                -- NOT EXISTS, not NOT IN: a NULL in a NOT IN list makes every row false.
                AND NOT EXISTS (SELECT 1 FROM tenant_table t WHERE t.rel = c.oid)
                AND has_table_privilege(current_user, c.oid, 'SELECT')) AS reads_beyond,
            -- Nothing said yet. A statement with no company runs with whatever the session holds,
            -- and a session that already holds a company — a pooler that set it, an administrator's
            -- ALTER ROLE … SET — would hand every plain statement that company's rows.
            NULLIF(current_setting('dsor.tenant_id', true), '') AS already_said`,
  );
  const second = lock[0];

  if (second?.bypasses !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, which holds BYPASSRLS: PostgreSQL skips every ` +
        `row-level policy for it, and the second lock does nothing. ALTER ROLE ${answer.who} ` +
        `NOBYPASSRLS, or point DSOR_DB_URL at an account without it.`,
    );
  }

  if (second.bypassing_roles !== null) {
    throw new Error(
      `this connection is \`${answer.who}\`, a member of \`${second.bypassing_roles}\`, which ` +
        `holds BYPASSRLS — one SET ROLE away from skipping every row-level policy. On Neon, a role ` +
        `made in the Console is a member of neon_superuser; create \`${APPLICATION_ROLE}\` with ` +
        `SQL instead, and revoke the membership.`,
    );
  }

  if (second.owns_tenant_table !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, which owns, or may become the owner of, a tenant ` +
        `table. An owner may drop the lock on its own table. Tenant tables belong to the account ` +
        `that runs the migrations, never to \`${APPLICATION_ROLE}\`.`,
    );
  }

  // NEW IN STEP 16: the schemas the tenant tables are in. A schema's owner may drop any table in
  // it, even one it does not own, and nothing here asked who owns them: a review handed `dsor` to
  // the application, start-up passed, and one DROP TABLE erased every record (decision 123).
  if (second.owns_schema !== null) {
    throw new Error(
      `this connection is \`${answer.who}\`, which owns, or may become the owner of, the schema ` +
        `\`${second.owns_schema}\`, where a tenant table is kept. A schema's owner may drop any ` +
        `table in it, even one it does not own, and every row goes with it. Schemas belong to the ` +
        `account that runs the migrations, never to \`${APPLICATION_ROLE}\`.`,
    );
  }

  // NEW IN STEP 16: and it may create nothing in them. Only the migrations put tables there: one the
  // application made would be its own, every row of it, and a later step's migration would find
  // its name taken. Migration 008 takes CREATE on dsor back; this asks PostgreSQL, because a grant
  // made after the migrations passes them by (decision 123).
  if (second.creates_in !== null) {
    throw new Error(
      `this connection is \`${answer.who}\`, which may create tables, views or functions in the ` +
        `schema \`${second.creates_in}\`, itself or one SET ROLE away. Only the migrations put ` +
        `things there: a table the application made would be its own, every row of it. Revoke ` +
        `CREATE on the schema from \`${APPLICATION_ROLE}\`; see ` +
        `migrations/008_the_control_plane_store.sql.`,
    );
  }

  if (second.locked !== true) {
    throw new Error(
      `the second lock is not on: public.invoices and dsor.audit must each have row-level ` +
        `security enabled, forced, and exactly the one policy migrations/005_row_level_security.sql ` +
        `writes — no other policy beside it, and none that reads differently.`,
    );
  }

  if (second.already_said !== null) {
    throw new Error(
      `this connection already carries a company, \`${second.already_said}\`, before any statement ` +
        `said one. A company is said per statement and dies with it; a session that holds one ` +
        `would hand it to every statement that said none. Clear the setting on the role and on the ` +
        `pooler.`,
    );
  }

  if (second.reads_beyond !== null) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may read \`${second.reads_beyond}\`, which is ` +
        `not one of the two tenant tables. A view or a table beside them is a window past the ` +
        `lock: a view runs with its owner's rights, and a table without a policy hides nothing. ` +
        `The application may read public.invoices and dsor.audit, and nothing else.`,
    );
  }
}

/**
 * The connection string with the user and password gone, for printing.
 *
 * This was `url.replace(/\/\/[^@]*@/, "//…@")`, and a review pointed out what a literal `@` in a
 * password does to it: `pa@ss-word` leaves `…@ss-word@host` on stdout, where `main.ts` prints it.
 * Parsing it as a URL takes the last `@` as the delimiter, the way the driver does, and nothing
 * between the scheme and the host is reproduced. A string that is not a URL at all is masked whole.
 */
export function withoutCredentials(url: string): string {
  try {
    const parsed = new URL(url);

    return `${parsed.protocol}//…@${parsed.host}${parsed.pathname}`;
  } catch {
    return "(a connection string that could not be parsed, not shown)";
  }
}

/**
 * Drop from the owner to the application's account, for the rest of this connection.
 *
 * Needed only on the PGlite route, which has no logins at all: it hands out one connection and it
 * belongs to `postgres`. `SET ROLE` is the honest substitute. Be clear about what it is and is not:
 * on a real server the program only ever holds `dsor_runtime`'s password, so the limit is the
 * *server's*, and nothing the program does can lift it. Here the limit is the program's own choice,
 * and a superuser who ran `RESET ROLE` would get everything back. What that choice does prove is
 * that the GRANTs in `002_runtime_user.sql` are enough for the program to do its job and no more —
 * which is exactly what would otherwise go untested until the day it ran against Neon.
 */
async function becomeTheApplication(db: PGlite): Promise<void> {
  await db.exec(`SET ROLE ${APPLICATION_ROLE}`);
}

/**
 * Open the database, make sure the migrations have been applied, and point the audit log at it.
 *
 * Returns how to close it, and where it came from, so the program can say which one it used — a
 * demo that silently used a throwaway database while the reader believed it was Neon would be
 * teaching the opposite of this step.
 *
 * Throws if the connection it ends up with could rewrite the audit log.
 *
 * `folder` overrides where the on-disk database lives. The program never passes it; it is here so
 * that `test/database.test.ts` can open a throwaway directory instead of the one `pnpm start`
 * keeps its demo log in, and so two runs of the tests cannot collide on one directory.
 */
export async function openTheDatabase(folder: string = LOCAL): Promise<{
  readonly where: string;
  readonly close: () => Promise<void>;
  /** The connection the audit log was pointed at — the same session, so `SET ROLE` applies to it. */
  readonly connection: Database;
}> {
  const url = process.env.DSOR_DB_URL;

  if (url !== undefined && url.trim() !== "") {
    // The real thing. One connection, because this program answers one request at a time; a pool of
    // one keeps the shape the same as a pool of many for the day it needs one.
    // One connection, and a statement with a company holds it from BEGIN to COMMIT. So a store
    // must never await one statement inside another, or the second waits for the first forever;
    // the timeout turns that mistake into an error the pipeline can map, instead of a silent hang.
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5_000 });
    const connection = overPool(pool);

    // Said rather than assumed. A connection string that is wrong fails here, on the first query,
    // with the driver's own message — not later, inside a decision, as EVIDENCE_STORE_UNAVAILABLE.
    await pool.query("SELECT 1");

    // Before `useDatabase`, so a refused connection never records anything at all.
    try {
      await refuseIfItCanRewriteHistory(connection);
    } catch (wrong) {
      await pool.end();
      throw wrong;
    }

    useDatabase(connection);

    return {
      where: `the PostgreSQL at ${withoutCredentials(url)}`,
      close: () => pool.end(),
      connection,
    };
  }

  mkdirSync(folder, { recursive: true });

  const db = await PGlite.create(folder);

  // The application's account, if it is not there yet. On a real server a human creates this once;
  // here there is nobody to do it, and it is not the lesson — 002_runtime_user.sql is the lesson.
  await db.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APPLICATION_ROLE}') THEN
      CREATE ROLE ${APPLICATION_ROLE} WITH LOGIN PASSWORD 'local-demo-not-a-secret';
    END IF;
  END $$;`);

  // And the migrations, through the same runner `pnpm migrate` uses. This used to ask whether the
  // `audit` table existed and skip everything if it did — which worked for exactly one migration,
  // and would have silently skipped the second the day it was added.
  //
  // Still as the owner: creating a table and taking rights away are the owner's job, and the next
  // line is where the program stops being the owner. Order matters, and getting it backwards would
  // make every migration fail with "permission denied for schema public".
  await applyMigrations(
    db as unknown as Runner,
    fileURLToPath(new URL("../migrations", import.meta.url)),
  );

  await becomeTheApplication(db);

  const connection = overPGlite(db);

  try {
    await refuseIfItCanRewriteHistory(connection);
  } catch (wrong) {
    await db.close();
    throw wrong;
  }

  useDatabase(connection);

  return {
    where: `a PostgreSQL on disk at ${folder.replace(process.cwd(), ".")}, as \`${APPLICATION_ROLE}\``,
    close: () => db.close(),
    connection,
  };
}
