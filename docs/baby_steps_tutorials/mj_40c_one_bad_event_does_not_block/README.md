# Step 40c · One bad event does not block the rest

**New in this step:** when the accounts system refuses an event, the sender holds back only that
payment's events and delivers every other payment's. It tries the refused event again on every
run. The database keeps each failed try, and raises an alert on an event's third (DSOR-EVT-01a,
DSOR-EVT-01b).

## In plain words

Step 40's sender stops at the first event it cannot deliver. That keeps a payment's events in
order: PAY-901's `payment.executed` never arrives before its `payment.created`. But it also stops
every other payment's events, which do not need to wait.

In this step the sender stops only the failed event's payment. It goes on with every other
payment, and each payment's events still arrive in their own order. The failed event stays first in
line for its payment, and the next run tries it again. It is never moved aside, so it is never lost.

Each failed try is written down in the database, with its time and the receiver's reason. When one
event has failed three times, the database raises an alert, so a person hears. When the event is
finally delivered, the database closes the alert, in the same transaction.

## Why it matters

A real run on 2026-10-20, on a scratch copy of step 40b and a scratch database. user_123 drafts
three payments and sends one. The accounts system does not know VENDOR-31 yet, so it refuses every
event about a payment to VENDOR-31. The script is a sketch, not DSoR code; the sender is step 40b's:

```text
user_123 drafts INV-1006, 640.00 USD to VENDOR-31: COMMITTED, PAY-901
user_123 drafts INV-1002, 8,900.50 USD to VENDOR-44: COMMITTED, PAY-902
user_123 drafts INV-1009, 7,425.00 USD to VENDOR-44: COMMITTED, PAY-903
user_123 sends PAY-903: COMMITTED
run 1 of pnpm send-events: sent 0; stopped: the accounts system answers 422: no vendor VENDOR-31
   still unsent: ["payment.created PAY-901 #1","payment.created PAY-902 #1","payment.created PAY-903 #1","payment.executed PAY-903 #2"]
run 2 of pnpm send-events: sent 0; stopped: the accounts system answers 422: no vendor VENDOR-31
   still unsent: ["payment.created PAY-901 #1","payment.created PAY-902 #1","payment.created PAY-903 #1","payment.executed PAY-903 #2"]
run 3 of pnpm send-events: sent 0; stopped: the accounts system answers 422: no vendor VENDOR-31
   still unsent: ["payment.created PAY-901 #1","payment.created PAY-902 #1","payment.created PAY-903 #1","payment.executed PAY-903 #2"]
the accounts system has heard: []
alerts raised in dsor.alerts: 0
```

PAY-903 left the bank, and the accounts system never hears it, nor PAY-902, though both are to
VENDOR-44, which it knows. They wait behind PAY-901's event, run after run. And nobody is told: the
sender prints a line and ends with 1, and no alert is raised. Step 41 will make 37 payments at once,
and one stuck event would hide all 37.

**Common mistake:** "fixing" this by skipping the failed event and going on. Then PAY-901's
`payment.executed` can arrive before its `payment.created`, and the accounts system reads a payment
paid that it never saw drafted. The order to keep is each payment's own, and only that.

## The design, before any code

### How this step was made

On 2026-10-20, right after step 40b, the learner went on to 40c, still before step 41. Claude Code
showed the run above, then asked, one question at a time. The learner made the decisions D1 to D6.
D7 was found while checking the design against step 40b's code. D8 follows from step 40.

### What the rules say

- **DSOR-EVT-01b:** "Every event MUST validate against `event.schema.json`, carrying a unique
  `event_id`, the resource URI, a per-resource ordering key, correlation identifiers, and `origin`."
  ([§31](../../../specs/dsor/03-execution.md#31-events)) The ordering key is per resource: it orders
  one payment's events, not a company's.
- **DSOR-EVT-01a:** events are produced through a transactional outbox. §31 adds: "Delivery is
  at-least-once; consumers deduplicate on `event_id`."
- The specification says nothing about an event that keeps failing. Every rule below about one is
  this tutorial's decision, not a rule of DSoR.

### The claims

| Claim | What it says |
|---|---|
| C1 | A delivery that fails holds back only its payment's events for the rest of the run. Every other payment's events are delivered, oldest first, and marked sent |
| C2 | Inside one payment, the order holds: no event passes an earlier, unsent event of its payment. An event held back behind a failure is not tried, and no try is written for it |
| C3 | Every failed try is written in `dsor.outbox_tries`, with its time and the receiver's reason, in the run's transaction. A try is never changed or removed |
| C4 | An event's third failed try raises one alert in `dsor.event_alerts`, raised by the database. The event gets no second alert |
| C5 | The run that delivers the event closes its alert, in the same transaction that marks the event sent. An alert is never removed |
| C6 | `dsor_runtime` may add a try, and nothing else: it cannot raise, close, or change an alert, or change a try |
| C7 | `pnpm send-events` says which payments it held back, and ends with 1 when any delivery failed |
| C8 | What it does not do: step 38c's `alert.list` does not show these alerts, and nothing escalates them; memory keeps no tries and raises no alerts; a stuck payment stays stuck until someone fixes the cause |

### Decisions

- **D1. Only the failed payment's events stop** (the learner's). The sender skips the rest of that
  payment's events in this run, and goes on with every other payment. The other ways were to stop
  the whole company, as step 40 does, or to skip only the failed event, which breaks each payment's
  order. *Downside:* the sender must remember, within a run, which payments are held back.
- **D2. Keep trying, and alert** (the learner's). The failed event stays first in line for its
  payment and is tried on every run. It is never moved aside. The other way was to *park* it: move
  it aside after some tries, until a person releases it. *Downside:* the payment's later events wait
  until someone fixes the cause, for example adds VENDOR-31 to the accounts system.
- **D3. An alert after 3 failed tries** (the learner's). One bad try, like a short network failure,
  raises nothing. The other ways were an alert at the first failure, or after an hour.
  *Downside:* three runs pass before anyone hears.
- **D4. The alerts are a table of their own, `dsor.event_alerts`** (the learner's). The database
  raises one when an event's third try fails, and closes it when the event is sent, as step 38b's
  alerts open and close with their proposal. The other way was to widen step 38b's alerts to two
  kinds. *Downside:* step 38c's `alert.list` does not show these yet, so a person looks in a second
  place, and nothing escalates them.
- **D5. A log of failed tries, `dsor.outbox_tries`** (the learner's). One row for each failed try:
  the event, the database's time, and the receiver's reason, at most 200 characters. Never changed.
  The other way was a count on the event, which would make step 40's outbox guard let two more
  columns change. *Downside:* the log grows with every failed try.
- **D6. Memory stops per payment too; the tries and the alerts are the database's** (the
  learner's). Both senders follow D1, so the unit tests show it. *Downside:* the unit tests see no
  try and no alert.
- **D7. A new kind of table in the map, `append-only-watched`** (found while checking the design).
  The alert is raised by a trigger on the log of tries. But the map allows a trigger only on some
  kinds of table, and an append-only table may have none. So the log is a new kind: append-only,
  with triggers that the map names in full. *Downside:* one more kind for a reader to learn.
- **D8. A try is written in the run's transaction** (follows from step 40's D8). The run reads,
  delivers, marks, and writes its tries in one transaction for the company. A sender killed in the
  middle writes no try, as it marks no event: the next run tries again. *Downside:* a try refused just
  before a crash is not counted.

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | In memory and on the database: PAY-901's events are refused; PAY-902's and PAY-903's are delivered and marked in the same run |
| C2 | PAY-901 has `payment.created` and `payment.executed`; the first is refused: the second is not delivered, not tried, and has no try. The next run that delivers the first delivers the second after it |
| C3 | Each failed run writes one try for PAY-901's first event, with the reason; the owner cannot change or remove a try |
| C4 | After the third failed run, one alert for that event; after the fourth, still one |
| C5 | The run that delivers it closes the alert, and the alert's `closed_at` is that run's time; the owner cannot remove an alert |
| C6 | `dsor_runtime` cannot insert, update, or delete an alert, or update or delete a try |
| C7 | `pnpm send-events` with a refused event names the payment it held back, delivers the others, and ends with 1 |

### The learner's predictions

Asked before the build, as stories. A real run settles each one after the build.

| | The story | The learner's answer |
|---|---|---|
| P1 | The accounts system refuses everything about VENDOR-31, as above. After run 1, what has it heard? | Nothing yet |
| P2 | PAY-901 is paid too, so it has `payment.created` #1 and `payment.executed` #2, and #1 is refused. In run 1, what happens to #2? | Delivered anyway |
| P3 | Runs 1, 2, and 3 all fail for PAY-901. What does `dsor.event_alerts` hold after run 3? | One alert |
| P4 | VENDOR-31 is added, and run 4 delivers PAY-901's events. What happens to the alert? | Closed by the database |

### The breaks

| Break | What it removes |
|---|---|
| B1 | The database's sender stops the whole company at a failure, as in step 40 |
| B2 | The database's sender skips only the failed event, and goes on with its payment's later events |
| B3 | The memory sender stops the whole company |
| B4 | No try is written for a failure |
| B5 | The alert is raised on the second try, not the third |
| B6 | The alert is raised on every try from the third, with no one-alert-per-event key |
| B7 | The alert is not closed when its event is sent |
| B8 | `dsor_runtime` may insert an alert |
| B9 | A try may be changed: its guard is gone |

## What changed since step 40b

| File | What changed |
| --- | --- |
| `src/outbox.ts`, `src/sender.ts` | Both senders hold back only a failed event's payment for the rest of the run, and go on with every other payment. A run's failures are a list, each with its payment's address. The database's sender writes each failed try in its run's transaction (D1, D6, D8) |
| `src/sender.ts` | `pnpm send-events` names each payment it held back, the event it waits on, and the receiver's reason (C7) |
| `migrations/041_event_tries.sql` | **New.** `dsor.outbox_tries` and `dsor.event_alerts`, their guards, the trigger that raises an alert on an event's third failed try, and the one that closes it when the event is sent (D2 to D5) |
| `src/store.ts`, `store.json` | The kind `append-only-watched` (D7); the two tables and their triggers on the map, so start-up refuses a database without them |
| `src/main.ts` | The story's sender that "dies" after a delivery: a thrown error no longer stops the run, so the scene loses each answer instead, and says so |
| `test/event-tries.db.test.ts`, `test/owner-event-tries.ts`, `test/db.ts` | **New.** The claims C1 to C6 on the database, and the owner's program that the tests start through `ownerEventTries` |
| `test/sender.test.ts` | C1, C2, and C7 in memory; step 40's test of a killed sender models the kill directly |
| `test/outbox.db.test.ts`, `test/payment-events.db.test.ts` | Step 40's three tests of a failure now expect only its payment held back; step 40b's test of an emptied outbox accepts PostgreSQL's own refusal. Each says "Changed in step 40c" |
| `test/catalogs.ts`, `test/store-map.test.ts`, `test/inspector.test.ts`, `test/concurrency.db.test.ts`, `test/audit.db.test.ts`, `test/rls.db.test.ts`, `test/store.db.test.ts` | The two tables, their triggers, policies, privileges, and counter, by name |

```bash
git diff --no-index ../mj_40b_no_change_without_its_event/src src
git diff --no-index ../mj_40b_no_change_without_its_event/test test
git diff --no-index ../mj_40b_no_change_without_its_event/migrations migrations
```

## Run it

As in step 40b: a local PostgreSQL 17 and a new database of its own. Migration 041 is new.

```bash
pnpm install
pnpm migrate
pnpm test:db test/event-tries.db.test.ts
pnpm send-events    # delivers each company's unsent events; names any payment it held back
```

The file channel of this tutorial never refuses an event, so `pnpm send-events` holds nothing back
here. "Break it" below shows a receiver that refuses, through the same code.

## Break it

### The learner's predictions, run for real

A real run on 2026-10-20, in a copy of this step on a database of its own. user_123 drafts and sends
PAY-901 to VENDOR-31, drafts PAY-902, and drafts and sends PAY-903. The receiver refuses every event
about VENDOR-31 until the accounts system adds it. The receiver is a sketch; the sender and
`pnpm send-events`' words are this step's own code:

```text
user_123 drafts INV-1006, 640.00 USD to VENDOR-31: COMMITTED, PAY-901
user_123 sends PAY-901: COMMITTED
user_123 drafts INV-1002, 8,900.50 USD to VENDOR-44: COMMITTED, PAY-902
user_123 drafts INV-1009, 7,425.00 USD to VENDOR-44: COMMITTED, PAY-903
user_123 sends PAY-903: COMMITTED

P1 and P2. Run 1:
$ pnpm send-events   (run 1)
  org_456: sent 3 events
  org_456: held back PAY-901's events, from evt_38449dd2-4e5b-4a5c-ad2a-dde81b89928c: the accounts system answers 422: no vendor VENDOR-31
  ended 1
  the accounts system has heard: ["PAY-902 payment.created #1","PAY-903 payment.created #1","PAY-903 payment.executed #2"]
  still unsent: ["PAY-901 payment.created #1","PAY-901 payment.executed #2"]
  failed tries, by event: ["PAY-901 payment.created #1: 1","PAY-901 payment.executed #2: 0"]

P3. Runs 2, 3, and 4:
  … each run: sent 0 events; held back PAY-901's events …
  dsor.event_alerts after run 2: []
  dsor.event_alerts after run 3: ["PAY-901 payment.created #1 open"]
  dsor.event_alerts after run 4: ["PAY-901 payment.created #1 open"]
  the reasons kept: 4 tries, "the accounts system answers 422: no vendor VENDOR-31"

P4. VENDOR-31 is added to the accounts system. Run 5:
$ pnpm send-events   (run 5)
  org_456: sent 2 events
  ended 0
  dsor.event_alerts after run 5: ["closed, closed_at set: true"]
  the accounts system has heard, in order: ["PAY-902 payment.created #1","PAY-903 payment.created #1","PAY-903 payment.executed #2","PAY-901 payment.created #1","PAY-901 payment.executed #2"]
```

(Runs 2 to 4 print the same two lines as run 1 with `sent 0 events`; they are shortened here.)

| | The learner's answer | What the run shows |
|---|---|---|
| P1 | Nothing yet | PAY-902's and PAY-903's three events, in each payment's order. Only PAY-901 waits. Nothing yet is what step 40b does, in "Why it matters" |
| P2 | Delivered anyway | Not tried: PAY-901's `payment.executed` #2 has no failed try, and waits behind #1. Delivering it would let the accounts system read a payment paid that it never saw drafted |
| P3 | One alert | Right: one, for `payment.created` #1, raised by run 3 and still one after run 4 |
| P4 | Closed by the database | Right: run 5 delivers both events in order, and the same transaction closes the alert |

P1 and P2 miss in opposite directions. P1 stops too much, the whole company, as step 40b did. P2
stops too little, only the one event. The rule stops exactly one payment: the unit that the
ordering key orders (DSOR-EVT-01b).

### The breaks

Each break ran on 2026-10-20 in a copy of this folder outside the repository. Each changed one file,
migrated a fresh database of its own, and ran `test/sender.test.ts`, then
`test/event-tries.db.test.ts` and `test/outbox.db.test.ts`. With the file restored, all of them
passed.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The database's sender stops the whole company at a failure, as in step 40 | 0 | 3 |
| **B2** | The database's sender skips only the failed event, and goes on with its payment's later events | 0 | 2 |
| **B3** | The memory sender stops the whole company | 3 | 0 |
| **B4** | No try is written for a failure | 0 | 5 |
| **B5** | The alert is raised on the second try, not the third | 0 | 1 |
| **B6** | The alert is raised on every try from the third, with no one-alert-per-event key | 0 | 1 |
| **B7** | The alert is not closed when its event is sent | 0 | 1 |
| **B8** | `dsor_runtime` may insert an alert | 0 | 1 |
| **B9** | A try may be changed or removed: its guard lets it | 0 | 1 |

Every break is caught. B1 and B2 fail no unit test, and B3 no database test, and that is right:
the two senders are two pieces of code, and each is caught by the tests of its own world. B4 fails
five tests, because without tries there is no alert either.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real run of step 40b's sender held back by one refused payment |
| 2 | Decide | Six decisions by the learner, D1 to D6; D7 found while checking the design; D8 follows from step 40 |
| 3 | Predict | P1 to P4, asked as stories before any code |
| 4 | The copy | Step 40b copied, its markers removed |
| 5 | Red | Three memory tests and nine database tests, each failing for the right reason; step 40's three failure tests changed to the new rule |
| 6 | Code | Both senders, `pnpm send-events`' words, one migration, one new kind on the map |
| 7 | Earlier tests | The map, the catalog, the policies, the privileges, the counters, the triggers |
| 8 | Break it | P1 to P4, then B1 to B9, for real |
| 9 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 40c in learner mode from the design in
docs/baby_steps_tutorials/mj_40c_one_bad_event_does_not_block/README.md.
```

## Check yourself

1. Step 40b's sender stops at the first event it cannot deliver. What does that protect, and what
   does it cost?
2. PAY-901's `payment.created` is refused. Why is its `payment.executed` not even tried, while
   PAY-902's events are delivered?
3. Why is a refused event kept first in line, and not moved aside after some tries?
4. Who raises the alert, and why not the sender's own code?
5. The sender is killed in the middle of a run in which PAY-901 was refused. How many tries does
   the database keep for that run?

<details>
<summary>Answers</summary>

1. It protects each payment's order: no `payment.executed` before its `payment.created`. It costs
   every other payment's events, which wait behind one refused event for no reason, run after run
   ("Why it matters").
2. The ordering key orders one payment's events (DSOR-EVT-01b). Passing PAY-901's #1 with its #2
   would break that order; PAY-902's events have an order of their own, which PAY-901 does not touch
   (D1, P2).
3. An event moved aside is lost unless a person looks for it. Kept first in line, it is tried on
   every run, and its alert says it waits (D2).
4. The database, in a trigger on the log of tries, on the third try. The sender writes only the
   try; a sender that forgot to raise the alert could not leave it unraised (D4, D7).
5. None. The tries are written in the run's transaction, which never commits, as the run marks no
   event either (D8).

</details>

## Think it through

### Found while building

- **A thrown error is no longer a dying sender.** Step 40's story, and one of its memory tests, made
  the sender "die" by throwing after a delivery. With D1 a thrown error holds back one payment, and
  the run goes on. So the test models the kill directly, and the story's scene now loses each
  answer after its delivery, and says so.
- **The log of tries needs a trigger, and an append-only table may have none** (D7). A new kind,
  `append-only-watched`, says so on the map.
- **An emptied outbox is now refused twice.** The tries and the alerts point at events, so
  PostgreSQL refuses a `TRUNCATE` of `dsor.outbox` before step 40b's guard is asked. Step 40b's test
  accepts either refusal.
- **Two database tests fail on timing in a full run, and pass alone.** `intents.db`'s EXE-04b gives
  the bank 50 ms, which a busy machine misses; it passed alone twice. `bank.db`'s D7 is open question
  158, as in step 40b.

### What the review found

The review is running. Its findings, and what was done about each, come here.

### Left open on purpose

- **`alert.list` does not show these alerts, and nothing escalates them** (D4). A person must look
  in `dsor.event_alerts`.
- **A run takes the oldest 100 unsent events, held back or not.** A payment held back with many
  events still fills that window, and could keep every other payment's events out of it.
- **A slow receiver still holds the run's transaction** (step 40's D8). Each try now waits for it too.
- **A try's reason is the receiver's words**, cut to 200 characters. DSoR keeps them as they came.
- **The log of tries only grows** (D5), as the outbox does.
- **Memory keeps no tries and raises no alerts** (D6).

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-EVT-01b | Every event carries a per-resource ordering key | [§31](../../../specs/dsor/03-execution.md#31-events) | `test/sender.test.ts`, C1, C2, C7; `test/event-tries.db.test.ts`, C1 and C2 |
| DSOR-EVT-01a | Events are produced through a transactional outbox | [§31](../../../specs/dsor/03-execution.md#31-events) | `test/event-tries.db.test.ts`, C3 to C6; `test/store-map.test.ts`, `test/inspector.test.ts` |

This step adds no rule id. The specification orders events per resource; this step makes the sender
keep that order without making a whole company wait. What happens to an event that keeps failing is
this tutorial's decision.

**Next:** step 41, a payment run.
