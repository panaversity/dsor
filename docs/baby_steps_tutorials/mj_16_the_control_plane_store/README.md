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
   columns. A `bookkeeping` table may not be touched at all.
3. At start-up, the program compares the database with the map. It refuses to start on any
   difference, and names each one:
   - a schema or table that is not on the map, or one on the map that does not exist;
   - a privilege more or less than the map lists, on a schema, a table, a column, or a
     sequence;
   - a table with a company key that is not locked by row-level security, enabled and
     forced.
4. Step 09's start-up line for the log stays, as a second lock (decision 6).
5. A database test proves that today's database matches the map exactly.

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
| (our decision) | **C2.** Every schema and table is on the map, and everything on the map exists | Planted catalogs with one table more (`dsor.notes`), one table less, and one schema more. Each is named. On the database, today's catalog matches `store.json` exactly |
| (our decision, for DSOR-AUD-04a) | **C3.** `dsor_runtime`'s privileges are exactly the map's, on every schema, table, column, and sequence | Planted catalogs with `UPDATE` on `app.invoices`, no `SELECT` on `app.invoices`, `INSERT` on the log's column `sequence`, `CREATE` on the schema `dsor`, and `USAGE` on the log's sequence. Each is named |
| (our decision) | **C4.** Each kind allows only its own privileges, on its own side | Maps that give `app.invoices` `UPDATE`, give `dsor.audit` `UPDATE`, or put an `append-only` table in `app`. Each is refused at start-up, named |
| DSOR-RP-01b | **C5.** Every table with a company key is locked by row-level security, enabled and forced | Planted catalogs where `app.invoices` has row-level security off, or on but not forced, and a table with a `tenant_id` column whose line in the map names no key. Each is named |
| (our decision) | **C6.** On any difference the program refuses to start, names every problem, and makes no call | The program, started with a broken map, exits with code 1. On a throwaway branch with `GRANT UPDATE ON app.invoices`, the same |
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
                                         "insert": ["record_id", "kind", "…"] } },
       "dsor.migrations": { "kind": "bookkeeping", "tenant": null,
                            "runtime": { "table": [] } }
     }
   }
   ```

   The log's `INSERT` is granted column by column: twelve named columns, never `sequence`
   or `at` (step 09, decisions 5 and 6). So the map names column privileges, not only table
   ones. `public` is PostgreSQL's default room. Every user may enter it, and nothing of ours
   lives there. *Downside:* every later step that adds a table adds a line here too.
   Forgetting it stops start-up, which is the point.
2. **One database, two schemas.** `app` stands in for the company's system, and `dsor` is
   DSoR's own. They share one Neon database, as the reference profile chooses. The payoff
   comes in step 36: a business change and DSoR's record of it can commit together, or not
   at all (DSOR-EXE-04a). The learner chose this on 2026-10-03, after asking whether real
   companies keep their data apart. They often do, and the specification has rules for that
   case too (what the specification asks, point 4). *Downside:* the tutorial shows the
   easier case first. The separate case's tools arrive with the steps that need them, from
   step 34.
3. **Only today's kinds,** each on one side:

   | Kind | Side | `dsor_runtime` may | Today |
   | --- | --- | --- | --- |
   | `business` | the company's | read: `SELECT` | `app.invoices` |
   | `append-only` | DSoR's | read, and add rows through named columns: `SELECT`, and `INSERT` column by column. Never `UPDATE`, `DELETE`, or `TRUNCATE` | `dsor.audit` |
   | `bookkeeping` | DSoR's | nothing | `dsor.migrations` |

   No kind allows `REFERENCES`, `TRIGGER`, or `MAINTAIN`, and none allows a privilege on a
   sequence. A schema allows `USAGE`, never `CREATE`. Each later step adds its own kind
   beside the table that needs it, with its privileges and the reason. *Downside:* no step
   can borrow a kind before the step that defines it. Step 17's draft payments need a
   company table the program can write, so step 17 will add that kind.
4. **The check runs at start-up, and in a database test.** At start-up, the program reads
   PostgreSQL's own catalog as `dsor_runtime`, compares it with the map, and refuses to
   start on any difference, naming each one, the way step 09's check does. It asks
   PostgreSQL's `has_…_privilege` functions, as step 09's test does, so a privilege held
   through `PUBLIC` or through a role counts too. A database test proves that today's
   database matches the map. Unit tests prove the comparison itself, with planted catalogs.
   *Downside:* a few catalog reads at every start, and one more reason the program will not
   start.
5. **The inspector covers every schema, table, column, and sequence outside PostgreSQL's
   own.** Names that start with `pg_`, and `information_schema`, are PostgreSQL's own (step
   11's rule). Step 09's review found privileges hiding on a column, on a sequence, and on a
   schema, where a list of whole-table grants could not see them. Views, materialized views,
   foreign tables, and `SECURITY DEFINER` functions stay with step 11's catalog tests: no
   view may read with its owner's rights, no materialized view or foreign table may exist,
   and `dsor_runtime` may run no `SECURITY DEFINER` function. *Downside:* two places now
   read the catalog, for different questions.
6. **Step 09's checks stay, as second locks.** The start-up line that names the log stays.
   The map is a file, and one wrong line in a file must not be enough to open the log. A
   guarantee is never weakened to make the code simpler. Step 09's database test of exact
   privileges stays too, but it starts from the catalog instead of three table names, so a
   table missing from the map still shows up there. *Downside:* a new table is written in
   two places, the map and that test's expected list.
7. **No new migration.** The map describes the database as steps 09 to 15 left it. If the
   build finds a difference, it fixes the map, or says why the database is wrong. It never
   changes the map to hide a real problem. *Downside:* none, unless a difference is found.

### The tests, by claim

- **C1:** carried. Step 09's and step 10's tests stay green.
- **C2:** unit tests of the comparison, with planted catalogs: one table more
  (`dsor.notes`), one table less, one schema more (`crm`). Each is named. On the database:
  today's catalog gives no difference.
- **C3:** unit tests: `UPDATE` on `app.invoices`; no `SELECT` on `app.invoices`; `INSERT`
  on the log's column `sequence`; `CREATE` on the schema `dsor`; `USAGE` on the log's
  sequence. Each is named.
- **C4:** maps that give `app.invoices` `UPDATE`, give `dsor.audit` `UPDATE`, or put an
  `append-only` table in `app`. Each is refused when the map is checked.
- **C5:** planted catalogs: row-level security off on `app.invoices`; on but not forced; a
  `tenant_id` column with no key in the map. Each is named.
- **C6:** the program, started with a broken map, exits with code 1, names every problem,
  and prints no `operations:` line. On a **throwaway Neon branch**, made from this step's
  branch and deleted afterwards: `GRANT UPDATE ON app.invoices TO dsor_runtime`, then start
  the program. It exits with code 1, naming `app.invoices` and `UPDATE`. Never on the
  step's own branch.
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

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

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
