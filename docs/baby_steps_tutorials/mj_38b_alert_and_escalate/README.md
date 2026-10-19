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
| C2 | "Sent": in one transaction, the proposal moves to `COMMITTED`, the payment is marked paid, and its holds stop counting |
| C3 | "Never received it": in one transaction, the proposal moves to `FAILED`, the payment stays a draft, and its holds stop counting |
| C4 | No answer, or a bank that is down: nothing changes; the proposal stays `OUTCOME_UNKNOWN` and held, and the call says so. A receipt that is not this payment, or a payment cancelled meanwhile, is refused with `CONFLICT`: nothing changes, and a person must look |
| C5 | The proposal's move names what the bank said, by which key, in the call of which time; a refused settlement's record keeps its reason |
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
- **D5. The evidence in the records DSoR already keeps** (the learner's choice). The proposal's
  move names what the bank said, by which key, and when the call asked; a refusal's reason is in the
  call's record. *Downside:* listing every settlement means searching the records by operation.

### The tests, by claim (written first: all 12 red before payment.reconcile existed)

| Claim | Tests |
|---|---|
| C1 to C4 | `test/reconcile.test.ts`, in memory; `test/reconcile.db.test.ts`, on the database, after a real silent bank and after a real `SIGKILL` |
| C5 | `test/reconcile.test.ts`, `test/reconcile.db.test.ts`: the move's cause names the bank's answer and the key; a mismatch's record names its reason |
| C6 | `test/reconcile.test.ts`: the agent refused with and without the permission; a settled proposal refused |
| C7 | `test/reconcile.test.ts`, `test/reconcile.db.test.ts`: the retry after each settlement |

### The breaks

The learner chose not to predict. Each break ran on 2026-10-19 in a fresh copy of this folder, with
a fresh database, against `test/reconcile.test.ts` and `test/reconcile.db.test.ts`.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | Settling moves the proposal only: the payment is not marked paid | 3 | 2 |
| **B2** | "Never received it" is read as sent | 2 | 2 |
| **B3** | A bank that does not answer is read as "never received it" | 2 | 0 |
| **B4** | The agent check is removed | 1 | 0: the database's agent holds no slip that lists the permission |
| **B5** | A settled proposal is reconciled again | 1 | 0 |
| **B6** | The replay ignores the settlement and still answers "unknown" | 2 | 1 |
| **B7** | Any receipt the bank gives for the key settles, whatever it says | 1 | 0 |

B3 is the dangerous one: a bank that is down would make DSoR settle a payment `FAILED` and free its
bill, though the money may have left. B5 first passed every test: the move from `OUTCOME_UNKNOWN`
refuses a settled proposal too, so the early check was a second guard. A dry run showed what it is
for: without it, a dry run of a settled proposal said `VALIDATED`. That test came after the break.

## What changed since step 37

| File | What changed |
| --- | --- |
| `src/reconcile.ts` | **New.** `payment.reconcile`, DSoR's own work: the check, the lookup, and the settling (D1, D2, D5) |
| `contracts/payment.reconcile.json`, `inputs/PaymentReconcileRequest.schema.json`, `examples/payment.reconcile.json` | **New.** The command, its input, and its example for the cross-company suite |
| `src/bank.ts` | The fake's lookup obeys its switch; `lookupThrough` asks within DSoR's wait (C4) |
| `src/permissions.ts` | A contract may say no agent may call it, whatever its slip lists (D3) |
| `src/connectors.ts`, `src/revocation.ts` | An operation may ask the bank and send nothing; DSoR's own work is given the company's bank (D2) |
| `src/pipeline.ts` | The company's bank for DSoR's own work; a replay of an unknown outcome answers the settled outcome (D4) |
| `roles.json`, `classifications.json`, `src/main.ts` | `payment:reconcile` for the AP supervisor and the scheduler; the answer's labels; the scene |
| `test/reconcile.test.ts`, `test/reconcile.db.test.ts` | **New.** The claims C1 to C7 |
| The other tests | Nineteen contracts, 219 attacks, the roles, the labels; a bank that only refuses a repeat is no longer enough for the default bank. Each says "Changed in step 38" |

```bash
git diff --no-index ../mj_37_outcome_unknown/src src
git diff --no-index ../mj_37_outcome_unknown/test test
```

## Run it

As in step 37: a local PostgreSQL 17 and a database of its own. No new migration.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-19, the silent day in the bank's world, shortened:

```text
  a silent day; user_123 sends PAY-902: OUTCOME_UNKNOWN: payment "PAY-902": the bank did not answer within 200 ms, so it may or may not have been sent
    the bank sent TRF-2: 8900.50 USD to VENDOR-44 for PAY-902, key dsor_90c5e1e1dcf…
  user_123 tries to cancel PAY-902: RESOURCE_HELD: payment "PAY-902" is held while a payment's outcome is unknown; try again once it is reconciled
  dsor-scheduler reconciles PAY-902: COMMITTED, the bank sent TRF-2: 8900.50 USD to VENDOR-44
  ...
  payments: PAY-901 paid, PAY-902 paid, PAY-903 paid
```

In step 37 the same run ended "PAY-902 draft", held for ever.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | Reconciliation from zero, five parts, each settled by a real run |
| 2 | Decide | Six choices, one at a time, by the learner; the learner's own rule weighed at D1 |
| 3 | The copy | Step 37 copied, its markers removed |
| 4 | Red | 12 unit tests, all red |
| 5 | Memory | The contract, the lookup, the settling, the agent check, the settled replay |
| 6 | Earlier tests | The lists and counts that name every operation |
| 7 | Database | 5 tests: a silent bank, a lost order, a real `SIGKILL`, the agent, two reconciles at once |
| 8 | Break it | B1 to B7, in copies of the folder |
| 9 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 38 in learner mode from the design in
docs/baby_steps_tutorials/mj_38_reconciliation/README.md.
```

## Check yourself

1. The bank says it sent TRF-1 for PAY-901's key. Name every record that changes, and say why
   they change together.
2. The bank is down when `dsor-scheduler` asks. What happens to PAY-901, and why is "never
   received it" the wrong reading?
3. Why does "never received it" not send the payment again with the same key?
4. The AI worker holds a slip that lists `payment:reconcile`. Can it settle PAY-901?
5. PAY-901 was settled `COMMITTED`. user_123 sends the first request again, with its own key. What
   does it hear?

<details>
<summary>Answers</summary>

1. The proposal (`COMMITTED`), PAY-901 in the books (`paid`), and the holds (they stop
   counting), with the evidence in the move's cause. Together, or a paid payment
   could be cancelled, as the hand settlement in "Why it matters" showed.
2. Nothing changes: it stays `OUTCOME_UNKNOWN` and held, and the next call asks again. A bank that
   does not answer has said nothing, and the money may have left (C4, break B3).
3. Finding out never moves money (D1). A re-send would pay days later on old checks, and needs a
   second "about to pay" note for one proposal. A person may pay again with a fresh payment.
4. No. The contract says no agent may call it, and line ⑤ refuses it whatever its slip lists (D3).
5. `COMMITTED`, with PAY-901 as it is now, paid. The kept "unknown" answer is looked up again
   against the proposal, and never rewritten (D4).

</details>

## Think it through

### Found while building

- **A bank that only refuses a repeat no longer serves as the default bank.** `payment.reconcile`
  looks a payment up, so the bank must answer lookups. A step 35 test said such a bank was enough;
  it is not, for this step, and the test says so.
- **Reconcile is DSoR's own work, not a command that binds the payment.** Bound to PAY-901 it would
  meet PAY-901's own hold and be refused. It names the proposal, and its code reads the payment.
- **Memory moves a proposal before a later failure** (it has no transaction), so a step 36 review
  test's same-key retry now answers what memory's proposal says, `COMMITTED`. On the database the
  proposal stays `EXECUTING`, and the retry still hears `OUTCOME_UNKNOWN`.
- **Two tests came after breaks that passed:** a receipt that is not this payment (B7), and a dry run
  of a settled proposal (B5).

### What the review found

A reviewer who had not seen the conversation read the rules, the code, and this README, attacked
the step with inputs of its own, and broke the code in a copy. It found no way to settle through an
agent, another company, or a race. Each fix below was undone in a copy, and its test failed.

| # | What it found | What was done |
|---|---|---|
| F1 | A payment marked paid by another path made every reconcile fail, so the proposal stayed unknown for ever | A matching receipt settles `COMMITTED` when the payment is already paid. A payment cancelled meanwhile is refused with `CONFLICT` |
| F2 | No test changed the receipt's payment id or vendor | Four tests: another payment, vendor, amount, and currency |
| F3 | No test checks the day's booking: given back on `FAILED`, kept on `COMMITTED` | A test showed that the booking is the draft's: `payment.create` books the day, and the send books nothing. C2 and C3 claimed a booking moved, and no longer do. Two tests: the draft's booking stays as it is, sent or not |
| F4 | This README said the bank's answer was in the record and the bundle. It is in the move's cause only, and a mismatched receipt reached no record at all | A mismatch is refused with `CONFLICT`, so the call's record keeps its reason. C5 and D5 say what is kept. A database test reads the cause |
| F5 | No test reconciles a payment that was prepared, then released | A test: prepared, released on a silent day, reconciled, and the release's same-key retry answers paid |
| F6 | A `FAILED` replay answered `CONNECTOR_UNAVAILABLE`, whose retry is "the same key", so a client could ask again for ever | `CONFLICT`, whose retry is "never" |
| F7 | The agent check tested the type, not the shared `actsAsAgent` | Changed. No test can tell the two apart: with today's four principal types they mean the same |
| F8 | The settled replay answered `COMMITTED` for a proposal moved there while its payment was still a draft | `COMMITTED` only when the payment is paid; otherwise the kept "unknown" answer |
| F9 | The evidence did not name the key, and said "asked at" a time taken before the bank was asked | It names the key, and says "in the call at" |
| F10 | The scene was not committed | It was committed before the review ended |

### Left open on purpose

- **The alert and the human** (step 38b). A payment the bank cannot answer for stays unknown and
  held, and nobody is told.
- **Nothing calls `payment.reconcile` on a timer.** `dsor-scheduler` may call it, as it may call
  the expiry sweep; a deployment's timer would, and this tutorial builds none.
- **"Never received it" is believed at once.** A real bank may still be processing an order it has
  not recorded yet. This step trusts a bank whose lookup is final; a real one may need a wait first
  (open question 153).
- **A payment the bank never received still counts on the day** (F3). The agent's draft booked
  8,900.50 USD on del_100's day, and a `FAILED` send leaves that booking as it is. Reconcile ends
  the send's own booking, as the pipeline ends any command's, but a send holds none today.
- **A `FAILED` replay's code** (F6). `CONFLICT` is the closest code in [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) whose retry is "never". The specification
  names no code for "settled as never received" (open question 152).
- **Two database tests fail on a throwaway server**, as in steps 34 to 37: one that accepts any
  password, and an owner that belongs to no other role.
- **One step 36 database test depends on timing.** Its same-key retry runs inside the bank's call,
  and the bank's wait is 50 ms. In the last full run on 2026-10-19 the retry took longer, and the
  first send heard `OUTCOME_UNKNOWN`. Alone, it passed three times out of three.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-UNK-04a | Every unknown payment is settled `COMMITTED` or `FAILED`, with the evidence used | [§25.3](../../../specs/dsor/03-execution.md#253-reconciliation) | [`test/reconcile.test.ts`](test/reconcile.test.ts), [`test/reconcile.db.test.ts`](test/reconcile.db.test.ts) |
| DSOR-UNK-04d | No agent settles an unknown outcome | [§25.3](../../../specs/dsor/03-execution.md#253-reconciliation) | [`test/reconcile.test.ts`](test/reconcile.test.ts), [`test/reconcile.db.test.ts`](test/reconcile.db.test.ts) |

**Next:** step 38b, the alert within a minute and the human after an hour.
