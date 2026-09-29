# Step 11 · Row-level security

**New in this step:** the second lock. PostgreSQL itself filters every row by company,
so a query that forgets the company still cannot leak another company's data
(DSOR-TEN-01b, DSOR-RP-01a to DSOR-RP-01d).

## In plain words

Step 10 taught DSoR's own code to keep companies apart. Every query says
`WHERE tenant_id = $1`. That is one lock, and every query, written by every developer,
must remember it.

**Row-level security** adds a second lock inside the database. A **policy** is a rule
attached to a table, and PostgreSQL adds it to every query on that table by itself:

```sql
CREATE POLICY tenant_isolation ON app.invoices
  USING (tenant_id = current_setting('dsor.tenant_id', true));
```

DSoR tells the database which company a piece of work is for, at the start of a
**transaction** (a group of statements that succeed or fail together):

```sql
BEGIN;
SELECT set_config('dsor.tenant_id', 'org_456', true);  -- true: only until COMMIT
SELECT … FROM app.invoices WHERE id = 'INV-1008';        -- filtered by the policy
COMMIT;
```

When no company is set, the setting is empty, the policy matches nothing, and the query
returns no rows. A forgotten company shows nothing, never everything. This is the lock
that stays locked when the power fails, from the house list of analogies.

## Why it matters

**One forgotten line leaked a company in step 10.** Break U1 took `tenant_id = $1 AND`
out of the invoice query. `org_789` asked for its `INV-1008` and received `org_456`'s.
All 573 unit tests stayed green. Only the database tests noticed, and CI does not run
them.

**A setting can leak through a shared connection.** A pool lends the same connection to
one request after another. A company set for the whole connection is still there for
the next request, which may be for another company. This was run on a local PostgreSQL
while this step was designed, with a pool of one connection:

```text
request 1 (org_456) sets org_456 for the connection, reads   → org_456/INV-1008
request 2 (org_789) forgets to set a company, reads          → org_456/INV-1008
```

**Common mistake:** §36 names two: "The table owner bypasses RLS unless you `FORCE` it.
And with connection pooling, a tenant setting made per connection leaks into the next
request that reuses the connection, so set it per transaction." A third, found live on
2026-09-29: Neon's `neondb_owner` holds `BYPASSRLS`, which ignores every policy, `FORCE`
included.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of the specification it relies on was read on
2026-09-29: §14 (DSOR-TEN-01b, DSOR-TEN-01c, DSOR-TEN-02a), §36 (its text, its example,
and DSOR-RP-01a to DSOR-RP-01d), and §29 on refusals before a tenant is known. Every
PostgreSQL behaviour it relies on was run on a local PostgreSQL 17 the same day, and the
two roles' attributes were read from the Neon branch `step-10`. If the code finds the
plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** A bug in one query cannot leak a company. The database keeps companies apart
by itself, as a second lock that does not depend on DSoR's code remembering. The analogy
is the lock that stays locked when the power fails: no company set, no rows.

**Outcome.** What is true when this step is done:

1. Every table with a company column has row-level security enabled and forced, and a
   policy. A new table without them fails a test.
2. As `dsor_runtime`, a query that forgets the company returns only the active company's
   rows. Step 10's break U1 becomes harmless.
3. With no company set, every query on those tables returns no rows.
4. A company set for one request is gone for the next request on the same connection.
5. `dsor_runtime` can write an audit record only for the company set in its transaction,
   or with no company when none is set, and reads only the active company's records.
6. `dsor_runtime` is not a superuser, does not hold `BYPASSRLS`, and owns no table.

**Not the outcome of this step.** The suite that calls every operation with another
company's URI (step 12). Joins and foreign keys between tenant tables: there is only one
business table yet (see decision 9). Reading the log as an auditor (DSOR-AUD-05b).

**The success signals**, each a test that fails if this step's code is deleted:

- As `dsor_runtime`, inside `org_456`, `SELECT … FROM app.invoices WHERE id =
  'INV-1008'`, with no company in the SQL, returns only `org_456`'s row.
- As `dsor_runtime`, with no company set, `SELECT … FROM app.invoices` returns no rows.
- A pool of one connection: a request sets `org_456` and ends. The next request sets no
  company and reads no rows.

**A limit, not a signal.** `neondb_owner` holds `BYPASSRLS`, so it sees every row
whatever this step does. Nothing inside a table can stop such a role. The defence is that
the program never runs as it: step 09's start-up check refuses that login.

### What the specification asks, and what this step can honestly give

Checked on 2026-09-29:

1. **DSOR-TEN-01b asks for two independent layers.** Step 10 built the first, in DSoR's
   code. This step builds the second, in the store. Each is tested on its own: step 10's
   unit tests need no database, and this step's database tests run SQL that leaves the
   company out.
2. **DSOR-RP-01a** says `dsor_runtime` "MUST NOT be a superuser, hold `BYPASSRLS`, or own
   tenant tables". Step 09 already checks all three, in a test and at start-up. This step
   claims the rule.
3. **DSOR-RP-01d** says a query with no tenant setting "MUST yield no rows". It holds for
   the audit table too, which is why a record with no company is write-only for
   `dsor_runtime` (decision 4).
4. **§36's example sets `dsor.principal_id` too.** Nothing reads it yet, so this step
   sets only the company.
5. **§29 allows refusals before a tenant is known to be counted instead of recorded one
   by one.** Step 10 records each with no company. This step keeps that, and the policy
   decides who may read those records.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-RP-01b | **C1.** Every tenant table uses `FORCE ROW LEVEL SECURITY` | A catalog query finds every table outside PostgreSQL's own schemas with a `tenant_id` or `tenant` column, and each one has row-level security enabled and forced, and at least one policy |
| DSOR-TEN-01b | **C2.** The store keeps companies apart when DSoR's query forgets to | As `dsor_runtime`, inside `org_456`, SQL with no company returns only `org_456`'s rows, and inside `org_789` only `org_789`'s |
| DSOR-RP-01d | **C3.** No company set, no rows | A fresh connection, and a reused one, with no company set: no invoice rows and no audit rows |
| DSOR-RP-01c | **C4.** The company lasts one transaction | A pool of one connection: after a request for `org_456` ends, the next request, which sets nothing, reads nothing |
| DSOR-TEN-02a, the audit part | **C5.** The log is kept apart by company | `dsor_runtime` in `org_456` cannot write a record for `org_789` and cannot read one. A record with no company is written when no company is set, and `dsor_runtime` cannot read it back |
| DSOR-RP-01a | **C6.** `dsor_runtime` holds no power that skips the policies | Step 09's checks: not a superuser, no `BYPASSRLS`, owns no table |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **Every table with a company column gets `ENABLE` and `FORCE ROW LEVEL SECURITY`:**
   `app.invoices` in migration `004`, and `dsor.audit` in migration `005`, one file for
   each lock, so each lands with the code it needs. `dsor.migrations` has no company and
   `dsor_runtime` has no privilege on it, so it gets none. *Downside:* `FORCE` changes
   nothing for `dsor_runtime`, which owns no table. It guards against a future owner who
   is not `BYPASSRLS`, and only the catalog test can see it (break V2).
2. **The company is read as `nullif(current_setting('dsor.tenant_id', true), '')`.** On
   a fresh connection an unset value is `NULL`. On a connection that has held a
   transaction-local value, it is `''` after that transaction ends. This was run on a
   local PostgreSQL 17 on 2026-09-29. `nullif` makes both mean "no company". *Downside:*
   the policies are longer than §36's example, and a reader must learn why.
3. **Every touch of a company's table is one transaction that sets the company first:** a
   helper runs `BEGIN`, `set_config('dsor.tenant_id', $1, true)`, the work, and `COMMIT`,
   and it rolls back on any error. Line ⑨'s read and line ⑪'s record are two separate
   transactions, each with the call's company. A call refused before line ② has no
   company, so its record's transaction sets none. No code sets the company any other way,
   and `set_config(…, false)` never appears. The start-up check reads no company's table,
   so it stays a plain query. *Downside:* each call makes two round trips of four
   statements, where step 10 made two of one.
4. **The audit table has two policies.** Writing:
   `WITH CHECK (tenant IS NOT DISTINCT FROM <the company>)`, so a record carries exactly
   the company set in its transaction, or none when none is set. Reading:
   `USING (tenant = <the company>)`, so `dsor_runtime` reads only the active company's
   records, and a record with no company is never visible to it. Those records are
   write-only for the program, like the letterbox of step 09. *Downside:* a test that
   checks a record with no company must read it through the owner. It does so in a child
   program and redacts its output, as step 09's finding 3 taught.
5. **The invoice policy is §36's own form, for all commands:**
   `USING (tenant_id = <the company>)`. `dsor_runtime` may only `SELECT` invoices, so the
   policy's check on writes waits for the first command that writes. *Downside:* none
   yet. A write policy is tested when there is a write.
6. **The database log reads one company at a time.** Its `records()` becomes
   `records(tenant)`, because under the policy there is no "every record" for
   `dsor_runtime`. `call` uses only `add`, so the type every log shares keeps only `add`.
   The memory log of the unit tests keeps `records()`: keeping companies apart is the
   database's job, and AGENTS.md says it is never proved against a mock. The program
   prints the 9 records it can read, both companies merged by number, and says that its 3
   calls with no company left records it cannot read. *Downside:* step 08's shape of the
   log changes again, and the program can no longer show every record it wrote.
7. **The start-up check stays as step 09 built it.** It already refuses a login that is
   a superuser, holds `BYPASSRLS`, owns tables, or belongs to `pg_write_all_data`. The
   map's step 11 asks for such a check. It exists. *Downside:* none. It is proven again
   here by break V6.
8. **The pooling test uses the program's own pool, `pg.Pool`, with one connection.**
   That is deterministic. Neon's pooled address, which hands a connection to another
   program after each transaction, is shown once in "Break it" and not tested.
   *Downside:* the Neon pooler is demonstrated, not guarded by a test.
9. **A rule written now, for the tables to come:** every join between tenant tables
   includes `tenant_id`, and every foreign key between them starts with the row's own
   `tenant_id`, as in `FOREIGN KEY (tenant_id, invoice_id) REFERENCES app.invoices
   (tenant_id, id)`. PostgreSQL checks keys without applying policies, so a key with a
   separate tenant column can point into another company and reveal whether a row exists
   there. This was run on a local PostgreSQL 17 on 2026-09-29: a payment in `org_456`
   was linked to `org_789`'s `INV-2001`, which `org_456` cannot see, and a missing
   invoice gave an error instead. There is only one business table yet, so this step
   writes the rule and tests nothing for it. *Downside:* a rule with no test waits for the
   step that adds a second table.

### The tests, by claim

- **C1:** the catalog query lists `app.invoices` and `dsor.audit`, each with
  `relrowsecurity` and `relforcerowsecurity` true and a policy. A table added with a
  company column and no policy fails it.
- **C2:** as `dsor_runtime`, inside `org_456`, `SELECT tenant_id, id FROM app.invoices
  WHERE id = 'INV-1008'` gives exactly `org_456`'s row. Inside `org_789`, exactly
  `org_789`'s. `SELECT count(*) FROM app.invoices` inside `org_456` counts only its rows.
- **C3:** no company set, on a fresh connection and on one that has just ended a
  transaction for `org_456`: `app.invoices` gives no rows, and `dsor.audit` gives none.
- **C4:** a pool of one connection. Request 1 runs inside `org_456`. Request 2 runs
  `SELECT … FROM app.invoices` with no company: no rows.
- **C5:** inside `org_456`, an `INSERT` into `dsor.audit` with `tenant = 'org_789'` fails
  with the policy's error, `42501`. With no company set, an `INSERT` with no tenant
  succeeds, and a `SELECT` with no company set cannot see it. Inside `org_456`, the
  records read back are only `org_456`'s. A call with no login still leaves its record:
  the owner, in a child program with redacted output, finds it. On a pool of one
  connection, a call with no login right after a call in `org_456` is still recorded: it
  answers `AUTHENTICATION_REQUIRED`, not `EVIDENCE_STORE_UNAVAILABLE`.
- **C6:** step 09's role checks, now titled DSOR-RP-01a.
- **The program as a whole:** every step 10 test still passes, now through the
  transactions of decision 3, with three changes. A test that reads `dsor.audit` as
  `dsor_runtime` reads inside the record's company, because without one an empty answer
  proves nothing. A test that reads a record with no company reads it through the owner
  (decision 4). The program prints 9 of its 12 records (decision 6).

### Breaks we will try, and what we expect

Run against the finished step, against a real database. The learner's predictions were
recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| V1 | The company is set for the connection, `set_config(…, false)` | C4 | C4, the pool test |
| V2 | `FORCE` is removed from `app.invoices` | only C1, the catalog test | only a catalog test catches it |
| V3 | Row-level security stays enabled, and the invoice policy is dropped | every invoice read: no policy means no rows at all | zero rows, always |
| V4 | The helper sets the company with `true` but runs no `BEGIN` | every invoice read: the setting ends with its own statement | only the pool test |
| V5 | Step 10's U1: the invoice SQL forgets `tenant_id` | nothing. The second lock makes it harmless, which is the point | survives, harmlessly |
| V6 | `dsor_runtime` is given `BYPASSRLS` | C6 and the start-up check | C6 and the start-up check |
| V7 | The audit policies use `current_setting` without `nullif` | only C5's pool test: a record with no company written on a reused connection fails, and the call answers `EVIDENCE_STORE_UNAVAILABLE` | only on a reused connection |

The review also attacks the step with the cross-tenant threats of §10.2, now against the
store: a query, a setting, or a connection that crosses from one company into another.

### Left open, and not this step's idea

- **Every operation called with another company's URI:** step 12 (DSOR-TEN-02b).
- **Joins and foreign keys between tenant tables:** decision 9's rule, tested when a
  second business table arrives.
- **`dsor.principal_id`** in the transaction, as §36 shows: when something reads it.
- **Reading the log as an auditor**, with its own authorization (DSOR-AUD-05b).
- **Neon's pooler under a test**, not only a demonstration.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup
itself, this way:

1. Create a branch `step-11` **from `step-10`**, with the Neon MCP server or with
   `neonctl branches create`.
2. **By hand, in the Neon console:** reset `neondb_owner`'s password on `step-11`. The
   old one appeared in step 09's transcript, and a branch copies its parent's roles.
3. Write `.env` with `neonctl connection-string`, its output redirected into the file,
   never printed: the owner's string as `DSOR_MIGRATION_URL`, and the same string with
   the user `dsor_runtime` and a new random password (letters and digits) as
   `DSOR_DB_URL`. Both with `sslmode=verify-full`.
4. Run `pnpm migrate`. It sets `dsor_runtime`'s password from `DSOR_DB_URL`.
5. Check without looking: `pnpm test:db` passes, and the transcript holds no
   `postgresql://` with a password in it.

## What changed since step 10

| File | What changed |
| --- | --- |
| `migrations/004_invoices_row_level_security.sql` | **New.** `app.invoices`: row-level security enabled and forced, and the policy `tenant_isolation` |
| `migrations/005_audit_row_level_security.sql` | **New.** `dsor.audit`: enabled and forced, `audit_write` for `INSERT` and `audit_read` for `SELECT` (decision 4) |
| `src/postgres.ts` | `inCompany` runs the work in one transaction that sets the company first (decision 3). The invoice read and the record's `INSERT` go through it. The database log reads one company: `records(tenant)` |
| `src/log.ts` | `DecisionLog` is only `add`. The memory log is a `MemoryLog`, which keeps `records()` (decision 6) |
| `src/main.ts` | The log is read for `org_456` and `org_789`, merged by number, and the records with no company are counted, not shown |
| `test/rls.db.test.ts` | **New.** C1 to C5 |
| `test/owner-reads.ts` | **New.** A child program that reads records as the owner, for the tests of records with no company |
| `test/db.ts` | `rowsFor` and `tryThenRollBack` take a company. `ownerRowsFor` and `poolOfOne` are new |
| other database tests | They read `dsor.audit` inside the record's company, or through the owner. The program's log shows 9 lines. Step 09's role test is DSOR-RP-01a |
| `test/helpers.ts`, `test/decision-log.test.ts` | The memory log's type, and two stand-in logs that no longer need `records` |

Every other file is step 10's, without its `NEW IN STEP` markers. No new dependency.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_10_tenants/src mj_11_row_level_security/src
git diff --no-index mj_10_tenants/test mj_11_row_level_security/test
git diff --no-index mj_10_tenants/migrations mj_11_row_level_security/migrations
```

## Run it

Set up Neon first ("Before you build" above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # runs only the migrations that have not run yet: 004 and 005
pnpm check        # typecheck and the unit tests: no database needed
pnpm test:db      # the database tests, against the branch in .env
pnpm start        # the program, against the same branch
```

`pnpm migrate` on the branch `step-11`, made from `step-10`, on 2026-09-29. The step
was built one lock at a time, so `004` and `005` ran in two separate runs:

```text
dsor_runtime: password set again from DSOR_DB_URL
migration 004_invoices_row_level_security: done

dsor_runtime: password set again from DSOR_DB_URL
migration 005_audit_row_level_security: done
```

On your own branch made from `step-10`, one `pnpm migrate` prints both lines at once.
`pnpm check` prints `576 passed`, and `pnpm test:db` prints `56 passed`.

The new part of `pnpm start`, the log. The numbers come from the database:

```text
2581 invoice.get@1 ALLOW ok org_456
2582 invoice.get@1 ALLOW RESOURCE_NOT_FOUND org_456
2583 invoice.issue@1 DENY AUTHORIZATION_DENIED org_456
2586 invoice.get@1 ALLOW ok org_456
2587 invoice.issue@1 DENY UNSUPPORTED_CAPABILITY org_456
2588 invoice.issue@1 DENY VALIDATION_FAILED org_456
2589 invoice.get@1 ALLOW ok org_456
2590 invoice.get@1 ALLOW ok org_789
2592 invoice.issue@1 DENY TENANT_MISMATCH org_456
3 of the 12 records have no company, and dsor_runtime cannot read them
```

Look at the gaps: 2584, 2585, and 2591. Those are the three records with no company: the
call with no login, the call that named `cfo_100`, and the stranger to `org_789`. They
were written, because each call answered, and an answer leaves only after its record is
committed. `dsor_runtime` cannot read them back (decision 4).

## Break it

Every break of the design's table, performed on 2026-09-29, one at a time, then put
back, on the finished code (commit `8b453c2`). They ran on a throwaway Neon branch,
`step-11-breaks`, made from `step-11`, because four of them change the database. The
unit tests stayed green for all seven: they never touch the database. After the last
one, every policy was read back as the owner, and all 56 database tests passed again.

| # | The break | Learner's prediction | Caught by, for real |
| --- | --- | --- | --- |
| V1 | The company is set with `false`, for the connection | C4, the pool test | 7: C4's two tests, and **five calls whose record had no company**, refused by the database |
| V2 | `FORCE` is removed from `app.invoices` | only a catalog test | 1: C1, the catalog test |
| V3 | The invoice policy is dropped, row-level security stays on | zero rows, always | 16: every invoice read found nothing, and C1 |
| V4 | The helper sets the company with `true`, and runs no `BEGIN` | only the pool test | 20: **every invoice read found nothing, and every record with a company was refused** |
| V5 | Step 10's U1: the invoice SQL forgets `tenant_id` | survives, harmlessly | **0**. All 56 green |
| V6 | `dsor_runtime` is given `BYPASSRLS` | C6 and the start-up check | 18: C6, the start-up check, the program, and every test of C2, C3, and C5 that runs its own SQL |
| V7 | The audit policies use `current_setting` without `nullif` | only on a reused connection | 6: each record with no company written on a reused connection. The pool test always, and five tests whose shared pool happened to reuse one |

**V5, the one this step is for.** Step 10's U1 again. In `src/postgres.ts`, change the
invoice query to `WHERE id = $1` with `[id]`. Then:

```text
$ pnpm check
      Tests  576 passed (576)

$ pnpm test:db
      Tests  56 passed (56)
```

In step 10, this break sent `org_456`'s 31,400.00 USD to `org_789`, and four database
tests caught it. Now the database's lock filters the rows by itself, so the forgotten
line leaks nothing. That is the second lock doing its job. It also means DSoR's own
`WHERE` in this query is now guarded by no test (see "Think it through").

**V4, the learner's miss.** Delete `await client.query("BEGIN");` from `inCompany`:

```text
$ pnpm test:db
    × DSOR-MON-01: invoice.get returns INV-1008 from app.invoices, its money exactly 31400.00
    × DSOR-EXE-02: a success is committed before the answer, and another connection sees it
    × DSOR-RP-01c: after the program reads org_456's INV-1008, the next request sees no invoice
    …
      Tests  20 failed | 36 passed (56)
```

With no `BEGIN`, each statement is a transaction of its own. `set_config(…, true)` sets
the company, and its transaction ends at once, before the query runs. So every read sees
no company and finds nothing, and every record with a company is refused by the write
policy. The learner expected only the pool test: the first request would work, and only
the next one would notice. But the company was gone before the first request's own
query.

**V1, more than predicted.** Change `true` to `false` in `inCompany`. The pool test
fails, as expected. Five more tests fail, each a call with no company that answered
`EVIDENCE_STORE_UNAVAILABLE`. The pool lent those calls a connection that still held
`org_456`, so the record, with no company, broke the write policy's rule. The leaked
company did not put a record into `org_456`. It stopped the record, and so the answer.
The lock failed shut.

**V7, as predicted, and more often.** Only a connection that has held a company reads
the unset setting as `''`. The pool test builds that case on purpose. The other five
tests met it by chance, because a pool reuses its connections all the time.

**Neon's pooled address, shown once (decision 8).** Six separate programs connect to
the pooled address of `step-11-breaks`, one after another, as `dsor_runtime`. Each
prints the server connection it was given, the company it sees, and the invoices it
sees:

```text
the right way: the company set with true, inside BEGIN ... COMMIT
  program 1 (org_456): [{"port":5432,"server_connection":6511,"company":null,"invoices_seen":null}]
  program 2 (sets no company): [{"port":5432,"server_connection":6511,"company":null,"invoices_seen":null}]
the break: the company set with false, for the connection
  program 3 (org_456): [{"port":5432,"server_connection":6511,"company":"org_456","invoices_seen":"org_456/INV-1008"}]
  program 4 (sets no company): [{"port":5432,"server_connection":6511,"company":"org_456","invoices_seen":"org_456/INV-1008"}]
  program 5 (sets no company): [{"port":5432,"server_connection":6511,"company":"org_456","invoices_seen":"org_456/INV-1008"}]
  program 6 (sets no company): [{"port":5432,"server_connection":6511,"company":"org_456","invoices_seen":"org_456/INV-1008"}]
```

Six programs, one server connection, 6511. Program 1 ran its read after its own
`COMMIT`, so its company was already gone. Programs 4, 5, and 6 never set a company, and
each saw `org_456`'s invoice. Behind the pooler, a company set for the connection leaks
into every later program that is handed the same server connection, not only into the
next request of the same program.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Design first | "In plain words", "Why it matters", "The design, before any code". Each PostgreSQL behaviour it relies on was tried on a local PostgreSQL first |
| 2 | Neon | A branch `step-11` from `step-10`, the owner's password reset by hand, `.env` written by a command, never shown ("Before you build") |
| 3 | Check the design | Against step 10's code. Five changes, all made in the design before any test (see "Think it through") |
| 4 | Mechanical | Step 10's `NEW IN STEP` markers removed |
| 5 | Red | `rls.db.test.ts`, and the old tests that must now read inside a company. Predict how many pass |
| 6 | Green | Migration `004` and `inCompany` (C2), the log's `records(tenant)` (decision 6), migration `005` (C5), then C6's title. Predict each |
| 7 | Break it | V1 to V7, for real, on a throwaway Neon branch, because four of them change the database |
| 8 | Review | Two reviewers who have not seen your conversation attack the step |
| 9 | Fix the review | Change the design first, then the tests, then the code |

In the red run, the learner predicted about half of the 17 new tests would pass, and
that some old tests would fail. One new test passed, and every old test passed. A
company setting filters nothing until a policy reads it, so every "only this company"
test failed, and every old test still found its record.

Build your own step 11 from a copy of your step 10. From `docs/baby_steps_tutorials`:

```bash
cp -R my_10_tenants my_11_row_level_security
cd my_11_row_level_security
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 11. Set up Neon as "Before you
build" says: a branch from step-10, and secrets only from a command into .env, never
through the chat. Check the design against step 10's code before any test, and change
the design first when the code proves it wrong. Red tests first, one commit per claim.
Run the breaks that change the database on a throwaway branch. Before each run, ask me
what I expect.
```

## Check yourself

1. Step 10 already filters every query by company. Why add a second lock?
2. No company is set, and `dsor_runtime` reads `app.invoices`. What comes back, and why
   is that the safe answer?
3. `FORCE ROW LEVEL SECURITY` is on. Why does `neondb_owner` still see every row, and
   what protects DSoR from that?
4. Why must the company be set with `true`, inside `BEGIN … COMMIT`?
5. A payment row points at an invoice. Why must its foreign key start with the
   payment's own `tenant_id`?

<details>
<summary>Answers</summary>

1. So that one bug cannot leak. Step 10's break U1 showed that one query forgetting the
   company is enough. With the database's lock, that query still returns only the
   active company's rows.
2. No rows. The unset company is `NULL`, and `tenant_id = NULL` is never true. A
   forgotten company shows nothing, never everything.
3. `FORCE` stops the table's owner from skipping the policies. `BYPASSRLS` is a separate
   power that skips every policy, and `neondb_owner` holds it. Nothing in a table stops
   such a role. The program never runs as it: the start-up check refuses that login.
4. With `false`, the company stays on the connection, and a pool lends that connection
   to the next request, which may be for another company. With `true` and no `BEGIN`,
   the setting ends with its own statement, before the query runs.
5. PostgreSQL checks keys without applying policies. A key with a separate tenant column
   can point at another company's invoice, and its error tells whether that invoice
   exists. With the row's own `tenant_id` first, it can point only inside its company.

</details>

## Think it through

_To be written after the review, with the result of every break in the table above._

**Changed by checking the design against step 10's code, before the first test:**

- **The log's reader (decision 6).** Step 10's program and about 20 unit tests read
  records with no company. Under decision 4, `dsor_runtime` cannot. Only the database log
  reads by company. The memory log stays as it was, so `pnpm test` still needs no
  database.
- **Tests that expect no rows.** Step 09's "a broken log leaves no record" read
  `dsor.audit` with no company set. Under the policy, that read is empty whatever the
  table holds, so the test would pass for the wrong reason. It reads inside the record's
  company now.
- **Break V7 had no test that could catch it.** C5 gains the pool-of-one test.
- **Decision 3's wording.** "Every database touch" was too wide: the start-up check reads
  no company's table, and a call refused before line ② has no company to set.
- **One migration became two (decision 1).** A migration runs once, so `004` could not
  grow commit by commit. With both tables in one file, the audit policy would refuse
  every record of `org_456` until the log wrote inside its company's transaction, so
  both locks and all their code would land in one commit.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-TEN-01b | Tenant isolation is enforced in at least two independent layers | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | _to be counted_ |
| DSOR-RP-01a | `dsor_runtime` is not a superuser, does not hold `BYPASSRLS`, and owns no tenant table | [§36 PostgreSQL reference connector](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) | _to be counted_ |
| DSOR-RP-01b | Tenant tables use `FORCE ROW LEVEL SECURITY` | [§36 PostgreSQL reference connector](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) | _to be counted_ |
| DSOR-RP-01c | The tenant setting is transaction-local | [§36 PostgreSQL reference connector](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) | _to be counted_ |
| DSOR-RP-01d | A query with no tenant setting yields no rows | [§36 PostgreSQL reference connector](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) | _to be counted_ |

Also advanced, not claimed in full: DSOR-TEN-02a, for the audit table only.

## Next

Step 12 · The cross-tenant test suite: every operation is called with another company's
URI, and every one must refuse.
