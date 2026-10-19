# Step 38 · Reconciliation: find out, then settle

**New in this step:** a command, `payment.reconcile`, that asks the bank what happened to a payment
whose outcome is unknown, by its key, and settles it `COMMITTED` or `FAILED` with the bank's answer
as evidence. An agent may never settle one (DSOR-UNK-04a, DSOR-UNK-04d).

## In plain words

DSoR is a careful clerk between a company's people and AI workers and its real systems, its books
and its bank. When DSoR asks the bank to send a payment and the bank never answers, nobody knows
whether the money left. Since step 35 DSoR says so, `OUTCOME_UNKNOWN`, and since step 37 it holds the
payment and its bill so nobody pays twice.

Until this step, that is where it stays, for ever. *Reconciliation* means finding out what really
happened, and settling DSoR's records to match, with the evidence of how it found out. DSoR gave the
bank a key made from the payment's own attempt, so it can ask: "what happened to the payment with
this key?" The bank's answer decides:

- **"Sent, TRF-1"**: the payment is `COMMITTED`, the slip is marked paid, and the hold lifts.
- **"Never received it"**: the payment is `FAILED`, the hold lifts, and a person may pay again.
- **No answer**: it stays unknown and held, and DSoR asks again later.

Accountants know this from month end: a *bank reconciliation* ticks the bank statement against the
books. DSoR does the same for one payment, by its key, as soon as it goes unknown.

## Why it matters

user_123 sends PAY-901, 8,900.50 USD to VENDOR-44 for INV-1002. The bank takes it and goes silent.
A real run on step 37's code, three days later, on 2026-10-19:

```text
Tuesday 15:05  user_123 sends PAY-901 → DSoR answers OUTCOME_UNKNOWN
Friday         the bank is back to normal
               DSoR's record of PAY-901's attempt: OUTCOME_UNKNOWN
               PAY-901 in the books: draft
               user_123 tries to cancel PAY-901 → RESOURCE_HELD
               what the bank would say if asked, by the key: TRF-1: 8900.50 USD sent to VENDOR-44
               who has asked the bank: nobody
```

VENDOR-44 phones to ask where its money is. Nobody at org_456 can say. The bank has known since
Tuesday.

**Common mistake:** settling by moving the proposal's state alone. A run on step 37's code, settled
by hand: the proposal said `COMMITTED`, the slip still said "draft", the hold lifted, and a cancel of
PAY-901 went through, cancelling a payment whose money had gone. Settling is several changes, made
together, or none.

## The design, before any code

### How this step was made

The learner studied reconciliation from zero on 2026-10-19, then decided six choices one at a time
(D0 to D5, each the recommended option). In the lesson the learner proposed "look up first, re-send
with the same key only if the bank never received it, never a new key". At the design, shown that a
re-send needs a second "about to pay" note for one proposal and moves money days late on old checks,
the learner chose to look up only (D1).

### What the rules say

- **DSOR-UNK-04a:** "A reconciliation process MUST resolve every `OUTCOME_UNKNOWN` proposal to
  `COMMITTED` or `FAILED` and record the evidence used."
- **DSOR-UNK-04d:** "An agent principal MUST NOT resolve an unknown outcome."
  ([§25.3](../../../specs/dsor/03-execution.md#253-reconciliation))

The alert within a minute and the human after an hour (DSOR-UNK-04b, DSOR-UNK-04c) are step 38b's.

### The claims

| Claim | What it says |
|---|---|
| C1 | `payment.reconcile` asks the company's bank, by the key of the unknown proposal, what happened |
| C2 | "Sent": in one transaction, the proposal moves to `COMMITTED`, the payment is marked paid, its booking is kept, and its holds stop counting |
| C3 | "Never received it": in one transaction, the proposal moves to `FAILED`, the payment stays a draft, its booking is given back, and its holds stop counting |
| C4 | No answer, or a bank that is down: nothing changes; the proposal stays `OUTCOME_UNKNOWN` and held, and the call says so |
| C5 | Each call leaves its record and bundle naming what the bank said and when; the proposal's move names the same cause |
| C6 | An agent is refused, whatever its slip lists; a proposal that is not `OUTCOME_UNKNOWN` is refused, so nothing is settled twice |
| C7 | Once settled, a same-key retry of the original send answers the settled outcome, not "unknown" |

### Decisions

- **D0. Split from 38b** (the learner's choice). Step 38 finds out and settles; step 38b alerts
  within a minute and hands over to a human after an hour. *Downside:* until 38b, a payment the bank
  cannot answer for stays unknown with nobody told.
- **D1. Look up only** (the learner's choice). "Never received it" settles `FAILED`; a person may
  pay again with a fresh, fully checked payment. Finding out never moves money. *Downside:* a person
  must act to pay again, and that payment has a new key, made on purpose after the bank said it
  never got the first.
- **D2. An operation, run by `dsor-scheduler`** (the learner's choice). `payment.reconcile` is
  DSoR's own work, as the expiry sweep of step 25c is: its input names the unknown proposal, it goes
  through the whole checklist, and it is claimed and recorded like any call. DSoR's scheduled login
  calls it. *Downside:* one more contract, permission, input schema, and example to keep in step.
- **D3. The job, and people with the AP supervisor role** (the learner's choice). user_123 may
  press "check now". The bank's answer decides, so the caller cannot steer the outcome. An agent is
  refused in the code of the operation, whatever its slip lists, never by an instruction to it.
  *Downside:* one more role holds the permission.
- **D4. The settled answer to a same-key retry** (the learner's choice). A claim's kept "unknown"
  answer is looked up again against its proposal: once settled, the retry answers paid or failed.
  The kept answer is never rewritten. *Downside:* a small exception in the replay.
- **D5. The evidence in the records DSoR already keeps** (the learner's choice). The call's decision
  record and bundle, and the proposal's move, name what the bank said and when. *Downside:* listing
  every settlement means searching the records by operation.

### The tests, by claim (to be written first, red)

| Claim | Tests |
|---|---|
| C1 to C4 | `test/reconcile.test.ts`, in memory; `test/reconcile.db.test.ts`, on the database, after a real silent bank and after a real `SIGKILL` |
| C5 | `test/reconcile.test.ts`: the record and the bundle name the bank's answer |
| C6 | `test/reconcile.test.ts`: the agent refused with and without the permission; a settled proposal refused |
| C7 | `test/reconcile.test.ts`, `test/reconcile.db.test.ts`: the retry after each settlement |

### The breaks, planned

| Break | What it removes |
|---|---|
| B1 | Settling moves the proposal only: the payment stays a draft |
| B2 | "Never received it" is read as sent |
| B3 | A bank that does not answer is read as "never received it": the hold lifts on a payment that may have left |
| B4 | The agent check is removed: an agent with the permission settles |
| B5 | A settled proposal is reconciled again |
| B6 | The replay ignores the settlement and still answers "unknown" |
