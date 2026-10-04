# Step 09 · PostgreSQL on Neon

Folder: [`my_09_postgres_on_neon`](../my_09_postgres_on_neon/README.md) · 326 tests, plus 9 in the
database tier
Spec: [§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) · `DSOR-AUD-04a`,
`DSOR-AUD-02a`
Both tiers have run: 326 under `pnpm check`, and 9 under `pnpm test:db` against a real server.
Decisions [67 to 86](decisions.md). Lessons [20 to 34](lessons.md). The header above was "278 tests,
plus 4" and "decisions 67 to 74" for a day after both had changed — the two addenda at the bottom are
where the step actually finished.

## What it does

The audit log moves out of memory. The application connects as an account that may `INSERT` and
`SELECT` on `audit` and nothing else, so `UPDATE` comes back `permission denied for table audit` from
PostgreSQL rather than from our code.

Step 08's chain made tampering **detectable**. This makes it **refused**.

## Built in seven pieces

| Piece | Tests | What it added |
| --- | --- | --- |
| 0 | 232 | the folder, four decisions settled before any code |
| 1 | 243 | finding the migrations, strictly, with no database |
| 2 | 250 | the two migrations, and deciding which are left |
| 3 | 266 | the guarantee, proven against real PostgreSQL |
| 4 | 266 | the pipeline becomes async, and nothing else changes |
| 5 | 267 | the log lives in the database and survives a restart |
| 6 | 277 | `pnpm migrate` applies only what has not run |
| 7 | 278 | `pg`, so it can point at Neon, and the database tier |

## PGlite, and why it is not a mock

The browser extension was blocked for the session and signing in to Neon was not mine to do, so the
guarantee is proven with **PGlite** — PostgreSQL 18 compiled to WebAssembly, in-process. It turned out
to be the better answer for a learner: `pnpm check` proves the step's "done when" on a fresh checkout,
with no account and no network.

[AGENTS.md](../../../AGENTS.md) forbids proving audit immutability against a mock, and that is exactly
right — but a mock is a thing that imitates a database's answers. This is the engine. Two gaps it
cannot close, both written in the test file's own header and both covered by `audit.db.test.ts`: a real
*login* as `dsor_runtime` rather than `SET ROLE`, and two writers racing for one position.

## Five bugs, every one found by measuring

| Bug | How it was found |
| --- | --- |
| **`ORDER BY sequence` ordered by text.** `SELECT sequence::text` names its output column `sequence`, and PostgreSQL resolves a bare name in ORDER BY to an *output* column first — so `"9"` sorted after `"10"`. The tail froze at 9 and every write after that died on the primary key | nine records passed first. Printing the computed sequence, after the error message turned out to be `EVIDENCE_STORE_UNAVAILABLE` and said nothing |
| **The migration was wrong about itself.** Deleting each `REVOKE` left every test passing: a fresh table grants nobody anything, so the guarantee rested on the `GRANT` being narrow | a mutation sweep, then measuring the privileges at each step |
| **`expect(async () => …).toThrow()`** in three places, written by my own async transform — the exact silent-pass trap I had documented one commit earlier | an unhandled rejection in the output |
| **A cast asserting a method that was not there.** `pool as unknown as Runner`: `pg` has no `exec` | [lesson 20](lessons.md). It would have failed only on the real server |
| **27 failures while one file passed all 21 alone** | shared module state. A file that passes alone and fails in company, every time |

The `ORDER BY` one is the pick of them, because `src/migrations.ts` has a paragraph warning about
exactly that shape — "`10_x.sql` sorts before `9_x.sql` as text" — and I walked into it in SQL, where
a cast creates it silently.

## The break worth keeping

Break 5 is that bug, put back:

```text
 Tests  17 failed | 261 passed (278)
```

Seventeen now. Nine records got written before it bit the first time, which is what a test suite is
for: the suite finds it on the tenth record, and a deployment finds it on the tenth decision of the
day.

## Limits written down

| Here | Becomes |
| --- | --- |
| the in-process tests reach the application's account with `SET ROLE`, not a login | `audit.db.test.ts`, which needs a server. Run against a local PostgreSQL 17 on 2026-10-03: 4 passed, and 2 fail if the application is granted `UPDATE` |
| `theHead()` is computed on demand and stored nowhere | §30 says to anchor a checkpoint outside the control-plane store. `DSOR-AUD-04d` is not claimed |
| the **owner** can still do anything | the design, not a gap — migrations have to come from somewhere. The rule is met against the *application* |
| ~~`recorded_at` can be set on an INSERT~~ — superseded by [decision 81](decisions.md): `INSERT` is granted column by column and that column is left out | the application is refused, and a test checks every column of the table by name |
| `theLog()` is a plain function, and reading it writes nothing | `DSOR-AUD-05b`: reading audit must itself be authorized and audited |
| nothing deletes and nothing expires | `DSOR-AUD-05c`: retention is policy-controlled. "Forever" is not a policy |
| the invoices are still an array | step 10, which the map had in this step and [decision 69](decisions.md) moved |

## What is claimed

`DSOR-AUD-04a` for the account the application connects as, proven by running each forbidden statement
and requiring PostgreSQL to refuse it. `DSOR-AUD-02a` in the only sense available: the log is in
PostgreSQL and there is no agent memory for it to be in instead.

And `DSOR-EXE-02`'s *durably* half, which step 08 explicitly did not claim — demonstrated by running
`pnpm start` twice and watching 10 records become 20, with the chain verifying across a process that
no longer exists.

## The database tier, finally run

The four tests that need a real server were written and never executed — no Neon account, and signing
up for one is not something I can do. They do not need Neon, though: they need **a PostgreSQL with two
real logins**, and `brew install postgresql@17` provides that with no account at all.

```text
pnpm migrate   ->  applied 001_audit.sql
                   applied 002_runtime_user.sql
pnpm test:db   ->  Tests  4 passed (4)
```

The migrate line matters as much as the tests: it is the `pg` driver path, which PGlite cannot
exercise, running the migrations as the owner against a real server. That had never been executed
either, and [lesson 20](lessons.md) is about the cast in it that would have failed there and nowhere
else.

Then the check that makes the result worth anything — grant the application `UPDATE` on that server:

```text
 Tests  2 failed | 2 passed (4)
   AssertionError: promise resolved "Result{ command: 'UPDATE' …}" instead of rejecting
   AssertionError: expected [ 'DELETE', 'INSERT', 'SELECT', …(2) ] to deeply equal [ 'INSERT', 'SELECT' ]
```

**And one finding that mattered more than the tests.** The run printed:

```text
DEPRECATED  `test.poolOptions` was removed in Vitest 4.
```

So [decision 73](decisions.md)'s `singleFork` — the fix for a suite that gave a different answer every
run — **was never being applied**. The suite had been stable by luck. Both configs now use the
top-level option, there is no deprecation warning, and three consecutive runs give 278.

That is a shape worth remembering: a deprecation notice is not noise when the thing being deprecated
is a setting you are relying on. It had been in every run's output and I had been reading past it.

---

## The second pass, 2026-10-04: what a full test of the step found

The step was called complete on 2026-10-03 with 280 tests green. A full pass found **five broken
guarantees**, and the first of them reversed the "complete" claim outright. Everything below was
measured, and every fix was proved by breaking it again.

### 1 · The program connected as a superuser

The one that mattered most, because it made the step's whole claim false.

```text
PGlite connects as: postgres   superuser: true
  UPDATE    SUCCEEDED  <-- the route pnpm start, pnpm migrate and all 280 tests used
  DELETE    SUCCEEDED
  TRUNCATE  SUCCEEDED
```

`002_runtime_user.sql` takes those rights away from `dsor_runtime`, and the tests proved it — by
running `SET ROLE dsor_runtime` themselves. The program never did. 280 tests were green because not
one of them asked who the program had connected as; none contained the words `current_user`.

The real-server route was never affected: `DSOR_DB_URL` holds the application's own credentials.
[Decision 75](decisions.md), [lesson 21](lessons.md).

### 2 · A login whose Proxy trap throws

`Object.hasOwn` sat outside `ownString`'s `try`, and it consults a `Proxy`'s
`getOwnPropertyDescriptor`. So `callOperation THREW: boom` with **zero** audit records written — a
raw `Error` where `DSOR-ERR-01a` promises an envelope. [Decision 76](decisions.md),
[lesson 22](lessons.md).

### 3 · A lost race left the chain unverifiable for good

The clock was read before the tail, so an overtaken writer stamped an earlier time at a later
position:

```text
seq 0  at 2026-10-04T00:00:01.000Z  req_fast
seq 1  at 2026-10-04T00:00:00.000Z  req_slow
verifyChain: false
```

Nothing tampered with, every hash agreeing, and no way to correct it because the application has no
`UPDATE`. [Decision 77](decisions.md), [lesson 23](lessons.md).

### 4 · A lost INSERT reply was reported as a failed write

A database can commit and lose the reply. The caller was told the decision "could not be written
down, so it was not carried out" while the row sat in the table saying `ALLOWED` — the log and the
answer contradicting each other. [Decision 78](decisions.md), [lesson 24](lessons.md).

### 5 · A temp table could catch the whole audit log

`dsor_runtime` cannot `UPDATE` the log and can create a temporary table, and `pg_temp` is searched
before `public`:

```text
after one audit() call:  public.audit has 0 row(s),  pg_temp.audit has 1
theLog() reports 1 record(s)
```

The program reported a healthy audit trail while the real log stayed empty. A GRANT decides what may
be done to a table, not which table a name means. [Decision 80](decisions.md),
[lesson 26](lessons.md).

### And the claims that were simply false

- `recorded_at` was described as a column "the application cannot set", and the test with that title
  said the opposite in its own body. A `DEFAULT` is not a permission. Now true, by granting `INSERT`
  column by column. [Decision 81](decisions.md), [lesson 27](lessons.md).
- `UNIQUE (chain, sequence)` **is** an index, so `CREATE INDEX ... (chain, sequence)` was a second
  identical btree under a comment claiming reads would otherwise scan the table.
- The db-tier race test claimed to be the only place `UNIQUE (chain, sequence)` could be seen, and
  sent the same `record_id` three times — the primary key refused the losers, and dropping the unique
  constraint left the test green. [Decision 82](decisions.md), [lesson 28](lessons.md).
- A migration comment stated a false fact about PostgreSQL: that `REVOKE ... FROM PUBLIC` takes back
  a grant made directly to a role. It does not. [Decision 79](decisions.md).
- Three separate places read a grant catalogue to answer a security question. A catalogue row exists
  only for a grant made to a role **by name**; PUBLIC, role membership, column grants and superuser
  bypass are all invisible to it. [Lesson 25](lessons.md) is the general form.
- Every number in the README's Break-it section was stale, and Break 1's was wrong when it was
  written. All nine are now measured. [Decision 83](decisions.md), [lesson 29](lessons.md).

### The shape of it

Nine break-it exercises now, and **Break 6 — "let the program keep the owner's connection" — failed
zero tests before `test/database.test.ts` existed.** That is the lesson of the whole second pass: a
guarantee can be written in the spec, implemented in a migration, covered by nine tests, and held by
nobody, because every test set up the identity it then tested.

`pnpm check`: 23 files, **308 tests**. `pnpm test:db`: 5, against a real PostgreSQL with two real
logins. Both routes verify their chain: 10 records on the server, 10 on disk.

### Then the hostile review of the fixes

The `requirement-reviewer` pass over the eleven fixes above found six more broken guarantees, and
reproduced all of the ones it called live. The one that stings: the lost-reply recovery — written that
morning to make the log and the answer agree — ran its follow-up question on the connection that had
just died, so on the realistic case it did exactly what it was written to stop. And it asked a
question the hash cannot answer, so two decisions with the same bytes became one row.

Both fixed, with `OUTCOME_UNKNOWN` finally meaning something in this step; the step now claims
`DSOR-UNK-01b` for the one unknown it can produce. Plus: `at` normalised to the stored spelling, the
guard failing closed on NULL, the route pinned in `database.test.ts`, every table name in `src/`, `scripts/`, `migrations/` and `test/support/`
qualified, one door to the database and a test that counts them, a credential mask that does not leak
a password with `@` in it, and `forgetTheLog` erasing one chain rather than all of them.
[Decision 84](decisions.md), [lessons 30 and 31](lessons.md).

`pnpm check`: **315 tests**. `pnpm test:db`: 5. Nine break-it exercises, all re-measured.

### Does it run by itself? (2026-10-04)

The `build-baby-step` skill's last check: copy the folder outside the repository, with no
`node_modules`, no `.env`, no `.local-database`, and run it cold.

```text
pnpm install --frozen-lockfile   ->  Done in 305ms
pnpm check                       ->  Tests  314 passed | 1 skipped (315)
pnpm start                       ->  a PostgreSQL on disk at ./.local-database, as `dsor_runtime`
                                     20 records, chain verifies against the head: true
pnpm start (again)               ->  30 records, chain verifies against the head: true
pnpm test:db (no server)         ->  Tests  5 skipped (5)
```

The one skip is `audit.test.ts`'s "the schema is byte for byte the specification's own", which
compares the step's copy of `audit-record.schema.json` with the repository's and has nothing to
compare against outside it. It skips with its name in the report rather than passing quietly, which
is the design — and the README's `pnpm check` line now says so, because "315 tests" was true only
inside the repository.

### And the pass over the pass

Four reviewers in parallel, then a critic asking what none of them had looked at. The critic's
answer: the real-server branch of `openTheDatabase` — the route the step is named after — had been
executed by **no test on either tier**, and deleting its refusal failed nothing. It fails one of seven
now. Three reviewers independently found `main.test.ts` spawning the demo with the inherited
environment, so an exported `DSOR_DB_URL` made `pnpm check` write into a real server. And the
recovery written the day before was wrong twice more: it could not tell its own row from an identical
one, and it could not tell a server's "no" from a connection that went quiet.
[Decision 85](decisions.md), [lessons 32 and 33](lessons.md).

`pnpm check`: **322**. `pnpm test:db`: **7**. Nine break-it exercises, re-measured, Break 1 in both
placements. Runs by itself from a clean copy, with one named skip.

### "Fix everything before step 10"

The two routes limit 3 said the check would not notice — a `SECURITY DEFINER` function, a trigger —
became checks, each measured open first. `theHead` stopped inventing an empty log for a store that
answers nothing. And the real server answered the one measurement every in-process run could only
guess at: a collision of the program's own row shape is `audit_pkey`, and three writers on three real
connections leave one verifying chain. [Decision 86](decisions.md), [lesson 34](lessons.md).

`pnpm check`: **326**. `pnpm test:db`: **9**. Two open questions closed by measurement; one — the
time check under clock skew — left for the learner to decide.
