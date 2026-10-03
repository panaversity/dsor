// NEW IN STEP 09: where the program's database comes from, and who it connects as.
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

/** Where the on-disk demo database lives. In .gitignore: it is this machine's, not the project's. */
const LOCAL = fileURLToPath(new URL("../.local-database", import.meta.url));

/** The account the application runs as. Created by a human on a real server; see the README. */
export const APPLICATION_ROLE = "dsor_runtime";

/** The three rights that would let the program rewrite its own history. */
const FORBIDDEN = ["UPDATE", "DELETE", "TRUNCATE"] as const;

/**
 * Stop the program if the connection it is about to use holds UPDATE, DELETE or TRUNCATE on
 * `public.audit`.
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
  const { rows } = await db.query<{ who: string; may: boolean }>(
    `SELECT current_user AS who,
            ${FORBIDDEN.map(
              (p) => `has_table_privilege(current_user, 'public.audit', '${p}')`,
            ).join(" OR ")} AS may`,
  );

  const answer = rows[0];

  // No row at all means the question was not answered, and an unanswered question about a
  // guarantee is not a yes. Fail closed (AGENTS.md: never weaken a guarantee to simplify).
  if (answer === undefined) {
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
    const pool = new Pool({ connectionString: url, max: 1 });

    // Said rather than assumed. A connection string that is wrong fails here, on the first query,
    // with the driver's own message — not later, inside a decision, as EVIDENCE_STORE_UNAVAILABLE.
    await pool.query("SELECT 1");

    // Before `useDatabase`, so a refused connection never records anything at all.
    try {
      await refuseIfItCanRewriteHistory(pool as unknown as Database);
    } catch (wrong) {
      await pool.end();
      throw wrong;
    }

    useDatabase(pool as unknown as Database);

    return {
      where: `the PostgreSQL at ${withoutCredentials(url)}`,
      close: () => pool.end(),
      connection: pool as unknown as Database,
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

  try {
    await refuseIfItCanRewriteHistory(db as unknown as Database);
  } catch (wrong) {
    await db.close();
    throw wrong;
  }

  useDatabase(db as unknown as Database);

  return {
    where: `a PostgreSQL on disk at ${folder.replace(process.cwd(), ".")}, as \`${APPLICATION_ROLE}\``,
    close: () => db.close(),
    connection: db as unknown as Database,
  };
}
