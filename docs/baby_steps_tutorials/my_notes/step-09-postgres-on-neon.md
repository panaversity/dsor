# Step 09 · PostgreSQL on Neon

Folder: [`my_09_postgres_on_neon`](../my_09_postgres_on_neon/README.md) · 278 tests, plus 4 in the
database tier
Spec: [§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) · `DSOR-AUD-04a`,
`DSOR-AUD-02a`
Both tiers have run: 278 under `pnpm check`, and 4 under `pnpm test:db` against a real server.
Decisions [67 to 74](decisions.md). Lesson [20](lessons.md).

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
| `recorded_at` can be set on an INSERT; what makes the gap evidence is that the writer never does | a test says this plainly rather than implying the column is protected |
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
