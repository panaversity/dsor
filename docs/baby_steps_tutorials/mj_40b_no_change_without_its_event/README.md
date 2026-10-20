# Step 40b · No change without its event

**New in this step:** the database itself refuses to commit a transaction that drafts or pays a
payment without writing that payment's event, or that writes a payment event with no matching
change. Every path is checked, DSoR's own work included (DSOR-EVT-01a, DSOR-EXE-04a).

## In plain words

Step 40 writes each event in the same transaction as its change, so the two commit together. But
DSoR's own code writes each event by hand, one line after the change. A path that forgets that one
line still commits. The payment changes, and no event is written.

In this step the database checks every transaction at its end, when it commits. A transaction that
drafted a payment must also hold a `payment.created` event about that payment. A transaction that
marked a payment paid must also hold a `payment.executed` event about it. If one is missing, the
commit fails, and nothing of the transaction is kept. The check also works the other way. An event
about a payment that was never drafted, or never paid, is refused. So is a second event of the same
kind about one payment.

It is a lock that stays locked when the power fails: a forgotten line does not open it.

## Why it matters

A real run on 2026-10-20, on a scratch copy of step 40 and a scratch database. One copy is step 40
as it is. In the other, one line is removed: the line in `payment.reconcile` that writes
`payment.executed`. That is how a new path looks when it forgets its event. The same story runs on
both:

```text
=== step 40's reconcile
user_123 drafts PAY-967 for INV-9001: COMMITTED
user_123 sends PAY-967, and the bank never answers: OUTCOME_UNKNOWN
dsor-scheduler reconciles it; the bank did send it: COMMITTED, COMMITTED
in the database: PAY-967 is paid; its events: ["payment.created #1","payment.executed #2"]
the accounts system hears of PAY-967: ["payment.created","payment.executed"]

=== a reconcile that forgot its event (one line removed)
user_123 drafts PAY-968 for INV-9001: COMMITTED
user_123 sends PAY-968, and the bank never answers: OUTCOME_UNKNOWN
dsor-scheduler reconciles it; the bank did send it: COMMITTED, COMMITTED
in the database: PAY-968 is paid; its events: ["payment.created #1"]
the accounts system hears of PAY-968: ["payment.created"]
```

The money for PAY-968 left the bank, and DSoR says `COMMITTED`. The accounts system still thinks
PAY-968 is a draft, so INV-9001 stays open. A clerk who sees an open invoice can pay it a second
time by hand.

Step 40 has a test for this one line, because someone wrote it for reconcile. A new path has no
test until someone writes one. Step 41 adds a new path that pays 37 payments at once.

**Common mistake:** trusting the code that writes the change to also write the event. The company's
code is checked since step 40's review (H1): a change with no event is not kept. But DSoR's own
work, `payment.reconcile` and `proposal.approve`, writes its events by hand, and nothing checks it.
Only the database sees every path.

## The design, before any code

### How this step was made

On 2026-10-20, after the session that went through step 40 from the ground up, the learner chose
to build 40b before step 41, and 40c after it. Claude Code showed the run above, then asked. The
learner made the five decisions below. One more fact, D6, was found while checking the design
against step 40's code. It is not a choice.

### What the rules say

- **DSOR-EVT-01a:** "Where events are published, they MUST be produced through a transactional
  outbox or an equivalent that ties the event to the recorded outcome."
  ([§31](../../../specs/dsor/03-execution.md#31-events))
- **DSOR-EXE-04a:** "Where the connector's store and the control-plane store share a transaction,
  the state change, the final outcome, and the outbox entry MUST commit atomically."
  ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline))
- §31's plain words promise both directions: "That way you never have a change with no event, or an
  event with no change."

This step adds no rule id. It makes step 40's rules hold for every path, and not only for the paths
that remember. In this tutorial the company's payments, `app.payments`, and DSoR's own store share
one database, so they share a transaction. That is the case DSOR-EXE-04a names.

### The claims

| Claim | What it says |
|---|---|
| C1 | A transaction that drafts a payment commits only if it also wrote a `payment.created` event about that payment. Otherwise the commit fails, and nothing of the transaction is kept |
| C2 | A transaction that marks a payment paid commits only if it also wrote a `payment.executed` event about that payment. An event from an earlier transaction does not count |
| C3 | A change that has no event type commits as before: a cancel, a new version, an amount the owner corrects, a payment removed |
| C4 | An event needs its change. A `payment.created` about a payment that does not exist is refused. A `payment.executed` about a payment that is not paid is refused. No payment gets a second `payment.created` or a second `payment.executed` |
| C5 | The check binds every login, the owner too, and every path, DSoR's own work included. No login can say which transaction wrote an event: the database writes it |
| C6 | What it does not do: memory has no such check; `proposal.approved` is not checked; payments from before this step are not checked; and it checks that the event exists, not what the event says |

### Decisions

- **D1. The check stands on the payment, `app.payments`** (the learner's). Each payment drafted and
  each payment marked paid needs its own event, in the same transaction. This catches every path
  and every operation, step 41's 37 payments too. The other ways were a check on DSoR's proposal,
  which ends `COMMITTED` or `APPROVED`, or both. A proposal for a draft does not hold the new
  payment's id, so that check could see only the event's type, and a new operation would be checked
  only after someone added it to the check's list. *Downside:* `app.payments` is the company's
  table. Here it shares DSoR's database. In a real company the payments sit behind a connector,
  where DSoR cannot add a check. Then DSOR-EXE-04a does not apply either.
- **D2. Both directions** (the learner's). No change without its event, and no event without its
  change. *Downside:* two checks to build, test, and break, not one.
- **D3. The database only** (the learner's). Memory has no transaction, as step 40's D11 says, so
  it gets no such check. *Downside:* the unit tests catch a forgotten event only where someone wrote
  a test for it.
- **D4. An event needs its change: once each, in the right state** (the learner's). A payment gets
  at most one `payment.created` and at most one `payment.executed`, ever. A `payment.created` needs
  its payment to exist, and a `payment.executed` needs its payment to be paid. The other way was two
  new columns on `app.payments` that name the transaction that drafted and the one that paid each
  payment. *Downside:* "in this transaction" comes only from the first direction. A payment from
  before this step that has no event could still get one later.
- **D5. The check binds the owner too** (the learner's). No login may change a payment without its
  event, as step 40's outbox guard binds the owner. *Downside:* test files that plant a bare payment
  as the owner must plant its event too.
- **D6. "This transaction" is a new column of `dsor.outbox`, `written_xact`, which the database
  fills** (found while checking the design). It holds the id of the transaction that wrote the event,
  from `pg_current_xact_id()`, and no login is granted the right to set it. PostgreSQL also keeps a
  hidden column, `xmin`, the id of the transaction that wrote each row. But the company's code runs
  inside a savepoint, and a row written there carries the savepoint's own id, not the transaction's.
  So `xmin` would not match. *Downside:* one more column.
- **D7. The first direction is checked at commit, the second at once** (follows from step 40). DSoR
  writes the payment first and the event after, because the event carries the payment as it was
  stored. So the check "this change has its event" must wait until the commit; PostgreSQL calls this
  a deferred constraint trigger. The check "this event has its change" runs when the event is
  written, because the change is already there. *Downside:* a failure of the first check comes at
  `COMMIT`, after the work, so the code that forgot learns it last.

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | As `dsor_runtime`, a transaction that inserts a draft and no event: `COMMIT` fails, and the draft is gone. The same with its event: it commits |
| C2 | A transaction that marks a draft paid with no event fails at `COMMIT`. With its event, it commits. An event from an earlier transaction does not count: the owner removes a draft and writes it again under its old id, and the commit fails, though its old `payment.created` is still there |
| C3 | user_123 cancels a draft through DSoR, and the owner changes a draft's amount: both commit, with no event. Step 40's whole suite stays green: every path DSoR has writes its events |
| C4 | A `payment.created` about PAY-000, which does not exist, is refused. A `payment.executed` about a draft is refused. A second `payment.executed` about a paid payment is refused |
| C5 | The owner's draft with no event fails at `COMMIT`. `dsor_runtime` cannot set `written_xact`. Through DSoR: a reconcile whose event is never written does not commit |

### The learner's predictions

Asked before the build, as stories. A real run settles each one after the build.

| | The story | The learner's answer |
|---|---|---|
| P1 | The check is in place. dsor-scheduler reconciles PAY-968 with the reconcile that forgot its event line. What does it hear, and what does the database hold after? | `COMMITTED`; PAY-968 paid; no event: "the check does not see DSoR's own work" |
| P2 | user_123 cancels the draft PAY-969. There is no event type for a cancel. What happens? | `COMMITTED`, no event: a cancel needs no event |

### The breaks

Each break removes one piece, in a copy of this folder. A break that fails no test means a missing
test.

| Break | What it removes |
|---|---|
| B1 | The first check: a draft or a payment marked paid with no event commits |
| B2 | "This transaction": an event from any transaction counts |
| B3 | The second check: an event about a payment that is not paid is written |
| B4 | Once each: a second `payment.executed` about one payment is written |
| B5 | The owner is let through |
| B6 | `dsor_runtime` may set `written_xact` |
| B7 | The first check runs at once, not at commit |

## What changed since step 40

No file in `src/` changed. The whole check lives in the database.

| File | What changed |
| --- | --- |
| `migrations/038_payment_events.sql` | **New.** `written_xact` on `dsor.outbox`; step 40's guard keeps it too; the once-each index; the check at `COMMIT` on `app.payments`; the check on `dsor.outbox` when an event is written (D1 to D7) |
| `store.json` | The map names the two new triggers, so start-up refuses a database without them |
| `test/payment-events.db.test.ts`, `test/owner-payment-events.ts` | **New.** The claims C1 to C5 |
| `test/catalogs.ts`, `test/store-map.test.ts`, `test/inspector.test.ts`, `test/concurrency.db.test.ts`, `test/audit.db.test.ts` | The two triggers and the new column, by name; start-up refuses a database that lacks either trigger |
| `test/owner-store.ts`, `test/outbox.db.test.ts` | Three fixtures write what the check now asks: the owner's draft writes its `payment.created`, L2's two events are about a proposal, and L4's copy is refused by the once-each index. Each says "Changed in step 40b" |

```bash
git diff --no-index ../mj_40_events_with_an_outbox/migrations migrations
git diff --no-index ../mj_40_events_with_an_outbox/test test
```

## Run it

As in step 40: a local PostgreSQL 17 and a database of its own. **Use a new database for this
step.** A database where step 40's tests ran holds two `payment.created` events about one made-up
payment, written by step 40's L2 test. There, migration 038 cannot build its once-each index, and it
stops with `migration failed, nothing changed: could not create unique index "outbox_once_each"`.

```bash
pnpm install
pnpm migrate
pnpm test:db test/payment-events.db.test.ts
pnpm start          # the story of step 40, unchanged: every path DSoR has writes its events
```

## Break it

### The learner's predictions, run for real

**P1.** The check is in place, and the reconcile that forgot its event line runs. A real run on
2026-10-20, in a copy of this step with that one line removed, on a database of its own:

```text
user_123 drafts PAY-901 for INV-9001: COMMITTED
user_123 sends PAY-901, and the bank never answers: OUTCOME_UNKNOWN
dsor-scheduler reconciles it; the bank did send it: INTERNAL_ERROR (DSoR hit an unexpected error)
in the database: PAY-901 is draft; its events: ["payment.created #1"]
$ pnpm send-events
org_456: sent 1 event
org_789: sent 0 events
the accounts system hears of PAY-901: ["payment.created"]
```

The learner answered `COMMITTED`, paid, no event: "the check does not see DSoR's own work". That is
what step 40 does, in "Why it matters" above. Here the check stands on `app.payments`, and every
path writes there, DSoR's own work included. So the commit failed, and nothing of the reconcile was
kept. The proposal is still `OUTCOME_UNKNOWN`. The log still holds the call, as record 17:
`payment.reconcile@1`, `INTERNAL_ERROR`. And INV-9001 stays held: a new draft of INV-9001 in the
same database heard `RESOURCE_HELD`, "try again once it is reconciled". The forgotten line now
stops payments loudly, where before it lost an event quietly. Once the line is back, the shipped
reconcile settles the payment, and the test of C5 shows it.

**P2.** user_123 cancels the draft PAY-901 through DSoR, on a fresh database:

```text
user_123 drafts PAY-901: COMMITTED
user_123 cancels PAY-901: COMMITTED
in the database: PAY-901 is cancelled; its events: ["payment.created"]
```

The learner answered `COMMITTED`, no event. Right: the check asks for an event only for a draft and
for a payment marked paid, the two changes that have an event type.

### The breaks

Each break ran on 2026-10-20 in a copy of this folder outside the repository. Each changed migration
038, migrated a fresh database of its own, and ran `test/store-map.test.ts` and
`test/inspector.test.ts`, then `test/payment-events.db.test.ts`, `test/outbox.db.test.ts`,
`test/store.db.test.ts`, and `test/audit.db.test.ts`. With the migration restored, all of them
passed.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The first check: its function returns at once | 0 | 5 |
| **B2** | "This transaction": `written_xact` is no longer compared | 0 | 1 |
| **B3** | The second check: its function returns at once | 0 | 2 |
| **B4** | Once each: the unique index dropped | 0 | 3 |
| **B5** | The owner let through: the first check returns at once for any login but `dsor_runtime` | 0 | 2 |
| **B6** | `dsor_runtime` granted INSERT and UPDATE on `written_xact` | 0 | 6 |
| **B7** | The first check runs at once, `NOT DEFERRABLE`, not at commit | 0 | 39 |

Every break is caught. The unit tests fail none, and that is right: they read `store.json`, which
no break changed. B2 is caught by one test only, the owner's draft written again under its old id:
every other way to have an event from an earlier transaction is refused by the second check or by
once-each first. B7 fails 39 tests because every draft DSoR writes is refused: the payment is
written before its event, and the check no longer waits. That is decision D7, seen.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | Step 40 from the ground up, in a session of its own; then the problem of this step, shown with a real run of step 40 with one line removed |
| 2 | Decide | Five decisions by the learner, D1 to D5; D6 found while checking the design; D7 follows from step 40 |
| 3 | The copy | Step 40 copied, its markers removed |
| 4 | Red | Fourteen database tests: ten fail for the right reason, and four are the "yes" beside each "no" |
| 5 | Code | One migration |
| 6 | Earlier tests | The map, the catalog, the privileges, the triggers, and three fixtures |
| 7 | Break it | P1 and P2, then B1 to B7, for real |
| 8 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 40b in learner mode from the design in
docs/baby_steps_tutorials/mj_40b_no_change_without_its_event/README.md.
```

## Check yourself

1. Step 40 writes each event in the same transaction as its change. So what can still go wrong, and
   why does a test not catch it every time?
2. Why does the check "this change has its event" wait until `COMMIT`, while "this event has its
   change" runs at once?
3. Why does the check name the transaction with a column of its own, `written_xact`, and not with
   PostgreSQL's hidden column `xmin`?
4. user_123 cancels a draft. Why does the check let it through with no event?
5. The reconcile that forgot its event is refused. Who notices, and what stays stuck until it is
   fixed?

<details>
<summary>Answers</summary>

1. A path can forget the one line that writes its event. The change still commits, with no event:
   PAY-968 in "Why it matters". A test catches it only where someone wrote that test, and a new
   path, like step 41's, has none until someone does.
2. DSoR writes the payment first and the event after, because the event carries the payment as it
   was stored. When the payment is written, its event does not exist yet, so that check waits for
   the end. When an event is written, its change is already there (D7).
3. The company's code runs inside a savepoint, and a row written there carries the savepoint's own
   id in `xmin`, not the transaction's. `pg_current_xact_id()` names the whole transaction, even
   inside a savepoint (D6).
4. A cancel has no event type, and the check asks only for the two that have one: a draft needs
   `payment.created`, and a payment marked paid needs `payment.executed` (C3).
5. dsor-scheduler hears `INTERNAL_ERROR`, and the log keeps that answer. The proposal stays
   `OUTCOME_UNKNOWN`, so INV-9001 stays held, and every new draft of it hears `RESOURCE_HELD` until a
   reconcile that writes its event runs (P1).

</details>

## Think it through

### Found while building

- **`xmin` would not work.** Checking the design against step 40's code found that the company's
  code runs inside a savepoint, `SAVEPOINT work`. A row written there carries the savepoint's id in
  `xmin`. So the check names the transaction with a column of its own, filled with
  `pg_current_xact_id()` (D6).
- **Three fixtures planted what the check now refuses.** The owner's draft in `owner-store.ts` had
  no event. Step 40's L2 test wrote two `payment.created` events about a payment that was never
  drafted. And L4's control wrote a copy of an event. Each now writes what the check asks, and says
  so. This is D5's downside, seen.
- **A database where step 40's tests ran cannot take migration 038.** Its outbox already holds two
  `payment.created` events about one payment, from step 40's L2 test, so the once-each index cannot
  be built. The migration stops and changes nothing. "Run it" says to start on a new database.
- **The refused reconcile holds its invoice.** Settled while running P2: the database where P1 ran
  refused a new draft of INV-9001 with `RESOURCE_HELD`, because P1's proposal is still
  `OUTCOME_UNKNOWN`.
- **One database test failed once in a full run: `bank.db`'s D7.** It expects a cancel that arrives
  150 ms into a send to wait for the payment's lock and hear `STALE_STATE`, and it heard
  `RESOURCE_HELD`. It passed alone on a fresh database. Step 40's own code, on a database where its
  full suite had run, failed it once and passed it on the next run. So it is not this step: it is the
  race that old holds make worse, open question 158.

### What the review found

The review is running. Its findings, and what was done about each, come here.

### Left open on purpose

- **Memory has no such check** (D3). The unit tests catch a forgotten event only where someone wrote
  a test for it.
- **`proposal.approved` is not checked.** The check stands on the payment (D1), and an approval is
  not a payment.
- **Payments from before this step are not checked** (D4). A payment drafted with no event before
  migration 038 could still get a `payment.created` later.
- **The check sees that an event exists, not what it says.** What an event says is DSoR's code's job,
  checked since step 40's review (H1).
- **In a real company, payments sit behind a connector.** There DSoR cannot add a check to the
  company's table, and DSOR-EXE-04a does not apply either (D1). This step's check depends on this
  tutorial's layout, where the two stores share one database.
- **A forgotten event after the bank leaves money sent and a proposal unknown.** That is loud by
  design: the reconcile fails until the code is fixed, as P1 shows. The money is not lost; the
  announcement waits.

## The rules this step meets

This step adds no rule. It makes two of step 40's rules hold for every path, in the database.

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-EVT-01a | Events are produced through a transactional outbox that ties the event to the recorded outcome | [§31](../../../specs/dsor/03-execution.md#31-events) | `test/payment-events.db.test.ts`, C1 to C5; `test/inspector.test.ts`, C5 |
| DSOR-EXE-04a | Where the stores share a transaction, the state change, the outcome, and the outbox entry commit atomically | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | `test/payment-events.db.test.ts`, C1 and C2 |

**Next:** step 40c, one bad event does not block the rest. Then step 41, a payment run.
