# Step 16 · The control-plane store

Folder: [`my_16_the_control_plane_store`](../my_16_the_control_plane_store/README.md) · 548 tests,
plus 39 in the database tier
Spec: [§1](../../../specs/dsor/01-model.md#1-definition) · `DSOR-MOD-01`, for audit evidence only
The database tier, 39 tests, passes on a local PostgreSQL 17 set up like Neon, on the final
code; on Neon, `dsor_step16` waits for this folder's `.env`. Decisions [122, 123 and 124](decisions.md).

## What the step is

DSoR's log, the only paperwork it keeps in the database today, moves out of `public`, the folder of
the business's own tables, into a schema of its own, `dsor`, in the same database. The table moves
as it is: records, hash chain, permissions and row-level security go with it, and the chain cannot
break, because a record's hash covers its own fields and not the table's name. The application may
look inside `dsor` and create nothing there.

## How it was built

The problem first, on step 15 as copied: the log was `public.audit`, beside `public.invoices`, in
the folder the business's own tools treat as theirs; and, run twice, the program named two different
receipts `prop_0001`, because proposal numbers live in memory. Three decisions, one at a time
([decision 122](decisions.md)): the log only moves now; the table moves as it is; the gap where one
refusal is written into two logs non-atomically stays, its comment corrected.

Then the copy, green before any edit, and step 15's markers made plain. Then two pieces, each red
first, committed and broken on purpose:

1. **The move** — migration 008; every statement in the program and the tests names `dsor.audit`;
   four new tests.
2. **The demo says where its log lives**, and the two comments that promised step 16 something
   name the steps that will do it: 22 for proposal numbers, 36 for one transaction.

Then the review, below, and decision 123's four pieces, built the same way:

3. **"Do both tables exist?" first, on its own**, so a server that missed migration 008 gets the
   program's own words, "Apply the migrations", and not PostgreSQL's.
4. **Who owns the schemas.** Start-up refuses an application that owns `dsor` or `public`, or is
   one `SET ROLE` from owning either, and a helper function whose owner owns either.
5. **Create nothing in `dsor`, made sure three ways.** Migration 008 takes `CREATE` back from the
   application by name; a test from a server that hands out rights on every new schema proves
   each `REVOKE` line; and start-up refuses an application that may create in either schema.
6. **A rule id dropped** from the demo test, which would pass wherever the log lived.

Then a second review, of those four, and decision 124, taken on the learner's instruction while
they slept, with the recommended option each time:

7. **Who owns the database.** Start-up refuses an application that owns its database.
8. **A helper's owner may not create** in either schema.
9. **The `CREATE` refusal names each role and schema**, and both migrations.
10. **Two tests pinned to their own refusal**, and the 008 test titled for what 008 does.

## What the build found

**Bare names worked by accident.** The program's own statements had named the log's schema every
time since step 09, and a test scans the code to keep it so. The tests themselves were not scanned,
and many named the table bare, `audit`, which worked only because the database looked in `public`
first. After the move, 23 tests failed on `relation "audit" does not exist`. They name the schema
now. One test kept its bare name on purpose: it shows a temporary table called `audit` catching a
statement that forgot the schema.

**A test re-runs a migration that can no longer run.** The permission tests re-apply migration 002
to show its lines take stray rights back. 002 says `public.audit`, and an applied migration is
never edited, so after 008 it names a table that is gone. The test swaps in the log's new address
and runs the file's lines otherwise as they are: what they take back is the question, not where the
table lives.

**Two hand-built databases.** Two start-up tests build a tiny database by hand rather than from the
migrations. They made the log in `public`; they make `dsor`, and give the application `USAGE` on
it, as 008 does. Without that grant, the start-up check failed with "permission denied for schema
dsor" before it asked its question.

**The unit-test database has no `applied_migrations`.** It is built by running the migration files
directly, not through the migration tool, so the table the tool keeps does not exist there. The
test of what `public` holds ignores that one table wherever it is.

**The database tier was not run before the review.** The rename was checked with `pnpm check`,
which never collects `*.db.test.ts`, and one database test still looked for the log's columns in
`public`. On a local PostgreSQL 17, with that test as it was: 1 failed and 38 passed; fixed, 39
passed. The local owner needed `BYPASSRLS` to match Neon, which gives it to every role made in
its Console: without it, 29 tests failed on the row-level lock while setting up their own rows,
which says something about the server, not the step.

**A test of evasive answers had passed for the wrong reasons since step 11.** Each of its seven
rows leaves one start-up question unanswered, and none answered "do both tables exist?". So the
tables check refused six of them, and the `who` question, which came first, refused the seventh,
before any reached the guard it was written for. The first version of this note said all seven;
the second review counted. The fake answers that question truly now. Each row is still refused by the first guard it
does not satisfy: no test yet answers every other question safely and evades one at a time.

**A backtick ends the string.** The start-up questions are SQL inside JavaScript template
strings. A SQL comment that put `dsor` in backticks ended the string, and the file stopped
parsing. The code above it writes them escaped; the new comment names dsor plainly.

## Limits, stated

- Only the log is in DSoR's store. Proposal numbers restart with every run until step 22.
- `public.applied_migrations` stays in `public`.
- The two schemas share one owner: a tool that logs in as the owner could still reach `dsor`.
- A refusal written into two companies' logs is two writes until the step that builds transactions.
- Emptying `public` takes DSoR down, though not its evidence: the migrations' record goes with it,
  and the next `pnpm migrate` stops at 008 until a person repairs the record.
- The test of evasive answers asks only that something refuses.
- Steps 09 to 15 keep the schema-owner gap and the missing message for a missing log; they are
  finished, and a learner copy is not edited afterwards.

## The hostile review

The first reviewer moved a three-record log and found the move complete: every grant, the
row-level security, the one policy, all twenty constraints and both indexes went with it, the
chain verifies after the move, and `public` keeps only `invoices`. Every finding below was
measured again before it went to the learner, by running the reviewer's five probes a second
time, and each one reproduced.

Three were mistakes in carrying out decision 122, corrected without a question: the database
test still looking in `public`; the `editor` test, whose attack had stopped working when
`editor` lost its way into the new schema, though the test kept passing; and seven comments
that quoted history in words it never had. Two sentences were false as well: the README's
reason for "create nothing" (a view the application makes stays under the lock, measured), and
decision 122's "the whole suite", which counted the unit tests only.

Four were put to the learner, who took every recommendation ([decision 123](decisions.md)): the
schema's owner may drop the log, and start-up never asked who owns it; "create nothing in
`dsor`" was promised and never checked, and a server with default privileges broke it; the
program's own words never appeared for a missing log; and a demo test claimed a rule it does
not prove. One was written down: emptying `public` takes DSoR down.

The second reviewer read decision 123's code. It found no answer the checks would read as "fine"
by mistake, and a Neon-shaped database passed start-up: an owner holding BYPASSRLS and a member
of a `neon_superuser`, owning the database, making `dsor_runtime` itself. It found:

- **The commonest careless setup slipped through on the second try.** An application that owns
  its database was refused only through `public`, whose owner is the database's, and giving the
  schema back, as the refusal said, let it start. A database's owner may drop it.
- **A helper could create where the application may not.** Its owner may create in `dsor`, and
  one call as the application made `dsor.proposals`.
- **A refusal whose advice did not work.** With `CREATE` reaching the application through a
  group, "revoke it from `dsor_runtime`" changed nothing.
- **A test that passed on the wrong refusal**, and a sentence of mine that said seven where six
  was true.

All four fixes are [decision 124](decisions.md), taken with the recommended option on the
learner's instruction. Each was built red first where there was a red to see, and broken on
purpose: five breaks, five predictions, each measured exactly. What the review could not check
is Neon itself; the database tier ran on a local PostgreSQL 17 shaped like it, before and after
the fixes, 39 passed both times.
