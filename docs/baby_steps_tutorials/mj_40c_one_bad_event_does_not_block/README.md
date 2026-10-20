# Step 40b · No change without its event

**New in this step:** the database refuses to commit a payment change without its event, or a
payment event without its change. It checks every path that writes a payment, DSoR's own work
included (DSOR-EVT-01a, DSOR-EXE-04a).

## In plain words

Step 40 writes each event in the same transaction as its change, so the two commit together. But
DSoR's own code writes each event by hand, one line after the change. A path that forgets that one
line still commits. The payment changes, and no event is written.

In this step the database checks every transaction at its end, when it commits. A transaction that
drafted a payment must also hold a `payment.created` event about that payment. A transaction that
marked a payment paid must also hold a `payment.executed` event about it. If one is missing, the
commit fails, and nothing of the transaction is kept. The check also works the other way. An event
about a payment that was never drafted, or never paid, is refused. So is a second event of the same
kind about one payment. And a payment that is paid stays paid.

For every login's writes, it is a lock that stays locked when the power fails: a forgotten line
does not open it. The analogy stops at the owner of the tables, who holds the key: the owner can
switch a check off. "Left open on purpose" says what that means.

## Why it matters

A real run on 2026-10-20, on a scratch copy of step 40 and a scratch database. It uses INV-9001,
the tests' own invoice of 500.00 USD to VENDOR-44, so the story's INV-1008 stays as it is. One copy
is step 40 as it is. In the other, one line is removed: the line in `payment.reconcile` that writes
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
PAY-968 is a draft, so INV-9001 stays open. Someone in accounts who sees an open invoice can pay it
a second time by hand.

Step 40 has a test for this one line, because someone wrote it for reconcile. A new path has no
test until someone writes one. Step 41 will add a new path that pays 37 payments at once.

**Common mistake:** trusting the code that writes the change to also write the event. Since step
40's review, DSoR checks the company's code: a change with no event is not kept (that review's
finding H1). But DSoR's own work, such as `payment.reconcile`, writes its events by hand, and
nothing checks it. Only the database sees every path that writes a payment.

## The design, before any code

### How this step was made

On 2026-10-20, after the session that went through step 40 from the ground up, the learner chose
to build 40b and then 40c, both before step 41. Claude Code showed the run above, then asked. The
learner made the decisions D1 to D5. D6 was found while checking the design against step 40's
code, and D7 follows from step 40, so neither is a choice. After the review, the learner made D8
and D9.

### What the rules say

- **DSOR-EVT-01a:** "Where events are published, they MUST be produced through a transactional
  outbox or an equivalent that ties the event to the recorded outcome."
  ([§31](../../../specs/dsor/03-execution.md#31-events))
- **DSOR-EXE-04a:** "Where the connector's store and the control-plane store share a transaction,
  the state change, the final outcome, and the outbox entry MUST commit atomically."
  ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline))
- §31's plain words promise both directions: "That way you never have a change with no event, or an
  event with no change."

This step adds no rule id. It makes step 40's rules hold for every path that writes a payment, and
not only for the paths that remember. In this tutorial the company's payments, `app.payments`, and
DSoR's own store share one database, so they share a transaction. That is the case DSOR-EXE-04a
names.

### The claims

| Claim | What it says |
|---|---|
| C1 | A transaction that drafts a payment commits only if it also wrote a `payment.created` event about that payment. Otherwise the commit fails, and nothing of the transaction is kept. An event from an earlier transaction does not count |
| C2 | A transaction that marks a payment paid commits only if it also wrote a `payment.executed` event about that payment |
| C3 | A change that has no event type commits as before: a cancel, an amount the owner corrects with its new version, a payment removed |
| C4 | An event needs its change. A `payment.created` about a payment that does not exist is refused. A `payment.executed` about a payment that is not paid is refused. No payment gets a second `payment.created` or a second `payment.executed` |
| C5 | The checks bind every login's inserts and updates, the owner's too, on every path, DSoR's own work included. The database alone names the transaction that wrote an event |
| C6 | Since the review: a paid payment stays paid, and a payment keeps its number and its company (H1). No login may delete an event or empty the outbox (M1) |
| C7 | What it does not do: memory has no such check; `proposal.approved` is not checked; payments from before this step are not checked; it checks that an event exists, not what it says; and the owner of the tables can switch any check off |

### Decisions

- **D1. The check stands on the payment, `app.payments`** (the learner's). Each payment drafted and
  each payment marked paid needs its own event, in the same transaction. This catches every path
  that writes a payment, and every operation, so step 41's 37 payments will be checked too. The
  other way was a check on DSoR's proposal at its last move. A proposal for a draft does not hold
  the new payment's id, so that check could see only the event's type. And a new operation would be
  checked only after someone added it to the check's list. *Downside:* `app.payments` is the company's
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
- **D5. The check binds the owner's writes too** (the learner's). The owner's insert or update of a
  payment needs its event, as step 40's outbox guard binds the owner. *Downside:* test fixtures
  that plant a bare payment as the owner must plant its event too. A *fixture* is data a test
  writes before it runs. And the owner can still switch a check off: see D9.
- **D6. "This transaction" is a new column of `dsor.outbox`, `written_xact`, which the database
  fills** (found while checking the design). It holds the id of the transaction that wrote the event,
  from `pg_current_xact_id()`. PostgreSQL also keeps a hidden column, `xmin`, the id of the
  transaction that wrote each row. But the company's code runs inside a *savepoint*: a marker inside
  a transaction that the code's work can be rolled back to, while the rest is kept. A row written
  after a savepoint carries the savepoint's own id in `xmin`, not the transaction's. So `xmin` would
  not match. *Downside:* one more column.
- **D7. The first direction is checked at commit, the second at once** (follows from step 40). DSoR
  writes the payment first and the event after, because the event carries the payment as it was
  stored. So the check "this change has its event" must wait until the commit; PostgreSQL calls this
  a deferred constraint trigger. The check "this event has its change" runs when the event is
  written, because the change is already there. *Downside:* a failure of the first check comes at
  `COMMIT`, after the work, so the code that forgot learns it last.
- **D8. Paid is final** (the learner's, after the review's H1). No login may move a payment out of
  `paid`, or change its number or its company. Without this, a payment marked paid with its event
  could be set back to draft, and the accounts system would hear "paid" for money that never left.
  It could then never be paid, because it already had its one `payment.executed`. Money that left
  the bank does not come back by an UPDATE; a refund would be an operation of its own, with its own
  event, in a later step. *Downside:* step 17 had left the order of statuses open. This closes one
  door.
- **D9. Say what the owner can do, and add cheap guards** (the learner's, after the review's M1). A
  table's owner can always switch a trigger off, and no table guard prevents that. So this README
  says it, under "Left open on purpose". The guards that cost little: the database stamps every new
  event with its transaction, whatever the writer gave, and no login may delete an event or empty
  the outbox. *Downside:* the owner can still switch these guards off too.

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | As `dsor_runtime`, a transaction that inserts a draft and no event: `COMMIT` fails, and the draft is gone. The same with its event: it commits. An event from an earlier transaction does not count: the owner removes a draft and writes it again under its old id, and the commit fails, though its old `payment.created` is still there. Since the review: two drafts in one transaction with one event fail; a payment written as `paid` or `cancelled` with too few events fails |
| C2 | A transaction that marks a draft paid with no event fails at `COMMIT`. With its event, it commits. Since the review: two payments marked paid with one event fail |
| C3 | user_123 cancels a draft through DSoR, the owner changes a draft's amount, and the owner removes a draft: each commits, with no event. Step 40's whole suite stays green: every path DSoR has writes its events |
| C4 | A `payment.created` about PAY-000, which does not exist, is refused, the owner's too. A `payment.executed` about a draft is refused. A second event of each kind about one payment is refused by the once-each index. An event whose resource only starts with a payment's address is refused |
| C5 | The owner's draft with no event fails at `COMMIT`. `dsor_runtime` cannot set `written_xact`, and the owner cannot change it. Through DSoR: a reconcile whose event is never written does not commit, hears `INTERNAL_ERROR`, keeps its record, and leaves its invoice held. Start-up refuses a database that lacks a check |
| C6 | A paid payment cannot go back to draft or be cancelled, by `dsor_runtime` or the owner; no payment gets a new number. The owner's `written_xact` of 42 is stored as this transaction's id. The owner cannot delete an event or empty the outbox |

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

The review added breaks M1 to M12 and the breaks of its fixes, H1a, H1b, M1a, and M1b. They are in
"Break it" below, with what each removes.

## What changed since step 40

No file in `src/` changed. The whole check lives in the database.

| File | What changed |
| --- | --- |
| `migrations/038_payment_events.sql` | **New.** `written_xact` on `dsor.outbox`; step 40's guard keeps it too; the once-each index, a *unique index* that refuses a second row with the same company, resource, and event type; the check at `COMMIT` on `app.payments`; the check on `dsor.outbox` when an event is written (D1 to D7) |
| `migrations/039_paid_is_final.sql`, `migrations/040_outbox_kept.sql` | **New, from the review.** Paid is final, and a payment keeps its number and company (D8). Each new event is stamped with its transaction, and no event is removed (D9) |
| `store.json` | The map names the six new triggers, so start-up refuses a database without them |
| `test/payment-events.db.test.ts`, `test/owner-payment-events.ts`, `test/db.ts` | **New.** The claims C1 to C6, and the owner's program that the tests start through `ownerPaymentEvents` |
| `test/catalogs.ts`, `test/store-map.test.ts`, `test/inspector.test.ts`, `test/concurrency.db.test.ts`, `test/audit.db.test.ts`, `test/owner-outbox.ts` | The new triggers and the new column, by name; start-up refuses a database that lacks a check; the owner tries to change `written_xact` |
| `test/owner-store.ts`, `test/outbox.db.test.ts` | Three fixtures write what the check now asks: the owner's draft writes its `payment.created`, step 40's L2 test writes its two events about a proposal, and step 40's L4 control is refused by the once-each index. Each says "Changed in step 40b" |

```bash
git diff --no-index ../mj_40_events_with_an_outbox/migrations migrations
git diff --no-index ../mj_40_events_with_an_outbox/test test
```

## Run it

As in step 40: a local PostgreSQL 17 and a database of its own. Migrations 038 to 040 are new.
**Use a new database for this step.** Step 40's L2 test wrote two `payment.created` events about one
made-up payment. So in a database where step 40's tests ran, migration 038 cannot build its
once-each index. It stops with `migration failed, nothing changed: could not create unique index
"outbox_once_each"`.

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

Each break ran on 2026-10-20 in a copy of this folder outside the repository, after the review's
fixes. Each changed one migration, migrated a fresh database of its own, and ran
`test/store-map.test.ts` and `test/inspector.test.ts`, then `test/payment-events.db.test.ts`,
`test/outbox.db.test.ts`, `test/store.db.test.ts`, and `test/audit.db.test.ts`. With the migrations
restored, all of them passed.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The first check: its function returns at once | 0 | 11 |
| **B2** | "This transaction": `written_xact` is no longer compared, for either event | 0 | 1 |
| **B3** | The second check: its function returns at once | 0 | 4 |
| **B4** | Once each: the unique index dropped | 0 | 3 |
| **B5** | The owner let through: the first check returns at once for any login but `dsor_runtime` | 0 | 2 |
| **B6** | `dsor_runtime` granted INSERT and UPDATE on `written_xact` | 0 | 6 |
| **B7** | The first check runs at once, `NOT DEFERRABLE`, not at commit | 0 | 52 |
| **M1** | "This transaction" for `payment.executed` only | 0 | **0** |
| **M2** | A draft's event need not be about that payment | 0 | 1 |
| **M3** | A paid payment's event need not be about that payment | 0 | 1 |
| **M4** | A `payment.created` need not name its payment's exact address | 0 | 1 |
| **M5** | A `payment.executed` need not name its payment's exact address | 0 | 1 |
| **M6** | Step 40's guard no longer keeps `written_xact` | 0 | 1 |
| **M7** | Only a payment written as a draft needs its `payment.created` | 0 | 3 |
| **M8** | Only an UPDATE to paid needs a `payment.executed`, not a payment written as paid | 0 | 1 |
| **M10** | The second check returns at once for any login but `dsor_runtime` | 0 | 1 |
| **M11** | Any event about the payment counts as its `payment.executed` | 0 | 1 |
| **M12** | Any event about the payment counts as its `payment.created` | 0 | 1 |
| **H1a** | Paid is no longer final | 0 | 4 |
| **H1b** | A payment's number and company may change | 0 | 1 |
| **M1a** | The database no longer stamps each event's transaction | 0 | 1 |
| **M1b** | An event may be deleted, and the outbox emptied | 0 | 2 |

The review's M9 was caught by a test already, and its M13 makes the check stricter, so neither ran
again. Every break but M1 is caught. M1 is the clause that "Left open on purpose" explains: since paid is
final, no transaction can meet a `payment.executed` from an earlier transaction about a payment it
marks paid. The unit tests fail none, and that is right: they read `store.json`, which no break
changed; a trigger missing from the database is theirs to catch, and they do. B2 is caught by one
test only, the owner's draft written again under its old id. B7 fails 52 tests because every draft
and every payment DSoR writes is refused: the payment is written before its event, and the check
no longer waits. That is decision D7, seen.

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
| 8 | Review | A reviewer who had not seen the conversation: one high finding, five medium, four low, and eleven breaks that no test caught |
| 9 | Decide again | D8 and D9, by the learner |
| 10 | Fix | Each finding with its tests written first, in commits of their own; every break run again, the review's and the fixes' |

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
4. Why must a paid payment stay paid for "no event without its change" to hold?
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
4. The second check runs when an event is written, and then the payment is paid. If the payment
   could later go back to draft, its `payment.executed` would announce money that never left. And
   once-each would stop it from ever being paid again with an event (D8; the review's H1).
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
- **One database test fails in a full run: `bank.db`'s D7.** It expects a cancel that arrives 150 ms
  into a send to wait for the payment's lock and hear `STALE_STATE`, and it heard `RESOURCE_HELD`.
  The full database suite passed 655 of 656 tests after the review's fixes, and this was the one. It
  passed alone on a fresh database. Then, on one database with 39 old holds of INV-9001, step 40's
  code and this step's code each ran `bank.db` three times, in turn, and each failed D7 three times
  out of three. So it is not this step. It is the race that old holds make worse: open question 158
  in `research/open-questions.md`.

### What the review found

A reviewer who had not seen the conversation read the rules, the migration, the tests, and this
README, and attacked a copy on a database of its own. It found one high finding, five medium, and
four low, and eleven breaks that left every test green. Here H1 and M1 are this review's codes, not
step 40's.

| # | What it found | What was done |
|---|---|---|
| H1 | A payment marked paid with its event could be set back to draft, in the same transaction or a later one. The accounts system then heard "paid" for money that never left, and the payment could never be paid again | Paid is final, and a payment keeps its number and company, for every login (D8, migration 039) |
| M1 | The owner is not bound as C5 said: the owner can switch a check off, wrote `written_xact` 42, and could delete or truncate events and renumber a payment | C5 and D5 say what the owner can do. The database stamps each event's transaction, refuses a delete or a truncate, and keeps each payment's number (D9, migrations 039 and 040) |
| M2 | Eleven clauses of the check could be removed with every test green: two payments with one event, a payment written as paid, a resource that only starts with a payment's address, the owner's changes | A test for each, which fails when its clause is removed. One clause, break M1, cannot be reached by any test since D8 |
| M3 | This README said every other way to an event from an earlier transaction is refused first. The un-pay of H1 was one more way | Paid is final closes that way; the sentence is gone |
| M4 | C2's "earlier transaction" test is about a `payment.created`, which is C1's | The test and the claim are C1's |
| M5 | The DSOR-EXE-04a tests passed with no check at all | The refusals are titled DSOR-EXE-04a, the rule they prove |
| L1 | Two refusals matched any error, and the forgetful reconcile's test asserted only that there was a code | Each names its error; the reconcile's asserts `INTERNAL_ERROR`, its record, and the invoice held |
| L2 | A removal had no test | A test |
| L3 | Start-up compares each trigger, not the function behind it. An owner who replaces a function's body passes start-up | Left open on purpose, below |
| L4 | `docs/status.md` and the map did not name step 40b | The hand-over adds its row to `docs/status.md`. The map lists only the official steps, as it does for step 39b |

The README also lost a sentence about step 41 in the present tense, defined *savepoint*, *fixture*,
and *unique index*, and says which review a finding's code belongs to.

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
- **The owner of the tables can switch any check off.** The owner can `ALTER TABLE ... DISABLE
  TRIGGER`, change a payment, and switch the trigger back on before the commit. Start-up then sees
  the trigger on again. A superuser can also set `session_replication_role` to `replica`, which
  skips triggers. And start-up compares each trigger, not the function behind it, so an owner who
  replaces a check's function passes start-up (the review's L3). No table guard can stop the owner.
  Keeping the owner's key away from programs, as step 09 does, is the protection.
- **One clause cannot be reached by any test.** The first check's "this transaction" for
  `payment.executed` (break M1). A `payment.executed` from an earlier transaction would need a
  payment that was paid, then not paid, then paid again, and D8 refuses the middle move. The
  clause stays, so the check does not rely on D8 alone.

## The rules this step meets

This step adds no rule. It makes two of step 40's rules hold for every path, in the database.

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-EVT-01a | Events are produced through a transactional outbox that ties the event to the recorded outcome | [§31](../../../specs/dsor/03-execution.md#31-events) | `test/payment-events.db.test.ts`, C1 to C6; `test/inspector.test.ts`, C5 and C6 |
| DSOR-EXE-04a | Where the stores share a transaction, the state change, the outcome, and the outbox entry commit atomically | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | `test/payment-events.db.test.ts`: the refusals of C1 and C2, the forgetful reconcile of C5, and the review's M2 |

**Next:** step 40c, one bad event does not block the rest. Then step 41, a payment run.
