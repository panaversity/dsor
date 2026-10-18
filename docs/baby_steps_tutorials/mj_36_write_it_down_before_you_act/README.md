# Step 36 · Write it down before you act

**New in this step:** the intent record, a note DSoR writes and commits before it asks a bank to
send money. A note with no outcome means nobody knows whether the money left, so DSoR treats it as
`OUTCOME_UNKNOWN`, at start-up and when the same request comes again (DSOR-EXE-03a, DSOR-EXE-03b,
DSOR-EXE-04b).

## In plain words

Since step 35, `payment.execute` sends a payment through the company's bank. Everything DSoR wrote
for that call, the claim of the key, the proposal, and the payment marked `paid`, sat in one
database transaction that committed only after the bank answered.

That is fine while the program keeps running. It is not fine when the program stops in the middle.
A transaction that never commits is rolled back. So if the program dies after the bank sent the
money, the database forgets the whole attempt. Nothing says that a payment was ever started.

This step adds one thing: a **note**, called an *intent record* in the specification. Before DSoR
asks the bank, it writes "proposal `prop_…` is about to send PAY-901 through `fake-bank`, for
user_123, with this key", and **commits** it, with the claim and the proposal. Only then does it ask
the bank. When the work ends, the note gets its outcome: `committed`, `failed`, or
`outcome_unknown`.

A note with no outcome is a sign that the program stopped while it paid. DSoR does not guess what
happened. It says `OUTCOME_UNKNOWN`, and it keeps the attempt in flight, so nothing sends the money
again.

## Why it matters

**A program that dies, and a vendor paid twice.** user_123 sends PAY-901, 31,400.00 USD to
VENDOR-44. DSoR asks the bank, and the bank sends the money. Then the server loses power, before
DSoR's transaction commits. Under step 35, the claim and the proposal roll back. user_123's retry
with the same key finds no claim, so it runs again, with a new proposal and so a new bank key. The
bank cannot tell it from a new payment. VENDOR-44 gets 62,800.00 USD.

With the note, the claim and the proposal were committed before the bank was asked. The retry finds
the claim and the note, and hears `OUTCOME_UNKNOWN`. A new key finds the proposal still in flight,
and hears `CONFLICT`. The bank is not asked again.

**Common mistake:** writing the note in the same transaction as the work. Then a crash rolls the
note back with everything else, and the note proves nothing. The note must be **committed** before
the side effect, not just written.

## The design, before any code

### How this step was made

The learner decided four choices, one at a time, and chose to split the step in two (2026-10-18):
this step is the note before a bank; step 36b commits the decision record together with the work for
commands that only change records (DSOR-EXE-04a). Choices D1, D2, D4, and D6 below are the learner's.
D3, D5, and D7 are Claude Code's.

The memory half was built red first. The database half, the checkpoint, the replay, and the sweep,
was written before its tests. To make up for it, each guard was then broken in a copy of the folder,
and a test failed for every break ("Break it").

The circled numbers are lines of DSoR's checklist (§21). Line ⑦ claims the idempotency key, line ⑧
makes the proposal, and line ⑨ reads the bound records.

### What each rule says

- **DSOR-EXE-03a:** "A durable intent record containing the proposal id, operation and version,
  payload hash, idempotency key, connector, and security context MUST be written before any side
  effect is attempted."
  ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline))
- **DSOR-EXE-03b:** "If the control-plane store cannot accept the decision or intent record, DSoR
  MUST NOT execute; the caller receives `EVIDENCE_STORE_UNAVAILABLE`."
- **DSOR-EXE-04b:** "An intent record with no final outcome MUST be treated as `OUTCOME_UNKNOWN`."

### Decisions

- **D1. A table of its own** (the learner's choice). Migration 032 makes `dsor.intents`: one note
  for each proposal, and one for each claim. It names the proposal, the operation and its version,
  the payload hash, the claim (its principal, its operation, and its key), the bank's connector, and
  who asked. A trigger lets only one column change after the note is written: its outcome, once,
  with the time. Row-level security keeps each company's notes apart, and `dsor_runtime` may not
  delete one. *Downside:* the evidence of one payment now sits in two tables, the proposal's history
  and the note.
- **D2. Only commands that reach a bank** (the learner's choice). The note is written inside the
  claim's transaction. Then a **checkpoint** commits the claim, the proposal at `EXECUTING`, and
  the note, and the work goes on in a new transaction. Then DSoR asks the bank. A command that
  changes only DSoR's records, such as `payment.create`, writes no note and keeps its one
  transaction. *Downside:* the commit lets go of the transaction's locks. One attempt at a time
  over the invoice still holds, because it is a unique index on proposals in flight (step 32). The
  payment's row lock, the brake's lock, and the slip's lock are taken again right after the
  checkpoint, and the payment must still be a draft. A cancel, a pull, or a tear-up that landed in
  the moment between ends the work `FAILED`, and the bank is never asked.
- **D3. A note ends with its proposal** (Claude Code's). The note's outcome is written in the same
  transaction as the proposal's last move: `committed` with `COMMITTED`, `failed` with `FAILED`,
  `outcome_unknown` with `OUTCOME_UNKNOWN`. So a note with no outcome always means "the work never
  reached its end".
- **D4. A start-up sweep, and every read of the claim** (the learner's choice).
  - *The same key again:* a claim with no answer that wrote a note answers `OUTCOME_UNKNOWN`, with
    its proposal. That holds while the first call is still waiting for the bank too: in flight is
    not known yet.
  - *The sweep:* before the program takes any call, after its login and its map are checked, it ends
    every open note `outcome_unknown`, moves its proposal from `EXECUTING` to `OUTCOME_UNKNOWN`, and
    gives the claim that answer. All three in one transaction for each note.

  *Downside:* "every read" is the replay. No caller can read a proposal directly yet, and a new key
  hears `CONFLICT` from one attempt at a time, not `OUTCOME_UNKNOWN`. The sweep cannot tell a note
  left by a crash from a note of a call that another program is running right now, so it must run
  while no other program serves the same database (open question 150).
- **D5. A bank that says "sent nothing", after the note** (Claude Code's). In step 35 the claim was
  undone, and the same key could try again. Now the claim was committed with the note, and nothing
  undoes it. So the claim keeps `CONNECTOR_UNAVAILABLE`, the proposal ends `FAILED`, and the note
  `failed`. The same key gives that answer back without asking the bank (DSOR-IDM-01c). A new key
  makes a new proposal and pays once. The answer's words say so. *Downside:* the code's retry class
  is still `safe_same_key`. A retry with the same key is safe, as promised, but it does not run again
  (open question 149).
- **D6. Kill a real process** (the learner's choice). `test/crash-while-paying.ts` sends a payment,
  and its bank takes the order and kills the process with `SIGKILL` before it answers. The test
  then reads what the dead process left in the database.
- **D7. What the note says** (Claude Code's). The operation and the payload hash come from the
  proposal as it is kept, so a release names the operation it runs, `payment.execute@1`. The
  principal, the operation, and the key are the claim's, so the note is found by the claim that wrote
  it: for a release, that is `proposal.execute`. The security context is the caller as line ③ found
  them. The connector is the company's bank, from `connectors.json`.

### The story's numbers

| When | Who | Asks | The bank | DSoR answers | The note |
|---|---|---|---|---|---|
| Tuesday | user_123 | sends PAY-901 | good | `COMMITTED`; one transfer | `committed` |
| Tuesday | user_123 | sends PAY-902, of INV-1002 | silent | `OUTCOME_UNKNOWN`; the money left | `outcome_unknown` |
| Tuesday | user_123 | sends PAY-903, of INV-1009 | broken | `CONNECTOR_UNAVAILABLE`; nothing sent | `failed` |
| Tuesday | user_123 | the same request, the same key | good | `CONNECTOR_UNAVAILABLE`, given back | none new |
| Tuesday | user_123 | the same request, a new key | good | `COMMITTED`; one transfer | `committed` |
| The tests | user_123 | sends a payment of INV-9001, 500.00 USD; the process is killed after the bank took it | took it | nothing: the process is dead | open |
| The tests | user_123 | the same key, after the crash | | `OUTCOME_UNKNOWN` | open |
| The tests | user_123 | a new key, after the crash | | `CONFLICT`: the attempt is in flight | open |
| The tests | start-up | the sweep | | the proposal `OUTCOME_UNKNOWN` | `outcome_unknown` |

### The tests, by claim

| Claim | Tests |
|---|---|
| C1. The note is written, and on the database committed, before the bank is asked; a command that reaches no bank writes none | `test/intents.test.ts`, `test/intents.db.test.ts` |
| C2. A note that cannot be written stops the payment: `EVIDENCE_STORE_UNAVAILABLE`, the bank never asked, nothing kept | `test/intents.test.ts`, `test/intents.db.test.ts` |
| C3. The note ends with its proposal; a bank that said "sent nothing" after the note is kept | `test/intents.test.ts`, `test/intents.db.test.ts`, `test/bank.test.ts` |
| C4. A note is evidence: only its outcome is written, once, and nothing removes it | `test/intents.db.test.ts`, `test/store-map.test.ts` |
| C5. A process killed while the bank holds the payment: the same key hears `OUTCOME_UNKNOWN`, a new key `CONFLICT` | `test/intents.db.test.ts` |
| C6. The sweep ends the note, the proposal, and the claim `OUTCOME_UNKNOWN` | `test/intents.db.test.ts` |
| The review's findings, each with its test | `test/intents-review.test.ts`, `test/intents.db.test.ts` |

## What changed since step 35

| File | What changed |
| --- | --- |
| `migrations/032_intents.sql` | **New.** `dsor.intents`, its trigger, its policy, and `dsor_runtime`'s privileges (D1) |
| `src/intents.ts` | **New.** The note, the store in memory, and the answer for a note with no outcome (D1, D4) |
| `src/pipeline.ts` | The bank's wrapper writes the note, checkpoints, takes the payment's lock again, then asks the bank; after the note, "sent nothing" is kept and anything else is unknown; the note ends with the proposal (D2, D3, D5, D7) |
| `src/claims.ts` | The stores of a claim's work gain the notes and the checkpoint; a refusal after the note is kept (D2, D5) |
| `src/postgres.ts` | The checkpoint on the database; the notes in `dsor.intents`; the replay of a claim with no answer; the sweep (D2, D4) |
| `src/main.ts` | The sweep at start-up; the scene's broken day and the notes (D4, D5) |
| `src/store.ts`, `store.json` | `dsor.intents` on the map, as a record that moves once (D1) |
| `test/intents.test.ts`, `test/intents.db.test.ts`, `test/intents-review.test.ts`, `test/crash-while-paying.ts`, `test/owner-intents.ts` | **New.** The claims C1 to C6, and the review's findings |
| The other tests | `dsor.intents` in the lists of tables, privileges, policies, and triggers; step 35's broken day. Each says "Changed in step 36" |

Step 35's markers are gone. A search for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_35_a_fake_bank/src src
git diff --no-index ../mj_35_a_fake_bank/test test
```

## Run it

As in step 35, the step needs a local PostgreSQL 17 and a database of its own. This step adds one
migration, 032.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-18. Start-up now sweeps first:

```text
start-up: 0 note(s) with no outcome, each now OUTCOME_UNKNOWN
```

Then, after the earlier scenes, the bank's world in memory:

```text
  a broken day; user_123 sends PAY-903: CONNECTOR_UNAVAILABLE: payment "PAY-903": the bank is down, and sent nothing; this idempotency_key keeps this answer, so send the payment again with a new key
  the bank is back; the same request, the same key: CONNECTOR_UNAVAILABLE: payment "PAY-903": the bank is down, and sent nothing; this idempotency_key keeps this answer, so send the payment again with a new key
  the same request with a new key: answered, PAY-903
    the bank sent TRF-3: 7425.00 USD to VENDOR-44 for PAY-903, key dsor_8729973189e…
  transfers the bank made: 3
  payments: PAY-901 paid, PAY-902 draft, PAY-903 paid
  the notes DSoR wrote before it asked the bank:
    prop_ab34ac67…: payment.execute@1 by user_123 through fake-bank, ended committed
    prop_7aef1bf3…: payment.execute@1 by user_123 through fake-bank, ended outcome_unknown
    prop_aff3f176…: payment.execute@1 by user_123 through fake-bank, ended failed
    prop_ea7e1f73…: payment.execute@1 by user_123 through fake-bank, ended committed
```

The key and the proposals' ids are printed short. Four sends, four notes. The drafts, the approval,
and the release of the draft wrote none: none of them reached the bank.

## Break it

Each break ran on 2026-10-18 in a fresh copy of this folder outside the repository, with a fresh
database. Each one removes one guard. The tests run were `test/intents.test.ts`, `test/bank.test.ts`,
`test/intents.db.test.ts`, and `test/bank.db.test.ts`.

| Break | What changed | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The checkpoint commits nothing | 0 | 5, the crash test among them |
| **B2** | A claim with no answer ignores its note | 0 | 2: the same key during the send, and after the crash |
| **B3** | The sweep leaves the proposal `EXECUTING` | 0 | 1: the crash test |
| **B4** | The payment's lock is not taken again after the checkpoint | 0 | 1: step 35's cancel during a send |
| **B5** | A note that cannot be written is an accident, not `EVIDENCE_STORE_UNAVAILABLE` | 1 | 1 |
| **B6** | "Sent nothing" after the note is not kept | 2 | 2 |
| **B7** | The note never ends | 4 | 5 |
| **B8** | The trigger lets a note end twice | 0 | 1 |
| **B9** | The note is written but not committed before the bank | 0 | 5 |

B1 and B9 are the mistake this step exists to prevent: in memory nothing changes, because memory has
no transaction to roll back. Only the database, and a real crash, show it.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | The problem | A program that dies after the bank sent forgets the attempt, and the retry pays again |
| 2 | Decide | Four choices and the split, by the learner; D3, D5, and D7 by Claude Code |
| 3 | The copy | Step 35 copied, its markers removed |
| 4 | Memory, red first | 8 unit tests, red; then the note, the end, and "sent nothing" kept |
| 5 | Database | The checkpoint, the lock taken again, the replay, the sweep; then 8 database tests, one with a real `SIGKILL` |
| 6 | Break it | B1 to B9, in copies of the folder |
| 7 | Review | A reviewer who had not seen the conversation, with attacks of its own |
| 8 | Fix | H1, M1, M2, H2, and M3; each fix with a test undone once in a copy, to see its test fail |

To start it in a new session:

```text
Build step 36 in learner mode from the design in
docs/baby_steps_tutorials/mj_36_write_it_down_before_you_act/README.md.
```

## Check yourself

1. The program dies after the bank took PAY-901 and before anything else. What is in the database
   afterwards: the claim, the proposal, the note? In which state?
2. user_123 sends the same request with the same key after that crash. What does DSoR answer, and
   does it ask the bank?
3. Why must the note be *committed* before the bank is asked, and not only written?
4. The bank says "down, nothing sent" after the note. Why does the same key now give that answer
   back, when in step 35 it ran again?
5. `payment.create` writes no note. Why is that safe?

<details>
<summary>Answers</summary>

1. The claim, with no answer; the proposal, `EXECUTING`; the note, with no outcome. The checkpoint
   committed all three before the bank was asked (D2).
2. `OUTCOME_UNKNOWN`, with the proposal, retried only after reconciliation. It does not ask the
   bank: a claim with no answer and a note is unknown (D4).
3. A note that is written but not committed is rolled back by the crash, with everything else. Then
   nothing remembers the attempt (B9).
4. The claim was committed with the note, and a committed claim gives back what it recorded
   (DSOR-IDM-01c). A new key pays (D5).
5. It changes only DSoR's own records, in one transaction. A crash rolls all of it back, and the
   retry with the same key runs again from nothing. No side effect is left outside (D2).

</details>

## Think it through

### Found while building

- **The commit lets go of the payment's lock.** Step 35's test of a cancel during a send showed
  it: after the checkpoint, the cancel no longer waited, and the payment was cancelled while the
  bank sent it. The lock is taken again right after the checkpoint, and the payment must still be a
  draft (break B4).
- **A release's note was found by the wrong claim.** A release's claim is `proposal.execute`'s, and
  its note names `payment.execute@1`. So the note keeps the claim's own operation too, and the
  replay finds a note by the whole scope of its claim.
- **The note fits an existing kind of table.** `dsor.intents` has a trigger, and DSoR's own tables
  may have one only if they move from state to state. A note moves once, from open to its outcome,
  so it is `control-moved`, as proposals and rules are.

### What the review found

A reviewer who had not seen the conversation attacked the step. It found no way to pay twice. It
found these:

- **H1 (high). An accident after the checkpoint was an `INTERNAL_ERROR`.** The bank had paid,
  then the note could not be ended, or the connection dropped, or the last COMMIT failed. The caller
  heard `INTERNAL_ERROR`, and the bundle said "not executed", though the money had left. Now, once
  the checkpoint has committed, any accident answers `OUTCOME_UNKNOWN`, the same answer the replay
  gives, in memory and on the database.
- **H2 (high). An unknown outcome gave its booking back.** Step 35's last move released the
  reservation for every refusal, `OUTCOME_UNKNOWN` too, so the day's limit got back money that may
  have left. The sweep kept it held, so a crash and a live failure left different state. Now an
  unknown keeps its booking. No caller reaches this today: only the AP supervisor may send, and a
  person has no daily limit. So it has no test of its own yet.
- **M1. A checkpoint COMMIT that failed was an `INTERNAL_ERROR`.** It is
  `EVIDENCE_STORE_UNAVAILABLE` now, and the bank is never asked (DSOR-EXE-03b).
- **M2. No test showed a release's note.** A release's note is now tested in memory, and with a
  real `SIGKILL` on the database: the note names `proposal.execute`'s claim, the same release key
  hears `OUTCOME_UNKNOWN`, and the sweep answers that claim.
- **M3. The brake's and the slip's locks were let go at the checkpoint**, so a pull or a tear-up no
  longer waited for the send. They are taken again with the payment's. Only an agent can be braked,
  and no agent may send, so this has no test of its own yet either.

Each fix with a test was undone once in a copy of the folder, and its test failed.

### Left open on purpose

- **The decision record is still written after the work** (step 36b). For a command that only
  changes records, the record and the work are not one transaction yet (DSOR-EXE-04a).
- **Nobody asks the bank afterwards** (step 37). An unknown payment stays unknown until someone
  looks. The tests' owner settles it by hand.
- **The sweep and a second program** (open question 150). The sweep must run while no other program
  serves the same database.
- **Same key after "sent nothing"** (open question 149). Safe, but it gives the failure back.
- **The sweep goes through the companies where a login works**, the companies in
  `ready-lifetimes.json`. A note of a company taken off that list stays open (the review's L1).
- **The note's security context is stamped with the program's clock**, as the proposal's requester
  is, not the database's (the review's L2).
- **A COMMIT that answers ROLLBACK without an error** is handled the same as one that fails, and
  has no test: PostgreSQL raised an error in every case the tests could make.
- **Two database tests fail on a throwaway server**, as in steps 34 and 35: one that accepts any
  password, and an owner that belongs to no other role. On the learner's own server both pass.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-EXE-03a | The note is written before any side effect | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | [`test/intents.test.ts`](test/intents.test.ts), [`test/intents.db.test.ts`](test/intents.db.test.ts), [`test/store-map.test.ts`](test/store-map.test.ts) |
| DSOR-EXE-03b | No note, no execution: `EVIDENCE_STORE_UNAVAILABLE` | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | [`test/intents.test.ts`](test/intents.test.ts), [`test/intents.db.test.ts`](test/intents.db.test.ts) |
| DSOR-EXE-04b | A note with no outcome is `OUTCOME_UNKNOWN` | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | [`test/intents.test.ts`](test/intents.test.ts), [`test/intents.db.test.ts`](test/intents.db.test.ts) |

**Next:** step 36b, the record and the work in one transaction, for commands that only change
records.
