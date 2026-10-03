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

That is §36's example. This step's policy adds one word, `nullif` (decision 2).

DSoR tells the database which company a piece of work is for, at the start of a
**transaction** (a group of statements that succeed or fail together):

```sql
BEGIN;
SELECT set_config('dsor.tenant_id', 'org_456', true);  -- true: only until COMMIT
SELECT … FROM app.invoices WHERE id = 'INV-1008';        -- filtered by the policy
COMMIT;
```

When no company is set, the company is unknown: `NULL`. `tenant_id = NULL` is never
true, so the policy matches no row, and the query returns nothing. A forgotten company
shows nothing, never everything. It is like an electric lock that stays locked when the
power fails.

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
request that reuses the connection, so set it per transaction."

Found live on 2026-09-29, and not in the specification: Neon's `neondb_owner` holds
`BYPASSRLS`, a power that skips every policy, `FORCE` included.

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
by itself, as a second lock that does not depend on DSoR's code remembering. And when
DSoR forgets to set a company, the lock stays shut, like the electric lock that stays
locked when the power fails: no company set, no rows.

**Outcome.** What is true when this step is done:

1. Every table with a company column has row-level security enabled and forced, and a
   policy. A new table without them fails a test. *Changed by the Stage 2 review,
   2026-10-01:* and the other ways around the policies that this step knows are closed.
   In any schema but PostgreSQL's own, there is no view that reads with its owner's
   rights, no materialized view, no foreign table, and no `SECURITY DEFINER` function
   that `dsor_runtime` may run (decision 1).
2. As `dsor_runtime`, a query that forgets the company returns only the active company's
   rows. Step 10's break U1 becomes harmless.
3. With no company set, every query on those tables returns no rows.
4. A company set for one request is gone for the next request on the same connection.
5. `dsor_runtime` can write an audit record only for the company set in its transaction,
   or with no company when none is set, and reads only the active company's records. The
   program sets that company from the call, so this catches a company that is missing or
   left over, not a wrong one (see "What this lock does not stop").
6. `dsor_runtime` is not a superuser, does not hold `BYPASSRLS`, owns no table, and
   belongs to no role.

**Not the outcome of this step.** The suite that calls every operation with another
company's URI (step 12). Joins and foreign keys between tenant tables: there is only one
business table yet (see decision 9). Reading the log as an auditor (DSOR-AUD-05b).

**The success signals**, each a test that fails if this step's code is deleted:

- As `dsor_runtime`, inside `org_456`, `SELECT … FROM app.invoices WHERE id =
  'INV-1008'`, with no company in the SQL, returns only `org_456`'s row.
- As `dsor_runtime`, with no company set, `SELECT … FROM app.invoices` returns no rows.
- A pool of one connection: a request sets `org_456` and ends. The next request sets no
  company and reads no rows.

**What this lock does not stop.** It stops a mistake: a query that forgets the company,
or a company left on a connection. It does not stop a program that holds
`dsor_runtime`'s login and means harm. Such a program can set any company it likes, and
then read that company's rows. §36 says so: "RLS is defense in depth. It does not replace
DSoR authorization." More limits:

- `neondb_owner` holds `BYPASSRLS`, so it sees every row whatever this step does. Nothing
  inside a table can stop such a role. The program never runs as it: step 09's start-up
  check refuses that login.
- In `add`, the record's company and the transaction's company both come from the same
  value, the call's company. So the write policy cannot catch the program filing a
  record under the wrong company. It catches a company that is missing, or left over
  from another request.
- *Changed by the Stage 2 review, 2026-10-01:* the same holds for a read. The store sets
  the company the operation's code asks it for. So code that asks for another company
  passes both locks, because DSoR's `WHERE` and the policy filter by that same company.
  Step 10's decisions 13 and 14, carried here, narrow this: the code gets a store bound
  to the active company, and an answer whose `tenant_id` is another company's fails. Code
  that makes a store of its own and removes or rewrites that `tenant_id` still passes.
  Step 12's suite is the review's third layer for it.

### What the specification asks, and what this step can honestly give

Checked on 2026-09-29:

1. **DSOR-TEN-01b asks for two independent layers.** Step 10 built the first, in DSoR's
   code. This step builds the second, in the store. Each is tested on its own. For the
   second, this step's database tests run SQL that leaves the company out. For the first,
   the owner runs DSoR's own store: the owner holds `BYPASSRLS`, so no policy applies,
   and only DSoR's `WHERE` can filter. Found by the review: before that test, removing
   the `WHERE` (break V5) passed every test.
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
| DSOR-RP-01b | **C1.** Every tenant table uses `FORCE ROW LEVEL SECURITY` | A catalog query finds every table outside PostgreSQL's own schemas with a `tenant_id` or `tenant` column, and each one has row-level security enabled and forced, and at least one policy. *Changed by the Stage 2 review, 2026-10-01:* PostgreSQL's own schemas are `information_schema` and every name that starts with `pg_`, found with a regular expression. Two more catalog queries: no view without `security_invoker=true`, no materialized view, and no foreign table, and no `SECURITY DEFINER` function that `dsor_runtime` may run, outside those schemas (decision 1) |
| DSOR-TEN-01b | **C2.** The store keeps companies apart when DSoR's query forgets to | As `dsor_runtime`, inside `org_456`, SQL with no company returns only `org_456`'s rows, and inside `org_789` only `org_789`'s |
| DSOR-RP-01d | **C3.** No company set, no rows | A fresh connection, and a reused one, with no company set: no invoice rows and no audit rows |
| DSOR-RP-01c | **C4.** The company lasts one transaction | A pool of one connection: after a request for `org_456` ends, the next request, which sets nothing, reads nothing |
| DSOR-TEN-02a, the audit part | **C5.** The log is kept apart by company | `dsor_runtime` in `org_456` cannot write a record for `org_789` and cannot read one. A record with no company is written when no company is set, and `dsor_runtime` cannot read it back |
| DSOR-RP-01a | **C6.** `dsor_runtime` holds no power that skips the policies | Step 09's checks: not a superuser, no `BYPASSRLS`, owns no table. And it belongs to no role, so `SET ROLE` cannot reach one that has such a power. *Changed by the Stage 2 review, 2026-10-01:* the program started as the owner must name both facts it reads from the database for this, `holds BYPASSRLS` and the role membership (decision 7) |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **Every table with a company column gets `ENABLE` and `FORCE ROW LEVEL SECURITY`:**
   `app.invoices` in migration `004`, and `dsor.audit` in migration `005`, one file for
   each lock, so each lands with the code it needs. `dsor.migrations` has no company and
   `dsor_runtime` has no privilege on it, so it gets none. *Downside:* `FORCE` changes
   nothing for `dsor_runtime`, which owns no table. It guards against a future owner who
   is not `BYPASSRLS`, and only the catalog test can see it (break V2). And the owner
   now needs `BYPASSRLS`: an owner without it would read no row, and a migration's
   `UPDATE` would change no row, with no error. Neon's `neondb_owner` holds it, and the
   owner's test programs check that first (found by the review).

   *Changed by the Stage 2 review, 2026-10-01:* a table is not the only way to reach a
   row, so the rule widens to the other relations and to functions. A **view** is a
   saved query that looks like a table. It reads with its owner's rights, unless it is
   made `WITH (security_invoker = true)`. The owner holds `BYPASSRLS`, so such a view sees
   every company's rows. A **materialized view** is a stored copy of a query's rows, and
   no policy filters the copy. A **`SECURITY DEFINER` function** runs with the rights of
   the role that owns it, so the owner's `BYPASSRLS` comes with it. On a local
   PostgreSQL, the review made each of these three as the owner, and each showed both
   companies' rows from inside `org_456`. A hostile pass on the fix added a fourth: a
   **foreign table** reads a table through a connection of its own, and can carry no
   policy. None of the four exists on Neon. Now, in any schema but PostgreSQL's own,
   there must be no view without `security_invoker=true`, no materialized view, no
   foreign table, and no `SECURITY DEFINER` function that `dsor_runtime` may run. Three
   catalog tests check it: one for tables, one for the other relations, one for
   functions. And PostgreSQL's own schemas were found with `NOT LIKE 'pg_%'`. In `LIKE`,
   `_` matches any one character, so a schema named `pgcrm` was skipped. Now they are
   `information_schema` and every name that matches the regular expression `^pg_`.
   *Downside:* a view that DSoR wants one day, such as the "controlled views" §36 lists,
   must be made with `security_invoker = true`, written exactly that way. A definer
   function must have its `EXECUTE` taken from `dsor_runtime`, or the tests fail. And
   that is not enough for a definer function that runs as a **trigger**, a function
   PostgreSQL runs by itself when a row changes. `EXECUTE` is checked when the trigger is
   made, not when it runs, so it runs for whoever changes the row. No test looks for
   triggers yet ("Think it through").
2. **The company is read as `nullif(current_setting('dsor.tenant_id', true), '')`.** On
   a fresh connection an unset value is `NULL`. On a connection that has held a
   transaction-local value, it is `''` after that transaction ends. This was run on a
   local PostgreSQL 17 on 2026-09-29. `nullif` makes both mean "no company". *Downside:*
   the policies are longer than §36's example, and a reader must learn why.
3. **Every touch of a company's table is one transaction that sets the company first:** a
   helper runs `BEGIN`, `set_config('dsor.tenant_id', $1, true)`, the work, and `COMMIT`,
   and it rolls back on any error. Line ⑨'s read and line ⑪'s record are two separate
   transactions, each with the call's company. A call refused before line ② has no
   company, so its record's transaction sets the company to `''`, which means none.
   Setting nothing would leave whatever company the connection still carries: behind a
   shared pooler, another program's. Found by the review. No code sets the company any
   other way, and `set_config(…, false)` never appears. The start-up check reads no
   company's table, so it stays a plain query. *Downside:* each statement is a round trip
   to the database. A call now makes 8 (`BEGIN`, `set_config`, the work, and `COMMIT`,
   twice), where step 10 made 2.
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
   `dsor_runtime`. `call` uses only `add`, so `DecisionLog`, the type every log shares, now
   holds only `add`.
   The memory log of the unit tests keeps `records()`: keeping companies apart is the
   database's job, and AGENTS.md says it is never proved against a mock. The program
   prints the 9 records it can read, both companies merged by number, and says that its 3
   calls with no company left records it cannot read. *Downside:* step 08's shape of the
   log changes again, and the program can no longer show every record it wrote.
7. **The start-up check also refuses a login that belongs to any role.** Step 09's check
   already refuses a login that is a superuser, holds `BYPASSRLS`, owns tables, or
   belongs to `pg_write_all_data`. Found by the review: after
   `GRANT neondb_owner TO dsor_runtime`, every one of those checks stayed green, and
   `SET ROLE neondb_owner` then skipped every policy. *Downside:* a deployment that wants
   `dsor_runtime` in a harmless group role must change the check.

   *Changed by the Stage 2 review, 2026-10-01:* two corrections. First, the history above
   is wrong on Neon. `pg_has_role(…, 'pg_write_all_data', 'MEMBER')` follows a chain of
   memberships, and the program started as the owner names `is a member of
   pg_write_all_data` (run on 2026-10-01). So a `dsor_runtime` that belonged to
   `neondb_owner` would have failed that check too. The `GRANT` was not run again,
   because it changes the database. Refusing every membership is still right: `SET ROLE`
   can switch to any role a login belongs to, with that role's powers. Second, the two
   facts this check reads from the database for row-level security, `BYPASSRLS` and the
   number of roles a login belongs to, were proven only with hand-made facts. With the
   SQL in `runtimeRoleProblems` changed to read `false` and `0`, every test passed. Now
   the test that starts the program as the owner requires both problems, word for word
   as `problemsOf` says them: `holds BYPASSRLS`, and `belongs to … other role…, which
   SET ROLE can switch to`. On Neon, the owner holds `BYPASSRLS` and belongs to two
   roles, `neon_superuser` among them, so both must appear.
8. **The pooling test uses the program's own pool, `pg.Pool`, with one connection.**
   That is deterministic. Neon's pooled address, which hands a connection to another
   program after each transaction, is shown in "Break it" by `test/pooler-demo.ts`, run
   by hand, and not tested. *Downside:* the Neon pooler is demonstrated, not guarded by a
   test.
9. **This tutorial's rule, written now for the tables to come:** every join between tenant tables
   includes `tenant_id`, and every foreign key between them starts with the row's own
   `tenant_id`, as in `FOREIGN KEY (tenant_id, invoice_id) REFERENCES app.invoices
   (tenant_id, id)`. PostgreSQL checks keys without applying policies, so a key with a
   separate tenant column can point into another company and reveal whether a row exists
   there. This was run on a local PostgreSQL 17 on 2026-09-29: a payment in `org_456`
   was linked to `org_789`'s `INV-2001`, which `org_456` cannot see, and a missing
   invoice gave an error instead. There is only one business table yet, so this step
   writes the rule and tests nothing for it. *Downside:* a rule with no test waits for the
   step that adds a second table.
10. **A transaction counts only when it really committed.** *Changed by the Stage 2
    review, 2026-10-01:* `inCompany` sent `COMMIT` and took any answer as success. But
    when a statement inside a transaction fails, PostgreSQL aborts the whole transaction.
    A `COMMIT` sent after that raises no error. PostgreSQL rolls the work back and answers
    with the word `ROLLBACK`. So work that caught its own failed statement looked kept,
    and nothing was. And when the review changed `await client.query("COMMIT")` to
    `client.query("COMMIT").catch(() => {})`, a `COMMIT` that nobody waits for or checks,
    all 574 unit tests and 60 database tests passed. A record whose `COMMIT` failed would
    then still let the answer out, which DSOR-EXE-03b forbids. Now `inCompany` reads the
    answer to its `COMMIT`. Anything but `COMMIT` throws "the transaction was rolled
    back", so the work takes the error path: the connection is closed, and the error goes
    back to the code that called `inCompany`. A call whose record was not kept then
    answers `EVIDENCE_STORE_UNAVAILABLE`, and a read whose transaction rolled back fails
    with `INTERNAL_ERROR`. *Downside:* the error says only that the transaction was rolled
    back. Which statement failed is lost, because the work swallowed it.

### The tests, by claim

- **C1:** the catalog query lists `app.invoices` and `dsor.audit`, each with
  `relrowsecurity` and `relforcerowsecurity` true and a policy. A table added with a
  company column and no policy fails it. And every policy is exactly as written: its
  command, its roles, and its rule, as PostgreSQL prints them, the way step 09 lists every
  privilege. Found by the review: a policy limited to `SELECT`, or given to one role
  only, passed every test. *Changed by the Stage 2 review, 2026-10-01:* the catalog
  holds no view without `security_invoker=true`, no materialized view, no foreign table,
  and no `SECURITY DEFINER` function that `dsor_runtime` may run, outside PostgreSQL's
  own schemas. Each filter is also tested on planted rows that PostgreSQL reads inside
  one query, so nothing is created in the database. The schema filter checks `pgcrm` and
  skips `pg_catalog`, `pg_toast`, and `information_schema`. The relation filter finds a
  view without `security_invoker=true`, a materialized view, and a foreign table. The
  function filter finds a definer function that `dsor_runtime` may run. A last test pins
  real catalog rows, column by column, so the guards' empty answers come from the real
  catalog. Whether a function runs as its definer cannot be pinned that way: no function
  in the database does today. That part was checked by reading.
- **C2:** as `dsor_runtime`, inside `org_456`, `SELECT tenant_id, id FROM app.invoices
  WHERE id = 'INV-1008'` gives exactly `org_456`'s row. Inside `org_789`, exactly
  `org_789`'s. `SELECT DISTINCT tenant_id FROM app.invoices` inside `org_456` gives
  only `org_456`. And the first lock alone: the owner, whom no policy stops, runs DSoR's
  store. `get('org_456', 'INV-2001')` finds nothing, and `records('org_456')` gives only
  `org_456`'s records.
- **C3:** no company set, on a fresh connection and on one that has just ended a
  transaction for `org_456`: `app.invoices` gives no rows, and `dsor.audit` gives none,
  though it surely holds a record. And a call with no company, on a connection that
  carries `org_456` for the whole session, still runs with no company: its record is
  written.
- **C4:** a pool of one connection. Request 1 runs inside `org_456`. Request 2 runs
  `SELECT … FROM app.invoices` with no company: no rows. And decision 3's other half: a
  connection whose transaction failed is closed, so the next request gets a new one.
- **C5:** inside `org_456`, an `INSERT` into `dsor.audit` with `tenant = 'org_789'` fails
  with the policy's error, `42501`. With no company set, an `INSERT` with no tenant
  succeeds, and a `SELECT` with no company set cannot see it. Inside `org_456`, the
  records read back are only `org_456`'s. A call with no login still leaves its record:
  the owner, in a child program with redacted output, finds it. On a pool of one
  connection, a call with no login right after a call in `org_456` is still recorded: it
  answers `AUTHENTICATION_REQUIRED`, not `EVIDENCE_STORE_UNAVAILABLE`.
- **C6:** step 09's role checks, now titled DSOR-RP-01a, and one more: `dsor_runtime`
  belongs to no role. The start-up check refuses a login that belongs to one. *Changed
  by the Stage 2 review, 2026-10-01:* the program started as the owner names `holds
  BYPASSRLS` and `belongs to … other role…, which SET ROLE can switch to`, read from the
  real database.
- **The program as a whole:** every step 10 test still passes, now through the
  transactions of decision 3, with three changes. A test that reads `dsor.audit` as
  `dsor_runtime` reads inside the record's company, because without one an empty answer
  proves nothing. A test that reads a record with no company reads it through the owner
  (decision 4). The program prints 9 of its 12 records (decision 6). And step 09's
  DSOR-EXE-03b tests gain a case: a log whose `INSERT` fails inside its transaction. The
  two older cases fail before the transaction begins. Found by the review: with the error
  swallowed inside `inCompany`, the caller got the invoice and no record was kept.
- **Decision 10**, *changed by the Stage 2 review, 2026-10-01:* work that writes a record
  of `org_456`, then catches a failed statement of its own, makes `inCompany` reject with
  "the transaction was rolled back", and the record is not kept. A log whose `COMMIT`
  fails gives the caller `EVIDENCE_STORE_UNAVAILABLE` and leaves no record. That `COMMIT`
  fails by **fault injection**, an error planted on purpose (§47). The test wraps the
  real client, so every statement reaches the real database, except the first `COMMIT`:
  it never leaves the client, which hears that it failed. The record stays in the open
  transaction until `inCompany`'s own `ROLLBACK` takes it away, and the test counts that
  the fault fired exactly once.

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
| `src/postgres.ts` | `inCompany` runs the work in one transaction that sets the company first, `''` when there is none (decision 3). The invoice read and the record's `INSERT` go through it. The database log reads one company: `records(tenant)`. The start-up check also refuses a login that belongs to any role (decision 7). Since the Stage 2 review, `inCompany` reads the answer to its `COMMIT`, and anything but `COMMIT` is an error (decision 10) |
| `src/log.ts` | `DecisionLog` is only `add`. The memory log is a `MemoryLog`, which keeps `records()` (decision 6) |
| `src/main.ts` | The log is read for `org_456` and `org_789`, merged by number. The last line says how many records it read, and how many it knows were written |
| `test/rls.db.test.ts` | **New.** C1 to C5. Since the Stage 2 review: the catalog guards for views, materialized views, and definer functions, each filter tested on planted rows, and decision 10's test |
| `test/owner-reads.ts` | **New.** A child program that reads records as the owner, for the tests of records with no company. Since the Stage 2 review, it gives each record's size in bytes too |
| `test/owner-store.ts` | **New, after the review.** A child program that runs DSoR's store as the owner, whom no policy stops, so DSoR's own `WHERE` is tested alone |
| `test/runtime-role.test.ts` | The start-up check refuses a role membership |
| `test/pooler-demo.ts` | **New, after the review.** Not a test: a demonstration of Neon's pooler, run by hand (decision 8) |
| `test/db.ts` | `rowsFor` and `tryThenRollBack` take a company. `ownerRowsFor` and `poolOfOne` are new |
| other database tests | They read `dsor.audit` inside the record's company, or through the owner. The program's log shows 9 lines. Step 09's role test is DSOR-RP-01a. Since the Stage 2 review: a log whose `COMMIT` fails, in `test/audit.db.test.ts`, and the owner refused for `BYPASSRLS` and its roles, in `test/program.db.test.ts` |
| `test/helpers.ts`, `test/decision-log.test.ts`, `test/tenants.test.ts` | The memory log's type, and the stand-in logs that no longer need `records`: two, and a third since the Stage 2 review |

Every other file is step 10's, without its `NEW IN STEP` markers. No new dependency.

*Changed by the Stage 2 review, 2026-10-01:* that review fixed three findings in step 10,
and this folder carries them too. Line ① makes the one copy of the input (step 07's
decision 9). A company id has 1 to 18 digits, and migration `003b_bounded_claims.sql`
makes the log refuse a large claim (step 10's decision 12). The operation's code gets only
the active company's invoices, from `src/company.ts`, and its answer must hold no other
company's row (step 10's decisions 13 and 14). Both folders hold these, so the commands
below do not show them. Two kinds of change in this folder do show: step 10's new
database tests read `dsor.audit` inside a company or through the owner, and decisions 1,
7, and 10 bring this step's own fixes.

*Changed by step 16's review, 2026-10-03:* its two fixes, from step 09 on, are in both
folders too ("Think it through").

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
pnpm migrate      # runs only the migrations that have not run yet: 004 and 005, and 003b
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

And on 2026-10-01, after the Stage 2 review, `003b`, which that review added in step 10.
It ran although `004` and `005` had run already, because the runner runs every file it
has not run yet, in name order:

```text
dsor_runtime: password set again from DSOR_DB_URL
migration 003b_bounded_claims: done
```

On your own branch made from `step-10`, one `pnpm migrate` prints a line for each file
that branch has not run: `004` and `005`, with `003b` first if your step 10 did not run
it. `pnpm check` prints `629 passed`, and `pnpm test:db` prints `78 passed`. Outside the
repository, three tests that compare the schemas with the repository's originals are
skipped: `626 passed | 3 skipped`.

The new part of `pnpm start`, the log. The numbers come from the database:

```text
3055 invoice.get@1 ALLOW ok org_456
3056 invoice.get@1 ALLOW RESOURCE_NOT_FOUND org_456
3057 invoice.issue@1 DENY AUTHORIZATION_DENIED org_456
3060 invoice.get@1 ALLOW ok org_456
3061 invoice.issue@1 DENY UNSUPPORTED_CAPABILITY org_456
3062 invoice.issue@1 DENY VALIDATION_FAILED org_456
3063 invoice.get@1 ALLOW ok org_456
3064 invoice.get@1 ALLOW ok org_789
3066 invoice.issue@1 DENY TENANT_MISMATCH org_456
12 calls answered, so 12 records were written. dsor_runtime reads 9 of them, in org_456 and org_789, and cannot read the other 3
```

The last line holds one fact and one inference. The fact: the program read 9 records.
The inference: 12 were written, because every call answered, and an answer leaves only
after its record is committed. The other 3 have no company: the call with no login, the
call that named `cfo_100`, and the call for `org_789` by a caller who is no member of it.
`dsor_runtime` can write them and never read them back (decision 4).

Look at the gaps in the numbers: 3058, 3059, and 3065. In this run they are those three
records, because nothing else wrote at that moment. A gap does not always mean that. One
counter numbers the records of every company, so a gap can also be another company's
record, or a number taken by a write that was then rolled back. That shared counter tells
one company how busy the others are (see "Think it through").

## Break it

Every break of the design's table, performed on 2026-09-29, one at a time, then put
back, on the code as it stood before the review (commit `8b453c2`). They ran on a throwaway Neon branch,
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
| V6 | `dsor_runtime` is given `BYPASSRLS` | C6 and the start-up check | 18: C6, the start-up check, the program, and every test of C2, C3, C4, and C5 that runs its own SQL |
| V7 | The audit policies use `current_setting` without `nullif` | only on a reused connection | 6: each record with no company written on a reused connection. The pool test always, and five tests whose shared pool happened to reuse one |

One program test, "finds its own role table and .env, whatever folder it is started
from", reads the step's own `.env` on purpose. So during the database breaks it ran
against `step-11`, not the throwaway branch, and could not see them.

**After the review, two breaks were run again** on the fixed code (commit `4fab426`):

| # | Before the review | After |
| --- | --- | --- |
| V5 | 0: every test green | **1**: the new test where the owner, whom no policy stops, runs DSoR's store (learner's prediction: exactly 1) |
| V1 | 7 | 2: C4's two pool tests. A call with no company now sets `''` itself, so it no longer meets the company a connection kept |

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
line leaks nothing. That is the second lock doing its job. But it also meant that
DSoR's own `WHERE` was guarded by no test, so the first lock could vanish unseen. The
review found this, and a test now runs DSoR's store as the owner, whom no policy stops.
After the review, V5 fails that one test.

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
company did not put a record into `org_456`. It stopped the record, and so the answer:
the lock failed closed. After the review, a call with no company sets `''` itself, so
these five calls work again, and only the pool tests catch V1.

**V7, as predicted, and more often.** Only a connection that has held a company reads
the unset setting as `''`. The pool test builds that case on purpose. The other five
tests met it by chance, because a pool reuses its connections all the time.

*Changed by the Stage 2 review, 2026-10-01:* that paragraph is true of the code before
the review. Since the review, a call with no company sets `''` itself (decision 3). So
without `nullif`, every record with no company that the program writes is refused, on a
fresh connection too, and far more than six tests would fail. This was checked by
reading the code. V7 was not run again: it changes the policies, and the database is
never changed to make a test fail.

**The Stage 2 review's break, run on 2026-10-01.** In `inCompany`, replace the two lines
that send `COMMIT` and read its answer with a `COMMIT` that nobody waits for:
`client.query("COMMIT").catch(() => {});`. Then:

```text
$ pnpm test
      Tests  629 passed (629)

$ pnpm test:db
    × step 11's decision 10: work that swallows its own failed statement makes inCompany reject, and nothing is kept
    × DSOR-EXE-03b: a log whose COMMIT fails gives no invoice, and no record
      Tests  2 failed | 73 passed (75)
```

Before that review, this break passed every test. The unit tests never meet the database,
so they stay green. The two tests of decision 10 fail: the work that swallowed its
failure looked kept, and the log's caller got the invoice although its record's `COMMIT`
had failed. Put the lines back, and both pass.

**Neon's pooled address, shown by hand (decision 8).** `test/pooler-demo.ts` connects
six separate programs, one after another, to the pooled address of the branch in `.env`,
as `dsor_runtime`. Each prints the server connection it was given, the company it sees,
and the invoices it sees. It reads only, and clears at the end the company it left. Run
it only on a branch you may break:

```text
$ node test/pooler-demo.ts
the right way: the company set with true, inside BEGIN ... COMMIT
  program 1 (org_456), inside its transaction: {"server_connection":1364,"company":"org_456","invoices_seen":"org_456/INV-1008"}
  program 2 (sets no company): {"server_connection":1364,"company":null,"invoices_seen":null}
the break: the company set with false, for the connection
  program 3 (org_456): {"server_connection":1364,"company":"org_456","invoices_seen":"org_456/INV-1008"}
  program 4 (sets no company): {"server_connection":1364,"company":"org_456","invoices_seen":"org_456/INV-1008"}
  program 5 (sets no company): {"server_connection":1364,"company":"org_456","invoices_seen":"org_456/INV-1008"}
clean-up: the company set back to none, for the connection
  program 6 (sets no company): {"server_connection":1364,"company":null,"invoices_seen":null}
```

Six programs, one server connection, 1364. Program 1 sees its company's invoice inside
its transaction, and program 2, on the same server connection, sees nothing. Programs 4
and 5 never set a company, and each saw `org_456`'s invoice. Behind the pooler, a
company set for the connection leaks into every later program that is handed the same
server connection, not only into the next request of the same program.

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
5. A payment row points at an invoice. This tutorial says its foreign key starts with the
   payment's own `tenant_id`. Why?

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

Every break of the design's table was run for real ("Break it"). Then two reviewers who
had not seen the conversation attacked the step: one checked each rule against the tests
and the code, and one changed the code in small ways to find changes no test catches.

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

**Found by the review, and fixed:**

- **The first lock was tested by nothing.** With DSoR's `WHERE tenant_id = $1` deleted
  (break V5), every test passed, because the database's lock hid the loss. So "two
  independent layers" was proved for one layer only. Now `test/owner-store.ts` runs
  DSoR's store as the owner, whom no policy stops, and only DSoR's `WHERE` can filter.
  V5 fails that test now.
- **A role membership skipped every check.** After `GRANT neondb_owner TO dsor_runtime`,
  every check of step 09 stayed green, and `SET ROLE neondb_owner` then skipped every
  policy. The start-up check and the DSOR-RP-01a test now refuse any role membership
  (decision 7). *Changed by the Stage 2 review, 2026-10-01:* "every check stayed green"
  is wrong on Neon: the check for `pg_write_all_data` would have failed. Refusing every
  membership is still right (decision 7).
- **A call with no company set nothing.** It then ran with whatever company the
  connection still carried, behind a shared pooler even another program's. Now it sets
  `''` (decision 3). The cost: break V1 is caught only by the pool tests now.
- **The program stated a count it had not read.** Its last line now says which part it
  read, and which part it knows from the rule that an answer leaves only after its record
  is committed.
- **Tests that could pass for the wrong reason.** A `42501` error could be a missing
  privilege, not the policy: the tests now match the policy's message. A read of an empty
  table gives no rows too: C3 now writes a record first. An owner without `BYPASSRLS`
  would read nothing: the owner's programs now check that first.
- **The README said more than was proved,** or said it unclearly: what the lock does not
  stop, outcomes 5 and 6, the gaps in the record numbers, V6's count, the demo that could
  not be repeated, tutorial rules worded as DSoR's, and several hard sentences.

**Found by the mutation sweep, and fixed.** It made 24 small changes to the code and 5 to
the policies, each on the code as it stood before the review above. Ten passed every
test. On the fixed code:

| Change | Now caught by |
| --- | --- |
| `records` without its `WHERE` | the owner's run of DSoR's store (fixed by the review above) |
| `inCompany` swallows the error | a log whose `INSERT` fails inside its transaction, and the closed-connection test. Before: the caller got the invoice, and no record was kept |
| `inCompany` lends a failed connection again, or never gives it back | the closed-connection test |
| the invoice policy limited to `SELECT`, or given to `dsor_runtime` only | C1's list of every policy, exactly as written |
| `set_config` even with no company | nothing, and rightly: after the review, that is the code |

**Tried as `dsor_runtime`, on the throwaway branch, and refused:** `row_security = off`,
`SET ROLE` or `SET SESSION AUTHORIZATION` to the owner, disabling row-level security,
dropping or adding a policy, a function in `app` or `public`, and the audit table's
number sequence. A temporary view, and a temporary `SECURITY DEFINER` function, both saw
no rows with no company. Two companies in one setting, or a company with SQL in it, saw
nothing. Setting another company, and writing a record there, worked, as "What this lock
does not stop" says. *Changed by the Stage 2 review, 2026-10-01:* this paragraph also said
that other sessions' queries are hidden. On Neon they are not. One `dsor_runtime` session
can read the text of another session's query in `pg_stat_activity`, PostgreSQL's list of
sessions. Today that text holds only placeholders such as `$1`, never the values sent with
them.

**Found by the Stage 2 review (2026-10-01), and fixed.** Six reviewers audited steps 10
to 14 and the seams between them (`../mj_notes.md`). They found no live leak. Three of
their findings began in earlier steps, one in step 07 and two in step 10, and this
folder carries the fixes. Three began here.

- **A check and the code could see two different inputs.** Fixed from step 07 on. Lines
  ① and ② read the input itself, to check the principals and the companies it names.
  Line ⑥ then made its own copy, for the schema check and for the code. A getter, a
  field that runs code each time it is read, can answer the second read differently. In
  the red run here, the code was handed `principal: "cfo_100"` after line ① saw the
  caller, and `tenant_id: "org_789"` after line ② saw `org_456`.
  - **Fixed:** line ① makes the one copy, right after it finds who is calling. Every
    check and the code read that copy (step 07's decision 9). An input that JSON cannot
    copy is still refused with `VALIDATION_FAILED`, at the end of line ②, once the
    principals and the companies it names are checked.
  - **Caught by** step 10's tests, the same here, in `test/pipeline.test.ts` and
    `test/who-is-calling.test.ts`. Eight of them failed in the red run.
- **A company id had no length, and the log kept a claim of any size.** Fixed from step
  10 on. In step 14, an envelope naming `org_` and a million digits got a refusal of 212
  bytes, and left a record of 1,000,433 bytes that `dsor_runtime` can never remove. In
  the red run here, 19 digits and a million digits were refused as
  `AUTHORIZATION_DENIED`, and the record kept the claim. `parseUri` took a company of 19
  digits. As `dsor_runtime`, an `extensions` of 2 KB went in, in a transaction that was
  rolled back.
  - **Fixed:** a tenant id has 1 to 18 digits, and migration `003b` makes the log refuse
    an `extensions` over 1,024 bytes (step 10's decision 12). It ran on the branch
    `step-11` on 2026-10-01. With it run and the code not yet changed, the million-digit
    call already failed closed: `EVIDENCE_STORE_UNAVAILABLE`, and no record. The
    database test of that call was first run only then, so the red run left no record
    of a megabyte.
  - **Caught by** the 19-digit and million-digit cases, and the tests titled `step 10's
    decision 12: …`, in `test/tenants.test.ts`, `test/uri.test.ts`, and
    `test/tenants.db.test.ts`. Here a record with no company can be read only by the
    owner, so that test reads it through `test/owner-reads.ts`, which now gives each
    record's size too.
- **The code could name another company, and both locks trusted it.** Fixed from step 10
  on. The high finding. The operation's code named the company at each read, and the
  store set that company for the policy too. So the database's lock filtered by the
  company the code asked for, not the one line ② checked ("What this lock does not
  stop"). In the red run here, the code was handed a bare company id. And with
  row-level security on, code that made a store of its own read `org_789`'s `INV-2001`
  for a caller in `org_456`. That store set `org_789` for its own read, so the policy
  showed `org_789`'s row, and the caller got `VENDOR-77`.
  - **Fixed, in two layers:** the code gets `companyOf(store, tenant)`, the active
    company's invoices only, and each read runs inside that company's transaction (step
    10's decision 13). Every `tenant_id` in its answer must be the active company's, or
    the call fails with `INTERNAL_ERROR` (step 10's decision 14). The third layer, in
    the review's plan, is step 12's suite.
  - **Caught by** C8, in `test/company.test.ts`, `test/tenants.test.ts`, and
    `test/tenants.db.test.ts`. The database tests pass with row-level security on: the
    one record they read is read inside `org_456`.
- **A transaction counted as kept when it was not.** Fixed from step 11 on. With `await
  client.query("COMMIT")` changed to `client.query("COMMIT").catch(() => {})`, every
  test passed. And work that catches its own failed statement leaves a transaction that
  PostgreSQL has aborted. Its `COMMIT` answers `ROLLBACK`, with no error, and `inCompany`
  returned success. In the red run here: "promise resolved 'done' instead of rejecting".
  - **Fixed:** `inCompany` reads the answer to its `COMMIT`. Anything but `COMMIT` is the
    error "the transaction was rolled back" (decision 10).
  - **Caught by** `step 11's decision 10: work that swallows its own failed statement
    makes inCompany reject, and nothing is kept`, in `test/rls.db.test.ts`, and
    `DSOR-EXE-03b: a log whose COMMIT fails gives no invoice, and no record`, in
    `test/audit.db.test.ts`, by fault injection around the real client.
  - **Broken on purpose:** with the `COMMIT` not awaited, both fail. The log's caller
    gets the invoice instead of `EVIDENCE_STORE_UNAVAILABLE` ("Break it").
  - **A hostile pass on the fix** found that the second test never showed its fault
    fired: any failed `INSERT` would also pass it. Its first `COMMIT` now never leaves
    the client, the test counts that the fault fired once, and `inCompany`'s own
    `ROLLBACK` must take the record away. So the break "`COMMIT` instead of `ROLLBACK`
    after an error", left open here before, now fails it: the record was kept.
- **The start-up check's database facts were proven only with hand-made facts.** Fixed
  from step 09 on, with the membership of roles from step 11 on. With the SQL in
  `runtimeRoleProblems` changed to read `rolbypassrls`, the membership of
  `pg_write_all_data`, the count of tables owned, or the count of roles as false or `0`,
  every test passed. Run again here, the owner's test passed too.
  - **Fixed:** the test that starts the program as the owner requires `holds BYPASSRLS`,
    `is a member of pg_write_all_data`, `owns … tables`, and `belongs to … other role…,
    which SET ROLE can switch to`, as `problemsOf` says them (decision 7).
  - **Caught by** `DSOR-AUD-04a: refuses to run as the owner, names why, and makes no
    call`, in `test/program.db.test.ts`. Each of the four changes to the SQL turns it
    red.
- **The catalog guard missed a kind of schema name, and every view and function.**
  Fixed from step 11 on. It skipped schemas with `NOT LIKE 'pg_%'`, so `pgcrm` was
  skipped. And it looked at tables only. On a local PostgreSQL, the review made a view, a
  materialized view, and a `SECURITY DEFINER` function as the owner, and each showed
  both companies' rows from inside `org_456`. None exists on Neon.
  - **Fixed:** decision 1 widens to views, materialized views, foreign tables, and
    definer functions, with three guards.
  - **Caught by** the C1 tests in `test/rls.db.test.ts`. The database is never changed
    to make a test fail, so each filter is shown red on planted rows that PostgreSQL
    reads inside one query. In the red run, the old schema filter dropped `pgcrm` from
    all three planted lists. Four more breaks of the filters were each caught: the view
    filter leaving out materialized views, or checking only views with no options at
    all, and the function filter ignoring who may run a function, or whether it is a
    definer. The guards on the real catalog pass, because Neon holds none of these today.
    No function in the database runs as its definer at all. That the guards would fail
    on a real one was checked by reading, never by making one.
  - **A hostile pass on the fix** found three more gaps. A foreign table carries no
    policy and was not looked for: the relation filter now finds it, red on a planted row
    first. The test of the real catalog read too few columns, so a source with a
    constant schema name, or with every view's options set to `security_invoker=true`,
    passed it: it now pins those columns, and both of those breaks fail it. And a
    definer function that runs as a trigger is left open (below).
- **Sentences that said more than the code.** Other sessions' queries are not hidden on
  Neon (above). Break V7 is no longer caught by one test only ("Break it", and the
  comment in `test/rls.db.test.ts`). Decision 7's story of a role membership is wrong on
  Neon. A comment in `test/program.db.test.ts` called itself the only test that touches
  the owner's key. And "the start-up check refuses each" was proven with hand-made facts
  only. For `BYPASSRLS` and role membership it is now proven on the real database too
  (the rules table).

- **The owner-store test needed records that other tests had left.** Found by step 15's
  build, on a branch made fresh from `main`: the log was empty, so `DSOR-TEN-01b: with every
  policy skipped, DSoR's own store still finds only org_456's rows` failed, or passed only
  after another file had written records. With no `org_789` record in the log it had no
  teeth. Fixed from step 11 on: the test writes a record of each company first, and may take
  60 s, as long as the owner's program it starts.

**Found by step 16's review (2026-10-03), and fixed from step 09 on.**

- **The log trusted an `INSERT` that kept nothing.** `add` sent its `INSERT` and never
  asked how many rows the database wrote. But the owner can attach code to a table that
  runs on each write: a rule `DO INSTEAD NOTHING`, or a trigger that returns `NULL`. With
  either on `dsor.audit`, the database takes the `INSERT`, gives no error, and keeps no
  row. In step 16's review, the program answered every call and kept no record of any of
  them.
  - **Fixed:** `add` throws unless its `INSERT` wrote exactly one row. It throws inside
    `inCompany`'s work, so the transaction is rolled back, and the caller hears
    `EVIDENCE_STORE_UNAVAILABLE` (DSOR-EXE-03b).
  - **Caught by** `DSOR-EXE-03b: a log whose INSERT keeps no row gives no invoice, and no
    record`, in `test/audit.db.test.ts`. Like the `COMMIT` test beside it, it changes one
    statement on its way to the real database: the log's `INSERT` becomes
    `INSERT … SELECT … WHERE false`, which keeps no row. The test also checks that this
    statement ran once and kept 0 rows, so an `INSERT` that failed cannot pass it.
- **The start-up check read PostgreSQL's names through the search path.** The **search
  path** is the list of schemas PostgreSQL looks in to find a name such as
  `has_table_privilege`. The owner can put `public` first, and make functions there with
  PostgreSQL's names that answer "no". Then a login that can change the log passes the
  check.
  - **Fixed:** the check runs inside a transaction that starts with
    `SET LOCAL search_path TO pg_catalog, pg_temp`. So PostgreSQL's own schema,
    `pg_catalog`, is searched first. `SET LOCAL` lasts only until the transaction ends.
    The check takes one connection as well as a pool.
  - **Caught by** two tests in `test/audit.db.test.ts`. `DSOR-AUD-04a: the start-up check
    reads PostgreSQL's own names, whatever the search path finds first` starts a child
    program, `test/owner-login-check.ts`. As the owner, inside a transaction that is
    rolled back, it makes three look-alikes: functions in `public` with the names of
    PostgreSQL's own, which answer "no". It puts `public` first and runs the check, which
    must still say that the owner can change the log. `DSOR-AUD-04a: the start-up check
    pins the search path inside a transaction of its own` guards the check the program
    runs on its pool. Outside a transaction, PostgreSQL ignores `SET LOCAL` and warns, so
    the test expects no warning.
- **Red first, and broken on purpose.** Before the fixes, the first two tests failed. The
  call answered with INV-1008's data. The owner's check named 4 problems and left out "can
  change or remove records in dsor.audit" and "is a member of pg_write_all_data". The
  third test passed, as expected: it guards the pool's new transaction. Then three breaks,
  one at a time: `add` without its row count check, the check without `SET LOCAL`, and
  the pool's check without its `BEGIN READ ONLY`. Each turned its own test red, and only
  that one: 1 failed and 77 passed. With the third, the test heard PostgreSQL's two
  warnings: "SET LOCAL can only be used in transaction blocks" and "there is no
  transaction in progress". The 629 unit tests passed every time. The database tests went
  from 75 to 78.

**Left open on purpose:**

- **A definer function that runs as a trigger.** `EXECUTE` is checked when a trigger is
  made, not when it runs, so taking `EXECUTE` from `dsor_runtime` does not stop it. No
  test looks for triggers on the tenant tables. Found by a hostile pass on the Stage 2
  review's fix. The database holds no definer function today.
- **The third layer**, carried from step 10. An answer whose `tenant_id` was rewritten
  to the caller's company, or removed, passes step 10's decision 14, and so does another
  company's name in a `tenant` field, a URI, or a sentence. The Stage 2 review's plan
  closes it in step 12's suite, which is to look for the other company's data itself.
- **A refusal the operation's code throws is not checked**, carried from step 10. Its
  message could name another company's data. The review's plan has step 12's suite check
  an operation's own "not found".
- **`reason` has no size limit in the database**, carried from step 10. Only
  `extensions` has a limit of its own (step 10's decision 12).
- **The program's filter for its own records** could let other runs' records in, and no
  test sees it, because nothing else writes while the program test runs. It changes only
  what the program prints.
- **`EXPLAIN ANALYZE` with no company** prints "Rows Removed by Filter: 3": how many
  invoice rows every company holds together. Only a holder of `dsor_runtime`'s login can
  ask, and such a holder can set any company anyway.

- **A program that holds `dsor_runtime`'s login can set any company.** Row-level security
  stops mistakes, not a hostile program with the login. §36 calls it defense in depth.
- **In `add`, one value gives both the record's company and the transaction's.** So the
  write policy catches a missing or leftover company, never a wrong one.
- **One counter numbers every company's records.** The gaps in `records('org_456')` show
  when, and how often, other companies are served. DSOR-TEN-02a asks for audit partitions
  keyed by tenant. Numbering per company is a step of its own, and a question for the
  specification.
- **The owner must hold `BYPASSRLS`.** Without it, the owner reads no row and a
  migration's `UPDATE` changes none, with no error. Neon's owner holds it.
- **`dsor.principal_id`**, which §36's example also sets, waits until something reads it.
- **Decision 9's rule for joins and foreign keys** waits for a second business table.
- **Neon's pooler is shown, not tested** (decision 8).
- **`src/postgres.ts` is 303 lines,** far past the 150 at which a file wants splitting.
  It was 268 before the Stage 2 review, whose decision 10 added 5, and step 16's review
  added 30 (above). And `src/pipeline.ts` is 228 lines and `src/registry.ts` 161, since
  the Stage 2 review's fixes from step 10. Splitting them is a step of its own.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-TEN-01b | Tenant isolation is enforced in at least two independent layers | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | `test/rls.db.test.ts` (C2): the database's lock alone, with SQL that leaves the company out, and DSoR's lock alone, with the store run by the owner, whom no policy stops. And (C1) every policy exactly as written |
| DSOR-RP-01a | `dsor_runtime` is not a superuser, does not hold `BYPASSRLS`, and owns no tenant table | [§36 PostgreSQL reference connector](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) | `test/audit.db.test.ts` (the role's facts, and no role membership), `test/runtime-role.test.ts` (the start-up check refuses each, from hand-made facts). Since the Stage 2 review, `test/program.db.test.ts` too: the program started as the owner is refused for holding `BYPASSRLS` and for its role membership, facts read from the real database |
| DSOR-RP-01b | Tenant tables use `FORCE ROW LEVEL SECURITY` | [§36 PostgreSQL reference connector](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) | `test/rls.db.test.ts` (C1): every table with a company column, found in the catalog. Since the Stage 2 review, the catalog holds no view, materialized view, foreign table, or definer function that goes around the policies, and each filter is tested on planted rows. Those guards keep decision 1, which reaches past this rule's tables |
| DSOR-RP-01c | The tenant setting is transaction-local | [§36 PostgreSQL reference connector](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) | `test/rls.db.test.ts` (C4): a pool of one connection, through the program's own store and log |
| DSOR-RP-01d | A query with no tenant setting yields no rows | [§36 PostgreSQL reference connector](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) | `test/rls.db.test.ts` (C3): a fresh connection, and one that has just held `org_456`, for both tables |

Also advanced, not claimed in full: DSOR-TEN-02a, for the audit table only
(`test/rls.db.test.ts`, C5). Its idempotency records, counters, holds, proposals, and
events come with their own steps, and one counter still numbers every company's records.

## Next

Step 12 · The cross-tenant test suite: every operation is called with another company's
URI, and every one must refuse.
