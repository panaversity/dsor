# Step 15 · Freshness labels

**New in this step:** every query's answer says how old its data is: when it was read,
from which connector, and how fresh a read that was (DSOR-FRS-01a). A cached value is never
labelled `current` (DSOR-FRS-01b). In this tutorial, the label comes from the store that
served the read, never from the operation's code. **Stage 2 is complete.**

## In plain words

An answer can be true when it is read and false an hour later. The agent keeps answers: in
its memory, in its notes, in the prompt of a task that runs later. So from this step, every
query's answer carries a label, like the sticker on a loaf of bread:

```text
freshness: { mode: "current", observed_at: "2026-10-01T09:00:00.123Z", connector: "postgres" }
```

`current` means read from the real system within this request. The other three promise less:
`bounded_staleness` (no older than a stated number of seconds), `observational` (cached or
remembered, with no promise), and `connector_defined` (the connector documents its own
guarantee).

Think of a bakery's stickers: "baked this morning", "baked within 24 hours", "day-old, no
promise". The one thing a bakery must never do is put "baked this morning" on yesterday's
bread. DSOR-FRS-01b is that rule. The analogy stops at the oven. Bread goes stale by the
clock. Data goes stale when the real record changes after it was read, which can happen a
second later, or never.

## Why it matters

**True on Monday morning, false on Monday afternoon.** At 09:00 the agent reads
`INV-1008`: `issued`, 31,400.00 USD owed. At 14:00 a person in accounts pays it. On Tuesday
the agent, working from what it kept, starts the payment again. Nothing was attacked. The
data was old, and nothing said so.

§4 has the same story about a vendor: the agent's memory says "VENDOR-44 is approved", DSoR
says `suspended`, and DSoR wins. "Memory MAY help an agent decide where to look. It never
decides what is true."

**Common mistake:** a label that the code writes. A label typed into an operation's code as
`current` still says `current` the day someone puts a cache in front of the database. The
Stage 2 review found the same shape twice: both company locks trusted the company that the
operation's code asked for. So in this step, the code never writes the label. The store that
served the read writes it, and DSoR collects it.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before any
code existed. These are the parts of the specification it relies on, all read on 2026-10-01:

- §27: its four modes, and DSOR-FRS-01a to DSOR-FRS-02b.
- §4: memory never decides what is true.
- §14's DSOR-TEN-02a: caches keyed by tenant.
- The freshness definitions in `common.schema.json`, `connector.schema.json`,
  `operation-contract.schema.json`, and `decision-bundle.schema.json`.

It builds on step 14 as the Stage 2 review left it: a store bound to the active company, and,
after line ⑨, the company check, then masking, then the 64 KiB check. If the code finds the
plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** No answer hides its age, and no answer claims to be fresher than its data. The
label comes from whatever served the read, not from the code that answers. The analogy is the
bakery's sticker that never says "this morning" on yesterday's bread.

*Narrowed by the review, 2026-10-02:* the label covers the reads this call made through the
bound store, not the data itself. Code that keeps an old copy of `INV-1008` from an earlier
call, makes one fresh read of anything, and answers with the old copy, gets `current`. To
check that every row in an answer is a row read in this call is a second idea, left for a step
of its own ("Think it through").

**Outcome.** What is true when this step is done:

1. Every successful query answer, from `invoice.get` and `invoice.list`, carries
   `freshness`: the mode delivered, `observed_at`, and the connector.
2. A read from PostgreSQL within the request is `current`. Its `observed_at` comes from the
   database's clock, in the transaction that read it. Its connector is `postgres`.
3. The label comes from the store that served the read, through the bound store. The
   operation's code never writes it, and cannot change it. One boundary, found by the review:
   the code runs inside DSoR's own program, so code that rewrites JavaScript's own built-ins,
   such as `Array.prototype.push`, can defeat this check, and every earlier step's too.
4. An answer built from several reads carries the stalest of them: the weakest mode and the
   oldest `observed_at`.
5. A read served by a cache is never `current`. A cache planted in the tests gives
   `observational`, with the time of the read it copied.
6. The record of a read keeps the same label, beside its resources and row count.
7. A refusal carries no freshness, because it holds no data.

**Not the outcome of this step:**

- A real cache (decision 8).
- A caller asking for older, faster data.
- Refusing when the required freshness cannot be had, `FRESHNESS_UNSATISFIABLE`
  (DSOR-FRS-02b, L2), and current reads for the preconditions of risky commands
  (DSOR-FRS-02a, L2). Both belong with commands.
- A resource version (decision 4).

**The success signals.** Each is a test that fails if this step's code is deleted:

- `invoice.get` for `INV-1008` on the database carries `freshness.mode: "current"`,
  `connector: "postgres"`, and an `observed_at` within the call.
- The same call through the planted cache, after a first read, carries
  `freshness.mode: "observational"` and the first read's `observed_at`.
- A planted operation whose code puts its own `freshness: current` into its answer still
  gets the store's label beside it. The code's field is only data.

### What the specification asks, and what this step can honestly give

Checked on 2026-10-01:

1. **DSOR-FRS-01a asks for `observed_at`, the `resource_version` where one exists, the
   connector, and the mode actually delivered.** Invoices have no version, so there is none
   to state (decision 4).
2. **DSOR-FRS-01b is about cached values, and DSoR has no cache.** Every real read is
   honestly `current`. The rule is proven against a cache planted in the tests (decision 8).
   That shows the label follows whatever served the read.
3. **The specification spells the modes two ways.** §27's table, DSOR-FRS-01b, and
   `decision-bundle.schema.json` write `CURRENT`. `common.schema.json`, which the contract
   and connector schemas use, writes `current`. Recorded as a question (decision 3).
4. **`connector.schema.json` makes freshness something a connector declares:** the list of
   modes it can deliver. This step follows that shape. Each store reports the mode of each
   read it serves.
5. **§27 does not rank `connector_defined`** against the other modes. Decision 6 needs a
   ranking, and puts it below `bounded_staleness`. Recorded as a question.
6. **The decision bundle (DSOR-AUD-03a, L2) records `observed_at` and `freshness` for every
   state it read.** Decision 7 keeps the same facts in the record of a read. This is an early
   piece of it, not a claim of the rule.
7. **No schema has a place for the label in a query's answer, or in a record.**
   *Found before any code, 2026-10-01, by reading the schemas whole:*
   - `result-envelope.schema.json` allows no field it does not list, and `freshness` is not
     listed. A query's answer is already this tutorial's own shape (step 04's decision 3),
     so decision 1 still stands.
   - `audit-record.schema.json` allows no field it does not list either. It has a field
     `connector` of its own, and none for the mode or `observed_at`. So decision 7 changed:
     see there.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-FRS-01a | **C1.** Every successful query answer states the mode delivered, `observed_at`, and the connector | `invoice.get` and `invoice.list`, as the agent and as `cfo_100`, on memory and on the database, each carry exactly these three |
| DSOR-FRS-01a | **C2.** `observed_at` is the database's clock, in the reading transaction | It falls between two readings of the database's clock taken around the call. In memory, it falls between two readings of the program's clock |
| DSOR-FRS-01b | **C3.** A cached value is never labelled `current` | The planted cache's second answer says `observational`, with the first read's `observed_at` |
| (our decision) | **C4.** The label comes from the store, through the bound store, and the code cannot write it | A planted store that reports `bounded_staleness` gives an answer that says `bounded_staleness`. A planted operation that writes its own `freshness` into its data does not change the answer's label. A store's label DSoR cannot rank is refused |
| (our decision) | **C5.** Several reads give the stalest label | A planted operation that reads once `current` and once `observational` gives `observational`, with the older `observed_at` |
| (our decision) | **C6.** Only a successful query carries freshness, and a successful query that read nothing is refused | Refusals have no `freshness`. A planted query whose code returns data without reading is `INTERNAL_ERROR` |
| (our decision) | **C7.** The record of a read keeps its label | On the database, the record of the call in C1 holds the same mode, `observed_at`, and connector as the answer |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **The answer grows one field beside `data`: `freshness`,** made of `{ mode, observed_at,
   connector }`. It is DSoR's own metadata, like `correlation`, so the 64 KiB of step 13 does
   not count it, and masking does not walk it. *Downside:* the query answer's shape, step
   04's decision, changes once more.
2. **`observed_at` comes from the database's `now()`, in the transaction that read the
   data.** That is the transaction's start, a moment before the row is read, so the label is
   never younger than the data. It is one clock for every server, as step 09 chose for the
   log. *Downside:* the in-memory store, which the unit tests use, has no database, so it uses
   the program's clock and names its connector `memory`.
3. **The modes are written as `common.schema.json` writes them: lowercase.** The contract and
   connector schemas use that definition. *Downside:* §27's table, its rule DSOR-FRS-01b, and
   `decision-bundle.schema.json` say `CURRENT`, so a reader sees both spellings.
4. **No resource version yet.** DSOR-FRS-01a asks for one "where one exists", and invoices
   have none. A version that is always 1 would teach nothing. The map plans versions for step
   21, with the writes that move them. *Downside:* the label cannot yet say which version of
   `INV-1008` was read.
5. **The label travels from the store to DSoR, never through the code.** It works in three
   parts:
   - Each read the raw store serves comes back with its label.
   - The bound store, `companyOf`, which the checklist builds, hands the code the rows only.
     It notes each read's label in a list that only the checklist can reach.
   - After line ⑨, the checklist takes the labels from that list. The `Company` the code is
     given has no way to see, add to, or change it.
   - *Found while building, 2026-10-01:* it takes them last, after the company check,
     masking, and the 64 KiB check. None of those waits, so no read can be noted after the
     answer was copied. And an answer one of them refuses is refused for that reason, not
     for reading nothing, so decision 6 never hides an earlier step's check.
   - *Added by the review, 2026-10-02:* the bound store closes when line ⑨ ends. A `Company`
     the code kept from an earlier call reads nothing more: its reads throw. Before, such a
     read worked, and its label went into the earlier call's list, which nobody read again.

   This follows the Stage 2 review's lesson: where DSoR can check something itself, it does
   not take its operation code's word for it. *Downside:* `companyOf` grows a second job, and
   the raw store's read functions change shape.
6. **Several reads give the stalest label.** The mode is the weakest, in this order:
   `current` before `bounded_staleness`, before `connector_defined`, before `observational`.
   The `observed_at` is the oldest. The connector is the one that served the oldest read.
   The weakest mode and the oldest time can come from two different reads. The label then
   takes each from its own read, because each is the worst of its kind. When two reads have
   the same oldest time, the connector is the first of them. *Added after the mutation sweep,
   2026-10-02,* which showed the design said nothing about a tie.
   - A successful query whose code read nothing is refused with `INTERNAL_ERROR`, because a
     label for it would be invented, and DSOR-FRS-01a asks for one.
   - *Added before any code, 2026-10-01:* a label from a store that is not one of the four
     modes, or has no time, or names no connector, is refused with `INTERNAL_ERROR` too. An
     unknown mode has no place in the order, and guessing one could rank it above
     `current`. The bound store keeps only the three fields, so a store cannot add a fourth.
   - *Added by the review, 2026-10-02:* one label that fails its check refuses the whole
     call, even when the code catches the error and reads again. And the label is small: a
     connector is named by a short id, 1 to 64 lowercase letters, digits, `.`, `_`, or `-`,
     starting with a letter, and a time has at most 9 digits after the second. Both are this
     tutorial's choices: `connector.schema.json` gives a connector's id no pattern.

   *Downside:* a query that reads a fresh invoice and an old vendor is labelled old as a
   whole. A query that will one day compute an answer without reading needs a rule of its
   own. And every test that plants code returning data without a read must now read once.
7. **The record of a read keeps its label,** split the way step 14 split the classification:
   the audit record's own field where the schema has one, and this tutorial's `extensions`
   where it has none (DSOR-SCH-02).
   - The connector goes in the record's own field `connector`. Migration `008` adds the
     column, and `dsor_runtime` gets `INSERT` on it.
   - The mode and `observed_at` go under `extensions`, `org.panaversity.steps`, as
     `freshness`, beside step 14's `classification`.

   So the log can answer "what did DSoR know when it answered?". *Changed before any code,
   2026-10-01:* the design first put all three in a new column `freshness`. The record's
   schema allows no such field (point 7 above). *Downside:* one label, kept in two places,
   and `dsor_runtime`'s list of privileges grows by one word.
8. **No real cache. The tests plant one.** It wraps the raw store, below the bound store. It
   is keyed by company and id, and keeps the label of the read it copied:
   - its mode becomes `observational`;
   - its `observed_at` stays the time of the first read, never "now".

   A real cache, when a step needs one, follows the same two rules. It is keyed by company,
   as DSOR-TEN-02a requires. And, as this tutorial's choice, it sits below the bound store, so
   that the company check, masking, and the 64 KiB check run on every answer it serves. *Downside:* FRS-01b is proven
   against a cache the program does not have.
9. **A fresh Neon branch, as decided after the Stage 2 review.** Step 15 runs on a branch
   built from `main`, which is empty, with every migration run. So "every record carries its
   company" is true there again. *Downside:* `main` still has `neondb_owner`'s original
   password, the one that appeared in step 09's transcript, and a new branch copies it. So
   the setup stops for a person to reset it before `.env` is written.

### The tests, by claim

- **C1.** Run `invoice.get` and `invoice.list` as `accounts-payable-fte` and as `cfo_100`,
  on memory and on the database. `freshness` has `mode`, `observed_at`, and `connector`,
  and nothing else.
- **C2.** On the database: take `SELECT now()` before the call, make the call, then take
  `SELECT now()` after. `observed_at` lies between the two. On memory, it lies between two
  readings of the program's clock. *Added while writing the tests, 2026-10-01:* the same
  database test again, with the program's clock set to 2001 during the call. A label from
  the program's clock would say 2001. *Added by the review, 2026-10-02:* the statements the
  store sends on its one connection, in order: `BEGIN`, the company, `now()`, the
  invoices, `COMMIT`. A `now()` from another transaction, or taken after the rows, fails.
- **C3.** A planted cache under the bound store. The first `invoice.get` is `current`. The
  second is `observational`, with the first read's `observed_at`. The cache is keyed by
  company: `org_789`'s first read of `INV-1008` is `current`, not `org_456`'s cached copy.
- **C4.** A planted raw store that reports `bounded_staleness` gives an answer that says so.
  A planted operation that writes `freshness: "current"` into its data:
  - The answer's `freshness` is still the store's label.
  - The code's field is withheld from an agent as `<unlabelled>` (step 14).

  Written as an object, `freshness: { mode: "current" }`, the code's field is refused for
  everyone with `INTERNAL_ERROR`, because step 14 refuses an object in a field that has no
  label. *Changed before any code, 2026-10-01:* the design first expected the object to
  reach a person as data. The first red run showed step 14's rule, from the Stage 2 review.

  A planted operation that *tries* to change its recorded reads leaves the label exactly as
  the store recorded it. It tries through every property of the `Company` it is given, its
  prototype included, and by changing the rows it got back. *Added before any code,
  2026-10-01:* the learner's prediction for break Z6 ("only a test that tries to") showed the
  design had no such test, so Z6 would have survived.

  A planted store whose label has an unknown mode, no time, or no connector gives
  `INTERNAL_ERROR`. One that adds a fourth field gives a label of three. *Added before any
  code, 2026-10-01,* with decision 6's second point.

  *Added by the review, 2026-10-02:* code that keeps its `Company` and reads through it in a
  later call gets an error, and that call fails. Code that catches a bad label's error and
  reads again still gets `INTERNAL_ERROR`. A connector of 65 characters, or with a space, and
  a time with 10 digits after the second, give `INTERNAL_ERROR`.
- **C5.** A planted operation that reads twice, through a planted store whose second read is
  `observational`. The answer is `observational`, with the older `observed_at`. The same in
  the other order. And two reads where the weakest mode and the oldest time are different
  reads: the label takes each from its own read.
- **C6.** Answers of `RESOURCE_NOT_FOUND`, `TENANT_MISMATCH`, and `AUTHORIZATION_DENIED`
  have no `freshness`. A planted query that returns data without a read gets `INTERNAL_ERROR`.
- **C7.** The record of C1's call holds the answer's connector in `connector`, and its mode
  and `observed_at` under `extensions`. On memory and on the database. `dsor_runtime`'s
  privileges are step 14's list plus `connector` in the `INSERT` columns.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| Z1 | The checklist writes `current` itself, ignoring the recorded reads | C3, C4, and C5: the planted stores | caught by the planted stores |
| Z2 | `observed_at` is the program's clock on the database | C2's database test with the program's clock set to 2001, every time. Without it: only when the two clocks differ enough | not asked; the expectation stands |
| Z3 | Refusals carry `freshness` too | C6 | not asked; the expectation stands |
| Z4 | Several reads give the freshest label, not the stalest | only C5 | only the two-read test |
| Z5 | The cache gives `observed_at` as "now" instead of the first read's time | only C3's time check | only C3's time check |
| Z6 | The code is handed the list of recorded reads, so it can change them | C4's planted operation that tries to | only a test that tries to (and there was none: C4 gained one) |

The review also attacks the step with the threat that is its reason: a stale or cached
value presented as live, whether through the code, a cache, a clock, or a combination of
reads.

### Left open, and not this step's idea

- **A real cache**, keyed by company, below the bound store (decision 8).
- **Resource versions**: step 21.
- **`FRESHNESS_UNSATISFIABLE`, and current reads for risky commands** (DSOR-FRS-02a and
  02b, L2): these come with commands.
- **A caller asking for older, faster data**, with `bounded_staleness` and
  `max_age_seconds`.
- **The two spellings of the modes, and how to rank `connector_defined`:** questions for
  the specification.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup itself,
this way:

1. Create a branch `step-15` **from `main`**, the project's empty branch, with the Neon MCP
   server or with `neonctl branches create`. Do **not** make it from `step-14`. Its log holds
   records from before the company column existed, and records from breaks run against the
   database (decision 9).
2. **Stop. A person resets `neondb_owner`'s password on `step-15` in the Neon console.**
   `main` still has the original password, the one that appeared in step 09's transcript.
   *In this build, 2026-10-01,* the learner asked Claude Code to do the reset. It called
   Neon's API from a script that printed only the status. Neon's MCP tool for a reset gives
   back the new password, so it would have put the password in the chat.
3. Write `.env` with `neonctl connection-string`, sending its output into the file and
   never printing it:
   - `DSOR_MIGRATION_URL`: the owner's string.
   - `DSOR_DB_URL`: the same string, with the user `dsor_runtime` and a new random password
     (letters and digits).

   Give both `sslmode=verify-full`.
4. Run `pnpm migrate`. On an empty branch it creates `dsor_runtime` and runs every
   migration, `001` to `008`. It also sets `dsor_runtime`'s password from `DSOR_DB_URL`.
5. Check without looking: `pnpm test:db` passes, and the transcript holds no
   `postgresql://` with a password in it.

## What changed since step 14

| File | What changed |
| --- | --- |
| `src/freshness.ts` | **New.** The four modes, the label `{ mode, observed_at, connector }`, `checkedLabel` (decision 6's checks), the notebook `Reads` of one call, and `stalest` (decision 6) |
| `src/invoice.ts` | Each read of the raw store comes back as `{ invoice, freshness }` or `{ rows, freshness }`. Memory labels each read `current`, with the program's clock, connector `memory` |
| `src/postgres.ts` | Each read asks for `now()` in its own transaction, before the rows, and is labelled `current`, connector `postgres`. The log writes and reads the column `connector` |
| `src/company.ts` | The bound store checks and notes each read's label in the call's notebook, and hands the code the rows only. It reads nothing once line ⑨ has ended |
| `src/pipeline.ts` | The notebook for each call. Line ⑨ closes it. After the company check, masking, and the 64 KiB check, the answer gets `freshness`, and the record gets the label |
| `src/envelope.ts`, `src/log.ts` | A query's answer has `freshness`. A read's record has `connector`, and `freshness` under `extensions` |
| `migrations/008_read_freshness.sql` | **New.** The column `connector` in `dsor.audit`, and `INSERT` on it for `dsor_runtime` (decision 7) |
| `src/main.ts` | Prints the first record to every depth, so its freshness shows |
| `test/stores.ts` | **New.** The stores the tests plant under the bound store: `relabelled`, and the cache `cacheOver` (decision 8) |
| `test/freshness-label*.ts`, `test/observed-at*.ts`, `test/cached-reads*.ts` | **New.** C1, C2, and C3, on memory and on the database |
| `test/label-from-store.test.ts`, `test/stalest-label.test.ts`, `test/no-label-on-refusal.test.ts`, `test/label-in-record*.ts` | **New.** C4, C5, C6, and C7 |
| `test/helpers.ts` | `registryWith` makes planted code read `INV-1008` first (`afterARead`). `registryRunning` keeps the code as the test wrote it. `forComparing` (was `withoutRequestId`) sets aside the read's time too. `FROM_MEMORY` |
| every other test | C1 broke 65 older unit tests: answers compared whole now carry their label, raw-store calls take `.invoice` or `.rows`, and planted code that answered without reading now reads. C7 broke 3: records compared whole. Step 12's suite compares two answers without their read times, and its planted `rewritten`, `dump`, `theirs`, and `cached` read first. Step 11's owner-store test writes its own records |

Every other file is step 14's, without its `NEW IN STEP` markers. No new dependency.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_14_classification_and_masking/src mj_15_freshness_labels/src
git diff --no-index mj_14_classification_and_masking/test mj_15_freshness_labels/test
```

## Run it

Set up Neon first ("Before you build" above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # on an empty branch: every migration, 001 to 008
pnpm check        # typecheck and the unit tests
pnpm test:db      # the database tests
pnpm start        # the program, against the database
```

The program's first answer, on 2026-10-02. The agent reads `INV-1008`:

```text
{
  data: {
    tenant_id: 'org_456',
    id: 'INV-1008',
    vendor_id: 'VENDOR-44',
    status: 'issued'
  },
  classification: 'internal',
  redactions: [
    { field: 'amount', reason: 'clearance', treatment: 'omitted' },
    { field: 'open_amount', reason: 'clearance', treatment: 'omitted' }
  ],
  freshness: {
    mode: 'current',
    observed_at: '2026-10-01T20:05:33.056Z',
    connector: 'postgres'
  },
  correlation: {
    request_id: 'req_b63723bb-5ad5-4783-8d6f-b1a5244fa2d3',
    agent_id: 'accounts-payable-fte'
  }
}
```

The time is in UTC, the database's own clock: 01:05 on 2 October in Pakistan. Further down,
the record of the same read:

```text
{
  …
  at: '2026-10-01T20:05:34.194Z',
  operation: 'invoice.get@1',
  authorization: 'ALLOW',
  result: 'ok',
  …
  extensions: {
    'org.panaversity.steps': {
      freshness: { mode: 'current', observed_at: '2026-10-01T20:05:33.056Z' },
      classification: 'internal'
    }
  },
  resources: [ 'dsor://org_456/invoice/INV-1008' ],
  row_count: 1,
  connector: 'postgres'
}
```

The record was written about a second after the read: `at` is later than `observed_at`. The
label says when the data was read. The record says when DSoR answered.

## Break it

Every break of the design's table, performed on 2026-10-02, one at a time, in a copy of this
folder outside the repository, then put back. First on the code before the review, then
again on the final code. Z2 changes how the database is read, so it ran on the database
tests. The others ran on the unit tests.

| # | The break | Learner's prediction | Before the review | On the final code |
| --- | --- | --- | --- | --- |
| Z1 | The checklist writes `current` itself, ignoring the recorded reads | caught by the planted stores | **17 tests**, every one a planted store or planted code: C3, C4, C5, C6's "read nothing", and C7's slower store | 22: the same, and the review's planted stores |
| Z2 | `observed_at` is the program's clock on the database | not asked | **1**: C2's test with the program's clock in 2001. The test between two readings of the database's clock passed, as expected | 2: the same test, and the review's one for `invoice.list` |
| Z3 | Refusals carry `freshness` too | not asked. The design expected C6 | **229**: C6, and every test since step 04 that compares a refusal whole, and the error envelope's schema, which allows no extra field | 229 |
| Z4 | Several reads give the freshest label, not the stalest | only the two-read test | **7**, all C5's: right | 9: C5's, the tie, and the record of two reads |
| Z5 | The planted cache gives `observed_at` as "now" | only C3's time check | **1** in memory and 1 on the database, C3's time check: right | the same |
| Z6 | The code is handed the list of recorded reads | only a test that tries to | **2**: C4's tamper test, and step 10's test of the company's exact keys | the same |

**Z2, the clock.** In `src/postgres.ts`, make `fromPostgres` use `new Date()` instead of the
time the database gave. One test fails:

```text
 × DSOR-FRS-01a: on the database, observed_at does not follow the program's clock
AssertionError: expected 978307200000 to be greater than or equal to 1790884842753
```

978307200000 is 1 January 2001, the time the test gave the program's clock. A label from the
program's clock says what that clock says. The other C2 test, "between two readings of the
database's clock", passed with the break: the program's clock and the database's clock were
close enough. That is why C2 has a test that moves the program's clock.

**Z6, caught by an older test too.** Hand the code the notebook, `Object.freeze({ tenant,
invoices, reads })`. C4's tamper test finds the list and rewrites it. And step 10's test,
which checks that the company has exactly the keys `tenant` and `invoices`, fails too. The
learner's "only a test that tries to" was half right: a test of the company's shape tries
too, without knowing it.

**Z3 was expected to be caught by C6.** It is caught by 229 tests. Every test since step 04
compares refusals whole, so a field added to every refusal shows everywhere.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Design first | "In plain words", "Why it matters", "The design, before any code", in a session before this one |
| 2 | Neon | A branch `step-15` from `main`, empty. The owner's password reset before `.env` is written, and `.env` written by a command, never shown ("Before you build"). `pnpm migrate` runs every migration, and `pnpm test:db` is green before any change |
| 3 | Check the design | Against every rule sentence and every schema it names, read whole. Two changes before any test: the record's own `connector` field, and the answer's shape |
| 4 | Red | Every new test, before any code. Predict the red run |
| 5 | Green | One claim at a time, C1 to C7. Predict what each claim turns green, and how many older tests it breaks |
| 6 | Break it | Z1 to Z6, for real, in a copy |
| 7 | Review | Two reviewers who have not seen your conversation. One reads and attacks. One breaks the code a line at a time, in a copy with a Neon branch of its own |
| 8 | Fix the review | Decide each finding: fix it or record it. The design first, then the red tests, then the code, one finding per commit. Show each new test failing on the break it was written for |
| 9 | Break it again | Z1 to Z6 on the final code |

The prompt that started this session:

```text
Set up, then build step 15 in learner mode.

Setup: follow README "Before you build" exactly. Create branch step-15 FROM main (not from
step-14) in project <your Neon project>, then STOP and tell me, so I reset neondb_owner's
password on step-15 in the console. After I say "reset", write .env only through commands
whose output goes into the file: never print, fetch, or read a connection string or
password. Then pnpm migrate (it runs every migration on the empty branch) and pnpm test:db.

Build: README's design is agreed. If the code proves it wrong, change the design section
first and tell me. Red tests first, one commit per claim. Before you finish, ask the
requirement-reviewer for a hostile pass and fix what it finds, red first.
```

The learner's predictions, and what happened:

| Moment | Prediction | Real |
| --- | --- | --- |
| The red run: 43 new unit tests, before any code | 0 pass | **15 pass**: 4 guards, 1 that step 14's rule makes true, and 10 "a broken label gives `INTERNAL_ERROR`" tests that passed for step 14's reason, not this step's |
| The red run on the database: the guard "a refused read leaves no connector" | passes | **fails**: `column "connector" does not exist`. Its own SQL names the column migration 008 adds |
| C1 lands: which claims' tests are all green | C2, C3, C4, C5 | C2 and C3. C4 partly: the 10 tests that passed for the wrong reason turned **red**. C5 red: several reads were refused until C5 |
| C1 lands: how many of the 924 older unit tests break | 0 | **65** |
| C4 lands: which of its 13 red tests turn green | all 13 | **right** |
| C5: times compared as text would leave how many of 7 tests green | 6 | **right**: only the time-zone test fails |
| C7 lands: how many older tests break | 0 | **3**: records compared whole |
| The review's red run: 8 new unit tests | all 8 fail | **7**: the "a 64-character connector is kept" test passed. It says yes, and nothing said no yet |
| The review's statement-order tests on the database | both pass | **right**: C2's code was right, and nothing tested it |
| Z1, Z4, Z5 | as in "Break it" | right. Z6: half |

## Check yourself

1. DSoR reads the real system every time. Why does an answer need a freshness label?
2. Why must the label come from the store that served the read, and not from the
   operation's code?
3. DSoR has no cache. How does this step still prove that a cached value is never
   `current`?
4. An answer reads a fresh invoice and a cached vendor. What label does it carry, and why?
5. Why is `observed_at` the database's clock, and why must a cache keep the first read's time?

<details>
<summary>Answers</summary>

1. The agent keeps answers and uses them later. The label travels with the data, so it
   still says when the data was read when someone looks at it again.
2. A label written by the code would still say `current` the day a cache is put in front of
   the database. The code could also write it wrongly. The store knows how it served the
   read, and the bound store passes that to DSoR without the code in between.
3. The tests plant a cache, and the answer it serves must say `observational`, with the
   time of the read it copied.
4. `observational`, with the cached read's time. An answer is only as fresh as its stalest
   part.
5. The database's clock gives one clock for every server running DSoR, as step 09 chose for
   the log. Read inside the transaction, it is never younger than the data. A cache that
   said "now" would make old data look new: its `observed_at` would be false, which breaks
   DSOR-FRS-01a.

</details>

## Think it through

**What the review found, and fixed.** A hostile reviewer read the step and attacked it. A
second one broke the code 80 times, one line at a time. Each finding below was shown red
first, then fixed:

- **A `Company` kept from an earlier call still read** (F2). Its label went into the old
  call's list, which nobody read again. So a later answer could carry a cached row,
  labelled `current`. The bound store now closes when line ⑨ ends (decision 5).
- **Code could catch a bad label's error, read again, and succeed** (F7). Now one bad label
  refuses the call (decision 6).
- **A label had no size limit** (F9). A connector is now a short id, and a time has at most 9
  digits after the second (decision 6).
- **Nothing tested "in the reading transaction"** (F6). A test now watches the statements the
  store sends on its connection, in order.
- **Three of step 12's planted operations read nothing** (F5). Decision 6 refused them before
  step 10's answer check mattered, so deleting that check left their tests green. They read
  first now.
- **The sweep's 34 surviving breaks.** 21 were real. Each now has a test that fails on it:
  every part of the time's pattern, a list's label, a store that rewrites a label it handed
  over, the label taken last, the record of two reads and of code that writes its own label,
  the list's clock in memory and on the database, and another connector in the database's
  record. 13 could not change what DSoR does, and one showed the design said nothing about
  a tie. It does now (decision 6).
- **The wording.** Decision 5 was stated beside DSOR-FRS-01b as if it were a rule.
  `connector_defined` is not "older". Step 21 is planned, not built. A real cache below the
  bound store is this tutorial's choice. And a cache that says "now" breaks DSOR-FRS-01a's
  `observed_at`, not DSOR-FRS-01b.

**Found by step 16's review (2026-10-03), and fixed from step 09 on.**

- **The log trusted an `INSERT` that kept nothing.** `add` never asked how many rows the
  database wrote. A **rule** on `dsor.audit` rewrites a statement before it runs, and a
  **trigger** is a function the database runs on each new row. A rule `DO INSTEAD NOTHING`,
  or a trigger that runs before each row and returns `NULL`, makes the database take the
  `INSERT` and keep no row. Then the agent gets `INV-1008`, and no record says it asked.
  - **Fixed:** `add` throws unless the `INSERT` wrote exactly one row. It throws inside the
    company's transaction, so the transaction is rolled back, and the caller hears
    `EVIDENCE_STORE_UNAVAILABLE` (DSOR-EXE-03b). The count catches a log that keeps
    nothing. It is no defense against the table's owner, who can send the row to another
    table, or delete it afterwards. Tamper evidence makes a deleted record visible
    (DSOR-AUD-04b), and the map plans it for step 39.
  - **Caught by** `DSOR-EXE-03b: a log whose INSERT keeps no row gives no invoice, and no
    record`, in `test/audit.db.test.ts`. On its way to the database, the test swaps the
    log's `INSERT` for an `INSERT … SELECT … WHERE false` with the same values: a real
    statement on the real database, which keeps no row. The test also checks that the
    database kept 0 rows, so an `INSERT` that fails cannot pass it.
- **The start-up check read PostgreSQL's names through the search path.** A **schema** is
  a folder of tables and functions. The **search path** is the list of schemas PostgreSQL
  looks in to find a name such as `has_table_privilege`. PostgreSQL's own names live in
  the schema `pg_catalog`, which is searched first unless the search path names it later.
  The owner can set a search path that names `public` before `pg_catalog`, and make
  functions in `public` with PostgreSQL's names that answer "no". Then a login that can
  change the log passes the check.
  - **Fixed:** the check runs inside a read-only transaction of its own, which starts with
    `SET LOCAL search_path TO pg_catalog, pg_temp`: PostgreSQL's own schema first, and the
    schema for temporary tables last. `SET LOCAL` lasts only until the transaction ends.
    The check also takes one connection, as well as a pool, so a test can run it inside a
    transaction that the test opened.
  - **Caught by** two tests in `test/audit.db.test.ts`. `DSOR-AUD-04a: the start-up check
    reads PostgreSQL's own names, whatever the search path finds first` runs
    `test/owner-login-check.ts` as the owner. Inside a transaction that is rolled back, it
    makes look-alikes of `has_table_privilege`, `has_any_column_privilege`, and
    `pg_has_role` in `public`, names `public` before `pg_catalog`, and runs the check on
    that connection. The owner can change the log, and the check must still say so.
    `DSOR-AUD-04a: the start-up check pins the search path inside a transaction of its
    own` runs the check on a pool, as the program does. Outside a transaction, PostgreSQL
    ignores `SET LOCAL` and warns, so the test expects no warning. It cannot see a pool
    that skips the pin altogether, because no `SET LOCAL` gives no warning either.
- **In this build:** before the fixes, the first two tests failed. The call answered with
  `INV-1008`'s data. The owner's problems left out "can change or remove records in
  dsor.audit" and "is a member of pg_write_all_data", because the look-alikes answered
  "no". The third test passed, as expected: before the fix, the check sent no `SET LOCAL`,
  so nothing warned. Broken on purpose three ways: `add` ignoring the row count, the check
  without `SET LOCAL`, and the pool's path without its `BEGIN READ ONLY`. Each turned its
  own test red. The second and third left the other 115 database tests green. With the
  first, three more tests timed out at 30 s. Run again with the same break, those three
  passed, and the `INSERT` test failed alone. The database tests went from 113 to 116.

**Left open on purpose.** The learner chose each of these:

- **The label covers the reads, not the data** (F1). Code that keeps an old copy of
  `INV-1008` from an earlier call, reads anything fresh, and answers with the copy, gets
  `current`. To check that every row in an answer equals a row read in this call is a second
  idea: it would refuse every older test that answers with rows it made, and step 12's
  planted leaks before its suite could see them. Step 12's `invoice.cached` shows the gap.
  Open question 55.
- **DSoR believes its stores** (F4). A cache that passes on the `current` label it copied,
  or a label dated 2099, is accepted. A store is DSoR's own connector, not the agent.
  DSOR-FRS-01b holds as honestly as the connectors label their reads. To check a `current`
  label's time against the call would compare two machines' clocks, which decision 2
  avoided. Open question 56.
- **JavaScript's built-ins** (F3). The code runs inside DSoR's own program. Code that rewrites
  `Array.prototype.push` can rewrite a label as it is noted, and can defeat every earlier
  step's checks the same way. The defense is reviewing the code, or running it apart.
- **One connector for several reads** (F8). A current read from `postgres` and an
  observational one from a cache give `{ observational, postgres }`, and the record hides
  the cache. The specification's place for each read's own label is the decision bundle
  (DSOR-AUD-03a, L2). Open question 54.
- **Years 0000 to 0099** are refused as times, because JavaScript reads them as 1900 to 1999.
  No store writes them.

**Found while building.**

- **Step 11's owner-store test needed records that other tests had left.** On this step's
  empty branch it failed. It writes its own records now. Steps 11 to 14 still carry the old
  test. One run also took 45 s, where it takes 11, so its limit is now 60 s, the limit of the
  program it starts.
- **Every query must read now.** Planted code in older tests that answered with data it made
  now reads `INV-1008` first (`afterARead`). The label is taken last, so a planted answer
  that an earlier check refuses is still refused for that check's reason.
- **Two answers now differ by their read's time.** Step 12's suite compared two answers word
  for word, and found differences of one millisecond. It now sets the time aside, as it does
  the request id.

**Questions for the specification:**

These are in `research/open-questions.md`:

- §27 and DSOR-FRS-01b write `CURRENT`. `common.schema.json` writes `current` (question 51).
- §27 does not rank `connector_defined` against the other modes (question 52).
- `audit-record.schema.json` has no place for a read's mode or `observed_at` (question 53),
  and `result-envelope.schema.json` none for a query's label (question 19).
- DSOR-FRS-01a names "the connector", one, for a query that may read from several
  (question 54).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-FRS-01a | Every query result states `observed_at`, the version where one exists, the connector, and the mode delivered | [§27 Freshness and consistency](../../../specs/dsor/03-execution.md#27-freshness-and-consistency) | `test/freshness-label.test.ts` and `test/freshness-label.db.test.ts`: `invoice.get` and `invoice.list`, for the agent and for `cfo_100`, carry exactly the three (C1). `test/observed-at.test.ts` and `test/observed-at.db.test.ts`: the time is the store's clock, the database's in the reading transaction, for `get` and for `list` (C2). `test/label-from-store.test.ts`: the mode delivered is the store's (C4). **Partly:** invoices have no version yet (decision 4) |
| DSOR-FRS-01b | A cached value is never labelled `CURRENT` | [§27 Freshness and consistency](../../../specs/dsor/03-execution.md#27-freshness-and-consistency) | `test/cached-reads.test.ts` and `test/cached-reads.db.test.ts`: the planted cache's answer is `observational`, with the first read's time (C3). **Against a cache planted in the tests:** DSoR has none (decision 8), and believes what its stores say ("Think it through", F4) |

Also built, as this tutorial's decisions: the label travels through the bound store, which
the code cannot reach, and closes when line ⑨ ends (C4, decision 5); several reads give the
stalest (C5); a query that read nothing is refused (C6); and the record keeps the label
(C7).

## Next

Stage 2 is complete. Step 16 · The control-plane store: DSoR's own paperwork, such as
permission slips, pending work, counters, and the log, gets a home of its own beside the
business tables. This tutorial opened that home, the `dsor` schema, early, in step 09.
