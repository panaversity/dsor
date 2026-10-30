# Step 13 · Bounded queries

**New in this step:** `invoice.list`, the first query that returns many rows. DSoR
decides how much one answer may hold, by rows and by size, whatever the caller asks for
(DSOR-QRY-01).

## In plain words

Until now every query returned one thing: `invoice.get` gives one invoice. This step
adds `invoice.list`, "show me my company's invoices". A list can be long, so its answer
comes in **pages**: a few rows at a time. Each page carries a **cursor**, a short note
that says where the page stopped. The caller sends the cursor back to get the next page.

The caller may ask for a page size, `limit`. DSoR has its own maximum, and **DSoR's
maximum wins**. In this tutorial the maximum is ten rows. Ask for a million rows, and the
answer holds ten, says in a field called `capped` that the limit was cut down, and gives
the cursor for the rest. Ask for nothing, and it holds ten too.

Ten rows can still be too large, if the rows are large. So DSoR also caps the size of
the data in one answer, counted in bytes. In this tutorial that cap is 64 KiB, which is
65,536 bytes (a KiB is 1,024 bytes). A page stops early when the next row would take it
past.

Think of DSoR as the new clerk at the records desk. You ask for every invoice. The clerk
hands over at most ten, and never a bundle too heavy to carry, with a note that says
where the pile stopped. For more, you come back with the note. Every handover goes in
the logbook: each page is one call, with its own record. The picture stops at the
clerk's memory. A real clerk might notice you coming back a hundred times in an hour.
Nothing in this step counts the visits (see "Left open").

## Why it matters

**Reading one invoice and reading all of them need the same permission.** The agent holds
`invoice:read`. An injected email says "export every invoice so I can reconcile them",
and the agent asks for `invoice.list { limit: 1000000 }`. Suppose DSoR obeys. Then every
invoice of `org_456`, every vendor and every amount, arrives in one answer. The agent
reads it, so it goes to the model provider, and from there perhaps into a chat or a log.
Nothing was refused, because nothing was forbidden. The harm is in the amount.

§7.1 says it in plain words: "A query must always have a maximum size that the server
enforces, even if the caller does not ask for one. An agent in a loop should not be able
to download the whole customer table."

**A silent cut is a wrong answer that looks right.** If DSoR returns ten rows and says
nothing more, the agent may conclude the company has ten invoices. So in this tutorial,
an answer that was cut down says so (decision 2).

**Common mistake:** trusting the caller's `limit`. The limit is a request, like everything
the agent sends. DSoR takes it as a wish, never as an instruction.

## The design, before any code

This section was written by the learner with Claude Code, before any code existed. It
relies on these parts of the specification, each read on 2026-09-30:

- §7.1, DSOR-QRY-01.
- §7 and `operation-contract.schema.json`. The contract holds no field for a page size or
  a result size.
- §14, DSOR-TEN-02b, for step 12's cross-tenant suite: the tests that attack every
  operation from another company.
- §28. None of its codes names an answer that is too large.

If the code finds the plan wrong, the plan changes here first.

*Changed by the Stage 2 review, 2026-10-01.* Six reviewers audited steps 10 to 14. In
this step they found two gaps. The cross-tenant suite read only the first page of a list:
a planted list that slipped one row of `org_789` onto page 2 gave no finding. And the
64 KiB limit was never tested at its edge: with the pipeline measuring a page's `items`
alone, a result of 65,585 bytes left, and every test stayed green. Two changes follow. The
suite follows a list's `next_cursor`, page after page, and checks every page as it checks
the first (decision 6). And a test sends a page of one row whose items fit, but whose
cursor and `capped` take it past 64 KiB (C2). Two sentences of decision 3 said more than
the code, and are corrected there. The review's fixes from steps 07 to 12 are carried
here too ("Think it through").

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** No single call can read a whole table. DSoR, not the caller, decides how many
rows and how many bytes one answer holds, and says so when it cuts the limit down. The
analogy is the new clerk's handover: ten at most, never too heavy, and a note for the
rest.

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
   company's rows in each answer. *Changed by the Stage 2 review, 2026-10-01:* in every
   page of each answer, not only the first.

**Not the outcome of this step.** Stopping a slow read of everything. An agent that
follows the cursor page after page can still read every invoice, one call at a time. Each
call is recorded, so it is visible. The specification's answer is a row budget: a limit
on the rows one agent may read over a time window (DSOR-CLS-04b, an L2 rule). No step in
the map (the list of all steps, in `../readme.md`) builds it yet (see "Left open"). Also
not the outcome: filters and sorting chosen by the caller.

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
| DSOR-QRY-01 | **C1.** A page holds at most DSoR's maximum of rows, whatever the caller asks. The maximum is 10, and the page says when the limit was cut down: both our decision 2 | No `limit`: 10 rows. `limit: 1000000`: 10 rows, `capped`, a cursor. `limit: 3`: 3 rows, not capped |
| DSOR-QRY-01 | **C2.** No query's result is larger than DSoR's maximum size, 64 KiB here (our decision 3) | A page stops before the row that would take it past, with a cursor. A query whose one result is larger is refused. *Changed by the Stage 2 review, 2026-10-01:* so is a page of one row whose items fit, but whose cursor and `capped` take it past: the result is the whole page |
| DSOR-QRY-01 | **C3.** The cursor walks the whole list, once | Pages followed to the end visit every invoice of the company exactly once, in order, and the last has no cursor. Another company's id as a cursor is only a position in the sorted list of ids |
| (our decision) | **C4.** A `limit` must be a whole number of at least 1, and a `cursor` must look like an id | 0, -1, 1.5, and `"10"` are refused with `VALIDATION_FAILED` at line ⑥, the input check. So are a cursor of 65 characters, one with a NUL (the character whose code is 0), and one that is a `dsor://` URI |
| DSOR-TEN-02b | **C5.** Step 12's suite checks a list from both companies | Every row in `invoice.list`'s answer, for `org_456` and for `org_789`, asked with its example and with nothing, carries the caller's company. A planted list that leaks a row, returns a row with no company, or leaks only when asked with nothing, is a finding. *Changed by the Stage 2 review, 2026-10-01:* every page, by its cursor, up to 10 pages. A planted list that slips a row of `org_789` onto page 2 is a finding, and so is a list whose cursor never ends |
| DSOR-EXE-02 | **C6.** Each page is its own call, with its own record | Three pages leave three records |
| DSOR-TEN-01b | **C7.** The list's own SQL keeps to the company, without the database's lock | The owner, the database user that made the tables, lists each company through DSoR's store, page after page, and every row is that company's. Row-level security, the database's own company filter from step 11, does not stop the owner, so only DSoR's SQL is tested |

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
3. **No query's result may be larger than 64 KiB.**
   - The result is the data in the answer, written as JSON text, and counted in bytes.
     The correlation beside it, the request id and the caller's name, is DSoR's own and
     small. It is not counted. *Changed by the Stage 2 review, 2026-10-01:* not all of it
     is DSoR's own. The request id may be the caller's, up to 128 characters (step 05's
     decision 6). It is still small and still not counted, so a whole answer can be a few
     hundred bytes larger than 64 KiB.
   - A list stops adding rows before the row that would take its result past the limit,
     and gives the cursor from there.
   - It never drops the first row. So a page that has a cursor always holds at least one
     row, and the cursor always moves forward. A page with no rows and a cursor would
     send the caller back to the same place forever.
   - A page can still be empty. A cursor past the last invoice gives `{ items: [] }`,
     with no cursor.
   - A cut by size adds nothing of its own. `capped` still appears when the `limit` was
     above 10, and it still says `max: 10`, because it is about the limit. The
     `next_cursor` says that more rows follow.
   - After line ⑨, where the operation's code runs, the pipeline measures every query's
     result. One that is still too large, such as a page whose one row is larger than
     64 KiB, is refused with `UNSUPPORTED_CAPABILITY`, "the answer is larger than DSoR
     gives in one call".

   *Downside:* §28 has no code for this. `UNSUPPORTED_CAPABILITY` with retry `never` is
   the closest: asking again gets the same answer. It is a question for the
   specification. And a row that is too large blocks every row after it, because no page
   can step over it. *Changed by the Stage 2 review, 2026-10-01:* that is true of the
   pages DSoR hands out, and not of a caller. Every page ends before such a row, and the
   page that starts at it is refused, so a walk that follows DSoR's cursors stops there.
   But a cursor is only a place in the order (decision 4). A caller that sends a cursor of
   its own, such as that row's id, steps past it and reads the rows after it.
4. **The list is in order of invoice id, and the cursor is the last id of the page.** The
   next page is `WHERE tenant_id = <the company> AND id > <cursor> ORDER BY id`, one row
   more than the page needs, to know whether another page follows. The cursor is a
   position in the caller's own company only. A cursor that names another company's
   invoice id is only a position in the sorted list of ids. It tells nothing about that
   invoice.
   The order is the database's: text compared by its character codes (`C.UTF-8`,
   checked live on 2026-09-30), the same order JavaScript's `<` gives these ids in memory.
   The SQL does not name that order itself (see "Left open").
   *Downside:* an invoice added behind the cursor while a caller is paging is missed by
   that walk.
5. **A `limit` must be a whole number of at least 1, and a `cursor` must look like an
   id,** both checked by `invoice.list`'s input schema at line ⑥. The schema sets no
   maximum for `limit`, so a large one passes line ⑥ and is cut down, as the map's "done
   when" asks, instead of refused. The rule would allow a refusal too: cutting is this
   tutorial's choice. A cursor holds only letters, digits, `_`, `.`, and `-`,
   the characters the specification's `resourceUri` allows in an id, and at most 64 of
   them. So a cursor cannot carry a URI, a NUL character, or five megabytes of text.
   Found by the review: before this, a NUL cursor reached PostgreSQL, which refuses NUL in
   text, and the answer was `INTERNAL_ERROR`. *Downside:* a caller that asks for a
   million is not told "no". It is told "here are ten, and you asked for a million". And
   64 characters is this tutorial's number: an invoice id longer than that could not be a
   cursor.
6. **Step 12's suite learns a second check, for lists.**
   - A list names no single thing. Its input is a page size and a cursor, and a cursor
     cannot hold a URI (decision 5). So there is nothing to swap.
   - Its example still holds every field its input schema lists, as step 12 asks:
     `{ "limit": 10, "cursor": "INV-1000" }`.
   - A query whose example holds no URI is accepted only when its answer is a page,
     `{ items: [...] }`. The suite asks once, as the first caller of `org_456` who may
     call it. It asks only a query, because a command would run.
   - If that answer is a page, the suite calls the list as every such caller of both
     companies, twice. First with its example. Then with only the fields its input schema
     requires, `{}` here, because a list may leak on a path its example does not take.
   - Every item must carry `tenant_id` equal to the caller's company. An item with no
     `tenant_id` is a finding, because it cannot be checked. A page with no items is a
     finding too, because it checks nothing: a list with no company filter at all would
     pass it.
   - If the first answer is not a page, or the operation is a command, it gets step 12's
     finding, once, word for word.

   *Downside:* the suite counts `invoice.list` as attacked without sending it a foreign
   URI, because there is no place for one (see "What the specification asks", point 4).
   And it trusts an operation that answers with a page to return items that carry their
   company. A single-thing operation that returns a one-item page would be checked by its
   rows, not by a swap.

   *Changed by the Stage 2 review, 2026-10-01:* the suite read only the first page of each
   call. A planted list that slipped one row of `org_789` onto page 2 gave no finding.
   - Now, after each call's first page, the suite follows `next_cursor`. It sends the same
     input again, with `cursor` set to that value, as `invoice.list` takes it (decisions 1
     and 4).
   - It checks every page as it checks the first. A refusal is a finding. Every item must
     carry the caller's company. And the whole page is searched for the other company's
     **canaries**, values that only the other company's rows hold, such as `VENDOR-77`
     for `org_456`. That search is step 12's, carried here (step 12's decision 8). The bare
     call's first page is searched that way too. Before the review, only its items were
     checked.
   - The walk stops at a page with no cursor, or after 10 pages, the first included. A
     cursor that has not ended by then is a finding: the pages after them were not checked.

   *Downside:* more calls, 8 more for the shipped list, because `org_456`'s twelve
   invoices take two pages. An honest list longer than 10 pages is named too, so its
   example must keep the walk short. And the suite assumes the cursor goes back as
   `cursor`. A list that names it otherwise gets its page 2 refused: a finding, never a
   silent pass.
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
  answered with data. *Changed by the Stage 2 review, 2026-10-01:* a page of one row is
  refused when its items take exactly 64 KiB as `{ items }`, and its cursor and `capped`
  take the whole page to 65,595 bytes.
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
  finding, and is never called. *Changed by the Stage 2 review, 2026-10-01:* a list that
  slips `org_789`'s `INV-2001` onto `org_456`'s page 2 is a finding from both calls, as the
  row is and with its `tenant_id` rewritten, and so is a row with no `tenant_id` there.
  So is a list of one row a page whose last page, page 10, holds `org_789`'s row. A
  list whose cursor never ends is read for 10 pages from each call, then named, and each
  page after the first is asked with the same input and the new cursor. A list that hands each company the other's
  `INV-1008`, its `tenant_id` rewritten, is a finding on both calls, through the search for
  canaries. And a fake DSoR that slips `org_789`'s invoice into `org_456`'s pages, after the
  pipeline has checked them, is named by the suite's own check of the items.
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
| X5 | The list's SQL forgets the company | the suite's list check on memory. On the database, only C7's owner test: the second lock, row-level security, hides it from every other | red on memory, green on the database (predicted before C7 was added) |
| X6 | The suite's list check accepts an item with no `tenant_id` | only C5's planted item | only the planted item test |

The review also attacks the step with the threat that is its reason: bulk extraction by
an allowed caller, through a large `limit`, a forged cursor, or a loop.

### Left open, and not this step's idea

- **Stopping a slow read of everything.** Each call is bounded, but a caller can call
  again and again. §19.2 answers it with row budgets: DSoR MUST enforce budgets on rows
  returned per agent principal and per delegation over a time window (DSOR-CLS-04b), and a
  budget MUST NOT be keyed on an identifier the caller can mint (DSOR-CLS-04c). Both are
  L2 rules, and no step in the map names them. Found after the build, on 2026-10-01: this
  line first said only that §28 has `RATE_LIMITED`. Step 25's emergency brake can stop an
  agent by hand. The missing step is proposed in `../mj_notes.md`, for a maintainer.
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
   migration `006`. *Changed by the Stage 2 review, 2026-10-01:* and migration `003b`, if
   the branch it was made from has not run it.
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
| `src/operations.ts` | `invoice.list`'s code: one row more than the page holds, after the cursor, inside the active company. Since the Stage 2 review, it reads through the list bound to that company, `company.invoices.list(after, count)` |
| `src/invoice.ts` | The same new invoices in memory. The store gains `list(tenant, after, count)`, and `listInvoices` is its memory version |
| `src/postgres.ts` | The list's SQL. `invoiceOf`, one row as an invoice, is now shared by `get` and `list` |
| `src/pipeline.ts` | After line ⑨, `checkResultSize` measures every query's result |
| `src/main.ts` | The agent asks for a million invoices, and the program prints the ten it gets |
| `test/invoice-list.test.ts`, `test/invoice-list.db.test.ts` | **New.** C1, C3, and C4 on memory. C1, C3, C6, and C7 on the database |
| `test/result-size.test.ts` | **New.** C2. Since the Stage 2 review, a page of one row whose cursor and `capped` take it past 64 KiB |
| `test/cross-tenant-lists.test.ts` | **New.** C5, with planted lists. Since the Stage 2 review, lists that leak on page 2 or never end, a row with its `tenant_id` rewritten, and a fake DSoR that slips a row in after the pipeline |
| `test/cross-tenant.ts`, `test/companies.ts` | The suite's list check: `isPage`, `pageProblem`, the one question it asks a query with no URI, and the second, bare call. Since the Stage 2 review, `checkPage`, which also searches a page for canaries, and `walk`, which follows `next_cursor` for up to 10 pages (decision 6) |
| `test/owner-store.ts`, `test/db.ts` | The owner's `list` mode, page after page, and `ownerList` (C7) |
| `test/helpers.ts` | `idsOf`, a page on one line, and `walk`, a caller that follows the cursor |
| every other test | Counts of two operations became three. Two earlier tests used `invoice.list` and `InvoiceListRequest` as made-up names. They now use `invoice.list_all` and `InvoiceSearchRequest`, which still do not exist. The program's log test counts 10 records of 13 calls |

Every other file is step 12's, without its `NEW IN STEP` markers. No new dependency.

*Changed by the Stage 2 review, 2026-10-01:* that review fixed seven findings that began in
earlier steps, and this folder carries them too. Line ① makes the one copy of the input
(step 07's decision 9). A company id has 1 to 18 digits, and migration
`003b_bounded_claims.sql` makes the log refuse a large claim (step 10's decision 12). The
operation's code gets only the active company's invoices, from `src/company.ts`, and its
answer must hold no other company's row (step 10's decisions 13 and 14). From this step,
that company's store lists too: `list(after, count)`, with no company to name.
`inCompany` checks that its `COMMIT` really committed (step 11's decision 10). The program
started as the owner must name every fact the start-up check reads from the database (step
09's decision 17, and step 11's decision 7). The catalog guard looks at every schema, view,
and function (step 11's decision 1). And the suite searches whole answers for canaries,
sends the in-company pair, and tests its judge through fake DSoRs (step 12's decisions 4
and 8, and its C2). Step 12's folder holds these too, so the commands below show them
only where this step changed the same lines. New files: `src/company.ts`,
`test/company.test.ts`, and `migrations/003b_bounded_claims.sql`.

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
pnpm migrate      # runs 003b and 006 if your branch has not, and sets dsor_runtime's password again
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

*Changed by the Stage 2 review, 2026-10-01:* on this folder's branch `step-13`, `pnpm
migrate` also ran `003b`, which that review added in step 10:

```text
dsor_runtime: password set again from DSOR_DB_URL
migration 003b_bounded_claims: done
```

On the code after that review, `pnpm check` prints `774 passed`, and `pnpm test:db` prints
`92 passed`. Before it, they printed `669 passed` and `75 passed`.

## Break it

Every break of the design's table, performed on 2026-09-30 and 2026-10-01, one at a time,
in a copy of this folder, then put back from a backup and compared byte for byte. They ran
twice: on the step before the review (commit `3498106`), and on the final code, after the
review and the sweep. X2, X4, and X5 change what the database reads, so they also ran on
the database tier.

*Changed by the Stage 2 review, 2026-10-01:* every break ran again on the code after that
review, in this folder, each put back from a backup and compared byte for byte. The last
column holds those runs, over all 774 unit tests and all 92 database tests. The database
totals in the earlier columns, "1 of 33" and "1 of 35", counted three of the seven
database files. Each break was written this way: X1, `pageSize` returns `limit ??
MAX_ROWS`; X2, it returns `Number.MAX_SAFE_INTEGER` for no limit; X3, the line that sets
`capped` is deleted; X4, `>` becomes `>=` in memory and in the SQL; X5 in memory, the
filter drops `invoice.tenant_id === tenant`; X5 in SQL, `tenant_id = $1` becomes `$1::text
IS NOT NULL`; X6, an item with no `tenant_id` is skipped.

| # | The break | Learner's prediction | Before the review | On the final code | After the Stage 2 review |
| --- | --- | --- | --- | --- | --- |
| X1 | The caller's `limit` is obeyed | not asked | 2 unit: the million test, and 10 against 11 | 3 unit: the same two, and the store-count test | 3 unit, the same |
| X2 | No `limit` means every row | not asked | 1 unit, 1 database: the empty-input test | 2 unit: the empty-input test and the store-count test. 1 database: the empty-input test | 5 unit: the same two, and the three page-2 tests: the bare call's page holds every row, so there is no page 2 to reach. 1 database, the same |
| X3 | `capped` is left out | the million test | 2 unit: the million test, and 10 against 11 | 3 unit: the same two, and the page cut by limit and by size | 4 unit: the same three, and the one-row page at the 64 KiB edge, which expects `capped` |
| X4 | The cursor uses `>=` instead of `>` | C3 | 1 unit, 2 database: the walks | 3 unit: the walk, the store after a cursor, and the copy test. 4 database: both walks, the store after a cursor, and C7, whose owner walks too | 5 unit: the same three, the page-2 row with no `tenant_id`, which lands one place later, and the leak on page 10, which a cursor that repeats its own row never reaches. 4 database, the same |
| X5 | The list forgets the company: in memory | red on memory | 30 unit | **33 unit**: every suite test over the shipped registry, C1, and C3 | **62 unit**. The pipeline refuses the page that mixes the companies, with `INTERNAL_ERROR` (step 10's decision 14), so every suite test over the shipped registry fails, and so do C1, C3, and the tests of the bound list |
| X5 | The list's SQL forgets the company | green on the database | 0 unit. On the database, **only C7**, 1 of 33 | 0 unit. On the database, **only C7**, 1 of 35 | 0 unit. On the database, **only C7**, 1 of 92 |
| X6 | The suite accepts an item with no `tenant_id` | only the planted item test | 1 | 1, as predicted | 2: the planted item test, and the page-2 row with no `tenant_id` |

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
1000000, max: 10 }`. It claims a cut it did not make. The code sets `capped` in one place
and applies the cap in another. The two can drift apart, and only a test that checks both
at once notices.

**X5, on the database, the second lock at work.** Take the company out of the list's SQL,
and every database test but one stays green, 34 of 35 on the final code: row-level
security hides the missing filter from every caller that logs in as `dsor_runtime`. Only
C7 sees it, because the owner bypasses row-level security. *Changed by the Stage 2 review,
2026-10-01:* "34 of 35" counted three of the seven database files. Over all seven, after
that review, it is 91 of 92:

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
database tests that the review ran, in three of the seven files, because the owner read
only one page. With the owner walking page after
page, C7 names `org_789`'s five invoices. And a cursor that is looked up across companies
(`id > the row whose id is the cursor`, in any company) passed the first foreign-cursor
test, which compared two empty pages. The test from `org_789`, `INV-1010` against
`INV-1099`, fails on it.

**The Stage 2 review's breaks, run on 2026-10-01.** Two checks of this step were right,
and no test proved it. So each was broken on purpose, before and after its new tests.

First, in `test/cross-tenant.ts`, the suite's two calls of `walk` are deleted, so it reads
only page 1 again. Before the review's tests, every test passed. Now the five tests of
the walk fail, and every other test passes:

```text
× DSOR-IDN-03b: a list that slips org_789's INV-2001 onto org_456's page 2 is a finding, from both calls
× DSOR-IDN-03b: a list that slips org_789's INV-2001, its tenant_id rewritten, onto org_456's page 2 is a finding, from both calls
× DSOR-IDN-03b: a list that slips org_789's INV-2001 onto page 10, its last, is a finding, from both calls
× DSOR-TEN-02b: a list that slips a row with no tenant_id onto org_456's page 2 is a finding, from both calls
× DSOR-TEN-02b: a list whose cursor never ends is read for 10 pages from each call, then named
AssertionError: expected [] to strictly equal [ …(8) ]
      Tests  5 failed | 769 passed (774)
```

Second, in `src/pipeline.ts`, the size check measures a page's items alone:
`checkResultSize((data as { items?: unknown } | null)?.items ?? data)`. Before the new
test, every test passed: 771. Now:

```text
× DSOR-QRY-01: a one-row page whose items fit, but whose cursor and capped take it past 64 KiB, is refused, not sent
AssertionError: expected { data: { …(3) }, …(1) } to strictly equal { Object (code, message, ...) }
      Tests  1 failed | 773 passed (774)
```

The page left as data: one row, its cursor, and `capped`, 65,595 bytes. The items alone
measured 65,526 bytes, under the limit.

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
2. For `limit: 1000000`, this tutorial answers ten rows and `capped`. Why not refuse, and
   why not ten rows with nothing more?
3. `org_789` sends `INV-1010`, an id only `org_456` has, as its cursor. What comes back,
   and why does it tell `org_789` nothing about `org_456`?
4. Why does this tutorial count a page in rows and a result in bytes, both?
5. Can an agent still read every invoice? What does this step change about how?

<details>
<summary>Answers</summary>

1. Reading one invoice and reading a million need the same permission. The harm is in the
   amount, so the amount needs a limit of its own.
2. The limit is the caller's wish, and DSoR answers it as far as its own maximum
   allows. The rule would allow a refusal too. Cutting is this tutorial's choice
   (decision 5), and the map asks that a million rows return one page. Without
   `capped`, ten rows look like "the company has ten invoices": a wrong answer that
   looks right.
3. `INV-2001` to `INV-2004`, the same as for the made-up cursor `INV-1099`. The cursor is
   only a position in the caller's own sorted list of ids. DSoR never looks it up, so
   whether `org_456` has that invoice changes nothing.
4. A row count misses one huge row. A size in bytes catches it, whatever the rows hold.
   And the byte cap alone would let a million tiny rows through.
5. Yes, a page at a time, following the cursor. Each page is a separate call with its own
   record, so reading everything is slow and visible. Nothing in this step stops it. The
   specification's answer is a row budget per agent over a time window (DSOR-CLS-04b), an
   L2 rule that no step builds yet.

</details>

## Think it through

**Changed by the design check, before the first test (2026-09-30).**

- **C7 was added.** Break X5 would have survived every test. The unit tests never run the
  list's SQL, and on the database row-level security hides a missing company filter.
  Step 11 closed the same gap for `invoice.get` by letting the owner, whom row-level
  security does not stop, run DSoR's store. The list gets the same test.
- **The 64 KiB counts the result, not the whole answer** (decision 3). The list's code
  builds the data and cannot see the correlation that the pipeline adds after it.
- **A page never drops its first row for size** (decision 3). The review later found
  that this was first worded as "a page always holds a row", which is false. And the
  suite asks a no-URI operation once before it attacks it (decision 6).
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
- **Sentences read as rules of DSoR** where they were this tutorial's choices: ten rows,
  "must say so", and how a size is counted.

**Found by the mutation sweep, and fixed.** The sweep made 96 small breaks on the code
before the review. 69 were caught by the tests, 2 only by the typecheck, and 25
survived. The review's fixes closed four of them: the bracket bug, a cursor of any type,
the NUL cursor, and a URI as a cursor. Of the rest, these were real, and each now has a
test that fails on it:

- **The cap held only after the rows were read.** A handler that asked the store for the
  caller's million, a store that ignored its count, and `LIMIT $3 + 1000` in the SQL all
  gave the same pages, because `pageOf` cut them afterwards. Now the code must ask the
  store for 11 rows for no limit, 11 for a million, and 4 for a limit of 3: one more
  than the page. And both stores must give exactly what they are asked for.
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

**Found by the Stage 2 review (2026-10-01), and fixed.** Six reviewers audited steps 10
to 14 and the seams between them (`../mj_notes.md`). They found no live leak. Seven of
their findings began in earlier steps, and this folder carries the fixes. One began here,
in the suite's check of a list.

- **A check and the code could see two different inputs.** Fixed from step 07 on. Lines
  ① and ② read the input itself, to check the principals and the companies it names.
  Line ⑥ then made its own copy, for the schema check and for the code. A getter, a
  field that runs code each time it is read, can answer the second read differently. In
  the red run here, the code was handed `principal: "cfo_100"` after line ① saw the
  caller, and `tenant_id: "org_789"` after line ② saw `org_456`.
  - **Fixed:** line ① makes the one copy, right after it finds who is calling. Every
    check and the code read that copy (step 07's decision 9). An input that JSON cannot
    copy is still refused with `VALIDATION_FAILED`, at the end of line ②, once the
    principals and the companies it names are checked.
  - **Caught by** step 07's and step 10's tests, carried here, in `test/pipeline.test.ts`
    and `test/who-is-calling.test.ts`. Eight of them failed in the red run.
- **A company id had no length, and the log kept a claim of any size.** Fixed from step
  10 on. In step 14, an envelope naming `org_` and a million digits got a refusal of 212
  bytes, and left a record of 1,000,433 bytes that `dsor_runtime` can never remove. In
  the red run here, four unit tests failed: 19 digits and a million digits passed the
  form check, the record kept the claim, and `parseUri` took a company of 19 digits.
  - **Fixed:** a tenant id has 1 to 18 digits, and migration `003b` makes the log refuse
    an `extensions` over 1,024 bytes (step 10's decision 12). It ran on the branch
    `step-13` on 2026-10-01. Before it ran, its two database tests failed: as
    `dsor_runtime`, an `extensions` of 2 KB went in, and so did one of 1,025 bytes, each
    in a transaction that was rolled back.
  - **Caught by** the 19-digit and million-digit cases, and the tests titled `step 10's
    decision 12: …`, in `test/tenants.test.ts`, `test/uri.test.ts`, and
    `test/tenants.db.test.ts`.
- **The code could name another company, and both locks trusted it.** Fixed from step 10
  on. The high finding. The operation's code named the company at each read, and the
  store set that company for the database's policy too. In the red run here, the
  review's one-line fallback in `invoice.get`, `?? await invoices.get("org_456", id)`,
  let `user_700`, in `org_789`, read `org_456`'s `INV-1001`, and all 693 unit tests
  passed.
  - **Fixed, in two layers:** the code gets `companyOf(store, tenant)`, the active
    company's invoices only (step 10's decision 13). From this step, that store lists
    too, with `list(after, count)`: a place and a count, and no company to name. Every
    `tenant_id` in the code's answer, on every item of a page too, must be the active
    company's, or the call fails with `INTERNAL_ERROR` (step 10's decision 14).
  - **Caught by** step 10's C8, in `test/company.test.ts`, `test/tenants.test.ts`, and
    `test/tenants.db.test.ts`, with tests of their own for the list. The fallback no
    longer passes `pnpm typecheck`, "Expected 1 arguments, but got 2", and at run time
    `user_700` hears `RESOURCE_NOT_FOUND`. With the code handed a bare company id again,
    73 unit tests failed. With the answer check taken out, 11 failed, and on the
    database, code that made a store of its own read `org_789`'s `INV-2001` for a caller
    in `org_456`.
  - **What it changed here:** two of this step's planted lists answer with a row of
    another company. One hands `org_456` one of `org_789`'s invoices. One forgets the
    company when asked with nothing. The pipeline now refuses their pages with
    `INTERNAL_ERROR` before the suite sees them. The first now gets step 12's finding, "no
    URI of org_456 in its example", because decision 6's one question gets no page. To
    keep the suite's own check of the items proven, a fake DSoR now slips the row into
    `org_456`'s pages after the pipeline has checked them. And break X5, in memory, now
    ends in `INTERNAL_ERROR` ("Break it").
- **A transaction counted as kept when it was not.** Fixed from step 11 on. In the red
  run here, with the answer to `COMMIT` not read, work that swallowed its own failed
  statement looked kept: "promise resolved 'done' instead of rejecting". With the
  `COMMIT` not awaited at all, both tests failed, and the log's caller got the invoice.
  - **Fixed:** `inCompany` reads the answer to its `COMMIT`. Anything but `COMMIT` is the
    error "the transaction was rolled back" (step 11's decision 10).
  - **Caught by** `step 11's decision 10: …` in `test/rls.db.test.ts`, and `DSOR-EXE-03b:
    a log whose COMMIT fails gives no invoice, and no record`, in `test/audit.db.test.ts`.
    That second test uses **fault injection**, an error planted on purpose (§47): it
    wraps the real client, so every statement reaches the real database except the first
    `COMMIT`, which fails.
- **The start-up check's database facts were proven only with hand-made facts.** Fixed
  from step 09 on, with the membership of roles from step 11 on. In the red run here,
  each of four changes to the SQL in `runtimeRoleProblems` turned the owner's test red:
  `rolbypassrls` and the membership of `pg_write_all_data` read as `false`, and the
  counts of tables owned and of roles read as `0`.
  - **Fixed:** the test that starts the program as the owner requires `holds BYPASSRLS`,
    `is a member of pg_write_all_data`, `owns … tables`, and `belongs to … other role…,
    which SET ROLE can switch to`.
  - **Caught by** `DSOR-AUD-04a: refuses to run as the owner, names why, and makes no
    call`, in `test/program.db.test.ts`.
- **The catalog guard missed a kind of schema name, and every view and function.** Fixed
  from step 11 on. The catalog guard is step 11's test that reads PostgreSQL's own list of
  tables, its **catalog**, to find every table with a company column. It skipped any
  schema whose name starts with `pg`, and it looked at tables only. In the red run here,
  the old filter, `NOT LIKE 'pg_%'`, dropped `pgcrm` from all three planted lists.
  - **Fixed:** step 11's decision 1 widens to the other ways around a policy: a view, a
    saved query that reads with its owner's rights; a materialized view, a stored copy of
    rows; a foreign table, read from another server; and a `SECURITY DEFINER` function,
    which runs with its owner's rights. Three guards check that none exists.
  - **Caught by** the C1 tests in `test/rls.db.test.ts`, each filter shown on planted
    rows.
- **The mystery shopper missed leaks that do not label themselves.** Fixed from step 12
  on. In step 14, an operation answered `cfo_100`, in `org_456`, with `org_789`'s
  invoice, its `tenant_id` rewritten to `org_456`. `cfo_100` got `VENDOR-77` and
  `99000.00`, and step 12's suite reported no finding. In the red run here, 34 tests
  failed against the old suite, every planted leak the review named among them.
  - **Fixed, as in step 12:** the whole answer is searched for canaries, tenant keys, and
    URIs of another company. Fake DSoRs test the judge through the suite. The in-company
    pair compares a query's own "not found" for an id only the other company holds with
    its answer for `NOPE`. Empty data is no data. And a planted `test.free` proves through
    a call that the checklist searches the whole input.
  - **Adapted to this step's data.** The canaries are worked out from the rows, as in
    step 12. With decision 7's invoices, `org_456` has 11 of them, and `org_789` has 28,
    `cancelled` among them, because only `org_456` holds a cancelled invoice. The
    in-company pair runs from both companies now, not from `org_456` only: `org_456`
    holds `INV-1001`, which `org_789` lacks. So `org_789`'s readers send `INV-1001` and
    `NOPE`, and every test of the pair expects its findings in both companies. And the
    suite's list check searches its pages for canaries too, the bare call's page included
    (decision 6).
  - **Caught by** C2, C4, C7, and C8 in `test/cross-tenant.test.ts`, C5 in
    `test/cross-tenant-lists.test.ts`, the database suite's check of the canaries' rows,
    and the `test.free` tests in `test/tenants.test.ts`.
  - **Broken on purpose:** the fakes and `test.free` guard code that is right, so they
    cannot be red before a break. With the suite's judge replaced by a check that flags
    only data, only the four fakes failed. With the checklist handing its URI search only
    the input's top-level texts, only the two `test.free` tests failed.
- **The mystery shopper read only page 1 of a list, and the 64 KiB limit was never tested
  at its edge.** Found here. In the red run, three new tests failed against the suite as
  it was: a list that slips `org_789`'s `INV-2001` onto `org_456`'s page 2, as the row is
  and with its `tenant_id` rewritten, gave no finding, and so did a list whose cursor
  never ends. And with the pipeline measuring a page's `items` alone, all 771 unit tests
  passed.
  - **Fixed:** the suite follows `next_cursor` from both of a list's calls, and checks
    every page as it checks the first, for up to 10 pages (decision 6). And a test sends
    a page of one row: 65,536 bytes as `{ items }`, 65,595 bytes with its cursor and
    `capped`. It is refused (C2).
  - **Caught by** C5's new tests in `test/cross-tenant-lists.test.ts`, and C2's new test
    in `test/result-size.test.ts`, which fails with the pipeline measuring `items` alone
    ("Break it").
  - **A check of this fix** found two more holes, each closed red first: a walk that left
    the items of page 2 unchecked, and a walk that sent the cursor alone, without the
    rest of the input, each passed every test. A page-2 row with no `tenant_id`, and the
    exact inputs of the agent's two walks, now catch them.
  - **Found by the orchestrator's hostile check:** every planted leak sat on page 2, so a
    walk that checked only pages 1 and 2 passed all 773 tests. A list that holds one row
    a page now ends on page 10, the last page the walk reads, with `org_789`'s `INV-2001`
    there. A check that stops at any page before it fails that test, page 3 and page 10
    both shown red. So do a walk limited to 3 pages and one that quietly stops after
    page 3. `pnpm check` now prints `774 passed`.
- **Sentences that said more than the code.** "In plain words" said DSoR caps "the size
  of one answer": it caps the data, and not the correlation beside it. Decision 3 called
  the correlation "DSoR's own", but its request id may be the caller's. Decision 3 also
  said no page can step over a row that is too large, but a cursor the caller makes up
  can. Two database counts in "Break it", "34 of 35" and "all 33", counted three of the
  seven database files. And the header of `src/main.ts` left out the list this step
  added. Each is corrected where it stands.

- **The owner-store test needed records that other tests had left.** Found by step 15's
  build, on a branch made fresh from `main`: the log was empty, so `DSOR-TEN-01b: with every
  policy skipped, DSoR's own store still finds only org_456's rows` failed, or passed only
  after another file had written records. With no `org_789` record in the log it had no
  teeth. Fixed from step 11 on: the test writes a record of each company first, and may take
  60 s, as long as the owner's program it starts.

**Found by step 16's review (2026-10-03), and fixed from step 09 on.**

- **The log trusted an `INSERT` that kept nothing.** `add` sent its `INSERT` and never
  asked how many rows the database wrote. The owner can attach code to a table that runs
  at each `INSERT`: a rule `DO INSTEAD NOTHING`, or a trigger that returns `NULL`. Either
  one makes the database take the `INSERT` and keep no row. The program then answered the
  call, and no record of it existed.
  - **Fixed:** `add` throws unless the `INSERT` wrote exactly one row. The check runs
    inside `inCompany`'s work, so the transaction is rolled back, and the caller hears
    `EVIDENCE_STORE_UNAVAILABLE` (DSOR-EXE-03b).
  - **Caught by** `DSOR-EXE-03b: a log whose INSERT keeps no row gives no invoice, and no
    record`, in `test/audit.db.test.ts`. It uses fault injection, as the `COMMIT` test
    beside it does. Only the log's `INSERT` is swapped, for an `INSERT … SELECT … WHERE
    false` with the same values: a real statement on the real database, which keeps no
    row. The test also checks that the database ran that statement and kept 0 rows, so
    it cannot pass on a statement the database refused.
- **The start-up check read PostgreSQL's names through the search path.** The **search
  path** is the list of schemas PostgreSQL looks in to find a name such as
  `has_table_privilege`. The owner can put `public` first, and make functions there with
  PostgreSQL's names that answer "no". Then a login that can change the log passes the
  check.
  - **Fixed:** the check runs inside a transaction that starts with `SET LOCAL
    search_path TO pg_catalog, pg_temp`. `SET LOCAL` lasts only until the transaction
    ends. The check now takes one connection as well as a pool. Given a pool, it opens a
    read-only transaction of its own.
  - **Caught by** two tests in `test/audit.db.test.ts`. `DSOR-AUD-04a: the start-up check
    reads PostgreSQL's own names, whatever the search path finds first` runs a child
    program, `test/owner-login-check.ts`. As the owner, inside a transaction that is
    rolled back, it makes look-alikes of `has_table_privilege`, `has_any_column_privilege`,
    and `pg_has_role` in `public`, which answer "no". It puts `public` first, and runs the
    check on that connection. `DSOR-AUD-04a: the start-up check pins the search path
    inside a transaction of its own` guards the pool's path, the one the program uses.
    Outside a transaction, PostgreSQL ignores `SET LOCAL` and warns, so the test expects
    no warning.
- **Red first, and broken on purpose.** In the red run here, two of the three tests
  failed. The call answered with `INV-1008` and its 31,400.00 USD, and no record was
  kept. The owner's problems were four, and "can change or remove records in dsor.audit"
  and "is a member of pg_write_all_data" were not among them. The third test passed, as
  it should: it guards the pool's path, which the fix added. Then three breaks, one at a
  time, each put back and compared byte for byte: `add` ignoring the row count, the check
  without `SET LOCAL`, and the pool's path without its `BEGIN`. Each turned its own test
  red, over all 774 unit tests and all 95 database tests. No other test failed, except
  once: in the third break's run, a test that never calls the check went over its limit
  of 30 seconds. Run again with the break in place, it passed. The database tests went
  from 92 to 95.
- **Strengthened after a review of step 15's port.** Two breaks passed every test above:
  the check writing `pg_catalog.` in front of its three functions instead of pinning the
  search path, and the pin skipped for the pool's own connections. So the owner's child
  program also plants a look-alike of the view `pg_roles`, which says no login holds
  `BYPASSRLS`, and the first test expects "holds BYPASSRLS" too. The pool's test notes
  each statement its connection sends, and expects exactly `BEGIN READ ONLY`, the
  `SET LOCAL`, the check, and `ROLLBACK`. Both breaks now fail a test, and the check
  without `SET LOCAL` now fails both login tests, not one.

**Left open on purpose**, with the reason:

- **Equivalent breaks**, which change nothing a caller can see: `limit ?? Infinity`
  (`Math.min` still caps it), `after ?? ""` for no cursor, an example with `limit: 1`,
  and the one question asked when nobody in `org_456` may call the operation (another
  finding is raised anyway).
- **The contract's `output.schema` and `tenancy.required` are read by nothing.** Changed,
  every test stays green. That is true of every contract since step 03, not only this
  one.
- **The owner's `bypassrls` could be hard-coded to true** and pass on this branch.
  `bypassrls` is the owner's power to skip row-level security. If the owner lost it, the
  test would check the database's filter instead of DSoR's own, without saying so. The
  same holds for step 11's owner check.
- **A lowercase cursor, such as `inv-1004`, sorts after every id** and gives an empty
  page. It is a place in the order, as decided, not an error.
- **Nothing limits the size of a whole request.** The cursor is capped at 64
  characters, and `limit` is a number, but a request's size in general is not this
  step's idea.
- **A slow read of everything is still possible,** as "Not the outcome" says. The
  review's attack read `org_456`'s twelve invoices in two calls, or in twelve calls of
  one row, each call recorded. Nothing counts them yet: that is DSOR-CLS-04b's row
  budget.
- **The walk reaches two calls, and 10 pages of each.** The suite follows the cursor from
  the example and from the bare call only. A list that leaks only for some other
  `limit`, such as `limit: 1`, is not reached. And an honest list longer than 10 pages is
  named, a false finding: noisy, never silent. Found by the Stage 2 review.
- **"Canary" is step 12's word, carried here:** a value whose appearance shows that
  something leaked. It is not on the house list of analogies, and step 12 flags it for
  review.
- **`test/cross-tenant.ts` is 401 lines** after the Stage 2 review, and
  `test/companies.ts` is 260, far above the 150 this tutorial aims for. The list check,
  with its walk, could move to a file of its own. That is a change of its own, so it waits.

**What the predictions showed.** Four times a test passed before its code: C4's 1.5 and
`"10"`, C2's "exactly 64 KiB is answered", the cursor of 64 characters, and step 12's
`invoice.peek`. Each time the learner expected red. A "yes" test passes as long as
nothing says no, and a "no" test passes as soon as some earlier code already says no.
Neither proves the new code until a break shows it failing without it.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-QRY-01 | A server-side maximum page size and result size on every query, whether or not the client asks for a limit | [§7.1 Queries](../../../specs/dsor/01-model.md#71-queries) | `test/invoice-list.test.ts` and `test/invoice-list.db.test.ts`: no limit, a limit of a million, 3, 10, and 11 (C1), and the cursor walked to the end (C3). `test/result-size.test.ts`: rows cut by bytes, a result over 64 KiB refused, exactly 64 KiB answered, one byte more refused, bytes not characters (C2). *Changed by the Stage 2 review, 2026-10-01:* and a page of one row whose cursor and `capped` take it past 64 KiB, refused, so the result is the whole page (C2) |

Also advanced, first met in earlier steps: DSOR-TEN-02b, the suite checks a list by its
rows, from both companies, asked with its example and bare (C5,
`test/cross-tenant-lists.test.ts`), though a list takes no URI to send it ("What the
specification asks", point 4). *Changed by the Stage 2 review, 2026-10-01:* every page,
by its cursor, and each page searched for the other company's canaries. DSOR-TEN-01b, the list's own SQL without row-level
security (C7, `test/invoice-list.db.test.ts`). DSOR-IDN-03b, another company's id as a
cursor (C3). DSOR-EXE-02, one record for each page (C6, `test/invoice-list.db.test.ts`),
and for a result refused for its size (`test/result-size.test.ts`). The fixes this folder
carries from steps 07 to 12 keep their rows in those steps' READMEs.

## Next

Step 14 · Classification and masking: each field gets a sensitivity label, and a field
above the caller's clearance, such as an invoice's `amount` for the agent, is hidden
before the answer leaves, with a list of what was hidden.
