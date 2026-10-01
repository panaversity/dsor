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
