# Step 40c · One bad event does not block the rest

**New in this step:** when the accounts system refuses an event, the sender holds back only that
payment's events, and delivers every other payment's. It tries the refused event again on every
run. The database keeps each failed try, and raises an alert on an event's third (DSOR-EVT-01a,
DSOR-EVT-01b).

## In plain words

Step 40's sender stops at the first event it cannot deliver. That keeps a payment's events in
order: PAY-901's `payment.executed` never arrives before its `payment.created`. But it also stops
every other payment's events, which do not need to wait.

In this step the sender stops only the failed event's payment. It goes on with every other
payment, and each payment's events still arrive in their own order. The refused event stays the
oldest unsent event of its payment, and the next run tries it again. Nothing moves it aside, so it
is never lost.

Each failed try is written down in the database, with its time and the receiver's reason. When one
event has failed three times, the database raises an alert in `dsor.event_alerts`, where a person
can look. When the event is finally delivered, the database closes the alert, in the same
transaction.

**Words this step uses.** A *trigger* is code that the database runs by itself when a row is
written. `dsor_runtime` is the login DSoR's program works as; the *owner* is the login that runs the
migrations and owns the tables. *The map* is `store.json`: the list of DSoR's tables, the *kind* of
each, and what `dsor_runtime` may do in it. At start-up DSoR compares the database with the map,
and refuses to start when they differ (step 16). An event's *resource* is the address of what it is
about, such as `dsor://org_456/payment/PAY-901`. *At least once* means an event may arrive twice,
but never zero times.

## Why it matters

A real run on 2026-10-20, on a scratch copy of step 40b and a scratch database. user_123 drafts
three payments and sends one. The accounts system does not know VENDOR-31 yet, so it refuses every
event about a payment to VENDOR-31. The receiver is a sketch, not DSoR code; the sender is step 40b's.
In this new database PAY-901 is simply the first payment drafted, of INV-1006, so it is not the
story's PAY-901 of INV-1008:

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

PAY-903 left the bank, and the accounts system never hears of it. Neither does it hear of PAY-902.
Both are to VENDOR-44, which it knows. Their events are not sent while PAY-901's is not, run after
run. And nobody is told: the sender prints a line and ends with 1, and no alert is raised. Step 41
will make 37 payments at once, and one stuck event would hide all 37.

**Common mistake:** "fixing" this by skipping the failed event and going on. Then PAY-901's
`payment.executed` can arrive before its `payment.created`, and the accounts system reads a payment
paid that it never saw drafted. The order to keep is each payment's own, and only that.

## The design, before any code

### How this step was made

On 2026-10-20, right after step 40b, the learner went on to 40c, still before step 41. Claude Code
showed the run above, then asked, one question at a time. The learner made the decisions D1 to D6.
D7 was found while checking the design against step 40b's code, and D8 follows from step 40. After
the review, the learner made D9 and D10.

### What the rules say

- **DSOR-EVT-01b:** "Every event MUST validate against `event.schema.json`, carrying a unique
  `event_id`, the resource URI, a per-resource ordering key, correlation identifiers, and `origin`."
  ([§31](../../../specs/dsor/03-execution.md#31-events)) The ordering key is per resource: it numbers
  one payment's events, not a company's.
- **DSOR-EVT-01a:** events are produced through a transactional outbox. §31 adds: "Delivery is
  at-least-once; consumers deduplicate on `event_id`."
- The specification says nothing about an event that keeps failing, nor about the order of
  delivery. Every rule below about either is this tutorial's decision, not a rule of DSoR.

### The claims

| Claim | What it says |
|---|---|
| C1 | A delivery that fails holds back only its payment's events for the rest of the run. Every other payment's events are delivered, oldest first, and marked sent. A run counts only the events it tries, so events held back never use up a run |
| C2 | Inside one payment, the order holds: no event passes an earlier, unsent event of its payment. An event held back behind a failure is not tried, and the database takes no try for it. An event's number is always the next one for its payment |
| C3 | Every failed try is written in `dsor.outbox_tries`, in the run's transaction, with the database's time and the receiver's reason, cleaned. A try is never changed or removed |
| C4 | An event's third failed try raises one alert in `dsor.event_alerts`. The database raises it, however the tries arrive, and the event gets no second alert |
| C5 | The run that delivers the event closes its alert, and only its alert, in the same transaction that marks the event sent. An alert is never changed otherwise, or removed |
| C6 | `dsor_runtime` may add a try for its payment's oldest unsent event, and nothing else: it cannot raise, close, change, or remove an alert, or change or remove a try. Three tries it writes raise an alert, as the sender's would |
| C7 | `pnpm send-events` names each payment it held back, on its own line, and ends with 1 when any delivery failed |
| C8 | What it does not do: step 38c's `alert.list` does not show these alerts, and nothing escalates them; memory keeps no tries and raises no alerts; a stuck payment stays stuck until someone fixes the cause; the owner can switch a trigger off, as in step 40b |

### Decisions

- **D1. Only the failed payment's events stop** (the learner's). The sender skips the rest of that
  payment's events in this run, and goes on with every other payment. The other ways were to stop
  the whole company, as step 40 does, or to skip only the failed event, which breaks each payment's
  order. *Downside:* the sender must remember, within a run, which payments are held back.
- **D2. Keep trying, and alert** (the learner's). The refused event stays the oldest unsent event of
  its payment, and is tried on every run. The other way was to *park* it: to move it aside after
  some tries, until a person releases it. *Downside:* the payment's later events wait until someone
  fixes the cause, for example adds VENDOR-31 to the accounts system.
- **D3. An alert after 3 failed tries** (the learner's). One bad try, like a short network failure,
  raises nothing. The other ways were an alert at the first failure, or after an hour.
  *Downside:* three runs pass before anyone hears.
- **D4. The alerts are a table of their own, `dsor.event_alerts`** (the learner's). The database
  raises one when an event's third try fails, and closes it when the event is sent, as step 38b's
  alerts open and close with their proposal. The other way was to widen step 38b's alerts to two
  kinds. *Downside:* step 38c's `alert.list` does not show these yet, so a person looks in a second
  place, and nothing escalates them.
- **D5. A log of failed tries, `dsor.outbox_tries`** (the learner's). One row for each failed try:
  the event, the database's time, and the receiver's reason, at most 200 bytes. Never changed. The
  other way was a count on the event, which would make step 40's outbox guard let two more columns
  change. *Downside:* the log grows with every failed try.
- **D6. Memory stops per payment too; the tries and the alerts are the database's** (the
  learner's). Both senders follow D1, so the unit tests show it. *Downside:* the unit tests see no
  try and no alert.
- **D7. A new kind of table on the map, `append-only-watched`** (found while checking the design).
  The alert is raised by a trigger on the log of tries. But the map allows a trigger only on some
  kinds of table, and an `append-only` table may have none. So the log is a new kind: rows are only
  added, and the triggers that the map names in full may act on what is added. *Downside:* one more
  kind for a reader to learn.
- **D8. A try is written in the run's transaction** (follows from step 40's D8). The run reads,
  delivers, marks, and writes its tries in one transaction for the company. A sender killed in the
  middle writes no try, as it marks no event: the next run tries again. *Downside:* a try refused
  just before a kill is not counted.
- **D9. A run counts only the events it tries** (the learner's, after the review's M1). The sender
  reads the unsent events a page at a time, oldest first, and skips the events held back without
  counting them, up to step 40's 100 tries. *Downside:* a run may read more rows than it tries; and
  100 stuck payments would still use every try of a run.
- **D10. An event's number is always the next one for its payment** (the learner's, after the
  review's L4, which came from step 40). The database refuses an event whose ordering key is not the
  count of its resource's events. So the order the sender delivers in, by when each event was
  written, always agrees with the ordering key. *Downside:* one more trigger on the outbox.

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | In memory: PAY-901's events are refused, and PAY-902's are delivered in the same run. On the database: one payment's events refused, another's delivered and marked; a paid payment refused ahead of a draft; oldest first across payments; two paid payments refused, and a run that may try 3 still reaches a third payment |
| C2 | A paid payment's `payment.created` is refused: its `payment.executed` is not tried and has no try, and the run that delivers the first delivers the second after it. The database refuses a try for the held-back event, and a payment's first event numbered 2 |
| C3 | Each failed run writes one try for the payment's first event, with the reason. Two payments refused in one run get a try each. A refusal with no words, a NUL byte, or 150 two-byte characters is kept, cleaned. A sender killed after a refused try leaves none. A try's time is the database's. The owner cannot change or remove a try |
| C4 | After the third failed run, one open alert; after the fourth, still one. Tries written two or three at once still raise one. The owner cannot raise one for an event with one try |
| C5 | The run that delivers the event closes its alert, later than it was raised; with two open alerts, delivering one payment closes only its alert. A try and the mark of its event cannot pass each other. The owner cannot close an alert whose event is unsent, change it, or remove it |
| C6 | `dsor_runtime` cannot insert, update, or delete an alert, or update or delete a try |
| C7 | In memory, through `pnpm send-events`' own code: a refused payment is named with its reason and the run ends 1; two refused payments are named on two lines; a reason with a newline cannot forge a line |

### The learner's predictions

Asked before the build, as stories. A real run settles each one after the build.

| | The story | The learner's answer |
|---|---|---|
| P1 | The accounts system refuses everything about VENDOR-31, as above. After run 1, what has it heard? | Nothing yet |
| P2 | PAY-901 is paid too, so it has `payment.created` #1 and `payment.executed` #2, and #1 is refused. In run 1, what happens to #2? | Delivered anyway |
| P3 | Runs 1, 2, and 3 all fail for PAY-901. What does `dsor.event_alerts` hold after run 3? | One alert |
| P4 | VENDOR-31 is added, and the next run delivers PAY-901's events. What happens to the alert? | Closed by the database |

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

The review added breaks of its own, and each of its fixes has one. They are in "Break it" below.

## What changed since step 40b

| File | What changed |
| --- | --- |
| `src/outbox.ts`, `src/sender.ts` | Both senders hold back only a failed event's payment for the rest of the run, and go on with every other payment; a run counts only the events it tries. A run's failures are a list, each with its payment's resource. The database's sender writes each failed try in its run's transaction. A receiver's reason is cleaned before it is kept or shown (D1, D6, D8, D9) |
| `src/sender.ts` | `pnpm send-events` names each payment it held back, the event it waits on, and the reason (C7) |
| `migrations/041_event_tries.sql` | **New.** `dsor.outbox_tries` and `dsor.event_alerts`, their guards, the trigger that raises an alert on an event's third failed try, and the one that closes it when the event is sent (D2 to D5) |
| `migrations/042_try_rules.sql`, `migrations/043_next_number.sql` | **New, from the review.** A try locks its event's row, is only for its payment's oldest unsent event, and three or more raise the one alert. An event's number is the next one for its payment (D10) |
| `src/store.ts`, `store.json` | The kind `append-only-watched` (D7); the two tables and the new triggers on the map, so start-up refuses a database without them |
| `src/main.ts` | The story's sender that loses its answers: a thrown error no longer stops the run, so the scene now says that the receiver got each event and the sender lost each answer |
| `test/event-tries.db.test.ts`, `test/owner-event-tries.ts`, `test/refuse-and-die.ts`, `test/db.ts` | **New.** The claims on the database; the owner's program that the tests start through `ownerEventTries`; a sender killed for real after a refused try |
| `test/sender.test.ts` | C1, C2, and C7 in memory, and the cleaned reason. Step 40's test of a killed sender now gives the receiver nothing after the first delivery, as a kill would |
| `test/outbox.db.test.ts`, `test/payment-events.db.test.ts`, `test/owner-payment-events.ts` | Step 40's three tests of a failure now expect only its payment held back; step 40b's owner empties the outbox with CASCADE, so its guard is what answers. Each says "Changed in step 40c" |
| `test/catalogs.ts`, `test/store-map.test.ts`, `test/inspector.test.ts`, `test/concurrency.db.test.ts`, `test/audit.db.test.ts`, `test/rls.db.test.ts`, `test/store.db.test.ts` | The two tables, their triggers, policies, privileges, and counter, by name |

```bash
git diff --no-index ../mj_40b_no_change_without_its_event/src src
git diff --no-index ../mj_40b_no_change_without_its_event/test test
git diff --no-index ../mj_40b_no_change_without_its_event/migrations migrations
```

## Run it

As in step 40b: a local PostgreSQL 17 and a new database of its own. Migrations 041 to 043 are new.

```bash
pnpm install
pnpm migrate
pnpm test:db test/event-tries.db.test.ts
pnpm send-events    # delivers each company's unsent events; names any payment it held back
```

The file channel of this tutorial refuses an event only when its file cannot be written, so
`pnpm send-events` holds nothing back here as a rule. "Break it" below shows a receiver that
refuses, through the same code.

## Break it

### The learner's predictions, run for real

A real run on 2026-10-20, in a copy of this step on a database of its own, before the review's
fixes. user_123 drafts and sends PAY-901 to VENDOR-31, drafts PAY-902, and drafts and sends PAY-903.
The receiver refuses every event about VENDOR-31 until the accounts system adds it. The receiver is a
sketch; the sender and `pnpm send-events`' words are this step's own code. As in "Why it matters",
PAY-901 here is the first payment of a new database, not the story's:

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

(Runs 2 to 4 print the same two lines as run 1 with `sent 0 events`; they are shortened here. A
fourth failing run was added to show that the alert stays one, so the delivering run is run 5.)

| | The learner's answer | What the run shows |
|---|---|---|
| P1 | Nothing yet | PAY-902's and PAY-903's three events, in each payment's order. Only PAY-901 waits. Nothing yet is what step 40b does, in "Why it matters" |
| P2 | Delivered anyway | Not tried: PAY-901's `payment.executed` #2 has no failed try, and is not sent while #1 is not. Delivering it would let the accounts system read a payment paid that it never saw drafted |
| P3 | One alert | Right: one, for `payment.created` #1, raised by run 3 and still one after run 4 |
| P4 | Closed by the database | Right: run 5 delivers both events in order, and the same transaction closes the alert |

P1 and P2 miss in opposite directions. P1 stops too much, the whole company, as step 40b did. P2
stops too little, only the one event. The rule stops exactly one payment: the resource whose events
the ordering key numbers (DSOR-EVT-01b).

### The breaks

Each break was run for real, after the review's fixes, in a copy of this step on a new database:
change one thing, migrate, run `test/sender.test.ts` and the three database files of the outbox,
and count the tests that fail. A break is caught when at least one fails. With no break, none
fails.

| Break | What it changes | Tests that fail |
|---|---|---|
| B1 | The database's sender stops the whole company at a failure, as in step 40 | 11 |
| B2 | The database's sender skips only the failed event, and goes on with its payment's later events | 4 |
| B3 | The memory sender stops the whole company | 5 |
| B4 | No try is written for a failure | 14 |
| B5 | The alert is raised on the second try | 1 |
| B6 | The alert is raised on every try from the third, with no one-alert-per-event key | 4 |
| B7 | The alert is not closed when its event is sent | 4 |
| B8 | `dsor_runtime` may insert an alert | 1 |
| B9 | A try may be changed or removed | 1 |
| S1 | A try is written in a transaction of its own, not the run's | 1 |
| S2 | Only the run's first failure is written as a try | 2 |
| S3 | The database's sender ends a page of events at a held-back payment, instead of going on | 0: see below |
| S4 | The database's sender reads every first event before any second one | 2 |
| S5 | `pnpm send-events` names only the first payment it held back | 1 |
| Sm | The memory sender reports only its first failure | 2 |
| G1 | The database does not stamp a try's time | 1 |
| G4 | An alert's `raised_at` is a fixed date | 1 |
| G5 | An alert's `closed_at` is its `raised_at` | 1 |
| G6 | An alert's company, event, payment, and `raised_at` may change | 1 |
| G7 | Sending one event closes every open alert of its company | 1 |
| H1 | A reason keeps its control characters | 3 |
| M1 | Events held back count against the run's tries | 1 |
| L1 | The alert needs exactly three tries, and may be raised twice | 2 |
| L2 | A try does not lock its event's row | 1 |
| L3 | A try may be written for an event held back behind its payment's earlier event | 1 |
| L4 | An event's number need not be the next one for its payment | 1 |

The review's six other breaks, G2, G3, G8, G10, K1, and S6, are being run again; their rows follow.

**S3 is not a fault any more.** Before D9, `break` there stopped the run at a held-back payment's
second event, and the payments after it waited. Now the sender notes how far it has read before it
checks for a held-back payment (`src/sender.ts`, lines 65 and 66). So `break` ends only the page, and
the next read starts right after the held-back event: the same events are delivered, in the same
order, with one more read. No test can fail, because nothing is wrong.

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
| 9 | Review | A reviewer who had not seen the conversation: one high finding, five medium, eight low, and seventeen breaks that left the tests green |
| 10 | Decide again | D9 and D10, by the learner |
| 11 | Fix | Each finding with its tests written first, in commits of their own; every break run again |

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
3. Why is a refused event kept as its payment's oldest unsent event, and not moved aside after some
   tries?
4. Who raises the alert, and what makes sure it is raised once, however the tries arrive?
5. The sender is killed in the middle of a run in which PAY-901 was refused. How many tries does
   the database keep for that run?

<details>
<summary>Answers</summary>

1. It protects each payment's order: no `payment.executed` before its `payment.created`. It costs
   every other payment's events, which are not sent while one refused event is not, run after run
   ("Why it matters").
2. The ordering key numbers one payment's events (DSOR-EVT-01b). Passing PAY-901's #1 with its #2
   would break that order; PAY-902's events have an order of their own, which PAY-901 does not touch
   (D1, P2).
3. An event moved aside is lost unless a person looks for it. Kept as its payment's oldest unsent
   event, it is tried on every run, and its alert says it waits (D2).
4. The database, in a trigger on the log of tries. It raises the alert when an event has three tries
   or more, and the alert's key, one per event, lets it be raised only once, even when several tries
   arrive in one statement (D4, D7; the review's L1).
5. None. The tries are written in the run's transaction, which never commits, as the run marks no
   event either (D8). A test kills the sender for real and finds none.

</details>

## Think it through

### Found while building

- **A thrown error is no longer a killed sender.** Step 40's story, and one of its memory tests,
  made the sender stop by throwing after a delivery. With D1 a thrown error holds back one payment,
  and the run goes on. So the memory test now gives the receiver nothing after the first delivery,
  as a kill would. The story's scene says what now happens: the receiver gets each event, and the
  sender loses each answer.
- **The log of tries needs a trigger, and an `append-only` table may have none** (D7). A new kind,
  `append-only-watched`, says so on the map.
- **The tries and the alerts point at events.** So PostgreSQL refuses a plain `TRUNCATE` of
  `dsor.outbox` before step 40b's guard is asked. The owner's program now truncates with `CASCADE`,
  and step 40b's guard answers, as its test expects.
- **Two database tests fail on timing in a full run, and pass alone.** `intents.db`'s EXE-04b gives
  the bank 50 ms, which a busy machine misses; it passed alone twice. `bank.db`'s D7 is open question
  158, as in step 40b.

### What the review found

A reviewer who had not seen the conversation attacked the step on a database of its own, and ran
breaks of its own. Each fix below came with its tests written first, red, in a commit of its own.

| Finding | What it was | What was done |
|---|---|---|
| H1 | A refusal whose reason the database could not keep, with no words, a NUL byte, or more than 200 bytes, aborted the whole run. No payment was delivered, no try was kept, so no alert came, on every run. And `pnpm send-events` said "the outbox could not be read", which was false | Fixed. Every reason is cleaned before it is kept or shown: control characters become spaces, no words become "the receiver gave no reason", and it is cut to 200 bytes, never inside a character. Tested beside a good payment, on the database |
| M1 | Events held back used up the run's 100 tries. 100 events behind refused payments, older than the rest, stopped the whole company again | Fixed by the learner's D9: a run counts only the events it tries |
| M2 | The tests of C1 had only payments of one event, so the sender could stop at a held-back payment's second event and stay green. "Oldest first" had no test | Two tests: a paid payment refused ahead of a good draft; and a paid payment's two events delivered before a later draft's |
| M3 | Nothing proved that a try is written in the run's transaction, or that each failure gets one | Two tests: a sender killed for real after a refused try leaves no try (`test/refuse-and-die.ts`); two payments refused in one run get a try each |
| M4 | Sending one event could close every open alert of its company, and that change also blocked the company; no test saw it. No test read an alert's times, its payment, or a try's time | Four tests: with two open alerts, delivering one payment closes only its alert; an alert is raised now and closed later; the owner cannot change an alert's payment; a try's time is the database's |
| M5 | "In plain words" said that a person hears of the alert. Nothing tells anyone | Fixed: "where a person can look" |
| L1 | The alert needed exactly three tries. Tries written several at once could jump from two to four and raise nothing, or from one to three and fail | Fixed in migration 042: three tries or more raise the alert, and only once |
| L2 | A try and the mark that sends its event could run side by side, and leave an open alert on a sent event | Fixed in migration 042: a try locks its event's row first, so the two run one after the other |
| L3 | `dsor_runtime` could write tries for an event held back behind its payment's earlier event, which the sender never tries, and so raise an alert for it | Fixed in migration 042: a try is only for its payment's oldest unsent event. Three tries for that event still raise its alert: "Left open" says so |
| L4 | From step 40: nothing made an event's number follow the order it was written. Raw SQL wrote a payment's #2 before its #1, and the sender delivered #2 first | Fixed by the learner's D10, migration 043 |
| L5 | A reason with a newline could print a false line of `pnpm send-events`, such as `ended 0` | Fixed with H1 |
| L6 | Step 40b's test of its guard on emptying the outbox now passed on the foreign key's refusal, so it no longer proved the guard | The owner's program empties the outbox with `CASCADE`, and the test expects only the guard's words |
| L7 | The tests of the delivery order were titled DSOR-EVT-01b, which asks for an ordering key, not for an order of delivery | Titled by step 40c's decision D1 |
| L8 | A comment left over in `src/outbox.ts` | Removed |

The review also found the words of this README that broke the house style: images such as "first
in line" and "park", terms used before they were defined, and sentences that said more than the
runs showed. They are rewritten, and "Words this step uses" defines the terms.

### Left open on purpose

- **`alert.list` does not show these alerts, and nothing escalates them** (D4). A person must look
  in `dsor.event_alerts`.
- **100 stuck payments would use every try of a run** (D9). Each is tried once a run, and the run
  stops at 100 tries.
- **A slow receiver still holds the run's transaction** (step 40's D8), and each try waits with it.
- **A try's reason is the receiver's words**, cleaned and cut to 200 bytes. DSoR does not judge what
  they say.
- **The log of tries only grows** (D5), as the outbox does.
- **Memory keeps no tries and raises no alerts** (D6).
- **The owner can switch a trigger off**, as step 40b says. And start-up compares each trigger, not
  the function behind it.
- **`dsor_runtime` can write three tries for an unsent event, and so raise its alert** (C6). It can
  not raise one any other way.

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-EVT-01b | Every event carries a per-resource ordering key | [§31](../../../specs/dsor/03-execution.md#31-events) | `test/event-tries.db.test.ts`: L4, an event's number is the next one for its payment |
| DSOR-EVT-01a | Events are produced through a transactional outbox | [§31](../../../specs/dsor/03-execution.md#31-events) | `test/event-tries.db.test.ts`, C3 to C6 and the review's tests; `test/sender.test.ts`, the cleaned reason; `test/store-map.test.ts`, `test/inspector.test.ts` |

The order of delivery is this tutorial's rule: the tests of C1, C2, and C7 are titled by step 40c's
decision D1, not by a rule id. The specification orders events per resource; this step makes the
sender keep that order without making a whole company wait.

**Next:** step 41, a payment run.
