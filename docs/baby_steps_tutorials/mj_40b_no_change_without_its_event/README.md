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
