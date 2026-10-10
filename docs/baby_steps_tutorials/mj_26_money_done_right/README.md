# Step 26 · Money done right

**New in this step:** DSoR compares money in two currencies exactly, with its company's own
exchange rates, and when it cannot convert, the strict answer wins.

## In plain words

Until now, a slip's limits worked in one currency only, so DSoR refused every bill in another
currency (step 24's README, decision 11). In this step, each company names its *rate source*, such
as the European Central Bank (the ECB), and its `max_rate_age`, the oldest a rate may be. DSoR
keeps each *sheet* of rates from that source, and compares euros with dollars exactly. When it has
no usable rate, the limit counts as exceeded. Like the new clerk with the bank's rate sheet on the
wall: a sheet that is too old, or has no line for the bill's currency, means no guess and no
payment.

## Why it matters

Two failures, one in each direction.

- **Too strict.** On Tuesday at 15:05, the agent drafts a payment of VENDOR-44's INV-2002, for
  9,000.00 EUR, about 9,720.00 USD. That is far inside del_100's 50,000.00 USD for one payment.
  Step 25c's DSoR refuses the draft with `LIMIT_EXCEEDED`, because it cannot compare euros with
  dollars. Every bill in another currency stops.
- **Too loose.** The quick fix compares the numbers: "is 49,000 at most 50,000?". VENDOR-44's
  INV-2003 is for 49,000.00 GBP, about 62,000 USD. The numbers say yes, and the agent pays about
  12,000 USD more than its slip allows. §9 tells the same story about a control: a rule
  "amount > 25000 and currency is USD" lets 50,000,000 PKR straight through.

## The design, before any code

The circled numbers are lines of DSoR's checklist, which every call runs through in order, as a
pilot runs through a checklist. ③ finds the agent's slip, ⑤ checks the caller's permission, ⑨ is
DSoR's own look at the state before any work, and ⑩ checks the slip's limits.

### How this step was made

In the understanding session of 2026-10-10, the learner worked through five parts: the hole that a
comparison of numbers leaves, an exact comparison, where a rate comes from, what happens with no
good rate, and a day's total in another currency. Then the learner took the eight decisions below.
Step 25c was built first, and this step copies it.

### What each rule says

- **DSOR-MON-02:** money is compared with decimal arithmetic
  ([§9](../../../specs/dsor/01-model.md#9-money-and-currency)). Since step 24 DSoR compares whole
  numbers of millionths. Across two currencies, it *multiplies across*. To ask whether 9,000 EUR is
  more than 50,000 USD, when 1 EUR buys 1.0800 USD, it compares 9,000 × 1.0800 with 50,000 × 1.
  Nothing is divided, so nothing is rounded.
- **DSOR-MON-03:** a slip's limit is compared only through money functions that convert both
  amounts to the limit's currency, with the company's rate source.
  [Appendix B](../../../specs/dsor/appendix-b-cel.md) names two, `dsor_exceeds` and `dsor_covers`,
  for CEL, the language that step 27's controls are written in. This step builds the first as a
  TypeScript function, `exceeds`. Step 27 gives the functions their CEL names.
- **DSOR-MON-04:** when an amount cannot be converted, because its currency is unknown, has no
  rate, or has a rate older than `max_rate_age`, the limit counts as exceeded.
- **DSOR-MON-06:** a day's total grows in the limit's own currency. Each booking is converted at
  the rate in force when it is taken.
- **DSOR-MON-05**, step 33's: a decision that converted records the rate, its source, and its time.
  This step records them early (decision L7).

### The learner's decisions

- **L1. Rates live in DSoR's own table,** one row for each source, currency, and time. *Downside:*
  DSoR keeps a copy of figures that another system owns.
- **L2. A rate is written by a DSoR command, `rate.load`,** through the checklist, with a key, a
  proposal, and a record. In a deployment, a scheduled job would call it. This step's program
  calls it itself. *Downside:* something must call it on time, as with step 25c's sweep.
- **L3. Each company's money policy lives in a file,** checked at start-up against the `money`
  part of the specification's `tenant-policy.schema.json`, as `role-sources.json` is checked
  against its `role_source` part. *Downside:* one more file to keep.
- **L4. The database's clock decides that a rate is too old.** *Downside:* the memory store uses
  the program's clock, as memory always has.
- **L5. Two amounts in two currencies are compared by multiplying across,** with no rounding.
  *Downside:* long numbers, which only exact whole-number arithmetic can hold.
- **L6. DSOR-MON-06 comes into this step.** A booking is converted when it is made, kept in the
  limit's currency, rounded up at the sixth decimal place, and given back as it was kept.
  *Downside:* the dollars a booking holds can differ from the dollars a payment costs at the end,
  because the rate moves.
- **L7. A decision that converted records the rate, its source, and its time** in its log record.
  DSOR-MON-05 itself stays step 33's. *Downside:* a record that step 33 may reshape.
- **L8. Step 25c is built first,** and this step copies it.

### The learner's design decisions

Asked on 2026-10-10, after the eight above. The learner took each recommendation.

- **D1. A new login, `dsor-rates`, loads the rates.** It is a login of the spec's subject type
  `system`, and its role, `rate_loader`, holds `rate:load` and nothing else. *Downside:* one more
  login to keep.
- **D2. Each company keeps its own rates,** in rows of its own, behind its company's lock: step
  11's row-level security, with which PostgreSQL shows a transaction only its own company's rows.
  So one company's loader can never change another company's rates. *Downside:* the same public rates
  are stored once for each company.
- **D3. A rate is kept as its source wrote it.** The ECB's daily sheet says how much of each
  currency 1 EUR buys, such as 1.0800 USD. The euro is that sheet's *base*: the currency whose one
  unit it prices. DSoR keeps 1.0800, never a division of it.
  *Downside:* people read rates per euro, not per dollar.
- **D4. One conversion takes both rates from the newest sheet** of the company's source. A
  currency that the newest sheet leaves out cannot be converted. *Downside:* a sheet that leaves
  out one currency stops every bill in it.
- **D5. A rate's age counts from the time its source published the sheet,** measured by the
  database's clock. A sheet published in the future is refused. *Downside:* DSoR takes the
  loader's word for that time, as §10 trusts the rate source
  ([§10.1](../../../specs/dsor/02-security.md#101-trust-assumptions)).
- **D6. A sheet is written once.** Nothing changes or removes it, and a correction is a newer
  sheet. *Downside:* a wrong sheet stays in the history.
- **D7. A refusal for no usable rate is `LIMIT_EXCEEDED`, and names the cause.** Changed by the
  review (finding H1). The agent hears "no usable rate", with no amount and no currency. The
  decision's record names the currency and why, such as "GBP: the newest sheet of ecb-daily has no
  GBP", for the people who read it. *Downside:* the agent cannot tell one cause from another, and
  still learns that the bill is not in the limit's currency.
- **D8. A sheet from a source that the company's policy does not name is refused** at line ⑨.
  *Downside:* to switch sources, the policy changes first.

### Found while designing (Claude Code)

- **D9. A sheet names its base, and DSoR keeps the base as a row of rate 1,** so a conversion to or
  from euros finds its rate in the sheet like any other. A sheet that lists its own base among its
  rates is refused. *Downside:* one row that the source never sent.
- **D10. One currency needs no rate.** A draft in USD against a limit in USD is compared as before,
  with no sheet at all, so old rates never stop a payment in the limit's own currency.
  *Downside:* none found.
- **D11. Start-up refuses a `max_rate_age` over `P7D`,** seven days written as an ISO 8601
  duration, as the schema asks (so `P3D` is three days). That is §44's ceiling at L2
  ([§44](../../../specs/dsor/06-conformance.md#44-operational-bounds)). L3's is 3 days.
  *Downside:* none found.
- **D12. `rate.load` is for DSoR's own system logins only,** with step 25c's `system_only` field.
  *Downside:* none found.
- **D13. A booking keeps its converted amount only,** in the limit's currency. The rates it used
  are in its decision's record (decision L7). *Downside:* to see the bill's own amount, a reader
  follows the record to its proposal.
- **D14. The bills in other currencies live in this step's tests and its program only.** The
  story's shared invoices and the database's own invoices stay as they were. *Downside:* each test
  adds the invoice it needs.
- **D15. `control_currency` is checked at start-up, and nothing reads it yet.** Controls and their
  sums come in step 27. *Downside:* a setting that does nothing in this step.

### Found by the review (Claude Code)

The hostile review, below under "Think it through", changed decision D7 and added two decisions.
They are Claude Code's, for the learner to review.

- **D7, changed.** See D7 above: the agent's words name no currency, and the record does.
- **D16. Line ⑨ asks the store what a load would do.** A sheet that is there already, or one
  published after the store's clock, is refused before any work, so its proposal ends DENIED and a
  dry run hears the same. The load inside the work answers again, for two loads at one moment.
  *Downside:* each load asks the store twice.
- **D17. An amount that cannot be read to six places fits no limit, in any currency,** before any
  conversion, as step 24 decided for the limit's own currency (step 24's README, decision 11).
  *Downside:* none found.

### The story's numbers

One sheet of `ecb-daily`, published on Tuesday 2026-10-06 at 14:00 UTC, with its base, EUR:

| Currency | Units for 1 EUR | So, for one USD |
| --- | --- | --- |
| EUR | 1 | 0.925926 |
| USD | 1.0800 | 1 |
| GBP | 0.8532 | 0.79 |
| PKR | 302.40 | 280 |

And three of VENDOR-44's bills to org_456, in this step's tests only:

| Bill | Amount | In USD, by the sheet | Against del_100's 50,000.00 USD for one payment |
| --- | --- | --- | --- |
| INV-2002 | 9,000.00 EUR | 9,720.00 | within |
| INV-2003 | 49,000.00 GBP | 62,025.316455… | over |
| INV-2004 | 14,000,000.00 PKR | 50,000.00, exactly | within: at the limit is within it |

### The tests, by claim

| Claim | What it says |
| --- | --- |
| C1 | Two amounts in two currencies are compared exactly, by multiplying across, with no rounding: 14,000,000.00 PKR is within 50,000.00 USD, and 14,000,000.01 PKR is not |
| C2 | An amount that cannot be converted counts as over the limit: an unknown currency, a currency the newest sheet leaves out, no sheet, a newest sheet older than `max_rate_age`, or an amount that cannot be read to six places. The agent hears "no usable rate", and the record names the currency and the cause |
| C3 | A booking is converted when it is made, into the limit's currency, rounded up at the sixth decimal place, and given back as it was kept |
| C4 | One currency needs no rate: a draft in USD against a limit in USD passes with no sheet at all |
| C5 | `rate.load` writes a sheet: the company's own rows, its base at 1, each rate as its source wrote it, once. Only `dsor-rates` may call it. Another source, a time in the future, a rate that is not more than zero, a currency that is not one, and the base among the rates are refused, at line ⑥ or ⑨, before any work. So is a sheet that is there already |
| C6 | Start-up checks each company's money policy against the specification's schema, and refuses a `max_rate_age` over `P7D`, and a company with no policy |
| C7 | A decision that converted records the two rates, the source, and the sheet's time |
| C8 | On the database: each company's rates behind its lock, written once, more than zero, and their age by the database's clock |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
| --- | --- | --- |
| B1. The check for one payment compares the numbers only | INV-2003's 49,000.00 GBP passes as "at most 50,000", and the agent pays about 62,025 USD. Its booking still converts, so the day's total grows by 62,025.316456 | Paid, and the day's total grows by 62,025.32 |
| B2. The conversion ignores `max_rate_age` | On Saturday, Tuesday's sheet is too old for org_456. INV-2002 should hear LIMIT_EXCEEDED, no usable rate. It is paid at Tuesday's rate instead | LIMIT_EXCEEDED, no usable rate: something else in DSoR still finds the sheet too old |
| B3. A booking is kept in the bill's own currency | The reservation store still refuses an amount in another currency than its limit (step 24's README, decision 11). So every bill in EUR hears LIMIT_EXCEEDED, from the first: too strict again, as before this step | LIMIT_EXCEEDED, from the first |
| B4. Each currency takes its own newest rate | Wednesday's sheet leaves out GBP. A bill in GBP should hear LIMIT_EXCEEDED. It is paid with Tuesday's GBP and Wednesday's USD, a rate nobody published | Paid, with rates from two sheets |
| B5. Each currency keeps its own day's total, against the limit converted into it | 20 bills of 9,000.00 EUR fill 180,000 EUR of about 185,185 EUR, and INV-1008's 31,400.00 USD fills a separate USD total. INV-1008 is paid, and the day spent 225,800 USD against 200,000 | Paid |

The design first expected B3's bills to be paid. The learner's prediction showed that step 24's own
check of the currency still stands behind this step's conversion. B5 is the break that this step's
rule, DSOR-MON-06, is about: one total for the day, in the limit's currency.

### Left open, and not this step's idea

- Controls, and the CEL names of the money functions: step 27.
- The decision bundle that DSOR-MON-05 names: step 33. The rates are in the record's
  `extensions`, the part of a record that holds this tutorial's own fields.
- The timer that calls `rate.load`, and the program that reads the ECB's feed: a deployment's.
- A threshold for each currency, which §9 allows a tenant instead.
- The time zone of a company's day for its limits, which the learner asked about: a later step.

## Before you build: set up a database

As in step 25c: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Migration 021 runs: `dsor.rates`, behind its company's lock,
written once.

Give the step a server of its own, or at least a database of its own with its own `.env`.
`pnpm migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server, so a second step
migrated on the same server changes the first step's login.

## What changed since step 25c

| File | What changed |
| --- | --- |
| `money-policies.json`, `src/policies.ts` | **New.** Each company's money policy, checked at start-up against the `money` part of the specification's tenant policy, with §44's ceiling |
| `src/exchange.ts` | **New.** Two currencies compared by multiplying across, and a booking converted and rounded up: `compareAcross`, `exceeds`, `convertUp` |
| `src/rates.ts` | **New.** The store of sheets, in memory, and `rate.load`'s two halves: line ⑨'s check and the work that writes a sheet |
| `migrations/021_rates.sql` | **New.** `dsor.rates`: one base row for each sheet, rates above zero, the company's lock, and no UPDATE or DELETE for `dsor_runtime` |
| `contracts/rate.load.json`, `inputs/RateLoadRequest.schema.json`, `examples/rate.load.json` | **New.** The command, its input, and the cross-tenant suite's example |
| `src/limits.ts` | Line ⑩ reads one sheet when a limit is in another currency, compares exactly, converts the booking, and refuses with the cause when it cannot |
| `src/postgres.ts`, `src/claims.ts` | The sheets on the database, and the rates among a claim's stores and a dry run's |
| `src/pipeline.ts`, `src/log.ts`, `src/revocation.ts`, `src/registry.ts` | Line ⑩ gets the rates and the company's policy, the decision's record names a conversion or why none was usable, line ⑨'s look gets the policy and the sheets, and start-up checks the policies |
| `src/principals.ts`, `roles.json`, `classifications.json`, `store.json`, `src/money.ts` | The login `dsor-rates`, the role `rate_loader`, the answer's kind `RateSheetLoaded`, `dsor.rates` in the map, and `isCurrency` |
| `src/main.ts` | Money in two currencies, told in memory |
| `test/rates.test.ts`, `test/rates.db.test.ts` | **New.** The claims C1 to C8 |
| `test/owner-invoices.ts` | `add` takes an amount and a currency, for a bill in EUR on the database |
| `test/owner-store.ts`, `test/db.ts` | `rates`: the owner, whom no policy stops, asks the store for org_456's newest sheet beside org_789's, and what a load would do. Found by the sweep and the review |
| The other tests | The ten contracts, the suite's 93 attacks, the eighth login, the roles, the labels, the store map and the catalog, the privileges, the row-level security, and step 24's test of another currency, whose words now say why |

Step 25c's markers are gone, as the build skill asks. Since step 26, a search for "NEW IN STEP"
finds only this step's lesson.

```bash
git diff --no-index ../mj_25c_ready_can_end/src src
git diff --no-index ../mj_25c_ready_can_end/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-10, after the review's fixes, shortened. After step 25c's expiry, the
program tells money in two currencies, in memory, with a clock of its own: the program sets the
time by hand, so Saturday comes when the story needs it.

```text
money in two currencies, in memory, with a clock of its own:
  Tuesday 15:00, user_123 tries to load rates: AUTHORIZATION_DENIED: "rate.load" is for DSoR's own system logins only, and user_123 is not one
  Tuesday 15:00, dsor-rates loads Tuesday's sheet: answered, a sheet of ecb-daily with 4 currencies
  Tuesday 15:05, the agent drafts INV-2002, 9,000.00 EUR: answered, PAY-901
  Tuesday 15:05, the agent drafts INV-2003, 49,000.00 GBP: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one payment
  Tuesday 15:05, the agent drafts INV-2004, 14,000,000.00 PKR: answered, PAY-902
  the day's total under del_100: 59720.00 USD
  Saturday 09:00, the agent drafts INV-2002 again: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one payment: no usable rate
  its record says why: no usable rate for EUR (the newest sheet of ecb-daily is older than P3D)
```

The agent hears that no rate was usable, and nothing more: the bill's currency is above its
clearance. The decision's record, which people read, names the currency and the cause (decision
D7, as the review changed it).

The day's total is 9,720.00 USD for the euros and 50,000.00 USD for the rupees. This step has no
timer and reads no feed: the program loads Tuesday's sheet itself. In a real deployment, a job
reads the European Central Bank's sheet each working day and calls `rate.load` with
`dsor-rates`' token, and a key of its own each day.

## Break it

Each break ran in a copy of this step outside the repository, on 2026-10-10, in memory, with the
story's own names and a clock that each story sets by hand. Each story ran first on the step's code
as it is ("built"), then once with the break. The output is copied as it was printed. A day's total
is printed to two places, so 62,025.316456 shows as 62025.31. The review then changed the words of
a refusal for no usable rate, so B2 and B4, whose "built" lines show those words, ran again on the
code after the review. Their output below is from that second run.

**B1. The check for one payment compares the numbers only.** In the copy's `src/limits.ts`, the
check took the bill's number as if it were in the limit's currency.

```text
=== built
Tuesday 15:05, the agent drafts INV-2003, 49,000.00 GBP: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one payment
the day's total under del_100: 0.00 USD
=== B1, the check for one payment compares the numbers only
Tuesday 15:05, the agent drafts INV-2003, 49,000.00 GBP: COMMITTED
the day's total under del_100: 62025.31 USD
```

The learner predicted this: paid, and the day's total grows by about 62,025.32. A rule that
compares numbers forgets that 49,000 pounds are worth more than 49,000 dollars. The booking still
converted, so the day's total was right, and the payment was not. Nine tests caught it.

**B2. The conversion ignores `max_rate_age`.** In the copy's `src/limits.ts`, line ⑩ took the
newest sheet whatever its age.

```text
=== built
Saturday 09:00, Tuesday's sheet is the newest. The agent drafts INV-2002, 9,000.00 EUR: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one payment: no usable rate
Saturday's total under del_100: 0.00 USD
=== B2, the conversion ignores max_rate_age
Saturday 09:00, Tuesday's sheet is the newest. The agent drafts INV-2002, 9,000.00 EUR: COMMITTED
Saturday's total under del_100: 9720.00 USD
```

The learner predicted LIMIT_EXCEEDED, because "something else in DSoR still finds the sheet too
old". Nothing else does: one place decides that a rate is too old, line ⑩'s check of what the
store says. The store measures the age, by the story's clock in this run and by the database's
clock on the database, and line ⑩ alone acts on it. A proposal's moves have a second guard: the
database's trigger refuses a move that the code's list of moves does not allow (step 22). A rate's
age has no second guard. One test caught it, the Saturday test. That a single check stands here is
left open below.

**B3. A booking is kept in the bill's own currency.** In the copy's `src/limits.ts`, the day's
booking was the bill's own amount, in EUR.

```text
=== built
Tuesday, the agent drafts 21 bills of 9,000.00 EUR: COMMITTED x20, then LIMIT_EXCEEDED x1
the day's total under del_100: 194400.00 USD
=== B3, a booking is kept in the bill's own currency
Tuesday, the agent drafts 21 bills of 9,000.00 EUR: LIMIT_EXCEEDED x21
the day's total under del_100: 0.00 USD
```

The learner predicted this: refused from the first. The reservation store still refuses an amount
in another currency than its limit (step 24's README, decision 11). Every bill in EUR stops, as
before this step. Five tests caught it.

**B4. Each currency takes its own newest rate.** In the copy's `src/rates.ts`, the store filled
what the newest sheet left out with rates from older sheets.

```text
=== built
Thursday 09:00, Wednesday's sheet has no GBP. The agent drafts INV-2005, 9,000.00 GBP: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one payment: no usable rate
Thursday's total under del_100: 0.00 USD
=== B4, each currency takes its own newest rate
Thursday 09:00, Wednesday's sheet has no GBP. The agent drafts INV-2005, 9,000.00 GBP: COMMITTED
Thursday's total under del_100: 11497.89 USD
```

The learner predicted this: paid, with rates from two sheets. 9,000 × 1.0900 ÷ 0.8532 is Wednesday's
USD divided by Tuesday's GBP: a rate that no source ever published. Two tests caught it.

**B5. Each currency keeps its own day's total, against the limit converted into it.** In the
copy's `src/limits.ts`, a booking stayed in its own currency, and its total was compared with the
day's limit converted into that currency.

```text
=== built
Tuesday, the agent drafts 20 bills of 9,000.00 EUR: COMMITTED x20
then INV-1008, 31,400.00 USD: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one day
the day's totals under del_100: 194400.00 USD, and 0.00 EUR
=== B5, each currency keeps its own day's total
Tuesday, the agent drafts 20 bills of 9,000.00 EUR: COMMITTED x20
then INV-1008, 31,400.00 USD: COMMITTED
the day's totals under del_100: 31400.00 USD, and 180000.00 EUR
```

The learner predicted this: paid. Each total passed on its own: 180,000 EUR is under about 185,185
EUR, and 31,400 USD is under 200,000 USD. The day spent 194,400 + 31,400 = 225,800 USD. One total,
in the limit's own currency, is what DSOR-MON-06 asks for. Four tests caught it.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The session of 2026-10-10: five parts, from the hole that a comparison of numbers leaves to a day's total in another currency, and the eight decisions L1 to L8 |
| 2 | Decide | D1 to D8, asked after step 25c was built, each with its downside. The learner took each recommendation, and predicted each break. B3's prediction found a mistake in the design, and B5 was added |
| 3 | The copy | Step 25c copied, its markers removed, and a PostgreSQL of its own |
| 4 | Piece A | The money policies and their check at start-up, red first |
| 5 | Piece B | The comparison and the conversion, red first |
| 6 | Piece C | The store of sheets, in memory and on the database, red first, and migration 021 |
| 7 | Piece D | `rate.load`, its login, its role, and its contract, red first |
| 8 | Piece E | Line ⑩: one sheet, an exact comparison, a converted booking, the words of a refusal, and the record, red first |
| 9 | Piece F | The program's money story |
| 10 | The old tests | The lists, the counts, the roles, the labels, the map, the catalog, the privileges, and the row-level security |
| 11 | Break it | B1 to B5 in a copy outside the repository |
| 12 | Review | A sweep of small breaks, and a reviewer who had not seen the conversation |
| 13 | Fix | The review's findings: the new tests red first, then the words of a refusal, line ⑨'s question to the store, and an amount that cannot be read |
| 14 | Second sweep | 21 small breaks of the fixes, and of the reviewer's own breaks that no test saw |

To start it in a new session:

```text
Build step 26 in learner mode from the design in
docs/baby_steps_tutorials/mj_26_money_done_right/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Pieces A to C, red | Each new module was missing, so its test file did not load. On the database, `createDbRates` was not there yet |
| Piece D, red | 14 tests: no `rate.load` |
| Piece E, red | 10 tests: line ⑩ refused every other currency with step 24's plain words |
| The old unit tests | 57 tests in 14 files. Most were start-up refusing every test registry, because the tests' own role table had no `rate_loader`. After that, 29 in 10 files: the lists of contracts, the suite's 87 attacks that became 93, the labels, the eighth login, the system logins' roles, and step 24's test of another currency, whose words now name the cause |
| The old database tests | 7 tests in 4 files: the privileges column by column, the suite's lists and counts, the program's list of operations, and the tables with row-level security and their policies |
| A test file of this step | It did not load: a script of Claude Code's wrote the two characters `\n` into it instead of a new line |
| The review's unit tests, red | 14 tests in 2 files: 11 whose words named the currency (finding H1), 1 whose repeated sheet ended FAILED and not DENIED (M1), and 2 whose open amount had seven places and was paid |

## Check yourself

Use Tuesday's sheet: 1 EUR buys 1.0800 USD, 0.8532 GBP, or 302.40 PKR. del_100 allows 50,000.00 USD
for one payment and 200,000.00 USD in one day.

1. On Tuesday at 15:05 the agent drafts INV-2004, 14,000,000.00 PKR. Paid or refused, and why?
2. On Saturday at 09:00 the newest sheet is still Tuesday's, and org_456 allows three days. The
   agent drafts INV-1008, 31,400.00 USD. Paid or refused?
3. dsor-rates loads Tuesday's sheet a second time, with a fresh key and USD at 1.0900. What
   happens, and where?
4. A prepared draft of 9,000.00 GBP booked 11,392.405064 USD on Tuesday. Wednesday's sheet has other
   rates, and on Wednesday the slip is torn up. How much goes back to Tuesday's total?
5. On Saturday at 09:00 the agent drafts INV-2002 again, and hears `LIMIT_EXCEEDED` with the words
   "no usable rate". Why do the words not say EUR, and where does a person read the cause?

<details>
<summary>Answers</summary>

1. Paid. Multiplied across: 14,000,000 × 1.0800 = 15,120,000, and 50,000 × 302.40 = 15,120,000. The
   two sides are equal, and at the limit is within it. Nothing was divided, so nothing was rounded
   (DSOR-MON-02).
2. Paid. One currency needs no rate, so an old sheet never stops a bill in the limit's own currency
   (decision D10).
3. `CONFLICT`, at line ⑨, before any work, so its proposal ends DENIED. A sheet is written once,
   and a correction is a newer sheet (decisions D6 and D16).
4. Exactly 11,392.405064 USD, as it was kept, never a conversion at Wednesday's rate. A booking is
   converted once, when it is taken (DSOR-MON-06, decision L6).
5. EUR is the currency of a bill whose amount the agent's clearance hides, and a refusal must not
   show what the clearance hides (DSOR-CLS-02a). The decision's record names it, and the cause:
   EUR, because the newest sheet of ecb-daily is older than P3D (decision D7, as the review changed
   it).

</details>

## Think it through

### Found while building

- **The tests' own role table had no `rate_loader`,** so start-up refused every registry built
  with it, as in step 25c with `scheduler`. The table has the role now.
- **Step 24's test of another currency** expected the plain words. Since this step, a refusal for
  no usable rate names the currency and the cause, so the test now expects those words.
- **The claim store gives its rates to a dry run,** beside its reservations, so a dry run converts
  as the real call does and books nothing.
- **A refusal is a decision too.** The record of INV-2003's refusal names the rates it was refused
  with, because line ⑩ reports a conversion as soon as it uses a sheet, before it compares.
- **The owner's `add` made every test invoice in USD.** It takes an amount and a currency now, for
  the database's test of a bill in EUR.

### The sweep of small breaks

A sweep makes one small break at a time in a copy of the step, runs the tests meant for it, and
puts the code back. It made 41 breaks, and each one undid one part of this step. They took out:

- the exact comparison: one currency with no rate, the order of multiplying across, the check of a
  rate of zero, and the check of the sheet's own lines;
- the booking: rounding up, one currency kept as it is, and the trailing zeros;
- each check of the money policies, the 7-day ceiling, and start-up's use of the problems;
- in memory: the check of a future sheet, written once, the age's last millisecond, the company
  filter, and the base's own line;
- each check of `rate.load` at line ⑨, and its answer to a sheet that is there already;
- line ⑩: the check of a missing currency, the record of the conversion, and the strict answer
  for an amount that cannot be read;
- on the database: the age, DSoR's own WHERE, the base's own row, the check of a future sheet,
  and the answer to a sheet that is there already;
- migration 021: both CHECKs, the one-base index, `FORCE ROW LEVEL SECURITY`, which holds the
  table's owner to the lock too, and an UPDATE for dsor_runtime;
- a dry run's rates, the contract's `system_only`, and the schema's pattern for a rate.

The tests meant for them killed 34. Seven survived, and each got a test:

| Break | Why no test saw it | The test now |
| --- | --- | --- |
| X3. A rate of zero counts as a rate | Line ⑥'s schema and the database's CHECK keep a zero away, so no test sent one this far. With a USD of zero, every bill in EUR fits a USD limit and books nothing | With a zero rate, nothing is compared or converted |
| X4. A rate is looked up beyond the sheet's own lines | `"constructor"` is not a decimal, so the next check refused it too. Only a line that `Object.prototype` carries gets through, and a package with a bug can write one there | A JPY line that the sheet inherits is no rate of it |
| X6. A booking in the limit's own currency is converted too | The test used Tuesday's sheet, where USD into USD gives the same answer. Line ⑩ never asks for one currency | One currency is kept as it is, with an empty sheet |
| M3. The record holds the whole sheet | `toMatchObject` lets more lines through | The record's conversion is compared exactly |
| M4. An amount that cannot be read fits the limit for one payment | The limit for one day refused it next, with other words | INV-2007's open amount, -9,000.00 EUR, is refused by the limit for one payment, and books nothing |
| D2. On the database, the newest sheet has no company in DSoR's own WHERE | Row-level security kept each sheet inside its company | The owner, whom no policy stops, reads org_456's newest sheet beside two of org_789 (DSOR-TEN-01b) |
| G3. Migration 021 has no one-base index | Each second sheet in the tests shared a currency with the first, so the primary key refused it | A second sheet with another base and other currencies is refused |

A second run of the seven, with the new tests, on 2026-10-10, killed each one with the test meant
for it.

### The hostile review

A reviewer who had not seen the build attacked it on 2026-10-10. It ran the unit tests, probes of
its own, and small breaks of its own, in a copy outside the repository, with no database. It found
one problem of high weight, three of medium weight, and several small ones.

| Finding | What it found | What changed |
| --- | --- | --- |
| H1, high | The words of a refusal for no usable rate named the bill's currency: "no usable rate for EUR". `classifications.json` labels an amount's currency confidential, above the agent's clearance, so `invoice.get` withholds it, and the refusal told it (DSOR-CLS-02a). A dry run told it too, with no key and no proposal. The tests asked for the leak | The agent hears "no usable rate". The decision's record names the currency and the cause, in `unconvertible` (decision D7, changed). The tests check that no answer names a currency, the source, or the age |
| M1, medium | A sheet that was there already, or one published in the future, was refused inside the work, after DSoR had said yes. So its proposal ended FAILED, its record said ALLOW, and a dry run answered VALIDATED: step 25's mistake again | Line ⑨ asks the store what a load would do (decision D16). The work still answers for two loads at one moment, and a database test makes that race happen |
| M2, medium | No test showed that line ⑩ uses the company's own policy, source, and sheets. Four of its breaks held line ⑩ to org_456 or to `ecb-daily`, and every test stayed green | org_789 converts with its own sheets, its own `P7D`, and its own source, and `rate.load` takes only its own source |
| M3, medium | No test loaded an older sheet after a newer one, so "the newest" could have been "the last loaded" | A unit test and a database test |
| L1 | In another currency, an amount with seven places after the point was converted, though step 24 refuses one in the limit's own. On the database, 0.0000000 EUR would book nothing, which the reservations table refuses as a bug | An amount that cannot be read to six places fits no limit, in any currency (decision D17) |
| L2 | No test of a slip with a limit for one day only, of a currency that is no currency, of a day filled exactly through conversions, of a dry or prepared `rate.load`, of the store's copy, of line ⑩ inside the claim, of a load broken halfway, of two loads at one moment, or of the database's clock against the program's | A test of each. The clock tests move the program's clock ten days, and the database's clock still decides |
| L3 | Sentences that were wrong: a scheduled job and `dsor_covers` told as if they were built, "Dsor-scheduler", a citation of the wrong decision, and a program that printed 15:05 with its clock at 15:00 | Rewritten, and the program's clock moves to 15:05 |
| L4 | The README's writing: "In plain words" in 11 sentences, words used before they were defined, three meanings of "lock", "the picture of moves", and "a clock of its own" | Rewritten |
| L5 | A rate of 1e-30 is taken, so a bill of 9,000.00 EUR books 0.000001 USD | Left open: §10.1 trusts the rate source |

The unit tests for H1, M1, and L1 were written red first: 14 failed for the reasons above. The
database tests were written after their fixes, so the second sweep broke each fix, to show that the
tests fail without it.

### The second sweep

It made 20 small breaks: the 8 of the reviewer's breaks that no test saw, and 12 of the fixes. They
took out each company's own policy, source, and sheets at line ⑩, the newest sheet by its time, the
store's copy, and line ⑩ inside the claim; line ⑨'s question, in memory and on the database, the
database's clock and its company filter there, and the work's answer to a load at the same moment;
the check of an amount that cannot be read, and its words; and the words of a refusal, and the
record's note of the cause. Each one was killed by the test meant for it.

### Left open on purpose

- One place decides that a rate is too old: line ⑩'s check of the store's answer. B2 showed that
  without it an old sheet converts. A proposal's moves have a second guard, the database's trigger.
  Whether a rate's age needs one too is left open.
- The agent still learns from "no usable rate" that the bill is not in the limit's currency.
  Hiding that too would leave plain words, which name no cause at all, against decision D7.
- A load that meets another at the same moment hears `CONFLICT` from the work, after DSoR said yes,
  so its proposal ends FAILED and its record says ALLOW. Only a race reaches it.
- A rate has no bounds: 1e-30 is taken. §10.1 trusts the rate source.
- `classifications.json` gives the money policy's fields no label, so DSOR-CLS-01 treats them as
  confidential. The refusal's words no longer carry them. A later step that shows them labels them
  first.
- The specification names no scale and no direction for a converted booking. This step keeps six
  places and rounds up (decision L6). It is open question 106 in `research/open-questions.md`.
- A sheet's age counts from the time that its loader sends. A loader that sends an old sheet with a
  new time makes it fresh, and only a time in the future is refused (decision D5). It is open
  question 107.
- The list under "Left open, and not this step's idea" above. And from step 25c: the records still
  do not pass `audit-record.schema.json`, and a READY proposal waits for step 31's release, which
  must check the brake, `expires_at`, and the rates of its own time.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-MON-02 | Monetary arithmetic and comparison use decimal arithmetic | [§9 Money and currency](../../../specs/dsor/01-model.md#9-money-and-currency) | Two currencies compared by multiplying across, with no rounding: 14,000,000.00 PKR is exactly 50,000.00 USD. Unit tests in [`test/rates.test.ts`](test/rates.test.ts) |
| DSOR-MON-03 | A limit is compared only through money functions that convert to its currency with the company's rate source | [§9 Money and currency](../../../specs/dsor/01-model.md#9-money-and-currency) | For a slip's two limits: 9,000.00 EUR within 50,000.00 USD, 49,000.00 GBP not. Controls come in step 27. Unit tests in [`test/rates.test.ts`](test/rates.test.ts), and the database's in [`test/rates.db.test.ts`](test/rates.db.test.ts) |
| DSOR-MON-04 | An amount that cannot be converted resolves restrictively: a limit counts as exceeded | [§9 Money and currency](../../../specs/dsor/01-model.md#9-money-and-currency) | No sheet, a sheet older than `max_rate_age`, a newest sheet without the currency, a currency that no sheet lists, a code that is no currency, and an amount that cannot be read to six places. The agent hears "no usable rate", and the record names the currency and the cause. Unit tests in [`test/rates.test.ts`](test/rates.test.ts), and the database's in [`test/rates.db.test.ts`](test/rates.db.test.ts) |
| DSOR-MON-06 | A cumulative limit accumulates in its own currency, each reservation converted at the rate in force when it is taken | [§9 Money and currency](../../../specs/dsor/01-model.md#9-money-and-currency) | A booking converted and rounded up when it is taken, given back as kept, and one total for the day across currencies. Unit tests in [`test/rates.test.ts`](test/rates.test.ts), and the database's in [`test/rates.db.test.ts`](test/rates.db.test.ts) |
| DSOR-TEN-01b | Tenant isolation is kept in two independent layers | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | Still met: each company's sheets behind its lock, and DSoR's own WHERE. [`test/rates.db.test.ts`](test/rates.db.test.ts) |
| DSOR-CLS-02a | For an agent, a field above its clearance leaves DSoR omitted, masked, or tokenized | [§19 Classification](../../../specs/dsor/02-security.md#19-classification-and-read-side-governance) | Still met: since the review, a refusal for no usable rate names no currency (finding H1). [`test/rates.test.ts`](test/rates.test.ts), [`test/rates.db.test.ts`](test/rates.db.test.ts) |
| DSOR-OPR-06 | A `validate_only` call makes no proposal and no change | [§7.3 Invocation modes](../../../specs/dsor/01-model.md#73-invocation-modes) | Still met: a dry run converts as the real call does, and books nothing. [`test/rates.test.ts`](test/rates.test.ts) |

DSOR-MON-05, which puts the rate, its source, and its time in a decision bundle, stays step 33's.
This step writes them in the decision's record already (decision L7).

## Next

Step 27 · Controls in CEL. Turn "payments above 25,000 USD need the CFO" into a control, a rule
written in CEL with its own test cases, and compare its amounts through this step's money
functions, by their Appendix B names.
