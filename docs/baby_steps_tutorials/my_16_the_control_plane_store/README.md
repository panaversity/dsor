# Step 16 · The control-plane store

**New in this step:** DSoR's log moves out of the business's tables into a schema of its own,
`dsor`, in the same database: the first piece of paperwork in DSoR's control-plane store.

## In plain words

DSoR keeps paperwork: who may do what, what it approved, what it already carried out, how much of a
limit is used, and the log of it all. The rule `DSOR-MOD-01` says DSoR must own that paperwork,
durably, in a store of its own, the *control-plane store*. Every safety promise depends on it:
without its own store, DSoR would forget what it approved and what it already did.

A *schema* is a named folder of tables inside one database. Until now there was one folder,
`public`, and the business's table, `public.invoices`, and DSoR's log, `public.audit`, sat in it
side by side. This step makes a folder for DSoR, `dsor`, and moves the log into it:

- **The log moves as it is.** One new migration, `008_the_control_plane_store.sql`, moves the table.
  Every record, the hash chain, the permissions and the row-level security go with it; nothing is
  copied. A record's hash covers its own fields, not the table's name, so the move cannot break
  the chain. Every statement in the program that names the log now says `dsor.audit`.
- **The application may look inside, and create nothing there.** It holds `USAGE` on `dsor` and
  not `CREATE`. What it may do to the log itself is the log's own permissions, which moved with it:
  add a record and read it, never change or delete one.
- **The program checks the database and the schemas before it starts.** It refuses to start if
  the application owns the database, or owns `dsor` or `public`: an owner may delete what it owns,
  and a schema's owner may delete any table in it, even one it does not own. It also refuses if the
  application may create things in either schema, or a helper function's owner may. Only the
  migrations, run as the owner, put tables there.
- **The same database, on purpose.** Not a second database: in step 36, a business change and
  DSoR's record of it can then be saved together, or not at all.
- **The log only, for now.** It is the only paperwork in the database today. Each other kind,
  permission slips, approvals, counters and locks, arrives in `dsor` with the step that builds it
  (decision 122).

Migrations 001 to 007 still say `public.audit`. An applied migration is never edited, because its
checksum covers every byte; migration 008 says where the log went.

## Why it matters

The log sat in `public`, the folder the business's own tools treat as theirs. An accounting upgrade
that resets its tables, or a cleanup that empties `public`, would have taken DSoR's evidence with
it: the record of every decision, gone with the invoices.

And what DSoR keeps only in memory is forgotten at every restart. Step 15, run twice, named
Monday's receipt and Tuesday's receipt both `dsor://org_456/proposal/prop_0001`: two actions, one
address. That one is not fixed here. Proposal numbers move into DSoR's store with proposals
themselves, in step 22, and the comment that promised them for this step says so now.

## What changed since step 15

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_15_freshness_labels ../my_16_the_control_plane_store
```

| File | What |
| --- | --- |
| `migrations/008_the_control_plane_store.sql` | new — the schema `dsor`; every right on it taken back from every role, and `CREATE` from the application by name, before `USAGE` is given to the application; and the log moved into it as it is |
| `src/audit.ts` | every statement names the log `dsor.audit` |
| `src/database.ts` | the start-up checks look for the log in `dsor`. "Do both tables exist?" is asked first, on its own, so a server that missed migration 008 gets the program's own words. And start-up refuses an application that owns the database or either schema, or may create things in either schema, itself or one `SET ROLE` away, and names the role and schema that let it. A helper function whose owner owns either schema, or may create in it, is refused too |
| `src/main.ts` | the demo's second line says where the log lives |
| `src/envelopes.ts`, `src/operations.ts` | two comments that promised step 16 something now name the steps that will do it: 22 for proposal numbers, 36 for one transaction across two logs |
| `test/control-plane-store.test.ts` | new — five tests: the log is in `dsor` and not in `public`; `public` holds the business's table and nothing of DSoR's; a decision recorded through the door lands in `dsor.audit`; the application may use `dsor` and create nothing in it; and the same on a server that hands out rights on every new schema, which proves each `REVOKE` line in 008 |
| `test/the-lock-at-start-up.test.ts` | ten new tests: a server that missed migration 008; the application owning the database, `dsor` or `public`, or one `SET ROLE` from owning `dsor`; a helper whose owner owns `dsor`, or may create in it; the application able to create in `dsor` or `public`, or one `SET ROLE` from it. Most owner and creator cases also do the harm, to show it is real |
| `test/main.test.ts` | the demo's line about the log, pinned, with no rule id: it would pass wherever the log lived |
| `test/database.test.ts` | the `editor` test gets `USAGE` on `dsor`, without which its attack had stopped working, and now carries the attack out. A database that answers nothing is refused at the first question, and one that answers that and then nothing at the second, each in its own words. The evasive answers reach the guards they were written for |
| the tests that name the log | say `dsor.audit`. Tests that named it bare, `audit`, worked only because the database looked in `public` first; they name the schema now. Two tests that build a small database by hand make `dsor` and its grant. The re-run of migration 002 swaps in the log's new address, and is otherwise the file that ran |
| everything else | a `NEW IN STEP 15` marker becoming `STEP 15` |

531 tests became 548. The 39 in the database tier pass on a local PostgreSQL 17 set up like Neon:
an owner with `BYPASSRLS`, and `dsor_runtime` made by that owner. On Neon they run in this step's own database, `dsor_step16`,
once this folder's `.env` names it; the database exists and is empty until then.

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step is the second line:

```text
Hello, accounts-payable-fte.
The audit log is dsor.audit, in DSoR's own schema, in a PostgreSQL on disk at ./.local-database, as `dsor_runtime`.
```

Step 15's said only "The audit log is in a PostgreSQL on disk at …". Everything after the line is
step 15's demo, unchanged: the log moved, and nothing the program does with it changed. With a
`.env` that points at Neon, the line names that database instead, with the password left out.

Before that line, the program has already checked the database. It refuses to start if the log
or the invoices are missing. It also refuses if the application owns the database or either
schema, or may create things in either one.

### The database tier

`pnpm check` needs no server. The thirty-nine tests in `pnpm test:db` need two real logins and a
database of this step's own. Copy step 15's `.env` and change the database name in both URLs:

```bash
cp ../my_15_freshness_labels/.env .env     # then dsor_step15 -> dsor_step16 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first. This folder's own was made on Neon with the owner login already
in step 15's `.env`, by one `CREATE DATABASE dsor_step16`. `pnpm migrate` applies the eight
migrations; on a server that already had the first seven, it applies 008 alone, and the log moves
with everything in it.

## Break it

Nine, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `548` with `1 skipped`; in the repository it is `548 passed`.

### Break 1 · the log is not moved

In `migrations/008_the_control_plane_store.sql`, delete the line that moves the table.

```text
 Tests  300 failed | 247 passed | 1 skipped (548)
```

More than half the suite. The program writes every decision to `dsor.audit`, which is not there,
and a decision that cannot be written down is a request that is not carried out.

### Break 2 · the application may not look inside dsor

In the same migration, delete the `GRANT USAGE ON SCHEMA dsor` line.

```text
 Tests  262 failed | 285 passed | 1 skipped (548)
```

The log is where it should be, and the application cannot reach it: `permission denied for schema
dsor` on every write. A folder's permission comes before its tables'.

### Break 3 · the application may create things in dsor

Grant `USAGE, CREATE` instead of `USAGE`.

```text
 Tests  35 failed | 512 passed | 1 skipped (548)
```

The program refuses to start, and every test that starts it fails: "it may create tables, views or
functions where only the migrations should, itself or one SET ROLE away: dsor_runtime on dsor".
A table the application made in DSoR's folder would be its own, every row of it.

### Break 4 · the start-up check still looks in public

In `src/database.ts`, make the question "do both tables exist?" look for `public.audit`.

```text
 Tests  55 failed | 492 passed | 1 skipped (548)
```

The program refuses to start: "a tenant table is missing". The start-up tests and the demo's tests
fail, because nothing runs. A check that looks in the wrong place fails closed, and loudly.

### Break 5 · the demo no longer says where its log is

In `src/main.ts`, put the demo's second line back as it was in step 15.

```text
 Tests  1 failed | 546 passed | 1 skipped (548)
```

One test, the one that pins the line.

### Break 6 · start-up no longer asks who owns the schemas

In `src/database.ts`, add `&& false` to the condition of the refusal that says "owns, or may become
the owner of, the schema".

```text
 Tests  3 failed | 544 passed | 1 skipped (548)
```

The three tests that give a schema to the application, or put it one `SET ROLE` away. Nothing else
asks, and nothing else would notice that the application could drop the log.

### Break 7 · 008 does not take CREATE back from the application

In the migration, delete the `REVOKE CREATE ON SCHEMA dsor FROM dsor_runtime` line.

```text
 Tests  1 failed | 546 passed | 1 skipped (548)
```

Only the test that starts from a server handing out rights on every new schema. On a fresh server
the line takes away nothing, which is why that test builds a server that is not fresh.

### Break 8 · start-up no longer asks what the application may create

Add `&& false` to the condition of the refusal that says "may create tables, views or functions".

```text
 Tests  3 failed | 544 passed | 1 skipped (548)
```

The three tests that grant `CREATE`, on `dsor`, on `public`, and one `SET ROLE` away.

### Break 9 · start-up no longer asks who owns the database

Add `&& false` to the condition of the refusal that says "may become the owner of, the database".

```text
 Tests  1 failed | 546 passed | 1 skipped (548)
```

The one test that gives the database to the application and `public` back to its owner: the
commonest careless setup, which would otherwise start.

Restore each break and confirm `pnpm check` prints `548 passed` again.

## Build it yourself with Claude Code

Copy `my_15_freshness_labels` to a new folder and ask:

> Start step 16, the control-plane store. Before any code: show me where DSoR keeps its paperwork
> today, and what goes wrong because of where it is. Then ask me the step's decisions one at a
> time. Then build it a piece at a time, red first, and break each piece on purpose.

## Check yourself

1. Where does DSoR's log live now, and what moved with it?
2. Why move the table as it is, rather than start a new log in `dsor`?
3. Why the same database, and not a second one?
4. Migrations 001 to 007 still say `public.audit`. Why are they not changed?
5. The application may use `dsor`, may create nothing there, and must not own it. Why each?

<details>
<summary>Answers</summary>

1. In `dsor.audit`, in DSoR's own schema. Every record, the hash chain, the permissions and the
   row-level security moved with the table, because the table itself moved; nothing was copied.
2. A new log would leave two logs: the old evidence still among the business's tables, and the
   chain broken in two. Moving the table keeps one log and one chain, and the chain survives
   because a record's hash covers its own fields, not the table's name.
3. So that, in step 36, a business change and DSoR's record of it can be saved together, or not at
   all. Two databases cannot be saved together in one transaction.
4. An applied migration is never edited: its checksum covers every byte, and a database that
   already ran it would refuse the changed file. Migration 008 says where the log went.
5. `USAGE` lets the application reach the log, which it must, to write the record of every
   decision. Without `CREATE`, it cannot make a table of its own there. A table named for a later
   step's paperwork, say `dsor.proposals`, would belong to the application, every row of it, and
   that step's migration would find the name taken. And a schema's owner may delete any table in
   it, even one it does not own: an application that owned `dsor` could delete the whole log.

</details>

## The rules this step meets

- **[DSOR-MOD-01 · L1]** A DSoR implementation MUST durably own, in a control-plane store separate
  from agent context, its delegations, controls, proposals, approvals, idempotency records, intent
  records, cumulative-limit counters, holds, and audit evidence. Claimed for **audit evidence
  only**: the log is DSoR's own, in its own schema, in a database the agent never touches. Each
  other kind arrives in `dsor` with the step that builds it.
  ([§1](../../../specs/dsor/01-model.md#1-definition))

**What this step leaves, said plainly.** Only the log is in DSoR's store. Proposal numbers still
live in memory and restart at `prop_0001` with every run, until step 22. The migrations' own
record, `public.applied_migrations`, stays in `public`: it records the shape of the business's
tables and DSoR's alike, and the migration tool makes it before any migration runs. So emptying
`public` still takes DSoR down, though not its evidence: the record goes with it, the next
`pnpm migrate` runs 001 to 007 again and stops at 008, and the program refuses to start until a
person repairs the record. The log in `dsor` is untouched, measured. The two schemas
share one owner, so the store is separated by folder and by permission, not by who owns it: a tool
that logs in as the owner could still reach `dsor`. And a refusal written into two companies' logs
is still two writes, not one transaction, until the step that builds transactions; the program
tells the caller exactly which logs got the record.

Everything earlier steps claimed still holds.

**Next:** step 17, `vendors_and_payments` — a payment is made as a draft, and every command says
whether it can be undone.
