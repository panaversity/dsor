// STEP 09: the guarantee, against a real PostgreSQL.
//
// This is the step's "done when": `UPDATE audit …` must fail with a permission error. Step 08's
// chain makes tampering *detectable*; this makes it *refused*, and the thing doing the refusing is
// not our code.
//
// It runs against **PGlite** — the real PostgreSQL engine compiled to WebAssembly, running inside
// Node. No server, no account, no connection string, so these tests run everywhere `pnpm check` does
// and a learner sees the guarantee hold on the first try.
//
// It is not a mock, and that distinction is the whole reason this file is allowed to exist:
// AGENTS.md forbids proving audit immutability against a mock, and a mock is something that imitates
// a database's answers. PGlite *is* PostgreSQL 18, so `permission denied for table audit` below is
// Postgres's own privilege system talking.
//
// Two things it cannot do, and `audit.db.test.ts` covers them against a real server:
//
//   - **Separate connections.** PGlite has one, so the application's account is reached with
//     `SET ROLE` rather than by logging in as it. The privilege checks are identical; what is not
//     tested here is that `dsor_runtime` *connecting* is also refused the same rights.
//   - **Real concurrency.** One connection cannot race itself, so `UNIQUE (chain, sequence)` under
//     two parallel writers needs a server.
//
// Rule DSOR-AUD-04a: the DSoR runtime identity MUST NOT be able to update or delete audit records.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrationsIn } from "../src/migrations.ts";
import { audit, forgetTheLog, theLog, useDatabase } from "../src/audit.ts";
import { overPGlite } from "../src/database.ts";

let db: PGlite;

/** A fresh database with every migration applied, as the owner. */
beforeEach(async () => {
  db = await PGlite.create();

  // The application's account. In Neon a human creates this once; here it is created per test so
  // each test starts from nothing. The password is local, throwaway, and never leaves this process.
  await db.exec("CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'local-throwaway-not-a-secret';");

  for (const migration of migrationsIn(fileURLToPath(new URL("../migrations", import.meta.url)))) {
    await db.exec(migration.sql);
  }
});

afterEach(async () => {
  await db.close();
});

/** One decision, shaped like the record step 08 writes. */
const A_DECISION = `INSERT INTO dsor.audit (
  record_id, chain, sequence, previous_hash, record_hash, at,
  tenant, kind, identity, correlation, operation, "authorization", result
) VALUES (
  'audit:org_456:0:0', 'audit:org_456', 0,
  'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  'sha256:abc', '2026-10-02T09:14:00Z', 'org_456', 'decision',
  '{"mode":"direct","subject":"cfo_100","actor_chain":[],
    "subject_authority":{"source":"role_source","as_of":"2026-10-02T09:14:00Z"}}',
  '{"request_id":"req_1"}', 'invoice.issue@1', 'DENY', 'AUTHORIZATION_DENIED'
)`;

/**
 * Split a SQL `VALUES (...)` list on the commas that separate values.
 *
 * Not a SQL parser — it only has to cope with `A_DECISION`, whose values include quoted strings
 * with commas and braces inside them. Written out because `values.split(",")` cut the JSON
 * literals in half and the test then failed for the wrong reason.
 */
function splitValues(values: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";

  for (const character of values) {
    if (character === "'") {
      quoted = !quoted;
    }

    if (!quoted && (character === "(" || character === "{")) {
      depth += 1;
    }

    if (!quoted && (character === ")" || character === "}")) {
      depth -= 1;
    }

    if (character === "," && !quoted && depth === 0) {
      out.push(current.trim());
      current = "";

      continue;
    }

    current += character;
  }

  out.push(current.trim());

  return out;
}

/**
 * Run SQL as the application's own account, and say what happened.
 *
 * STEP 11: for org_456, said the way the program says it — inside the statement's own
 * transaction. Without it the lock of migration 005 hides every row and refuses every write, and
 * these tests would be measuring the lock rather than the grants.
 */
async function asTheApplication(sql: string): Promise<string> {
  await db.exec("SET ROLE dsor_runtime;");

  try {
    await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await tx.exec(sql);
    });

    return "allowed";
  } catch (error) {
    return (error as Error).message;
  } finally {
    await db.exec("RESET ROLE;");
  }
}

/**
 * Re-apply 002_runtime_user.sql — the file under test, not a hand-written copy of it.
 *
 * STEP 16: with the log's new address. The file still says `public.audit`, because an
 * applied migration is never edited, and since migration 008 the log is `dsor.audit`. What the
 * file's lines take back is the question here, not where the table lives, so the one name is
 * swapped and every line of the file is otherwise what ran.
 */
async function reapplyThePermissions(): Promise<void> {
  for (const migration of migrationsIn(fileURLToPath(new URL("../migrations", import.meta.url)))) {
    if (migration.name === "002_runtime_user.sql") {
      await db.exec(migration.sql.replaceAll("public.audit", "dsor.audit"));
    }
  }
}

/**
 * Privileges that can be granted on a single column, and those that can only be granted on a table.
 *
 * The split matters because `has_table_privilege` and `has_column_privilege` answer different
 * questions and `has_column_privilege` only accepts the four below.
 */
const PER_COLUMN = ["INSERT", "REFERENCES", "SELECT", "UPDATE"] as const;
const TABLE_ONLY = ["DELETE", "TRIGGER", "TRUNCATE"] as const;

/**
 * Which privileges the application's account can use on `audit` at all, by any route.
 *
 * Two corrections live in this function, both found by measuring.
 *
 * It first read `information_schema.role_table_grants WHERE grantee = 'dsor_runtime'`. A catalogue
 * row exists only for a grant made to the role **by name**, so a privilege reaching it through
 * `PUBLIC` had no row and `toEqual(["INSERT", "SELECT"])` passed while the account held DELETE and
 * TRUNCATE. `has_table_privilege` is the question worth asking: it answers for the role the way
 * PostgreSQL will when the statement runs, counting a direct grant, a grant to PUBLIC, a right
 * inherited through role membership, and superuser bypass.
 *
 * Then `002_runtime_user.sql` started granting INSERT **column by column**, and
 * `has_table_privilege` went to `false` for INSERT — correctly, because there is no table-level
 * INSERT any more. Measured:
 *
 *   has_table_privilege (INSERT):                      false
 *   has_column_privilege (record_id, INSERT):           true
 *   has_column_privilege (recorded_at, INSERT):         false   <- the hole that closed
 *   has_column_privilege (recorded_at, SELECT):         true
 *
 * So a privilege counts as held when the role has it on the table **or on any column**, which is
 * what "can the application use this privilege" actually means.
 */
async function privilegesOfTheApplication(): Promise<string[]> {
  const columnwise = PER_COLUMN.map(
    (privilege, i) =>
      `(has_table_privilege('dsor_runtime', 'dsor.audit', '${privilege}') OR EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = 'dsor.audit'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege('dsor_runtime', 'dsor.audit', a.attname, '${privilege}')
        )) AS any_${i}`,
  );
  const tablewise = TABLE_ONLY.map(
    (privilege, i) =>
      `has_table_privilege('dsor_runtime', 'dsor.audit', '${privilege}') AS all_${i}`,
  );
  const held = await db.query<Record<string, boolean>>(
    `SELECT ${[...columnwise, ...tablewise].join(", ")}`,
  );
  const row = held.rows[0];

  return [
    ...PER_COLUMN.filter((_privilege, i) => row?.[`any_${i}`] === true),
    ...TABLE_ONLY.filter((_privilege, i) => row?.[`all_${i}`] === true),
  ].sort();
}

/** Can the application write this one column? `recorded_at` is the column it must not. */
async function mayInsertColumn(column: string): Promise<boolean> {
  const { rows } = await db.query<{ may: boolean }>(
    "SELECT has_column_privilege('dsor_runtime', 'dsor.audit', $1, 'INSERT') AS may",
    [column],
  );

  return rows[0]?.may === true;
}

describe("what the application may do to the log", () => {
  it("DSOR-AUD-04a: it may add a decision and read it back", async () => {
    expect(await asTheApplication(A_DECISION)).toBe("allowed");
    expect(await asTheApplication("SELECT 1 FROM dsor.audit")).toBe("allowed");
  });

  // The step's "done when", in one assertion.
  it("DSOR-AUD-04a: it may not change a decision that was written", async () => {
    await db.exec(A_DECISION);

    expect(await asTheApplication("UPDATE dsor.audit SET result = 'ALLOWED'")).toMatch(
      /permission denied for table audit/,
    );

    // And the record is untouched, which is the part that matters.
    const after = await db.query<{ result: string }>("SELECT result FROM dsor.audit");

    expect(after.rows[0]!.result).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-AUD-04a: it may not delete a decision, or empty the log", async () => {
    await db.exec(A_DECISION);

    // DELETE and TRUNCATE are different privileges. Revoking one leaves the other, and TRUNCATE
    // empties the whole table in a single statement — so a log the application can TRUNCATE is not
    // append-only, whatever else is true of it.
    expect(await asTheApplication("DELETE FROM dsor.audit")).toMatch(
      /permission denied for table audit/,
    );
    expect(await asTheApplication("TRUNCATE dsor.audit")).toMatch(
      /permission denied for table audit/,
    );

    const after = await db.query("SELECT 1 FROM dsor.audit");

    expect(after.rows).toHaveLength(1);
  });

  // Two ways round the privileges that a REVOKE on the table alone does not close.
  it("DSOR-AUD-04a: it may not drop the table, or make a table of its own", async () => {
    expect(await asTheApplication("DROP TABLE dsor.audit")).toMatch(/must be owner of table audit/);

    // A role that can create tables can create one called `audit` earlier on its own search path,
    // and then every INSERT lands somewhere nobody is auditing.
    expect(await asTheApplication("CREATE TABLE sneaky (x int)")).toMatch(
      /permission denied for schema public/,
    );
  });

  /**
   * It cannot grant itself the rights back — and the way PostgreSQL says so is the lesson.
   *
   * I wrote this test expecting the GRANT to be refused. It is **accepted**, with no error at all,
   * and it grants nothing: PostgreSQL raises a warning for a GRANT by someone who does not own the
   * object, not an error. So the statement "succeeded" and changed nothing.
   *
   * Which means **never test a GRANT or a REVOKE by whether the statement threw.** A migration full
   * of REVOKEs can run perfectly and leave every privilege in place. Test the privilege.
   */
  it("DSOR-AUD-04a: a GRANT it issues itself is accepted and does nothing", async () => {
    const before = await privilegesOfTheApplication();

    expect(before).toEqual(["INSERT", "SELECT"]);

    // No error. This is the trap.
    expect(await asTheApplication("GRANT UPDATE ON dsor.audit TO dsor_runtime")).toBe("allowed");

    // And nothing changed, which is the only thing worth asserting.
    expect(await privilegesOfTheApplication()).toEqual(["INSERT", "SELECT"]);
    expect(await asTheApplication("UPDATE dsor.audit SET result = 'ALLOWED'")).toMatch(
      /permission denied for table audit/,
    );
  });

  // The privileges themselves, read out of the catalogue rather than inferred from what failed.
  it("DSOR-AUD-04a: the application holds exactly INSERT and SELECT, and nothing else", async () => {
    expect(await privilegesOfTheApplication()).toEqual(["INSERT", "SELECT"]);
  });
});

describe("what the table itself refuses", () => {
  it("DSOR-AUD-01: two records cannot claim one position in a chain", async () => {
    await db.exec(A_DECISION);

    // Same chain, same sequence, different id — which is what two writers racing for slot 0 produce.
    const clash = A_DECISION.replace("'audit:org_456:0:0'", "'audit:org_456:0:0-other'");

    await expect(db.exec(clash)).rejects.toThrow(/duplicate key|unique constraint/i);
  });

  /**
   * One record id, twice — with a different chain and sequence, so this reaches the PRIMARY KEY and
   * not the UNIQUE (chain, sequence) beside it.
   *
   * The first version of this test reused the whole row, which the chain/sequence constraint caught
   * first. A mutation sweep showed the cost: turning `record_id TEXT PRIMARY KEY` into a plain
   * `NOT NULL` column left every test passing, so step 08's record-id finding was unprotected.
   */
  it("DSOR-AUD-01: one record id cannot be written twice, even in another chain", async () => {
    await db.exec(A_DECISION);

    // STEP 11: the row's company moves with its chain, or `chain_matches_tenant` refuses it
    // first and the primary key is never asked.
    const elsewhere = A_DECISION.replace("'audit:org_456', 0,", "'audit:org_999', 7,").replace(
      "'org_456', 'decision'",
      "'org_999', 'decision'",
    );

    await expect(db.exec(elsewhere)).rejects.toThrow(/duplicate key|unique constraint/i);
  });

  it("DSOR-AUD-01: a hash that is not a sha256 is refused", async () => {
    await expect(db.exec(A_DECISION.replace("'sha256:abc'", "'not-a-hash'"))).rejects.toThrow(
      /check constraint/i,
    );
  });

  it("DSOR-AUD-01: an authorization that is neither ALLOW nor DENY is refused", async () => {
    await expect(db.exec(A_DECISION.replace("'DENY'", "'MAYBE'"))).rejects.toThrow(
      /check constraint/i,
    );
  });

  it("DSOR-AUD-01: a negative sequence is refused", async () => {
    await expect(db.exec(A_DECISION.replace(", 0,\n", ", -1,\n"))).rejects.toThrow(
      /check constraint/i,
    );
  });

  /**
   * Every `NOT NULL` in `001_audit.sql`, one at a time.
   *
   * There are eleven of them and not one had a test. They are read out of the catalogue rather than
   * listed here, so a column that gains or loses `NOT NULL` changes what this test checks without
   * anybody remembering to update it — and a column added without `NOT NULL` that should have had it
   * shows up as a missing row in the count below.
   */
  it("DSOR-AUD-01: every required column is refused when it is missing", async () => {
    const required = await db.query<{ name: string }>(
      `SELECT a.attname AS name FROM pg_attribute a
       WHERE a.attrelid = 'dsor.audit'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attnotnull
         -- recorded_at is NOT NULL with a default, so leaving it out is not an error.
         AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
       ORDER BY a.attname`,
    );
    const names = required.rows.map((row) => row.name);

    // Pinned, so dropping a NOT NULL does not quietly shrink what this test covers.
    expect(names).toStrictEqual([
      "at",
      "chain",
      "correlation",
      "identity",
      "kind",
      "previous_hash",
      "record_hash",
      "record_id",
      "result",
      "sequence",
      "tenant",
    ]);

    for (const missing of names) {
      // The valid INSERT, with one column and its value taken out.
      const withoutIt = A_DECISION.replace(
        /\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)$/,
        (_whole, columnList: string, values: string) => {
          const columns = columnList.split(",").map((one) => one.trim());
          const at = columns.indexOf(missing === "authorization" ? '"authorization"' : missing);
          const given = splitValues(values);

          columns.splice(at, 1);
          given.splice(at, 1);

          return `(${columns.join(", ")}) VALUES (${given.join(", ")})`;
        },
      );

      await expect(db.exec(withoutIt), `missing ${missing}`).rejects.toThrow(
        /null value in column|violates not-null/i,
      );
    }
  });

  it("DSOR-AUD-04b: a previous_hash that is not a sha256 is refused", async () => {
    // `record_hash` had this test and `previous_hash` did not, though both carry the same CHECK.
    // The chain's first link is the one that matters most: a genesis hash of the wrong shape would
    // make every verification downstream meaningless.
    for (const wrong of ["", "nothing", "md5:abc", "sha256:", "sha256:zz!!", " sha256:abc"]) {
      const forged = A_DECISION.replace(
        "'sha256:0000000000000000000000000000000000000000000000000000000000000000'",
        `'${wrong}'`,
      );

      await expect(db.exec(forged), JSON.stringify(wrong)).rejects.toThrow(
        /violates check constraint/i,
      );
    }
  });

  it("DSOR-AUD-01: there is one index on (chain, sequence), not two", async () => {
    // `UNIQUE (chain, sequence)` is implemented as an index, and `001_audit.sql` also had a
    // `CREATE INDEX` on the same two columns with a comment claiming reads would otherwise scan the
    // whole table. Measured: two identical btrees, the second buying nothing and costing a write on
    // every INSERT.
    const indexes = await db.query<{ definition: string }>(
      `SELECT indexdef AS definition FROM pg_indexes
       WHERE tablename = 'audit' AND indexdef LIKE '%(chain, sequence)'`,
    );

    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.definition).toContain("UNIQUE");
  });
});

describe("the REVOKE lines, where there is something to revoke", () => {
  /**
   * These prove the REVOKEs do what they say — which no other test here can, because on a fresh
   * table there is nothing for them to take away.
   *
   * That was the finding. I wrote `002_runtime_user.sql` believing the REVOKEs were what made the
   * log safe, and a mutation sweep deleted each one with every test still passing. Measured against
   * PostgreSQL 18: a fresh table grants nobody anything, so the narrow GRANT is the whole guarantee
   * and the REVOKEs remove nothing.
   *
   * They are still worth having, for a database somebody has already been administering. So these
   * tests grant something first, and then check it is gone.
   */
  it("DSOR-AUD-04a: a privilege granted to PUBLIC is taken away again", async () => {
    // The mistake these lines defend against: somebody grants to PUBLIC, which is every role there
    // is, so the application gets UPDATE without anybody granting it to the application.
    //
    // All three of UPDATE, DELETE and TRUNCATE, and that is the point. This test granted only
    // UPDATE, and `REVOKE ALL ON audit FROM PUBLIC` narrowed to `REVOKE UPDATE ON audit FROM
    // PUBLIC` left all 301 tests passing — because the one privilege the test granted was the one
    // the narrowed line still removed. Measured with the narrowed line:
    //
    //     after REVOKE UPDATE FROM PUBLIC:   UPDATE=false DELETE=true TRUNCATE=true
    //
    // A log the application can DELETE from or TRUNCATE is not append-only, so the test has to
    // grant everything the line claims to take back.
    await db.exec("GRANT UPDATE, DELETE, TRUNCATE ON dsor.audit TO PUBLIC;");
    await db.exec(A_DECISION);

    // Not testing nothing: all three really do reach the application through PUBLIC.
    expect(await privilegesOfTheApplication()).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "TRUNCATE",
      "UPDATE",
    ]);
    expect(await asTheApplication("UPDATE dsor.audit SET result = 'ALLOWED'")).toBe("allowed");

    // Re-running the migration takes them back.
    await reapplyThePermissions();

    for (const forbidden of [
      "UPDATE dsor.audit SET result = 'ALLOWED'",
      "DELETE FROM dsor.audit",
      "TRUNCATE dsor.audit",
    ]) {
      expect(await asTheApplication(forbidden), forbidden).toMatch(
        /permission denied for table audit/,
      );
    }

    // And the rights it does need survived the revoke-and-regrant.
    expect(await privilegesOfTheApplication()).toEqual(["INSERT", "SELECT"]);
  });

  /**
   * Granted directly to the application, then taken back **by the migration**.
   *
   * The first version of this test issued its own `REVOKE`, which proved PostgreSQL works and said
   * nothing about our file: deleting the REVOKE line from `002_runtime_user.sql` left it passing.
   * Re-running the migration is what makes that line load-bearing, and TRUNCATE is listed separately
   * below because it is its own privilege and the easiest of the three to leave out.
   */
  it("DSOR-AUD-04a: privileges granted directly are taken back by the migration", async () => {
    await db.exec("GRANT UPDATE, DELETE, TRUNCATE ON dsor.audit TO dsor_runtime;");

    expect(await privilegesOfTheApplication()).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "TRUNCATE",
      "UPDATE",
    ]);

    await reapplyThePermissions();

    expect(await privilegesOfTheApplication()).toEqual(["INSERT", "SELECT"]);
  });

  it("DSOR-AUD-04a: TRUNCATE in particular is taken back", async () => {
    await db.exec("GRANT TRUNCATE ON dsor.audit TO dsor_runtime;");
    await db.exec(A_DECISION);

    expect(await asTheApplication("TRUNCATE dsor.audit")).toBe("allowed");

    await db.exec(A_DECISION);
    await reapplyThePermissions();

    expect(await asTheApplication("TRUNCATE dsor.audit")).toMatch(
      /permission denied for table audit/,
    );

    const left = await db.query("SELECT 1 FROM dsor.audit");

    expect(left.rows).toHaveLength(1);
  });
});

describe("the database's own witness", () => {
  /**
   * Step 08's clock debt, half paid.
   *
   * `at` is the application's claim and is inside the hash, so it has to be the application's — the
   * hash is computed before the row exists and UPDATE is revoked afterwards, so there is no moment
   * at which the database could stamp it and still be covered.
   *
   * `recorded_at` is the database's, which the application cannot set. A backdated record therefore
   * arrives with its two times far apart, and that gap is the evidence.
   */
  it("DSOR-AUD-04b: a backdated record is written, and its two times disagree", async () => {
    await db.exec(A_DECISION.replace("'2026-10-02T09:14:00Z'", "'2019-01-01T00:00:00Z'"));

    const row = await db.query<{ at: Date; recorded_at: Date }>(
      "SELECT at, recorded_at FROM dsor.audit",
    );
    const { at, recorded_at } = row.rows[0]!;

    expect(at.getUTCFullYear()).toBe(2019);

    // Near **now**, not merely far from `at`. The first version asserted only the gap, and a
    // mutation sweep walked straight through it: replacing `DEFAULT now()` with a hardcoded 2026
    // timestamp kept the gap wide and the test green, which would have left the witness asserting
    // nothing about when the row was actually written.
    const secondsAgo = (Date.now() - recorded_at.getTime()) / 1000;

    expect(secondsAgo).toBeGreaterThanOrEqual(0);
    expect(secondsAgo).toBeLessThan(60);
  });

  /**
   * This test's title said "the application cannot set recorded_at" and its body said the opposite:
   * "the application CAN set it, and what it cannot do is change it afterwards." Both were in the
   * file at once, and the body was right. Two things were wrong with it.
   *
   * It ran as the **owner**, through `db.exec`, which can set any column and proves nothing about
   * the application. And a table-level `GRANT INSERT ON audit` covers every column, so the
   * application really could forge the witness:
   *
   *     INSERT SUCCEEDED. at=2026-10-04 05:00:00+05  recorded_at=1999-01-01 05:00:00+05
   *
   * The point of `recorded_at` is to be a time the application did not choose, so the fix was to
   * make the title true rather than to soften it. `002_runtime_user.sql` grants INSERT column by
   * column and leaves `recorded_at` out.
   */
  it("DSOR-AUD-04b: the application cannot set recorded_at", async () => {
    const forged = A_DECISION.replace("record_id, chain", "recorded_at, record_id, chain").replace(
      "VALUES (\n  'audit",
      "VALUES (\n  '2019-01-01T00:00:00Z', 'audit",
    );

    // As the application, which is the only account the claim is about.
    expect(await asTheApplication(forged)).toMatch(/permission denied for table audit/);
    expect(await mayInsertColumn("recorded_at")).toBe(false);

    // Nothing was written, so there is no forged witness to find.
    const rows = await db.query("SELECT 1 FROM dsor.audit");

    expect(rows.rows).toHaveLength(0);
  });

  it("the application can still write every other column, and read this one", async () => {
    // The other half, and the reason a column-level grant is a real cost rather than free: leave a
    // column out by accident and the application stops being able to record anything at all. Each
    // column it does need is checked by name, so a future column added to `audit` without being
    // added to the grant fails here rather than in production.
    const columns = await db.query<{ name: string }>(
      `SELECT a.attname AS name FROM pg_attribute a
       WHERE a.attrelid = 'dsor.audit'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
    );

    expect(columns.rows.length).toBeGreaterThan(10);

    for (const { name } of columns.rows) {
      expect(await mayInsertColumn(name), `INSERT on ${name}`).toBe(name !== "recorded_at");
    }

    // And it can read the witness. A log the application cannot read is not a log it can verify.
    await db.exec(A_DECISION);

    expect(await asTheApplication("SELECT recorded_at FROM dsor.audit")).toBe("allowed");
  });
});

describe("erasing the log, which only a test may do", () => {
  it("DSOR-AUD-04c: forgetTheLog erases this chain and leaves every other chain alone", async () => {
    // The chain filter is claimed in audit.ts and was tested by nothing: `DELETE FROM public.audit`
    // with no WHERE survived every test. One chain today; step 10 brings a second tenant, and a test
    // for the first tenant that wipes the second's history is the bug this prevents.
    await db.exec(A_DECISION);
    await db.exec(
      A_DECISION.replace(
        "'audit:org_456:0:0', 'audit:org_456'",
        "'audit:org_999:0:0', 'audit:org_999'",
      ).replace("'org_456', 'decision'", "'org_999', 'decision'"), // STEP 11: chain and company agree
    );

    const before = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM dsor.audit");

    expect(before.rows[0]?.n).toBe("2");

    useDatabase(overPGlite(db));
    await forgetTheLog("org_456");

    const left = await db.query<{ chain: string }>("SELECT chain FROM dsor.audit");

    expect(left.rows.map((r) => r.chain)).toStrictEqual(["audit:org_999"]);
  });
});

describe("a table the application makes to stand in front of the real one", () => {
  /**
   * The attack, and it is the quietest one in this step.
   *
   * `dsor_runtime` may not UPDATE or DELETE the audit log. It may still **create a temporary
   * table**, because `TEMPORARY` on a database is granted to `PUBLIC` by default — and `pg_temp` is
   * searched *before* `public`, implicitly, whatever `search_path` says. So an unqualified
   * `INSERT INTO audit` lands in the application's own throwaway table, which disappears when the
   * connection closes.
   *
   * Measured, before every table name was schema-qualified:
   *
   *     the application CAN create a temp table called audit
   *     after one audit() call:  public.audit has 0 row(s),  pg_temp.audit has 1
   *     theLog("org_456") reports 1 record(s)
   *
   * Nothing refuses, nothing is logged, and the program reports a healthy audit trail while the
   * real one stays empty. That is a complete bypass of `DSOR-AUD-01` reachable from the
   * application's own account, and the privilege system cannot stop it — taking `TEMPORARY` away
   * would close this door and is not portable to write in a migration, and `search_path` cannot
   * demote `pg_temp` for an unqualified name.
   *
   * What closes it is naming the schema: `dsor.audit`, every time, in every statement.
   */
  it("DSOR-AUD-01: a temp table named `audit` does not catch the log", async () => {
    await db.exec("SET ROLE dsor_runtime;");
    await db.exec("CREATE TEMP TABLE audit (LIKE dsor.audit INCLUDING ALL)");

    // Not testing nothing: the shadow table really does exist and really is found first. The bare
    // name, on purpose: it is what a statement that forgot the schema would ask for.
    const resolved = await db.query<{ schema: string }>(
      `SELECT n.nspname AS schema FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.oid = 'audit'::regclass`,
    );

    expect(resolved.rows[0]?.schema).toMatch(/^pg_temp/);

    useDatabase(overPGlite(db));

    await audit({
      kind: "decision",
      subject: "user_123",
      tenant: "org_456",
      requestId: "req_1",
      operation: "invoice.get@1",
      authorization: "ALLOW",
      result: "ALLOWED",
    });

    // Counted as the owner: under the lock the application sees only rows of a company it has
    // said, and this count is about which table the row went to, not whose it is.
    await db.exec("RESET ROLE;");

    const real = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM dsor.audit");
    const shadow = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_temp.audit");

    expect(real.rows[0]?.n).toBe("1");
    expect(shadow.rows[0]?.n).toBe("0");
    expect(await theLog("org_456")).toHaveLength(1);

    await db.exec("RESET ROLE;");
  });

  it("DSOR-AUD-01: every statement that names a table of ours names its schema", async () => {
    // The guard above proves one statement. This one proves there is no second statement that was
    // missed — anywhere SQL that touches `audit` or `applied_migrations` is written: the source,
    // the migrate script, the migration files, and the test support that erases the table.
    //
    // The first version scanned `src/audit.ts` only, under a commit titled "every table name names
    // its schema", while `CREATE TABLE audit` and three `ON audit` sat in the migrations and a
    // `DELETE FROM audit` in test support. A review listed them. The migration ones matter most:
    // `GRANT ... ON audit` resolves through `search_path` like any query, so a `pg_temp.audit` in
    // the owner's session would have taken the grant and left the real table with nothing.
    //
    // Comments are stripped first, because several of them quote the unqualified form on purpose
    // to say what was wrong. Each keyword gets its own regex: one alternation would consume
    // `TRUNCATE ON` as a match and skip the `audit` that follows.
    const root = fileURLToPath(new URL("..", import.meta.url));
    const files = [
      ...readdirSync(join(root, "src"), { recursive: true }).map((f) => join("src", String(f))),
      ...readdirSync(join(root, "scripts")).map((f) => join("scripts", f)),
      ...readdirSync(join(root, "migrations")).map((f) => join("migrations", f)),
      ...readdirSync(join(root, "test", "support")).map((f) => join("test", "support", f)),
    ].filter((f) => f.endsWith(".ts") || f.endsWith(".sql"));

    expect(files.length).toBeGreaterThan(10);

    const unqualified: string[] = [];

    for (const file of files) {
      const raw = readFileSync(join(root, file), "utf8");
      const code = file.endsWith(".sql")
        ? raw.replace(/--[^\n]*/g, "")
        : raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

      // Case-insensitive, because SQL is: `from audit` and `From Audit` passed the first version. A
      // review also added LOCK and REFERENCES, and the regclass cast — `'audit'::regclass` resolves
      // through `search_path` exactly like a bare name, so `pg_temp.audit` wins there too.
      for (const keyword of [
        "FROM",
        "INTO",
        "UPDATE",
        "JOIN",
        "TRUNCATE",
        "COPY",
        "LOCK",
        "REFERENCES",
        "ON",
        "TABLE",
        "EXISTS",
      ]) {
        const each = new RegExp(`\\b${keyword}\\s+("?[\\w.]+"?)`, "gi");

        for (const match of code.matchAll(each)) {
          const named = match[1]!.replace(/"/g, "").toLowerCase();

          if (named === "audit" || named === "applied_migrations" || named === "invoices") {
            unqualified.push(`${file}: ${keyword} ${named}`);
          }
        }
      }

      for (const match of code.matchAll(
        /'(audit|applied_migrations|invoices)'\s*::\s*regclass/gi,
      )) {
        unqualified.push(`${file}: ${match[0]}`);
      }
    }

    expect(unqualified).toStrictEqual([]);
  });
});
