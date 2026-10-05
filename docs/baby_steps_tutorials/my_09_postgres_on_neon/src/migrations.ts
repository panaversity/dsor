// NEW IN STEP 09: the shape of the database has a history, and the history is a list of files.
//
// A **migration** is one `.sql` file that changes the database's shape. `001_audit.sql` creates the
// table; `002_runtime_user.sql` takes away the application's right to rewrite it. They are applied
// in order, once each, and they are never edited afterwards — because the database on the other side
// has already run them, and editing a file that has already run means the file and the database no
// longer describe the same thing.
//
// This file does not touch PostgreSQL. It answers one question — *which migrations exist, in what
// order* — and it answers it strictly, because every mistake it could let through is quiet and
// permanent. Applying them is the next piece, and it needs a database.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** One migration file: its number, its filename, and the SQL inside it. */
export interface Migration {
  readonly number: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * The only filename shape allowed: exactly three digits, an underscore, then lowercase words.
 *
 * `001_audit.sql`, `042_add_a_column.sql`. Not `1_audit.sql`, not `001-audit.sql`, not
 * `001_Audit.sql`.
 *
 * Strict on purpose. The number is how the database remembers what it has already run, so a file
 * whose number cannot be read with certainty is a file nobody can be sure about. Three digits also
 * means the filenames sort the same way as the numbers, which removes a whole class of surprise —
 * `10_x` sorts before `9_x` as text, and never as a number.
 */
// not copied: this tutorial's own rule for migration file names, as the comment above says.
const NAME = /^(\d{3})_[a-z][a-z0-9_]*\.sql$/;

/**
 * Every migration in a folder, in the order they must be applied.
 *
 * It refuses, rather than guessing, on all of these:
 *
 *   - the folder is not there
 *   - a `.sql` file whose name does not match `NAME`
 *   - two files claiming the same number
 *   - a gap in the numbers, or numbers that do not start at 001
 *   - a file with no SQL in it
 *
 * The gap rule is the one that earns its place. A database records that it applied `002`. Delete
 * `002_whatever.sql` later and the database still says it ran, while nobody can say what it did —
 * the shape of the database and the story of how it got that shape have quietly stopped agreeing.
 * A gap is the visible symptom of exactly that, so it stops the run instead of being tidied away.
 */
export function migrationsIn(folder: string): readonly Migration[] {
  let entries: string[];

  try {
    if (!statSync(folder).isDirectory()) {
      throw new Error("not a directory");
    }

    entries = readdirSync(folder);
  } catch {
    throw new TypeError(`there is no migrations folder at ${folder}`);
  }

  const found = new Map<number, Migration>();

  for (const name of entries.sort()) {
    if (!name.endsWith(".sql")) {
      continue;
    }

    const match = NAME.exec(name);

    if (match === null) {
      throw new TypeError(
        `${name} is not a migration name: it must be three digits, an underscore, ` +
          "then lowercase words, like 001_audit.sql",
      );
    }

    // `match[1]` is the three digits. The explicit base 10 is a habit rather than a guard, and a
    // mutation sweep is how that got established: removing it changed nothing, because `parseInt`
    // has not read a leading zero as octal for many years and `NAME` forbids an "0x" prefix anyway.
    // It stays because it costs nothing and says what base the number is in; it is not protecting us
    // from anything that can happen today.
    const number = Number.parseInt(match[1]!, 10);
    const already = found.get(number);

    if (already !== undefined) {
      throw new TypeError(
        `${already.name} and ${name} both claim ${match[1]}, and a number belongs to one migration`,
      );
    }

    const sql = readFileSync(join(folder, name), "utf8");

    if (sql.trim() === "") {
      throw new TypeError(
        `${name} is empty, so applying it would record a change that did nothing`,
      );
    }

    found.set(number, Object.freeze({ number, name, sql }));
  }

  const numbers = [...found.keys()].sort((a, b) => a - b);

  // 1, 2, 3, with nothing missing. Checked against the position rather than against the previous
  // number, so the message can name the one that is absent.
  for (const [at, number] of numbers.entries()) {
    if (number !== at + 1) {
      const missing = String(at + 1).padStart(3, "0");

      throw new TypeError(
        `${missing} is missing: the migrations must run 001, 002, 003 with no gaps, ` +
          "and a gap usually means a migration that the database has already applied was deleted",
      );
    }
  }

  return Object.freeze(numbers.map((number) => found.get(number)!));
}

/**
 * A fingerprint of a migration's text, so an applied one can be checked against the file.
 *
 * The whole file, comments included. The rule is "an applied migration is never edited", and a
 * checksum that forgave comments would be making a judgement about which edits matter.
 */
export function checksumOf(sql: string): string {
  return `sha256:${createHash("sha256").update(sql).digest("hex")}`;
}

/** What a database remembers about a migration it has run. */
export interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
}

/**
 * The migrations still to apply, given the ones a database says it has already run.
 *
 * Pure: it is handed both lists and reads nothing. That is why it can be tested without a database,
 * and the deciding is the part worth testing — connecting to PostgreSQL is plumbing, while getting
 * *which files to run* wrong is how a database ends up in a shape nobody intended.
 *
 * It refuses two situations rather than carrying on:
 *
 *   - **The database ran a migration this folder no longer has.** The same worry as the no-gap rule
 *     above, one layer out. The database says it ran `002_runtime_user.sql`; the file is gone; nobody
 *     can say what it did — and in this step what it did was take away the application's right to
 *     rewrite the log. Applying `003` on top of that would be building on a shape nobody can account
 *     for.
 *   - **The applied migrations are not the first ones, in order.** That means somebody applied them
 *     by hand, or two people applied different subsets. Either way this folder no longer describes
 *     the database in front of us.
 *
 * Both refusals say which file, because "the migrations disagree" is not something anyone can act on.
 */
export function pending(
  all: readonly Migration[],
  applied: readonly AppliedMigration[],
): readonly Migration[] {
  const known = new Map(all.map((migration) => [migration.name, migration]));

  for (const { name, checksum } of applied) {
    const file = known.get(name);

    // Applied and then edited. The file is still there, so nothing looks wrong — and the database
    // was built from text that no longer exists anywhere.
    if (file !== undefined && checksumOf(file.sql) !== checksum) {
      throw new TypeError(
        `${name} has changed since it was applied: the database ran a different version of it, ` +
          "and an applied migration is never edited. Add a new migration instead",
      );
    }

    if (file === undefined) {
      throw new TypeError(
        `the database has applied ${name} and this folder does not have it: ` +
          "a migration that has run must never be deleted, because nothing can say what it did",
      );
    }
  }

  // Position by position against the ordered list. `applied` is treated as a set of names rather
  // than as an order, because a database table has no inherent order — what must hold is that the
  // applied ones are exactly the first N.
  const appliedNames = new Set(applied.map((one) => one.name));

  for (const [at, migration] of all.entries()) {
    const isApplied = appliedNames.has(migration.name);
    const shouldBeApplied = at < applied.length;

    if (isApplied !== shouldBeApplied) {
      throw new TypeError(
        `${migration.name} is ${isApplied ? "applied" : "not applied"} and the ones before it are ` +
          "not: the applied migrations must be the first ones, in order",
      );
    }
  }

  return Object.freeze(all.slice(applied.length));
}

/** Somewhere SQL can be run. The same shape `audit.ts` uses, for the same reason. */
export interface Runner {
  exec: (sql: string) => Promise<unknown>;
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

/**
 * The table that remembers which migrations have run.
 *
 * It cannot itself be a migration — there would be nowhere to record that it had been applied — so
 * the runner creates it, every time, with `IF NOT EXISTS`. That is the one piece of SQL in this
 * program that is allowed to run twice.
 */
const REMEMBER = `CREATE TABLE IF NOT EXISTS public.applied_migrations (
  name       TEXT        PRIMARY KEY,
  checksum   TEXT        NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

/**
 * Apply whatever has not been applied, in order, and record each one.
 *
 * Returns the migrations it applied, so a caller can say what happened. An empty array means the
 * database was already up to date, which is a different fact from "nothing went wrong" and worth
 * being able to tell apart.
 *
 * Each migration and its record go in **one transaction**. Without that, a migration could succeed
 * and the record of it fail — and then the next run would apply it a second time, against a database
 * that already had it, and fail on something confusing like "table audit already exists" rather than
 * on the thing that actually went wrong.
 */
export async function applyMigrations(db: Runner, folder: string): Promise<readonly Migration[]> {
  await db.exec(REMEMBER);

  const { rows } = await db.query<AppliedMigration>(
    "SELECT name, checksum FROM public.applied_migrations ORDER BY name",
  );
  const todo = pending(migrationsIn(folder), rows);

  for (const migration of todo) {
    await db.exec("BEGIN");

    try {
      await db.exec(migration.sql);
      await db.query("INSERT INTO public.applied_migrations (name, checksum) VALUES ($1, $2)", [
        migration.name,
        checksumOf(migration.sql),
      ]);
      await db.exec("COMMIT");
    } catch (whyItFailed) {
      await db.exec("ROLLBACK");

      // Named, because "syntax error at or near" with no file attached is the least helpful message
      // a migration run can produce.
      throw new TypeError(
        `${migration.name} failed and was rolled back: ${(whyItFailed as Error).message}`,
      );
    }
  }

  return todo;
}

/**
 * A `pg` pool, as a `Runner`.
 *
 * `pg` has no `exec`: it has `query`, which runs a multi-statement string when it is given no
 * parameters. PGlite has both. Casting a pool to `Runner` typechecks and fails at the first
 * migration, which is what the first version of this did — the cast hid a method that was not there.
 */
export function asRunner(pool: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}): Runner {
  return {
    exec: (sql: string) => pool.query(sql),
    query: <T>(sql: string, params?: unknown[]) =>
      pool.query(sql, params) as Promise<{ rows: T[] }>,
  };
}
