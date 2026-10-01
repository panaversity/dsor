# Step 15 · Freshness labels

**New in this step:** every query's answer says how old its data is: when it was read,
from which connector, and how fresh a read that was (DSOR-FRS-01a). The label comes from
the store that served the read, never from the operation's code, and a cached value is never
labelled `current` (DSOR-FRS-01b). **Stage 2 is complete.**

## In plain words

An answer can be true when it is read and false an hour later. The agent keeps answers: in
its memory, in its notes, in the prompt of a task that runs later. So from this step, every
query's answer carries a label, like the sticker on a loaf of bread:

```text
freshness: { mode: "current", observed_at: "2026-10-01T09:00:00.123Z", connector: "postgres" }
```

`current` means read from the real system within this request. The other modes mean older:
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

**Outcome.** What is true when this step is done:

1. Every successful query answer, from `invoice.get` and `invoice.list`, carries
   `freshness`: the mode delivered, `observed_at`, and the connector.
2. A read from PostgreSQL within the request is `current`. Its `observed_at` comes from the
   database's clock, in the transaction that read it. Its connector is `postgres`.
3. The label comes from the store that served the read, through the bound store. The
   operation's code never writes it, and cannot change it.
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
| (our decision) | **C4.** The label comes from the store, through the bound store, and the code cannot write it | A planted store that reports `bounded_staleness` gives an answer that says `bounded_staleness`. A planted operation that writes its own `freshness` into its data does not change the answer's label |
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
   have none. A version that is always 1 would teach nothing. Step 21 adds versions, along
   with the writes that move them. *Downside:* the label cannot yet say which version of
   `INV-1008` was read.
5. **The label travels from the store to DSoR, never through the code.** It works in three
   parts:
   - Each read the raw store serves comes back with its label.
   - The bound store, `companyOf`, which the checklist builds, hands the code the rows only.
     It notes each read's label in a list that only the checklist can reach.
   - After line ⑨, the checklist takes the labels from that list. The `Company` the code is
     given has no way to see, add to, or change it.

   This is the Stage 2 review's lesson again: DSoR does not take its own operation code's word
   for anything that it can check. *Downside:* `companyOf` grows a second job, and the raw
   store's read functions change shape.
6. **Several reads give the stalest label.** The mode is the weakest, in this order:
   `current` before `bounded_staleness`, before `connector_defined`, before `observational`.
   The `observed_at` is the oldest. The connector is the one that served the oldest read.
   The weakest mode and the oldest time can come from two different reads. The label then
   takes each from its own read, because each is the worst of its kind.
   - A successful query whose code read nothing is refused with `INTERNAL_ERROR`, because a
     label for it would be invented, and DSOR-FRS-01a asks for one.
   - *Added before any code, 2026-10-01:* a label from a store that is not one of the four
     modes, or has no time, or names no connector, is refused with `INTERNAL_ERROR` too. An
     unknown mode has no place in the order, and guessing one could rank it above
     `current`. The bound store keeps only the three fields, so a store cannot add a fourth.

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

   A real cache, when a step needs one, must follow the same two rules. It must be keyed by
   company (DSOR-TEN-02a). It must sit below the bound store, so that the company check,
   masking, and the 64 KiB check run on every answer it serves. *Downside:* FRS-01b is proven
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
  readings of the program's clock.
- **C3.** A planted cache under the bound store. The first `invoice.get` is `current`. The
  second is `observational`, with the first read's `observed_at`. The cache is keyed by
  company: `org_789`'s first read of `INV-1008` is `current`, not `org_456`'s cached copy.
- **C4.** A planted raw store that reports `bounded_staleness` gives an answer that says so.
  A planted operation that writes `freshness: { mode: "current" }` into its data:
  - The answer's `freshness` is still the store's label.
  - The code's field is withheld from an agent as `<unlabelled>` (step 14).

  A planted operation that *tries* to change its recorded reads leaves the label exactly as
  the store recorded it. It tries through every property of the `Company` it is given, its
  prototype included, and by changing the rows it got back. *Added before any code,
  2026-10-01:* the learner's prediction for break Z6 ("only a test that tries to") showed the
  design had no such test, so Z6 would have survived.

  A planted store whose label has an unknown mode, no time, or no connector gives
  `INTERNAL_ERROR`. One that adds a fourth field gives a label of three. *Added before any
  code, 2026-10-01,* with decision 6's second point.
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
| Z2 | `observed_at` is the program's clock on the database | only C2's database test, and only when the two clocks differ enough | not asked; the expectation stands |
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

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

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
   said "now" would make old data look new, which is the lie DSOR-FRS-01b forbids.

</details>

## Think it through

_To be written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-FRS-01a | Every query result states `observed_at`, the version where one exists, the connector, and the mode delivered | [§27 Freshness and consistency](../../../specs/dsor/03-execution.md#27-freshness-and-consistency) | _to be counted_ |
| DSOR-FRS-01b | A cached value is never labelled `CURRENT` | [§27 Freshness and consistency](../../../specs/dsor/03-execution.md#27-freshness-and-consistency) | _to be counted_, against a cache planted in the tests |

## Next

Stage 2 is complete. Step 16 · The control-plane store: DSoR's own paperwork, such as
permission slips, pending work, counters, and the log, gets a home of its own beside the
business tables. This tutorial opened that home, the `dsor` schema, early, in step 09.
