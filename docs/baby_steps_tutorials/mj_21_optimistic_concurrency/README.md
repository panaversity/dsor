# Step 21 · Optimistic concurrency

**New in this step:** a command names the version of the record its caller decided on, and DSoR
refuses with `STALE_STATE` when the record has moved on (DSOR-CON-01a, DSOR-CON-01b).

## In plain words

Every invoice and every payment now has a *version*: a number that starts at 1 and grows by one
at each change of the row. The database raises it itself, with a *trigger*: a function that the
database runs by itself at each change of a row. A read shows the version. A command names the
version its caller read, as `expected_version`. DSoR does the work only while the record still
has that version. When the record has moved on, DSoR refuses with `STALE_STATE`, which means:
read again, and decide again.

This is *optimistic concurrency*. "Optimistic" means that nothing is locked while the caller
thinks. The check comes at the moment of the write, and the write happens only if the check
passes.

In the office picture, the new clerk now looks at a number in the corner of each invoice. The
number goes up by one at every change, whoever makes the change. A letter that asks him to draft
a payment names the number on the copy its sender read. If the invoice in his drawer has another
number, he drafts nothing, and sends the letter back: "the invoice has changed since you read
it; read it again".

## Why it matters

Friday, 02:05. accounts-payable-fte reads INV-1008: issued, from VENDOR-44. Its clearance hides
the amounts, and the vendor is one it knows, so it decides to pay. At 02:06, somebody changes
INV-1008's vendor to VENDOR-99 in org_456's accounts system. A changed payee is how much invoice
fraud starts. At 02:07 the agent's `payment.create` arrives. Step 20 reads the invoice itself
and drafts PAY-901, 31,400.00 USD to VENDOR-99. The agent decided to pay VENDOR-44. Nobody
decided to pay VENDOR-99. A run of step 20's own code on 2026-10-07 did exactly that: PAY-901,
31,400.00 USD to VENDOR-99.

The contracts have said `"concurrency": { "strategy": "optimistic" }` since step 17. No line
of the checklist read it.

## The design, before any code

This section was written by Claude Code before any code existed. The learner was away and asked
for steps 20 and 21 to be built, so Claude Code made each decision itself, by the learner's two
tests: the closest to production, and the deepest understanding. Each decision is this
tutorial's decision, and each has its downside, for the learner to check later.

The specification it relies on was read on 2026-10-07:

- [§23](../../../specs/dsor/03-execution.md#23-concurrency): DSOR-CON-01a, DSOR-CON-01b, and
  "`CONFLICT` is reserved for business-rule conflicts. `STALE_STATE` means 're-read and decide
  again'."
- [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes): `STALE_STATE` has
  the retry class `after_state_refresh`.
- [§27](../../../specs/dsor/03-execution.md#27-freshness-and-consistency): DSOR-FRS-01a asks every
  query result for "the `resource_version` where one exists". Step 15 left it for this step.
- [§35](../../../specs/dsor/05-bindings.md#35-connector-contract): DSOR-CNR-03b, a
  `resource_version` comes from "the native version, ETag, or a content hash, not from a DSoR-side
  counter". An *ETag* is the version tag that a web server gives a document; a *content hash* is
  a fingerprint of a record's content.
- [§38](../../../specs/dsor/05-bindings.md#38-mcp-binding): `expected_version` is an ordinary
  argument of a tool.
- [§10.2](../../../specs/dsor/02-security.md#102-threats-and-mitigations), T14: writes from
  outside DSoR make DSoR's view stale.

If the code finds the plan wrong, the plan changes here first.

### The intent and the outcome

**Intent.** DSoR never does work that its caller decided on facts that are no longer true.

**Outcome.** What is true when this step is done:

1. `invoice.get` answers INV-1008 with `version: 1`, and its freshness label names
   `resource_version: "1"`.
2. The agent sends `payment.create` for INV-1008 with `expected_version: 1`, and DSoR drafts
   PAY-901.
3. After somebody changes INV-1008's vendor to VENDOR-99, version 2, the same request is
   refused with `STALE_STATE`, and nothing is drafted. The agent reads again, sees version 2
   and VENDOR-99, and decides again. A new decision is a new request, with `expected_version:
   2` and a new key. Here, the agent drafts nothing, and leaves the changed payee to a person.
4. A change that lands between DSoR's read and its write is caught too.
5. user_123 cancels PAY-901 with `expected_version: 1`. It is cancelled, and is version 2. A
   second cancel that names version 1 gets `STALE_STATE`. One that names version 2 gets
   `CONFLICT`: the payment is not a draft.
6. Start-up refuses a command whose strategy this step does not build, and an optimistic command
   whose input does not ask for `expected_version`.

**Not the outcome of this step:**

- The `pessimistic` and `connector_managed` strategies. Start-up refuses them, as not built.
- Versions for DSoR's own records, such as slips and claims.
- An audit record that names the version a call read or wrote.
- A write to an invoice by DSoR: `invoice.issue` has no code yet.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-CON-01a | **C1.** Every command declares a strategy that DSoR keeps | Start-up refuses `pessimistic`, which locks the record while the caller decides, and `connector_managed`, where the system behind a connector checks: neither is built. It refuses an `optimistic` command whose input does not require `expected_version`, a whole number from 1 to 2147483647. `none` is a strategy too, and is accepted |
| DSOR-CON-01b | **C2.** A `payment.create` that names another version of the invoice gets `STALE_STATE` | The agent names version 1 of an invoice that is at version 2. `STALE_STATE`, with `after_state_refresh`, and no draft |
| DSOR-CON-01b | **C3.** A change between DSoR's read and its write is caught | On the database, by *fault injection*: the test makes one thing happen on purpose at one moment. The invoice changes after the code read it and before the draft is written. `STALE_STATE`, and no draft, whatever the database's default level of isolation |
| DSOR-CON-01b | **C4.** A `payment.cancel` that names another version of the payment gets `STALE_STATE` | A second cancel that names version 1, and the payment is unchanged. A draft that something outside DSoR changed, still a draft at version 2: a cancel decided on version 1 gets `STALE_STATE`, and the draft stays |
| DSOR-CON-01b | **C5.** Two cancels that name one version, at the same moment: one wins | On the database, real parallel requests: one cancel, and one `STALE_STATE`. The status alone picks the winner, as in step 17; the version names the loser's refusal |
| (our decision) | **C6.** `STALE_STATE` comes before `CONFLICT` | A stale request is refused as stale, whatever the business rule says. A request on the current version gets the business rule's `CONFLICT` |
| (our decision) | **C7.** The database raises the version at every change, and no writer sets it | The owner's change of an invoice raises its version by one. `dsor_runtime` cannot change `version`. A cancel raises the payment's version |
| DSOR-FRS-01a | **C8.** A read of one record states its `resource_version` | `invoice.get`'s label names it, unless masking hid the version from the caller. `invoice.list`'s label names none: a page holds many records, and each row carries its own version |
| (our decision) | **C9.** `expected_version` is required, a whole number from 1 to 2147483647 | Line ⑥ refuses a request with none, with 0, with `"1"`, with 1.5, or with 2147483648 |
| DSOR-IDM-01c | **C10.** A stale refusal is kept with its key | The same request with the same key hears `STALE_STATE` again, without running the code. The new decision is a new request, with a new key |
| (our decision) | **C11.** The store map names each trigger in full | Start-up refuses a trigger that the map does not name, a changed one, a switched-off one, and any trigger on DSoR's own tables |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR, made by Claude Code while the learner
was away. Each has a downside.

1. **A version column on `app.invoices` and `app.payments`:** a whole number, 1 for a new row.
   It is the store's own version, as DSOR-CNR-03b asks, not a counter that DSoR keeps beside the
   store. *Downside:* the accounts system has to keep one more column. And a row that is removed
   and added again starts at version 1 again, so a decision on the old row's version 1 passes:
   a sync job that empties and reloads its tables would bring that back (open question 87).
2. **The database raises the version, by a trigger.** A *trigger* is a function that the
   database runs by itself at each change of a row. `app.next_version()` sets the new row's
   version to the old row's version plus one, at every `UPDATE`, by any writer. So no writer can
   forget to raise it, or set a version of its own, and `dsor_runtime` holds no right on the
   column. *Downside:* an `UPDATE` that changes no field raises the version too, so a caller can
   be sent back for a change that changed nothing.
3. **The caller sends `expected_version` in the command's input,** not in the request envelope.
   It changes what the work does ("only while it is still version 1"), so it is part of the
   request, and part of its fingerprint. §38 names it an argument of the tool. *Downside:* a
   caller that reads again and sends a new version sends a new request. With the old key, it
   hears `IDEMPOTENCY_CONFLICT`, so it needs a new key.
4. **For `payment.create`, the version is the invoice's. For `payment.cancel`, the payment's.**
   The decision to pay is a decision about the invoice: its status, its amount, and its vendor.
   *Downside:* `payment.create`'s `expected_version` names a different record from the one it
   writes, and the field's name does not say which.
5. **`expected_version` is required.** Line ⑥ refuses an optimistic command without one, as the
   input schema says. DSoR cannot know what its caller read. *Downside:* every caller must read
   before it writes.
6. **The check is the write itself.** A cancel is one `UPDATE … WHERE version = $expected AND
   status = 'draft'`. A draft is one `INSERT … SELECT … WHERE EXISTS` an invoice at the expected
   version. A write that changes nothing is followed by one look in the same transaction, which
   says why: no such record, a newer version, or the business rule. A lock was the other way, and
   a real run refused it: `SELECT … FOR SHARE` needs a right to change the table, and
   `dsor_runtime` has none on `app.invoices` (`42501 permission denied`). *Downside:* a change
   that lands after DSoR's write and before its commit comes after the draft. The draft was made
   on the version that was current when it was written. This holds at `READ COMMITTED`, where
   each statement sees what committed before it, so DSoR begins every transaction at that level
   itself, whatever the database's default.
7. **`STALE_STATE` comes first, then the business rule.** Facts first: a caller whose facts are
   old is told to read again, before it is told what the rule says. The message names both
   versions. *Downside:* the message tells the caller the current version, which it could read
   anyway.
8. **In memory, the draft does not check the invoice's version again.** Memory has no other
   writer between the code's read and its write, so the code's own comparison is the check
   there. The database tests prove the race, on a real database. *Downside:* no unit test can
   show the race.
9. **Answers carry the version.** `Invoice` and `Payment` gain `version`, labelled `internal`, so
   the agent sees it. A read of one invoice states `resource_version` in its freshness label, as
   text, the form a version takes when it comes from another system, such as an ETag. A page of
   invoices states none. When masking hides `version` from a caller, the label leaves it out
   too. *Downside:* the version is in two places in one answer.
10. **Start-up checks each command's strategy.** `optimistic` and `none` are built.
    `pessimistic` and `connector_managed` are refused, as not built yet. An `optimistic` command's
    input schema must require `expected_version`, as a whole number from 1 to 2147483647, the
    largest number the database's integer column holds. *Downside:* a contract that a later step
    could serve stops start-up today.
11. **The store map names each trigger in full,** as PostgreSQL prints it, with its table, its
    moment, and its function. A trigger that is switched off reads as off. Only the business kinds
    may have one. Step 16 refused every trigger, because a trigger that returns nothing can
    swallow a write. *Downside:* the check runs at start-up only, so a trigger switched off later
    goes unseen until the next start. And the map does not read the function's body, which only
    the owner can change (open question 88).
12. **The database tests run on a local PostgreSQL 17,** as step 20's did. A test that changes an
    invoice uses an invoice of its own, INV-9001, which the owner adds before the test and
    removes after it. So the story's invoices stay at version 1, and the tests that compare
    them with memory still hold. *Downside:* the owner writes to the shared database during the
    tests, and a run that stops halfway leaves INV-9001 behind until the next run removes it.
13. **The program reads before it writes.** It reads INV-1008's version, and sends it. The stale
    draft is told in memory, because the program cannot change an invoice, and `dsor_runtime`
    must not. The stale cancel is told on the database. *Downside:* one more read on every
    command of the story.

What follows from these, with no decision of its own:

- Every test that runs `payment.create` or `payment.cancel` sends an `expected_version`.
- The examples for the cross-tenant suite carry one too.
- The memory stores of the tests keep versions, and a cancel raises the payment's.

### The tests, by claim

Unit tests in `test/concurrency.test.ts`: C1, C2, C4, C6, C8, C9, and C10, in memory.

Database tests in `test/concurrency.db.test.ts`: C2 and C4 on the database, C3 by fault
injection between the read and the write, C5 with real parallel requests, C7 against the
database's own trigger and rights, and C11 against the real catalog.

### Breaks we will try, and what we expect

The learner was away, so these carry no predictions. The learner can predict them later, as
stories, before reading "Break it".

| # | The break | Expected to be caught by |
| --- | --- | --- |
| B1 | The check in the code only: read, compare, then a write that names no version | C3: a change between the read and the write drafts a payment |
| B2 | The business rule before the version | C6: a stale cancel of a cancelled payment hears `CONFLICT` |
| B3 | No trigger | C7: the owner's change leaves version 1, and the agent's stale request drafts |
| B4 | The cancel's `UPDATE` without the version | C4: a stale cancel cancels |

### Left open, and not this step's idea

- The `pessimistic` and `connector_managed` strategies.
- A version on DSoR's own records.
- The version a call read or wrote, in its audit record.
- A trigger whose function body changed. Only the owner can change it.
- A row removed and added again, which starts at version 1 again (decision 1).
- A version at 2147483647, the column's largest: its next change fails, as an accident.

## Before you build: set up a database

As in step 20: a local PostgreSQL 17, a database of the step's own, `.env` written by a command
that prints nothing, and `pnpm migrate`. Migration 014 runs.

## What changed since step 20

| File | What changed |
| --- | --- |
| `migrations/014_versions.sql` | **New.** `version` on `app.invoices` and `app.payments`, the function `app.next_version()`, and a trigger on each table |
| `src/concurrency.ts` | **New.** The `STALE_STATE` refusal, and the start-up check of every command's strategy |
| `src/operations.ts` | `payment.create` compares the invoice's version before the business rule, and `payment.cancel` the payment's. Each sends its version to the store |
| `src/postgres.ts` | The draft is one `INSERT … SELECT … WHERE EXISTS` an invoice at the version, and the cancel's `UPDATE` names the version. After a write that changed nothing, one look says why. A read of one invoice states its `resource_version` |
| `src/payment.ts`, `src/company.ts` | A payment's version. Each write names the version its caller decided on |
| `src/invoice.ts` | An invoice's version, and a store in memory over a list of the test's own |
| `src/freshness.ts` | `resource_version` in a read's label, checked, and kept when the answer read one record |
| `src/store.ts`, `src/inspector.ts`, `src/catalog.ts`, `store.json` | The map names each trigger in full, and the inspector compares the database's triggers with it |
| `src/registry.ts` | Start-up runs the strategy check |
| `src/main.ts` | The program reads before it writes, cancels on a stale version, and tells the credit note in memory |
| `inputs/*.schema.json`, `examples/*.json`, `classifications.json` | `expected_version` for the three commands, and `version` labelled `internal` |
| `test/concurrency.test.ts`, `test/concurrency.db.test.ts`, `test/owner-invoices.ts` | **New.** The claims C1 to C11 |
| The other tests | `expected_version` on every command, and `version` in every answer typed out |

```bash
git diff --no-index ../mj_20_idempotency_keys/src src
git diff --no-index ../mj_20_idempotency_keys/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-07. The agent's first read names INV-1008's version twice: in the
data, and in the label.

```text
  data: {
    tenant_id: 'org_456',
    id: 'INV-1008',
    vendor_id: 'VENDOR-44',
    status: 'issued',
    version: 1
  },
  ...
  freshness: {
    mode: 'current',
    observed_at: '2026-10-07T01:00:08.278Z',
    connector: 'postgres',
    resource_version: '1'
  },
```

user_123's second cancel, decided on the draft's version, and a third, decided on the version
that the refusal named:

```text
  code: 'STALE_STATE',
  message: 'payment "PAY-956" is at version 2, and the request was decided on version 1',
  retry: 'after_state_refresh',
  ...
  code: 'CONFLICT',
  message: 'payment "PAY-956" is not a draft, so it cannot be cancelled',
```

The changed payee, in memory:

```text
the changed payee, in memory, because DSoR changes no invoice:
  02:05, the agent reads INV-1008: version 1, VENDOR-44
  02:06, the payee changes: INV-1008 is version 2, VENDOR-99
  02:07, the agent drafts on version 1: STALE_STATE: invoice "INV-1008" is at version 2, and the request was decided on version 1
  02:08, the agent reads again: version 2, VENDOR-99. Drafts: 0
```

The tests, on 2026-10-07: `pnpm test` ran 1434 unit tests in 52 files, and `pnpm test:db` ran
234 database tests in 20 files, against a local PostgreSQL 17. All passed.

## Break it

Each break was made in a copy of this step, on a local PostgreSQL, and run for real on
2026-10-07.

**B1. The check in the code only.** The draft's `INSERT` names no version, so only the code's
read compares it. The unit tests pass: memory has no other writer (decision 8). On the database,
one test fails, the race:

```text
× DSOR-CON-01b: the credit note lands after the code read INV-9001 and before the draft is written: STALE_STATE, and no draft
AssertionError: expected { data: { …(6) }, …(4) } to match object { code: 'STALE_STATE', …(1) }
```

A script, `race.ts`, told the same race as a story, in the copy:

```text
02:05, the owner adds INV-9001: { version: 1 }
02:06, the credit note lands: { version: 2 }
02:07, user_123's draft, decided on version 1: {
  ...
  amount: { value: '500.00', currency: 'USD' },
  status: 'draft',
  version: 1
}
INV-9001 now: { version: 2, open_amount_value: '250.00' }
```

A draft of 500.00 USD for an invoice with 250.00 USD open. The unbroken code, the same script:

```text
02:07, user_123's draft, decided on version 1: STALE_STATE: invoice "INV-9001" is at version 2, and the request was decided on version 1
```

**B2. The business rule before the version.** In `payment.cancel`, `CONFLICT` comes first:

```text
× DSOR-CON-01b: a second cancel decided on version 1 gets STALE_STATE, and the payment does not change
AssertionError: expected { code: 'CONFLICT', …(3) } to match object { code: 'STALE_STATE', …(2) }
```

On the database, two tests: the second cancel on version 1, and the two cancels at once.

**B3. No trigger.** Migration 014 without its two `CREATE TRIGGER` lines. Twelve database
tests fail, among them:

```text
× step 21's decision 2: the accounts system's credit note raises INV-9001's version by one, by the database's own trigger
AssertionError: expected { version: 1 } to strictly equal { version: 2 }
× DSOR-CON-01b: the agent decided before the credit note: STALE_STATE, and no draft for INV-9001
AssertionError: expected { data: { …(6) }, …(4) } to match object { code: 'STALE_STATE', …(2) }
```

And the program does not start:

```text
The database does not match store.json. Refused:
  store.json names the trigger CREATE TRIGGER invoices_version BEFORE UPDATE ON app.invoices FOR EACH ROW EXECUTE FUNCTION app.next_version(), which the database does not have
  store.json names the trigger CREATE TRIGGER payments_version BEFORE UPDATE ON app.payments FOR EACH ROW EXECUTE FUNCTION app.next_version(), which the database does not have
```

**B4. The cancel names no version.** The status alone decides, in both stores. Planning this
break found that no test could see it: a payment changes only when it is cancelled, so a payment
at version 2 was always cancelled already. Two tests were added before the break ran: the
accounts system amends a draft, which stays a draft at version 2. With the break:

```text
× DSOR-CON-01b: a cancel decided on version 1 of a draft that is version 2 now gets STALE_STATE, and the draft stays
AssertionError: expected { data: { …(7) }, …(3) } to match object { code: 'STALE_STATE', …(1) }
× DSOR-CON-01b: the accounts system amends a draft, which stays a draft at version 2: a cancel decided on version 1 gets STALE_STATE, and the draft stays
```

The stale cancel cancelled a draft whose amount had changed since the caller read it.

After each break, the copy was restored from this folder, and its tests were green again.

## Build it yourself with Claude Code

This is how the step was built. The learner was away for all of it, and asked Claude Code to
take every decision itself.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | No session yet. It is owed to the learner |
| 2 | Design | "In plain words", "Why it matters", and "The design, before any code": decisions 1 to 13. A real run settled decision 6 before it was written: `FOR SHARE` is refused to `dsor_runtime` |
| 3 | Database | Migration 014, tried first on a scratch database: PostgreSQL's own text for each trigger, a cancel by `dsor_runtime` that raises the version, and its own `UPDATE` of a version refused |
| 4 | The map | Step 20's markers removed. The map learned to name a trigger, and the inspector to compare triggers. Four database tests that type out the store changed with it |
| 5 | Red | Shells: the version in the types, and a store in memory over a list. Then the new tests |
| 6 | Green | The stale refusal, the versions in the two handlers and both stores, the label's version, and the start-up check. Start-up then refused `invoice.issue`, an optimistic command with no version in its input, so its input asks for one too |
| 7 | The old tests | `expected_version` on every command, and `version` in every answer typed out |
| 8 | The program | Reads before it writes, the stale cancel on the database, and the credit note in memory |
| 9 | Break it | Each break in a copy outside the repository, on a local PostgreSQL. Planning B4 showed that no test could see it, so two were added |
| 10 | Review | A reviewer who had not seen the conversation attacked the rules and the code, and made 29 small breaks in a copy. Claude Code fixed or recorded each finding. Then a sweep of 29 breaks ran on the fixed code. Both are under "Think it through" |

To start it in a new session:

```text
Build step 21 in learner mode from the design in
docs/baby_steps_tutorials/mj_21_optimistic_concurrency/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| The map | 4 map tests, which compare whole lines and now meet `triggers`, and 3 database tests: the grants typed out, and a trigger now printed in full |
| Red | 20 of the first 21 new unit tests, each for the reason it names. The one that passed says that start-up accepts `none`, so it proves something only beside the refusals. 16 old unit tests in 10 files failed too: an invoice now has `version`, which answers typed out did not have, and the labels had no line for it |
| Green | Start-up refused `invoice.issue` (move 6) |
| The old tests | 110 unit tests in 23 files and 11 database tests in 7 files, until each command sent a version and each typed-out answer had one |
| The program | Its database test: 31 calls now, 28 records readable, and the new stories |
| The review's fixes | One old database test, which reads each statement a store sends, was changed with the fix, for `BEGIN ISOLATION LEVEL READ COMMITTED`. The review's own tests were written with their fixes, not red first. The sweep shows that each one fails without its fix |

## Check yourself

Walk each call through the checklist, and stop at the first line that says no.

1. The agent reads INV-1008 at version 1. Somebody changes its vendor to VENDOR-99, and
   INV-1008 is version 2. The agent sends `payment.create` with `expected_version: 1`. What does
   it hear, from which line, and what does the record say?
2. user_123 cancels PAY-901 on version 1, and it is cancelled. She sends a second cancel, also on
   version 1. What does she hear? And on version 2?
3. The agent's stale request is refused. It sends the same request again, with the same key.
   What does it hear, and does the code run?
4. The agent reads again, sees version 2, and sends `expected_version: 2` with its old key. What
   does it hear? What must it send instead?
5. A database administrator drops the trigger `invoices_version`. What does DSoR do at its next
   start?

<details>
<summary>Answers</summary>

1. `STALE_STATE`, with `after_state_refresh`, from line ⑨: the code compares the invoice's
   version before anything else. Nothing is drafted. The record says `ALLOW`, because the code
   ran, with `STALE_STATE` as its result.
2. On version 1, `STALE_STATE`: the payment is version 2 now. On version 2, `CONFLICT`: her facts
   are current, and the business rule says that a cancelled payment is not a draft (decision 7).
3. `STALE_STATE` again, the refusal that the claim kept. The code does not run (DSOR-IDM-01c).
4. `IDEMPOTENCY_CONFLICT`: the version is part of the input, so the request's fingerprint has
   changed. It must send the new decision with a new key (decision 3).
5. It refuses to start. The map names the trigger, and the inspector says the database does not
   have it (decision 11).

</details>

## Think it through

A reviewer who had not seen the conversation attacked the step once it was green. It read the
rules against the code and the tests, sent inputs of its own, and made 29 small breaks in a copy
outside the repository, against a database of its own. 10 survived. Claude Code chose each fix,
because the learner was away.

**What the review found, and what changed.**

| # | Found | Fixed by |
| --- | --- | --- |
| R1 | A trigger switched off passed start-up: PostgreSQL prints it as if it were on. With it off, a stale draft was written | The catalog's read says "(disabled)" or "(replica only)", so the map's text no longer matches (decision 11) |
| R2 | The check is the write only at `READ COMMITTED`. With a database default of `REPEATABLE READ`, the stale draft was written, and the second cancel failed with a serialization error | DSoR begins every transaction at `READ COMMITTED` itself. Two tests run on connections whose default is `REPEATABLE READ` (decision 6). Step 20's claims depended on the same level, and its README left it open: from this step on, it is set |
| R3 | A version larger than the integer column gave `INTERNAL_ERROR` | `"maximum": 2147483647` in the three input schemas, and start-up asks for it (decision 10) |
| R4 | The label named the version to an agent whose clearance hid it | The label leaves the version out when masking withheld `version` (decision 9) |
| R5 | A row removed and added again starts at version 1, and a decision on the old row passes | Recorded: decision 1's downside, and open question 87 |
| R6 | A trigger that kept a version its writer set passed every test | A test: the owner sets version 1 with a change, and the version is the old one plus one |
| R7 | The start-up check had one negative test, which failed every condition at once | One test for each condition: optional, a number, 0, no minimum, no maximum, too large |
| R8 | Two branches of the draft's look had no test: an `INSERT` that keeps no row, and an invoice removed between the read and the write | Two fault-injection tests: `INTERNAL_ERROR`, and `RESOURCE_NOT_FOUND` |
| R9 | A label's version accepted any text, a label of many reads kept one version, and the stale refusal's label was never tested | Tests for each, with an agent whose clearance is public |
| R10 | C5 passes with no version in the cancel: the status alone picks the winner. Only the amended draft catches it | C5's text says so, and B4's expectation names C4 |
| R11 | The README: the story had the agent see amounts its clearance hides. "The accounts team raises" the number, against decision 2. "Trigger", ETag, content hash, fault injection, and two strategies were not defined. A schema cited the wrong decision, and the pipeline still called step 21 unbuilt | The story is a changed payee, which the agent sees, and which a run of step 20's code drafted. The number goes up whoever makes the change. Each term is defined where it first appears |

**What the sweep found.** After the fixes, a second sweep made 29 breaks on the fixed code: the
review's survivors that matter, breaks of each fix, and breaks of the step's own pieces, among
them the trigger that raises nothing, the cancel with no version, the start-up check, and the
masked label. A test failed for each of the 29: 20 in the unit tests, 8 in the step's database
file, and 1, the trigger switched off, only in the whole database suite.

**What the build taught.**

- **The lock that was not allowed.** The first plan was to lock the invoice with `FOR SHARE`. A
  real run refused it: a row lock needs a right to change the table, and `dsor_runtime` has
  none on `app.invoices`. The check moved into the write itself, which is optimistic
  concurrency's own form.
- **`invoice.issue` was a promise nobody kept.** Start-up's new check refused it at once: an
  optimistic command whose input had no place for a version. Its input asks for one now.
- **A test that two outcomes pass cannot tell them apart.** Planning B4 showed that a stale cancel
  was refused by the status alone, because a payment changes only when it is cancelled. Only a
  draft changed outside DSoR, still a draft, shows the version doing its work.
- **The level of isolation is part of the design.** The same code is right at one level and wrong
  at another, so the code now says which level it needs.
- **The story must match what the caller can see.** The agent's clearance hides amounts, so a
  credit note was a failure the agent could not have noticed. A changed payee is one it can.

**Left open on purpose:** the `pessimistic` and `connector_managed` strategies; versions on
DSoR's own records; the version in the audit record; a trigger's function body (open question
88); rows added again at version 1 (open question 87); and which record's version a command
names (open question 86).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-CON-01a | Every command declares its concurrency strategy | [§23 Concurrency](../../../specs/dsor/03-execution.md#23-concurrency) | The contract schema makes every command name one. Unit tests in [`test/concurrency.test.ts`](test/concurrency.test.ts): start-up refuses `pessimistic` and `connector_managed`, which are not built, and accepts `none` |
| DSOR-CON-01b | An optimistic command returns `STALE_STATE` when the resource's version differs from the version the decision was made on | [§23 Concurrency](../../../specs/dsor/03-execution.md#23-concurrency) | Unit tests: drafts and cancels on another version, the order of the refusals, and start-up's check of each optimistic input. Database tests in [`test/concurrency.db.test.ts`](test/concurrency.db.test.ts): a change outside DSoR, a change between the read and the write, two cancels at once, a draft changed outside DSoR, both at `REPEATABLE READ` too, and the trigger itself |
| DSOR-FRS-01a | Every query result states its `resource_version` where one exists | [§27 Freshness and consistency](../../../specs/dsor/03-execution.md#27-freshness-and-consistency) | Since this step, for a read of one invoice, unless masking hid the version. Unit tests in [`test/concurrency.test.ts`](test/concurrency.test.ts) and [`test/freshness-label.test.ts`](test/freshness-label.test.ts), and a database test |

## Next

Step 22 · Proposals and their states. Every attempt to run a command becomes a record with a
state that a person can look up, like an order-tracking page.
