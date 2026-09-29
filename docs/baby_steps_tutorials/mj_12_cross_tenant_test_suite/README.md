# Step 12 · The cross-tenant test suite

**New in this step:** one test, generated from the registry, calls every operation with
another company's URI, and grows by itself each time an operation is added
(DSOR-TEN-02b).

## In plain words

Steps 10 and 11 built two locks between companies, and tested them. But each of those
tests exists because someone remembered to write it, for that operation. The day someone
adds `payment.execute` and forgets, nothing turns red, on the operation that moves money.

This step writes one test that cannot forget. Every operation is on one list, the
**registry** from step 03. The test walks that list. For each operation it takes a normal
request, swaps the company inside it for another company, sends it, and expects a
refusal:

```text
a normal request      invoice.get  { invoice: "dsor://org_456/invoice/INV-1008" }
the company swapped   invoice.get  { invoice: "dsor://org_789/invoice/INV-1008" }
the answer            TENANT_MISMATCH, no data
```

An operation added next year is in the test the moment it is in the registry. Nobody
has to remember.

Think of a hotel that fits new doors every month. Its inspector does not trust each
fitter to test their own lock. The inspector walks every door, the ones fitted yesterday
too, and tries a stranger's key card. A door that opens fails the inspection. The analogy
stops at the building: here the inspector also proves, once, that it would notice a door
that opens (outcome 5).

## Why it matters

**The guarantee that ends a product is the easiest one to forget in a new operation.**
Each operation gets its happy path tested, because that is what its author is building.
The cross-company test is about someone else's data, so it is the one that gets left
out. DSOR-TEN-02b asks for it for every operation: "An implementation MUST ship a
cross-tenant test suite that exercises every operation with a foreign-tenant URI."

**A test can pass for the wrong reason.** DSoR checks permission (line ⑤) before it
looks at a URI's company. Send another company's URI to `invoice.issue` as the agent,
and the agent is refused at line ⑤ for lacking `invoice:issue`. The company check never
runs. A suite that accepts any refusal would pass without testing what it claims to
test.

**Common mistake:** a suite that silently skips an operation it cannot handle, such as
one with no example request. A skipped operation looks exactly like a tested one in a
green run.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of the specification it relies on was read on
2026-09-30: §14 (DSOR-TEN-02b), §28 (DSOR-ERR-01b), §11 (DSOR-SRC-02b), and §21 on the
order of the checklist. If the code finds the plan wrong, the plan changes here first.

*Changed before the first test, 2026-09-30.* Checking this design against the code found
three gaps, and the learner chose each answer. `invoice.get` takes an invoice's URI and
nothing else (decision 1). The suite swaps one URI at a time (decision 3). Each attacker
first sends the example unchanged, a control call, so a refusal for any reason but the
company cannot pass (decision 8, claim C7). C2, C3, and C4 also gained tests, listed
under "The tests, by claim".

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** No operation reaches callers without a cross-company test, because the test
is generated from the registry and nobody has to remember to write it. The analogy is
the inspector with a stranger's key card.

**Outcome.** What is true when this step is done:

1. For every operation in the registry, the suite sends its example request with the
   company swapped, three ways: to `org_789` where the thing exists, to `org_789` where
   it does not, and to `org_999`, a company that does not exist. Every answer is
   `TENANT_MISMATCH`, with no data. The same example, unchanged, is not answered
   `TENANT_MISMATCH`, so the company is the reason for the refusal. An example with two
   URIs is attacked one URI at a time.
2. The three answers are the same, word for word, apart from the request id.
3. Each attack is made by every principal that holds the operation's permission in
   `org_456`, `firm-ap-fte` included, who is also a member of `org_789`.
4. An operation with no example, an example with no `dsor://` URI of `org_456`, or no
   principal in `org_456` allowed to call it, turns the suite red. Nothing is skipped.
5. A planted operation that takes a bare `{ id }` turns the suite red. This proves the
   suite would notice such a door.
6. `invoice.get` takes a canonical URI, `{ invoice: "dsor://org_456/invoice/INV-1008" }`,
   like `invoice.issue`. A URI that names anything but an invoice is refused at line ⑥.
7. The suite runs in `pnpm check`, on the in-memory store, so CI checks DSoR's own lock
   for every operation. It runs again in `pnpm test:db`, on the database, where both
   locks hold.

**Not the outcome of this step.** A fresh Neon branch made and deleted for each run, as
the map suggests (decision 7). Attacks that are not URIs, such as a company in a field:
step 10's tests cover those, and the suite covers every field that holds a URI.

**The success signals**, each a test that fails if this step's code is deleted:

- The suite's own count: it attacked exactly as many operations as the registry holds.
- The planted `{ id }` operation turns the suite red, with a message that names it.
- With step 10's URI check taken out of the pipeline, the suite is red for every
  operation.
- A planted operation whose code refuses every request with `TENANT_MISMATCH`, its own
  company's too, turns the suite red.

### What the specification asks, and what this step can honestly give

Checked on 2026-09-30:

1. **DSOR-TEN-02b asks for every operation, with a foreign-tenant URI.** The suite
   covers every operation in the registry. "Every operation" includes the commands, which
   are refused before their code runs. The company check comes first, so a command
   answers `TENANT_MISMATCH` too.
2. **The map says the suite "runs on a fresh Neon branch, so it can create two companies
   and destroy them".** The two companies already exist, written by step 10's migration.
   This step runs on the step's own branch and does not make a branch per run, which
   would need a Neon API key that can delete branches (decision 7).
3. **DSOR-ERR-01b** is checked again, now for every operation: the answer never tells
   whether the other company's thing, or the other company, exists.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-TEN-02b | **C1.** Every operation in the registry is called with foreign-tenant URIs, one URI at a time, and each answer is `TENANT_MISMATCH` with no data | The suite's findings are empty, and its count equals the registry's size |
| DSOR-ERR-01b | **C2.** The three foreign answers of an operation are the same, apart from the request id | Compared word for word, for every operation |
| DSOR-IDN-03b | **C3.** A principal who belongs to both companies, working in one, cannot reach the other | `firm-ap-fte` is among the attackers wherever it holds the permission in `org_456` |
| DSOR-TEN-02b | **C4.** Nothing is skipped: no example, no URI in it, or no caller allowed, is a finding | A registry with each gap planted gives each finding |
| DSOR-TEN-02b | **C5.** The suite notices a door that takes a bare id | The planted `invoice.peek { id }` gives a finding |
| DSOR-EXE-02 | **C6.** Every attack leaves its record in the caller's company | One record per attack, in `org_456`, with the result `TENANT_MISMATCH` |
| DSOR-TEN-02b | **C7.** The refusal is for the company, and for nothing else: the example, unchanged, is not answered `TENANT_MISMATCH` | A planted operation that refuses everything as foreign gives a finding |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **`invoice.get` takes a canonical URI:** `{ invoice: "dsor://org_456/invoice/INV-1008" }`.
   Every operation now names the thing it works on the same way, as step 02 said every
   thing has one address, and the suite needs one trick: swap the company. The handler
   reads the id from the URI, and still reads only inside the active company. Only an
   invoice's URI: the input schema adds our own `/invoice/` part to the specification's
   pattern, so `dsor://org_456/vendor/VENDOR-44` is refused at line ⑥, before the code, as
   every input has been checked since step 07. *Downside:* step 07's input `{ id }`
   changes, and every test and example that used it changes too. The schema holds a
   pattern of ours beside the specification's. `invoice.issue` still accepts a URI of any
   kind, until step 22 gives it code.
2. **Each operation has an example request in a file:** `examples/<operation>.json`,
   beside `contracts/` and `inputs/`. The suite reads it, checks it against the
   operation's input schema, and swaps the company in every `dsor://` URI it holds.
   *Downside:* one more file for each new operation. That is the point: the suite turns
   red until it exists.
3. **The swap goes three ways, one URI at a time:** the company part of the URI becomes
   `org_789`, the same URI's id also becomes one that `org_789` does not have (`NOPE`),
   and the company becomes `org_999`, which does not exist. The other URIs in the example
   stay in `org_456`, so each attack carries exactly one foreign URI. Swapping them all at
   once would let an operation that checks only its first URI pass. *Downside:* three
   calls for each URI, caller, and operation.
4. **The only accepted answer is `TENANT_MISMATCH`, from callers who may call the
   operation.** For each operation, the suite finds in DSoR's own tables every principal
   whose roles in `org_456` grant the operation's permission, and attacks as each of
   them. Any other answer, a refusal included, is a finding. *Downside:* an operation that
   nobody in `org_456` may call is a finding too, and its author must give some role its
   permission before it ships.
5. **The suite is a function that returns findings,** and it never throws on the first
   one. The real test expects no findings. The test of the test runs the same function
   over a registry with planted gaps, and expects each gap named. *Downside:* the
   findings are text the tests must match, so their wording is part of the test.
6. **It runs in both tiers.** In `pnpm check`, the registry reads invoices from memory,
   so DSoR's own lock is tested for every operation on every push, in CI. In
   `pnpm test:db`, the registry reads from the step's Neon branch, so both locks are.
   *Downside:* the two runs share the generator, so a bug in it hides in both.
7. **No throwaway Neon branch per run.** The suite runs on the step's own branch,
   `step-12`, where step 10's migration already made both companies. A branch per run
   would need a Neon API key in `.env`, and that key can create and delete branches and
   projects. *Downside:* the map's "fresh branch" is not done, and the branch's log grows
   with every run.
8. **Each attacker first sends the example unchanged, a control call.** Its answer must
   not be `TENANT_MISMATCH`. Then a `TENANT_MISMATCH` for the swapped request can only
   come from the company that changed. Without it, code that refuses every request as
   foreign would pass the suite. *Downside:* one more call for each operation and caller,
   and it proves only that the example's own company is not refused as foreign, not that
   the example succeeds.

### The tests, by claim

- **C1:** the suite over the shipped registry gives no findings, and says it attacked 2
  operations, as the registry holds 2. And the swap of an example with two URIs gives six
  requests, each with exactly one foreign URI.
- **C2:** inside the suite: the three answers of each operation and caller, with the
  request id taken out, are equal. And the suite's comparer, handed three answers whose
  messages differ, names a finding. *Added before the first test:* without it, a suite
  that never compares stays green.
- **C3:** the attackers are exactly the principals who hold the permission in `org_456`:
  for `invoice.get`, `accounts-payable-fte`, `cfo_100`, `firm-ap-fte`, and `user_123`;
  for `invoice.issue`, `user_123` alone.
- **C4:** four planted registries: an operation with no example file, an example whose
  only URI is `org_789`'s, an example that fails its own input schema, and an operation
  whose permission no role in `org_456` grants. Each gives one finding that names the
  operation and the gap. And the suite's
  judge, handed an answer of `AUTHORIZATION_DENIED`, `VALIDATION_FAILED`,
  `RESOURCE_NOT_FOUND`, or a success with data, names each one as a finding: a refusal
  for the wrong reason is not a pass. *Added before any code, 2026-09-30:* the learner's
  prediction for break W3 showed that without it, nothing would catch a suite that
  accepts any refusal.
- **C5:** a planted `invoice.peek` with input `{ id }` and a handler that ignores the
  company gives the finding "no URI of org_456 in its example".
- **C6:** in the database tier, after the suite, the caller's company holds one record
  per attack, each `TENANT_MISMATCH`.
- **C7:** a planted operation whose code refuses every request with `TENANT_MISMATCH`
  gives the finding that its own company's example is refused as foreign.
- **Decision 1:** `invoice.get` with `{ id }` is refused by line ⑥, and with its URI
  gives `INV-1008` of the active company. A vendor's URI is refused by line ⑥.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| W1 | Step 10's URI check is taken out of the pipeline | the suite, for every operation, in both tiers | red for every operation, in both tiers |
| W2 | The suite stops after the first operation | only the count in C1 | only the count catches it |
| W3 | The suite accepts any refusal | C4's judge, handed a wrong-reason refusal | survives, unless a planted test (and there was none: C4 gained one) |
| W4 | The rule "an example must hold a URI of org_456" is removed | C5, the planted `{ id }` door | red: example has no URI |
| W5 | The suite compares the three answers with the request id left in | a false alarm: every operation is a finding | not asked |
| W6 | The suite leaves out the control call | C7, the planted operation that refuses everything | asked before the first commit |
| W7 | The swap changes every URI at once | C1's swap of a two-URI example | asked before the first commit |

### Left open, and not this step's idea

- **A throwaway Neon branch for each run** (decision 7).
- **Step 11's helper is guarded thinly in one place.** Phase C of step 11 found that a
  failed transaction whose connection returns to the pool without `ROLLBACK`, still
  carrying its company, is caught by exactly one database test. That test lives in step
  11 and is copied here. A second guard belongs with the next change to the helper.
- **The database tier in CI.** Steps 10 and 11's breaks that live in SQL are caught only
  by `pnpm test:db`, which CI does not run. This step moves DSoR's own lock into CI for
  every operation. The database's lock still waits for a database in CI.
- **An operation whose input holds no URI.** Step 13 adds `invoice.list`, whose input
  may name no invoice at all. The suite will call that a finding, as outcome 4 says. Step 13 must decide how a list is attacked: its answer must hold no row
  of another company, which no URI swap can test.

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

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

## Check yourself

1. Steps 10 and 11 already test the two locks. What does a generated suite add?
2. Why must the suite accept only `TENANT_MISMATCH`, and not any refusal?
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
   `TENANT_MISMATCH` shows the company check ran.
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
| DSOR-TEN-02b | A cross-tenant test suite exercises every operation with a foreign-tenant URI | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | _to be counted_ |
| DSOR-ERR-01b | An error does not reveal a resource the caller may not read | [§28 Result and error envelopes](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) | _to be counted_, for every operation |

## Next

Step 13 · Bounded queries: `invoice.list`, whose page size the server caps even when the
caller asks for everything. It is the first new operation, and the suite attacks it the
moment it is registered.
