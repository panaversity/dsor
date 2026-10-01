# Step 09 · Postgres on Neon

**New in this step:** the decision log and the invoices move into PostgreSQL, and the
database user DSoR runs as can add log rows but can never change or delete them
(DSOR-AUD-04a).

## In plain words

Step 08's log was a list in the program's memory. It had two weaknesses. When the
program stopped, every record was gone. And the program that wrote the records could
also have changed them.

From this step, the log is a table in a **database**. A database is a program whose job
is to keep data safe on disk, so a record it has **committed** (saved for real) survives
a crash. This tutorial uses **PostgreSQL** ("Postgres"), hosted by **Neon**.

The database has its own users, separate from DSoR's login tokens, and each user gets its
own **privileges**: what it may do to each table. DSoR's program logs in as a user called
`dsor_runtime`, which may add a record and read records, and nothing more. Changing or
deleting a record fails with "permission denied", and the database refuses it, not our
code. A second user, the owner, builds the tables and is used for nothing else.

Think of a locked **letterbox**. Anyone can drop a letter through the slot, and a small
window lets you see what is inside. Nobody at the slot can take a letter out or change
one. Only the owner's key opens the box, and this step keeps that key out of the
program. The analogy stops there: the owner can still open the box and change a letter.
Catching that is step 39.

A few more words you will meet below. A **migration** is a file of SQL that builds or
changes the tables. This step has one. A **transaction** is a group of statements that
the database keeps all together or not at all. **Rolling back** a transaction throws
all of it away. A **superuser** is a database user that may do anything, whatever it
was granted. `TRUNCATE` empties a whole table at once. It is a privilege of its own,
separate from `DELETE`. The **catalog** is the database's own tables about its users,
its tables, and its privileges. And a **schema** here is a folder of tables in
Postgres, not the JSON Schema files of earlier steps.

## Why it matters

**Evidence that disappears on a crash is not evidence.** Step 08 wrote every decision
before the answer. But "before" is only half of DSOR-EXE-02. The rule says the decision
must be **durably** recorded before the response. If the program crashes a second after
saying "yes", a record in memory is gone, and so is the only proof that DSoR decided.

**A log that the writer can edit is not evidence either.** Suppose a bug, or an attacker
who controls DSoR's program, runs `UPDATE audit SET result = 'ok'` over a refusal. If
DSoR's own database user is allowed to do that, the log can say anything. §30 is
direct: "The account DSoR itself runs under has no permission to edit or delete log
rows."

**Common mistake:** creating `dsor_runtime` in the Neon console. Neon's documentation
says: "Your Postgres role and roles created in the Neon Console, API, and CLI are
granted membership in the neon_superuser role." That role holds `pg_write_all_data`,
which allows UPDATE and DELETE on every table, whatever we grant or revoke. A role
created with SQL gets "only the basic public schema privileges". (Neon's
[roles page](https://neon.com/docs/manage/roles), read on 2026-09-28.)

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of the specification it relies on was read on
2026-09-28: §21 (DSOR-EXE-02, DSOR-EXE-03b), §29 (DSOR-AUD-02a), §30 (DSOR-AUD-04a),
§36 (the role names, and DSOR-RP-01a), and threat T12 in §10.2. If the code finds the
plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** Evidence is neither lost nor rewritten. A decision that DSoR has answered is
already committed to a database, and the program that wrote it cannot change or delete
it. The analogy is the letterbox.

**Outcome.** What is true when this step is done:

1. When `call` answers, its record is already committed in the table `dsor.audit`.
2. The record is still there after the program stops and starts again.
3. As `dsor_runtime`, `UPDATE`, `DELETE`, and `TRUNCATE` on `dsor.audit` fail with a
   permission error.
4. If the database cannot take the record, the caller hears
   `EVIDENCE_STORE_UNAVAILABLE`, never the answer (step 08's decision 4, now with a real
   store that can fail).
5. `invoice.get` reads INV-1008 from the table `app.invoices`, and its money comes back
   as `{ value: "31400.00", currency: "USD" }`, exactly.
6. No secret is in git. The connection strings live in `.env`, which git ignores.

**Not the outcome of this step.** A chain of fingerprints that shows whether the owner
changed an old record (step 39). A tenant on every row, and row-level security (steps 10
to 13). A record that validates against `audit-record.schema.json` (DSOR-AUD-01, which
needs step 39's chain and step 18's identity mode). Writing an invoice: no command runs
yet.

**The success signals**, each a test that fails if this step's code is deleted:

- As `dsor_runtime`, `UPDATE dsor.audit …` fails with Postgres's permission error,
  `42501`. This is the map's "done when".
- A call answers. A second, separate connection finds its record by `request_id`.
- The program's connections are closed and new ones are opened, as a restart would do.
  The record is still there.

### What the specification asks, and what this step can honestly give

Checked on 2026-09-28:

1. **DSOR-EXE-02 says "durably … before the response is returned".** Step 08 gave
   "before". This step adds "durably": `call` waits until the database has committed
   the record, and only then answers.
2. **DSOR-AUD-04a is an L2 rule**, one level above the L1 core. The map brings it here
   because the database user is created now, and a user that is created with too much
   is hard to notice later.
3. **DSOR-AUD-02a says audit "MUST NOT be stored only as agent memory".** The log is in
   DSoR's own database, written through DSoR's own connection. Nothing of it passes
   through the agent.
4. **DSOR-RP-01a says `dsor_runtime` "MUST NOT be a superuser, hold `BYPASSRLS`, or own
   tenant tables".** It belongs to the row-level security step. This step checks two of
   its three clauses anyway (not a superuser, no `BYPASSRLS`, owns no table), because
   each one would also weaken DSOR-AUD-04a. The rule is claimed in its own step.
5. **Step 08 said this step could catch its break S2**, the record written in a
   `finally` block. Thought through again: in a function call, the answer leaves only
   when `call` returns, and a `finally` block finishes before that. Stopping the program
   between the decision and the answer loses both the answer and the record, whichever
   way the code is written. So S2 still survives here. It becomes catchable when a
   server sends the answer over a network, in step 42. The break the database *can*
   catch is S2's cousin: starting the write and answering without waiting for it (break
   T5 below).

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-AUD-04a | **C1.** `dsor_runtime` cannot change or remove an audit record | As `dsor_runtime`: `UPDATE`, `DELETE`, and `TRUNCATE` on `dsor.audit` each fail with `42501`. It can update no column, cannot touch the sequence, can create in no schema, owns no table, is not a superuser, and is not a member of `pg_write_all_data`. The program refuses to start otherwise |
| DSOR-EXE-02 | **C2.** The record is committed before the answer | When `call` answers, a separate connection finds the record, even for a request id the database could not keep (decision 16) |
| DSOR-EXE-02 | **C3.** The record survives a restart | Close every connection, open new ones, find the record |
| DSOR-EXE-03b | **C4.** If the database cannot take the record, the caller hears `EVIDENCE_STORE_UNAVAILABLE` | A real database refusal (for example, a closed pool), and the invoice is not returned |
| DSOR-AUD-02a | **C5.** The log lives in DSoR's database | The record is a row of `dsor.audit` |
| (our decision) | **C6.** Invoices come from the database, and money never becomes a `number` | `invoice.get` returns `"31400.00"` exactly. `dsor_runtime` cannot change `app.invoices` |
| (the map's "done when") | **C7.** No secret is in git | `.env` is ignored by git, and `.env.example` holds only names |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **The driver is `pg` (node-postgres), with its `Pool`.** A pool keeps a few open
   connections and lends one to each query, so each call does not pay for a new
   connection. `pg` works with Neon and with a Postgres on your own computer. (The
   learner asked about psycopg 3 and psycopg-pool: those are the Python driver and its
   pool. `pg` and `pg.Pool` are the Node equivalents.) *Downside:* Neon's own serverless
   driver can be faster from some hosts, and this step does not use it.
2. **Two schemas.** A schema is a folder of tables. `app.invoices` holds the company's
   data, and `dsor.audit` holds DSoR's own records. The map opens the `dsor` schema in
   step 16. This step opens it now, because the log is DSoR's own record, not business
   data. *Downside:* the step differs from the map's layout until step 16.
3. **Two database users, with §36's names in mind.** The **owner** is the Neon project's
   own role. It plays §36's `dsor_migration`: it runs the migrations and owns every table.
   The program never uses it. **`dsor_runtime`** is created by a migration, with SQL,
   never in the Neon console (see the common mistake above). *Downside:* the owner
   appears in the database as Neon's name for it, such as `neondb_owner`, not
   `dsor_migration`.
4. **Two secrets, in `.env`, never in git.** `DSOR_MIGRATION_URL` logs in as the owner,
   for migrations only. `DSOR_DB_URL` logs in as `dsor_runtime`, for the program and the
   tests. The migration that creates `dsor_runtime` takes its password from
   `DSOR_DB_URL`, so the password is written in one place only. The SQL quotes it with
   `format('%L', …)` and never pastes it into a string. Node reads `.env` itself
   (`util.parseEnv`), so no package is needed for it. **The program takes only
   `DSOR_DB_URL` from the file**, and only `pnpm migrate` takes `DSOR_MIGRATION_URL`.
   Found by the review: loading the whole file put the owner's key inside the running
   program, where an attacker who controls it could log in as the owner. *Downside:* the
   migration script sees the runtime password, and both secrets still share one file.
5. **`dsor_runtime` holds exactly these privileges.** On `dsor.audit`: `SELECT`, and
   `INSERT` on the named columns only, never on `sequence` or `at` (decision 6). On
   `app.invoices`: `SELECT`. On both schemas: `USAGE`. Nothing else: no `UPDATE` on any
   single column, nothing on the sequence that numbers the records, no `CREATE` in any
   schema, and no `TRUNCATE`, which "no DELETE" does not cover. Found by the review: a
   grant on one column, or on the sequence, is invisible to a list of whole-table grants,
   so the test asks Postgres about every column, the sequence, and each schema. Reading the log is allowed so that the
   tests and later steps can read it back. §30 also says reading audit must itself be
   authorized and audited (DSOR-AUD-05b), which comes with the audit reader in a later
   step. *Downside:* a bug in DSoR can read the whole log.
6. **The database numbers and timestamps each record.** `sequence` is an identity
   column (a number the database fills in, one higher each time), and `at` is the database's `now()`. One counter and one clock, instead of one
   per server. `dsor_runtime` may not write either column, so the program cannot backdate
   a record or choose its number. Found by the review: with `INSERT` on the whole table,
   it could. *Downside:* `now()` is the time the transaction started, not the moment
   the row was written.
7. **Money is stored as `numeric` and a `char(3)` currency.** `numeric` is exact.
   `pg` returns a `numeric` as text, so no `number` ever touches it. *Downside:* a
   `numeric` with no scale keeps whatever scale was stored, so `31400.00` must be stored
   with its two decimals, and a test checks it.
8. **`pnpm check` needs no database.** The unit tests use the in-memory log from step
   08, which now has the same `async` shape as the database log. The database tests are
   named `*.db.test.ts` and run with `pnpm test:db`. If `DSOR_DB_URL` is missing, they
   **fail**, with a message that says what to set, and never skip quietly. A skipped
   test looks green and proves nothing. *Downside:* two commands, and the CI that runs
   `pnpm check` in every step never runs the database tests.
9. **`call` becomes `async`.** It must wait for the database, so it returns a
   `Promise`, and line ⑪ is `await log.add(…)`. *Downside:* every caller and every test
   changes a little, for one new idea.
10. **The tests run on a Neon branch, never on `main`.** A branch is an instant copy of
    the database. This step's `.env` points at a branch called `step-09`. The tests
    never delete audit rows, because `dsor_runtime` cannot: each test uses its own
    `request_id` and finds its own rows. *Downside:* the branch's log grows with every
    test run. Deleting the branch and making a new one starts it empty.
11. **A call with no login still gets one record each,** as in step 08's decision 3,
    even though a real table can now fill up. Counting instead, as §29 allows, is a job
    for rate limiting in a later step. *Downside:* a flood of calls with no login grows
    the log, now on disk.

Decisions 12 to 14 were added once the code was about to start, because decisions 8 and
9 left them open. The learner chose each one.

12. **Invoices come from a store with two versions, like the log.** An invoice store
    has one function, `get(id)`. The in-memory version holds step 08's INV-1008 and
    serves the unit tests. The Postgres version reads `app.invoices` and serves the
    program and the database tests. The operations are built with a store passed in,
    as `call` is given the log, and an operation's code may now be `async`.
    *Downside:* one more thing is passed from `main.ts` down to the code.
13. **One migration, safe to run twice.** `pnpm migrate` runs it as the owner. Each
    table is created only if it is missing. `dsor_runtime` is created if it is
    missing; otherwise its password is set again from `DSOR_DB_URL`, so `.env` stays
    the one place it is written. INV-1008 is added if it is missing. A second run takes
    away every privilege `dsor_runtime` holds on the tables, their columns, the
    sequences, and the schemas, then grants decision 5's list again. It does **not**
    undo a role membership, a role attribute such as `SUPERUSER`, or a changed table
    owner. Those are caught by the lock test and by the program's start-up check
    (decision 17). *Downside:* nothing records which migrations have run. A table for that arrives
    with the second migration.
14. **The database tests are left out by the config.** `vitest.config.ts` excludes
    `*.db.test.ts`, and a second config, `vitest.db.config.ts`, includes only them. It
    is the one `pnpm test:db` uses. *Downside:* two config files.
15. **The program now needs the database, so its full runs are database tests.** The
    three step-08 tests that run `src/main.ts` to the end move to
    `test/program.db.test.ts`. The start-up refusals stay unit tests: `main.ts` checks
    the contracts, the roles, and the input schemas before it reads `DSOR_DB_URL`, so
    they need no database. With no `DSOR_DB_URL`, the program stops and names it. It
    never falls back to the log in memory, because a missing secret must not quietly
    mean evidence that is lost on a crash. *Downside:* `pnpm check` no longer runs the
    program's happy path.

Decisions 16 and 17 were added after the hostile review, which found each gap live.

16. **A request id must be text Postgres can keep.** Step 05 accepted any text of 1 to
    128 characters. Postgres's `jsonb` refuses the NUL character and half of an emoji,
    so such an id made the record fail, and the caller heard
    `EVIDENCE_STORE_UNAVAILABLE`: a call that left no evidence at all, from a store that
    was healthy. From this step, a request id must also be well-formed text with no
    control characters. Anything else is refused with `VALIDATION_FAILED`, under an id
    DSoR makes, and that refusal is recorded. This tightens step 05's decision 6.
    *Downside:* a caller that labels its calls with control characters is refused.
17. **The program checks who it logged in as, and fails closed.** At start-up, before
    any call, it asks Postgres about its own login: it must be `dsor_runtime`, not a
    superuser, without `BYPASSRLS`, not a member of `pg_write_all_data`, the owner of no
    table, and unable to change `dsor.audit`. If any answer is wrong, it names the
    problem and stops. A student who pastes the owner's string into `DSOR_DB_URL` is
    stopped here. One database test starts the program with exactly that string, and
    expects the refusal, so deleting the check turns it red. It is the only test that
    touches the owner's key, and it never logs in as the owner itself. Found by a second
    review: with the check deleted, every test stayed green. The test reads the owner's
    key into a variable of its own, never into the test process's environment, so no
    program it starts later inherits it. *Downside:* one more query at start-up, and the
    database tests need `DSOR_MIGRATION_URL` too.
18. **A test about a secret removes the secret before it checks anything.** When a
    check fails, vitest prints both sides, so `expect(output).not.toContain(secret)`
    would print the secret exactly when it leaked, into a terminal or a CI log. So every
    test that reads a program's output first replaces each connection string, and each
    password alone, with a label such as `<owner URL>`. Then it asserts on what is left.
    Found by a third review. *Downside:* a failing test shows where a secret was, not
    what it was.

### The tests, by claim

- **C1:** connected as `dsor_runtime`, `UPDATE`, `DELETE`, and `TRUNCATE` on
  `dsor.audit` each fail with code `42501`, and so does an `INSERT` that sets `at` or
  `sequence`. Postgres's own `has_…_privilege` functions show every privilege
  `dsor_runtime` holds, column by column, on the sequence, and on each schema, and they
  match decision 5 exactly. A query of Postgres's catalog (its own tables about users
  and tables) shows that `dsor_runtime` owns no table, is not a superuser, has no
  `BYPASSRLS`, and is not a member of `pg_write_all_data`. The start-up check turns
  each wrong answer into a named problem (decision 17).
- **C2:** a call answers, and a second pool, opened only for the test, finds exactly
  one record with that call's `request_id`, with the right `authorization` and
  `result`. A refusal too: a denied `invoice.issue`, and a not-found `invoice.get`. A
  request id with a NUL character is refused, and its refusal is recorded.
- **C3:** after all of the program's pools are closed and new ones opened, the record
  from C2 is still there. That is a restart. For a crash, a child program calls
  `invoice.get`, writes the answer, and kills itself with `SIGKILL` at once, with no
  clean-up. Then the test looks for the record. This is fault injection, the way §47
  asks crash guarantees to be proved. Added after a second review found that closing
  pools politely proves a restart, not a crash.
- **C4:** a call whose log cannot write, because its pool is closed or its password is
  wrong, answers `EVIDENCE_STORE_UNAVAILABLE`, and no invoice is returned.
- **C5:** the record of C2 is a row of `dsor.audit`.
- **C6:** `invoice.get` for INV-1008 returns `value: "31400.00"` as a string.
  `UPDATE app.invoices …` as `dsor_runtime` fails with `42501`. An id written as SQL,
  `INV-9999' OR '1'='1`, finds nothing, because the id travels as a value.
- **C7:** `.env` is ignored by git, and `.env.example` names the two variables without
  values. The program takes only `DSOR_DB_URL` from `.env`. `pnpm migrate` refuses a
  `DSOR_DB_URL` that does not log in as `dsor_runtime` with a password.
- **Decision 8:** `pnpm test:db` with no `DSOR_DB_URL` fails and names the variable.

### Breaks we will try, and what we expect

Run against the finished step, against a real database. The learner's predictions were
recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| T1 | `GRANT UPDATE ON dsor.audit TO dsor_runtime` | C1's UPDATE test | only the UPDATE test (asked after the code, before the break) |
| T2 | The tables are created by `dsor_runtime`, so it owns them | C1: an owner may change its own table, and the ownership check | UPDATE, DELETE, TRUNCATE, and the ownership check (asked after the code) |
| T3 | `dsor_runtime` is created in the Neon console instead of by SQL. Performed with a throwaway console role, deleted afterwards | C1's UPDATE test and the `pg_write_all_data` check | caught by the UPDATE test |
| T4 | `GRANT TRUNCATE ON dsor.audit TO dsor_runtime` | only C1's TRUNCATE test | caught only by the TRUNCATE test |
| T5 | Line ⑪ starts the write and does not wait for it (`log.add(…)` without `await`) | C4, and maybe C2 | C4 always, C2 only sometimes (a race) |
| T6 | The record is written in a `finally` block (step 08's S2) | nothing, as point 5 above explains | survives again |
| T7 | The money is read as a `number` | C6 | C6, because 31400.00 becomes 31400 (asked after the code) |

The review also attacks the step with the threat that is this step's reason, T12 in
§10.2: "audit tampering, loss of evidence on crash, audit flooding".

### Left open, and not this step's idea

- **A chain of fingerprints**, so an edit by the owner shows: step 39.
- **A tenant on every row, and row-level security:** steps 10 to 13, with the rest of
  DSOR-RP-01a.
- **Reading audit authorized and audited** (DSOR-AUD-05b): a later step.
- **Counting refusals with no login** instead of one record each: with rate limiting.
- **S2 caught for real:** step 42, when a server sends the answer over a network.

## Before you build: set up Neon

You do this once, by hand. Claude Code never sees a password.

1. In the [Neon console](https://console.neon.tech), create a project used **only** for
   this tutorial, then a branch called `step-09`.
2. Copy the branch's connection string for the owner role. In this folder, create a file
   `.env` with one line: `DSOR_MIGRATION_URL=` followed by that string. Then change
   `sslmode=require` in it to `sslmode=verify-full` (see below).
3. Choose a long password for `dsor_runtime`, made of letters and digits only. Add a
   second line, the same string with the owner's name and password replaced:
   `DSOR_DB_URL=postgresql://dsor_runtime:<password>@<same host>/<same database>?sslmode=verify-full&channel_binding=require`.
4. Do **not** create `dsor_runtime` in the console. The first migration creates it.
5. Tell Claude Code "`.env` is set". Never paste the file.

**Claude Code and the owner.** This folder's `.mcp.json` connects Claude Code to Neon's
MCP server, which acts as your Neon account after you log in. The agent never sees a
password, but it can run any SQL as the owner, `UPDATE dsor.audit` included. That is
fine for development on a project made only for this tutorial, and it is one more
reason never to connect a project that holds real data. DSOR-AUD-04a is about the
program's database user, and the program never gets that power. To make the agent
read-only, add `?readonly=true` to the URL in `.mcp.json`.

**Why `verify-full`.** `sslmode` says how hard the program checks that it is talking to
Neon and not to an impostor. `verify-full` checks Neon's certificate and its host name.
Found live 2026-09-28: with the console's `sslmode=require`, `pg` 8.23 prints a
"SECURITY WARNING". It treats `require` as `verify-full` today, and says that from `pg` 9
`require` will mean a weaker check. Writing `verify-full` keeps the strong check when
`pg` changes.

## What changed since step 08

| File | What changed |
| --- | --- |
| `migrations/001_audit_and_invoices.sql` | **New.** The two schemas, the two tables, `dsor_runtime`'s privileges, and INV-1008 |
| `src/migrate.ts` | **New.** `pnpm migrate`: creates `dsor_runtime` with SQL, then runs the migration, as the owner |
| `src/postgres.ts` | **New.** Reading `.env`, the pool, the log as `dsor.audit`, the invoices as `app.invoices` |
| `src/log.ts` | The log's two functions are `async`. The log in memory stays, for the unit tests |
| `src/invoice.ts` | `InvoiceStore`, and `memoryInvoices()` for the unit tests |
| `src/operations.ts` | `handlersFor(store)`: the operations are built with the store their invoices come from |
| `src/pipeline.ts` | `call` is `async`, and waits at lines ⑨ and ⑪ |
| `src/main.ts` | The start-up checks, then `DSOR_DB_URL`, then the same eight calls against the database |
| `test/audit.db.test.ts`, `test/invoices.db.test.ts`, `test/program.db.test.ts` | **New.** The database tests, C1 to C6 |
| `test/db.ts`, `test/db-setup.ts`, `vitest.db.config.ts` | **New.** What the database tests share, and their own command |
| `test/secrets.test.ts` | **New.** C7, decision 8, and the invoices in memory |
| every other test | `await` before each call. Three whole-program tests moved to `program.db.test.ts` |
| `.env.example` | **New.** The two variable names, with no values |
| `src/request.ts` | A request id must also be well-formed, with no control characters (decision 16) |
| `test/runtime-role.test.ts` | **New.** The start-up check's problems, one by one (decision 17) |
| `.mcp.json` | **New.** Neon's MCP server for Claude Code, logged in with OAuth, no secret in the file |

The new dependency is `pg` 8.23.0, the PostgreSQL driver for Node (decision 1), with
`@types/pg` 8.23.1 for its types.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_08_write_the_decision_first/src mj_09_postgres_on_neon/src
git diff --no-index mj_08_write_the_decision_first/test mj_09_postgres_on_neon/test
```

## Run it

Set up Neon first (the section above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # once; running it again is safe
pnpm check        # typecheck and the unit tests: no database needed
pnpm test:db      # the database tests, against the branch in .env
pnpm start        # the program, against the same branch
```

`pnpm migrate`, run twice, on 2026-09-28:

```text
dsor_runtime: created
migration 001_audit_and_invoices: done

dsor_runtime: password set again from DSOR_DB_URL
migration 001_audit_and_invoices: done
```

The end of `pnpm start`. The numbers 63 to 70 come from the database, and keep growing
with every run and every test run:

```text
63 invoice.get@1 ALLOW ok
64 invoice.get@1 ALLOW RESOURCE_NOT_FOUND
65 invoice.issue@1 DENY AUTHORIZATION_DENIED
66 invoice.get@1 DENY AUTHENTICATION_REQUIRED
67 invoice.get@1 DENY AUTHORIZATION_DENIED
68 invoice.get@1 ALLOW ok
69 invoice.issue@1 DENY UNSUPPORTED_CAPABILITY
70 invoice.issue@1 DENY VALIDATION_FAILED
{
  code: 'EVIDENCE_STORE_UNAVAILABLE',
  message: 'DSoR could not record its decision, so it refuses the call',
  retry: 'safe_same_key',
  correlation: {
    request_id: 'req_b94d3ce8-c130-46c5-9122-8b871005ea56',
    agent_id: 'accounts-payable-fte'
  }
}
```

## Break it

Every break below was performed on 2026-09-28, against the Neon branch `step-09`, then
put back, and both test commands were green again. The database breaks were run as the
owner. Every test that tries to change the log does it inside a transaction that is
always rolled back, so a break that opens the lock still cannot change a record.

| # | The break | Predicted | What really went red |
| --- | --- | --- | --- |
| T1 | `GRANT UPDATE ON dsor.audit TO dsor_runtime` | only the UPDATE test | the UPDATE test **and** the exact list of privileges. After the review: those two and the start-up check |
| T2 | `dsor_runtime` owns `dsor.audit` | UPDATE, DELETE, TRUNCATE, ownership | those four **and** the list of privileges: an owner holds every privilege. Not run again after the review |
| T3 | a role made by Neon's API, as the console does | the UPDATE test | UPDATE, DELETE, the list (empty!), the `pg_write_all_data` check, the role's name. **TRUNCATE stayed refused**. Not run again after the review |
| T4 | `GRANT TRUNCATE ON dsor.audit TO dsor_runtime` | only the TRUNCATE test | the TRUNCATE test **and** the list of privileges. After the review: those two and the start-up check |
| T5 | line ⑪ without `await` | C4 always, C2 sometimes | 5 unit tests and 7 database tests: C4, C3, the program. C2's second connection still found its record: the race was won. The number depends on the network's speed: the reviewer's run had 8 |
| T6 | the record written in a `finally` block | survives | **survives**: 484 unit and 20 database tests green |
| T7 | the amount read as a `number` | C6 | C6. And, once its check was anchored, the program test |
| T8 | the program started with the owner's string in `DSOR_DB_URL` | (added after the review) | the program refuses to start, and names five problems |
| R1 | `GRANT UPDATE (reason) ON dsor.audit`: one column | (the review's) | before the fix: **nothing**. After: the list of privileges and the start-up check |
| R2 | `GRANT UPDATE ON SEQUENCE dsor.audit_sequence_seq` | (the review's) | before the fix: **nothing**. After: the list of privileges |
| R3 | `GRANT CREATE ON SCHEMA dsor` | (the review's) | before the fix: **nothing**. After: the list of privileges |
| R4 | the invoice id pasted into the SQL | (the review's) | before the fix: **nothing**. After: C6's test with `INV-9999' OR '1'='1` |
| R5 | the start-up check deleted from `main.ts` | (the second review's) | before: **nothing**, all 527 tests green. After: the start-up test, because the program ran as the owner and exited 0 |
| R6 | line ⑪ without `await`, then a crash (T5 against the crash test) | (the second review's) | the crash test: the caller heard "ok", and the table held no record |
| R7 | `main.ts` prints its own `DSOR_DB_URL` | (the third review's) | the start-up test, and its failure shows `oops, printed <owner URL>`: the label, never the key |

**T1.** The owner hands out UPDATE:

```text
owner ran: GRANT UPDATE ON dsor.audit TO dsor_runtime
  -> GRANT
     × DSOR-AUD-04a: UPDATE on dsor.audit fails with 42501 2257ms
     × DSOR-AUD-04a: dsor_runtime holds exactly SELECT and INSERT on the log, SELECT on invoices 241ms
AssertionError: promise resolved "Result{ command: 'UPDATE', …(9) }" instead of rejecting
AssertionError: expected [ …(4) ] to strictly equal [ …(3) ]
```

The first time, before the rollback existed, this break did real harm: the test's own
`UPDATE dsor.audit SET result = 'ok'` ran, and every older record on the branch now says
`ok`, the refusals too. That is exactly the damage this step exists to stop.

**T2.** Postgres refused the break twice before it could be made. Since Postgres 16, a
table can be given only to a role you may act as, and the new owner needs `CREATE` in the
schema:

```text
owner refused: ALTER TABLE dsor.audit OWNER TO dsor_runtime
  -> 42501 must be able to SET ROLE "dsor_runtime"
owner refused: ALTER TABLE dsor.audit OWNER TO dsor_runtime
  -> 42501 permission denied for schema dsor
owner ran: GRANT CREATE ON SCHEMA dsor TO dsor_runtime
owner ran: ALTER TABLE dsor.audit OWNER TO dsor_runtime
     × DSOR-AUD-04a: UPDATE on dsor.audit fails with 42501 1961ms
     × DSOR-AUD-04a: DELETE on dsor.audit fails with 42501 625ms
     × DSOR-AUD-04a: TRUNCATE on dsor.audit fails with 42501 661ms
     × DSOR-AUD-04a: dsor_runtime holds exactly SELECT and INSERT on the log, SELECT on invoices 229ms
     × DSOR-AUD-04a: dsor_runtime owns no table, is no superuser, and cannot write every table 221ms
```

**T3.** A role made through Neon's API joins `neon_superuser`, as a console role does.
The tests ran as that role, which was deleted afterwards:

```text
     × DSOR-AUD-04a: UPDATE on dsor.audit fails with 42501 2425ms
     × DSOR-AUD-04a: DELETE on dsor.audit fails with 42501 722ms
     × DSOR-AUD-04a: dsor_runtime holds exactly SELECT and INSERT on the log, SELECT on invoices 235ms
     × DSOR-AUD-04a: dsor_runtime owns no table, is no superuser, and cannot write every table 230ms
     × the tests really are dsor_runtime 229ms
AssertionError: expected [] to strictly equal [ …(3) ]
```

Two surprises. The list of privileges is **empty**: the role's power comes from a role
it belongs to, and a list of its own privileges cannot show that. Only the membership
check and the tests that really try catch it. And TRUNCATE stayed refused, because
`pg_write_all_data` gives INSERT, UPDATE, and DELETE, not TRUNCATE.

**T5.** `log.add(…)` without `await`:

```text
=== unit
     × DSOR-EXE-03b: a call that would succeed is refused, and the invoice never returned 8ms
     × DSOR-EXE-03b: a call that would be refused hears the same 1ms
     × DSOR-EXE-03b: the refusal keeps the caller's own request id and names the caller 1ms
     × DSOR-EXE-03b: a log that throws something that is not an Error is refused the same 1ms
     × the refusal passes the error envelope's schema 1ms
⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
=== db
     × starts, reads INV-1008 through invoice.get, and prints every answer as an envelope 4793ms
     × finds its own role table and .env, whatever folder it is started from 5038ms
     × DSOR-EXE-02: prints one record for each of its eight calls, in order 4914ms
     × DSOR-EXE-02: the log reads back what it wrote, through its own records() 1950ms
     × DSOR-EXE-02: every pool the program used is closed, new ones are opened, and the record is there 3395ms
     × DSOR-EXE-03b: a log whose pool is closed gives no invoice, and no record 1534ms
     × DSOR-EXE-03b: a log with the wrong password gives no invoice, and no word about why 1530ms
```

**T8.** The owner's connection string handed to the program:

```text
exit: 1
stdout: operations: [ 'invoice.get', 'invoice.issue' ]
stderr: DSOR_DB_URL must log in as dsor_runtime. Refused: logged in as "neondb_owner", not dsor_runtime; holds BYPASSRLS; is a member of pg_write_all_data; owns 10 tables; can change or remove records in dsor.audit.
```

Neon's owner holds `BYPASSRLS` and belongs to `pg_write_all_data`: it can change any
table, whatever is revoked. That is why it is never the program's login.

**R1.** A grant on one column, after the fix:

```text
owner ran: GRANT UPDATE (reason) ON dsor.audit TO dsor_runtime
     × DSOR-AUD-04a: dsor_runtime holds exactly decision 5's privileges, column by column 235ms
     × DSOR-AUD-04a: the program's start-up check finds no problem with dsor_runtime 238ms
```

Before the fix, all 20 database tests stayed green, and the reviewer, as `dsor_runtime`,
could turn 123 refusals into `ALLOW` (in a transaction that was rolled back).

**T5 against a crash.** Added after a second review. A child program answers, then
kills itself with `SIGKILL`. With line ⑪'s `await` removed, the caller heard "ok", and
the table held nothing:

```text
     × DSOR-EXE-02: a program killed with SIGKILL the moment it answers has left its record 3577ms
AssertionError: expected [] to match object [ { authorization: 'ALLOW', …(1) } ]
```

As built, the same test finds the record every time. The reviewer's own run: 5 of 5
records as built, 0 of 5 with the break. An agent told "yes" five times, and no
evidence that any of it happened.

**T7.** `money(String(Number(row.amount_value)), …)`:

```text
     × DSOR-MON-01: invoice.get returns INV-1008 from app.invoices, its money exactly 31400.00 1794ms
AssertionError: expected { Object (data, correlation) } to match object { data: { id: 'INV-1008', …(4) } }
```

The program test stayed green the first time. Its check for
`amount: { value: '31400.00' …` also matched inside `open_amount: { value: '31400.00' …`,
which the break left alone. Anchored to the start of the line, it went red too.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Neon | A project for this tutorial only, and a branch `step-09`. Fill `.env` by hand |
| 2 | Design first | "In plain words", "Why it matters", "The design, before any code" |
| 3 | Check the design | Read §21, §29, §30, §36, and T12 in §10.2. Fill the gaps the code will need (decisions 12 to 15) |
| 4 | Red | The database tests and `secrets.test.ts`. Predict what C1 does before the migration |
| 5 | Green | `postgres.ts`, the migration, `call` made `async`, then `await` in every old test |
| 6 | Break it | Every break, for real, against the branch. Compare with your predictions |
| 7 | Review | A reviewer who has not seen your conversation attacks the step |
| 8 | Fix the review | Change the design first (decisions 4, 5, 6, 13, 16, 17), then red tests, then the code. Run the breaks again |

In the red run, only one assertion failed for a real reason: with no `DSOR_DB_URL`, step
08's program still started. Everything else failed because `src/postgres.ts` did not
exist. Before the migration, the learner predicted that some of C1 would pass. All three
failed, with `28P01`, "password authentication failed": `dsor_runtime` did not exist
yet, so the database turned the login away before any permission check. A test that
checked only "it failed" would have passed for that wrong reason. Each C1 test expects
`42501` exactly.

Build your own step 09 from a copy of your step 08. From `docs/baby_steps_tutorials`:

```bash
cp -R my_08_write_the_decision_first my_09_postgres_on_neon
cd my_09_postgres_on_neon
rm -rf node_modules
claude
```

Set up Neon and `.env` by hand first ("Before you build" above). Then paste:

```text
Use the build-baby-step skill in learner mode for step 09. .env is set; never read it.
Design first, and check it against §21, §29, §30, and §36 before any test. Before each
break, ask me what I expect. Perform every break against my Neon branch, and put it
back after.
```

## Check yourself

1. Step 08 already wrote the record before the answer. What does this step add to
   DSOR-EXE-02?
2. `dsor_runtime` has no UPDATE and no DELETE on `dsor.audit`. Name two ways it could
   still empty or change the table, and how this step closes each one.
3. Why must `dsor_runtime` be created with SQL on Neon, and not in the console?
4. Why do the database tests fail when `DSOR_DB_URL` is missing, instead of skipping?
5. The owner can still change an old record. Which step catches that, and how?

<details>
<summary>Answers</summary>

1. "Durably". The record is committed to a database before `call` answers, so a crash
   after the answer cannot lose it.
2. By owning the table, since an owner may do anything to its own table: the tables are
   created by the owner, never by `dsor_runtime`. By `TRUNCATE`, a separate privilege
   that empties a table: it is never granted. (A third, on Neon: membership in
   `neon_superuser`, which brings `pg_write_all_data`.)
3. Roles created in the Neon console join `neon_superuser`, which holds
   `pg_write_all_data`: UPDATE and DELETE on every table, whatever we revoke. A role
   created with SQL starts with almost nothing.
4. A skipped test looks green and proves nothing. A guarantee about a real database is
   proved only by running against one.
5. Step 39. Each record carries a fingerprint of the one before it, so changing an old
   record breaks every fingerprint after it, and the change shows.

</details>

## Think it through

**Found while building, live:**

- **A test that tries to break the lock must not do damage when the lock is broken.**
  The first run of T1 really rewrote every older record on the branch to
  `result = 'ok'`. Now each try runs in a transaction that is always rolled back
  (`tryThenRollBack` in `test/db.ts`).
- **A refusal test must check which refusal.** Before the migration, UPDATE failed
  with `28P01` (no such login), not `42501` (no privilege). "It failed" would have
  passed for the wrong reason.
- **`jsonb` keeps an object's keys in its own order.** The correlation comes back as
  `{ agent_id, request_id }`. Compare fields, never JSON text.
- **Postgres 16 guards table owners.** T2 needed two extra grants before it could be
  made at all.
- **A test's own label can trip its check.** A request id called `c4-password-…`
  failed the test that looks for the word "password".
- **`sslmode=require`** makes `pg` 8.23 print a security warning. `.env` uses
  `verify-full` (see "Before you build").

**Found by the hostile review, and fixed** (design first, then red tests, then code):

1. **A caller could leave no evidence.** A request id with a NUL character or half an
   emoji made `jsonb` refuse the row. The call was refused as
   `EVIDENCE_STORE_UNAVAILABLE`, and no record of it existed. Now such an id is
   refused with `VALIDATION_FAILED`, and that refusal is recorded (decision 16).
2. **The program carried the owner's key.** Loading all of `.env` put
   `DSOR_MIGRATION_URL` in the program's memory. Now the program takes only
   `DSOR_DB_URL` (decision 4).
3. **The exact list of privileges was not exact.** A grant on one column, on the
   sequence, or `CREATE` in a schema kept every test green. Now Postgres's own
   `has_…_privilege` functions are asked about each one (decision 5, R1 to R3).
4. **The program could backdate a record.** `INSERT` on the whole table let it write
   `at` and `sequence`. Now it may insert only the other columns (decision 6).
5. **A re-run of the migration promised more than it did.** It now also takes away
   sequence privileges. Its comment says what it does not undo (decision 13).
6. **Two tests passed for the wrong reason.** "Not found, and recorded" never read the
   record, and nothing caught SQL pasted into a query (R4).
7. **`migrate.ts` had no test.** Its refusals are now unit tests. The rest (the `%L`
   quoting, the rollback, running twice) is proven by the live runs only.
8. **Nothing checked who the program logged in as.** Now it asks at start-up and
   refuses to run as a user that could change the log (decision 17, T8).
9. The prose: the letterbox's key was on the wrong side, and several words were used
   before they were defined.

**Found by a second review, and fixed:**

10. **C3 proved a restart, not a crash.** It closed the pools politely. Now a child
    program answers and kills itself with `SIGKILL`, and the test finds the record.
    Break T5 turns it red: the caller heard "ok", and no record existed.
11. **Nothing noticed if the start-up check was deleted.** Now a database test starts
    the program with the owner's string and expects it to refuse (decision 17).

**Found by a third review, and fixed:**

12. **The test that guards the owner's key printed it when it failed.** vitest shows
    both sides of a failed check, so `not.toContain(owner)` would have put the key in
    the log at the very moment it leaked. Now the output is redacted first (decision
    18), and the key is read into the test's own variable, not into the environment
    that later programs inherit.

**Found by the Stage 2 review (2026-10-01), and fixed.**

- **A check and the code could see two different inputs.** Line ① read the input
  itself, to check the principals it names. Line ⑥ then made its own copy, for the
  schema check and for the code. A getter, a field that runs code each time it is read,
  can answer the second read differently. The review proved it in step 14: line ① let
  the call through, and the code was handed `cfo_100`. Here no shipped input schema
  lists `principal`, so line ⑥ refused the field, and the hole stayed hidden. The red
  test plants a schema that lists it. The agent's `principal` reads as
  `accounts-payable-fte` first and as `cfo_100` after, and the code was handed
  `principal: "cfo_100"`.
  - **Fixed from step 07 on**, and ported from step 07's fix with the same names,
    comments, and test titles. Line ① makes the one copy, right after it finds who is
    calling. Every check after that, and the code, read only that copy (step 07's
    README, decision 9). An input that JSON cannot copy is refused there. Before that
    refusal, line ① checks the principals it names on the input as sent, so `cfo_100`
    inside it is still `AUTHORIZATION_DENIED`. In this step, every answer is recorded
    at line ⑪, so this refusal is recorded too. Only lines ① and ⑪ run.
  - **Caught by** `DSOR-SRC-02b: a principal that reads as the caller first, then as
    cfo_100, …` in `test/pipeline.test.ts`. The other new tests:
    - In `test/pipeline.test.ts`, ported from step 07: the opposite case, refused. A
      Proxy, an object that runs code on every read, counts the reads of every field:
      the copy reads each field once, and nothing else reads an input it can copy. Four
      tests pin where an input that JSON cannot copy is refused: at line ①, and only
      line ⑪ after it. Two more name `cfo_100` in one, once as plain JSON 100,000
      levels deep, and expect `AUTHORIZATION_DENIED`. They replace the old test of an
      input that contains itself.
    - In `test/who-is-calling.test.ts`, ported from step 07: with no login, an input
      that JSON cannot copy still gets `AUTHENTICATION_REQUIRED`, and the input is not
      read at all.
    - Not in step 07, which has no log. In `test/decision-log.test.ts`: `DSOR-EXE-02:
      … is refused at line ①, and leaves one record`, twice. The record says
      `VALIDATION_FAILED`, or `AUTHORIZATION_DENIED` when the input names `cfo_100`.
      These use the log in memory, as every unit test does (decision 8). The database
      tests do not change, and all 28 still pass.
  - **Red first:** 7 of the 13 new tests failed before the code changed. The code was
    handed `cfo_100`, line ① read eight fields of the input as sent, and the refusals
    ran lines ①, ⑤, ⑥, and ⑪. The other 6 passed, as they should. They guard the new
    code: the opposite case, `cfo_100` named in an input that cannot be copied, and no
    login. 501 tests became 513.
  - **Broken on purpose, ten ways**, in a copy of this folder: the nine breaks in step
    07's README, and one more for this step. The tenth answers the refusal of an input
    that JSON cannot copy at once, from inside the `try` block, so line ⑪ never runs
    and nothing is recorded. Each break turned at least one of these tests red. The
    tenth turned five red, the record test among them.

**Left open on purpose:**

- **A database failure while reading an invoice** (at line ⑨) becomes
  `INTERNAL_ERROR`, recorded as `ALLOW`. §28's `CONNECTOR_UNAVAILABLE` fits better. It
  belongs with connectors, later.
- **`main.ts` picks its own records by request id and `slice`.** A second program
  running at the same moment could confuse it. It is a printout, not a guarantee.
- **`pool.on("error", () => {})`** drops a lost connection with no trace. Logging
  comes later.
- **Audit flooding** (decision 11) and **reading audit unaudited** (DSOR-AUD-05b)
  stay open, as the design said.
- **The analogy.** The letterbox is this step's own. None of the tutorial's
  established analogies fits "add, never change". It stops at the owner's key, and the
  README says so.
- **Both secrets share one file.** The program reads only one of them, but a person
  who can read `.env` holds the owner's key. A separate file for the owner would
  close that.
- **The Neon MCP server has the owner's power** (see "Before you build"). This is a
  choice for development, not a gap in DSoR.
- **`src/pipeline.ts` is 168 lines.** The Stage 2 fix added 22 lines to the 146 it
  had, past the 150 where a file wants splitting. Splitting it is a step of its own.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-AUD-04a | The DSoR runtime identity cannot update or delete audit records | [§30 Audit integrity and retention](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) | `test/audit.db.test.ts` (C1: UPDATE, DELETE, TRUNCATE, every privilege, no backdating, no renumbering, the start-up check), `test/runtime-role.test.ts` |
| DSOR-AUD-02a | Operational audit is not stored only as agent memory | [§29 Audit and decision evidence](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence) | `test/audit.db.test.ts` (C5: a row of `dsor.audit`) |
| DSOR-EXE-02 | The decision is durably recorded before the response is returned | [§21 Command pipeline](../../../specs/dsor/03-execution.md#21-command-pipeline) | `test/audit.db.test.ts` (C2, C3), `test/invoices.db.test.ts`, `test/program.db.test.ts`, and step 08's `test/decision-log.test.ts`, now durable |
| DSOR-EXE-03b | With no record, no answer: `EVIDENCE_STORE_UNAVAILABLE` | [§21 Command pipeline](../../../specs/dsor/03-execution.md#21-command-pipeline) | `test/audit.db.test.ts` (C4: a closed pool, a wrong password), and step 08's tests |

Not met, and why: DSOR-AUD-01, whose record needs a chain of fingerprints (step 39) and
an identity mode for the agent (step 18). DSOR-RP-01a is checked in full by C1's
catalog test, and claimed in the row-level security step.

## Next

Step 10 · Tenants: a `tenant_id` on every row, and every request works inside exactly
one company. **Stage 1 of the learning path is complete** when this step's tests pass.
