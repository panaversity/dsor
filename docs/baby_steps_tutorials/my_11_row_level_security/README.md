# Step 11 · Row-level security

**New in this step:** a second lock. PostgreSQL itself hides every other company's rows, so a query
that forgets the company still cannot leak.

## In plain words

Step 10 kept the two companies apart with one thing: the program. Every query says
`WHERE tenant_id = $1`. That is one lock, and the program holds it alone. If one query forgets the
`WHERE`, nothing else stops the leak, and no test notices, because the tests only check the queries
that exist today.

**Row-level security** is a lock inside the database. A *policy* on a table says which rows a
statement may see and which it may write. This step puts one policy on the invoices and one on the
audit log: a row is visible, and may be written, only when its company is the one the current
transaction said. A statement that said no company gets no rows at all.

For that to work, the program has to tell PostgreSQL which company each statement is for, and it
has to say it in a way that cannot outlive the statement. Three traps come with that, and the map
named all three:

- **The table owner skips the policy** unless the table says `FORCE ROW LEVEL SECURITY`. Here it
  says it.
- **A setting made per connection leaks.** A pool hands the same connection to the next statement
  that asks, whoever it is for. So the company is said *per transaction*: every statement runs in a
  small transaction of its own that first says the company, and the setting dies with it.
- **On Neon, a user made in the Console belongs to `neon_superuser`**, which holds `BYPASSRLS`, a
  role property that makes PostgreSQL skip every policy. Measured: the member is still filtered,
  because PostgreSQL passes no role property through membership — and it is one
  `SET ROLE neon_superuser` away from not being. The program refuses to start as such an account,
  and names the role in the refusal.

What this step does **not** do: it does not replace step 10. §36 says it in one line — row-level
security is defense in depth, and it does not replace DSoR authorization. The lock is for the
statement that said **no** company. A statement that said the **wrong** company gets that company's
rows: the policy trusts whatever the transaction said, and who may say which company is step 10's
job, decided in the pipeline from who is logged in. The program still decides who may do what; the
database now refuses to show a row to a statement that never said whose rows it wanted.

## Why it matters

Measured on step 10's own database, as `dsor_runtime`, the day before this step:

```text
running as: dsor_runtime
-- a query that forgot the company: SELECT … FROM invoices WHERE id = 'INV-1008'
   org_456  INV-1008  31400.00  issued
   org_789  INV-1008  18000.00  draft
```

One missing `WHERE`, and `org_456`'s program is holding `org_789`'s invoice. Step 10's 376 tests
were green, because every query they test has its `WHERE`. The query that leaks is the one somebody
writes next year, and §14 calls that leak the kind of bug that ends a product. Here it is run again,
through this step's program, in **Run it** below: one row.

## What changed since step 10

```bash
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_10_tenants ../my_11_row_level_security
```

| File | What |
| --- | --- |
| `migrations/005_row_level_security.sql` | new — the lock: `ENABLE` and `FORCE` row-level security and one policy on `public.invoices` and on `public.audit`; and a `CHECK` that a record's chain names its own company |
| `src/store.ts` | `theDatabase(tenant)` requires the company, and every statement runs through `Database.query(sql, params, tenant)` |
| `src/database.ts` | two adapters, `overPGlite` and `overPool`, that run a statement with a company inside its own transaction after `set_config('dsor.tenant_id', $1, true)`; the start-up check asks seven new questions, three of them after the hostile review |
| `src/invoice.ts`, `src/audit.ts` | every statement names the company it is for. The SQL itself is unchanged |
| `src/main.ts` | the forgotten query, run through the program's own connection |
| `test/support/database.ts` | the tests run the stores as `dsor_runtime`, and two seams step up to the owner and back to whoever called: `asTheOwner`, and the eraser `forgetTheLog` |
| `test/the-company-is-said.test.ts`, `test/row-level-security.test.ts`, `test/the-lock-at-start-up.test.ts`, `test/pool.db.test.ts` | new |
| `test/database.test.ts`, `test/audit-permissions.test.ts`, `test/audit.test.ts`, `test/invoices-in-postgres.test.ts`, `test/audit.db.test.ts` | sixteen tests that ran raw SQL as the application without saying a company went red when the lock arrived. They say it now, or run as the owner |
| `test/audit-lost-reply.test.ts`, `test/audit-race.test.ts`, `test/audit-per-tenant.test.ts` | every fake database forwards the company to the real one, and the first two now build their database through the support, as the application — an evaluation found them running the stores as the superuser, so the company their fakes forwarded was enforced nowhere |
| `test/pool-adapter.test.ts`, `test/one-connection.test.ts`, `test/commit-dies.db.test.ts` | new, after the evaluation: the pool adapter under the unit suite, PGlite's one connection measured, a connection that dies during `COMMIT` on a real server |
| `scripts/door.ts` | new — the program's door opened on a throwaway database, for the Break-it blocks below |
| `vitest.config.ts`, `vitest.db.config.ts`, `tsconfig.json` | `singleFork`, which Vitest 4 does not have, becomes `fileParallelism: false`, and the configs are typechecked so a dead option cannot hide again |
| everything else | a `NEW IN STEP 10` marker becoming `STEP 10`, and the comment markers the merged branch added to step 10 |

376 tests became 412, and the database tier's 9 became 16. The sixteen tests that went red are the
step's first lesson: every one of them was a statement that never said whose rows it wanted, which
is exactly what the lock exists to stop. Six of the 412 came from the hostile review, which found
three windows past the lock that the first start-up check could not see; Breaks 11 to 13 are those.
Twelve more, and three in the database tier, came from an independent evaluation after it — four
reviewers, a mutation pass, a critic — and Breaks 14 to 17 are what it found.

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step:

```text
A forgotten WHERE, caught by the second lock:

  SELECT tenant_id, id, amount_value::text AS amount, status FROM public.invoices WHERE id = $1
  for org_456:      org_456  INV-1008  31400.00  issued
  no company said:  (no rows)
```

That is the query from **Why it matters**, run through the program's own connection — which is
`dsor_runtime`, under the policies. It has no `WHERE tenant_id`. For `org_456` it gets `org_456`'s
row and not `org_789`'s. With no company said it gets nothing, which is the safe answer to a
forgotten company. Both answers are PostgreSQL's, not this program's.

Everything step 10 printed still prints, unchanged: the two companies, the four refusals, one audit
log per company, `org_456: 15 records` and `org_789: 2 records`, both chains verifying. Run it
again and the invoice is `CONFLICT`, the logs 30 and 4.

### The database tier

`pnpm check` needs no server; the tests that need a database use PGlite, PostgreSQL compiled to
WebAssembly, in-process. The sixteen tests in `pnpm test:db` need two real logins and a database of
this step's own — the migrations are checksummed, and this step has five. Copy step 10's `.env`
and change the database name in both URLs:

```bash
cp ../my_10_tenants/.env .env     # then dsor_step10 -> dsor_step11 in both lines
pnpm migrate && pnpm test:db
```

Two things found live. A migration's checksum covers its comments: edit one word of a comment in
`005_row_level_security.sql` after it was applied and `pnpm migrate` refuses, by design — drop and
recreate the step's database. And a cluster in `/tmp` does not survive: macOS purges files there
that nobody has touched for a few days, and the data directory step 09's README puts there came
back as "not a database cluster directory". Rebuild it with the same four commands.

**On Neon**, keep creating `dsor_runtime` the way step 09's README does, in the SQL editor with
`CREATE ROLE`. A role made in the Console instead is a member of `neon_superuser`, which holds
`BYPASSRLS`, and this step's program refuses to start as it:

```text
this connection is `dsor_runtime`, a member of `neon_superuser`, which holds BYPASSRLS — one SET
ROLE away from skipping every row-level policy. On Neon, a role made in the Console is a member of
neon_superuser; create `dsor_runtime` with SQL instead, and revoke the membership.
```

## Break it

Seventeen, measured. The first is the map's own exercise, through the program's door; 11 to 13 are
the hostile review's, 14 to 17 the evaluation's. The counts are what `pnpm test` prints on the full
suite of 412 with the files running one at a time, each measured twice with the two runs agreeing;
Break 9 and the second half of Break 5 are what `pnpm test:db` prints on 16; Break 10 is not a
count. The "as dsor_runtime" lines in Breaks 1 and 11 to 13 are what `node scripts/door.ts <folder>`
prints for a folder prepared as the owner, and the leak lines before them are what the matching
test in `the-lock-at-start-up.test.ts` measures before it asks the check.

### Break 1 · give the application BYPASSRLS

The map says: connect as the owner and watch every policy do nothing. On the two routes this
tutorial runs on, the owner is a superuser, and step 09's program already refuses to start as one —
a superuser may `UPDATE` the log. (On Neon the owner is not a superuser; it is filtered by `FORCE`
until it runs `SET ROLE neon_superuser`, and the program refuses it either way.) So this step's
version is the sharper one: an account that may do *nothing extra* and skips the lock anyway. As the owner, `ALTER ROLE dsor_runtime BYPASSRLS`. Then
open the program's own door:

```text
opened a PostgreSQL on disk, as dsor_runtime
for org_456:      org_456
no company said:  (no rows)

-- as the owner: ALTER ROLE dsor_runtime BYPASSRLS

refused to start: this connection is `dsor_runtime`, which holds BYPASSRLS: PostgreSQL skips every
row-level policy for it, and the second lock does nothing. ALTER ROLE dsor_runtime NOBYPASSRLS, or
point DSOR_DB_URL at an account without it.
```

Now remove the guard — in `src/database.ts`, change `if (second?.bypasses !== false)` to
`if (false)` — and open the door again:

```text
-- as the owner: ALTER ROLE dsor_runtime BYPASSRLS

STARTED
for org_456:      org_456, org_789
no company said:  org_456, org_789
```

Every privilege check of step 09 still says "may not", and both companies come back. On the full
suite, the guard removed is `Tests  1 failed | 411 passed (412)`: one test, the one that measured
the leak first and then asked for the refusal.

### Break 2 · do not force the lock

In `migrations/005_row_level_security.sql`, delete `ALTER TABLE public.invoices FORCE ROW LEVEL
SECURITY;`.

```text
 Tests  22 failed | 390 passed (412)
```

One test is the owner's: it hands the table to an owner that is not a superuser and asks as it,
and without `FORCE` that owner sees every row. The other twenty-one are the program refusing to
start — the start-up check asks whether the lock is on, enabled *and forced* with a policy, on both
tables, and every test that opens the program's own door is refused with "the second lock is not
on". A lock the program relies on is checked, not assumed.

### Break 3 · a policy that lets everything through

In the same file, change the invoices policy's `USING (tenant_id = current_setting(…))` to
`USING (true)`.

```text
 Tests  29 failed | 383 passed (412)
```

Seven are the lock's own tests. The rest are the door again: since the review, the start-up check
asks for exactly the policy the migration wrote, and this is not it.

### Break 4 · no policy on the audit log

Delete the `CREATE POLICY tenant_isolation ON public.audit …` statement, leaving the table with
row-level security enabled and no policy.

```text
 Tests  147 failed | 265 passed (412)
```

Not eight, and the reason is worth knowing: a table with row-level security on and no policy
shows nothing and accepts nothing. Every decision the program tries to record is refused, so every
request through the pipeline fails with `EVIDENCE_STORE_UNAVAILABLE`. The lock fails closed.

### Break 5 · say the company per connection

In `src/database.ts`, in `overPGlite`, change `set_config('dsor.tenant_id', $1, true)` to
`… false)`. `false` means "for this session", and a session outlives a request.

```text
 Tests  2 failed | 410 passed (412)
```

One is "the company is gone when the statement is done"; the other is the one-connection test,
whose plain statement now reads the company the session kept. The same change in `overPool`,
against a real pool in the database tier, is `Tests  1 failed | 12 passed (13)` — and the test
before it in `pool.db.test.ts` demonstrates the leak on purpose, on a real connection, so that this
one is not testing nothing.

### Break 6 · an adapter that forgets the company

In `overPGlite`, make every statement run plainly: change `tenant === undefined ? …` to
`true ? …`.

```text
 Tests  145 failed | 267 passed (412)
```

### Break 7 · the same, with the tests as the superuser

Keep Break 6, and in `test/support/database.ts` replace both `SET ROLE ${APPLICATION_ROLE}` with
`RESET ROLE`, so the tests run the stores as PGlite's `postgres`.

```text
 Tests  50 failed | 362 passed (412)
```

Read the two numbers together. The store is broken the same way in both runs. As the application,
145 tests say so. As the superuser, 50 do — the lock's own tests, the program's door, and the
tripwire that `audit-lost-reply` and `audit-race` carry since the evaluation, which refuses to run
their tests as anyone but the application — and **not one store assertion is among them**:
`invoices-in-postgres.test.ts`, `cross-tenant.test.ts`, `audit.test.ts` all stay green, because a
superuser skips every policy and the tests cannot see what the lock would have hidden. That is why the test support drops to `dsor_runtime`, the way the
program's door does, and why the two seams that need the owner step up for exactly as long as they
need.

### Break 8 · remove the lock-is-on question

In `src/database.ts`, change `if (second.locked !== true)` to `if (false)`.

```text
 Tests  5 failed | 407 passed (412)
```

The three tests that turn the lock off and expect a refusal, and the two that add a policy beside
it. Early runs of this break said 6, then 3, then 5, and the README said "one measurement is not a
fact" without knowing why the numbers moved. The reason is **Tested beyond the tests** below: the
files were running in parallel. With them one at a time, every count on this page came out the
same in two runs.

### Break 9 · run the statement outside its transaction

In `overPool`, delete the `BEGIN` and `COMMIT` lines, so the company is said on the connection and
the statement follows it as a separate transaction. Database tier:

```text
 Tests  6 failed | 7 passed (13)
```

The `true` in `set_config` means "until this transaction ends", and with no transaction open, that
is immediately: the statement that follows has no company, gets no rows, and may write nothing.

### Break 10 · make the member a bypasser

In `test/the-lock-at-start-up.test.ts`, the Neon test expects a member of `neon_superuser` to still
be filtered, and to see both companies only after `SET ROLE neon_superuser`. Change the first
expectation to `["org_456", "org_789"]`, which is what the map's wording would predict.

```text
AssertionError: expected [ 'org_456' ] to strictly equal [ 'org_456', 'org_789' ]
```

That is the output of the first version of this test, before it was corrected by measuring.
`BYPASSRLS` is a role *attribute*, and PostgreSQL passes privileges through membership and never
attributes. The member is filtered until it becomes the role — which it can, in one statement, and
which is exactly step 09's `editor` hole again. The start-up check refuses the membership, by name.

### Break 11 · a second policy, wide open

As the owner, `CREATE POLICY wide_open ON public.invoices USING (true)`. Policies are permissive
and OR'd together, so the lock is gone — while "is there a policy", which the first version of the
start-up check asked, still says yes. Measured as the application, then through the door:

```text
-- a second policy, wide open
   as dsor_runtime, no company said: org_456, org_789
   refused to start: the second lock is not on: public.invoices and public.audit must each have
   row-level security enabled, forced, and exactly the one policy
   migrations/005_row_level_security.sql writes — no other policy beside it, and none that reads
   differently.
```

In `src/database.ts`, delete the line `AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid =
c.oid) = 1` and the check is back to "is there one": `Tests  2 failed | 18 passed (20)` in the two
lock files, the wide-open policy and the `TO dsor_runtime` one.

### Break 12 · a helper whose owner skips the lock

Step 09 refuses a `SECURITY DEFINER` function whose owner may rewrite the log. This one's owner may
not; it holds `SELECT` and `BYPASSRLS`, and the helper reads every company's rows for whoever may
call it.

```text
-- a SECURITY DEFINER helper owned by a BYPASSRLS role
   as dsor_runtime, no company said: org_456, org_789
   refused to start: this connection is `dsor_runtime`, and it may EXECUTE a SECURITY DEFINER
   function whose owner may UPDATE, DELETE, TRUNCATE the audit table, or skips the row-level lock —
   a rewrite or a read by proxy. Drop the function or revoke EXECUTE on it from `dsor_runtime` and
   PUBLIC.
```

Narrow the owner question back to step 09's — replace the `OR EXISTS (SELECT 1 FROM pg_roles o …
rolbypassrls)` clause with `OR false` — and it is `Tests  1 failed | 19 passed (20)`.

### Break 13 · a view the owner made

```text
-- a view the owner made
   as dsor_runtime, no company said: org_456, org_789
   refused to start: this connection is `dsor_runtime`, and it may read `public.all_invoices`,
   which is not one of the two tenant tables. A view or a table beside them is a window past the
   lock: a view runs with its owner's rights, and a table without a policy hides nothing. The
   application may read public.invoices and public.audit, and nothing else.
```

A view runs with its owner's rights unless it was created `WITH (security_invoker = true)`, and
every owner here skips the lock. Rather than list the shapes a window can take, the check asks what
the application may `SELECT` at all, and the answer has to be the two tenant tables — a view of
either kind is refused. Change `if (second.reads_beyond !== null)` to `if (false)`:
`Tests  1 failed | 19 passed (20)`. The cost is deliberate — a later step that adds a table the
application reads must add it here, or the program refuses to start.

### Break 14 · a trigger on the invoices

Step 09 asked about triggers on the audit table. An evaluation put one on the invoices: a
`SECURITY DEFINER` function, its `EXECUTE` revoked from everyone, fired `BEFORE UPDATE`. The
application's own ordinary statement — issue `org_456`'s draft — came back with every company's
invoices written into a column, and the check said the lock was on. The test
`a trigger on the invoices smuggles every company out through the application's own UPDATE`
measures that first. The helper question refuses that one on its own now, since its function's
owner is a superuser. The trigger question's own case is a plain trigger — no `SECURITY DEFINER`,
an owner that holds nothing — that changes what the application wrote: `org_456`'s draft, issued
by the application, lands as `paid`. Only a question about triggers can see it, and it asks about
both tenant tables now. Narrow it back to `public.audit` alone: `Tests  1 failed | 16 passed (17)`
in `the-lock-at-start-up`.

### Break 15 · a helper reached without EXECUTE

The first fix asked whether the application may `EXECUTE` the helper. Two ways round that,
measured: an aggregate whose transition function is the helper, and `EXECUTE` granted to a role
the application is a member of `WITH INHERIT FALSE`. Put `AND has_function_privilege(current_user,
p.oid, 'EXECUTE')` back into the helper question: `Tests  2 failed | 15 passed (17)`. The helper is
refused for existing now, whoever may call it.

### Break 16 · the demo's two lines, inverted

In `src/main.ts`, pass no company on the `for org_456` line and `"org_789"` on the `no company
said` line. `pnpm start` then prints the opposite of **Run it** — `(no rows)` for `org_456` and
`org_789`'s invoice for "no company" — and before the evaluation, `test/main.test.ts` passed 9 of 9
against it. The README's headline block was pasted output with nothing behind it. One test pins the
two lines now: `Tests  1 failed | 9 passed (10)`.

### Break 17 · the pool adapter, under the unit suite

`overPool` is the adapter the program uses against a real server, and `pnpm test` runs on PGlite,
so it never executed it. A mutation pass measured two survivors: skip the `ROLLBACK`, or say the
company for the session instead of the transaction, and every unit test passes. The database tier
catches both, and CI never runs the database tier. `test/pool-adapter.test.ts` drives the adapter
against a stub pool that records every statement and how the connection comes back; the skipped
`ROLLBACK` is now `Tests  2 failed | 2 passed (4)`, the session-scoped company `1 failed | 3 passed`.

Restore each break and confirm `pnpm check` prints `412 passed` again.

## Build it yourself with Claude Code

Copy `my_10_tenants` to a new folder and ask:

> Start step 11, row-level security. Before any code: run a query that forgets the company against
> step 10's database, as the application, and show me what comes back. Then ask me, one at a time,
> which tables get the lock, when the program tells PostgreSQL the company, and what the demo should
> show. Then build it a piece at a time, red first, and break each piece on purpose — including the
> blind spot: what the tests see when they run as the superuser.

## Check yourself

1. Step 10 already kept the companies apart. What does this step add that step 10 could not have?
2. The company is said with `set_config('dsor.tenant_id', $1, true)`. What does the `true` mean, and
   what goes wrong with `false`?
3. Two of the three table owners here are superusers, and a superuser skips every policy whatever
   the table says. Why is `FORCE ROW LEVEL SECURITY` in the migration anyway?
4. `dsor_runtime` holds no `UPDATE`, no `DELETE`, no `INSERT` it should not, and every privilege
   check says so. How can it still see every company's rows, and what does the program do about it?
5. Sixteen tests went red the moment the lock arrived. What did they have in common?

<details>
<summary>Answers</summary>

1. A lock that holds for the query nobody has written yet. Step 10's `WHERE` is in the queries that
   exist; the policy is on the table, so a statement that forgets the company gets one company or
   nothing, whoever wrote it. `DSOR-TEN-01b` asks for two independent layers for exactly that
   reason.
2. "Until this transaction ends" — the setting is transaction-local (`DSOR-RP-01c`). With `false`
   it lasts for the session, and a pooled session is handed to the next statement that asks,
   whoever it is for: `pool.db.test.ts` shows a later statement with no company reading `org_456`'s
   rows.
3. Because the rule says so (`DSOR-RP-01b`); because an owner that is not a superuser is filtered
   only with it — the test hands the table to one, and Neon's `neondb_owner` is one, a member of
   `neon_superuser` rather than a superuser itself; and because the start-up check asks for it:
   without `FORCE`, the program refuses to start.
4. `BYPASSRLS` is a property of the role, not a right on a table, so no privilege check sees it.
   The start-up check asks PostgreSQL directly whether the account holds it, and whether it is a
   member of a role that does — `neon_superuser`, on Neon — and refuses to start either way.
5. Every one ran raw SQL as the application without saying whose rows it wanted. The lock answered
   them the way it answers a forgotten `WHERE`: no rows, or a refused write. They say the company
   now, or run as the owner through `asTheOwner`.

</details>

## The rules this step meets

- **[DSOR-TEN-01b · L1]** Tenant isolation MUST be enforced in at least two independent layers:
  DSoR core, and the connector or store. The first layer is step 10's, the `WHERE` in every store
  statement. The second is the policy on each table, and it is independent: the tests for it go
  underneath the stores with raw SQL and no `WHERE`. One honest limit the review found: the audit
  policy binds a record's `tenant`, not its `chain`. A `CHECK` that the chain names the row's
  company closes the gap the policy cannot see, and the migration's comment now says what the
  policy checks and no more.
  ([§36](../../../specs/dsor/05-bindings.md#36-postgresql-reference-connector))
- **[DSOR-RP-01a · RP]** `dsor_runtime` MUST NOT be a superuser, hold `BYPASSRLS`, or own tenant
  tables. The start-up check asks for `BYPASSRLS`, for membership of a role that holds it, and for
  ownership of a tenant table or membership of its owner. **The superuser half is step 09's**: a
  superuser may `UPDATE` the log, and the privilege check refuses it before this step's questions
  are reached — so the new check does not look at `rolsuper`, and a test says so. After the
  review, the same question is asked of what the account can *reach*: a `SECURITY DEFINER` helper
  whose owner skips the lock, and any relation beside the two tenant tables that the account may
  `SELECT` — a view runs with its owner's rights, and every owner here skips the lock. An
  evaluation then reached the helper three ways round "may the account EXECUTE it" — through an
  aggregate, through a membership, through a trigger on the invoices — so the helper is refused
  for existing, whoever may call it, and a trigger on either tenant table is refused.
  **The check is an enumeration**, and the README says so rather than let it read as a proof: it
  asks about the shapes measured so far, and a shape nobody has measured yet is not on its list.
  Step 16 builds the map of DSoR's own store that a start-up check can be held against; until
  then this check is the list of what three reviews found.
- **[DSOR-RP-01b · RP]** Tenant tables MUST use `FORCE ROW LEVEL SECURITY`. Both do, the test proves
  it with an owner that is not a superuser, and the start-up check refuses a database where it is
  not on — or where the policy is not exactly the one the migration wrote, alone. Policies are
  permissive and OR'd together, so a second one that says `true` opens the table while "is there a
  policy" still says yes; the review measured it, and the check compares the expressions as
  PostgreSQL prints them back.
- **[DSOR-RP-01c · RP]** The tenant setting MUST be transaction-local. Said per statement, inside
  that statement's own transaction, on PGlite and on a real pool.
- **[DSOR-RP-01d · RP]** A query executed with no tenant setting MUST yield no rows. On both
  tables, as `SET ROLE dsor_runtime` in-process and as the real login on a server. One honest
  addition: the stores cannot even *send* such a query, because `theDatabase(tenant)` refuses an
  empty company — the database's "no rows" would come back as a tidy "not found" and hide a wrong
  program.

**The map and a measurement disagreed.** The map says a Console-made Neon user belongs to
`neon_superuser`, "which ignores row-level security altogether". The role does. The member does not,
until it runs `SET ROLE neon_superuser`: PostgreSQL passes privileges through membership and never
role attributes, and `BYPASSRLS` is an attribute. Measured on PGlite, which runs PostgreSQL's own
rules. The map's instruction stands — create `dsor_runtime` with SQL — and the program refuses the
membership whether or not the member has used it. Decision 95 in `my_notes` records it.

**What §36 shows and this step leaves.** The example in §36 also sets `dsor.principal_id` per
transaction. No rule names it, nothing here reads it, and a setting nobody reads is a line no test
can kill; it joins the program when a policy or a trigger needs the principal.

**Tested beyond the tests.** Four things were measured because a review listed them as untested.
A connection that dies during `COMMIT`, on a real server: the recovery finds the row by looking, a
connection that then stays dead gets `OUTCOME_UNKNOWN` with the row still there, and the connection
handed back carries no company (`commit-dies.db.test.ts`). PGlite's one connection: a plain
statement issued while another company's transaction is open cannot slip inside it
(`one-connection.test.ts`). The cost of a transaction per statement, 300 statements each way:

| Where | plain statement | through the adapter |
| --- | --- | --- |
| PGlite, in-process | 0.103 ms | 0.275 ms |
| PostgreSQL 17, local socket | 0.083 ms | 0.126 ms |

And the test runner itself: `singleFork` is not an option Vitest 4 has, so the files had been
running in parallel since step 09, which is what every "different failure each run" was. Measured
on this suite before the fix: 2 failed of 401 in 29 seconds, two demo tests timing out on PGlite's
lock; after it, every test passes in about 95 seconds, three times. Neon itself was not measured;
everything ran on a local PostgreSQL 17 and on PGlite.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-TEN-02b` | A cross-tenant test suite over every operation. `cross-tenant.test.ts` still covers `invoice.get` by hand; the generated suite is step 12. |
| `DSOR-TEN-01c` | Isolation must not depend on agent behaviour or prompts. Held by every step, claimed by none. |

Everything earlier steps claimed still holds. Three things about the tests are worth knowing: they
run the stores as `dsor_runtime` now, which Break 7 says why, and after the evaluation that includes
the two step 09 files that built their own database; the eraser `forgetTheLog` that tests import
comes from `test/support/database.ts`, because the one in `audit.ts` runs as whoever is connected,
and that is no longer someone who may `DELETE`; and `vitest.config.ts` is typechecked now, which is
how a dead option was caught — steps 09 and 10 still carry it, reported rather than edited from
here.

**Next:** step 12, `cross_tenant_test_suite` — one generated test that calls every operation with
another company's address, and grows by itself each time an operation is added.
