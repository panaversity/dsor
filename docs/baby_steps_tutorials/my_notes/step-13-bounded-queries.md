# Step 13 · Bounded queries

Folder: [`my_13_bounded_queries`](../my_13_bounded_queries/README.md) · 468 tests, plus 36 in the
database tier
Spec: [§7.1](../../../specs/dsor/01-model.md#71-queries) · `DSOR-QRY-01`
Both tiers have run: 468 under `pnpm check`, and 36 under `pnpm test:db` against Neon, the step's
own database `dsor_step13`, five migrations applied, none new — and rebuilt once, because the
marker edit in `004` changed its checksum. Decisions [102 to 104](decisions.md).

## What the step is

`invoice.list`, the first operation that returns many rows, with the size of the answer the
server's: a page holds at most a hundred rows, twenty-five when the caller says nothing, and an
answer at most 64 KiB as JSON. The next page comes after the last invoice on this one, named by its
address, so the cursor is checked by the §21.6 scan and moved by step 12's suite with nothing new.
The handler's SQL carries `LIMIT`; the door measures every answer anyway and refuses one over the
ceiling as the program's own error.

## How it was built

The problem first, measured on a copy of step 12 with a list written the obvious way and fifty
thousand invoices seeded: `{ limit: 1,000,000 }` gave all 50,002, three megabytes, in 105 ms.
Three decisions, one at a time ([decision 102](decisions.md)): the next page after the last invoice;
the cursor is an address; two numbers in one file and the door's refusal.

Three pieces, each red first, committed, broken on purpose:

1. **The list and the ceiling in the SQL** — `queries.ts`, `listInvoices`, the contract with an
   example whose cursor is an address, the handler, the `page` answer.
2. **The door's measuring** — `makeDoor` takes a handler table so a test can hand it a careless
   list; `overTheCeiling` refuses rows over a page and bytes over the result size.
3. **The demo** — one invoice a page, the cursor sent back, a million asked for.

## What the build found

**The cap in the SQL is invisible to an ordinary test.** The handler slices the page it hands
back, so a list that fetched everything and cut the page afterwards passes every assertion about
the page. A connection that counts what each statement returned, in front of the real one, is the
test that sees the `LIMIT`; without it, Breaks 1 and 5 pass.

**Step 12's promise held.** The suite grew by six questions for `invoice.list` with no edit, and
the demo's generated section printed a third line. The example's cursor is what made that
possible: an example with no address gets one failing test by name, and so would this list.

**Every count in the demo moved by four**: one refusal in the generated section, three pages read.
The pins say so.

## Limits, stated

- One page per request. Nothing limits how many pages a caller walks; each is a decision in the
  log, and a rate limit is a later step.
- The result size is measured on the answer as JSON, before transport.
- The numbers are provisional, like §44's ceilings.
- A page's audit record has no row count; `DSOR-CLS-05` is step 14's.

## The hostile review

Five reviewers, run while the README was being written: four graded the step from different
angles, and one ran a mutation sweep — thirty-two one-line changes to the code, each followed by
the whole suite. All five graded B, none found a false claim, and between them they found eight
holes, each worth a commit of its own.

What was fixed, each test written to fail first:

- The counting connection counted only statements shaped like the list (`FROM public.invoices`
  and `ORDER BY id`). A second, unordered read of the whole table before the slice passed. It now
  counts every statement that reads the table: `[101, 302, 26, 302]` where `[101, 26]` was
  expected.
- Error answers were exempt from the ceiling, with no reason written. A handler whose refusal
  carried ten megabytes in its message walked out of the door. Every answer is measured now, and
  the two messages no longer say "a query", because the door measures commands too.
- The byte ceiling was proven only with a careless handler and ASCII. Two tests: one seeded row
  wider than an answer may be, and both `invoice.list` and `invoice.get` refuse it; and three
  vendors of twenty thousand `€` — sixty thousand characters, a hundred and eighty thousand
  bytes — refused, where a copy that counted characters had handed them out.
- The list's own `WHERE tenant_id = $1` could be deleted with every test green, because
  row-level security filtered anyway. Asked as the owner, who bypasses RLS on PGlite, the SQL
  alone must answer one company.
- The walk test compared pages with JavaScript's `sort()`, which agrees with PostgreSQL on
  PGlite's C collation and need not on a server whose collation ignores punctuation. It compares
  with the database's own `ORDER BY` now.
- The "well inside" test measured the page where the door measures the whole answer.
- The demo pin was titled `DSOR-QRY-01` and passed with the cap and the door's check both
  deleted, because two invoices print two either way. The id is gone from its title. And the
  demo's "limit 1,000,000" label was a string beside the request: a mutation sent two and the line
  still said a million. The label is built from the request now.
- `NaN` and `Infinity` were refused with "got null", because they have no JSON. A number is
  shown as itself.

What was left, and written into the README as what the step does not do: the ceiling refuses
rather than trims, so one row wider than it has no remedy until the column is bounded; `limit`
and `after` are checked in the handler after the decision was recorded, because the validate
stage does not read a contract's input schema; an oversize answer leaves an ALLOW record while
the caller gets `INTERNAL_ERROR`; the ceiling is proven on PGlite only; the door measures one
serialisation of plain data and does not defend against a handler of the program's own that lies
to `JSON.stringify`; and nothing bounds a caller who walks every page, which is `DSOR-CLS-04b`, a
later step. One suggestion was about design and was declined — cutting the page by bytes — and
decision 104 says why.

A sixth reviewer read the five reports and looked where none of them had, and three verifiers
then re-measured the top findings on a clean copy; all three held. Two things from the sixth went
into the README. The audit record of a page of a hundred is field for field the record of one
`invoice.get` — no row count, no cursor, no limit — and because that record is written before
the handler runs and the runtime cannot update the log, step 14 will have to write a second
record after the fetch, not add a field to this one. And the door's row layer reads a page of
invoices, so the next operation that returns many rows inherits the byte layer and not the row
layer until the page type holds rows of any kind; the README says what that next list must do.
Two measurements went in as sentences: the page is an index-only scan of the primary key with the
company filter before the `LIMIT`, so step 11's lock never shortens a page; and a cursor for a
row that does not exist answers the same as one that does, so it cannot be used to ask whether an
id exists.

The same reviewer found what the one failed `pnpm check` of that hour was. Five tests of
`main.test.ts` fail when two processes run the demo in the same folder, because the test wipes
`.local-database` before and after itself, and the reviewers were running the suite in the live
folder while the check ran. Nothing in the code: the demo ran three times in a row afterwards with
no error, and the check was rerun alone. The rule it leaves: run the suite in a copy while a
session is live in the folder.
