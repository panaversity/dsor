// STEP 09: applying the migrations, once each, against a real PostgreSQL.
//
// `migrations.test.ts` covers the deciding — which files exist, which are still to apply — without a
// database. This covers the applying, which needs one, and uses PGlite for the reason the permission
// tests do: it is the PostgreSQL engine, so "already exists" and "rolled back" here are Postgres's
// own answers rather than something imitating them.
//
// No requirement ids. A migration runner is not something the specification asks for.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations, asRunner, checksumOf } from "../src/migrations.ts";

const made: string[] = [];
let db: PGlite;

function folderWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "dsor-migrate-"));

  made.push(dir);

  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }

  return dir;
}

afterEach(async () => {
  // Closed and forgotten. Without the reset, a test that does not make a database inherits the
  // previous one's closed handle and this throws "PGlite is closed" — which is how the adapter test
  // below, the one test here that needs no database at all, started failing.
  const open = db;

  db = undefined as unknown as PGlite;

  await open?.close();

  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** What the database says it has applied. */
async function remembered(): Promise<{ name: string; checksum: string }[]> {
  const { rows } = await db.query<{ name: string; checksum: string }>(
    "SELECT name, checksum FROM public.applied_migrations ORDER BY name",
  );

  return rows;
}

describe("applying the migrations", () => {
  it("applies them in order and records each one", async () => {
    db = await PGlite.create();

    const dir = folderWith({
      "001_first.sql": "CREATE TABLE a (x int);",
      "002_second.sql": "CREATE TABLE b (y int);",
    });
    const applied = await applyMigrations(db, dir);

    expect(applied.map((m) => m.name)).toEqual(["001_first.sql", "002_second.sql"]);

    // Both tables are there, which is the only proof that matters.
    const tables = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_name IN ('a','b') ORDER BY 1",
    );

    expect(tables.rows.map((r) => r.table_name)).toEqual(["a", "b"]);
    expect((await remembered()).map((r) => r.name)).toEqual(["001_first.sql", "002_second.sql"]);
  });

  /**
   * Run it twice. The second run must do nothing — and "nothing" has to be distinguishable from
   * "it worked", which is why `applyMigrations` returns what it applied rather than nothing at all.
   *
   * If it did apply them twice, `CREATE TABLE a` would fail with "already exists", so this test
   * would fail loudly. That is the good case: the quiet failure would be a runner that silently
   * reapplied something idempotent and left the database subtly different.
   */
  it("a second run applies nothing", async () => {
    db = await PGlite.create();

    const dir = folderWith({ "001_first.sql": "CREATE TABLE a (x int);" });

    expect((await applyMigrations(db, dir)).map((m) => m.name)).toEqual(["001_first.sql"]);
    expect(await applyMigrations(db, dir)).toEqual([]);
    expect(await remembered()).toHaveLength(1);
  });

  it("a migration added later is the only one applied", async () => {
    db = await PGlite.create();

    const dir = folderWith({ "001_first.sql": "CREATE TABLE a (x int);" });

    await applyMigrations(db, dir);
    writeFileSync(join(dir, "002_second.sql"), "CREATE TABLE b (y int);");

    expect((await applyMigrations(db, dir)).map((m) => m.name)).toEqual(["002_second.sql"]);
    expect((await remembered()).map((r) => r.name)).toEqual(["001_first.sql", "002_second.sql"]);
  });

  it("an applied migration that was edited stops the run", async () => {
    db = await PGlite.create();

    const dir = folderWith({ "001_first.sql": "CREATE TABLE a (x int);" });

    await applyMigrations(db, dir);
    writeFileSync(join(dir, "001_first.sql"), "CREATE TABLE a (x int); -- tidied up");

    await expect(applyMigrations(db, dir)).rejects.toThrow(/has changed since it was applied/);
  });

  /**
   * A migration that fails leaves nothing behind — not its own half-done work, and not a record
   * claiming it ran.
   *
   * Without the transaction the table would exist and the record would not, so the next run would
   * try again and fail on "table a already exists" — a message about the symptom, pointing at the
   * wrong migration.
   */
  it("a migration that fails is rolled back, and not recorded", async () => {
    db = await PGlite.create();

    const dir = folderWith({
      "001_first.sql": "CREATE TABLE a (x int);",
      "002_broken.sql": "CREATE TABLE b (y int); SELECT this_function_does_not_exist();",
    });

    await expect(applyMigrations(db, dir)).rejects.toThrow(/002_broken\.sql failed and was rolled/);

    // The first one stuck, because it succeeded and committed.
    expect((await remembered()).map((r) => r.name)).toEqual(["001_first.sql"]);

    // The broken one left no table behind.
    const b = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_name = 'b'",
    );

    expect(b.rows[0]!.n).toBe("0");
  });

  /**
   * The case the explicit BEGIN exists for: the migration succeeds and **recording it fails**.
   *
   * A mutation sweep is why this test exists. Removing the BEGIN entirely, and turning the ROLLBACK
   * into a COMMIT, both left every test passing — because PostgreSQL already wraps a multi-statement
   * string in an implicit transaction, so a migration whose own SQL fails rolls itself back. The
   * explicit transaction is for the *other* statement: the INSERT into `applied_migrations`, which is
   * a separate call.
   *
   * Without it, a migration commits and its record does not — and the next run applies it a second
   * time, failing on "table a already exists", which points at the wrong migration and the wrong
   * problem.
   *
   * The failure is injected at the runner, not simulated in the database: the migration's own SQL
   * runs against the real PostgreSQL, and only the INSERT is made to fail.
   */
  it("a migration whose record fails is rolled back with it", async () => {
    db = await PGlite.create();

    const dir = folderWith({ "001_first.sql": "CREATE TABLE a (x int);" });
    const recordRefuses = {
      exec: (sql: string) => db.exec(sql),
      query: async <T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> => {
        // Matched on the qualified name, because that is what the code sends. This said
        // `startsWith("INSERT INTO applied_migrations")` and silently stopped injecting anything
        // the day every table name was schema-qualified — the migration then succeeded and the
        // test failed loudly, which is the good outcome of a brittle match rather than a quiet one.
        if (sql.includes("INSERT INTO public.applied_migrations")) {
          throw new Error("the record could not be written");
        }

        return db.query<T>(sql, params);
      },
    };

    await expect(applyMigrations(recordRefuses, dir)).rejects.toThrow(
      /001_first\.sql failed and was rolled back/,
    );

    // Neither half happened: no table, and no record of one.
    const a = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_name = 'a'",
    );

    expect(a.rows[0]!.n).toBe("0");
    expect(await remembered()).toEqual([]);
  });

  it("the recorded checksum is the file's", async () => {
    db = await PGlite.create();

    const sql = "CREATE TABLE a (x int);";
    const dir = folderWith({ "001_first.sql": sql });

    await applyMigrations(db, dir);

    expect((await remembered())[0]!.checksum).toBe(checksumOf(sql));
  });

  /**
   * The `pg` adapter, which exists because `pg` has no `exec`.
   *
   * The first version of this code cast a pool straight to `Runner`. That typechecks and fails at the
   * first migration, because the method is not there — a cast asserting a shape nobody checked. No
   * server is needed to prove the adapter calls through, so none is used: the stub below records what
   * it was asked to run.
   */
  it("the pg adapter sends exec as a parameterless query, and passes parameters through", async () => {
    const asked: { sql: string; params?: unknown[] }[] = [];
    const runner = asRunner({
      query: async (sql: string, params?: unknown[]) => {
        asked.push({ sql, params });

        return { rows: [] };
      },
    });

    await runner.exec("CREATE TABLE a (x int)");
    await runner.query("SELECT $1", ["one"]);

    expect(asked).toEqual([
      // No parameters, which is what makes `pg` use the simple protocol and accept several
      // statements in one string — the thing `exec` is for.
      { sql: "CREATE TABLE a (x int)", params: undefined },
      { sql: "SELECT $1", params: ["one"] },
    ]);
  });

  it("an empty folder is simply nothing to do", async () => {
    db = await PGlite.create();

    expect(await applyMigrations(db, folderWith({}))).toEqual([]);
    expect(await remembered()).toEqual([]);
  });
});
