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

Think of a **letterbox**. Anyone with the key to the slot can drop a letter in, and the
window lets you see what is inside. Nobody at the slot can take a letter out or change
one. The analogy stops at the lock: whoever holds the owner's key can still open the
box. Catching that is step 39.

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
   its halves anyway (not a superuser, owns no table), because each one would also break
   DSOR-AUD-04a. The rule is claimed in its own step.
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
| DSOR-AUD-04a | **C1.** `dsor_runtime` cannot change or remove an audit record | As `dsor_runtime`: `UPDATE`, `DELETE`, and `TRUNCATE` on `dsor.audit` each fail with `42501`. It owns no table, is not a superuser, and is not a member of `pg_write_all_data` |
| DSOR-EXE-02 | **C2.** The record is committed before the answer | When `call` answers, a separate connection finds the record |
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
   (`process.loadEnvFile`), so no package is needed for it. *Downside:* the migration
   script sees the runtime password.
5. **`dsor_runtime` holds exactly these privileges.** On `dsor.audit`: `INSERT` and
   `SELECT`. On `app.invoices`: `SELECT`. On both schemas: `USAGE`. Nothing else, and no
   `TRUNCATE`, which "no DELETE" does not cover. Reading the log is allowed so that the
   tests and later steps can read it back. §30 also says reading audit must itself be
   authorized and audited (DSOR-AUD-05b), which comes with the audit reader in a later
   step. *Downside:* a bug in DSoR can read the whole log.
6. **The database numbers and timestamps each record.** `sequence` is an identity
   column, and `at` is the database's `now()`. One counter and one clock, instead of one
   per server. *Downside:* `now()` is the time the transaction started, not the moment
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

### The tests, by claim

- **C1:** connected as `dsor_runtime`, `UPDATE`, `DELETE`, and `TRUNCATE` on
  `dsor.audit` each fail with code `42501`. A query of Postgres's own catalog shows
  that `dsor_runtime` owns no table, is not a superuser, has no `BYPASSRLS`, and is not
  a member of `pg_write_all_data`.
- **C2:** a call answers, and a second pool, opened just for the test, finds exactly
  one record with that call's `request_id`, with the right `authorization` and
  `result`. A refusal too: a denied `invoice.issue`.
- **C3:** after all of the program's pools are closed and new ones opened, the record
  from C2 is still there.
- **C4:** a call whose log cannot write, because its pool is closed or its password is
  wrong, answers `EVIDENCE_STORE_UNAVAILABLE`, and no invoice is returned.
- **C5:** the record of C2 is a row of `dsor.audit`.
- **C6:** `invoice.get` for INV-1008 returns `value: "31400.00"` as a string.
  `UPDATE app.invoices …` as `dsor_runtime` fails with `42501`.
- **C7:** `.env` is ignored by git, and `.env.example` names the two variables without
  values.
- **Decision 8:** `pnpm test:db` with no `DSOR_DB_URL` fails and names the variable.

### Breaks we will try, and what we expect

Run against the finished step, against a real database. The learner's predictions were
recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| T1 | `GRANT UPDATE ON dsor.audit TO dsor_runtime` | C1's UPDATE test | not asked; the expectation stands |
| T2 | The tables are created by `dsor_runtime`, so it owns them | C1: an owner may change its own table, and the ownership check | not asked; the expectation stands |
| T3 | `dsor_runtime` is created in the Neon console instead of by SQL | C1's UPDATE test and the `pg_write_all_data` check | caught by the UPDATE test |
| T4 | `GRANT TRUNCATE ON dsor.audit TO dsor_runtime` | only C1's TRUNCATE test | caught only by the TRUNCATE test |
| T5 | Line ⑪ starts the write and does not wait for it (`log.add(…)` without `await`) | C4, and maybe C2 | C4 always, C2 only sometimes (a race) |
| T6 | The record is written in a `finally` block (step 08's S2) | nothing, as point 5 above explains | survives again |
| T7 | The money is read as a `number` | C6 | not asked; the expectation stands |

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
   `.env` with one line: `DSOR_MIGRATION_URL=` followed by that string.
3. Choose a long password for `dsor_runtime`. Add a second line, the same string with
   the owner's name and password replaced: `DSOR_DB_URL=postgresql://dsor_runtime:<password>@<same host>/<same database>?sslmode=require`.
4. Do **not** create `dsor_runtime` in the console. The first migration creates it.
5. Tell Claude Code "`.env` is set". Never paste the file.

## What changed since step 08

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

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

_To be written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-AUD-04a | The DSoR runtime identity cannot update or delete audit records | [§30 Audit integrity and retention](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) | _to be counted_ |
| DSOR-AUD-02a | Operational audit is not stored only as agent memory | [§29 Audit and decision evidence](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence) | _to be counted_ |
| DSOR-EXE-02 | The decision is durably recorded before the response is returned | [§21 Command pipeline](../../../specs/dsor/03-execution.md#21-command-pipeline) | _to be counted_, now durable |

Not met, and why: DSOR-AUD-01, whose record needs a chain of fingerprints (step 39) and
an identity mode for the agent (step 18). DSOR-RP-01a is checked in part and claimed in
the row-level security step.

## Next

Step 10 · Tenants: a `tenant_id` on every row, and every request works inside exactly
one company. **Stage 1 of the learning path is complete** when this step's tests pass.
