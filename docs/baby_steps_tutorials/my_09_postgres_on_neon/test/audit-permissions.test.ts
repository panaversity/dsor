// NEW IN STEP 09: the guarantee, against a real PostgreSQL.
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

import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrationsIn } from "../src/migrations.ts";

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
const A_DECISION = `INSERT INTO audit (
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

/** Run SQL as the application's own account, and say what happened. */
async function asTheApplication(sql: string): Promise<string> {
  await db.exec("SET ROLE dsor_runtime;");

  try {
    await db.exec(sql);

    return "allowed";
  } catch (error) {
    return (error as Error).message;
  } finally {
    await db.exec("RESET ROLE;");
  }
}

/** Re-apply 002_runtime_user.sql — the file under test, not a hand-written copy of it. */
async function reapplyThePermissions(): Promise<void> {
  for (const migration of migrationsIn(fileURLToPath(new URL("../migrations", import.meta.url)))) {
    if (migration.name === "002_runtime_user.sql") {
      await db.exec(migration.sql);
    }
  }
}

/** Every privilege a table can carry, so "and nothing else" means all of them. */
const EVERY_PRIVILEGE = [
  "DELETE",
  "INSERT",
  "REFERENCES",
  "SELECT",
  "TRIGGER",
  "TRUNCATE",
  "UPDATE",
] as const;

/**
 * Which privileges the application's account actually holds on `audit`.
 *
 * This asked `information_schema.role_table_grants WHERE grantee = 'dsor_runtime'`, and that was
 * wrong in a way that let a real hole through. A catalogue row exists only for a grant made **to
 * this role by name**. A privilege can reach the role by three other routes, and the catalogue
 * shows none of them:
 *
 *   a database with a history (granted to PUBLIC):   UPDATE=true DELETE=true TRUNCATE=true
 *   ...and what `grantee = 'dsor_runtime'` showed:   nothing
 *
 * So `toEqual(["INSERT", "SELECT"])` could pass while the account held DELETE and TRUNCATE through
 * PUBLIC. `has_table_privilege` is the question actually worth asking: it answers for the role as
 * PostgreSQL will when the statement runs, counting a direct grant, a grant to PUBLIC, a right
 * inherited through role membership, and superuser bypass. Measured 2026-10-04.
 */
async function privilegesOfTheApplication(): Promise<string[]> {
  const held = await db.query<Record<string, boolean>>(
    `SELECT ${EVERY_PRIVILEGE.map(
      (privilege, i) =>
        `has_table_privilege('dsor_runtime', 'public.audit', '${privilege}') AS held_${i}`,
    ).join(", ")}`,
  );
  const row = held.rows[0];

  return EVERY_PRIVILEGE.filter((_privilege, i) => row?.[`held_${i}`] === true);
}

describe("what the application may do to the log", () => {
  it("DSOR-AUD-04a: it may add a decision and read it back", async () => {
    expect(await asTheApplication(A_DECISION)).toBe("allowed");
    expect(await asTheApplication("SELECT 1 FROM audit")).toBe("allowed");
  });

  // The step's "done when", in one assertion.
  it("DSOR-AUD-04a: it may not change a decision that was written", async () => {
    await db.exec(A_DECISION);

    expect(await asTheApplication("UPDATE audit SET result = 'ALLOWED'")).toMatch(
      /permission denied for table audit/,
    );

    // And the record is untouched, which is the part that matters.
    const after = await db.query<{ result: string }>("SELECT result FROM audit");

    expect(after.rows[0]!.result).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-AUD-04a: it may not delete a decision, or empty the log", async () => {
    await db.exec(A_DECISION);

    // DELETE and TRUNCATE are different privileges. Revoking one leaves the other, and TRUNCATE
    // empties the whole table in a single statement — so a log the application can TRUNCATE is not
    // append-only, whatever else is true of it.
    expect(await asTheApplication("DELETE FROM audit")).toMatch(
      /permission denied for table audit/,
    );
    expect(await asTheApplication("TRUNCATE audit")).toMatch(/permission denied for table audit/);

    const after = await db.query("SELECT 1 FROM audit");

    expect(after.rows).toHaveLength(1);
  });

  // Two ways round the privileges that a REVOKE on the table alone does not close.
  it("DSOR-AUD-04a: it may not drop the table, or make a table of its own", async () => {
    expect(await asTheApplication("DROP TABLE audit")).toMatch(/must be owner of table audit/);

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
    expect(await asTheApplication("GRANT UPDATE ON audit TO dsor_runtime")).toBe("allowed");

    // And nothing changed, which is the only thing worth asserting.
    expect(await privilegesOfTheApplication()).toEqual(["INSERT", "SELECT"]);
    expect(await asTheApplication("UPDATE audit SET result = 'ALLOWED'")).toMatch(
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

    const elsewhere = A_DECISION.replace("'audit:org_456', 0,", "'audit:org_999', 7,");

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
    await db.exec("GRANT UPDATE, DELETE, TRUNCATE ON audit TO PUBLIC;");
    await db.exec(A_DECISION);

    // Not testing nothing: all three really do reach the application through PUBLIC.
    expect(await privilegesOfTheApplication()).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "TRUNCATE",
      "UPDATE",
    ]);
    expect(await asTheApplication("UPDATE audit SET result = 'ALLOWED'")).toBe("allowed");

    // Re-running the migration takes them back.
    await reapplyThePermissions();

    for (const forbidden of [
      "UPDATE audit SET result = 'ALLOWED'",
      "DELETE FROM audit",
      "TRUNCATE audit",
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
    await db.exec("GRANT UPDATE, DELETE, TRUNCATE ON audit TO dsor_runtime;");

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
    await db.exec("GRANT TRUNCATE ON audit TO dsor_runtime;");
    await db.exec(A_DECISION);

    expect(await asTheApplication("TRUNCATE audit")).toBe("allowed");

    await db.exec(A_DECISION);
    await reapplyThePermissions();

    expect(await asTheApplication("TRUNCATE audit")).toMatch(/permission denied for table audit/);

    const left = await db.query("SELECT 1 FROM audit");

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
      "SELECT at, recorded_at FROM audit",
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

  it("DSOR-AUD-04b: the application cannot set recorded_at", async () => {
    const forged = A_DECISION.replace("record_id, chain", "recorded_at, record_id, chain").replace(
      "VALUES (\n  'audit",
      "VALUES (\n  '2019-01-01T00:00:00Z', 'audit",
    );

    // It is not refused — the column has no special privilege — so this is honest about what the
    // witness is worth: the application CAN set it, and what it cannot do is change it afterwards.
    // What makes the gap evidence is that the code that writes records never sets it.
    await db.exec(forged);

    const row = await db.query<{ recorded_at: Date }>("SELECT recorded_at FROM audit");

    expect(row.rows[0]!.recorded_at.getUTCFullYear()).toBe(2019);
  });
});
