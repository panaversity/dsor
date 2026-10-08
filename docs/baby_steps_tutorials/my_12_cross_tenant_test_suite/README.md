# Step 12 · Cross-tenant test suite

**New in this step:** one generated test that calls **every** operation with another company's
address, and grows by itself each time an operation is added.

## In plain words

Step 11 keeps the companies apart with two locks, and `cross-tenant.test.ts` proves it — for the
two operations that exist, by hand. Nothing ties that file to the list of operations. The day a
third operation is added, it is tested only if somebody remembers.

This step adds a test that nobody has to remember. It reads the **registry**, the list of every
operation and its contract, and for each one it asks the same six questions:

1. Called with another company's address, is it refused with `TENANT_MISMATCH`, retry `never`?
2. Is the refusal the same, *whole*, for a company that exists and one that does not — not the
   words only, but everything the envelope carries — and does it say nothing about your company?
3. Does the other company hold every invoice number the example names, and for a command, in the
   same state as yours — so that a careless write would have something to do?
4. After the call, are the other company's rows exactly as they were?
5. Did the request leave exactly one decision in the caller's log, the `DENY`, and none in the
   other company's?
6. Does the same request work for its own company — so the refusals above are about the address —
   and does the answer carry nothing of the other company?

And two questions of the suite itself, asked once: does the registry hold at least one operation,
and are the three companies what the questions assume — `org_789` real, `org_000` not? A registry
with none would register nothing above and look like a passing file; a third real company would
turn question 2 into a comparison of two real refusals.

To ask those questions of an operation nobody has written yet, the suite needs to know what request
that operation takes. The answer lives with the operation: each contract carries one **example
request** under its `extensions` field, with the key `com.panaversity.tutorial` — the one place the
specification's schema lets a contract carry something of its own. Step 03 taught and tested that
key on a made-up contract; these are the first shipped contracts that carry one. The suite takes the example,
moves every address in it from `org_456` to `org_789`, and calls. An operation whose contract has
no example does not get skipped. It gets a failing test with its name on it.

So what grows by itself is the *asking*: six questions and one demo line per operation, with no
edit to any test. Be exact about what still needs a human when an operation is added, because
"grows by itself" is easy to over-read: the contract file, its line in `contractsFromDisk`, its
handler, the example request, and a row in the other company for every invoice number the example
names. The suite fails by name until the last two are there, and `main.test.ts`'s record counts
move with every operation, since each refusal is a decision.

What the suite is for, said plainly: it is the net under the two locks. Step 10's §21.6 scan reads
only the top-level string arguments of a request, and step 11's lock trusts whatever company a
statement says. A handler that reads an address from somewhere the scan does not look, and asks the
store for the company *the address* names, slips both. **Why it matters** shows it happening.

## Why it matters

Measured on a copy of step 11, the day before this step. A third operation, written the careless
way: the address nested inside an argument, and the store asked for the company the address names
rather than the request's.

```text
step 11's cross-tenant suite, on the three-operation program:   Tests  12 passed (12)

user_123 of org_456 asks invoice.vendor for org_789's invoice:
   handed: dsor://org_789/invoice/INV-1008  VENDOR-44  18000.00 USD
```

The suite stayed green and the invoice leaked. Some other tests did fail — the ones that count the
operations — and a learner fixes a count in a minute. Nothing asked the new operation whether it
keeps companies apart. §14 calls a leak between customers the kind of bug that ends a product, and
`DSOR-TEN-02b` is the rule that says the question must be asked of every operation, by a suite that
ships with the implementation.

## What changed since step 11

```bash
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_11_row_level_security ../my_12_cross_tenant_test_suite
```

| File | What |
| --- | --- |
| `src/contracts/invoice.get.json`, `src/contracts/invoice.issue.json` | each carries an example request under `extensions["com.panaversity.tutorial"]` |
| `src/registry.ts` | `exampleRequestOf`: reads that one key, and only an object |
| `src/examples.ts` | new — `addressesIn` and `movedTo`, the two things a test does with an example, in one place for the suite and the demo |
| `test/support/cross-tenant-suite.ts` | new — the suite, as a function: one `describe` per operation in the registry, six questions each, written once; the questions are plain functions a test can lie to |
| `test/cross-tenant-suite-itself.test.ts` | new — each question fed an honest answer and then the lie it exists to catch; delete an assertion from a question and its lie passes here |
| `test/cross-tenant-suite.test.ts` | new — the suite on PGlite, under `pnpm check` |
| `test/cross-tenant-suite.db.test.ts` | new — the suite against the database `.env` names, under `pnpm test:db` |
| `test/example-requests.test.ts` | new — every contract has an example, every example's addresses are in `org_456`, the reader takes the one key and ignores others |
| `migrations/004_running_example.sql` | `org_789` gains `INV-1009`, so a careless command has a row to touch, and `INV-2001`, a number `org_456` lacks |
| `test/invoices-in-postgres.test.ts` | the "not in yours" test asks for `INV-2001` now, since `INV-1009` is in both companies |
| `src/main.ts` | a section that walks the registry the same way, one line per operation |
| `test/main.test.ts` | those lines pinned; the record counts move by two |
| everything else | a `NEW IN STEP 11` marker becoming `STEP 11` |

412 tests became 444, and the database tier's 16 became 30. The hand-written `cross-tenant.test.ts`
from step 10 stays: it carries what the generated suite does not ask — the agent who works for
both companies, the nested-argument limit, a door built with a forgetful validate stage.

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step:

```text
Every operation, with another company's address:

invoice.get    user_123              TENANT_MISMATCH          retry: never                dsor://org_789/invoice/INV-1008 is not an address in your company
invoice.issue  user_123              TENANT_MISMATCH          retry: never                dsor://org_789/invoice/INV-1009 is not an address in your company
```

Two lines because the registry holds two operations. Neither is named in `main.ts`; the loop reads
the registry, takes each contract's example, moves its addresses to `org_789`, and calls. Add an
operation and this prints three lines. Those two refusals are decisions, so the logs grow by them:
`org_456: 17 records` on a fresh run, `34` on the second; `org_789` stays at `2` and `4`. One
thing found by two reviewers running the suite at once: the demo builds its PostgreSQL on disk in
this folder, and a second process using the folder at the same time — another `pnpm test`, another
`pnpm start` — can fail `main.test.ts`. Run it alone.

### The database tier

`pnpm check` needs no server. The twenty-eight tests in `pnpm test:db` — step 11's sixteen and this
step's twelve — need two real logins and a database of this step's own. Copy step 11's `.env` and
change the database name in both URLs:

```bash
cp ../my_11_row_level_security/.env .env     # then dsor_step11 -> dsor_step12 in both lines
pnpm migrate && pnpm test:db
```

This folder's own run was on Neon: `neonctl databases create --name dsor_step12`, a `GRANT CONNECT`
through the owner's connection, five migrations, `30 passed`. Two things to know. This step changes
`004_running_example.sql`, and a migration's checksum covers every byte of it, so a database that
applied step 11's version refuses step 12's; a database of the step's own is the answer, as it was
for step 11. And the generated suite, in this tier, deletes every invoice and every audit record
that belongs to `org_456` or `org_789` in the database `.env` names before each question, and puts
the story back afterwards — point it at a step-12 database only, never at one whose rows you want to
keep.

## Break it

Sixteen, measured twice on the full suite with the files one at a time, both runs agreeing. The counts
are from a copy outside the repository, where one test skips because the specification is not
beside it, so the total reads `428` with `1 skipped`; in the repository it is `428 passed`. The
first three are the map's own exercise — *adding a new operation without tenant checks makes this
suite fail* — done three ways. Each adds a contract file, a line in `contractsFromDisk`, and a
handler, which is why their totals are larger: the suite grew by six questions for the newcomer.

### Break 1 · a careless third operation

`invoice.vendor`: a query whose address sits inside `ref`, where the §21.6 scan does not look, and
whose handler asks the store for the company the address names. Its contract carries an example,
`{ ref: { invoice: "dsor://org_456/invoice/INV-1008" } }`.

```text
 Tests  13 failed | 436 passed | 1 skipped (450)
```

Four of the thirteen are the suite's questions for `invoice.vendor`, by name: not refused, no refusal
to compare, no `DENY` in the log, and — read it carefully — the other company's rows *are*
untouched, because this one only reads. The other nine are step 03's operation counts and the
demo's pins, which any third operation moves. The map's done-when, met.

### Break 2 · the same operation, with no example

```text
 Tests  9 failed | 435 passed | 1 skipped (445)
```

One test, named for the operation: *carries no example request, so this suite cannot call it — add
one to its contract*. The other eight are step 03's operation counts and the demo's pins, one of
which now reads `(no example request in its contract)`. This step's suite does not skip what it
cannot test.

### Break 3 · a careless command

`invoice.issue_ref`: issues whatever draft the nested address names, in the address's company.

```text
 Tests  13 failed | 436 passed | 1 skipped (450)
```

Four of the suite's questions again, and this time *the other company's rows exactly as they were* is one of them:
`org_789`'s `INV-1009` went from `draft` to `issued`. The first version of this break, before
`org_789` held an `INV-1009`, failed only three — the rows were untouched because there was nothing
to touch, which is not the same as the command being careful. Question 3 exists because of that run.

### Break 4 · the §21.6 scan switched off

In `src/operations.ts`, in `validateTheInput`, change `if (address.tenant !== context.tenant)` to
`if (false)`.

```text
 Tests  19 failed | 424 passed | 1 skipped (444)
```

The suite is the net under the scan: every operation's refusal and log question fails, beside the
tests of steps 10 and 11 that ask the scan directly.

### Break 5 · a refusal that reveals

Make the mismatch message end with `, which exists` when the company named is real.

```text
 Tests  4 failed | 439 passed | 1 skipped (444)
```

Two are the suite's, one per operation; the other two are step 10's hand-written question and the
demo's.

### Break 6 · the other company loses `INV-1009`

Delete that row from `004_running_example.sql`.

```text
 Tests  1 failed | 442 passed | 1 skipped (444)
```

Question 3, for `invoice.issue`, with the fix in its message: *add it to 004_running_example.sql*.

### Break 7 · the example reader takes any key

In `exampleRequestOf`, read the first value in `extensions` instead of the one key the tutorial
owns.

```text
 Tests  1 failed | 442 passed | 1 skipped (444)
```

The test that hands the reader a contract whose only extension is somebody else's key.

### Break 8 · the demo forgets to move the address

In `src/main.ts`, drop the `replaceAll` that moves `org_456` to `org_789`.

```text
 Tests  2 failed | 441 passed | 1 skipped (444)
```

The demo then prints `ALLOWED` lines, and the test that pins the section — one line per operation
in the registry, each a `TENANT_MISMATCH` — says so. Step 11 learned to pin its demo lines from an
evaluation that found them unpinned; this step pinned its own from the start.

### Break 9 · `invoice.issue` loses its example

```text
 Tests  7 failed | 431 passed | 1 skipped (439)
```

The total shrinks by five: an operation without an example gets one failing question instead of
six. The seven are that question, the two example tests, step 03's counts, and the demo's pins.

### Break 10 · a smuggling operation

The hostile review's own exercise, and the reason two questions are worded the way they are. An
operation that reads a nested address, fetches the other company's row, returns a refusal-shaped
envelope — `TENANT_MISMATCH`, retry `never`, the same message — with the row tucked inside it, and
writes a `DENY` of its own into the log after the pipeline's `ALLOW`. The first version of this
suite compared the refusal's words and read the log's last record, and passed it.

```text
 Tests  11 failed | 438 passed | 1 skipped (450)
```

Question 2 now compares the whole envelope with the one for a company that does not exist, which
cannot carry that company's row; question 5 asks for exactly one record for the request.

### Break 11 · an example with no address

Change `invoice.get`'s example to `{ "status": "issued" }`.

```text
 Tests  4 failed | 434 passed | 1 skipped (439)
```

Two tests by name: the example test that wants an address in `org_456`, and the suite's own, which
says there is nothing to move. The first version of the suite asked such an example to be both
refused and allowed.

### Break 12 · the seed row already issued

In `004_running_example.sql`, seed `org_789`'s `INV-1009` as `issued` instead of `draft`. A
mutation pass found this one: a careless `invoice.issue` then finds nothing it can issue, the other
company's rows stay untouched, and the first version of question 3 — which only asked that the
number exists — was content.

```text
 Tests  1 failed | 442 passed | 1 skipped (444)
```

Question 3 asks, for a command, that the other company's row is in the same state as yours — the
state the example works in — and says what it found.

### Break 13 · an assertion deleted from the suite

Delete `expect(refusal.retry).toBe("never")` from question 1 in `test/support/cross-tenant-suite.ts`.
The same mutation pass did this to six assertions one at a time, and every deletion passed the
whole suite, because nothing tested the suite.

```text
 Tests  1 failed | 442 passed | 1 skipped (444)
```

Now one test fails, in `cross-tenant-suite-itself.test.ts`: the lie that question exists to catch —
a refusal whose retry class invites a retry — passes the weakened question, and the test that
expected it to throw says so.

### Break 14 · another assertion deleted: the other company's log

Delete `expect((await deps.logOf(THEIRS)).length).toBe(theirLogBefore)` from question 5.

```text
 Tests  1 failed | 442 passed | 1 skipped (444)
```

### Break 15 · a success answer that carries the other company's row

The critic's exercise, after the reviewers'. Change `invoice.get`'s handler to return org_456's
invoice with org_789's beside it, in a *successful* answer:
`return { kind: "data", askedBy, invoice, leaked: await getInvoice("org_789", read.id) }`. The
first version of question 6 asked only "not an error", and passed it — as did every other
question, the self-test, and step 10's hand-written file.

```text
 Tests  1 failed | 442 passed | 1 skipped (444)
```

Question 6 now reads the answer and refuses the other company's name and anything org_789 alone
holds in the story: `18000.00`, `9100.00`, `4200.00`, `INV-2001`.

### Break 16 · the company that does not exist starts existing

In `src/tenant.ts`, add `org_000` to the list. Question 2's whole argument is that a company
that does not exist cannot carry rows; with three real companies it compares two real refusals and
proves less than its title says, and the first version of the suite had no guard.

```text
 Tests  3 failed | 440 passed | 1 skipped (444)
```

Restore each break and confirm `pnpm check` prints `444 passed` again.

## Build it yourself with Claude Code

Copy `my_11_row_level_security` to a new folder and ask:

> Start step 12, the cross-tenant test suite. Before any code: add a third operation to a copy of
> step 11 without a tenant check, show me that step 11's tests stay green, and show me the leak.
> Then ask me, one at a time, how the suite learns what request each operation takes, and where the
> suite runs. Then build it a piece at a time, red first, and break each piece on purpose —
> including adding a careless operation, which is the map's own exercise.

## Check yourself

1. The suite "grows by itself". What exactly grows without a human, and what still needs one?
2. Why does each contract carry an example request, rather than the test file carrying a table?
3. Step 11 has two locks. Why does this step need a third thing at all?
4. The first version of the untouched-rows question passed for a careless command. Why, and what
   was added?
5. A contract arrives without an example request. What does the suite do, and why not skip it?

<details>
<summary>Answers</summary>

1. The asking grows: one `describe` with six questions appears for every operation in the
   registry, with no edit to any test file. A human still writes the example request into the new
   contract, and seeds the other company with every invoice number the example names. Until both
   are there, the suite fails by name.
2. Because the example describes the operation, so it belongs with the operation's spec sheet,
   under the one key the schema allows for anything beside the spec's fields (`DSOR-SCH-02`). A
   table in the test would need an edit for every new operation, and that edit is the thing people
   forget.
3. Because both locks can be slipped by a handler that is careless in the right way: the §21.6 scan
   reads only top-level string arguments, and the row-level lock trusts whatever company a
   statement says. A handler that reads a nested address and asks the store for *that* company gets
   the row. Measured, in **Why it matters**. The suite is the net under the locks, and the rule
   (`DSOR-TEN-02b`) says it must exist.
4. `org_789` had no `INV-1009`, so the careless command found nothing to issue, and "the rows are
   untouched" was true for the wrong reason. The suite now asks first that the other company holds
   every number the example names, and the seed gives it one.
5. It adds a failing test named for the operation, saying what to add and where. Skipping would
   make a missing example look like a passing test, which is exactly the silence this step exists
   to end.

</details>

## The rules this step meets

- **[DSOR-TEN-02b · L1]** An implementation MUST ship a cross-tenant test suite that exercises
  every operation with a foreign-tenant URI. `test/support/cross-tenant-suite.ts`, run on PGlite
  and against a real server, from the registry, with a failing test for any operation it cannot
  call. ([§14](../../../specs/dsor/02-security.md#14-multi-tenancy))
- **[DSOR-ERR-01b · L1]** An error MUST NOT reveal the existence or attributes of a resource the
  caller is not authorized to read — asked of every operation: the same words for a company that
  exists and one that does not, and nothing about the caller's own.
- **[DSOR-IDN-03b · L1]** and **[DSOR-EXE-02 · L1]**, asked of every operation rather than claimed
  anew: the other company's rows untouched, and the refusal a `DENY` in the caller's log with
  nothing in the other company's.

**What the suite does not prove, said plainly.** It moves addresses of the form
`dsor://org_456/…` found anywhere inside the example, and nothing else. An example that names no
such address gets one failing test by name rather than six that contradict each other; an example
that names its company some other way — a bare invoice number beside a company field, an encoded
address — is moved into itself, and questions 1, 2, 4 and 5 then fail with "got data", which reads
like a leak and is really an example the move could not reach. Question 3 reads invoice rows only,
and says so by name for any other kind of address. Question 5 proves the `DENY` is the one record
for the request; that it was written *before* the answer is step 08's one proof over the shared
pipeline, not repeated per operation. The caller is `user_123` of `org_456` throughout; the agent
who belongs to both companies, the nested-argument limit, and a door with a forgetful validate
stage stay in step 10's hand-written file. And the suite tests the operations that exist against
the tenants that exist: a third company in `tenant.ts` is a seed change and nothing else here —
unless it is `org_000`, which a guard refuses. And the convention has a limit of its own: the
example is never checked against the operation's input schema, because no step has request schemas
yet, and every address in it moves at once, so an operation that checks one of two addresses and
not the other is not told apart. The official step 12 keeps its examples outside the contract and
searches answers for canaries; this one keeps them with the contract and searches answers for the
four things `org_789` alone holds.

**The map and this step disagree, and it is recorded.** The map says the suite "runs on a fresh
Neon branch, so it can create two companies and destroy them without touching your data". This
suite runs on PGlite, which is a fresh database every run, and again in the database tier against
the database `.env` names, like every test before it. A branch per run needs the Neon CLI, a
login and the network inside the tests, which no test here has; decision 99 in `my_notes` records
the choice, and the map is left as written.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-TEN-01c` | Isolation must not depend on agent behaviour or prompts. Held by every step, claimed by none. |

Everything earlier steps claimed still holds. One number from step 10 moved: `org_789` holds
`INV-1009` and `INV-2001` now, and the test that asked for an invoice the other company has and
yours does not asks for `INV-2001`.

**Next:** step 13, `bounded_queries` — `invoice.list`, and a server that caps the page size even when
the caller asks for everything.
