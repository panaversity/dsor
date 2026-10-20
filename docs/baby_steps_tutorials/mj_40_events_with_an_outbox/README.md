# Step 40 · Events with an outbox

**New in this step:** when DSoR drafts a payment, pays one, or approves a proposal, it writes an
event about it in the same database transaction as the change, into an outbox; a separate sender
delivers each company's events to that company's channel, at least once (DSOR-EVT-01a,
DSOR-EVT-01b, DSOR-COR-01a).

## In plain words

Other systems need to know what DSoR did. The company's accounts system must learn that PAY-901 was
paid, so it can close INV-1008. An *event* is a short message for them: "payment PAY-901 was paid",
with an id of its own, the payment's address, and the ids of the call that did it.

Sending the message is the hard part. DSoR changes the payment in its database, and the accounts
system is another program. If DSoR changes first and then sends, a crash in between loses the
message. If it sends first and then changes, a change that does not commit leaves a message about
something that never happened.

The *outbox* is the answer from §31. DSoR writes the event into a table of its own, the outbox, in
the same database transaction as the change. The two commit together, or neither does. Later, a
separate program, the *sender*, reads the outbox and delivers each event. If the sender crashes
after delivering and before noting it, it delivers the event again. So an event can arrive twice,
and the receiver ignores an event id it has seen before.

## Why it matters

A real run on 2026-10-20, on a scratch copy of step 39b's database, of the two ways to send without
an outbox. The script is a sketch, not DSoR code. Each way marks a draft paid in the database and
tells the accounts system by writing a line to a file. One sends after its commit, and the process
is killed in between. The other sends first, and its change is rolled back, as DSoR rolls back a
change whose record cannot be written (DSOR-EXE-03b):

```text
the database before:
PAY-902 | draft
PAY-904 | draft
$ node dual-write.mjs after
exit=1
$ node dual-write.mjs before
exit=0
the database after:
PAY-902 | paid
PAY-904 | draft
what the accounts system heard:
payment.executed PAY-904
```

PAY-902 is paid, and the accounts system never heard, so it chases the vendor for an invoice that is
paid. PAY-904 was never paid, and the accounts system closed its invoice. In step 39b DSoR sends no
event at all, so every other system must read DSoR's database to learn anything.

**Common mistake:** sending the event from the code, right after the commit, and calling it done. It
works on every test run, because no test kills the process between the two lines. The outbox moves
the send out of the change's transaction, and the event into it.

## The design, before any code

### How this step was made

On 2026-10-20 the learner finished step 39b and asked for step 40 to be built while they were away:
"autonomously start and complete 40, then keep the story for my in-depth understanding ready". So no
one could answer a design question. Claude Code made every decision below, each marked "(Claude
Code's)", with its downside, for the learner to review in the session after the build. The learner's
predictions are written as questions, to ask then.

### What the rules say

- **DSOR-EVT-01a:** "Where events are published, they MUST be produced through a transactional
  outbox or an equivalent that ties the event to the recorded outcome."
- **DSOR-EVT-01b:** "Every event MUST validate against `event.schema.json`, carrying a unique
  `event_id`, the resource URI, a per-resource ordering key, correlation identifiers, and
  `origin`." ([§31](../../../specs/dsor/03-execution.md#31-events))
- **DSOR-COR-01a:** "DSoR MUST propagate `task_id`, `trace_id`, `session_id`, `tenant_id`,
  `agent_id`, `principal_id`, and `request_id` through connectors, audit, and events."
  ([§32](../../../specs/dsor/03-execution.md#32-correlation))

Two more rules in §31 are not in the map's list, and no other step takes them, so this step takes
them too: **DSOR-EVT-01c**, "An event MUST NOT contain `RESTRICTED` field values", and
**DSOR-EVT-01d**, "Event channels MUST be tenant-scoped." §31 also says: "Delivery is
at-least-once; consumers deduplicate on `event_id`." And
[DSOR-EXE-04a](../../../specs/dsor/03-execution.md#21-command-pipeline), which step 36b met for
the record, names the outbox: "the state change, the final outcome, and the outbox entry MUST
commit atomically."

### The claims

| Claim | What it says |
|---|---|
| C1 | A payment drafted by `payment.create`, by a call or by the release of a stored proposal, writes one `payment.created` event, in the same transaction as the draft. A refused or failed draft writes none, and a replay writes none |
| C2 | A payment paid by `payment.execute`, or settled paid by `payment.reconcile`, writes one `payment.executed` event. The bank's silence, `OUTCOME_UNKNOWN`, writes none, and neither does a settlement as `FAILED` |
| C3 | The approval that moves a proposal to `APPROVED` writes one `proposal.approved` event. An approval that leaves it waiting writes none |
| C4 | An event and its change commit together, or neither does: a change rolled back, because its record could not be written or its process was killed, leaves no event, and an event that cannot be written stops its change (DSOR-EVT-01a, DSOR-EXE-04a) |
| C5 | Every event validates against `event.schema.json`: an `event_id` no other event has, the resource's URI, its number among that resource's events as the ordering key, `origin` `dsor`, and the call's correlation ids with the company's (DSOR-EVT-01b, DSOR-COR-01a, partly). Its data never holds a `RESTRICTED` value (DSOR-EVT-01c) |
| C6 | `pnpm send-events` delivers each company's unsent events, oldest first, to that company's channel only, and marks each one sent. A failure stops that company's delivery, and the rest wait for the next run. One sender works on a company at a time (DSOR-EVT-01d) |
| C7 | At least once: a sender killed after a delivery and before its mark delivers that event again, and the receiver drops an `event_id` it has seen |
| C8 | What it does not do, said in this README: no `invoice.issued`, because no code issues an invoice; no `trace_id` or `session_id`, because no request carries one; an agent's `task_id` stays where step 33 keeps it; and an agent's event names the agent, never the human whose slip it holds: user_123 is not in the event of the agent's draft. Said in full since the review, L6 |

### Decisions

- **D0. Three of the four events §31 names** (Claude Code's). `payment.created`,
  `payment.executed`, and `proposal.approved`. `invoice.issue` has a contract and no code, because
  issuing an invoice is not this tutorial's story, so nothing could write `invoice.issued`.
  *Downside:* the accounts system hears of payments, not of invoices.
- **D1. DSoR's own code writes each event, where the change is made, in the claim's transaction**
  (Claude Code's). Three places. The first is the company's code, for `payment.create` and
  `payment.execute`. DSoR gives the code its payments through a wrapper that notes each draft
  written and each payment marked paid. As soon as the code returns, DSoR checks that the code made
  exactly the one change its operation names: one draft, or one payment marked paid, and for a send
  it must be the payment the request names. DSoR reads that payment again from its own store and
  writes its event, with the work, before the record is sealed. Any other change is an accident,
  and the work is not kept. What the code returned is never read for an event. The second and third
  places are `proposal.approve`'s own work and `payment.reconcile`'s own work. The company's code
  gets no outbox. The other way was a database trigger, as step 38b's alerts are written, which no
  path can forget; but a trigger cannot see the call's correlation ids, which each event must carry.
  *Downside:* a new path that changes a payment must remember its event. The database does not
  refuse a change without one; a test checks every path this step knows. Changed by the review,
  H1 and M1.
- **D2. The outbox is a table, `dsor.outbox`** (Claude Code's). One row for each event: the whole
  event as JSON, and its id, company, type, resource, and ordering key as columns, which a check
  holds equal to the JSON. Since the review, L4, the database also refuses an event about another
  company's resource, one whose correlation names another company, and one labelled `restricted`
  (migration 037). It is kept per company by row-level security, like every DSoR table. A row is
  never removed, and its `sent_at` is set once, by the database's clock. *Downside:* the table only grows; clearing
  sent events is a later job.
- **D3. An event's id and time** (Claude Code's). `evt_` and a random UUID; the time is DSoR's clock
  when the event is written. *Downside:* the time is a moment after the change, inside the same
  transaction, not the moment of the bank's answer.
- **D4. The ordering key is the event's number among its resource's events** (Claude Code's). 1, 2,
  3 for each resource, in the order they commit: PAY-901's `payment.created` is 1 and its
  `payment.executed` is 2. The store writes it while the transaction holds a lock of the resource's
  own, so a second event about it waits for the first to commit, and a unique key refuses two events
  with one number. *Downside:* it is not the payment's version, which counts a cancellation too, so
  the two numbers can differ. The lock was added by the review, L2.
- **D5. An event's data is the resource as DSoR holds it, through the classification** (Claude
  Code's). For a payment, the payment as DSoR's store reads it after the change; for an approval,
  what `proposal.approve` answers. Every field passes step 14's labels with the clearance
  `confidential`, so a `RESTRICTED` field is left out (DSOR-EVT-01c), and the event's
  `classification` is the highest label left: `confidential` for a payment, because of its amount.
  *Downside:* a receiver that may see less than confidential must still be trusted with the amount.
- **D6. The correlation ids** (Claude Code's). The call's own, as DSoR keeps them in its record:
  `request_id`, and `agent_id` or `principal_id`; and the company's `tenant_id`. A request carries
  no `trace_id` or `session_id`, so no event can. An agent's `task_id` arrives as `agent_asserted`,
  which step 33 keeps in the record and the bundle and nowhere else. *Downside:* DSOR-COR-01a is
  met only in part. An open question asks how a request should carry the other ids.
- **D7. Checked before it is written** (Claude Code's). Each event is checked against
  `event.schema.json`, copied from the specification, before the outbox takes it. An event that
  fails stops its change: the transaction rolls back, and the caller hears an error. *Downside:* a
  mistake in an event's shape stops payments, where a looser design would only lose events. Before
  the bank is asked, the draft or the send is refused. After the bank has sent, it is worse: the
  send is `OUTCOME_UNKNOWN`, and every reconcile of it fails too, because its `payment.executed`
  fails the same check. The money has left, and the proposal stays unknown, its invoice held, until
  the mistake is fixed. Said in full by the review, L3.
- **D8. The sender** (Claude Code's). `pnpm send-events`, as DSoR's own login, `dsor_runtime`, one
  company at a time. Inside one transaction per company, it takes the company's lock for sending,
  reads its unsent events in the order they were written, delivers each, marks the delivered ones
  sent, and commits. It stops at the first delivery that fails, so a resource's later event never
  passes its earlier one. A second sender at the same moment finds the lock taken and leaves that
  company alone. *Downside:* the transaction stays open while the sender delivers; a slow receiver
  holds it.
- **D9. One channel per company, in `channels.json`** (Claude Code's). Each company's events go to
  its own channel, and the file is refused at start if two companies could share one
  (DSOR-EVT-01d; D12 says how). A company with no channel keeps its events until it gets one. In this tutorial a channel is a file
  of JSON lines; how events travel is outside the specification. *Downside:* a file is not a queue;
  the receiver reads the whole file.
- **D10. The receiver drops an event id it has seen** (Claude Code's). `src/receiver.ts` is the
  other system's side, kept small: it reads a channel and keeps the first copy of each event.
  *Downside:* it must remember every id it has seen.
- **D11. Memory works the same, without a transaction** (Claude Code's). The memory outbox takes
  events from the same three places, and the memory sender delivers the same way. Memory has no
  transaction, so an event written by a call stays with that call's draft, as the draft itself stays.
  One case is memory's own: when the outbox refuses `payment.executed` after the code marked the
  payment paid, the payment stays paid with no event. So `payment.reconcile` writes
  `payment.executed` for a paid payment that has none, and never a second. *Downside:* the atomic
  commit is proved on the database only. Changed by the review, M1 and L1.
- **D12. A channel is named after its company** (Claude Code's, from the review, M4). org_456's
  channel must be `org_456.jsonl`, and any other name is refused. The first rule took any `.jsonl`
  name and refused two equal names. But `a.jsonl` and `A.jsonl` are two names and, on a disk that
  does not tell capitals apart, as macOS and Windows do by default, one file: two companies' events
  in one channel. A tenant id has no capitals, so names made from tenant ids never meet that way.
  *Downside:* a company cannot choose its channel's name, and a deployment that sends events to a
  queue needs a rule of its own.

### The tests, by claim

| Claim | Tests |
|---|---|
| C1 to C3, C5 | `test/events.test.ts`: the story's calls in memory, and the events each leaves |
| C5 | `test/event-shape.test.ts`: each event against `event.schema.json`, the ordering keys, a planted `RESTRICTED` field |
| C6, C7 | `test/sender.test.ts`: the memory sender against receivers that fail, its lock and its copies, the receiver's dedupe, `channels.json`, and `sendEach`, the script's run over every company |
| C1 to C7 | `test/outbox.db.test.ts`: the same on the database, with a record that cannot be written, a sender killed after delivering, and two senders at once; and the review's tests, each titled by its finding |

### The learner's predictions, to ask after the build

Each will be settled by a real run, shown beside the learner's answer.

| # | The story | The question |
|---|---|---|
| P1 | user_123 drafts INV-1008. The decision record cannot be written, so the caller hears `EVIDENCE_STORE_UNAVAILABLE` | Is there a draft in the database? Is there a `payment.created` event in the outbox? |
| P2 | PAY-901 is paid. The sender delivers `payment.executed` to org_456's channel, and is killed before it marks the event sent. The sender runs again | What does org_456's channel hold now, and what does the accounts system act on? |
| P3 | The bank is silent for PAY-902, and its outcome is unknown. A day later `payment.reconcile` finds it was sent | Which events does PAY-902 have, and what is each one's ordering key? |
| P4 | org_789 has a channel too, and both companies pay invoices | Can org_789's channel ever receive an event about PAY-901? |

### The breaks

Each break ran on 2026-10-20 in a copy of this folder outside the repository, with a database of
its own, against the three unit test files and `test/outbox.db.test.ts` with `test/approve.db.test.ts`.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The event is written in a transaction of its own, not the claim's | 0 | 2 |
| **B2** | The sender marks events sent before it delivers them | 2 | 1 |
| **B3** | The sender goes on after a delivery fails | 2 | 1 |
| **B4** | No check against `event.schema.json` | 1 | 0 |
| **B5** | The event's data skips the classification | 2 | 0 |
| **B6** | The sender ignores which company an event belongs to | 5 | 0 |
| **B7** | Every ordering key is 1 | 6 | 12 |
| **B8** | The event is built from what the company's code returned | 1 | 0 |

B1 is the step's whole idea, and only the database can show it: memory has no transaction. B3 first
failed no database test: the database's sender had none of its own for a failure in the middle of
a run. One was added, and it fails on B3. B8 was found while building: no test said that DSoR
reads the payment again, so two were added (D1). B6 fails no database test because the database
refuses it twice over: the sender works inside one company, and row-level security shows it that
company's rows only.

## What changed since step 39b

| File | What changed |
| --- | --- |
| `src/events.ts` | **New.** An event built from DSoR's own data through the classification, with the call's ids; its check against `event.schema.json`; the writer one call uses; the payments that note each change the company's code makes, and the event of that change, from the payment DSoR reads again (D1, D3, D5 to D7) |
| `src/outbox.ts` | **New.** Each resource's events numbered and checked; the memory outbox and its sender; the writer a claim uses on the database (D2, D4, D8, D11) |
| `src/sender.ts`, `src/send-events.ts`, `package.json` | **New.** The database's sender, one company and one sender at a time, and `pnpm send-events` (D8) |
| `src/channels.ts`, `channels.json`, `src/receiver.ts` | **New.** One channel per company, a file channel, and the receiver's dedupe (D9, D10) |
| `migrations/036_outbox.sql`, `migrations/037_outbox_checks.sql`, `store.json` | **New.** `dsor.outbox`, its columns held equal to its event, marked sent once by its guard, each company's own; and, from the review, each event about its own company and never labelled restricted (D2) |
| `schemas/event.schema.json` | **New.** Copied from the specification |
| `src/claims.ts`, `src/postgres.ts`, `src/pipeline.ts`, `src/revocation.ts` | Every claim's stores hold the outbox; the company's code gets payments that note each change, and the change's event is written as soon as the code returns; DSoR's own work gets an event writer |
| `src/approve.ts`, `src/reconcile.ts` | The approval that moves a proposal to `APPROVED`, and a reconcile that pays, write their events |
| `src/main.ts` | The story shows the bank scene's events, a sender killed after one delivery, and this run's events in `dsor.outbox` |
| `test/events.test.ts`, `test/event-shape.test.ts`, `test/sender.test.ts`, `test/outbox.db.test.ts`, `test/send-and-die.ts`, `test/owner-outbox.ts` | **New.** The claims C1 to C7 |
| The other tests | The store map, the planted catalog, `dsor_runtime`'s privileges, row-level security, and the triggers name the outbox; the approval's event on the database. Each says "Changed in step 40" or "Step 40" |

```bash
git diff --no-index ../mj_39b_a_checkpoint_kept_elsewhere/src src
git diff --no-index ../mj_39b_a_checkpoint_kept_elsewhere/test test
```

## Run it

As in step 39b: a local PostgreSQL 17 and a database of its own. Migrations 036 and 037 are new.

```bash
pnpm install
pnpm migrate
pnpm start          # the story; its last scene shows the events, a sender that dies, and the dedupe
pnpm send-events    # delivers each company's unsent events to events/<company>.jsonl
```

`pnpm send-events` logs in as `dsor_runtime`, `DSOR_DB_URL` in `.env`, and never prints it. Run it
again and it sends only what is new. Open `events/org_456.jsonl` to read what the accounts system
would receive.

## Break it

The four stories of "The learner's predictions", run for real on 2026-10-20 on a scratch database,
by a script that drives DSoR's own code as the tests do. Predict first: each answer is folded
away. The request ids are shortened, and the scratch paths taken out.

**P1.** user_123 drafts INV-9001, and the database refuses the decision record.

<details>
<summary>What the database holds after</summary>

```text
user_123 drafts INV-9001, and the record cannot be written: EVIDENCE_STORE_UNAVAILABLE
payments of INV-9001 in the database: []
events in dsor.outbox from that call: []
the same draft, with the database mended: COMMITTED
events from that call: [{"type":"payment.created","resource":"dsor://org_456/payment/PAY-906","ordering_key":1,"request":"p1-again-…","sent":false}]
```

No draft and no event: the event was written in the draft's transaction, and the record's failure
rolled all three back (C4).

</details>

**P2.** A payment is drafted and paid. The sender delivers its first event to org_456's channel and
is killed before it marks it sent. Then `pnpm send-events` runs.

<details>
<summary>What org_456's channel holds, and what the accounts system acts on</summary>

```text
the sender delivers to org_456's channel and is killed: signal SIGKILL
org_456's channel now: payment.created PAY-908
in dsor.outbox, still unsent: ["payment.created sent=false","payment.executed sent=false"]
$ pnpm send-events
org_456: sent 2 events
org_789: sent 0 events
org_456's channel now: payment.created PAY-908 (evt_45b84b87…), payment.created PAY-908 (evt_45b84b87…), payment.executed PAY-908 (evt_ff42f8db…)
the accounts system keeps 2, and drops evt_45b84b87…, which it had
```

The mark never committed, so the event was still unsent and was delivered again: at least once.
The receiver acts on the first copy of each `event_id` (C7, D10).

</details>

**P3.** The bank takes PAY-909 and never answers. Then dsor-scheduler reconciles it.

<details>
<summary>PAY-909's events, and their ordering keys</summary>

```text
user_123 sends PAY-909 and the bank never answers: OUTCOME_UNKNOWN
its events: [{"type":"payment.created","resource":"dsor://org_456/payment/PAY-909","ordering_key":1,"request":"p3-draft-…","sent":false}]
dsor-scheduler reconciles it: COMMITTED, COMMITTED
its events: [{"type":"payment.created",…,"ordering_key":1,"request":"p3-draft-…"},{"type":"payment.executed",…,"ordering_key":2,"request":"p3-reconcile-…"}]
```

While the outcome is unknown there is no `payment.executed`: DSoR does not announce what it does
not know. The reconcile that marks it paid writes it, numbered 2, with the reconcile's own request
id (C2, D4).

</details>

**P4.** org_789 drafts its own INV-2002, and both companies' events are sent.

<details>
<summary>What each channel holds</summary>

```text
user_700 drafts org_789's INV-2002: COMMITTED
$ pnpm send-events
org_456: sent 3 events
org_789: sent 1 event
org_456.jsonl: 3 events, 0 of another company
org_789.jsonl: 1 events, 0 of another company
channels.json with one channel for both: channels.json: org_456's channel must be org_456.jsonl; channels.json: org_789's channel must be org_789.jsonl
```

The sender works inside one company at a time, and the database's row-level security shows it
that company's events only. A file that would give two companies one channel is refused (C6,
DSOR-EVT-01d). The last line was run again after the review's M4 changed the rule: the first run
said the two companies share `all.jsonl`. Now each channel must be named after its company (D12).

</details>

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real run of the two ways to send without an outbox |
| 2 | Decide | Twelve decisions, by Claude Code, while the learner was away |
| 3 | The copy | Step 39b copied, its markers removed |
| 4 | Red | 44 unit tests against stubs, and the database tests |
| 5 | Code | The event, the outbox, the channels and the receiver, the wiring, the database's table and sender, the story |
| 6 | Earlier tests | The store map, the catalog, the privileges, row-level security, and the triggers |
| 7 | Break it | B1 to B8, for real |
| 8 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 40 in learner mode from the design in
docs/baby_steps_tutorials/mj_40_events_with_an_outbox/README.md.
```

## Check yourself

1. Why can DSoR not send the event right after the commit, from the same code?
2. The decision record of user_123's draft cannot be written. Why is there no `payment.created`
   event in the outbox?
3. The sender delivers an event and is killed before it marks it sent. What happens next, and who
   makes sure the accounts system acts on it once?
4. PAY-901 has two events. What are their ordering keys, and what are they for?
5. Why does DSoR build the event from the change its store saw the company's code make, instead of
   from what the code returned?

<details>
<summary>Answers</summary>

1. A crash between the commit and the send loses the event: PAY-902 in "Why it matters" is paid and
   nobody heard. Sending first is worse: PAY-904 was announced and never paid. The outbox writes
   the event in the change's transaction, so they commit together (C4).
2. The event was written in the same transaction as the draft and the record. The record failed, so
   the whole transaction rolled back: no draft, no record, no event (C4, DSOR-EXE-04a).
3. The mark and the delivery are in one transaction that never committed, so the event is still
   unsent, and the next run delivers it again. The receiver keeps the first copy of each
   `event_id` and drops the second (C7, D10).
4. 1 for `payment.created` and 2 for `payment.executed`: the event's number among PAY-901's
   events. A receiver that gets them out of order puts them back in order with it (D4).
5. DSoR never takes anyone's word, the company's code included. An event built from the code's
   answer could report an amount that was never drafted. Worse, code that pays PAY-902 and answers
   with PAY-901 would announce PAY-901 paid a second time, and PAY-902 never (D1; the review's
   H1).

</details>
