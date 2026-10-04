# Step 09 · PostgreSQL on Neon

**New in this step:** the audit log lives in a real database, and the application is not allowed to
change it.

## In plain words

Step 08 was careful. Every decision written down before the answer, refusals included, each record
carrying the fingerprint of the one before it so tampering shows.

Then you close the program and all of it is gone.

The log was a plain array inside one running process. This step moves it into **PostgreSQL**, and
gives the program an account that may **add** rows and may not change or delete them. Not because our
code is careful — because the database refuses.

Three words you will meet:

- a **migration** is one numbered `.sql` file that changes the database's shape. `001_audit.sql`
  creates the table.
- **GRANT** and **REVOKE** are how PostgreSQL says who may do what.
- an **account** (PostgreSQL calls it a *role*) is who you connect as. This step has two.

## Why it matters

> At 09:14 `cfo_100` is refused `invoice.issue`. The record is written. The chain verifies. At 09:15
> the process restarts — a deploy, a crash, anything. **The record is gone.** The one piece of
> evidence that somebody tried is gone, and nothing says it ever existed.

Step 08's own README admits it: `DSOR-EXE-02` says the decision must be *durably* recorded, and
"durably is doing a lot of work for an array in one process".

And the program could do worse than lose it. `forgetTheLog()` was exported and nothing stopped
anything calling it. §30 is blunt about that:

> The account DSoR itself runs under has no permission to edit or delete log rows.

Ours had every permission.

## The two accounts

| Account | May |
| --- | --- |
| the **owner** | create and change tables. Used by `pnpm migrate`, and never by the program |
| **`dsor_runtime`** | `INSERT` on every column except `recorded_at`, and `SELECT`. Not `UPDATE`, not `DELETE`, not `TRUNCATE` |

That is `002_runtime_user.sql`, and it is the whole step. Step 08's chain makes tampering
**detectable**; this makes it **refused**.

**And the program has to actually *be* `dsor_runtime`.** This is the part that was wrong here for a
while, and it is worth a paragraph because the mistake is easy and quiet. The migration took
`UPDATE` away from `dsor_runtime` and the tests proved it — by running `SET ROLE dsor_runtime`
themselves first. The program never ran that line. On the in-process route it connected as
`postgres`, a superuser, and a superuser is allowed everything no matter what any `GRANT` says:

```text
PGlite connects as: postgres   superuser: true
  UPDATE    SUCCEEDED
  DELETE    SUCCEEDED
  TRUNCATE  SUCCEEDED
```

280 tests were green, because not one of them asked who the program had connected as. A test that
borrows the right identity proves the `GRANT`. Only a test that uses the program's **own**
connection proves the program. `src/database.ts` now drops to the application's role and then asks
the database whether this connection could rewrite the log, refusing to start if it could — on both
routes, because a connection string pointing at the owner is a configuration mistake, not a
preference.

## Run it

```bash
pnpm install
pnpm migrate
```

```text
applied 001_audit.sql
applied 002_runtime_user.sql

2 migration(s) applied to this database:
  001_audit.sql                2026-10-02T16:55:14.235Z
  002_runtime_user.sql         2026-10-02T16:55:14.239Z
```

Run it again and it says so, which is a different sentence on purpose:

```text
Already up to date. Nothing was applied.
```

Then the program:

```bash
pnpm start
```

```text
10 records, chain verifies against the head: true
drop one from the copy we are holding: the chain alone still says true, and against the head false
2 refusals counted without a record, because nobody was logged in
```

**Now run it again.**

```text
20 records, chain verifies against the head: true
```

That line is step 09. The first run's records are still there, written by a process that no longer
exists — and the second run's records link onto them, so the whole chain still verifies.

### What the second line of that output does and does not show

Hash chaining proves no record was **edited**. It is no evidence at all that none was **deleted from
the end** — drop the last record and every link still holds, there is simply less of it. A
*checkpoint* is what notices, and §30 names checkpoints beside hash chaining for exactly that.

But read it carefully, because step 09 claimed more than it delivers. The log is read once and that
line drops a record from **the copy being held**, so what it catches is a shortened log you were
handed. A row deleted from the **table** moves `theHead()` with it, because `theHead()` is a query
over that same table — and then the two agree again:

```text
3 records, head count 3   verifies: true
DELETE the last row
2 records, head count 2   verifies: true
```

§30 says the answer and says it as a SHOULD: *anchor checkpoints outside the control-plane store.*
This step has nowhere outside to put one, which is why `DSOR-AUD-04d` is not claimed — and
`test/audit.test.ts` pins the limit, so the day something anchors a checkpoint, a test says so.

### Which database is that?

With no connection string set, the program opens a PostgreSQL **on disk in this folder**, through
PGlite — the PostgreSQL engine compiled to WebAssembly. It is not a pretend database; it is the
engine, keeping its data in `.local-database/`, which is in `.gitignore`.

That is why the step runs with no account and no network, and why the guarantee below is proven on a
fresh checkout rather than taken on trust.

## Proving it: `UPDATE audit` must fail

The map's "done when" is one line, and `test/audit-permissions.test.ts` is it:

```text
INSERT a decision        allowed
SELECT it back           allowed
UPDATE it                permission denied for table audit
DELETE it                permission denied for table audit
TRUNCATE the whole log   permission denied for table audit
DROP the table           must be owner of table audit
create its own table     permission denied for schema public
```

Those refusals are PostgreSQL's own privilege system, not our code checking itself.

## Two commands, and what each proves

```bash
pnpm check     # 326 tests, no database and no network needed. Outside the repository one of
               # them skips itself, and says so: it compares the step's copy of the audit-record
               # schema with the specification's, and a copy of one step has no specification
pnpm test:db   # needs DSOR_DB_URL and DSOR_DB_OWNER_URL; skipped without them
```

Being honest about the split matters: **`pnpm check` being green does not mean every database
guarantee holds.** Two things one in-process connection cannot do, and `audit.db.test.ts` is for them:

- **log in as a second user.** PGlite has one connection, so the tests reach the application's
  account with `SET ROLE`. The privilege checks are identical; what is untested is whether
  `dsor_runtime` *connecting* gets the same answers.
- **race.** One connection cannot race itself, so `UNIQUE (chain, sequence)` under two writers
  needs a server. That test races three *different* record ids for one position and asserts that the
  error names `audit_chain_sequence_key`. It used to send the same insert three times, and the primary
  key refused the losers — dropping the unique constraint left it green.

With no connection string it reports `9 skipped`, which says so rather than passing quietly. With one,
it reports `9 passed` — and those nine have been run, against a real PostgreSQL 17 with two real
logins. Granting the application `UPDATE` on that server fails two of them, which is how you know they
are asserting something.

`pnpm check` deletes `.local-database` before it runs, because `main.test.ts` needs a fresh database
to count the demo's records — so the log `pnpm start` showed you does not survive it. And if
`pnpm start` ever stops with *a migration has changed since it was applied*, that is the checksum
guard noticing that `.local-database` was built by an older version of a migration file; for this
throwaway database the answer is `rm -rf .local-database` and run again.

### Pointing it at a real server

```bash
cp .env.example .env     # then fill in both connection strings
```

`.env` is read by `pnpm start`, `pnpm migrate` and `pnpm test:db` — through
`process.loadEnvFile`, which is Node's own, so there is no dependency for it.

**Neon**, which is what the map names: make a project at [neon.tech](https://neon.tech), then in its
SQL editor:

```sql
CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'something-long';
GRANT CONNECT ON DATABASE neondb TO dsor_runtime;
```

No table rights there on purpose — `002_runtime_user.sql` grants the one it needs and revokes the
rest, so the whole permission story is in a file you can read. `.env` is in `.gitignore` and must
never be committed; `.env.example` has no secrets in it.

**Or a PostgreSQL on your own machine**, which needs no account and is what these nine tests were
first run against:

```bash
brew install postgresql@17
initdb -D /tmp/dsor-pg -U dsor_owner --auth=trust
pg_ctl -D /tmp/dsor-pg -o "-p 55432 -k /tmp" -l /tmp/dsor-pg.log start
createdb -h /tmp -p 55432 -U dsor_owner dsor_step09
psql -h /tmp -p 55432 -U dsor_owner -d dsor_step09 \
  -c "CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'pick-something';" \
  -c "GRANT CONNECT ON DATABASE dsor_step09 TO dsor_runtime;"
```

Then two connection strings against `localhost:55432`, and `pnpm migrate && pnpm test:db`. Stop it
afterwards with `pg_ctl -D /tmp/dsor-pg stop`.

## What `at` and `recorded_at` are both for

The table has two times, and the reason is worth knowing.

`at` is the application's claim, and it has to be: the fingerprint is computed **before** the row
exists, and `UPDATE` is revoked afterwards, so there is no moment at which the database could stamp it
and still be covered by the hash.

So the database stamps `recorded_at` as well — which the application cannot set or change, and which
the hash does not cover. "Cannot set" is a recent repair: `recorded_at TIMESTAMPTZ NOT NULL DEFAULT
now()` reads as though the database owns the column, and a `DEFAULT` only fills a value nobody
supplied. `GRANT INSERT ON audit` covers **every column**, so the application could simply name it:

```text
INSERT SUCCEEDED. at=2026-10-04 05:00:00+05  recorded_at=1999-01-01 05:00:00+05
```

The point of `recorded_at` is to be a time the application did not choose, so `002_runtime_user.sql`
grants `INSERT` **column by column** and leaves this one out. A `DEFAULT` is not a permission. The
cost is worth knowing: add a column to `audit` and that list must gain it, or every `INSERT` starts
failing — which fails closed, and a test checks every column of the table by name so it fails in
`pnpm check` rather than in production.

A backdated record arrives with its two times far apart:

```text
 at          = 2019-01-01 00:00:00
 recorded_at = 2026-10-02 16:55:14
```

Detection by an independent witness, not prevention. A `CHECK` that `at` is near `now()` would prevent
it and would also refuse an innocent slow request — and a refused audit write means the operation does
not run at all.

## What changed since step 08

```bash
git diff --no-index ../my_08_write_the_decision_first ../my_09_postgres_on_neon
```

| File | What |
| --- | --- |
| `migrations/001_audit.sql` | new — the table, with the primary key and `UNIQUE (chain, sequence)` |
| `migrations/002_runtime_user.sql` | new — the grant and the revokes. The step |
| `src/migrations.ts` | new — finding the migrations, deciding which are left, applying them |
| `src/database.ts` | new — a real server if `DSOR_DB_URL` is set, otherwise one on disk. On disk it drops to `dsor_runtime`; on a server it is whatever the connection string names, and either way it refuses to start holding `UPDATE` |
| `src/audit.ts` | the log is SQL now: `INSERT`, `SELECT`, and a head that is a query. Every table name says `public.`; every record carries a per-attempt `trace_id` |
| `src/login.ts` | one line moved inside a `try`, because `Object.hasOwn` can throw |
| `src/pipeline.ts`, `src/operations.ts` | async, because a database write is |
| `scripts/migrate.ts` | new — `pnpm migrate` |
| `test/database.test.ts` | new — who the program connects as. Break 6 is zero failures without it |
| `test/audit-race.test.ts` | new — a writer held at its tail read while another commits |
| `test/audit-lost-reply.test.ts` | new — an `INSERT` that commits and loses its reply, on a connection that may then be gone |
| `test/audit.db.test.ts` | the program's own door pointed at a real server: at the owner it refuses to start, at the application it starts and still cannot `UPDATE`. And the program's own writer under real parallelism, which answered a question PGlite could only guess at: the constraint that refuses a collision of its row shape is `audit_pkey` |
| everything in `test/` | async, and nine files now need a database |

232 tests became 326.

## The pipeline became async, and that was a decision

A database write is not synchronous, so the moment `audit()` writes a row the `await` reaches every
call site — 129 of them across eight test files. The `build-baby-step` skill says to stop when a step
needs two ideas, so this was put to the learner rather than assumed. The answer: async is the **cost**
of a real database, not a second idea, and it arrives where the reason for it is visible.

It is worth knowing one thing changed shape, not just signature. A stage that throws now produces a
**rejected promise** instead of throwing where the caller stands:

```ts
expect(() => door(...)).toThrow(/power went out/)          // passes without running its body
await expect(door(...)).rejects.toThrow(/power went out/)  // what it has to be
```

## Break it

Nine of them, because this step has nine separate guarantees and a break that takes down half the
suite does not tell you which one you broke. Every number below was produced by actually making the
change and running `pnpm check`, never written from memory — and several of them were wrong until
they were re-run.

### Break 1 · let the application change the log

In `migrations/002_runtime_user.sql`, **replace** the `GRANT INSERT (…), SELECT ON public.audit`
statement with:

```sql
GRANT ALL ON public.audit TO dsor_runtime;
```

```text
 Tests  6 failed | 320 passed (326)
```

Where the line goes decides what you see, and the first version of this exercise did not say. Replaced,
the `REVOKE UPDATE, DELETE, TRUNCATE` line below it still takes those three back — so the step's "done
when" test **passes**, and the six that fail are the ones that read the privilege shape (INSERT is
table-wide again) and the two that forge `recorded_at`, which `GRANT ALL` hands back column by column.
**Appended** at the end of the file instead, nothing takes `UPDATE` back, `refuseIfItCanRewriteHistory`
refuses every `openTheDatabase`, and `24 failed | 302 passed` — the start-up guard doing its job,
loudly, in every test that opens the program's own door.

### Break 2 · leave `TRUNCATE` out of the revoke

```sql
REVOKE UPDATE, DELETE ON public.audit FROM dsor_runtime;   -- was UPDATE, DELETE, TRUNCATE
```

```text
 Tests  2 failed | 324 passed (326)
```

`TRUNCATE` is its own privilege, not part of `DELETE`, and it empties the table in one statement. A
log the application can `TRUNCATE` is not append-only whatever else is true of it.

### Break 3 · take away the unique constraint

In `001_audit.sql`, replace `UNIQUE (chain, sequence)` with `CHECK (true)`.

```text
 Tests  2 failed | 324 passed (326)
```

### Break 4 · let a migration be edited after it ran

In `src/migrations.ts`, make the checksum comparison always false:

```ts
if (false) {   // was: if (file !== undefined && checksumOf(file.sql) !== checksum)
```

```text
 Tests  2 failed | 324 passed (326)
```

### Break 5 · order the chain as text

In `src/audit.ts`, drop the alias:

```sql
SELECT sequence::text, record_hash FROM public.audit WHERE chain = $1 ORDER BY sequence DESC LIMIT 1
```

```text
 Tests  65 failed | 261 passed (326)
```

This is the bug that actually happened, and it survived nine records before it bit. `SELECT
sequence::text` names its output column `sequence`, and PostgreSQL resolves a bare name in `ORDER BY`
to an **output** column first — so the ordering becomes text, where `"9"` sorts after `"10"`. The tail
freezes at 9 and every write after that computes 10 and dies on the primary key.

### Break 6 · let the program keep the owner's connection

In `src/database.ts`, comment out the line that drops to the application's role:

```ts
// await becomeTheApplication(db);
```

```text
 Tests  11 failed | 315 passed (326)
```

The largest number here after Break 5, and it was **zero** until `test/database.test.ts` existed.
Every privilege test still passed, because each one ran `SET ROLE dsor_runtime` itself. This is the
step's sharpest lesson: a permission test has to use the connection the **program** ended up
holding, or it is testing the database and not the program.

### Break 7 · leave the schema off a table name

In `src/audit.ts`, write `INSERT INTO audit (` instead of `INSERT INTO public.audit (`.

```text
 Tests  2 failed | 324 passed (326)
```

`dsor_runtime` cannot `UPDATE` or `DELETE` the log, and it *can* create a temporary table, because
`TEMPORARY` is granted to `PUBLIC` by default. `pg_temp` is searched before `public` unless
`search_path` names `pg_temp` explicitly — a session setting, not a grant — so an unqualified `INSERT INTO audit` goes to the application's own throwaway
table:

```text
after one audit() call:  public.audit has 0 row(s),  pg_temp.audit has 1
theLog() reports 1 record(s)
```

The program reports a healthy audit trail, the real log stays empty, and the evidence disappears when
the connection closes. No privilege a migration can portably write closes this one — `REVOKE TEMPORARY ON
DATABASE` would, and needs the database's name — and a GRANT decides what may be done to a table, not
which table a name means.

### Break 8 · treat a lost reply as a failed write

In `src/audit.ts`, replace the `try`/`catch` around `insert(db, written)` with a bare
`await insert(db, written);`.

```text
 Tests  5 failed | 321 passed (326)
```

A database can commit an `INSERT` and lose the **reply**. Step 08's store was an array, which either
takes the record or throws; a network has a third answer. Treating it as failure told the caller the
decision "could not be written down, so it was not carried out" while the row sat in the table saying
`ALLOWED` — the log and the answer contradicting each other, which is the one thing a decision record
exists to prevent.

The recovery looks for its own record and, if it **cannot look** because the connection is gone, says
so: `OUTCOME_UNKNOWN`, retry `after_reconciliation`. That is `DSOR-UNK-01b`, and the first version of
this fix got it wrong — the look-up ran on the dead connection, its error escaped, and the caller was
back to `EVIDENCE_STORE_UNAVAILABLE` / `safe_same_key` on exactly the case a restart produces.

Three more things a second review made precise. A `23505` from PostgreSQL closes the case where the
other writer landed first — "that row exists, yours did not commit". `correlation.trace_id`, a fresh
UUID per attempt and inside the hash, closes the other: two attempts can no longer produce the same
bytes, so an equal hash means *this* attempt and nothing else (before it, two writers for the same
request and millisecond were one row with two receipts). And a failure the **server** reported, which
carries a SQLSTATE, is told apart from a connection that went quiet, which does not: only the first is
a failure. The second, when the record is not there, is unknown — the statement may still be running
on a connection this side no longer holds, and "not found" is a snapshot, not a proof.

### Break 9 · read the clock before the tail

In `src/audit.ts`, move the block that reads the clock — from `const told = now();` down to
`const at = new Date(instant).toISOString();` — back above `const db = theDatabase();`.

```text
 Tests  5 failed | 321 passed (326)
```

A writer that gets overtaken then stamps an earlier time at a later position. Nothing is tampered
with, every hash agrees, and `verifyChain` reports the chain broken — permanently, because the
application has no `UPDATE` to correct the rows with. Reading the clock after the tail closes it for
**one process with one clock**, and the unique constraint is why: a writer that takes position N+1 saw
N in the tail, so N was committed, and N's time was sampled before N's `INSERT`. Two instances of
this program on one database with skewed clocks break the same check, and so does the system clock
stepping backwards — neither is fixable here, and `my_notes/open-questions.md` holds both.

Restore each break and confirm `pnpm check` prints `326 passed` again.

## Build it yourself with Claude Code

> Move my audit log out of memory and into PostgreSQL. Write the migrations by hand as numbered
> `.sql` files and apply them with a runner I can read — no migration library.
>
> Two accounts: an owner that runs the migrations, and the application, which may `INSERT` and
> `SELECT` on the log and nothing else. Prove it: a test that runs `UPDATE audit` and passes only
> when PostgreSQL refuses.
>
> Before you write the store, tell me what has to become async and how many call sites that is, and
> let me decide whether that belongs in this step.
>
> Then break every `REVOKE` line one at a time. If removing one leaves every test passing, tell me —
> do not quietly keep it.

## Check yourself

1. The log is a database table now. What stops the program rewriting a row?
2. Why does `at` have to be the application's time rather than the database's?
3. `pnpm check` is green. Which of this step's guarantees is still unproven?
4. A `REVOKE` line was removed and every test still passed. What does that tell you?
5. Why must an applied migration never be edited, when the file is still right there?
6. Why is `TRUNCATE` named separately from `DELETE`?

<details>
<summary>Answers</summary>

1. The account it connects as has `INSERT` on every column but `recorded_at`, and `SELECT`, and
   nothing else. `UPDATE` comes back `permission denied for table audit` from PostgreSQL, not from
   our code. Step 08's chain makes a change *detectable*; this makes it refused. And the second half
   of the answer is the one this step got wrong for a day: the program has to actually **be** that
   account — a `GRANT` protects nothing if the process connects as the owner, and a test that runs
   `SET ROLE` itself proves the grant, not the program.
2. Because the fingerprint covers `at`, and the fingerprint is computed before the row exists — and
   `UPDATE` is revoked afterwards, so there is no later moment to stamp it in. `recorded_at` is the
   database's own time, which the application cannot set — `INSERT` is granted column by column and
   that column is left out — and which the hash does not cover, so the two disagreeing is the
   evidence.
3. Three things `pnpm check` cannot see, because one in-process connection cannot do them: that the
   application is refused when it **logs in** as itself rather than assuming the role; that two
   writers cannot both take one position under real parallelism; and that the program's own door,
   pointed at the owner's connection string, refuses to open. All three need a server and all are in
   `audit.db.test.ts`, which reports `7 skipped` without one — and which has been run. Beyond both
   tiers, three things are still unproven and written down as such: a `SECURITY DEFINER` function
   or an owner's trigger could rewrite rows past the start-up check; which constraint refuses a real
   program race on a real server is inferred from PGlite; and two instances with skewed clocks still
   break the time check.
4. That the line was not what was protecting you. Measured: a freshly created table grants nobody
   anything, so there was nothing for a `REVOKE` to take away — the guarantee rested on the `GRANT`
   being narrow. The `REVOKE`s matter on a database with a history, and the tests now reach them by
   granting something first.
5. Because the database recorded that it ran *that text*. Edit the file and the shape in front of you
   was built from something that no longer exists anywhere. The checksum is what notices, and it
   refuses rather than guesses: `pnpm migrate` stops with *"001_audit.sql has changed since it was
   applied … an applied migration is never edited. Add a new migration instead."* That line fired
   twice while this step was being fixed, and the answer in development — a database nobody but you
   has ever used — was to drop the tables and re-apply. The answer anywhere real is `003`.
6. Because it is a separate privilege. Revoking `DELETE` leaves `TRUNCATE`, and `TRUNCATE` empties
   the whole table in one statement.

</details>

## The rules this step meets

- **[DSOR-AUD-04a · L2]** The DSoR runtime identity MUST NOT be able to update or delete audit
  records. ([§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention))
- **[DSOR-AUD-02a · L1]** Operational audit MUST NOT be stored only as agent memory.
  ([§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence))

`DSOR-AUD-04a` is met for the account the application connects as: `INSERT` on every column except
`recorded_at`, and `SELECT`, with `UPDATE`, `DELETE` and `TRUNCATE` revoked — proven by tests that run
each one and require PostgreSQL to refuse, **through the connection the program itself ends up
holding**. That last clause is the whole of Break 6, and it was the gap: the rule says the *runtime
identity* must not be able to update or delete records, and for a while the runtime identity was
`postgres`.

Three limits, stated plainly.

1. On the in-process route there are no logins at all — PGlite hands out one connection and it
   belongs to the owner — so the program reaches the application's account with `SET ROLE`. On a real
   server the limit is the **server's**, because the program only ever holds `dsor_runtime`'s
   password; here it is the program's own choice, and a `RESET ROLE` would lift it. What the choice
   does prove is that the grants are enough for the program to do its job and no more, which would
   otherwise stay untested until the day it ran against Neon. `audit.db.test.ts` is the test that
   logs in properly, and it needs a server.
2. The **owner** can still do anything, which is the design and not a gap: migrations have to come
   from somewhere. So this rule is met against the *application*, and a human with the owner's
   connection string is outside what any `GRANT` can say about.
3. `refuseIfItCanRewriteHistory` is a check at start-up, not a boundary. It asks four questions and
   each was measured open before it was asked: does this connection hold `UPDATE`, `DELETE` or
   `TRUNCATE`; is it a member — inherited or `NOINHERIT`, one `SET ROLE` away — of a role that does;
   may it `EXECUTE` a `SECURITY DEFINER` function whose owner does (a rewrite by proxy, with the
   application holding nothing); and does the table carry a trigger, which is the owner's code
   running inside every `INSERT` this program makes. It runs on **both** routes, and the database
   tier points it at the owner's connection string and requires it to refuse. What it cannot stop is
   someone who can change the configuration, the migrations, or the owner's own code — a start-up
   check is a tripwire for mistakes, not a wall against the owner, and the owner is the design.

`DSOR-AUD-02a` is met in the only sense it can be here: the log is in PostgreSQL, and there is no
agent memory in this program for it to be in instead. The rule exists to stop an implementation
treating a model's recollection as the record, and nothing here could.

`DSOR-EXE-02`'s *durably* half, which step 08 explicitly did not claim, now holds: the records survive
the process, which `pnpm start` demonstrates by being run twice.

`DSOR-UNK-01b` — an unknown outcome is reported as unknown, never as success, failure or a retryable
error — is met **for the two unknowns this step can produce**, both about the evidence write rather
than the command: an `INSERT` whose reply is lost on a connection that then cannot be asked, and an
`INSERT` whose connection failed before the server answered and whose record is not there *yet*. Both
get `OUTCOME_UNKNOWN` with retry `after_reconciliation`, and `test/audit-lost-reply.test.ts` holds
each by injecting the exact fault. Read the rule's own words and its subject is "whether the action
happened"; here it is applied to the record *of* the action, by analogy and on purpose, because a
decision record that may or may not exist is the same shape of problem. The command's outcome itself
cannot be unknown until a command reaches a connector, and that is step 37.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-AUD-04c` | Every record belongs to exactly one chain. There is one chain, so nothing is partitioned and nothing can belong to two. Step 10 brings a second tenant and makes this a real question. |
| `DSOR-AUD-04d` | Every chain covered by each checkpoint. `theHead()` is a checkpoint of one chain, computed on demand and stored nowhere — §30 says to anchor checkpoints outside the control-plane store, and this is inside it. |
| `DSOR-AUD-05b` | Reading audit must itself be authorized and audited. `theLog()` is a plain function any code can call, and reading it writes nothing. |
| `DSOR-AUD-05c` | Retention must be policy-controlled and support legal holds. Nothing deletes and nothing expires; "keeps everything forever" is not a policy. |
| `DSOR-EXE-04a` | The state change, the outcome and the outbox commit atomically. The invoices are still an array, so there is nothing to share a transaction with. Step 34. |

Everything earlier steps claimed still holds, including step 08's `DSOR-EXE-02`, `DSOR-AUD-01`,
`DSOR-AUD-04b`, `DSOR-EXE-03b`, `DSOR-MOD-04` and `DSOR-COR-01a`.

**Next:** step 10, `tenants` — a second company shares the database and cannot see the first one's
rows. The invoices move out of memory there too, which this step deliberately left alone.
