# Step 16 · The control-plane store

**New in this step:** DSoR's own paperwork has a map. `store.json` names every schema and
every table, says what kind of paperwork each table holds, and says exactly what DSoR's
program may do to each one. Every time the program starts, it checks the real database
against the map, and it refuses to start on any difference (DSOR-MOD-01). This is the first
step of Stage 3.

## In plain words

DSoR does not own the company's data. The company's invoices live in the company's own
system, and DSoR stands in front of it. But DSoR keeps paperwork of its own. Today that is
the log of every decision. Stage 3 adds more: the permission slips people give the agent,
the record of what was already done, the commands waiting for approval, and the count of
today's spending.

The specification calls the place for this paperwork the **control-plane store**. "Control
plane" means the part of a system that decides and remembers. The business data stays in
the company's system.

This tutorial opened that store in step 09. The log went into a schema of its own, `dsor`,
beside `app`, which stands in for the company's system. A **schema** is a room inside one
database. A **privilege** is one thing a database user may do to a room, a table, or a
column: read it (`SELECT`), add a row (`INSERT`), change a row (`UPDATE`), and so on.

This step gives the store a **map**, one file: `store.json`. For every room and every table,
it says whose it is, what kind of paperwork it holds, and the exact privileges of
`dsor_runtime`, the database user the program logs in as. An **inspector** compares the real
database with the map every time the program starts. On any difference, the program refuses
to start, and names each one.

Think of the records office from *Start here*. The agent is the new clerk, and DSoR is the
office. This step is about the office's back room, and the plan on its door. The plan lists
each cabinet, what goes in it, and which keys open it. Every morning, before the window
opens, the room is checked against the plan. A cabinet or a key that is not on the plan
keeps the window shut. The picture stops there. A person checking a room can miss a
cabinet. The inspector asks the database itself, which lists every table and every
privilege.

## Why it matters

**Without its own memory, DSoR forgets what it promised.** §1: "Without its own store DSoR
would forget what it approved, what it already executed, and how much of today's limit is
used. Every safety promise in this document depends on that memory."

**Today, the program checks one table when it starts.** Step 09's start-up check refuses to
run if the program could change or remove a record in the log, `dsor.audit`. It names the
log, and nothing else. Suppose someone runs `GRANT UPDATE ON app.invoices TO dsor_runtime`.
Step 15 starts and serves as if nothing happened. The full list of privileges is checked
only by a database test, `pnpm test:db`. Nothing runs that test before the program starts,
and CI does not run it at all.

**Stage 3 adds tables, and some of them change.** A command waiting for approval moves from
pending to approved to done. A daily counter goes up. Those tables need `UPDATE`, and the
log must never have it. Each new table is a new chance for one privilege too many, or for a
table nobody checks. With a map, every new table states its kind on the day it is made, and
the inspector refuses anything that kind does not allow. A table that nobody wrote on the
map stops start-up by itself.

**Common mistake:** keeping DSoR's paperwork where the agent can reach it. The rule's words
are "separate from agent context". The agent's context is what the AI holds: its
conversation, its notes, its memory. An email with hidden instructions can make the AI write
"PAY-901 was approved" in its notes. So DSoR never takes its paperwork from the agent. Only
DSoR's program writes it.

## The design, before any code

This section was written by the learner with Claude Code, before any code existed. Every
sentence of the specification it relies on was read on 2026-10-03:

- §1: its "In plain words", its "Why it matters", and DSOR-MOD-01.
- §0.3: the glossary entry *control-plane store*.
- §41: the reference profile's line "Control-plane store: PostgreSQL — same cluster, so
  DSOR-EXE-04a atomic commit applies".
- §21: DSOR-EXE-03a, DSOR-EXE-04a, and DSOR-EXE-04b.
- §25: DSOR-UNK-01a to DSOR-UNK-02, for the case where the company's system is separate.
- §30: DSOR-AUD-04a. §36: DSOR-RP-01a and DSOR-RP-01b.

If the code finds the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** DSoR never forgets what it promised, and nobody can quietly widen what its
program may do to its own paperwork. The store is DSoR's own, durable, and out of the
agent's reach. The program runs only on a store that matches its map. The analogy is the
plan on the back room's door, checked every morning before the window opens.

**Outcome.** What is true when this step is done:

1. `store.json` names every schema and every table that is not PostgreSQL's own.
   - For each schema: its side, the company's or DSoR's, and `dsor_runtime`'s privileges on
     it.
   - For each table: its kind, its company key, and `dsor_runtime`'s exact privileges on
     the table and on each of its columns.
2. Each kind lives on one side and allows only certain privileges (decision 3). A `business`
   table may only be read. An `append-only` table may be read and added to, through named
   columns. A `bookkeeping` table may not be touched at all. A `business` or `append-only`
   table names its company key.
3. At start-up, the program compares the database with the map. It refuses to start on any
   difference, and names each one:
   - a schema or table that is not on the map, or one on the map that does not exist;
   - a view, a materialized view, a foreign table, or a partitioned table: no kind allows
     one today (decision 5);
   - a privilege more or less than the map lists, on a schema, a table, or a column, and
     any privilege on a sequence, on the database itself, or held `WITH GRANT OPTION`;
   - a column the database fills in, such as the log's `sequence` and `at`, that the map
     lets the program write;
   - a rule or a trigger on a table, or a `SECURITY DEFINER` function `dsor_runtime` may
     run;
   - a table with a company key that is not locked by row-level security, enabled and
     forced.
4. Step 09's start-up line for the log stays, as a second lock (decision 6).
5. A database test proves that today's database matches the map exactly. Another proves the
   inspector can see each kind of privilege, by asking it about the tables' owner, who holds
   them all (decision 8). A third makes, as the owner, each thing the inspector must refuse,
   reads the catalog, and rolls all of it back (decision 8).

**Not the outcome of this step:**

- The rest of the paperwork. Each kind arrives with its own table, its own kind, and its
  line on the map: permission slips (step 18), "already done" records (step 20), proposals
  (step 22), daily counters (step 24), freezes and holds (steps 25 and 37), controls
  (step 27), approvals (step 29), and intent records (step 36).
- A company system that is really separate, behind a connector. Here `app` stands in for
  it, in the same database (decision 2).

**The success signals.** Each one fails if this step's code is deleted:

- On a throwaway branch with `GRANT UPDATE ON app.invoices TO dsor_runtime`, step 15's
  start-up check finds no problem. This step's program refuses to start, naming
  `app.invoices` and `UPDATE`.
- On a throwaway branch with a table `dsor.notes` that the map does not name, the program
  refuses to start, naming `dsor.notes`.
- Unit tests with planted catalogs name each difference in outcome 3. They need no
  database, so CI runs them. A **planted catalog** is a list of tables and privileges that
  the test writes itself, in the shape the program reads from PostgreSQL.

### What the specification asks, and what this step can honestly give

Checked on 2026-10-03:

1. **DSOR-MOD-01 asks DSoR to "durably own, in a control-plane store separate from agent
   context", nine kinds of paperwork:** delegations, controls, proposals, approvals,
   idempotency records, intent records, cumulative-limit counters, holds, and audit
   evidence. Only audit evidence exists yet, in the log. This step claims the rule for audit
   evidence, and gives the store the map that each later kind joins. The other eight are
   claimed with their steps.
2. **"Durably"** was proven in step 09. The record is committed before the answer, so it
   survives a crash.
3. **"Separate from agent context"** holds by construction, and earlier tests prove it:
   - The agent has no database login. Its only door is `call`.
   - The code behind `call` gets a store bound to one company's invoices. It reaches
     nothing in `dsor` (step 10, C8).
   - Only DSoR's program writes the log, as `dsor_runtime`, which can add records and never
     change them (step 09).
4. **Where the company's system lives.** In real deployments it is often separate. §1:
   "PostgreSQL, Salesforce, SAP, QuickBooks, Xero, Workday, Odoo, or custom applications MAY
   remain the physical systems of record." DSOR-EXE-04a asks for one atomic commit **where**
   the connector's store and the control-plane store share a transaction. Where they
   cannot, DSoR relies on other rules:
   - an intent record, written before acting (DSOR-EXE-03a);
   - an idempotency key that the other system understands;
   - and `OUTCOME_UNKNOWN`, never success or failure, until DSoR has checked (DSOR-UNK-01a
     to DSOR-UNK-02).

   This tutorial takes the first case, as the reference profile does (decision 2).
5. **The map is this tutorial's idea, not the specification's.** The specification asks for
   the store. It does not say how to keep the store's privileges right. The map, its kinds,
   and the inspector are our way. They serve DSOR-AUD-04a, which says the program must not
   be able to change or remove a log record, and DSOR-RP-01b, which says company tables use
   forced row-level security.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-MOD-01 | **C1.** DSoR's paperwork lives in its own store, durable and out of the agent's reach | Carried: step 09's crash test and start-up check, and step 10's C8 tests of the bound store. This step adds the map that every later kind of paperwork joins |
| (our decision) | **C2.** Every schema and table is on the map, everything on the map exists, and nothing but plain tables shows rows. No rule, trigger, or `SECURITY DEFINER` function reaches around them | Planted catalogs with one table more (`dsor.notes`), one table less, one schema more, a view, a materialized view, a foreign table, a partitioned table, a rule, a trigger, and a definer function. Each is named. On the database, today's catalog matches `store.json` exactly, and the owner's rolled-back view, materialized view, partitioned table, rule, trigger, and function are each seen |
| (our decision, for DSOR-AUD-04a) | **C3.** `dsor_runtime`'s privileges are exactly the map's, on every schema, table, column, and sequence, on the database, and with grant option. The program never writes a column the database fills in | Planted catalogs with `UPDATE` on `app.invoices`, no `SELECT` on `app.invoices`, `INSERT` or `SELECT` on one column, `CREATE` on the schema `dsor`, `USAGE` on the log's sequence, `CREATE` on the database, and `SELECT WITH GRANT OPTION`. A map that lists `INSERT` on `at`. Each is named. On the database, the inspector asked about the owner sees each kind of privilege, and a look-alike function in `public` cannot blind it |
| (our decision) | **C4.** Each kind allows only its own privileges, on its own side, with a company key where it needs one | Maps that give `app.invoices` `UPDATE`, give `dsor.audit` `UPDATE`, give `dsor.migrations` a column, put an `append-only` table in `app`, or give a `business` table no key. Each is refused at start-up, named |
| DSOR-RP-01b | **C5.** Every table with a company key is locked by row-level security, enabled and forced | Planted catalogs where `app.invoices` has row-level security off, or on but not forced, and a table with a `tenant_id` or `tenant` column whose line in the map names no key. Each is named. On the database, the owner's rolled-back `DISABLE ROW LEVEL SECURITY` is seen as forced but not enabled |
| (our decision) | **C6.** On any difference the program refuses to start, names every problem, and makes no call | The program, started with a broken map, exits with code 1 before it prints `operations:`. Started on today's database with a map that leaves out `dsor.migrations`, it exits with code 1 after `operations:`, names the table, and gives no answer. A database it cannot reach stops it with the message and no stack trace. On a throwaway branch with `GRANT UPDATE ON app.invoices`, the same, by hand |
| (our decision) | **C7.** The map itself is checked | An unknown kind, an unknown side, a key written twice, or a table in a schema the map does not name. Each stops start-up, named |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **The map is a JSON file, `store.json`,** beside `contracts/`, `roles.json`, and
   `classifications.json`, and checked at start-up as they are. A sketch, for the build to
   settle:

   ```json
   {
     "schemas": {
       "app":    { "side": "company", "runtime": ["USAGE"] },
       "dsor":   { "side": "dsor",    "runtime": ["USAGE"] },
       "public": { "side": "none",    "runtime": ["USAGE"] }
     },
     "tables": {
       "app.invoices":    { "kind": "business", "tenant": "tenant_id",
                            "runtime": { "table": ["SELECT"] } },
       "dsor.audit":      { "kind": "append-only", "tenant": "tenant",
                            "runtime": { "table": ["SELECT"],
                                         "columns": { "INSERT": ["record_id", "kind", "…"] } } },
       "dsor.migrations": { "kind": "bookkeeping", "tenant": null,
                            "runtime": { "table": [] } }
     }
   }
   ```

   The log's `INSERT` is granted column by column: twelve named columns, never `sequence`
   or `at` (step 09, decisions 5 and 6). So the map names column privileges, not only table
   ones, under `columns`, one list for each privilege. `public` is PostgreSQL's default
   room. Every user may enter it, and nothing of ours lives there. A sequence has no line:
   it belongs to its table, and no kind allows a privilege on one (decision 3). A company
   key is a column named `tenant_id` or `tenant`, step 11's two names. *Downside:* every
   later step that adds a table adds a line here too. Forgetting it stops start-up, which
   is the point.
2. **One database, two schemas.** `app` stands in for the company's system, and `dsor` is
   DSoR's own. They share one Neon database, as the reference profile chooses. The payoff
   comes in step 36: a business change and DSoR's record of it can commit together, or not
   at all (DSOR-EXE-04a). The learner chose this on 2026-10-03, after asking whether real
   companies keep their data apart. They often do, and the specification has rules for that
   case too (what the specification asks, point 4). *Downside:* the tutorial shows the
   easier case first. The separate case's tools arrive with the steps that need them, from
   step 34.
3. **Only today's kinds,** each on one side:

   | Kind | Side | `dsor_runtime` may | Company key | Today |
   | --- | --- | --- | --- | --- |
   | `business` | the company's | read: `SELECT` | required | `app.invoices` |
   | `append-only` | DSoR's | read, and add rows through named columns: `SELECT`, and `INSERT` column by column. Never `UPDATE`, `DELETE`, or `TRUNCATE` | required | `dsor.audit` |
   | `bookkeeping` | DSoR's | nothing | none | `dsor.migrations` |

   No kind allows `REFERENCES`, `TRIGGER`, or `MAINTAIN`, and none allows a privilege on a
   sequence or on the database, or one held `WITH GRANT OPTION`, which would let
   `dsor_runtime` hand it on. A schema allows `USAGE`, never `CREATE`. No kind lets the
   program write a column the database fills in: an identity, such as `sequence`, or a
   column with a default, such as `at`. No kind allows a rule or a trigger on its table: a
   rule `DO INSTEAD NOTHING` turns every `INSERT` into nothing, and the program would think
   its records were kept. A company key is required where rows belong to a company, so
   the lock check can never be skipped by naming a column `org_id`. The last four sentences
   came from the review. Each later step adds its own kind beside the table that needs it,
   with its privileges and the reason. *Downside:* no step can borrow a kind before the step
   that defines it. Step 17's draft payments need a company table the program can write, so
   step 17 will add that kind. A column with a default that the program should write needs
   its default removed, or a kind that says why.
4. **The check runs at start-up, and in a database test.** Start-up has two halves. First
   the files: the contracts, the roles, the inputs, the labels, and now the map. A broken
   map is refused there, before `operations:` is printed. Then the program logs in, and
   step 09's check asks who it is. Only then does the inspector read PostgreSQL's own
   catalog as `dsor_runtime`, compare it with the map, and refuse to start on any
   difference, naming each one. It comes after step 09's check because a wrong login, such
   as the owner, would make every privilege it reads someone else's. It asks PostgreSQL's
   `has_…_privilege` functions, as step 09's test does, so a privilege held through
   `PUBLIC` or through a role counts too. It reads inside a transaction whose
   `search_path`, the list of schemas PostgreSQL looks in for a name, is `pg_catalog`
   first. Otherwise a function of the same name in `public` could answer for
   PostgreSQL's own, and say "no" to every question (found by the review). A database test
   proves that today's database matches the map. Unit tests prove the comparison itself, with planted catalogs.
   *Downside:* a few catalog reads at every start, and one more reason the program will not
   start.
5. **The inspector covers every schema, relation, column, and sequence outside
   PostgreSQL's own.** Names that start with `pg_`, and `information_schema`, are
   PostgreSQL's own (step 11's rule). Step 09's review found privileges hiding on a column,
   on a sequence, and on a schema, where a list of whole-table grants could not see them.
   A **relation** is anything a query can read rows from. Only plain tables have a kind
   today, so a view, a materialized view, a foreign table, or a partitioned table stops
   start-up. Changed on 2026-10-03, before any code: this decision first left them to step
   11's database tests, which nothing runs before start-up. The learner asked for every
   relation after a live run on a local PostgreSQL. Inside `org_456`, `dsor_runtime` read
   `org_789`'s record through a view made by the owner, through the owner's materialized
   copy, through one partition read by its own name, and through a foreign table.
   PostgreSQL cannot lock a materialized view or a foreign table at all. A partition is a
   table, so it needs its own line and its own forced lock. For the same reason, the
   inspector refuses a `SECURITY DEFINER` function that `dsor_runtime` may run: it runs
   with its owner's rights, and the review used one to delete log records (found by the
   review). Step 11's catalog tests stay as a second lock. *Downside:* two places now read
   the catalog, and a later step that needs a view must first give it a kind.
6. **Step 09's checks stay, as second locks.** The start-up line that names the log stays.
   The map is a file, and one wrong line in a file must not be enough to open the log. A
   guarantee is never weakened to make the code simpler. Step 09's database test of exact
   privileges stays too, but it starts from the catalog instead of three table names, so a
   table missing from the map still shows up there. *Downside:* a new table is written in
   two places, the map and that test's expected list.
7. **No new migration.** The map describes the database as steps 09 to 15 left it. If the
   build finds a difference, it fixes the map, or says why the database is wrong. It never
   changes the map to hide a real problem. *Downside:* none, unless a difference is found.
8. **The inspector is asked about a user, and the program always asks about itself.**
   Today `dsor_runtime` holds no privilege on a sequence, none on the database, none
   `WITH GRANT OPTION`, and no `CREATE` on a schema. An inspector blind to those would
   still find no difference, and every test would stay green. So the catalog read takes the
   user to ask about. The program asks about `current_user`, the user it logged in as. One
   database test asks about the tables' owner, who holds every privilege, and must see
   each kind. `dsor_runtime` may ask this, and needs no owner's password: checked live on
   2026-10-03. Chosen by the learner. Nor does today's database hold a view, a partitioned
   table, a rule, a trigger, or a `SECURITY DEFINER` function. So another database test
   logs in as the owner, makes one of each inside a transaction, reads the catalog on that
   same connection, and rolls the transaction back. Nothing is ever kept. The review showed
   the inspector's SQL could forget views and still pass every other test. *Downside:* a
   parameter the program never sets to anything else, and a test that holds the owner's
   key, in a child program, as step 11's owner tests do.

### The tests, by claim

- **C1:** carried. Step 09's and step 10's tests stay green.
- **C2:** unit tests of the comparison, with planted catalogs: one table more
  (`dsor.notes`), one table less, one schema more (`crm`), a view, a materialized view, a
  foreign table, a partitioned table, a rule, a trigger, and a definer function. Each is
  named. On the database: today's catalog gives no difference, and the owner's rolled-back
  objects are each seen with their kind.
- **C3:** unit tests: `UPDATE` on `app.invoices`; no `SELECT` on `app.invoices`; `INSERT`
  on the log's column `sequence`; `SELECT` on one column of `dsor.migrations`; `CREATE` on
  the schema `dsor`; `USAGE` on the log's sequence; `CREATE` on the database;
  `SELECT WITH GRANT OPTION` on the log; a map that lists `INSERT` on `at`. Each is named. On the database: the inspector, asked about the owner, sees
  each of these (decision 8). The owner holds them on whole tables, so its run proves the
  catalog read, and the planted catalogs prove the comparison.
- **C4:** maps that give `app.invoices` `UPDATE`, give `dsor.audit` `UPDATE`, give
  `dsor.migrations` a column, put an `append-only` table in `app`, or give a `business`
  table no company key. Each is refused when the map is checked.
- **C5:** planted catalogs: row-level security off on `app.invoices`; on but not forced; a
  `tenant_id` or `tenant` column with no key in the map. Each is named. On the database:
  the owner's rolled-back `DISABLE ROW LEVEL SECURITY` is seen.
- **C6:** the program, started with a broken map, exits with code 1, names every problem,
  and prints no `operations:` line. Started on today's database with a map that leaves out
  `dsor.migrations`, it exits with code 1 and names the table. Unable to reach the
  database, it prints the message and no stack trace. On a **throwaway Neon branch**, made from this step's
  branch and deleted afterwards: `GRANT UPDATE ON app.invoices TO dsor_runtime`, then start
  the program. It exits with code 1, naming `app.invoices` and `UPDATE`, and gives no
  answer. Never on the step's own branch.
- **C7:** maps with an unknown kind, an unknown side, a key written twice, or a table in a
  schema the map does not name. Each stops start-up, named.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| A1 | `GRANT UPDATE ON dsor.audit TO dsor_runtime`, on a throwaway branch | Step 09's start-up line, and now the map too: two locks | "It refuses to start." Right, and already true at step 15, because step 09's line names the log. So A1 cannot prove this step |
| A2 | `GRANT UPDATE ON app.invoices TO dsor_runtime`, on a throwaway branch. First step 15's start-up check, then this step's program | Nothing in step 15's check. In this step, C6 | Step 15 "refuses to start" |
| A3 | The inspector compares table privileges only, and skips columns. Which grant gets past it at start-up: `UPDATE` on `app.invoices`, `INSERT (sequence)` on `dsor.audit`, or `CREATE` on the schema `dsor`? | Only C3's planted column: `INSERT` on `sequence` | "None of them" gets past |
| A4 | The inspector looks only at the tables the map names. What gets past it? | Only C2's planted extra table | "A table not on the map" |
| A5 | The kind rule is gone: the map may list any privilege. Then `GRANT UPDATE ON app.invoices`, and `UPDATE` added to its line in the map. What stops it? | Only C4's maps catch the change to the code. The grant itself: nothing at start-up, only step 09's database test, when someone runs it | "The start-up check" |

The review also attacks the step with the threat that is its reason: DSoR's own paperwork
widened, moved where the agent can reach it, or lost.

### Left open, and not this step's idea

- **The other eight kinds of paperwork in DSOR-MOD-01:** each with its step.
- **A company system that is really separate,** behind a connector, with intent records,
  keys, and `OUTCOME_UNKNOWN`: steps 34 to 38.
- **Who may read the log,** with its own authorization (DSOR-AUD-05b).
- **Who may change the map.** Here, whoever can change the code. The kinds and step 09's
  line limit what one wrong line can do.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup itself,
this way:

1. Create a branch `step-16` **from `step-15`**, with `neonctl branches create`, or with the
   Neon MCP server if it is connected with write access. `step-15` was made fresh from
   `main`, and its owner's password was reset by hand, so a branch of it needs no stop.
2. Write `.env` with `neonctl connection-string`, sending its output into the file and never
   printing it:
   - `DSOR_MIGRATION_URL`: the owner's string.
   - `DSOR_DB_URL`: the same string, with the user `dsor_runtime` and a new random password
     (letters and digits).

   Give both `sslmode=verify-full`.
3. Run `pnpm migrate`. No migration is new, so none runs. It still sets `dsor_runtime`'s
   password from `DSOR_DB_URL`.
4. For breaks A1 and A2, and the live run of C6, use a throwaway branch made from `step-16`,
   and delete it afterwards. Its connection strings follow the same rule.
5. Check without looking: `pnpm test:db` passes, and the transcript holds no
   `postgresql://` with a password in it.

## What changed since step 15

| File | What changed |
| --- | --- |
| `store.json` | **New.** The map: three schemas, each with its side and `dsor_runtime`'s privileges, and three tables, each with its kind, its company key, and `dsor_runtime`'s privileges on the table and its columns |
| `src/store.ts` | **New.** Reads and checks the map, with no database: its form, the sides, and the kind table `KINDS` (decision 3). A broken map names every problem |
| `src/inspector.ts` | **New.** `readCatalog` reads the catalog in one statement, for the login or for a user it is asked about (decision 8). `storeDifferences` compares it with the map and names every difference |
| `src/main.ts` | Checks the map with the other files, before `operations:`. Compares the database with the map after step 09's login check, and refuses to start on any difference |
| `test/catalogs.ts` | **New.** `today()`, the catalog as steps 09 to 15 left it, for the unit tests to change one thing at a time |
| `test/store-map.test.ts`, `test/inspector.test.ts` | **New.** C4 and C7, then C2, C3, and C5, with no database |
| `test/store.db.test.ts` | **New.** The planted catalog is the real one, the store matches its map, and the inspector asked about the owner sees every kind of privilege |
| `test/startup.test.ts` | C6: the program refuses to start with a broken map, or with none |
| `test/db.ts` | Step 09's list of privileges starts from the catalog, not from three table names (decision 6) |

Every other file is step 15's, without its `NEW IN STEP` markers. No new dependency, and no
new migration (decision 7).

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_15_freshness_labels/src mj_16_the_control_plane_store/src
git diff --no-index mj_15_freshness_labels/test mj_16_the_control_plane_store/test
```

## Run it

Set up Neon first ("Before you build" above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # on a branch of step-15: "no migration to run"
pnpm check        # typecheck and the unit tests
pnpm test:db      # the database tests
pnpm start        # the program, against the database
```

When the database matches the map, the program prints exactly what step 15's printed. The
inspector says nothing when there is nothing to say. Its work shows when something
differs, in "Break it".

## Break it

Every break below was run for real on 2026-10-03. The live ones ran on a throwaway Neon
branch, `step-16-a1`, made from `step-16`, never on `step-16` itself. Before the first
break, both steps started and served on it, so every refusal below comes from the break.

**A2 · One privilege too many on the company's table.** The owner runs:

```sql
GRANT UPDATE ON app.invoices TO dsor_runtime;
```

Step 15 starts, answers every call, and exits with code 0. Its check asks only about the
log. Step 16:

```text
operations: [ 'invoice.get', 'invoice.issue', 'invoice.list' ]
The database does not match store.json. Refused:
  app.invoices: dsor_runtime holds UPDATE, which store.json does not list
```

Exit code 1, and no answer. `operations:` is printed, because the files were checked
first. The database can be compared only after the program logs in (decision 4). This is
also C6's live run.

**A1 · UPDATE on the log.** After `REVOKE` and a clean start, the owner runs
`GRANT UPDATE ON dsor.audit TO dsor_runtime`. Step 15 and step 16 print the same line, and
exit with code 1:

```text
DSOR_DB_URL must log in as dsor_runtime. Refused: can change or remove records in dsor.audit.
```

That is step 09's line. Step 16's map never got its turn, because the login check comes
first. So A1 cannot prove this step. To see the second lock, step 09's line was broken in a
copy of this step (`if (false && facts.can_change_audit)`) and started on the same branch:

```text
The database does not match store.json. Refused:
  dsor.audit: dsor_runtime holds UPDATE, which store.json does not list
```

One lock broken, and the other still held.

**A3 · The inspector skips columns.** In a copy, `privilegesOf` returns after the table's
privileges. Four tests fail, and every one is about a column: `INSERT` on `sequence`,
`UPDATE` on `result`, a missing column grant, and a misspelled column. `UPDATE` on
`app.invoices` and `CREATE` on `dsor` are still named. So only `INSERT (sequence)` would
get past start-up.

**A4 · The inspector looks only at the map's tables.** In a copy, the loop reads
`catalog.relations.filter((r) => map.tables.has(r.name))`. Six tests fail: the table that
is not on the map, and also the view, the materialized view, the foreign table, and the
partitioned table. An inspector that starts from its own list misses everything nobody
wrote down.

**A5 · The kind rule is gone.** In a copy, `tableProblems` returns no problem for any
privilege. Nine of the map's tests fail, among them every test that guards the log. Then,
live: the owner grants `UPDATE ON app.invoices`, and the program starts with a map that
lists `UPDATE` for it. It starts, answers every call, and exits with code 0. The map and the
database agree, so nothing at start-up objects. Step 09's database test does:

```text
-     "held": "SELECT",
+     "held": "SELECT UPDATE",
      "object": "app.invoices",
```

but only when someone runs `pnpm test:db`. With the kind rule back, the same map stops
start-up before the program logs in:

```text
the map of the store refused to start:
  a5-store.json: app.invoices lists UPDATE, which a business table does not allow
```

| # | Learner's prediction | Real |
| --- | --- | --- |
| A1 | "It refuses to start" | Right, by step 09's line, in step 15 too. The map is the second lock, shown with step 09's line broken |
| A2 | Step 15 "refuses to start" | Step 15 **serves**. Step 16 refuses, naming `app.invoices` and `UPDATE` |
| A3 | "None of them" gets past | **`INSERT (sequence)` gets past.** Four column tests catch the change |
| A4 | "A table not on the map" | Right, **and** every view, materialized view, foreign table, and partitioned table. Six tests catch the change |
| A5 | "The start-up check" | **Nothing at start-up.** Nine map tests catch the change to the code. The grant itself: step 09's database test, when someone runs it |

To try A2 yourself, make a branch of `step-16`, write a `.env` for it the same way as for
`step-16`, run `pnpm migrate`, then run the `GRANT` as the owner and `pnpm start`. Delete the
branch afterwards.

## Build it yourself with Claude Code

_To be written when the code exists._

## Check yourself

1. DSoR does not own the company's data. What does it own, and why can it not do without
   it?
2. What does "separate from agent context" protect against?
3. In real life the company's system is often separate from DSoR's store. What changes then?
4. `GRANT UPDATE ON dsor.audit` makes this step's program refuse to start. Why does that not
   prove this step works?
5. Why does the inspector start from the database's own list of tables, and not from the
   map's?
6. Why refuse to start, instead of printing a warning?

<details>
<summary>Answers</summary>

1. Its paperwork: the log today, and soon permission slips, "already done" records,
   commands waiting for approval, and counters. Without it DSoR would forget what it
   approved, what it already did, and how much of today's limit is used.
2. An email with hidden instructions making the AI write "PAY-901 was approved" in its
   notes. DSoR never takes its paperwork from the agent, and only DSoR's program writes it.
3. There is no shared transaction. DSoR writes its intent first, sends a key the other
   system understands, and reports `OUTCOME_UNKNOWN`, never success or failure, until it has
   checked.
4. Step 15 refuses it too, because step 09's line names the log. A test that passes with
   this step's code deleted proves nothing about this step. `GRANT UPDATE ON app.invoices`
   does: step 15 starts, and this step refuses.
5. A check that starts from its own list cannot see what is missing from the list. A table
   nobody wrote down is exactly the table nobody checks.
6. Fail closed, like a lock that stays locked when the power fails. A program running on a
   widened store looks fine and is wrong. A program that will not start is noticed at once.

</details>

## Think it through

_To be written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-MOD-01 | DSoR durably owns its paperwork, in a control-plane store separate from agent context | [§1 Definition](../../../specs/dsor/01-model.md#1-definition) | _To be counted._ For audit evidence only: the other eight kinds arrive with their steps |

## Next

Step 17 · Vendors and payments: two more record types. `payment.create` makes a draft, and
`payment.cancel` undoes it. Every command now carries a label that answers one question:
can this be undone?
