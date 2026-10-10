// STEP 09: finding the migrations, in the right order, before anything is applied.
//
// None of these tests touches a database. That is deliberate: this half of the runner is about
// *which files exist and in what order*, and it is the half where a mistake is quiet and permanent.
// The half that talks to PostgreSQL is `*.db.test.ts` and comes next.
//
// No requirement id on any of these. A migration runner is not something the specification asks for
// — it is how we get a database into the shape §30 describes. Giving these tests a rule id would be
// a wrong coverage number, which is what twenty titles across this tutorial turned out to be.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checksumOf, migrationsIn, pending } from "../src/migrations.ts";

const made: string[] = [];

/** A throwaway folder holding the files named, so each test sees only what it asked for. */
function folderWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "dsor-migrations-"));

  made.push(dir);

  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }

  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("finding the migrations", () => {
  it("reads every .sql file, with its number, its name and its text", () => {
    const dir = folderWith({
      "001_audit.sql": "CREATE TABLE audit ();",
      "002_runtime_user.sql": "REVOKE UPDATE ON dsor.audit FROM dsor_runtime;",
    });

    expect(migrationsIn(dir)).toEqual([
      { number: 1, name: "001_audit.sql", sql: "CREATE TABLE audit ();" },
      {
        number: 2,
        name: "002_runtime_user.sql",
        sql: "REVOKE UPDATE ON dsor.audit FROM dsor_runtime;",
      },
    ]);
  });

  it("an empty folder has no migrations, which is not an error", () => {
    expect(migrationsIn(folderWith({}))).toEqual([]);
  });

  /**
   * The order is the migrations' order, whatever order the folder hands them over in.
   *
   * Worth saying what this does **not** prove. I first wrote it with 001, 002 and 010, to show that
   * sorting by number beats sorting by filename — and the no-gap rule below refused the folder,
   * correctly, because 003 to 009 were missing. That is the finding: with three digits **and** no
   * gaps, numeric order and text order cannot differ. So `sort((a, b) => a - b)` in the code is belt
   * and braces, and no test can tell it from a plain text sort. It stays because it says what the
   * order *is*, and because the day somebody relaxes the three-digit rule it is already right.
   */
  it("the order is the migrations' order, whatever order the folder gives them in", () => {
    const dir = folderWith({
      "003_third.sql": "SELECT 3;",
      "001_first.sql": "SELECT 1;",
      "002_second.sql": "SELECT 2;",
    });

    expect(migrationsIn(dir).map((m) => m.number)).toEqual([1, 2, 3]);
    expect(migrationsIn(dir).map((m) => m.name)).toEqual([
      "001_first.sql",
      "002_second.sql",
      "003_third.sql",
    ]);
  });

  it("files that are not .sql are ignored", () => {
    const dir = folderWith({
      "001_audit.sql": "SELECT 1;",
      "README.md": "notes about the migrations",
      ".DS_Store": "",
    });

    expect(migrationsIn(dir).map((m) => m.name)).toEqual(["001_audit.sql"]);
  });

  // The name is a rule, not a convention, because the number is how a database remembers what it
  // has already run. A file whose number cannot be read is a file nobody can be sure about.
  it("a badly named file stops everything, and says which file", () => {
    for (const bad of [
      "audit.sql",
      "1_audit.sql",
      "01_audit.sql",
      "0001_audit.sql",
      "001-audit.sql",
      "001_Audit.sql",
      "001_audit table.sql",
      "001_.sql",
    ]) {
      expect(() => migrationsIn(folderWith({ [bad]: "SELECT 1;" })), bad).toThrow(bad);
    }

    // And the shapes that are fine. Consecutive, because the no-gap rule applies to them too — a
    // lone `042_add_a_column.sql` is refused for the number it is missing, not for its name.
    expect(
      migrationsIn(
        folderWith({
          "001_audit.sql": "SELECT 1;",
          "002_add_a_column.sql": "SELECT 2;",
          "003_z.sql": "SELECT 3;",
        }),
      ),
    ).toHaveLength(3);
  });

  it("two files claiming the same number stop everything", () => {
    const dir = folderWith({
      "001_audit.sql": "SELECT 1;",
      "001_audit_again.sql": "SELECT 2;",
    });

    expect(() => migrationsIn(dir)).toThrow(/both claim 001/);
  });

  /**
   * The numbers run 1, 2, 3 with nothing missing, and this is the guard worth the most.
   *
   * A database remembers that it applied `002`. If somebody later deletes `002_whatever.sql`, the
   * database still says it ran and nobody can say what it did — the shape of the database and the
   * history of how it got there have silently disagreed. A gap in the numbering is the visible
   * symptom of exactly that, so it stops the run.
   */
  it("a gap in the numbers stops everything, because a gap means a deleted migration", () => {
    const dir = folderWith({
      "001_audit.sql": "SELECT 1;",
      "003_later.sql": "SELECT 3;",
    });

    expect(() => migrationsIn(dir)).toThrow(/002 is missing/);
  });

  it("the numbers must start at 001", () => {
    expect(() => migrationsIn(folderWith({ "002_audit.sql": "SELECT 1;" }))).toThrow(
      /001 is missing/,
    );
  });

  it("an empty .sql file stops everything, because it would record a change that did nothing", () => {
    expect(() => migrationsIn(folderWith({ "001_audit.sql": "   \n\n  " }))).toThrow(/is empty/);
  });

  it("the list it hands back cannot be edited", () => {
    const list = migrationsIn(folderWith({ "001_audit.sql": "SELECT 1;" }));

    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0])).toBe(true);
    expect(() => {
      (list as { length: number }).length = 0;
    }).toThrow(TypeError);
  });

  it("a folder that is not there says so, rather than looking like no migrations", () => {
    expect(() => migrationsIn(join(tmpdir(), "dsor-no-such-folder-9f3a"))).toThrow(
      /no migrations folder/,
    );
  });
});

describe("deciding what is still to apply", () => {
  const all = [
    { number: 1, name: "001_audit.sql", sql: "SELECT 1;" },
    { number: 2, name: "002_runtime_user.sql", sql: "SELECT 2;" },
    { number: 3, name: "003_later.sql", sql: "SELECT 3;" },
  ];

  /** What the database remembers about a migration it has run: its name, and what it looked like. */
  const asApplied = (...names: string[]): { name: string; checksum: string }[] =>
    names.map((name) => ({
      name,
      checksum: checksumOf(all.find((m) => m.name === name)!.sql),
    }));

  it("a fresh database has everything to apply", () => {
    expect(pending(all, []).map((m) => m.number)).toEqual([1, 2, 3]);
  });

  it("a database that has run the first two has only the third", () => {
    expect(
      pending(all, asApplied("001_audit.sql", "002_runtime_user.sql")).map((m) => m.name),
    ).toEqual(["003_later.sql"]);
  });

  it("a database that has run everything has nothing to apply", () => {
    expect(pending(all, asApplied(...all.map((m) => m.name)))).toEqual([]);
  });

  /**
   * A migration that was applied and then **edited**.
   *
   * The other half of the lost-file rule, and the likelier accident of the two: the file is still
   * there, so nothing looks wrong, and the database ran a different version of it. Somebody fixes a
   * typo in `001_audit.sql` six months later, runs `pnpm migrate`, and it reports nothing to do —
   * while the table in front of them was built from the old text.
   *
   * The checksum is what notices. It covers the whole file, so a comment change counts too, and that
   * is deliberate: the rule is "an applied migration is never edited", not "not edited in ways I
   * would judge to matter".
   */
  it("a migration edited after it was applied stops everything", () => {
    const edited = asApplied("001_audit.sql");

    edited[0]!.checksum = checksumOf("SELECT 1; -- a typo fixed six months later");

    expect(() => pending(all, edited)).toThrow(/001_audit\.sql has changed since it was applied/);
  });

  it("the checksum covers the text, so even a comment counts", () => {
    expect(checksumOf("SELECT 1;")).toBe(checksumOf("SELECT 1;"));
    expect(checksumOf("SELECT 1;")).not.toBe(checksumOf("SELECT 1; -- harmless"));
    expect(checksumOf("SELECT 1;")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  /**
   * The guard that matters here, and it is the same worry as the no-gap rule one layer down.
   *
   * The database says it ran `002_runtime_user.sql`. The file is not in the folder. Nobody can say
   * what it did — and in this step, what it did was take away the application's right to rewrite the
   * log. Carrying on would mean applying `003` on top of a database whose shape nobody can account
   * for, so it stops.
   */
  it("a migration the database has run but the folder has lost stops everything", () => {
    const withoutTwo = [all[0]!, all[2]!].map((m, at) => ({ ...m, number: at + 1 }));

    expect(() => pending(withoutTwo, asApplied("001_audit.sql", "002_runtime_user.sql"))).toThrow(
      /002_runtime_user\.sql/,
    );
  });

  // Applied out of order means somebody applied them by hand, or two people applied different
  // subsets. Either way the database's shape is not the one this folder describes.
  it("applied migrations must be the first ones, in order", () => {
    expect(() => pending(all, asApplied("002_runtime_user.sql"))).toThrow(/001_audit\.sql/);
    expect(() => pending(all, asApplied("001_audit.sql", "003_later.sql"))).toThrow(
      /002_runtime_user\.sql/,
    );
  });

  it("the list it hands back cannot be edited", () => {
    const next = pending(all, []);

    expect(Object.isFrozen(next)).toBe(true);
    expect(() => {
      (next as { length: number }).length = 0;
    }).toThrow(TypeError);
  });

  it("an empty folder with an empty database is simply nothing to do", () => {
    expect(pending([], [])).toEqual([]);
  });
});
