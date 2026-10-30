# Step 35 · A fake bank

**New in this step:** a second connector, a pretend bank, and `payment.execute`, the first command
that cannot be undone. It goes only to a bank that refuses a repeated key or answers whether a
payment went through, with a key derived from the proposal (DSOR-UNK-03a, DSOR-IDM-03).

## In plain words

Until now, a payment was a *draft*: PAY-901 was a row in DSoR's own records that said "VENDOR-44 is
to be paid 31,400.00 USD". A draft can be cancelled. No money moved.

This step moves money. A new command, `payment.execute`, sends a drafted payment through the
company's **bank**. A bank is an outside system, so DSoR reaches it through a connector, as it
reaches the company's records since step 34. And a bank cannot undo a payment. Once the money has
left, no command of DSoR's brings it back. The specification calls such a command
**non-compensatable**.

So the bank's declaration matters more than any before it. It must say at least one of two things:

- **It refuses a repeat** (`downstream_idempotency`). DSoR sends a key with each payment. If the
  same key arrives twice, the bank answers with the first receipt and sends nothing more.
- **It answers a lookup** (`outcome_lookup`). DSoR can ask later: "did the payment with this key
  go through?"

The bank in this step is a fake, inside the program, with four switches: **good**, **slow**,
**broken**, and **silent**. It does both of the two things above, as real payment services do.
Stripe, for example, takes an `Idempotency-Key` with each request and lets a payment be looked up
afterwards.

## Why it matters

**A slow bank, and a payment sent twice.** user_123 sends PAY-901. The bank takes long to answer.
The caller gives up and sends again. If the bank cannot tell the second request from a new payment,
VENDOR-44 is paid 62,800.00 USD. The key stops this, but only if every attempt at PAY-901 carries
the *same* key. A caller's own key would not do: a caller that retries often makes a new one. So
DSoR derives the bank's key from the proposal, the record of this one attempt to send PAY-901.

**A silent bank, and a false "failed".** The bank takes the payment and never answers. If DSoR
said "failed", someone would send PAY-901 again, and the money would leave twice. If DSoR said
"sent", nobody would check. The truth is "we don't know", and step 04 already gave it a code:
`OUTCOME_UNKNOWN`, retried only after someone has found out what happened.

**A bank that can help with neither.** If the bank refused no repeat and answered no lookup, a
silent moment could never be cleared up. DSoR refuses to send a payment through such a bank at all.

**Common mistake:** treating a timeout like a refusal, "the bank did not answer, so nothing was
sent". A bank that says "I sent nothing" can be retried. A bank that says nothing cannot.

## The design, before any code

### How this step was made

The learner decided four of the six choices, one at a time, then said "assume all and build" for
the last two (2026-10-18). Choices 1 to 4 below are the learner's; D5 and D6 are Claude Code's,
taken as recommended. The code was written before its tests in this step, against the rule of red
first. To make up for it, each new test was then shown to fail against a break of the line it
guards ("Break it").

The circled numbers are lines of DSoR's checklist (§21). Line ④ checks whether the call may run
now: the brake, and since step 34 the connectors. Line ⑦ claims the idempotency key, line ⑧ makes
the proposal, and line ⑨ reads the bound records.

### What each rule says

- **DSOR-UNK-03a:** "A `NON_COMPENSATABLE` operation MUST be routed only to a connector that
  declares downstream idempotency or outcome lookup."
  ([§25.2](../../../specs/dsor/03-execution.md#252-unknown-outcomes))
- **DSOR-IDM-03:** "Where the connector declares downstream idempotency, DSoR MUST pass a key
  derived from its own idempotency key to the underlying system."
  ([§22](../../../specs/dsor/03-execution.md#22-idempotency))
- **DSOR-UNK-01b**, step 04's rule, used for real now: an unknown outcome is never reported as
  success, as failure, or with a retry class that allows a new attempt.

### Decisions

- **D1. The fake bank lives inside the program** (the learner's choice). It is a piece of code
  with a switch a test can turn: `bank.mode = "silent"`. How long DSoR waits for an answer is
  DSoR's setting, not the bank's: 200 ms in the program, 50 ms in the tests. *Downside:* no real
  network, so real timeouts and real HTTP errors are only imitated until the HTTP steps.
- **D2. The bank refuses a repeat and answers a lookup** (the learner's choice). What
  `payment.execute` needs of the bank comes from its contract: its own `connector_requirements`,
  `downstream_idempotency_or_outcome_lookup`, as §7's example asks, and its `non_compensatable`
  semantics, which DSOR-UNK-03a reads the same way. The release, `proposal.execute`, may run a
  `payment.execute`, so it needs the same of the bank. *Downside:* the lookup is declared and
  built, and nothing asks it until step 37.
- **D3. The bank's key comes from the proposal** (the learner's choice): a SHA-256 of the company
  and the proposal's id. DSOR-IDM-04 already makes the proposal's id the key of its execution, so
  every attempt at one proposal carries one bank key, whatever key the caller sent. The command's
  code never sees the key or the bank: it sends an order, DSoR adds the key and waits, and the
  code hears nothing back but success or a refusal, so no receipt with the key reaches it.
  *Downside:* the words of DSOR-IDM-03 say "derived from its own idempotency key". This step
  reads "its own" as the proposal's, the key of the execution (open question 148).
- **D4. Each company names its bank** (the learner's choice). `connectors.json` gives each company
  two connectors: `{ "records": "accounting", "bank": "fake-bank" }`. Each is checked against what
  its own role needs: the records against what reading and marking need, the bank against
  DSOR-UNK-03a. A company whose bank is out of service cannot send payments, and can still read
  its invoices. Which operations send money is a list in the code, as step 34's list of operations
  that read records is: no field of a contract says which system a side effect reaches. A command
  that cannot be undone and is not on that list stops start-up, so DSOR-UNK-03a always has a bank
  to ask. Only an operation on the list gets a bank at all; a release gets one when the request it
  runs is on the list. *Downside:* step 34's file shape changed, and its tests moved with it.
- **D5. A bad day** (Claude Code's, as recommended).
  - *Broken:* the bank says it sent nothing. The call hears `CONNECTOR_UNAVAILABLE`, safe to retry
    with the same key, and the claim is undone, as for any accident.
  - *Slow:* an answer within DSoR's wait is a success.
  - *Silent:* no answer within the wait. The call hears `OUTCOME_UNKNOWN`, retried only after
    reconciliation. The proposal ends `OUTCOME_UNKNOWN`, which is still in flight, so step 32's
    one attempt at a time refuses a second attempt. A replay gives back the same answer.
  - *Anything else* the bank does without saying whether it sent the money, such as an error of
    its own, or a refusal it makes up, is `OUTCOME_UNKNOWN` too. Only a bank that says "I sent
    nothing" is safe to retry.
  - *After the bank was asked*, the work ends `COMMITTED` or `OUTCOME_UNKNOWN`, never anything
    else. If the payment store fails after the bank has answered, the call is unknown, not an
    accident: an accident would undo the proposal and its key, and a retry would pay again.

  *Downside:* nothing holds the payment or asks the bank afterwards yet. That is step 37.
- **D6. The CFO rule stays on the draft** (Claude Code's, as recommended). `payment.create` is
  where the CFO approves, and a draft exists only once its rules allowed it. `payment.execute`
  needs only its own permission, `payment:execute`, which only the AP supervisor's role holds. No
  slip lists it, so no agent sends money in this step. *Downside:* the specification's own example
  puts the CFO rule on `payment.execute`. A company whose rules change between the draft and the
  sending has nothing that checks them again at the sending.
- **D7. How `payment.execute` works** (Claude Code's). Its input names the invoice, the payment,
  and the invoice's version, as `payment.create`'s does. Line ⑨ reads the invoice and its vendor,
  checks that the invoice is issued and the vendor approved, and holds the invoice for this one
  attempt (step 32). The code reads the payment, which on the database locks its row, checks that
  it pays that invoice and is still a draft, and that no other payment of that invoice is paid
  already: an invoice is paid once. Then it sends it, and only then marks it `paid`. A bank that
  says no, or nothing, leaves it a draft. Migration 031 allows the status `paid`. *Downside:* the
  bank is asked inside the claim's database transaction, which holds its locks for as long as DSoR
  waits. An invoice is paid in one payment: no part payments, which no step has yet.

### The story's numbers

| When | Who | Asks | The bank | DSoR answers |
|---|---|---|---|---|
| Tuesday | the agent | drafts INV-1008, 31,400.00 USD | | `PENDING_APPROVAL`, for the CFO |
| Tuesday | cfo_100, then the agent | approves it, releases it | | PAY-901, a draft |
| Tuesday | user_123 | sends PAY-901 | good | `COMMITTED`; PAY-901 paid; one transfer to VENDOR-44 |
| Tuesday | user_123 | sends PAY-902, of INV-1002 | silent | `OUTCOME_UNKNOWN`; PAY-902 still a draft; the money left |
| Tuesday | user_123 | sends PAY-902 again, with a new key | good | `CONFLICT`: the first attempt is in flight |
| Tuesday | user_123 | sends PAY-903, of INV-1009 | broken | `CONNECTOR_UNAVAILABLE`; nothing sent |
| Tuesday | user_123 | the same request, the same key | good | `COMMITTED`; one transfer |

### The tests, by claim

| Claim | Tests |
|---|---|
| C1. What cannot be undone goes only to a bank that refuses a repeat or answers a lookup; each connector is asked only for its own part | `test/bank.test.ts` |
| C2. On a good day, PAY-901 is paid through the fake bank | `test/bank.test.ts` |
| C3. The bank's key is the proposal's; a replay sends nothing again | `test/bank.test.ts` |
| C4. Slow is a success, broken a safe retry, silent unknown; on the database, a good day, a silent bank, and a cancel during a send | `test/bank.test.ts`, `test/bank.db.test.ts` |
| The review's findings, each with its test | `test/bank-review.test.ts` |
| C5. What payment.execute refuses before the bank is called | `test/bank.test.ts` |

## What changed since step 34

| File | What changed |
| --- | --- |
| `src/bank.ts` | **New.** The fake bank and its four switches; the bank's key; the one way DSoR calls a bank, and how it reads each answer (D1, D3, D5) |
| `contracts/payment.execute.json`, `inputs/PaymentExecuteRequest.schema.json`, `examples/payment.execute.json` | **New.** The command, its input, and its example for the cross-company suite (D7) |
| `src/operations.ts` | payment.execute's code (D7) |
| `src/connectors.ts`, `connectors.json` | The fake bank's declaration; each company names its records and its bank; what each operation needs of each (D2, D4) |
| `src/pipeline.ts` | The command's code gets the company's bank, for its proposal, and only when it sends money; after a send, only COMMITTED or OUTCOME_UNKNOWN (D3, D5) |
| `src/company.ts`, `src/payment.ts`, `src/postgres.ts`, `migrations/031_paid.sql` | A payment can be read, locked, and marked paid; an invoice's paid payments (D7) |
| `src/proposals.ts`, `src/bundle.ts` | A proposal can end OUTCOME_UNKNOWN, and its bundle says `outcome_unknown` (D5) |
| `roles.json` | `payment:execute`, for the AP supervisor (D6) |
| `src/registry.ts`, `src/main.ts` | The banks start-up checks; the story of this step |
| `test/bank.test.ts`, `test/bank.db.test.ts`, `test/bank-review.test.ts` | **New.** The claims C1 to C5, and the review's findings |
| The other tests | The new file shape; payment.execute in every pinned list (eighteen contracts, 207 attacks); the company's bank in the company's keys. Each says "Changed in step 35" |

Step 34's markers are gone, as the build skill (`.claude/skills/build-baby-step`) asks. A search
for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_34_connectors/src src
git diff --no-index ../mj_34_connectors/test test
```

## Run it

As in step 34, the step needs a local PostgreSQL 17 and a database of its own. This step adds one
migration, 031.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-18. After step 34's scenes, the program tells this step's story in a
world of its own, in memory:

```text
a fake bank, in memory, in a world of its own:
  the agent drafts INV-1008, 31,400.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  cfo_100 approves it: answered, apr_…
  the agent releases it: answered, PAY-901
  a good day; user_123 sends PAY-901: answered, PAY-901
    the bank sent TRF-1: 31400.00 USD to VENDOR-44 for PAY-901, key dsor_b856d5bc400…
  user_123 drafts INV-1002, 8,900.50 USD: answered, PAY-902
  a silent day; user_123 sends PAY-902: OUTCOME_UNKNOWN: payment "PAY-902": the bank did not answer within 200 ms, so it may or may not have been sent
    the bank sent TRF-2: 8900.50 USD to VENDOR-44 for PAY-902, key dsor_46b48f043eb…
  the bank is back; user_123 tries PAY-902 again with a new key: CONFLICT: invoice INV-1002 has an attempt in flight already: proposal dsor://org_456/proposal/prop_…, OUTCOME_UNKNOWN
  transfers the bank made: 2
  user_123 drafts INV-1009, 7,425.00 USD: answered, PAY-903
  a broken day; user_123 sends PAY-903: CONNECTOR_UNAVAILABLE: payment "PAY-903": the bank is down, and sent nothing
  the bank is back; the same request, the same key: answered, PAY-903
    the bank sent TRF-3: 7425.00 USD to VENDOR-44 for PAY-903, key dsor_eb0e75323a5…
  transfers the bank made: 3
  payments: PAY-901 paid, PAY-902 draft, PAY-903 paid
```

The key is printed short, and the ids of the approval and the proposal are cut. PAY-902's money left on the silent day, and DSoR does not know it: the
bank kept TRF-2, and DSoR's answer was OUTCOME_UNKNOWN. Finding out is step 37's.

## Break it

Each break ran on 2026-10-18 in a fresh copy of this folder outside the repository. A short script
told four scenes:

- **S1:** a bank that neither refuses a repeat nor answers a lookup, and DSoR starts.
- **S2:** a silent bank, then the same request with the same key.
- **S3:** a silent bank, then a new attempt with a new key.
- **S4:** whether the bank's key is the proposal's.

Unbroken:

```text
S1: connectors.json: the default bank connector is broken: connector "fake-bank" cannot serve as the bank: payment.execute needs downstream_idempotency or outcome_lookup
S2, silent, then the same request with the same key: OUTCOME_UNKNOWN, then OUTCOME_UNKNOWN; transfers: 1
S3, silent, then a new attempt with a new key: OUTCOME_UNKNOWN, then CONFLICT; transfers: 1
S4, the bank's key is the proposal's: true
```

| Break | What changed | The scenes | The tests that failed |
|---|---|---|---|
| **B1** | payment.execute asks nothing of the bank | S1: `DSoR started` | 2 |
| **B2** | The bank's key changes at every attempt | S4: `false` | 1 |
| **B3** | A silent bank counts as "sent nothing" | S2 and S3: `CONNECTOR_UNAVAILABLE, then COMMITTED; transfers: 2`. **The vendor is paid twice** | 2 |
| **B4** | An unknown proposal ends FAILED | S3: `OUTCOME_UNKNOWN, then COMMITTED; transfers: 2`. **Paid twice** | 2 |

B3 and B4 are the two ways to pay twice that this step closes: a timeout read as "nothing sent",
and an unknown read as "failed".

Then each fix of the review was undone in a copy, one at a time, and the full unit suite run:
the store failing after a send (F1), a second draft of one invoice (F2), a refusal the bank makes
up (F3), and a bank given to every command (F7). Each failed exactly the test written for it.

## Build it yourself with Claude Code

Claude Code built the step in these moves.

| # | Move | What was done |
|---|---|---|
| 1 | The problem | A payment is a draft; a bank cannot undo one; slow, silent, and a bank that can help with neither |
| 2 | Decide | Four choices, one at a time, by the learner; then "assume all and build" for D5 and D6 |
| 3 | The copy | Step 34 copied, its markers removed |
| 4 | Build | The bank, the connectors, the command, the pipeline's bank, the stores, migration 031. Code first, against the rule (see "How this step was made") |
| 5 | Tests | 19 unit tests and the database tests; every pinned list of the earlier steps moved with the new command |
| 6 | Break it | B1 to B4, run for real, in copies of the folder |
| 7 | Review | A reviewer who had not seen the conversation, with 35 small breaks and seven attacks of its own |
| 8 | Fix | F1 to F9, each with its test; each fix undone once in a copy, to see its test fail |

To start it in a new session:

```text
Build step 35 in learner mode from the design in
docs/baby_steps_tutorials/mj_35_a_fake_bank/README.md.
```

## Check yourself

1. The bank takes PAY-902 and never answers. What does user_123 hear, what state is the proposal
   in, and is PAY-902 paid?
2. user_123 tries PAY-902 again, with a new key. What happens, and why does the new key not get a
   new bank key?
3. The bank says "down, nothing sent". Why is that one safe to retry with the same key, when
   silence is not?
4. The bank sends PAY-901, and then the database connection drops before PAY-901 is marked paid.
   What does DSoR answer, and why not INTERNAL_ERROR?
5. PAY-901 and PAY-902 are two drafts of INV-1002. PAY-901 is sent. What happens to PAY-902?

<details>
<summary>Answers</summary>

1. `OUTCOME_UNKNOWN`, retried only after reconciliation. The proposal is `OUTCOME_UNKNOWN`, which
   is in flight. PAY-902 is still a draft in DSoR's records, though the bank sent it (D5).
2. `CONFLICT`: one attempt at a time over INV-1002, and the first is in flight (step 32). The
   new key never reaches the bank: the bank's key comes from the proposal, and a new proposal is
   not made (D3).
3. A bank that says it sent nothing has told DSoR the money did not leave. Silence tells nothing,
   and the money may have left (D5).
4. `OUTCOME_UNKNOWN`. Once the bank was asked, the work ends committed or unknown. An
   INTERNAL_ERROR would undo the proposal with the claim, and the retry would get a new proposal,
   a new key, and pay again (D5, F1).
5. Its send is refused with `CONFLICT`: INV-1002 is paid already, by PAY-901 (D7, F2).

</details>

## Think it through

### Found while building

- **`expected_version` is the invoice's.** The first code read it as the payment's version, and
  the two happened to match at version 1. Since step 21, for a command that binds an invoice, line
  ⑨ checks it against the invoice. A test of a payment sent twice found it: the second send heard
  STALE_STATE for the invoice. payment.execute now follows the rule.
- **The order of the send and the mark.** The first plan marked the payment paid before calling
  the bank, so a cancel would wait. On the database a failed send undoes the mark, but memory has
  no transaction, and the mark stayed. The payment is now read and locked first, sent, and marked
  last, so both stores behave the same.
- **A failure to mark it paid, after the money left,** was first an error, which undoes the claim.
  It is OUTCOME_UNKNOWN, so the attempt stays in flight.

### What the review found

A reviewer who had not seen the conversation attacked the step with seven scenarios of its own and
35 small breaks in a copy of the folder.

- **F1 (critical). A failure after the send was forgotten.** If the payment store failed after the
  bank answered, the call was an accident: the claim and the proposal were undone, and a retry made
  a new proposal, with a new key, and the bank sent again. Now, once the bank was asked, only
  COMMITTED or OUTCOME_UNKNOWN can end the work.
- **F2 (high). Two drafts of one invoice were both sent.** Sending a payment left the invoice as it
  was, so a second draft could be sent too. Now an invoice is paid once.
- **F3 (high). A refusal the bank made up was passed on.** A bank that sent and then threw
  CONNECTOR_UNAVAILABLE was retried, and paid twice. Only the fake's own "down, sent nothing" is
  safe now; anything else is unknown.
- **F4. A command that cannot be undone could go to no bank.** payment.create changed to
  non_compensatable went to the records, which refuse no repeat. It stops start-up now.
- **F5. A cancel during a send.** The branch for a payment that changed under the send had no
  test, in memory or on the database. Both have one.
- **F6. The code saw the key** in the receipt its send gave back. It gets nothing back now.
- **F7. Every command got a live bank.** Only an operation that sends money gets one now.
- **F8.** An unknown proposal's move named the bank for every cause. It names the real one.
- **F9.** A Company kept after its call could still send. A test shows it cannot.

The review's other breaks that left every test green each have a test now: a bank slower than the
wait, the key's formula, the vendor sent, a release of a prepared payment, the agent's exact
refusal, and a connector in the wrong role.

### Left open on purpose

- **Nothing is written before the bank is called** (step 36). If the program dies after the bank
  sent and before the claim commits, nothing remembers the attempt, and the next one pays again.
  The fix for F1 covers a failure the program sees, not a program that stops.
- **Nothing holds a payment whose outcome is unknown** (step 37). After OUTCOME_UNKNOWN, PAY-902
  can still be cancelled, and a new draft of INV-1002 can be made. Only payment.execute's one
  attempt at a time stands in the way of a second send.
- **Nobody asks the bank afterwards** (step 37). The lookup is built, and nothing calls it. The
  bank's reference, `TRF-2`, is not kept as evidence.
- **A replay gives back the answer of its time**, not what reconciliation learns later (step 37).
- **No rule runs again at the sending** (D6). The CFO's rule ran at the draft.
- **A release of a draft is refused while the bank is out of service**, though it sends nothing:
  line ④ cannot tell what a release will run before it loads it.
- **"Derived from its own idempotency key"** is read as the proposal's key, the key of the
  execution (open question 148).
- **Two database tests fail on a throwaway server**, as in step 34: one that accepts any password,
  and an owner that belongs to no other role. On the learner's own server both pass.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-UNK-03a | A command that cannot be undone goes only to a connector that refuses a repeat or answers a lookup | [§25.2](../../../specs/dsor/03-execution.md#252-unknown-outcomes) | [`test/bank.test.ts`](test/bank.test.ts), [`test/bank-review.test.ts`](test/bank-review.test.ts), [`test/bank.db.test.ts`](test/bank.db.test.ts) |
| DSOR-IDM-03 | DSoR gives such a connector a key derived from its own | [§22](../../../specs/dsor/03-execution.md#22-idempotency) | [`test/bank.test.ts`](test/bank.test.ts), [`test/bank-review.test.ts`](test/bank-review.test.ts) |
| DSOR-UNK-01b | Step 04's rule, used for real: an unknown outcome is never success, failure, or retry-safe | [§25.2](../../../specs/dsor/03-execution.md#252-unknown-outcomes) | [`test/bank.test.ts`](test/bank.test.ts), [`test/bank-review.test.ts`](test/bank-review.test.ts), [`test/bank.db.test.ts`](test/bank.db.test.ts) |
| DSOR-UNK-02 | A replay of an unknown outcome gives back its status, with no second attempt | [§25.2](../../../specs/dsor/03-execution.md#252-unknown-outcomes) | [`test/bank.test.ts`](test/bank.test.ts) |

**Next:** step 36, write it down before you act: the note DSoR writes before it calls the bank.
