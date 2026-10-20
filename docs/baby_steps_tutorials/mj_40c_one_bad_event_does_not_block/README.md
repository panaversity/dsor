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
