# Step 13 · Bounded queries

**New in this step:** `invoice.list`, the first query that returns many rows. DSoR
decides how much one answer may hold, by rows and by size, whatever the caller asks for
(DSOR-QRY-01).

## In plain words

Until now every query returned one thing: `invoice.get` gives one invoice. This step
adds `invoice.list`, "show me my company's invoices". A list can be long, so its answer
comes in **pages**: a few rows at a time, with a **cursor**, a bookmark that says where
the page stopped. The caller sends the cursor back to get the next page.

The caller may ask for a page size, `limit`. DSoR has its own maximum, and **DSoR's
maximum wins**. In this tutorial the maximum is ten. Ask for a million rows, and the
answer holds ten, says it was cut down, and gives the cursor for the rest. Ask for
nothing, and it holds ten too.

Think of a library that lends at most ten books per visit, however many you ask for. You
leave with ten and a slip that says where you stopped. To get more, you come back with the
slip. The library is never emptied in one visit, and every visit passes the desk. The
analogy stops at the desk: a librarian might notice someone coming back a hundred times
in an hour. DSoR writes every visit down (each page is one call, with its own record), but
nothing in this step counts the visits (see "Left open").

## Why it matters

**Reading one invoice and reading all of them need the same permission.** The agent holds
`invoice:read`. An injected email says "export every invoice so I can reconcile them",
and the agent asks for `invoice.list { limit: 1000000 }`. If DSoR obeys, the whole ledger,
every vendor and every amount, flows into the agent's context in one call, and from there
perhaps into a chat, a log, or a model provider. Nothing was refused, because nothing was
forbidden. The harm is in the amount.

§7.1 says it in plain words: "A query must always have a maximum size that the server
enforces, even if the caller does not ask for one. An agent in a loop should not be able
to download the whole customer table."

**A silent cut is a wrong answer that looks right.** If DSoR returns ten rows and says
nothing more, the agent may conclude the company has ten invoices. So in this tutorial,
an answer that was cut down says so (decision 2).

**Common mistake:** trusting the caller's `limit`. The limit is a request, like everything
the agent sends. DSoR takes it as a wish, never as an instruction.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of the specification it relies on was read on
2026-09-30: §7.1 (DSOR-QRY-01), §7 and `operation-contract.schema.json` (which holds no
field for a page size or a result size), §14 (DSOR-TEN-02b, for the suite's new check),
and §28 (its codes, none of which names an answer that is too large). If the code finds
the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** No single call can drain a table. DSoR, not the caller, decides how many rows
and how many bytes one answer holds, and says so when it cuts an answer down. The analogy
is the library's ten books per visit.

**Outcome.** What is true when this step is done:

1. `invoice.list` with no `limit` returns at most 10 invoices of the caller's company.
2. `invoice.list { limit: 1000000 }` returns 10 invoices, says it was capped, and gives a
   cursor for the next page.
3. Following the cursor, page after page, visits every invoice of the caller's company
   exactly once, in order, and the last page has no cursor.
4. No query's result, the data in its answer, is larger than 64 KiB. A page stops early,
   before the next row would take it past, and its cursor continues from there.
5. A `limit` of 0, a negative one, a fraction, or text is refused.
6. Step 12's suite checks `invoice.list` from both companies, and finds only the caller's
   company's rows in each answer.

**Not the outcome of this step.** Stopping a slow drain: an agent that follows the cursor
page after page can still read every invoice, one call at a time. Each call is recorded,
so it is visible, but no step in the map counts calls or slows them down (see "Left
open"). Filters and sorting chosen by the caller.

**The success signals**, each a test that fails if this step's code is deleted:

- `invoice.list { limit: 1000000 }` returns exactly 10 rows, `capped`, and a cursor, while
  the company has more than 10 invoices.
- `invoice.list {}` returns 10 rows, not all of them.
- A fake query whose answer would be larger than 64 KiB is cut down or refused, never
  sent whole.

### What the specification asks, and what this step can honestly give

Checked on 2026-09-30:

1. **DSOR-QRY-01 asks for "a server-side maximum page size and maximum result size on
   every query".** It does not say what a result size is, and the contract schema holds
   no field for either. This step's page size counts rows, and its result size counts the
   bytes of one result: the data in the answer, written as JSON text (decisions 2 and 3).
   Both are this tutorial's numbers, written in DSoR's code, not in the contract. Both are
   recorded as questions for the specification.
2. **"Every query"** includes `invoice.get`. Its answer is one invoice, so its page size is
   one by nature, and the size limit of decision 3 applies to it as to every query.
3. **§28 has no code for "this answer is too large to give".** Decision 3 picks one, and
   the choice is recorded as a question.
4. **DSOR-TEN-02b asks the suite to exercise "every operation with a foreign-tenant
   URI".** `invoice.list` takes no URI, and its cursor cannot hold one (decision 5). So
   the suite checks the list's rows instead (decision 6). Found by the review, and
   recorded as a question: what does the rule ask of an operation that takes no URI?

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-QRY-01 | **C1.** A page holds at most 10 rows, whatever the caller asks, and (our decision 2) says when the limit was cut down | No `limit`: 10 rows. `limit: 1000000`: 10 rows, `capped`, a cursor. `limit: 3`: 3 rows, not capped |
| DSOR-QRY-01 | **C2.** No query's result is larger than 64 KiB | A page stops before the row that would take it past, with a cursor. A query whose one result is larger is refused |
| DSOR-QRY-01 | **C3.** The cursor walks the whole list, once | Pages followed to the end visit every invoice of the company exactly once, in order, and the last has no cursor. Another company's id as a cursor is only a place in the alphabet |
| (our decision) | **C4.** A `limit` must be a whole number of at least 1, and a `cursor` must look like an id | 0, -1, 1.5, and `"10"` are refused with `VALIDATION_FAILED` at line ⑥. So are a cursor of 65 characters, one with a NUL, and one that is a `dsor://` URI |
| DSOR-TEN-02b | **C5.** Step 12's suite checks a list from both companies | Every row in `invoice.list`'s answer, for `org_456` and for `org_789`, asked with its example and with nothing, carries the caller's company. A planted list that leaks a row, returns a row with no company, or leaks only when asked with nothing, is a finding |
| DSOR-EXE-02 | **C6.** Each page is its own call, with its own record | Three pages leave three records |
| DSOR-TEN-01b | **C7.** The list's own SQL keeps to the company, without the database's lock | The owner, whom row-level security does not stop, lists `org_456` through DSoR's store page after page, and every row is `org_456`'s |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **`invoice.list` is a query, with the permission `invoice:read`.** Its input is
   `{ limit?, cursor? }`, and nothing else. Its answer is
   `{ items, next_cursor?, capped? }`, where `capped` is `{ asked, max }` when the
   `limit` was cut down. *Downside:* every caller who may read one invoice may list them
   all, a page at a time. A permission of its own for listing would be stricter, and the
   specification does not ask for one.
2. **The page size is at most 10 rows, and 10 when no `limit` is given.** A `limit` above
   10 becomes 10, and the answer says `capped: { asked, max: 10 }`. The number is small
   so that a test, and a learner, can see the cap work with a dozen invoices. *Downside:*
   a real deployment would choose a larger number, and this one lives in the code, not in
   the contract, because the contract schema has no field for it.
3. **No query's result may be larger than 64 KiB.** The result is the data in the
   answer, written as JSON text, and counted in bytes. The correlation beside it is
   DSoR's own and small, so it is not counted. A list stops adding rows before the row
   that would take its result past the limit, and gives the cursor from there. It never
   drops the first row, so a page that has a cursor always holds at least one row, and
   the cursor always moves forward: a page with no rows and a cursor would send the caller
   back to the same place forever. A page can still be empty: a cursor past the last
   invoice gives `{ items: [] }`, with no cursor. A page cut by size does not say
   `capped`, which is about the limit; its `next_cursor` says that more rows follow.
   After line ⑨, the
   pipeline measures every query's result, and one that is still too large, such as a
   page whose one row is larger than 64 KiB, is refused with `UNSUPPORTED_CAPABILITY`,
   "the answer is larger than DSoR gives in one call". *Downside:* §28 has no code for
   this. `UNSUPPORTED_CAPABILITY` with retry `never` is the closest: asking again gets the
   same answer. It is a question for the specification. And a row that is too large
   blocks every row after it, because no page can step over it.
4. **The list is in order of invoice id, and the cursor is the last id of the page.** The
   next page is `WHERE tenant_id = <the company> AND id > <cursor> ORDER BY id`, one row
   more than the page needs, to know whether another page follows. The cursor is a
   position in the caller's own company only: a cursor that names another company's
   invoice id is just a place in the alphabet, and tells nothing about that invoice.
   The order is the database's: text compared by its character codes (`C.UTF-8`,
   checked live on 2026-09-30), the same order JavaScript's `<` gives these ids in memory.
   The SQL does not name that order itself (see "Left open").
   *Downside:* an invoice added behind the cursor while a caller is paging is missed by
   that walk.
5. **A `limit` must be a whole number of at least 1, and a `cursor` must look like an
   id,** both checked by `invoice.list`'s input schema at line ⑥. The schema sets no
   maximum for `limit`, so a large one passes line ⑥ and is cut down, as the map's "done
   when" asks, instead of refused. A cursor holds only letters, digits, `_`, `.`, and `-`,
   the characters the specification's `resourceUri` allows in an id, and at most 64 of
   them. So a cursor cannot carry a URI, a NUL character, or five megabytes of text.
   Found by the review: before this, a NUL cursor reached PostgreSQL, which refuses NUL in
   text, and the answer was `INTERNAL_ERROR`. *Downside:* a caller that asks for a
   million is not told "no". It is told "here are ten, and you asked for a million". And
   64 characters is this tutorial's number: an invoice id longer than that could not be a
   cursor.
6. **Step 12's suite learns a second check, for lists.** A list names no single thing.
   Its input is a page size and a cursor, and a cursor cannot hold a URI (decision 5), so
   there is nothing to swap. Its example still holds every field its input schema lists,
   as step 12 asks: `{ "limit": 10, "cursor": "INV-1000" }`. A query whose example holds
   no URI is accepted only when its answer is a page, `{ items: [...] }`. The suite asks
   once, as the first caller of `org_456` who may call it. It asks only a query: a
   command would run. If that answer is a page, the suite calls the list as every such
   caller of both companies, twice: with its example, and with only the fields its input
   schema requires, `{}` here, because a list may leak on a path its example does not
   take. Every item must carry `tenant_id` equal to the caller's company. An item with no
   `tenant_id` is a finding, because it cannot be checked. A page with no items is a
   finding too, because it checks nothing: a list with no company filter at all would pass
   it. If the first answer is not a page, or the operation is a command, it gets step
   12's finding, once, word for word. *Downside:* the suite counts `invoice.list` as
   attacked without sending it a foreign URI, because there is no place for one (see
   "What the specification asks", point 4). And it trusts an operation that answers with
   a page to return items that carry their company: a single-thing operation dressed as a
   one-item page would be checked by its rows, not by a swap.
7. **More invoices, so that there is more than one page.** A migration, `006`, adds
   `INV-1001` to `INV-1012` to `org_456`, keeping `INV-1008` as it is, and `INV-2002` to
   `INV-2004` to `org_789`. The invoices in memory, for the unit tests, are the same.
   *Downside:* the running example gains invoices the specification does not name.

### The tests, by claim

- **C1:** on memory and on the database: `invoice.list {}` gives 10 items and a cursor.
  `{ limit: 1000000 }` gives 10 items, `capped: { asked: 1000000, max: 10 }`, and a
  cursor. `{ limit: 3 }` gives 3 items, no `capped`, and a cursor.
- **C2:** a fake list whose rows are 10 KiB each stops at 6 rows, under 64 KiB, with a
  cursor. A fake query whose one answer is 100 KiB is refused with
  `UNSUPPORTED_CAPABILITY`. The real answers pass the same check: C1's tests are
  answered with data.
- **C3:** following `next_cursor` from `{ limit: 5 }` gives 5, 5, and 2 items for
  `org_456`'s 12 invoices, each id once, in order, and the last page has no cursor. As
  `org_789`, the cursor `INV-1010`, which only `org_456` has, and the made-up cursor
  `INV-1099` both give `INV-2001` to `INV-2004`, apart from the request id. A cursor that
  looked the id up, across companies, would answer the two differently.
- **C4:** `{ limit: 0 }`, `{ limit: -1 }`, `{ limit: 1.5 }`, and `{ limit: "10" }` are each
  `VALIDATION_FAILED`. So are a cursor of 65 characters, a cursor holding a NUL, and the
  cursor `dsor://org_789/invoice/INV-2001`. A cursor of 64 characters is accepted.
- **C5:** the suite over the shipped registry gives no findings and counts 3 operations.
  Planted: a list that behaves gives no finding. A list that returns one `org_789` row to
  `org_456`, a list whose items have no `tenant_id`, and a list that answers an empty
  page, or a list that leaks only when asked with nothing, each give their finding. A
  single-thing operation with no URI whose answer is not a page is step 12's
  `invoice.peek` test, kept word for word. A command with no URI in its example is a
  finding, and is never called.
- **C6:** in the database tier, three pages leave three records in the caller's company.
- **C7:** in the database tier, the owner lists `org_456`'s invoices through DSoR's store,
  page after page, and gets `org_456`'s 12 invoices, and nothing of `org_789`'s.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| X1 | The caller's `limit` is obeyed | C1's million test | not asked; the expectation stands |
| X2 | No `limit` means every row | C1's empty-input test | not asked; the expectation stands |
| X3 | A cut-down page says nothing (`capped` left out) | C1's million test | the million test |
| X4 | The cursor query uses `>=` instead of `>` | C3: the cursor's own row comes back again | C3 |
| X5 | The list's SQL forgets the company | the suite's list check on memory. On the database, only C7's owner test: the second lock hides it from every other | red on memory, green on the database (predicted before C7 was added) |
| X6 | The suite's list check accepts an item with no `tenant_id` | only C5's planted item | only the planted item test |

The review also attacks the step with the threat that is its reason: bulk extraction by
an allowed caller, through a large `limit`, a forged cursor, or a loop.

### Left open, and not this step's idea

- **Stopping a slow drain.** Each call is bounded, but a caller can call again and again.
  §28 has `RATE_LIMITED`, and no step in the map counts calls. Step 25's emergency brake
  can stop an agent by hand. Recorded as a gap in the map.
- **The page size and result size in the contract**, per operation, instead of in code.
  The contract schema has no field for them.
- **Filters and sorting** chosen by the caller.
- **Listing by vendor,** once vendors are records of their own (step 17).
- **The order in the SQL.** The list's SQL does not say `COLLATE "C"`. It relies on the
  database's default, `C.UTF-8`, to order ids as memory does. A database made with
  another default could order them differently, and the cursor would still walk every
  row once, in that database's order.
- **`pageOf` trusts its `limit`.** Line ⑥ refuses a limit below 1, so `pageOf` never
  gets one from `invoice.list`. Another operation that used `pageOf` without that check
  would have to check it too.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup
itself, this way:

1. Create a branch `step-13` **from `step-12`**, with the Neon MCP server or with
   `neonctl branches create`.
2. Write `.env` with `neonctl connection-string`, its output redirected into the file,
   never printed: the owner's string as `DSOR_MIGRATION_URL`, and the same string with
   the user `dsor_runtime` and a new random password (letters and digits) as
   `DSOR_DB_URL`. Both with `sslmode=verify-full`.
3. Run `pnpm migrate`. It sets `dsor_runtime`'s password from `DSOR_DB_URL`, and runs
   migration `006`.
4. Check without looking: `pnpm test:db` passes, and the transcript holds no
   `postgresql://` with a password in it.

## What changed since step 12

| File | What changed |
| --- | --- |
| `contracts/invoice.list.json` | **New.** A query that needs `invoice:read` (decision 1) |
| `inputs/InvoiceListRequest.schema.json` | **New.** `limit`, a whole number of at least 1, and `cursor`, which looks like an id, at most 64 characters (decision 5) |
| `examples/invoice.list.json` | **New.** `{ "limit": 10, "cursor": "INV-1000" }`, for the suite (decision 6) |
| `migrations/006_more_invoices.sql` | **New.** `INV-1001` to `INV-1012` for `org_456`, `INV-2002` to `INV-2004` for `org_789` (decision 7) |
| `src/pages.ts` | **New.** `MAX_ROWS` (10) and `MAX_BYTES` (64 KiB), `pageSize`, `pageOf`, which cuts a page by rows and then by bytes, and `checkResultSize` (decisions 2 and 3) |
| `src/operations.ts` | `invoice.list`'s code: one row more than the page holds, after the cursor, inside the active company |
| `src/invoice.ts` | The same new invoices in memory. The store gains `list(tenant, after, count)`, and `listInvoices` is its memory version |
| `src/postgres.ts` | The list's SQL. `invoiceOf`, one row as an invoice, is now shared by `get` and `list` |
| `src/pipeline.ts` | After line ⑨, `checkResultSize` measures every query's result |
| `src/main.ts` | The agent asks for a million invoices, and the program prints the ten it gets |
| `test/invoice-list.test.ts`, `test/invoice-list.db.test.ts` | **New.** C1, C3, and C4 on memory. C1, C3, C6, and C7 on the database |
| `test/result-size.test.ts` | **New.** C2 |
| `test/cross-tenant-lists.test.ts` | **New.** C5, with planted lists |
| `test/cross-tenant.ts`, `test/companies.ts` | The suite's list check: `isPage`, `pageProblem`, the one question it asks a query with no URI, and the second, bare call |
| `test/owner-store.ts`, `test/db.ts` | The owner's `list` mode, page after page, and `ownerList` (C7) |
| `test/helpers.ts` | `idsOf`, a page on one line, and `walk`, a caller that follows the cursor |
| every other test | Counts of two operations became three. Two earlier tests used `invoice.list` and `InvoiceListRequest` as made-up names. They now use `invoice.list_all` and `InvoiceSearchRequest`, which still do not exist. The program's log test counts 10 records of 13 calls |

Every other file is step 12's, without its `NEW IN STEP` markers. No new dependency.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_12_cross_tenant_test_suite/src mj_13_bounded_queries/src
git diff --no-index mj_12_cross_tenant_test_suite/test mj_13_bounded_queries/test
git diff --no-index mj_12_cross_tenant_test_suite/inputs mj_13_bounded_queries/inputs
```

## Run it

Set up Neon first ("Before you build" above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # runs migration 006, and sets dsor_runtime's password again
pnpm check        # typecheck and the unit tests
pnpm test:db      # the database tests
pnpm start        # the program, against the database
```

Among the program's lines, on 2026-09-30:

```text
operations: [ 'invoice.get', 'invoice.issue', 'invoice.list' ]
…
INV-1001 INV-1002 INV-1003 INV-1004 INV-1005 INV-1006 INV-1007 INV-1008 INV-1009 INV-1010 { next_cursor: 'INV-1010', capped: { asked: 1000000, max: 10 } }
…
5362 invoice.list@1 ALLOW ok org_456
13 calls answered, so 13 records were written. dsor_runtime reads 10 of them, in org_456 and org_789, and cannot read the other 3
```

The agent asked for a million invoices. It got ten, the answer says the limit was cut,
and the cursor says where the next page starts. The call left its record, like every
other.

## Break it

Every break of the design's table, performed on 2026-09-30 and 2026-10-01, one at a time,
in a copy of this folder, then put back from a backup and compared byte for byte. They ran
twice: on the step before the review (commit `3498106`), and on the final code, after the
review and the sweep. X2, X4, and X5 change what the database reads, so they also ran on
the database tier.

| # | The break | Learner's prediction | Before the review | On the final code |
| --- | --- | --- | --- | --- |
| X1 | The caller's `limit` is obeyed | not asked | 2 unit: the million test, and 10 against 11 | 3 unit: the same two, and the store-count test |
| X2 | No `limit` means every row | not asked | 1 unit, 1 database: the empty-input test | 2 unit: the empty-input test and the store-count test. 1 database: the empty-input test |
| X3 | `capped` is left out | the million test | 2 unit: the million test, and 10 against 11 | 3 unit: the same two, and the page cut by limit and by size |
| X4 | The cursor uses `>=` instead of `>` | C3 | 1 unit, 2 database: the walks | 3 unit: the walk, the store after a cursor, and the copy test. 4 database: both walks, the store after a cursor, and C7, whose owner walks too |
| X5 | The list forgets the company: in memory | red on memory | 30 unit | **33 unit**: every suite test over the shipped registry, C1, and C3 |
| X5 | The list's SQL forgets the company | green on the database | 0 unit. On the database, **only C7**, 1 of 33 | 0 unit. On the database, **only C7**, 1 of 35 |
| X6 | The suite accepts an item with no `tenant_id` | only the planted item test | 1 | 1, as predicted |

**X1, the one this step is for.** In `src/pages.ts`, make `pageSize` return
`limit ?? MAX_ROWS`, so the caller's limit is obeyed. Then:

```text
$ npx vitest run test/invoice-list.test.ts -t "1000000"
 FAIL  test/invoice-list.test.ts > C1: a page holds at most 10 rows, whatever the caller asks, and says when it was cut down > DSOR-QRY-01: invoice.list { limit: 1000000 } gives 10 invoices, says the limit was capped, and gives a cursor
AssertionError: expected { items: [ …(12) ], capped: { …(2) } } to strictly equal { items: [ …(10) ], …(2) }

- Expected
+ Received

@@ -12,8 +12,9 @@
      "org_456/INV-1006",
      "org_456/INV-1007",
      "org_456/INV-1008",
      "org_456/INV-1009",
      "org_456/INV-1010",
+     "org_456/INV-1011",
+     "org_456/INV-1012",
    ],
-   "next_cursor": "INV-1010",
  }
```

Every invoice of the company came back, and there is no cursor, because there is nothing
left to read. With twelve invoices that looks harmless. With a whole ledger it is the
failure of "Why it matters". Look at what the answer still says: `capped: { asked:
1000000, max: 10 }`. It claims a cut it did not make. A flag that the code sets in one
place and the cap applies in another can drift apart, and only a test that checks both
at once notices.

**X5, on the database, the second lock at work.** Take the company out of the list's SQL,
and every database test but one stays green, 34 of 35 on the final code: row-level
security hides the missing filter from every caller that logs in as `dsor_runtime`. Only
C7 sees it, because the owner bypasses row-level security:

```text
- Expected
+ Received

@@ -7,11 +7,16 @@
      "org_456/INV-1004",
      "org_456/INV-1005",
      "org_456/INV-1006",
      "org_456/INV-1007",
      "org_456/INV-1008",
+     "org_789/INV-1008",
      "org_456/INV-1009",
      "org_456/INV-1010",
      "org_456/INV-1011",
      "org_456/INV-1012",
+     "org_789/INV-2001",
```

The learner predicted "green on the database" before C7 existed, and that is what would
have happened. The design check added C7 for this break.

**Two breaks the review found, and the tests that now catch them.** The SQL
`WHERE tenant_id = $1 AND $2::text IS NULL OR id > $2`, with its brackets lost, keeps
the company on the first page and drops it on every page after. It passed all 33
database tests, because the owner read only one page. With the owner walking page after
page, C7 names `org_789`'s five invoices. And a cursor that is looked up across companies
(`id > the row whose id is the cursor`, in any company) passed the first foreign-cursor
test, which compared two empty pages. The test from `org_789`, `INV-1010` against
`INV-1099`, fails on it.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Design first | "In plain words", "Why it matters", "The design, before any code", in a session before this one |
| 2 | Neon | A branch `step-13` from `step-12`, and `.env` written by a command, never shown ("Before you build"). `pnpm test:db` green before any change |
| 3 | Check the design | Against every rule sentence, the contract schema, and step 12's suite. Four gaps: C7, what 64 KiB counts, one row per page, and the one question for an operation with no URI. The learner chose, and the design changed before any test |
| 4 | Data | Migration `006`, and the same invoices in memory. No test changes |
| 5 | Red, then green | One claim at a time: C5, C1, C4, C7, C3, C2, C6. Predict each red run before it runs |
| 6 | Break it | X1 to X6, for real |
| 7 | Review | Two reviewers who have not seen your conversation. One reads and attacks. One breaks the code a line at a time, in a copy with a Neon branch of its own |
| 8 | Fix the review | The design first, then the red tests, then the code. Predict each |
| 9 | Break it again | X1 to X6 on the final code, and each review finding's own break |

The prompt that started this session:

```text
Set up, then build step 13 in learner mode.

Setup: follow README "Before you build": branch step-13 from step-12 in project
<your Neon project>; write .env only through commands whose output goes into the file,
never print, fetch, or read a connection string or password; then pnpm migrate and
pnpm test:db.

Build: README's design is agreed. If the code proves it wrong, change the design section
first and tell me. Red tests first, one commit per claim.
```

The learner's predictions, and what happened:

| Moment | Prediction | Real |
| --- | --- | --- |
| C5's red run: a good list, a leaky list, a list with no `tenant_id`, and step 12's `invoice.peek` | all 4 fail | 3 failed. `invoice.peek` passed: step 12's code already said no to it |
| C1's red run | not asked | 17 failed: the 7 new tests, and 10 older tests that counted two operations |
| C1 on the database, before the store's `list` existed | an error envelope | right: `INTERNAL_ERROR`, "DSoR hit an unexpected error" |
| C4's red run: limits 0, -1, 1.5, and `"10"` | all 4 fail | **2** failed. C1's `"type": "integer"` already refused 1.5 and `"10"` |
| C3's red run: the walk, and a foreign cursor's two checks | the walk, and both checks | the walk, and **only the empty-page check**. The two cursors were refused in the same words, so "the same answer" already held |
| C2's red run: seven tests | all 7 fail | **6**. "Exactly 64 KiB is answered" passed: a "yes" test passes before the code that says no |
| C6's first run | green at once | right: every call has been recorded since step 08 |
| The review's cursor form: 65 characters, NUL, a URI, and 64 characters | all 4 fail | **3**. The 64-character "yes" test passed |
| The review's foreign-cursor test, from `org_789` | green at once | right |
| The review's command and bare-call tests | both fail | right |

## Check yourself

1. The agent holds `invoice:read`. Why is that not enough to stop it reading every
   invoice in one call?
2. Why does DSoR return ten rows for `limit: 1000000`, instead of refusing?
3. Why must a cut-down answer say it was cut down?
4. Why is the page size counted in rows, and the result size in bytes?
5. Can an agent still read every invoice? What does this step change about how?

<details>
<summary>Answers</summary>

1. Reading one invoice and reading a million need the same permission. The harm is in the
   amount, so the amount needs a limit of its own.
2. The map asks that a million rows return one page. The limit is the caller's wish, and
   DSoR answers it as far as its own maximum allows. Here that is ten, this tutorial's
   number.
3. Otherwise ten rows look like "the company has ten invoices": a wrong answer that looks
   right.
4. A row count misses one huge row. A size in bytes catches it, whatever the rows hold.
5. Yes, a page at a time, following the cursor. Each page is a separate call with its own
   record, so a drain is slow and visible. Nothing in this step stops it.

</details>

## Think it through

**Changed by the design check, before the first test (2026-09-30).**

- **C7 was added.** Break X5 would have survived every test. The unit tests never run the
  list's SQL, and on the database row-level security hides a missing company filter.
  Step 11 closed the same gap for `invoice.get` by letting the owner, whom row-level
  security does not stop, run DSoR's store. The list gets the same test.
- **The 64 KiB counts the result, not the whole answer** (decision 3). The list's code
  builds the data and cannot see the correlation that the pipeline adds after it.
- **A page always holds at least one row** (decision 3), and the suite asks a no-URI
  operation once before it attacks it (decision 6).
- **An empty page is a finding** (decision 6). Found while writing C5's check: an example
  whose cursor sits past the end gets `{ items: [] }` from every list, a leaky one too.
  Step 12 closed the same hole for queries by asking for data.

**Found by the hostile review, and fixed** (each fix changed the design first, then a
test, then the code):

- **C7 read one page only.** The SQL after a cursor never ran as the owner, so the
  bracket bug above passed. The owner now reads five rows at a time.
- **The foreign-cursor test could not fail.** It compared two empty pages. Now it is
  asked from `org_789`, between two of its invoices.
- **"A page always holds at least one row" was false.** A cursor past the end gives an
  empty page. Decision 3 now says what is true: a page that has a cursor is never empty.
- **The cursor took any text.** A cursor of 5 MB was accepted, and a NUL character
  reached PostgreSQL, which refuses it, so the answer was `INTERNAL_ERROR`. The cursor now
  looks like an id (decision 5).
- **The suite ran an operation to learn whether it answers with a page.** For a command
  that would change something, once commands are built. Now it asks only a query.
- **The suite asked a list only with its example,** which always holds a cursor. A list
  that leaks only with no cursor passed. Now it also asks with only the required fields.
- **Four sentences read as rules of DSoR** where they were this tutorial's choices: ten
  rows, "must say so", and how a size is counted.

**Found by the mutation sweep, and fixed.** The sweep made 96 small breaks on the code
before the review. 69 were caught by the tests, 2 only by the typecheck, and 25
survived. The review's fixes closed four of them: the bracket bug, a cursor of any type,
the NUL cursor, and a URI as a cursor. Of the rest, these were real, and each now has a
test that fails on it:

- **The cap held only after the rows were read.** A handler that asked the store for the
  caller's million, a store that ignored its count, and `LIMIT $3 + 1000` in the SQL all
  gave the same pages, because `pageOf` cut them afterwards. Now the code must ask for
  11, 11, and 4, and both stores must give exactly what they are asked for.
- **A last page cut for size lost rows.** With one line of `pageOf` deleted, the rows it
  cut had no cursor to reach them. Also tested now: the cursor's own bytes count, a page
  of exactly 64 KiB keeps its rows, and `capped` says 10 after a cut by size.
- **A listed invoice was not tested as a copy,** as `invoice.get`'s is since step 04.
- **An order by the reader's language** instead of by character codes passed. It puts
  `INV-a` before `INV-B`, and the database does not.
- **The owner's helper could hide what it saw.** Filtered to `org_456`, it hid a SQL with
  no company. It now lists both companies.
- **Also:** a `null` cursor, a list that answers `org_789` with something that is not a
  page, and a query whose code returns nothing.

**Left open on purpose**, with the reason:

- **Equivalent breaks**, which change nothing a caller can see: `limit ?? Infinity`
  (`Math.min` still caps it), `after ?? ""` for no cursor, an example with `limit: 1`,
  and the one question asked when nobody in `org_456` may call the operation (another
  finding is raised anyway).
- **The contract's `output.schema` and `tenancy.required` are read by nothing.** Changed,
  every test stays green. That is true of every contract since step 03, not only this
  one.
- **The owner's `bypassrls` could be hard-coded to true** and pass on this branch. The
  test would then check the policy instead of DSoR's own filter, without saying so. The
  same holds for step 11's owner check.
- **A lowercase cursor, such as `inv-1004`, sorts after every id** and gives an empty
  page. It is a place in the order, as decided, not an error.
- **Nothing limits the size of a whole request.** The cursor is capped at 64
  characters, and `limit` is a number, but a request's size in general is not this
  step's idea.
- **A slow drain is still possible,** as "Not the outcome" says. The review's attack read
  `org_456`'s twelve invoices in two calls, or in twelve calls of one row, each call
  recorded. Nothing counts them.

**What the predictions showed.** Four times a test passed before its code: C4's 1.5 and
`"10"`, C2's "exactly 64 KiB is answered", the cursor of 64 characters, and step 12's
`invoice.peek`. Each time the learner expected red. A "yes" test passes as long as
nothing says no, and a "no" test passes as soon as some earlier code already says no.
Neither proves the new code until a break shows it failing without it.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-QRY-01 | A server-side maximum page size and result size on every query, whether or not the client asks for a limit | [§7.1 Queries](../../../specs/dsor/01-model.md#71-queries) | `test/invoice-list.test.ts` and `test/invoice-list.db.test.ts`: no limit, a limit of a million, 3, 10, and 11 (C1), and the cursor walked to the end (C3). `test/result-size.test.ts`: rows cut by bytes, a result over 64 KiB refused, exactly 64 KiB answered, one byte more refused, bytes not characters (C2) |

Also advanced, first met in earlier steps: DSOR-TEN-02b, the suite checks a list by its
rows, from both companies, asked with its example and bare (C5,
`test/cross-tenant-lists.test.ts`), though a list takes no URI to send it ("What the
specification asks", point 4). DSOR-TEN-01b, the list's own SQL without row-level
security (C7, `test/invoice-list.db.test.ts`). DSOR-IDN-03b, another company's id as a
cursor (C3). DSOR-EXE-02, one record for each page (C6, `test/invoice-list.db.test.ts`),
and for a result refused for its size (`test/result-size.test.ts`).

## Next

Step 14 · Classification and masking: each field gets a sensitivity label, and a field
above the caller's clearance, such as an invoice's `amount` for the agent, is hidden
before the answer leaves, with a list of what was hidden.
