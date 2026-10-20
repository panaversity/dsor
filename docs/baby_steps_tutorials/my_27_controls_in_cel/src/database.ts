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
import type { Statements } from "./store.ts";

/**
 * STEP 22, decision 158: the company, and the turn in one line, said in one statement, the
 * first of the transaction after its isolation level. `pg_advisory_xact_lock` waits until no other transaction holds the same
 * key, then holds it until this transaction ends, commit or rollback: PostgreSQL lets it go, so a
 * program that dies mid-turn cannot keep the line waiting. The key is two numbers, both names
 * hashed: `dsor.audit` for the log's lines, and the line's own name. Two names that hash alike
 * only wait for each other; they never share a turn's statements.
 *
 * Found by a review: and a program that does not die but stalls, or whose network goes quiet
 * without closing, would hold the turn for ever. So the turn also says how long its transaction may
 * sit idle between statements: ten seconds, then PostgreSQL ends the connection and lets the turn
 * go. A turn's own pauses are one round trip each, 127 ms to Neon.
 */
const TAKE_THE_TURN =
  "SELECT set_config('dsor.tenant_id', $1, true), " +
  "set_config('idle_in_transaction_session_timeout', '10s', true), " +
  "pg_advisory_xact_lock(hashtext('dsor.audit'), hashtext($2))";

/**
 * STEP 22, decision 158, found by a review: a turn reads the end of the log after its lock
 * is given, and that read sees the last writer's record only at READ COMMITTED, where each statement
 * takes a fresh snapshot. At REPEATABLE READ the whole transaction would read from the snapshot of its
 * first statement, taken before the wait, and every writer that waited would read an old end. A
 * database or a role can make either the default, so the turn says which it needs.
 */
const AT_READ_COMMITTED = "SET TRANSACTION ISOLATION LEVEL READ COMMITTED";

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

    // STEP 22, decision 158: one transaction for the whole turn. PGlite has one connection and
    // runs one transaction at a time, so nobody else is ever in the line; the lock is still taken, so
    // the tests run the same SQL as the server does. PGlite's BEGIN cannot name an isolation level,
    // so the transaction names it first.
    inTurn: <T>(
      tenant: string,
      line: string,
      work: (statements: Statements) => Promise<T>,
    ): Promise<T> =>
      db.transaction(async (tx) => {
        await tx.query(AT_READ_COMMITTED);
        await tx.query(TAKE_THE_TURN, [tenant, line]);

        return work({ query: <R>(sql: string, params?: unknown[]) => tx.query<R>(sql, params) });
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
  // STEP 22, decision 158, found by a review: the turns this program waits for, one line at
  // a time, before a connection is taken. Waiting for a turn on the database holds a connection, so
  // fifty requests of org_456 would take every connection in the pool to wait, and org_789's next
  // request would wait for one behind them. Here they wait without one, and only the first in the
  // line takes a connection to wait on the database's lock. The line lets it go as soon as the turn
  // before it is taken, not when that turn ends (found by a second review): a turn whose statement
  // never comes back would otherwise hold the line for ever, where the database's lock is let go when
  // the turn has sat idle ten seconds. So a line holds two connections at most, the turn's and the next
  // one's. The lock on the database still keeps two programs on one database in turn.
  const waiting = new Map<string, Promise<void>>();

  // STEP 22, decision 158: a turn on the database is one connection, held from BEGIN to
  // COMMIT, as a statement with a company is below. The turn is taken by the transaction's first
  // statement, with the company, so waiting costs no round trip of its own: on Neon, 127 ms away, each
  // one is a tenth of a second that every writer behind this one waits too.
  async function onTheDatabase<T>(
    tenant: string,
    line: string,
    work: (statements: Statements) => Promise<T>,
    taken: () => void,
  ): Promise<T> {
    const client = await pool.connect();
    let dead = false;
    // A connection the server ends between two statements, as it ends a turn left idle too long,
    // says so as an event, and an event nobody listens for stops the program. The statement after it
    // fails, and the catch below hears of it there.
    const heard = (): void => {};

    client.on("error", heard);

    try {
      // `BEGIN` can name the isolation level, so the server's turn costs no round trip for it.
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query(TAKE_THE_TURN, [tenant, line]);
      // The turn is this transaction's now; the next request in the program's line may go and wait
      // for it on the database.
      taken();

      const result = await work({
        query: async <R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> => {
          const { rows } = await client.query(sql, params);

          return { rows: rows as R[] };
        },
      });

      await client.query("COMMIT");

      return result;
    } catch (failure) {
      // A refused statement leaves an aborted transaction, which ROLLBACK clears and which lets the
      // turn go; a connection that is gone is discarded, and the server lets the turn go when it
      // notices.
      try {
        await client.query("ROLLBACK");
      } catch {
        dead = true;
      }

      throw failure;
    } finally {
      client.off("error", heard);
      client.release(dead);
    }
  }

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

    // STEP 22, decision 158: in the program's line first, in the order the requests came,
    // and then in the database's.
    async inTurn<T>(
      tenant: string,
      line: string,
      work: (statements: Statements) => Promise<T>,
    ): Promise<T> {
      const before = waiting.get(line) ?? Promise.resolve();
      let done = (): void => {};
      const mine = new Promise<void>((resolve) => {
        done = resolve;
      });
      const last = before.then(() => mine);

      waiting.set(line, last);
      await before;

      try {
        return await onTheDatabase(tenant, line, work, done);
      } finally {
        done();

        if (waiting.get(line) === last) {
          waiting.delete(line);
        }
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
 * STEP 17: the tenant tables, each with the column that names its company, in one place.
 *
 * Every question below about "the tenant tables" is asked of this list. It was two names written
 * out in seven places, and step 17 adds two tables: one list is what keeps a new table from being
 * checked in six places and forgotten in the seventh (decision 125).
 */
const TENANT_TABLES: ReadonlyArray<readonly [table: string, column: string]> = Object.freeze([
  ["public.invoices", "tenant_id"],
  ["public.vendors", "tenant_id"],
  ["public.payments", "tenant_id"],
  ["dsor.audit", "tenant"],
  // STEP 18: the permission slips, DSoR's second kind of paperwork (decision 127).
  ["dsor.delegations", "tenant"],
  // STEP 20: the idempotency keys, DSoR's third kind of paperwork (decision 131).
  ["dsor.idempotency_keys", "tenant"],
  // STEP 22: the proposals and their moves, DSoR's fourth kind of paperwork (decision 136).
  ["dsor.proposals", "tenant"],
  ["dsor.proposal_moves", "tenant"],
  // STEP 24: the day totals and the reservations against them (decision 140).
  ["dsor.day_totals", "tenant"],
  ["dsor.reservations", "tenant"],
  // STEP 25: the emergency brake (decision 142).
  ["dsor.agent_controls", "tenant"],
  // NEW IN STEP 27: the company's controls, its policy in CEL (decision 162).
  ["dsor.controls", "tenant"],
]);

/** The tables as SQL, each looked up with `to_regclass`, which says NULL for one that is missing. */
const TENANT_REGCLASSES = TENANT_TABLES.map(([table]) => `to_regclass('${table}')`).join(", ");

/**
 * STEP 17: a question asked of every role this connection is, or can become with SET ROLE.
 * `pg_has_role(…, 'MEMBER')` sees a membership whether or not it is inherited, and a role is a
 * member of itself, so the connection's own rights are asked too (decision 126).
 *
 * STEP 17, decision 148: and of every role it acts as through a helper. A SECURITY DEFINER function
 * runs with its owner's rights, whoever calls it, and the log's question has been asked of those
 * owners since step 09; the business's tables' were not. A review set PAY-901's amount to 1.00
 * through such a helper, with start-up passing. STEP 18: the slips are asked the same way, and a
 * review lifted del_100's limit through a helper before they were (decision 128).
 */
const forAnyRoleItCanActAs = (question: (role: string) => string): string =>
  `(EXISTS (SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user, r.oid, 'MEMBER') AND (${question("r.oid")}))
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                 AND (${question("p.proowner")})))`;

/**
 * STEP 26b: the relations the questions about reading, writing and numbers ask about,
 * chosen by what they are, never by what their schema is called (decision 163). It was three
 * names and two patterns, and a review measured a way past each kind: a view over every company's
 * invoices in `information_schema`, or in a schema named `pgxtemp`, which `LIKE 'pg_temp%'` reads as
 * a temporary schema because `_` matches any character, passed start-up. Now: nothing in
 * `pg_catalog`, where nobody may create; nothing PostgreSQL itself made when the database was
 * created, whose numbers start below 16384, so a view an administrator puts in `information_schema`
 * later is asked about like any other; and not this session's own temporary relations, which run
 * with the application's own rights and are filtered like it.
 */
const MADE_SINCE_THE_DATABASE = `c.relnamespace <> 'pg_catalog'::regnamespace
                AND c.oid >= 16384
                AND c.relnamespace <> pg_my_temp_schema()`;

/** The tables as words, for a refusal. */
const TENANT_TABLE_NAMES = `${TENANT_TABLES.slice(0, -1)
  .map(([table]) => table)
  .join(", ")} and ${TENANT_TABLES.at(-1)?.[0] ?? ""}`;

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
  // the guards could misread. STEP 16: asked on its own as well. It was a column of the
  // query below, which also asks `has_table_privilege(…, 'dsor.audit', …)`, and that is an error
  // for a name that is not there: on a server that missed migration 008, a review measured
  // `schema "dsor" does not exist`, and the words below never appeared. `to_regclass` says NULL.
  const { rows: present } = await db.query<{ tables_present: boolean }>(
    `SELECT ${TENANT_TABLES.map(([table]) => `to_regclass('${table}') IS NOT NULL`).join(" AND ")}
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
      `a tenant table is missing: ${TENANT_TABLE_NAMES} must all exist before the program ` +
        `runs. Apply the migrations.`,
    );
  }

  // STEP 19: and UPDATE on any one column, which `has_table_privilege` does not see. A
  // review granted UPDATE on the log's `delegation` column and changed a record's slip with start-up
  // passing; step 17 closed the same gap for the business's tables (decision 130).
  const held = (role: string): string =>
    [
      ...FORBIDDEN.map((p) => `has_table_privilege(${role}, 'dsor.audit', '${p}')`),
      `has_any_column_privilege(${role}, 'dsor.audit', 'UPDATE')`,
    ].join(" OR ");
  const { rows } = await db.query<{
    who: string;
    may: boolean;
    may_by_set_role: boolean;
    may_by_function: boolean;
    has_trigger: boolean;
    has_rule: boolean;
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
                              WHERE c.oid IN (${TENANT_REGCLASSES})
                                AND pg_has_role(p.proowner, c.relowner, 'MEMBER'))
                  -- STEP 16: or of the schema one is in, who may drop the table from inside
                  -- the helper. A review measured the owner of dsor dropping the log.
                  OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                              WHERE c.oid IN (${TENANT_REGCLASSES})
                                AND pg_has_role(p.proowner, ns.nspowner, 'MEMBER'))
                  -- STEP 16: or may create in either schema, and so make a table there for
                  -- whoever calls it. A review made dsor.proposals that way (decision 124).
                  OR EXISTS (SELECT 1 FROM pg_namespace ns
                              WHERE ns.nspname IN ('dsor', 'public')
                                AND has_schema_privilege(p.proowner, ns.oid, 'CREATE'))
                )
            ) AS may_by_function,
            EXISTS (
              SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid IN (${TENANT_REGCLASSES})
                AND NOT t.tgisinternal
            ) AS has_trigger,
            -- STEP 26b: and rules. A tenant table is a table, and a table has no rule of
            -- its own; every rule on one is somebody's (decision 161).
            EXISTS (
              SELECT 1 FROM pg_rewrite w
              WHERE w.ev_class IN (${TENANT_REGCLASSES})
            ) AS has_rule`,
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
        `table, skips the row-level lock, owns a tenant table or the schema it is in, or may ` +
        `create in that schema — a rewrite, a read, a drop or a table of its own, by proxy for ` +
        `whoever reaches it, through a grant, a membership, an aggregate or a trigger. This ` +
        `program expects no such helper. Drop the function, or give it an owner that holds nothing.`,
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

  // STEP 26b: a rule is the trigger's older cousin. It rewrites this program's own
  // statement, or adds statements of its own, with the table owner's rights, and start-up asked
  // only about triggers. Decision 149 measured del_100's limit lifted by a rule on the invoices,
  // fired by an ordinary invoice.issue; and `DO INSTEAD NOTHING` on the log would swallow a
  // decision the program believes recorded. Any rule is refused, whatever it does (decision 161).
  if (answer.has_rule !== false) {
    throw new Error(
      `a tenant table has a rule on it, and this program expects none: a rule rewrites this ` +
        `program's own statements, or adds statements of its own, with the table owner's rights — ` +
        `a rule on the invoices can sign a permission slip inside an ordinary invoice.issue, and ` +
        `one that does nothing instead can swallow a record of the log. Drop the rule, or change ` +
        `this check deliberately.`,
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
  // lock, so a view over the invoices shows every company to whoever may SELECT from it. So it
  // refuses an application that may SELECT from a table or view beside the tenant tables.
  // STEP 26b: it asked the application alone, and of the whole table, and decision 156
  // measured three ways round it: the view readable one SET ROLE away, through a helper whose
  // owner may read it, or granted on some of its columns only, each showing every company's rows.
  // It is asked now the way the questions about writing are (decision 161).
  const { rows: lock } = await db.query<{
    bypasses: boolean;
    bypassing_roles: string | null;
    owns_tenant_table: boolean;
    owns_database: boolean;
    owns_schema: string | null;
    creates_in: string | null;
    locked: boolean;
    reads_beyond: string | null;
    already_said: string | null;
  }>(
    `WITH tenant_table (rel, col) AS (
       VALUES ${TENANT_TABLES.map(([table, column]) => `(to_regclass('${table}'), '${column}')`).join(", ")}
     ),
     policy_text (rel, qual, kept, kept_check) AS (
       SELECT rel, '(' || col || ' = current_setting(''dsor.tenant_id''::text, true))',
              -- STEP 20: and the claims' second policy, which keeps an answer once written,
              -- as PostgreSQL writes it back, measured (decision 132).
              CASE WHEN rel = to_regclass('dsor.idempotency_keys')
                   THEN '((answer IS NULL) OR (answer = ''{"released": true}''::text))'
                   -- STEP 24: and the reservations', which keep a settled one (decision 140).
                   WHEN rel = to_regclass('dsor.reservations')
                   THEN '(state = ''held''::text)'
                   -- STEP 25: and the brake's, which keeps a lift final (decision 142).
                   WHEN rel = to_regclass('dsor.agent_controls')
                   THEN '(lifted_at IS NULL)'
                   -- STEP 25: and the slips', which lets an active slip become revoked
                   -- and nothing else. Decision 156: or a suspended one, in the words PostgreSQL
                   -- writes an IN list back in, measured.
                   WHEN rel = to_regclass('dsor.delegations')
                   THEN '(status = ANY (ARRAY[''active''::text, ''suspended''::text]))'
                   -- NEW IN STEP 27: and the controls', which lets only a waiting control
                   -- change, as PostgreSQL writes it back, measured (decision 164).
                   WHEN rel = to_regclass('dsor.controls')
                   THEN '(status = ANY (ARRAY[''draft''::text, ''in_review''::text]))' END,
              -- STEP 25: what the second policy lets a row become: anything, the program's
              -- to say, except for a slip, which only becomes revoked.
              -- Decision 143: and with who revoked it. Decision 156: and when and why, as
              -- PostgreSQL writes it back, measured.
              CASE WHEN rel = to_regclass('dsor.delegations')
                   THEN '((status = ''revoked''::text) AND (revoked_by IS NOT NULL)'
                        || ' AND (revoked_at IS NOT NULL) AND (revoked_reason IS NOT NULL))'
                   -- NEW IN STEP 27: and a control changes only to active, with its moment.
                   WHEN rel = to_regclass('dsor.controls')
                   THEN '((status = ''active''::text) AND (switched_on_at IS NOT NULL))'
                   ELSE 'true' END
         FROM tenant_table
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
            -- STEP 16: the database they are in, and who owns it (decision 124).
            pg_has_role(current_user, (SELECT d.datdba FROM pg_database d
                                        WHERE d.datname = current_database()), 'MEMBER')
              AS owns_database,
            -- STEP 16: the schema each tenant table is in, and who owns it (decision 123).
            -- STEP 17: DISTINCT, because public now holds three of the tenant tables, and
            -- without it the refusal named the schema three times, measured.
            (SELECT string_agg(DISTINCT ns.nspname, ', ' ORDER BY ns.nspname)
               FROM pg_class c JOIN tenant_table t ON t.rel = c.oid
               JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE pg_has_role(current_user, ns.nspowner, 'MEMBER')) AS owns_schema,
            -- STEP 16: where it may create things, itself or one SET ROLE away, as each
            -- role and schema, so the refusal can say which grant to take back (decision 124).
            -- Decision 147: a right that PUBLIC holds is named as PUBLIC's. PUBLIC is every role
            -- at once and has no row in pg_roles, so the refusal named the application instead,
            -- and taking CREATE back from it, as the refusal said, changed nothing (measured).
            (SELECT string_agg(DISTINCT holder.name || ' on ' || ns.nspname, ', '
                               ORDER BY holder.name || ' on ' || ns.nspname)
               FROM pg_namespace ns CROSS JOIN pg_roles r
               CROSS JOIN LATERAL (
                 SELECT CASE WHEN has_schema_privilege('public', ns.oid, 'CREATE') THEN 'PUBLIC'
                             ELSE r.rolname END AS name
               ) AS holder
              WHERE ns.nspname IN ('dsor', 'public')
                AND pg_has_role(current_user, r.oid, 'MEMBER')
                AND has_schema_privilege(r.oid, ns.oid, 'CREATE')) AS creates_in,
            (SELECT bool_and(
                c.relrowsecurity AND c.relforcerowsecurity
                AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
                    = CASE WHEN pt.kept IS NULL THEN 1 ELSE 2 END
                AND (pt.kept IS NULL OR EXISTS (
                  SELECT 1 FROM pg_policy p
                  WHERE p.polrelid = c.oid
                    AND p.polcmd = 'w' AND NOT p.polpermissive AND p.polroles = '{0}'::oid[]
                    AND pg_get_expr(p.polqual, p.polrelid) = pt.kept
                    AND pg_get_expr(p.polwithcheck, p.polrelid) = pt.kept_check
                ))
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
                -- STEP 26b: by what a relation is, not by its schema's name (decision 163).
                AND ${MADE_SINCE_THE_DATABASE}
                -- NOT EXISTS, not NOT IN: a NULL in a NOT IN list makes every row false.
                AND NOT EXISTS (SELECT 1 FROM tenant_table t WHERE t.rel = c.oid)
                -- STEP 26b: asked the way the write questions are, of every role the
                -- application can act as, and of any column (decision 161).
                AND ${forAnyRoleItCanActAs((role) => `has_any_column_privilege(${role}, c.oid, 'SELECT')`)}) AS reads_beyond,
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

  // STEP 16: the database the tenant tables are in. One login that owns its own database is
  // the commonest careless setup. It was caught only through `public`, whose owner is the
  // database's, and giving that schema back let the program start, measured (decision 124). A
  // database's owner may drop it, and asked first, the refusal says so instead of naming `public`.
  if (second.owns_database !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, which owns, or may become the owner of, the database ` +
        `it is connected to. A database's owner may drop it, and every table and every record ` +
        `with it. The database belongs to the account that runs the migrations, never to ` +
        `\`${APPLICATION_ROLE}\`.`,
    );
  }

  // STEP 16: the schemas the tenant tables are in. A schema's owner may drop any table in
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

  // STEP 16: and it may create nothing in them. Only the migrations put tables there: one the
  // application made would be its own, every row of it, and a later step's migration would find
  // its name taken. Migration 008 takes CREATE on dsor back; this asks PostgreSQL, because a grant
  // made after the migrations passes them by (decision 123).
  if (second.creates_in !== null) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may create tables, views or functions where ` +
        `only the migrations should, itself or one SET ROLE away: ${second.creates_in}. A table ` +
        `the application made there would be its own, every row of it. Take CREATE on that schema ` +
        `back from that role, or take away the membership that reaches it. PUBLIC is every role ` +
        `at once: a right it holds is taken back from PUBLIC. Migrations 002_runtime_user.sql and ` +
        `008_the_control_plane_store.sql take it back from PUBLIC and from ` +
        `\`${APPLICATION_ROLE}\`, on public and on dsor.`,
    );
  }

  if (second.locked !== true) {
    throw new Error(
      `the second lock is not on: ${TENANT_TABLE_NAMES} must each have row-level security ` +
        `enabled, forced, and exactly the one policy migrations 005 and 011 write — no other ` +
        `policy beside it, and none that reads differently.`,
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
        `not one of the tenant tables, itself, one SET ROLE away, or through a helper function, ` +
        `by every column or by some. A view or a table beside them is a window past the lock: ` +
        `a view runs with its owner's rights, and a table without a policy hides nothing. The ` +
        `application may read ${TENANT_TABLE_NAMES}, and nothing else.`,
    );
  }

  // STEP 17: the rights on the business's tables, asked last. Asked of every role the
  // connection can be, they would refuse an owner one SET ROLE away as "may delete", which is
  // true and not the reason; the ownership questions above name the reason (decision 126).
  //
  // STEP 10: the invoices table too. The application may change an invoice's status and
  // nothing else — a row's company and number are its identity (DSOR-TEN-01a) — and it may neither
  // add nor remove rows. An administrator who grants more has made the same kind of mistake as
  // pointing DSOR_DB_URL at the owner, and a critic's next attack was exactly that grant.
  // STEP 21: and its version, which every change raises (decision 133).
  //
  // STEP 17: asked of every role this connection can be, itself and one SET ROLE away, as
  // the log's rights have been since step 09. A review passed start-up with DELETE on the payments
  // held by a role the application could become (decision 126); the invoices had the same gap.
  const { rows: invoices } = await db.query<{ may: boolean }>(
    `SELECT ${forAnyRoleItCanActAs(
      (role) => `has_column_privilege(${role}, 'public.invoices', 'tenant_id', 'UPDATE')
         OR has_column_privilege(${role}, 'public.invoices', 'id', 'UPDATE')
         -- STEP 21: whom it is owed to, and how much, which nothing asked (decision 134).
         OR has_column_privilege(${role}, 'public.invoices', 'vendor', 'UPDATE')
         OR has_column_privilege(${role}, 'public.invoices', 'amount_value', 'UPDATE')
         OR has_column_privilege(${role}, 'public.invoices', 'amount_currency', 'UPDATE')
         -- STEP 17: any column, not the table. A grant that names columns is invisible to
         -- has_table_privilege, so a grant of every column passed this check, measured.
         OR has_any_column_privilege(${role}, 'public.invoices', 'INSERT')
         OR has_table_privilege(${role}, 'public.invoices', 'DELETE')
         OR has_table_privilege(${role}, 'public.invoices', 'TRUNCATE')`,
    )} AS may`,
  );

  if (invoices[0]?.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may move, renumber, rewrite, add or delete ` +
        `invoices, itself, one SET ROLE away, or through a helper function. The application may ` +
        `change an invoice's status and its version, and nothing else. See ` +
        `migrations/003_invoices.sql and 019_versions.sql.`,
    );
  }

  // STEP 17: the vendors and the payments, in the same spirit (decision 125). The
  // application reads the vendors and changes nothing about them. It makes a draft payment and
  // changes a payment's status, and nothing else: not its company or number, which are its identity
  // (DSOR-TEN-01a), not whom it pays, for which invoice or how much, and it neither chooses a new
  // payment's number or status nor removes one. The number is the sequence's: UPDATE on it lets
  // `setval` choose the next one, and a review made PAY-5000 that way (decision 126).
  // Decision 156: this was the only sequence start-up asked about. STEP 26b asks about every
  // sequence, at the end, and this one keeps its question here, so the refusal names the reason.
  const { rows: payments } = await db.query<{ may: boolean }>(
    `SELECT ${forAnyRoleItCanActAs(
      (role) => `has_any_column_privilege(${role}, 'public.vendors', 'INSERT')
         OR has_any_column_privilege(${role}, 'public.vendors', 'UPDATE')
         OR has_table_privilege(${role}, 'public.vendors', 'DELETE')
         OR has_table_privilege(${role}, 'public.vendors', 'TRUNCATE')
         OR has_column_privilege(${role}, 'public.payments', 'id', 'INSERT')
         OR has_column_privilege(${role}, 'public.payments', 'status', 'INSERT')
         -- STEP 21: a new payment's version is the table's to give (decision 134).
         OR has_column_privilege(${role}, 'public.payments', 'version', 'INSERT')
         OR has_column_privilege(${role}, 'public.payments', 'tenant_id', 'UPDATE')
         OR has_column_privilege(${role}, 'public.payments', 'id', 'UPDATE')
         OR has_column_privilege(${role}, 'public.payments', 'vendor', 'UPDATE')
         OR has_column_privilege(${role}, 'public.payments', 'invoice', 'UPDATE')
         OR has_column_privilege(${role}, 'public.payments', 'amount_value', 'UPDATE')
         OR has_column_privilege(${role}, 'public.payments', 'amount_currency', 'UPDATE')
         OR has_table_privilege(${role}, 'public.payments', 'DELETE')
         OR has_table_privilege(${role}, 'public.payments', 'TRUNCATE')
         OR has_sequence_privilege(${role}, 'public.payment_numbers', 'UPDATE')`,
    )} AS may`,
  );

  if (payments[0]?.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may change a vendor, more of a payment than ` +
        `its status, or a payment's number, itself, one SET ROLE away, or through a helper function. ` +
        `The application reads the vendors, makes a draft payment and changes a payment's ` +
        `status and its version, and nothing else. See migrations/009_vendors_and_payments.sql ` +
        `and 019_versions.sql.`,
    );
  }

  // STEP 18: the permission slips. The application reads them and writes none: a slip it
  // could write is a slip it could sign for itself (decision 127). STEP 25: none but its
  // status and who revoked it, when and why, which is how a slip is torn up; that it can only become
  // revoked is the slips' second policy's to keep, and the lock check above asks for it (decision
  // 142).
  const { rows: slips } = await db.query<{ may: boolean }>(
    `SELECT ${forAnyRoleItCanActAs((role) =>
      [
        `has_any_column_privilege(${role}, 'dsor.delegations', 'INSERT')`,
        `has_table_privilege(${role}, 'dsor.delegations', 'DELETE')`,
        `has_table_privilege(${role}, 'dsor.delegations', 'TRUNCATE')`,
        `EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'dsor.delegations'::regclass AND a.attnum > 0
                    AND NOT a.attisdropped
                    AND a.attname NOT IN ('status', 'revoked_by', 'revoked_at', 'revoked_reason')
                    AND has_column_privilege(${role}, a.attrelid, a.attnum, 'UPDATE'))`,
      ].join(" OR "),
    )} AS may`,
  );

  if (slips[0]?.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may write a permission slip, itself, one ` +
        `SET ROLE away, or through a helper function. An agent's power comes from slips a person signed; the application reads ` +
        `them, and may only mark one revoked. See migrations/013_delegations.sql and ` +
        `025_a_slip_can_be_revoked.sql.`,
    );
  }

  // STEP 20: the idempotency keys. The application claims a key and writes its answer, and
  // nothing else: a claim it could delete is a request it could run twice, one whose key or
  // fingerprint it could change is a claim on another request, and one it could insert with its
  // answer already written is an answer nobody gave (decision 131). Rewriting a written answer is
  // the claims' second policy's to refuse, and the lock check above asks for it (decision 132).
  // STEP 23: and one whose mode it could change is a claim on another request (decision 138).
  const { rows: keys } = await db.query<{ may: boolean }>(
    `SELECT ${forAnyRoleItCanActAs(
      (role) => `has_column_privilege(${role}, 'dsor.idempotency_keys', 'answer', 'INSERT')
         OR has_column_privilege(${role}, 'dsor.idempotency_keys', 'claimed_at', 'INSERT')
         OR has_column_privilege(${role}, 'dsor.idempotency_keys', 'tenant', 'UPDATE')
         OR has_column_privilege(${role}, 'dsor.idempotency_keys', 'principal', 'UPDATE')
         OR has_column_privilege(${role}, 'dsor.idempotency_keys', 'operation', 'UPDATE')
         OR has_column_privilege(${role}, 'dsor.idempotency_keys', 'key', 'UPDATE')
         OR has_column_privilege(${role}, 'dsor.idempotency_keys', 'payload_hash', 'UPDATE')
         OR has_column_privilege(${role}, 'dsor.idempotency_keys', 'mode', 'UPDATE')
         OR has_table_privilege(${role}, 'dsor.idempotency_keys', 'DELETE')
         OR has_table_privilege(${role}, 'dsor.idempotency_keys', 'TRUNCATE')`,
    )} AS may`,
  );

  if (keys[0]?.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may delete an idempotency key, change whose it is ` +
        `or which request it fingerprints, or claim one with its answer already written, itself, ` +
        `one SET ROLE away, or through a helper function. The application claims a key and writes ` +
        `its answer, and nothing else. See migrations/018_idempotency_keys.sql.`,
    );
  }

  // STEP 24: the day totals and the reservations. A total or a reservation the application
  // could delete is room it could make, a reservation it could write already settled, or rewrite to
  // another amount, is one booked for one thing and settled for another, and a total it could move
  // to another day is a limit it could move (decision 140). Releasing a settled reservation is the
  // second policy's to refuse, and the lock check above asks for it. What these questions do not
  // keep is said in decision 141: with the rights it needs to book, the application's own code could
  // still change a total's amount, or insert a reservation that booked nothing, and make room, as it
  // could write a payment past the limit.
  const { rows: booked } = await db.query<{ may: boolean }>(
    `SELECT ${forAnyRoleItCanActAs((role) =>
      [
        ...["dsor.day_totals", "dsor.reservations"].flatMap((table) => [
          `has_table_privilege(${role}, '${table}', 'DELETE')`,
          `has_table_privilege(${role}, '${table}', 'TRUNCATE')`,
        ]),
        ...["tenant", "delegation", "day", "currency"].map(
          (column) => `has_column_privilege(${role}, 'dsor.day_totals', '${column}', 'UPDATE')`,
        ),
        ...["tenant", "proposal", "delegation", "day", "amount_value", "amount_currency"].map(
          (column) => `has_column_privilege(${role}, 'dsor.reservations', '${column}', 'UPDATE')`,
        ),
        `has_column_privilege(${role}, 'dsor.reservations', 'state', 'INSERT')`,
      ].join(" OR "),
    )} AS may`,
  );

  if (booked[0]?.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may delete a day's total or a reservation, ` +
        `change what a reservation is for, write one already settled, or move a total to another ` +
        `day, itself, one SET ROLE away, or through a helper function. The application books and ` +
        `settles, and nothing else. See migrations/022_daily_limits_and_reservations.sql.`,
    );
  }

  // STEP 25: the brake. The application pulls it and releases it, and nothing else: a brake
  // it could delete is one it could release with no lift on the record, one whose target or reason
  // it could rewrite is a different brake, and one it could write already lifted is a lift nobody
  // gave (decision 142). A lift rewritten or undone is the second policy's to refuse.
  const { rows: brakes } = await db.query<{ may: boolean }>(
    `SELECT ${forAnyRoleItCanActAs((role) =>
      [
        `has_table_privilege(${role}, 'dsor.agent_controls', 'DELETE')`,
        `has_table_privilege(${role}, 'dsor.agent_controls', 'TRUNCATE')`,
        // Decision 143: every column but the ones it may write, as for slips, so a column added
        // later and granted is asked too; named one by one, a review's new column passed.
        ...(
          [
            ["UPDATE", ["lifted_by", "lifted_at"]],
            ["INSERT", ["tenant", "agent", "imposed_by", "reason"]],
          ] as const
        ).map(
          ([right, allowed]) => `EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'dsor.agent_controls'::regclass AND a.attnum > 0
                    AND NOT a.attisdropped
                    AND a.attname NOT IN (${allowed.map((c) => `'${c}'`).join(", ")})
                    AND has_column_privilege(${role}, a.attrelid, a.attnum, '${right}'))`,
        ),
      ].join(" OR "),
    )} AS may`,
  );

  if (brakes[0]?.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may delete a brake, rewrite who pulled it or ` +
        `what it stops, or write one already lifted, itself, one SET ROLE away, or through a helper ` +
        `function. The application pulls the brake and releases it, and nothing else. See ` +
        `migrations/024_the_emergency_brake.sql.`,
    );
  }

  // NEW IN STEP 27: the controls. The application reads them, and changes a control's status and
  // when it was switched on, and nothing else: a control it could write is a policy it could
  // rewrite, one it could delete is a policy gone, and one whose condition or test cases it could
  // change would be switched on with cases nobody wrote (decision 162). Every column but those two,
  // as for slips and brakes, so a column added later and granted is asked too.
  const { rows: controls } = await db.query<{ may: boolean }>(
    `SELECT ${forAnyRoleItCanActAs((role) =>
      [
        `has_any_column_privilege(${role}, 'dsor.controls', 'INSERT')`,
        `has_table_privilege(${role}, 'dsor.controls', 'DELETE')`,
        `has_table_privilege(${role}, 'dsor.controls', 'TRUNCATE')`,
        `EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'dsor.controls'::regclass AND a.attnum > 0
                    AND NOT a.attisdropped
                    AND a.attname NOT IN ('status', 'switched_on_at')
                    AND has_column_privilege(${role}, a.attrelid, a.attnum, 'UPDATE'))`,
      ].join(" OR "),
    )} AS may`,
  );

  if (controls[0]?.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may write a control, change what one says, or ` +
        `delete one, itself, one SET ROLE away, or through a helper function. The application ` +
        `reads the company's controls and changes a control's status, and nothing else. See ` +
        `migrations/028_controls.sql.`,
    );
  }

  // STEP 22: the proposals. The application adds a proposal and its moves, and changes
  // nothing: a move it could change or delete is a finished proposal it could start again, a
  // proposal it could change is a payload approved as one thing and run as another, and a time it
  // could write is a history it could reorder. And it may not touch the map, where a move out of
  // COMMITTED, added, would undo the rule the map exists for (decision 136).
  const { rows: proposals } = await db.query<{ may: boolean }>(
    `SELECT ${forAnyRoleItCanActAs((role) =>
      [
        ...["dsor.proposals", "dsor.proposal_moves", "dsor.proposal_map"].flatMap((table) => [
          `has_any_column_privilege(${role}, '${table}', 'UPDATE')`,
          `has_table_privilege(${role}, '${table}', 'DELETE')`,
          `has_table_privilege(${role}, '${table}', 'TRUNCATE')`,
        ]),
        `has_any_column_privilege(${role}, 'dsor.proposal_map', 'INSERT')`,
        `has_column_privilege(${role}, 'dsor.proposals', 'id', 'INSERT')`,
        `has_column_privilege(${role}, 'dsor.proposals', 'created_at', 'INSERT')`,
        `has_column_privilege(${role}, 'dsor.proposal_moves', 'seq', 'INSERT')`,
        `has_column_privilege(${role}, 'dsor.proposal_moves', 'at', 'INSERT')`,
      ].join(" OR "),
    )} AS may`,
  );

  if (proposals[0]?.may !== false) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may change or delete a proposal or one of its ` +
        `moves, choose a proposal's number or a move's time or place, or change the map of moves, ` +
        `itself, one SET ROLE away, or through a helper function. The application adds a proposal ` +
        `and its moves, and nothing else. See migrations/020_proposals.sql.`,
    );
  }

  // STEP 26b: everything beside the tenant tables, asked last, so that a right on one of
  // the business's own tables is refused above in words that name the reason. A view runs with its
  // owner's rights, and start-up asked only whether the application may READ one: an owner's view
  // over the slips with INSERT and no SELECT passed, and through it the application signed itself a
  // slip (decision 149, measured). An UPDATE with no WHERE needs no SELECT either, so the same view
  // over the log rewrote every company's records. The application writes the tenant tables and
  // nothing else: no table, view or foreign table beside them, by any column, itself, one SET ROLE
  // away, or through a helper's owner (decision 161).
  const { rows: beyond } = await db.query<{ writes_beyond: string | null }>(
    `WITH tenant_table (rel) AS (VALUES ${TENANT_TABLES.map(([table]) => `(to_regclass('${table}'))`).join(", ")})
     SELECT string_agg(ns.nspname || '.' || c.relname, ', ' ORDER BY 1) AS writes_beyond
       FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'v', 'm', 'p', 'f')
        AND ${MADE_SINCE_THE_DATABASE}
        AND NOT EXISTS (SELECT 1 FROM tenant_table t WHERE t.rel = c.oid)
        AND ${forAnyRoleItCanActAs(
          (role) => `has_any_column_privilege(${role}, c.oid, 'INSERT')
             OR has_any_column_privilege(${role}, c.oid, 'UPDATE')
             OR has_table_privilege(${role}, c.oid, 'DELETE')
             OR has_table_privilege(${role}, c.oid, 'TRUNCATE')`,
        )}`,
  );

  // No row at all is a question not answered; an aggregate always answers with one.
  if (beyond[0] === undefined) {
    throw new Error(
      "the database did not say what this connection may write beside the tenant tables; " +
        "refusing to start",
    );
  }

  if (beyond[0].writes_beyond !== null) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may write to \`${beyond[0].writes_beyond}\`, ` +
        `which is not one of the tenant tables, itself, one SET ROLE away, or through a helper ` +
        `function. A view runs with its owner's rights, so a view the application may write ` +
        `through is a way past every question above, even one it may not read. The application ` +
        `writes ${TENANT_TABLE_NAMES}, and nothing else.`,
    );
  }

  // STEP 26b: every sequence, not a list. `setval` needs UPDATE on a sequence, and
  // `ALTER SEQUENCE` needs its owner; either lets the application set the next number, backward
  // too, where it should only be given one. Taking numbers one after another, which USAGE allows,
  // can only move forward (decision 163). Start-up asked about the payments' sequence alone, above, and a proposal's number, a
  // brake's number and a move's place come from three more (decisions 153 and 156). Asked of every
  // sequence, so the next one a migration adds is asked without anyone remembering to add it here,
  // as decision 143 learned for columns (decision 161). Taking the next number is USAGE, which the
  // application needs, and is not asked.
  const { rows: numbers } = await db.query<{ sets: string | null }>(
    `SELECT string_agg(ns.nspname || '.' || c.relname, ', ' ORDER BY 1) AS sets
       FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE c.relkind = 'S'
        AND ${MADE_SINCE_THE_DATABASE}
        AND ${forAnyRoleItCanActAs(
          (role) => `has_sequence_privilege(${role}, c.oid, 'UPDATE')
             OR pg_has_role(${role}, c.relowner, 'MEMBER')`,
        )}`,
  );

  if (numbers[0] === undefined) {
    throw new Error(
      "the database did not say which numbers this connection may set; refusing to start",
    );
  }

  if (numbers[0].sets !== null) {
    throw new Error(
      `this connection is \`${answer.who}\`, and it may set the next number of ` +
        `\`${numbers[0].sets}\`, itself, one SET ROLE away, or through a helper function: ` +
        `setval needs UPDATE on a sequence, and ALTER SEQUENCE needs its owner. A payment's, a ` +
        `proposal's and a brake's number, and the place of a proposal's move, are the database's ` +
        `to give. The application takes the next number, and sets none.`,
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
