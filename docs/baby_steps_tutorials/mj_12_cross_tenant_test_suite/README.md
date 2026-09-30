# Step 12 · The cross-tenant test suite

**New in this step:** one test, generated from the list of operations, calls every
operation with another company's URI, and grows by itself each time an operation is added
(DSOR-TEN-02b).

## In plain words

Steps 10 and 11 keep each company's data away from the others, and tests prove it for the
two operations that exist. But each of those tests exists because someone wrote it. This
step writes one test that cannot forget. It walks the **registry**, step 03's list of
every operation, and attacks each operation it finds there:

```text
a normal request      invoice.get  { invoice: "dsor://org_456/invoice/INV-1008" }
the company swapped   invoice.get  { invoice: "dsor://org_789/invoice/INV-1008" }
the answer            TENANT_MISMATCH, no data
```

Think of step 10's bank teller, and a mystery shopper: a tester the bank sends in, posing
as a customer. For every service on the bank's list, the new ones too, the shopper hands
the teller a form that names another customer's account, and expects "not your account".
Then the shopper asks about their own account and opens the envelope: only their own
papers may be inside. The form tests the teller at the counter: DSoR's checklist, which
every call runs. The envelope tests the back office: each operation's own code, which a
refused form never reaches.

## Why it matters

**A new operation can leak, and every old test stays green.** Say someone adds
`invoice.peek`, which takes a bare `{ id }` and finds it in any company. The agent of
`org_456`, `accounts-payable-fte`, asks for `INV-1008` and gets `org_789`'s invoice:
99,000.00 USD from VENDOR-77. No existing test knows that `invoice.peek` exists, so none of
them fails. DSOR-TEN-02b asks for a test of every operation: "An implementation MUST ship
a cross-tenant test suite that exercises every operation with a foreign-tenant URI."

**A test can pass for the wrong reason.** Every call runs one checklist, numbered as §21
numbers it (step 07). Line ② checks the company the request names. Line ⑤ checks the
permission. Line ⑥ checks the input's shape. In this tutorial, the company inside a URI
is checked after lines ⑤ and ⑥ (step 10's decision 4). So when the agent sends
`org_789`'s URI to `invoice.issue`, line ⑤ refuses it, because the agent may not issue,
and the URI's company is never looked at. A suite that accepted any refusal would pass
without testing what it claims.

**The counter is not the whole bank.** The checklist refuses every foreign URI before
any operation's code runs. So a foreign URI never meets that code. Code that answers a
same-company request with another company's invoice is met only by a same-company
request, so the suite sends one too, and looks inside the answer.

**Common mistake:** a suite that silently skips an operation it cannot handle, such as
one with no example request. A skipped operation looks exactly like a tested one when
every test is green.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of the specification it relies on was read on
2026-09-30: §14 (DSOR-TEN-02b), §28 (DSOR-ERR-01b), §11 (DSOR-SRC-02b), §12
(DSOR-IDN-03b), and §21 on the order of the checklist. If the code finds the plan wrong,
the plan changes here first.

*Changed before the first test, 2026-09-30.* Checking this design against the code found
three gaps, and the learner chose each answer. `invoice.get` takes an invoice's URI and
nothing else (decision 1). The suite swaps one URI at a time (decision 3). Each attacker
first sends the example unchanged, so a refusal for any reason but the company cannot
pass (decision 8, claim C7). C2, C3, and C4 also gained tests.

*Changed after the review, 2026-09-30.* Two reviewers who had not seen the conversation
attacked the finished step. Fake operations that leak passed the suite, because the
checklist refuses every foreign URI before any operation's code runs. The learner chose
three changes. The same-company call's answer is searched for another company's data
(claim C8). The suite works in both companies, `org_456` and `org_789` (decision 9). And
it takes the call function as an argument, so a test can hand it a fake DSoR (decision
10). The analogy changed too, from a hotel inspector to the bank's mystery shopper. The
mutation sweep, which changed the code in 103 small ways, then showed that an example
naming an invoice its company lacks made the suite prove less, silently. So a query's
same-company call must now answer with data (decision 8).

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** No operation reaches callers without a cross-company test, because the test
is generated from the registry and nobody has to remember to write it. The analogy is
the bank's mystery shopper.

**Outcome.** What is true when this step is done:

1. For every operation in the registry, the suite sends its example request with one
   URI's company swapped, three ways. To `org_789` with the same id. To `org_789` with
   the id `NOPE`, which it does not have. And to `org_999`, a company that does not
   exist. Every answer is `TENANT_MISMATCH`, with no data. An example with two URIs is
   attacked one URI at a time.
2. The three answers are the same, word for word, apart from the request id.
3. Each attack is made by every principal who holds the operation's permission in the
   company the suite works in. The suite works in `org_456`, then in `org_789`. So
   `firm-ap-fte`, who belongs to both, attacks in each direction.
4. Before its attacks, each caller sends the example unchanged, in its own company: a
   **same-company call**. Its answer is not `TENANT_MISMATCH`, so the refusals come from
   the company that changed. A query's same-company call is answered with data, so the
   example names a thing that exists, in both companies. And its answer holds nothing of
   another company: no `tenant_id` and no URI of another company.
5. Nothing is skipped. These turn the suite red: an operation with no example, an
   example with no URI of its company, an example that leaves out a field its input
   schema lists, and an operation that nobody in the company may call.
6. **Planted** operations turn the suite red. A planted operation is a fake one, added
   only inside one test, to prove the suite would notice it. There are four: one that
   takes a bare `{ id }`, one that answers with every company's invoices, one that
   answers with the other company's, and one that keeps invoices in a cache keyed by id
   alone.
7. `invoice.get` takes a canonical URI, `{ invoice: "dsor://org_456/invoice/INV-1008" }`,
   like `invoice.issue`. A URI that names anything but an invoice is refused at line ⑥.
8. The suite runs in `pnpm check`, with the invoices in memory, so CI, the checks GitHub
   runs on every push, runs it too. It runs again in `pnpm test:db`, where every
   same-company read goes through the database.

**Not the outcome of this step.** A fresh Neon branch made and deleted for each run, as
the map of all steps suggests (decision 7). Attacks that are not URIs, such as a company
in a field named `tenant`: step 10's tests cover those. Leaks that the example does not
reach (see "Left open").

**The success signals**, each a test that fails if this step's code is deleted:

- The suite's own count: it attacked exactly the operations the registry holds.
- The planted `{ id }` operation turns the suite red, with a finding that names it. A
  **finding** is one problem the suite names.
- Handed a fake DSoR that answers every request with data, as if step 10's URI check
  were gone, the suite names every attack.
- The planted operations that leak through a same-company call turn the suite red.
- A planted operation whose code refuses every request with `TENANT_MISMATCH`, its own
  company's too, turns the suite red.

### What the specification asks, and what this step can honestly give

Checked on 2026-09-30:

1. **DSOR-TEN-02b asks for every operation, with a foreign-tenant URI.** The suite
   covers every operation in the registry, the commands too. A command is refused
   before its code runs. In this tutorial's checklist, the URI's company is checked
   before "is it built?", so a command answers `TENANT_MISMATCH` too.
2. **The map's "Done when" says "adding a new operation without tenant checks makes this
   suite fail".** In this tutorial, the checklist checks every URI once, before any
   operation's code. A new operation cannot forget that check. What it can forget is to
   stay inside its company in its own code. The suite catches that only through what a
   same-company call answers (C8): a bare id, an answer with another company's data, a
   cache keyed by id alone. A leak that only another input would show is not caught.
3. **The map says the suite "runs on a fresh Neon branch, so it can create two companies
   and destroy them".** The two companies already exist, written by step 10's migration.
   This step runs on the step's own branch, and makes no branch per run. That would need
   a Neon API key that can delete branches (decision 7).
4. **DSOR-ERR-01b** is checked again, now for every operation: the answer never tells
   whether the other company's thing, or the other company, exists.
5. **The database run does not attack the database's lock.** A foreign URI is refused
   before any read, and the code hands the store the active company. So step 11's lock
   in the database never meets a foreign company. The database run proves that the same
   checks hold with the real store and the real log. Every same-company read goes through
   the database and answers with its own company's invoice. And every attack's record
   lands in the caller's company, under step 11's policy.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-TEN-02b | **C1.** Every operation in the registry is called with foreign-tenant URIs, one URI at a time, from both companies, and each answer is `TENANT_MISMATCH` with no data | The suite's findings are empty, and it attacked every operation in the registry |
| DSOR-ERR-01b | **C2.** The three foreign answers of an operation are the same, apart from the request id | Compared word for word, for every operation, caller, and URI |
| DSOR-IDN-03b | **C3.** A principal who belongs to both companies, working in one, cannot reach the other | `firm-ap-fte` attacks from `org_456` and from `org_789` |
| DSOR-TEN-02b | **C4.** Nothing is skipped: every gap in an example, or no caller allowed, is a finding | A registry with each gap planted gives each finding |
| DSOR-TEN-02b | **C5.** The suite notices an operation that takes a bare id | The planted `invoice.peek { id }` gives a finding |
| DSOR-EXE-02 | **C6.** Every attack leaves its record in the caller's company, with its operation, result, and reason | One record per attack, in the company it worked in, and none in the other |
| DSOR-TEN-02b | **C7.** The refusal is for the company, and for nothing else: the same-company call is not answered `TENANT_MISMATCH`, and a query's is answered with data | A planted operation that refuses everything as foreign, and a query whose example names a missing invoice, each give findings |
| DSOR-IDN-03b | **C8.** An operation's own code answers a same-company call with nothing of another company | The planted `invoice.dump`, `invoice.theirs`, and `invoice.cached` each give a finding |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **`invoice.get` takes a canonical URI:** `{ invoice: "dsor://org_456/invoice/INV-1008" }`.
   Step 02 gave every thing one address, and now every operation names the thing it works
   on the same way. The suite needs one trick: swap the company. The code reads the id
   out of the URI, and still reads only inside the active company, the one line ②
   checked. Only an invoice's URI is accepted. The input schema adds our own `/invoice/`
   part to the specification's pattern, so `dsor://org_456/vendor/VENDOR-44` is refused
   at line ⑥, before the code, as every input has been since step 07. *Downside:* step
   07's input `{ id }` changes, and every test and example that used it changes too. The
   schema holds a pattern of ours beside the specification's. `invoice.issue` still
   accepts a URI of any kind, until step 22 gives it code.
2. **Each operation has an example request in a file:** `examples/<operation>.json`,
   beside `contracts/` and `inputs/`. The suite reads it and checks it against the
   operation's input schema. The example must name every field that schema lists, so a
   field that may hold a URI is attacked too. An example file that no operation names is
   a finding too: most likely a name spelled wrong. *Downside:* one more file for each
   new operation. That is the point: the suite turns red until it exists.
3. **The swap goes three ways, one URI at a time.** The URI's company becomes `org_789`,
   with the same id. In this story `org_789` has an `INV-1008` of its own. Then the
   company becomes `org_789` with the id `NOPE`, which it does not have. Then the company
   becomes `org_999`, which does not exist. The other URIs in the example stay in their
   company, so each attack carries exactly one foreign URI. Swapping them all at once
   would let an operation that checks only its first URI pass. *Downside:* three calls
   for each URI, caller, and operation. And the suite never checks that `org_789` really
   has the same id (see "Left open").
4. **The only accepted answer is `TENANT_MISMATCH`, from callers who may call the
   operation.** For each operation, the suite finds in DSoR's own tables every principal
   whose roles in the company grant the operation's permission, and attacks as each of
   them. Any other answer, a refusal included, is a finding. *Downside:* an operation
   that nobody in `org_456`, or nobody in `org_789`, may call is a finding too. Its
   author must give some role its permission before it ships.
5. **The suite is a function that returns findings,** and it never stops at the first
   one. The real test expects no findings. The test of the test runs the same function
   over a registry with planted gaps, and expects each gap named. *Downside:* the
   findings are text the tests must match, so their wording is part of the test.
6. **It runs in both tiers.** A tier is one kind of test run: the unit tests, which need
   no database, and the database tests. In `pnpm check`, the invoices come from memory,
   so CI runs the suite on every push. In `pnpm test:db`, the same suite runs with the
   database's store and log. *Downside:* the two runs share the suite, so a bug in it
   hides in both. And the database run does not attack the database's lock (point 5
   above).
7. **No throwaway Neon branch per run.** The suite runs on the step's own branch,
   `step-12`, where step 10's migration already made both companies. A branch per run
   would need a Neon API key in `.env`, and that key can create and delete branches and
   projects. *Downside:* the map's "fresh branch" is not done, and the branch's log grows
   with every run.
8. **Each attacker first sends the example unchanged, in its own company: a
   same-company call.** Its answer must not be `TENANT_MISMATCH` (C7). For a query, it
   must be data: then the example names a thing its company has, and, moved to the other
   company with the same id, a thing that company has too. So the first way of the swap
   really names something that exists. If it holds data,
   the data may hold no `tenant_id` and no URI of another company (C8). This is the only
   request that reaches an operation's code, so it is where the code's own mistakes
   show. *Downside:* one more call for each operation and caller. It sees only what the
   example asks for. And it knows two signs of a company, a `tenant_id` field and a URI:
   data that names a company another way passes. And a query's example must name a thing
   both companies hold, so the stored data must have one. A command is refused before its
   code runs until step 22, so its same-company call cannot answer with data yet.
9. **The suite works in both companies:** first in `org_456`, then in `org_789`. For
   `org_789`, the example's `org_456` URIs are rewritten to `org_789`, and the swaps go
   to `org_456`. So `firm-ap-fte`, who belongs to both, attacks each company from the
   other. And a cache keyed by id alone, filled in one company, is read from the other.
   *Downside:* 27 attacks instead of 15, and every operation needs a caller in both
   companies.
10. **The suite takes the call function as its last argument,** `call` unless a test
    hands it another. A test hands it a fake DSoR: one that answers every request with
    data, as if step 10's URI check were gone, or one whose three answers differ. So the
    suite's use of its judge and its comparer is tested, not only those two functions
    alone. *Downside:* one more argument, and a fake to read.

### The tests, by claim

- **C1:** the suite over the shipped registry gives no findings, and attacked both
  operations from both companies: 27 attacks, each with its own request id. Handed a fake
  DSoR that answers every request with its company's invoice, as step 10's missing URI
  check would, it names all 27. The swap of an example with two URIs gives six requests,
  each with exactly one foreign URI, and the suite sends all six. A URI inside a list is
  swapped too. A text that only contains a URI is not a URI, and is not swapped.
- **C2:** the three answers of each operation, caller, and URI, with the request id
  taken out, are equal. The comparer, handed three answers whose messages differ, names
  a finding. *Added before the first test:* without it, a suite that never compares
  stays green. And a fake DSoR whose three answers differ gives one finding for each
  caller and URI. *Added after the review:* without it, the suite's call to the comparer
  could be deleted, and every test stayed green.
- **C3:** the attackers are exactly the principals who hold the permission. In
  `org_456`: for `invoice.get`, `accounts-payable-fte`, `cfo_100`, `firm-ap-fte`, and
  `user_123`; for `invoice.issue`, `user_123` alone. In `org_789`: `firm-ap-fte` and
  `user_700`, for both.
- **C4:** planted registries: an operation with no example file, an example that is not
  JSON, an example whose only URI is `org_789`'s, an example that fails its own input
  schema, an example that leaves out a field its schema lists, and an operation whose
  permission no role grants. Each gives the findings that name the operation and the
  gap. An example file that no operation names gives one finding. And the suite's judge,
  handed an answer of `AUTHORIZATION_DENIED`, `VALIDATION_FAILED`, `RESOURCE_NOT_FOUND`,
  or a success with data, names each one as a finding: a refusal for the wrong reason is
  not a pass. *Added before any code, 2026-09-30:* the learner's prediction for break W3
  showed that without it, nothing would catch a suite that accepts any refusal.
- **C5:** a planted `invoice.peek` with input `{ id }` gives the finding "no URI of
  org_456 in its example".
- **C6:** in the database tier, after the suite, each company holds one record for each
  attack made in it: `DENY`, `TENANT_MISMATCH`, the operation, and the reason. The other
  company holds none of them.
- **C7:** a planted operation whose code refuses every request with `TENANT_MISMATCH`
  gives one finding for each caller, in each company. A planted query whose example names
  `INV-2001`, which only `org_789` has, gives a finding for each caller in `org_456`.
  One whose example names `INV-9999`, which nobody has, gives one for each caller in both.
  *Added after the sweep.*
- **C8:** the planted `invoice.dump`, which answers with every company's invoices,
  `invoice.theirs`, which answers with the other company's, and `invoice.cached`, which
  keeps invoices in a cache keyed by id alone, each give findings. The data search,
  handed data with another company's URI deep inside it, names it.
- **Decision 1:** `invoice.get` with `{ id }` is refused by line ⑥, and with its URI
  gives `INV-1008` of the active company. A vendor's URI is refused by line ⑥. The code,
  handed `org_789`'s URI while working in `org_456`, still reads `org_456`'s invoice.

### Breaks we will try, and what we expect

W1 to W7 were run against the step before the review ("Break it"). W8 and W9 test the
changes the review brought. The learner's predictions were recorded before the code
they break.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| W1 | Step 10's URI check is taken out of the pipeline | the suite, for every operation, in both tiers | red for every operation, in both tiers |
| W2 | The suite stops after the first operation | only the count in C1 | only the count catches it |
| W3 | The suite accepts any refusal | C4's judge, handed a wrong-reason refusal | survives, unless a planted test (and there was none: C4 gained one) |
| W4 | The rule "an example must hold a URI of org_456" is removed | C5, the planted `{ id }` operation | red: example has no URI |
| W5 | The suite compares the three answers with the request id left in | a false alarm: every operation is a finding | not asked |
| W6 | The suite leaves out the same-company call | C7, the planted operation that refuses everything | only C7 |
| W7 | The swap changes every URI at once | C1's swap of a two-URI example | only the two-URI swap test |
| W8 | The same-company call's data is not searched | C8's planted operations | only the three planted leaks |
| W9 | The suite works in `org_456` only | C3's attackers in `org_789`, the count, and `invoice.cached` | only `invoice.cached` |

### Left open, and not this step's idea

- **A throwaway Neon branch for each run** (decision 7).
- **One database test alone guards step 11's helper.** Step 11 found that only one test
  catches a connection that goes back to the pool still holding a company. A second test
  belongs with the next change to that helper, `inCompany`.
- **The database tier in CI.** Steps 10 and 11's breaks that live in SQL are caught only
  by `pnpm test:db`, which CI does not run. This step puts DSoR's own check of every
  operation into CI. The database's lock still waits for a database in CI.
- **An operation whose input holds no URI.** Step 13 adds `invoice.list`, whose input
  may name no invoice at all. The suite will call that a finding, as outcome 5 says.
  Step 13 must decide how a list is attacked. The same-company call's data search
  (C8) is a start: a list must hold no row of another company.
- **Leaks the example does not reach.** The suite attacks what the example holds. It
  does not reach a bare id beside a URI, a URI used as the name of a field, or code that
  leaks only for an id another company has.
- **`NOPE` may break a stricter input.** An operation whose input schema allows only ids
  like `INV-` and digits refuses `NOPE` at line ⑥, and the suite calls that a finding.
  The easy way to green is to loosen the schema, which is wrong. The example could name
  a missing id of its own.
- **"The same id" is checked to exist for queries only.** A query's same-company call must
  answer with data in both companies (decision 8). A command's cannot yet, so for a
  command the first way of the swap may name nothing, and the comparison of the three
  answers then proves less. Step 22, which gives commands code, can close this.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup
itself, this way:

1. Create a branch `step-12` **from `step-11`**, with the Neon MCP server or with
   `neonctl branches create`. It carries step 11's roles, so the owner's password is the
   one you reset on `step-11`.
2. Write `.env` with `neonctl connection-string`, its output redirected into the file,
   never printed: the owner's string as `DSOR_MIGRATION_URL`, and the same string with
   the user `dsor_runtime` and a new random password (letters and digits) as
   `DSOR_DB_URL`. Both with `sslmode=verify-full`.
3. Run `pnpm migrate`. It sets `dsor_runtime`'s password from `DSOR_DB_URL`.
4. Check without looking: `pnpm test:db` passes, and the transcript holds no
   `postgresql://` with a password in it.

## What changed since step 11

| File | What changed |
| --- | --- |
| `examples/invoice.get.json`, `examples/invoice.issue.json` | **New.** One example request for each operation (decision 2) |
| `test/cross-tenant.ts` | **New.** The suite: `attackersOf`, `judge`, `compare`, and `crossTenantSuite`, which returns a report of what it attacked and what it found (decision 5). It takes the call function as its last argument (decision 10) |
| `test/companies.ts` | **New, after the review.** Where the suite finds and changes a company: `swaps`, the example moved into another company, and `foreignIn`, the data search. Split from `test/cross-tenant.ts` when that file passed 300 lines |
| `test/cross-tenant.test.ts` | **New.** C1 to C5, C7, and C8, over the shipped registry, over registries with one fake operation planted in each, and with fake DSoRs |
| `test/cross-tenant.db.test.ts` | **New.** The suite with the database's store and log, and C6: the record of every attack, in each company |
| `test/invoice-get.test.ts` | **New.** Decision 1 |
| `inputs/InvoiceGetRequest.schema.json` | `{ invoice }`, an invoice's canonical URI, in place of `{ id }` (decision 1) |
| `src/operations.ts` | `invoice.get`'s code reads the id out of the URI, and still reads inside the active company |
| `src/main.ts` | Every call to `invoice.get` sends a URI. The firm's agent sends each company's own |
| every other test | About 170 inputs `{ id: "INV-1008" }` became the URI of the caller's active company. Three tests changed more, and two were put right after the review (see "Think it through") |
| `.claude/skills/build-baby-step/SKILL.md` | Version 2.3.0, which the copy from step 11 had missed |

Every other file is step 11's, without its `NEW IN STEP` markers. No new dependency.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_11_row_level_security/src mj_12_cross_tenant_test_suite/src
git diff --no-index mj_11_row_level_security/test mj_12_cross_tenant_test_suite/test
git diff --no-index mj_11_row_level_security/inputs mj_12_cross_tenant_test_suite/inputs
```

## Run it

Set up Neon first ("Before you build" above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # no new migration: it only sets dsor_runtime's password again
pnpm check        # typecheck and the unit tests, the suite on memory among them
pnpm test:db      # the database tests, the suite with the database among them
```

To run only the suite and its tests, on memory:

```bash
npx vitest run test/cross-tenant.test.ts test/invoice-get.test.ts --reporter=verbose
```

On 2026-09-30, on the final code:

```text
✓ DSOR-IDN-03b: the code, handed org_789's URI while working in org_456, reads org_456's invoice
✓ DSOR-TEN-02b: the shipped registry: both operations attacked from both companies, 27 times, no findings
✓ DSOR-TEN-02b: handed a fake DSoR with no URI check, the suite names every one of the 27 attacks
✓ DSOR-TEN-02b: the suite sends all six swaps of a two-URI example, after the same-company call
✓ DSOR-ERR-01b: handed a fake DSoR whose three answers differ, the suite names each caller and URI
✓ DSOR-IDN-03b: in org_789, invoice.get is attacked by the firm's agent and user_700
✓ DSOR-TEN-02b: an example that leaves out a field its input schema lists is named, and the rest is still attacked
✓ DSOR-TEN-02b: code that refuses every request as foreign, its own company's too, is a finding
✓ DSOR-IDN-03b: invoice.dump, which answers with every company's invoices, is a finding
✓ DSOR-IDN-03b: invoice.theirs, which answers with the other company's invoice, is a finding
✓ DSOR-IDN-03b: invoice.cached, which keeps invoices by id alone, is a finding from org_789
…
      Tests  39 passed (39)
```

Why 27 attacks: in `org_456`, `invoice.get` has 4 callers and `invoice.issue` has 1. In
`org_789`, each has 2: `firm-ap-fte` and `user_700`. That is 9 callers. Each example
holds 1 URI, and each URI is sent 3 ways: 9 × 1 × 3 = 27. Each caller also sends one
same-company call, which is not counted as an attack.

`pnpm check` prints `616 passed`, and `pnpm test:db` prints `64 passed`. `pnpm start`
prints what step 11's program printed, with every call sending a URI.

## Break it

Every break of the design's table, performed on 2026-09-30, one at a time, then put
back from a copy and compared byte for byte. W1 to W7 ran twice: on the step before the
review (commit `1e01b0a`), and on the final code (commit `5abb240`). W8 and W9 test what
the review added, so they ran on the final code only. W1 and W9 change what reaches the
database, so they also ran on the database tier.

| # | The break | Learner's prediction | Before the review | On the final code |
| --- | --- | --- | --- | --- |
| W1 | Step 10's URI check is taken out of the pipeline | red for every operation, in both tiers | 12 unit, 2 database | **19 unit**: every suite test that uses the real checklist, and 4 of step 10's. **3 database** |
| W2 | The suite stops after the first operation | only the count | 8: the count, and every planted test | **16**: the count, both fake DSoRs, and every planted test |
| W3 | The suite accepts any refusal | survives, unless a planted test | 3: the judge's own tests | 3 |
| W4 | The rule "an example must hold a URI of org_456" is removed | red: the example has no URI | 2: `invoice.peek`, and the example whose only URI is `org_789`'s | 2 |
| W5 | The three answers are compared with the request id left in | not asked | 9: a false alarm everywhere the real checklist answers | 16 |
| W6 | The suite leaves out the same-company call's check | only C7 | 1: C7 | 1: C7, as predicted |
| W7 | The swap changes every URI at once | only the two-URI swap test | 1 | 2: the swap's own test, and the fake that records what is sent |
| W8 | The same-company call's data is not searched | only the three planted leaks | not built yet | **3**: `invoice.dump`, `invoice.theirs`, `invoice.cached`, as predicted |
| W9 | The suite works in `org_456` only | only `invoice.cached` | not built yet | **8 unit, 2 database**: every test that expects `org_789`'s attacks or findings |

**W1, the one this step is for.** In `src/pipeline.ts`, comment out
`checkUrisInTenant(checked, tenant);`. Then:

```text
$ npx vitest run test/cross-tenant.test.ts -t "the shipped registry"
AssertionError: expected [ …(33) ] to strictly equal []
+ [
+   "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008 sent to org_789, with the same id: answered with data, not TENANT_MISMATCH",
+   "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008 sent to org_789, with an id it does not have: answered RESOURCE_NOT_FOUND, not TENANT_MISMATCH",
+   "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008 sent to org_999, which does not exist: answered with data, not TENANT_MISMATCH",
+   "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008: the three answers differ",
    …the same four for user_123, cfo_100, and firm-ap-fte in org_456…
+   "invoice.get as firm-ap-fte in org_789, dsor://org_789/invoice/INV-1008 sent to org_456, with the same id: answered with data, not TENANT_MISMATCH",
    …and so on for firm-ap-fte and user_700 in org_789…
+   "invoice.issue as user_123 in org_456, dsor://org_456/invoice/INV-1008 sent to org_789, with the same id: answered UNSUPPORTED_CAPABILITY, not TENANT_MISMATCH",
    …
+ ]
```

Every operation is named, with every caller, from both companies, and every way. Look
at "answered with data": it is the caller's own company's INV-1008. The code reads inside
the active company, whatever company the URI names, so nothing of the other company
leaked. The suite still calls it a finding, because a request that names another company
must be refused, not answered with something else. The comparer notices too: `NOPE` is
not found, and the other two are answered. Here the difference comes from the caller's
own invoices, but an answer that changes with the company named is the kind that can
tell a caller about another company.

The fake DSoR with no URI check (decision 10) now does the same in a test that is always
there: it names all 27 attacks. So W1 no longer depends on someone running it by hand.

**W2 and W9, more than predicted.** The learner expected only the count to notice W2,
and only `invoice.cached` to notice W9. But every planted operation comes after the two
shipped ones, so a suite that stops after the first never reaches it. And every test
that expects `org_789`'s attacks, findings, or callers notices a suite that never works
there: the counts, both fake DSoRs, C4's permission that nobody holds, C7, and all three
leaks.

**W8, as predicted.** Only the three planted leaks answer a same-company call with
another company's data, so only they notice when nobody looks.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Design first | "In plain words", "Why it matters", "The design, before any code", in a session before this one |
| 2 | Neon | A branch `step-12` from `step-11`, and `.env` written by a command, never shown ("Before you build") |
| 3 | Check the design | Against step 11's code. Three gaps, and the learner chose each answer, in the design before any test |
| 4 | Mechanical | Step 11's `NEW IN STEP` markers removed |
| 5 | Red | Every new test, beside a **stub**: a suite with the right functions, which attack nothing and find nothing. Predict how many pass |
| 6 | Green | Decision 1, then C1, C2, C4, and C7, one commit each. Predict each |
| 7 | Break it | W1 to W7, for real |
| 8 | Review | Two reviewers who have not seen your conversation attack the step. Ask one to plant operations that leak, and see if the suite notices |
| 9 | Fix the review | Change the design first, then the tests, then the code: both companies, the data search, the fake DSoR, two more gaps. Predict each |
| 10 | Break it again | W1 to W7 on the fixed code, and W8 and W9 for what the review added |

The learner's predictions, and what happened:

| Moment | Prediction | Real |
| --- | --- | --- |
| Red run, stub suite | every new test fails | 20 of 22 failed. The 2 that expect "no finding" passed: a stub that finds nothing says "fine" to everything |
| After decision 1 | 5 pass | 5 |
| After C1 | 3 more pass | **9**: `attackersOf` and `judge` are C1's own code, so C3's two tests and the four judge tests passed with it |
| After C1, database | both pass | both |
| After C4 | 5 more pass | **6**: C5's `{ id }` operation is caught by the same check as C4's example with no URI of `org_456` |
| After the review, both companies | 3 of 17 pass | **6**: the count, C4's permission nobody holds, and C7 expect `org_789` too |
| W8 and W9 | only the leaks; only `invoice.cached` | W8 right. W9 was caught by 8 tests |

The learner's pattern across this step: each commit turned more tests green than
predicted, because one piece of code often serves several claims.

Build your own step 12 from a copy of your step 11. From `docs/baby_steps_tutorials`:

```bash
cp -R my_11_row_level_security my_12_cross_tenant_test_suite
cd my_12_cross_tenant_test_suite
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 12. Set up Neon as "Before you
build" says: a branch from step-11, and secrets only from a command into .env, never
through the chat. Check the design against step 11's code before any test, and change
the design first when the code proves it wrong. Red tests first, one commit per claim.
Before each run, ask me what I expect.
```

## Check yourself

1. Steps 10 and 11 already test the two locks. What does a generated suite add?
2. Why must the suite accept only `TENANT_MISMATCH`, and not any refusal? And why does each
   caller first send the example unchanged?
3. Why is an operation with no example request a failure, and not a skip?
4. Why does `invoice.get` take a URI from this step on?
5. The suite runs in `pnpm check` on memory, and in `pnpm test:db` on the database. What
   does each run prove?

<details>
<summary>Answers</summary>

1. It cannot forget. It reads the registry, so an operation added later is attacked
   without anyone writing a test for it.
2. Line ⑤ checks permission before the company is checked. A caller without the
   permission is refused there, and the company check never runs. Only
   `TENANT_MISMATCH` shows the company check ran. The unchanged example is the control:
   it must not be refused as foreign. Then the refusal of the swapped request can only
   come from the company that changed. Without it, code that refuses everything as
   foreign would pass.
3. A skipped operation looks like a tested one in a green run. The suite must fail until
   the operation can be attacked.
4. So there is a company inside every request to swap. With `{ id }`, there was nothing
   to change, and the suite could not make another company's version of the request.
5. On memory, DSoR's own lock holds by itself, and CI runs it on every push. On the
   database, both locks hold together.

</details>

## Think it through

_To be written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-TEN-02b | A cross-tenant test suite exercises every operation with a foreign-tenant URI | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | `test/cross-tenant.test.ts`: the shipped registry attacked from both companies with no finding (C1), the fake DSoR with no URI check named on all 27 attacks, every gap named (C4, C5), and the same-company call (C7). `test/cross-tenant.db.test.ts`: the same with the database |
| DSOR-ERR-01b | An error does not reveal a resource the caller may not read | [§28 Result and error envelopes](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) | `test/cross-tenant.test.ts` (C2): the three answers of every operation, caller, and URI, compared word for word, and a fake DSoR whose answers differ named |

Also advanced, first met in earlier steps: DSOR-IDN-03b, for every operation's own code
as far as a same-company call shows it (C3 and C8, `test/cross-tenant.test.ts`, and
`test/invoice-get.test.ts` for `invoice.get`'s code), and DSOR-EXE-02, one record for
every attack, with its operation, result, and reason (C6, `test/cross-tenant.db.test.ts`).

## Next

Step 13 · Bounded queries: `invoice.list`, whose page size the server caps even when the
caller asks for everything. It is the first new operation. The moment it is registered,
the suite attacks it, or names why it cannot ("Left open").
