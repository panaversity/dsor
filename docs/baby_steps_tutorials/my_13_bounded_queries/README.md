# Step 13 · Bounded queries

**New in this step:** `invoice.list`, the first operation that returns many rows, with the size of
the answer decided by the server. Ask for a million, get one page.

## In plain words

Until now every answer was one invoice. A list is different: how many rows come back is a number,
and somebody chooses it. If the caller chooses, an agent in a loop asks for a million and gets the
whole table. §7.1 says it in one sentence: an agent in a loop should not be able to download the
whole customer table. The rule, `DSOR-QRY-01`, says the server enforces a maximum page size and a
maximum result size on every query, whether or not the caller asked for a limit.

Three things make that true here:

- **Two maxima and a default, in one file**, `src/queries.ts`: a page holds at most 100 rows, 25
  when the caller says nothing, and an answer may be at most 64 KiB as JSON. The caller's number is capped, not
  refused — asking for a million is an ordinary request that gets one page. A number that is not a
  whole number above zero is not a request for rows at all, and is refused as invalid input. The
  numbers are this step's own and provisional, like §44's ceilings: the specification names the
  rule and not the figures.
- **The next page comes after the last invoice on this one.** The page says which invoice it ended
  on, as an address — `dsor://org_456/invoice/INV-02099` — and the caller sends that back as
  `after`. The server reads the rows after it, in id order. A page shifts for nobody when a row is
  added behind it, and there is no "row one million" to name. Because the cursor is an address,
  the §21.6 scan refuses one from another company, and step 12's suite tests the list like every
  other operation, with nothing new. The database reads the page from the primary key in
  page-sized steps, and the company filter runs before the `LIMIT`, so a page is never short
  because of step 11's lock. A cursor names a row the caller already holds, and one for a row
  that does not exist answers the same as one that does, so it cannot be used to ask whether an
  id exists.
- **Two layers.** The handler's SQL carries `LIMIT`, and asks for one row more than the page so it
  knows whether there is a next one. And after *any* handler runs, the door measures the answer —
  every answer, commands and errors included — against both maxima and refuses one that exceeds
  them as the program's own error. A query written next year that forgets its `LIMIT` is caught at
  the door, not on the wire.

What this step does **not** do: it does not stop a caller from walking every page. One page per
request is the rule; a thousand requests are a thousand decisions in the log, which is step 08's
answer to a loop, and a budget on rows over a time window is `DSOR-CLS-04b`, an L2 rule for a
later step. The ceiling is measured on the answer the door hands back, as JSON, before any
transport. And it refuses rather than trims: an answer over 64 KiB is the program's own error, the
caller's remedy is a smaller `limit`, and one row wider than the ceiling — `vendor` is unbounded
text — has no remedy until the column is bounded. `bounded-queries.test.ts` seeds such a row and
pins that `invoice.list` and `invoice.get` both refuse it.

## Why it matters

Measured on a copy of step 12 with a list written the obvious way — the caller's `limit`, straight
into the SQL — and fifty thousand invoices seeded for `org_456`:

```text
org_456 holds 50002 invoices
invoice.list { limit: 25 }         ->  25 rows,      1 KiB,  23 ms
invoice.list { limit: 1,000,000 }  ->  50,002 rows, 3065 KiB, 105 ms
```

Three megabytes in a tenth of a second, and nothing in the program said no. Every lock from steps
10 and 11 held — every one of those rows was `org_456`'s — and the whole table still left in one
answer, because the only number that mattered was the caller's.

## What changed since step 12

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_12_cross_tenant_test_suite ../my_13_bounded_queries
```

| File | What |
| --- | --- |
| `src/queries.ts` | new — the two maxima and the default, `pageSizeFrom`, `bytesOf` |
| `src/invoice.ts` | `listInvoices`: one page in id order after a cursor, `LIMIT` in the SQL, the next page's address |
| `src/contracts/invoice.list.json` | new — a query, `invoice:read`, with an example request whose cursor is an address |
| `src/registry.ts` | the third contract on the list |
| `src/operations.ts` | the `page` answer; the `invoice.list` handler; `makeDoor` takes a handler table; `overTheCeiling`, and the door's refusal of an oversize answer |
| `src/main.ts` | a page, its cursor sent back, and a request for a million |
| `test/bounded-queries.test.ts` | new — seventeen tests: a counting connection that sees the `LIMIT` in the SQL and every other read of the table, three careless handlers fed to the door, one real row wider than an answer may be, a page of multibyte vendors, and the list asked as the owner with no row-level security |
| `test/main.test.ts` | the three list lines pinned; every record count moves by four — one refusal in the generated section, three pages read |
| `test/operations.test.ts`, `test/registry.test.ts`, `test/request-id.test.ts`, `test/who-is-calling.test.ts` | three operations, and a page is a query's success |
| everything else | a `NEW IN STEP 12` marker becoming `STEP 12` |

444 tests became 468, and the database tier's 30 became 36: step 12's suite grew by six questions
for `invoice.list` without an edit, which is what step 12 promised.

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step:

```text
A list, one page at a time, and the ceiling:

limit 1                 user_123              (a page)                 1 invoices, next after dsor://org_456/invoice/INV-1008
after the first         user_123              (a page)                 1 invoices, the last page
limit 1,000,000         user_123              (a page)                 2 invoices, the last page
```

One invoice a page, so the page and its cursor can be seen on the story's two invoices; the cursor
sent back; then a million asked for and two invoices given, because two is all there are. The
ceiling of a hundred is not visible on two invoices — `bounded-queries.test.ts` seeds three hundred
and watches it bite. What is visible is that the caller's number did not decide. And the generated
section above it now prints three lines, one of them `invoice.list`, with no edit to `main.ts`.

Each page read is a decision, so the logs grow: `org_456: 21 records` on a fresh run, `42` on the
second; `org_789` stays at `2` and `4`.

### The database tier

`pnpm check` needs no server. The thirty-six tests in `pnpm test:db` — step 12's thirty, and six
generated for `invoice.list` — need two real logins and a database of this step's own. Copy step
12's `.env` and change the database name in both URLs:

```bash
cp ../my_12_cross_tenant_test_suite/.env .env     # then dsor_step12 -> dsor_step13 in both lines
pnpm migrate && pnpm test:db
```

This folder's own run was on Neon: `neonctl databases create --name dsor_step13`, a `GRANT CONNECT`
through the owner's connection, five migrations, `36 passed`. The one edit to a migration is a
comment — step 12's `NEW IN STEP` marker retiring in `004` — and the checksum covers comments, so
the database built from the copy before that edit refused to migrate and was rebuilt. An applied
migration is never edited, and a comment is an edit.

## Break it

Eleven, measured twice on the full suite with the files one at a time, both runs agreeing. The
counts are from a copy outside the repository, where one test skips because the specification is
not beside it, so the total reads `468` with `1 skipped`; in the repository it is `468 passed`.

### Break 1 · the SQL loses its LIMIT

In `src/invoice.ts`, delete the `LIMIT $3` and its parameter.

```text
 Tests  1 failed | 466 passed | 1 skipped (468)
```

One test, and it is the one that could see it: a connection that counts what every statement
returned, in front of the real one. Every other test still passes, because the handler slices the
page — a list that fetched everything and cut the page afterwards would be correct and would still
pull fifty thousand rows across the wire. The counting connection is the test that tells the two
apart.

### Break 2 · the caller's number is not capped

In `src/queries.ts`, in `pageSizeFrom`, return `given` instead of `Math.min(given, MAX_PAGE_SIZE)`.

```text
 Tests  3 failed | 464 passed | 1 skipped (468)
```

The map's done-when, failed: a million is asked for, and the SQL is handed a million.

### Break 3 · no next page, ever

In `listInvoices`, make `next` always `undefined`.

```text
 Tests  7 failed | 460 passed | 1 skipped (468)
```

Seven: every test that walks the pages or expects a `next`, in this file and in step 12's suite.

### Break 4 · the page includes the cursor's own row

Change `id > $2` to `id >= $2`.

```text
 Tests  2 failed | 465 passed | 1 skipped (468)
```

The walk through every page sees one invoice twice, and the test that asks for every row once, in
order, says so.

### Break 5 · the page is cut after the fact

Hand the SQL `1000000` as its `LIMIT` and let the handler's slice do the work.

```text
 Tests  1 failed | 466 passed | 1 skipped (468)
```

The same one test as Break 1, for the same reason.

### Break 6 · the door stops measuring

In `src/operations.ts`, in `makeDoor`, change `if (tooBig !== undefined)` to `if (false)`.

```text
 Tests  5 failed | 462 passed | 1 skipped (468)
```

Five. The three careless handlers — a hundred and one rows, four rows carrying twenty-kilobyte
vendors, a refusal carrying sixty-four kilobytes in its message — walk out of the door, and so do
the page of multibyte vendors and the real row wider than the ceiling.

### Break 7 · the result size, a hundred times larger

In `src/queries.ts`, make `MAX_RESULT_BYTES` `6400 * 1024`.

```text
 Tests  2 failed | 465 passed | 1 skipped (468)
```

Two: the tests built on literal sizes — four twenty-kilobyte vendors, three vendors of twenty
thousand `€`. The two built on the constant follow it wherever it goes, which is Break 9's lesson
again.

### Break 8 · the door measures rows and not bytes

Change `if (bytes > MAX_RESULT_BYTES)` to `if (false)`.

```text
 Tests  4 failed | 463 passed | 1 skipped (468)
```

Four: every answer that is too big by bytes and not by rows.

### Break 9 · the default page is fifty

In `src/queries.ts`, make `DEFAULT_PAGE_SIZE` `50`.

```text
 Tests  1 failed | 466 passed | 1 skipped (468)
```

One, and only since the literal `25` was pinned beside the constant: a mutation pass changed the
default with every test green, because every test compared the page with the number the code
reads. Changing a ceiling is allowed. It is a visible act now.

### Break 10 · the list's example loses its address

In `invoice.list.json`, make the example request `{ "limit": 2 }`.

```text
 Tests  4 failed | 458 passed | 1 skipped (463)
```

Step 12's suite says what it says for an example with nothing to move, and its example test asks
for an address in `org_456`. A list is tested only because its cursor is an address. The total
drops by five, because the suite generates its questions from the example, and an example with no
address has fewer to ask.

### Break 11 · the demo asks for one instead of a million

In `src/main.ts`, make `million` `{ limit: 1 }`.

```text
 Tests  1 failed | 466 passed | 1 skipped (468)
```

The pin in `main.test.ts`, which reads the demo's label from the request it sends: a review
changed the number beside a fixed label and nothing noticed.

Restore each break and confirm `pnpm check` prints `468 passed` again.

## Build it yourself with Claude Code

Copy `my_12_cross_tenant_test_suite` to a new folder and ask:

> Start step 13, bounded queries. Before any code: add a list to a copy of step 12 the obvious way,
> seed fifty thousand invoices, ask it for a million, and show me what comes back. Then ask me, one
> at a time, how the caller gets the next page, how a list says which company it lists, and where
> the two maxima live. Then build it a piece at a time, red first, and break each piece on purpose
> — including a connection that counts what the database handed back.

## Check yourself

1. The caller asks for a million rows. What comes back, and why is it not a refusal?
2. Why is the cursor an address, and not a page number or a row offset?
3. The handler's SQL already carries `LIMIT`. What is the door's measuring for?
4. Which test would fail if the list fetched every row and cut the page afterwards, and why does
   no other test notice?
5. Does this step stop an agent from reading the whole table? What does, and what will?

<details>
<summary>Answers</summary>

1. One page of a hundred, with the address of the last invoice on it as `next`. The rule says the
   server *enforces* a maximum — the request is ordinary, the size is not the caller's to set. A
   limit that is not a whole number above zero is a different thing, not a request for rows, and
   that one is refused.
2. A page number lets a caller name page 40,000, makes the database skip everything before it, and
   shifts when a row is added in front. "After this invoice" is stable, cheap, and — because it is
   an address — already checked by the §21.6 scan and already moved by step 12's suite. The company
   still comes from the login, never from the cursor.
3. The query written next year. The handler's `LIMIT` is the first layer; the door's measuring is
   the second, and it holds for any handler, including one that forgot. Two layers, like steps 10
   and 11.
4. `the cap is in the SQL, not after the fact`: a connection that counts the rows every statement
   returned. Every other test sees the page the handler hands back, which is correct either way;
   only the counting connection sees what crossed the wire.
5. No. One page per request is this step; a caller may walk every page. Each page is a decision in
   the log, which is step 08's answer to a loop today, and a budget over a time window is
   `DSOR-CLS-04b`, a later step.

</details>

## The rules this step meets

- **[DSOR-QRY-01 · L1]** DSoR MUST enforce a server-side maximum page size and maximum result size
  on every query, whether or not the client asks for a limit. Page size: `LIMIT` in the SQL, capped
  from the caller's number or the default, and the door refusing more rows than a page. Result
  size: the door measuring every answer as JSON against 64 KiB, errors and commands included.
  "Every query" is the door, which every operation goes through; the single-invoice answers of
  `invoice.get` are measured too, and are a few hundred bytes.
  ([§7.1](../../../specs/dsor/01-model.md#71-queries))

**What this step leaves, said plainly.** The numbers are provisional. The result size is measured
on the answer object, as JSON, before any transport — a wire format that pads could exceed it. A
page is read as any read is: one record in the log, with no row count on it; `DSOR-CLS-05`'s row
count for confidential reads is step 14's, where data has a classification — and because the
record is written before the handler runs and the runtime cannot update the log, step 14 will
write a second record after the fetch rather than add a field to this one. Today the log of a
page of a hundred reads the same as the log of one `invoice.get`. Nothing here limits how many
pages a caller walks. `limit` and `after` are checked in the handler, after the decision
was recorded as ALLOW, because the validate stage does not read a contract's input schema yet —
the schema names in `invoice.list.json` are placeholders, as in every contract since step 03 — so
a bad `limit` is a refusal with an ALLOW record behind it, and an unknown argument such as `limti`
passes in silence. An oversize answer leaves the same ALLOW record while the caller receives
`INTERNAL_ERROR`; recording what happened after the decision is a later step. The ceiling is
proven on PGlite: the database tier asks step 12's six questions of `invoice.list`, about
tenancy, and no test names `DSOR-QRY-01` against a real server. And the door measures its own
handlers' answers once, as plain data; it does not defend against a handler of the program's own
that lies to `JSON.stringify`. And the door's row layer reads a page whose rows are invoices: the
next operation that returns many rows — a list of payments, say — must answer as a page, carry
`LIMIT` plus one in its SQL, and give its contract an example request with an address so that
step 12's suite picks it up; until the page type holds rows of any kind, only the byte layer is
universal.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-CLS-05` | A row count on the audit record of a confidential read. No data is classified yet. Step 14. |

Everything earlier steps claimed still holds. Step 12's suite now asks its six questions of three
operations, and `main.test.ts`'s record counts moved by four.

**Next:** step 14, `classification_and_masking` — every field labelled by sensitivity, the agent given a
clearance, and what is above it hidden before the answer leaves, with a list of what was hidden.
