# Step 15 · Freshness labels

Folder: [`my_15_freshness_labels`](../my_15_freshness_labels/README.md) · 531 tests, plus 39 in the
database tier
Spec: [§27](../../../specs/dsor/03-execution.md#27-freshness-and-consistency) · `DSOR-FRS-01a`,
`DSOR-FRS-01b`
Both tiers have run: 531 under `pnpm check`, and 39 under `pnpm test:db` against Neon, the
step's own database `dsor_step15`, seven migrations applied, none new. Decisions [120 and 121](decisions.md).

## What the step is

Every single invoice and every page says how old its data is: the mode, `current` today; when it
was read; and from where, `postgres`. The code that reads writes that label, just before its
query. The door does not know where data came from, so it cannot write a label; it insists on one,
and refuses a read without one, or with a label that is not one, as the program's own error. And a
label that says `current` about something read before the request began is refused: a saved copy
calling itself fresh is the lie `DSOR-FRS-01b` forbids.

## How it was built

The problem first, on step 14's demo, run on the local database so step 14's Neon database was not
touched: the agent's answer for INV-1008 is `issued`, with no time and no source. Four decisions,
one at a time ([decision 120](decisions.md)): the modes in lowercase, as the schemas write them; the
code that reads writes the label, and the door insists; an old value labelled `current` is refused,
not relabelled; no version until step 21.

Then the copy, green before any edit: 512 under `pnpm check`, and 39 on its own database,
`dsor_step15`, made on Neon by one `CREATE DATABASE` through the owner login already in the copied
`.env`. Then step 14's markers became plain `STEP 14`, except in migrations 006 and 007, which an
applied migration's checksum keeps as they are. Then four pieces, each red first, committed and
broken on purpose:

1. **The label** — `src/freshness.ts`; `getInvoice` and `listInvoices` hand back their rows with a
   `current` label; the handlers pass it on; `copyOnce` copies it; the door carries it out.
2. **The door insists** — `cannotBeLabelled` refuses a read with no label, a mode that is not one
   of the four as spelled (capitals included), no time, a time that is not a time, or no connector;
   and the label that leaves is exactly its three parts.
3. **Never an old `current`** — the door notes when a request begins, and refuses a `current`
   label from before it. The same value labelled `observational` leaves.
4. **The demo** — under every read, a line that says how old it is.

Then the review, and three fixes (decision 121, below).

## What the build found

**The ripple of a labelled read.** Changing what `getInvoice` and `listInvoices` return broke 52
places in nine test files, by the typechecker's count: tests that read the store directly, and every
stand-in handler, which now has to label what it hands over. And some it could not count:
`expect(await getInvoice(...)).toBeUndefined()` still typechecks, and would have failed only when
run, because a read now always returns a labelled result. Every direct call reads `.value` now.

**A label made too early is a lie the door catches.** Each stand-in handler takes its label when it
runs, through `readNow()`. A label taken when the test file loads would say `current` about a time
before the request began, and piece 3 refuses that, correctly.

**The demo's two runs.** The test that runs the demo twice and compares the reports already swapped
hashes for `HASH`; the read times change every run too, so it swaps them for `TIME`, and the new
test pins the label against the raw output.

**The copied `.env` named step 14's database.** `pnpm start` loads `.env`, so the demo that showed
the problem was run with `node src/main.ts` instead, on the local database. The settings refuse
Claude any command that names `.env`, even to count its lines, so the learner changed the database
name in it themselves, with one `sed`.

## Limits, stated

- There is no cache, so every read is `current`, and the other three modes appear only in tests.
- The label's time is this program's clock, taken just before the query, so that it and the
  request's start are on one clock. A clock moved backwards during a request could make an honest
  read look older than the request, and the door would refuse it with retry `never`.
- The door checks when a label was stamped, not whether the stamper read the database: a cache
  must label its own answers.
- A command's receipt and an error carry no label; the record of a read does not keep the label.
- The decision bundle's schema writes the modes in capitals: the day this program writes one, it
  translates there (open question 51).
- `DSOR-FRS-02a` and `DSOR-FRS-02b` are L2 and not built.

## The hostile review

Told this time to assume a careless handler, as decision 119 says, one reviewer found no way for
such a handler to get data past the door, and no wrong label on any of the program's own reads. It
found three things, and the learner chose to fix all three ([decision 121](decisions.md)):

- **A query answered with a receipt left unlabelled.** The door insisted on a label only for a
  single invoice or a page; a query whose code copied `invoice.issue` and answered with a receipt
  passed with no label at all, and its read was not written down. The door now refuses a query
  that answers with a receipt: it knows from the contract which operations are queries.
- **The label's time.** Taken after the reply, it was a round trip later than the data, so a label
  claimed a little more freshness than was true. It is taken just before the query now, which
  changes decision 120's "right after the read" to "right before". And the door accepts only an
  exact ISO time, not one in the future: `"2026"` and a date object had passed.
- **Small gaps.** Four guards had no test of their own, and `leaveTheDoor` called directly let a
  label through whole. Measured on the way: the case for a time that is only a year was first
  refused by the old-`current` check, not by the format check it was written for, until it was
  labelled `observational`. And with a label's parts trimmed in two places, removing either
  alone failed nothing: the trimming lives in `leaveTheDoor` only now, and `copyOnce` copies the
  label once, like a row.

Written down, and not fixed: the door checks when a label was stamped, not whether the code that
stamped it read the database, so the cache a later step adds must label its own answers; and a
clock moved backwards refuses an honest read with retry `never`. The README had said "the first
cache a later step adds cannot pass its saved values off as fresh", and the subject of the piece-3
commit said much the same: both said more than the code does, and the README says what is true.
