# Step 37 · Outcome unknown: hold the payment and its bill

**New in this step:** while nobody knows whether a payment's money left, DSoR holds the payment and
its invoice. Any other command that would change them hears `RESOURCE_HELD`: wait until someone has
found out (DSOR-UNK-03b).

## In plain words

DSoR is a careful clerk. It stands between the people and AI workers of a company and the company's
real systems: its books and its bank. Every request passes through DSoR, and DSoR checks it before
anything happens.

Sometimes DSoR asks the bank to send a payment and the bank never answers. Nobody knows whether the
money left. Since step 35, DSoR says exactly that: the payment's outcome is `OUTCOME_UNKNOWN`, and no
quick retry is invited.

Saying it is not enough. While the payment is unknown, the records it touches must not change: the
payment slip, and the bill (the invoice) it pays. This step puts a **hold** on them, a "do not
touch" sign that DSoR itself keeps. Any request that would change a held record is refused with
`RESOURCE_HELD`. Reading them still works. The sign comes down only when the payment is settled,
which is step 38's reconciliation.

A pending charge on a bank card works the same way: the amount is set aside until the charge
settles, and nobody can spend it or refund it in the meantime. Where the picture stops: a pending
charge holds money. DSoR's hold freezes records.

## Why it matters

user_123 sends PAY-901, 8,900.50 USD to VENDOR-44 for INV-1002. The bank takes the order and never
answers. DSoR says `OUTCOME_UNKNOWN`. The bank did send the money, as transfer TRF-1, but nobody
knows that yet.

Under step 36b, a real run on 2026-10-19 shows what can still happen:

```text
user_123 sends the same payment again, new key: CONFLICT
user_123 cancels that payment: COMMITTED PAY-901
user_123 drafts a NEW payment of INV-1002: COMMITTED PAY-902
user_123 sends the new payment: CONFLICT
  payments in the records: PAY-901 cancelled, PAY-902 draft
  transfers the bank made: 1
```

The books now say "PAY-901 cancelled, PAY-902 waiting". The bank says "TRF-1 sent". The books lie.
The next person to read them sees an unpaid bill and a fresh slip ready to go. Only "one attempt at
a time" stands between that slip and a second payment, and its answer, `CONFLICT`, tells the caller
never to try again, which is wrong if the bank turns out never to have received PAY-901.

**Common mistake:** believing that a system which *says* "unknown" also *protects* the unknown
thing. Saying and stopping are two rules. The cancel above went through because no rule linked
"PAY-901 is unknown" to "PAY-901 must not change".

## The design, before any code

### How this step was made

The learner studied step 37 from zero on 2026-10-19, as if they knew nothing of DSoR, then decided
seven choices one at a time (D1 to D7, each the recommended option). They chose to answer no
predictions after the first few, so the breaks below are not predicted.

### What the rule says

- **DSOR-UNK-03b:** "While a proposal is `OUTCOME_UNKNOWN`, DSoR MUST hold every resource named in
  the contract's `hold_on_unknown`; any other command that binds a held resource returns
  `RESOURCE_HELD`." ([§25.2](../../../specs/dsor/03-execution.md#252-unknown-outcomes))

A *proposal* is DSoR's record of one attempt at a command. A *resource* here is a record a command
works on, such as a payment or an invoice. A contract's *bind* list names the records DSoR reads
itself before it decides, and `hold_on_unknown` names which of them to hold.

The rules of step 35 still hold and are already met: an unknown is reported as unknown
(DSOR-UNK-01a, DSOR-UNK-01b), and a replay with the same key gives back that status without a
second attempt (DSOR-UNK-02).

### The claims

| Claim | What it says |
|---|---|
| C1 | Before a payment is sent, DSoR holds the records its contract's `hold_on_unknown` lists, the payment and its invoice, in the transaction of step 36's note. The holds count while the proposal is `EXECUTING` or `OUTCOME_UNKNOWN`, so they stand after a silent bank, a lost connection, and a crash |
| C2 | A command that binds a held record hears `RESOURCE_HELD`, retried only after reconciliation, before any work: a cancel of PAY-901, a new draft of INV-1002, PAY-901 sent again with a new key, a cancel during the send, a release of an older proposal of INV-1002. (`invoice.issue` binds the invoice too, and would be held, but this tutorial has not built it: it answers `UNSUPPORTED_CAPABILITY` first) |
| C3 | The hold touches nothing else: a read of INV-1002, a payment of another bill, cfo_100's approval, and the same-key replay of PAY-901, which still answers `OUTCOME_UNKNOWN` |
| C4 | A hold ends with its payment: once the proposal is no longer `OUTCOME_UNKNOWN`, the records are free |
| C5 | `payment.execute` and `payment.cancel` bind their payment and its invoice, and start-up refuses a `hold_on_unknown` that names something the contract does not bind |

### Decisions

- **D1. A table of its own** (the learner's choice). A new table, `dsor.holds`, keeps one row for
  each held record: the record, the proposal that holds it, and when. The project's own list of
  DSoR's records already names holds. *Downside:* placing a hold must happen in the same
  transaction as the move to `OUTCOME_UNKNOWN`, or the two drift apart.
- **D2. The contract names what a command touches** (the learner's choice). `payment.execute` and
  `payment.cancel` bind their payment, and `payment.cancel` binds the invoice DSoR finds on that
  payment, never one the caller names. Line ⑨, where DSoR reads what a contract binds, learns to
  read a payment. *Downside:* a bigger change to line ⑨, and the version a caller sends must keep
  its meaning: the payment's for a cancel, the invoice's for a send.
- **D3. The hold speaks first** (the learner's choice). DSoR checks holds before "one attempt at a
  time", so anything that touches a bill waiting on an unknown payment hears `RESOURCE_HELD`, not
  `CONFLICT`. `CONFLICT` keeps its meaning: another attempt is running right now. *Downside:* earlier
  tests that expect `CONFLICT` after a silent bank change, each marked "Changed in step 37".
- **D4. At the release, not the approval** (the learner's choice). cfo_100 may approve an older
  waiting proposal of a held bill. Its release hears `RESOURCE_HELD`, and the proposal stays
  approved and waits, so it can run after reconciliation. *Downside:* an approval may expire while
  the bill is held.
- **D5. Reads stay as they are** (the learner's choice). `invoice.get` answers as before. The hold
  shows only when someone tries to change a held record. *Downside:* a reader sees "not paid" for a
  bill that may have been paid.
- **D6. Every way in places the hold, so it is placed before the bank** (the learner's choice,
  refined by the learner before the build). A payment can become unknown three ways: a silent bank,
  a failure after step 36's note, and a crash the start-up sweep finds. In the second, the proposal
  stays `EXECUTING` with an open note until the next start-up, so a hold placed only at
  `OUTCOME_UNKNOWN` would leave a gap. So the holds are written with step 36's note, in the same
  transaction, before the bank is asked: every way in finds them already there. *Downside:* a cancel
  that arrives during a normal send behaves differently in the two stores. In memory, with no
  locks, it hears `RESOURCE_HELD`. On the database, line ⑨ reads the payment under its row lock, so
  the cancel waits for the send, and by then the payment is `COMMITTED` and the hold no longer
  counts: it hears `STALE_STATE`, as in step 36b. Both refuse the cancel; only the words differ.
- **D7. A hold ends with its payment; finding out is step 38** (the learner's choice). A hold counts
  only while its proposal is still `EXECUTING` or `OUTCOME_UNKNOWN` (refined with D6), so settling
  the payment, `COMMITTED` or `FAILED`, frees the records.
  Step 38 also records when. A same-key retry keeps answering `OUTCOME_UNKNOWN`: re-sending with
  the same key, or looking the payment up, is step 38's. *Downside:* each check reads the proposal's
  state as well as the hold.

### The tests, by claim

| Claim | Tests (written first; 10 of 17 red on an empty store of holds) |
|---|---|
| C1 | `test/holds.test.ts`: a silent bank places two holds, PAY-901 and INV-1002. `test/holds.db.test.ts`: the same in `dsor.holds`, and after the start-up sweep |
| C2 | `test/holds.test.ts` and `test/holds.db.test.ts`: each refused request, with its answer |
| C3 | `test/holds.test.ts`: each request the hold leaves alone |
| C4 | `test/holds.test.ts`, `test/holds.db.test.ts`: a settled proposal frees its records |
| C5 | `test/holds.test.ts`: the contracts, and start-up refusing a bad `hold_on_unknown` |

### The breaks

The learner chose not to predict. Each break ran on 2026-10-19 in a fresh copy of this folder, with
a fresh database, against `test/holds.test.ts`, `test/bank.test.ts`, `test/bank-review.test.ts`,
and `test/holds.db.test.ts`.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | No hold is placed before the bank is asked | 15 | 4 |
| **B2** | The hold is checked after "one attempt at a time", so a second send hears `CONFLICT` | 6 | 1 |
| **B3** | `payment.cancel` binds nothing again | 5 | 2 |
| **B4** | A hold outlives its payment: `COMMITTED` and `FAILED` proposals still hold | 6 | 4 |
| **B5** | A hold counts only at `OUTCOME_UNKNOWN`, not while `EXECUTING` | 2 | 1: the cancel after a crash |
| **B6** | A release is not checked against the holds | 2 | 0: no database test releases a held bill |
| **B7** | `RESOURCE_HELD` is kept with the claim, so the same key replays it after settlement | 1 | 1 |

B5 is the gap the learner's refinement of D6 closed: after a lost connection or a crash, the
proposal stays `EXECUTING` until the next start-up, and a hold that counted only at
`OUTCOME_UNKNOWN` let PAY-901 be cancelled in between.

## What changed since step 36b

| File | What changed |
| --- | --- |
| `src/holds.ts` | **New.** The store of holds, in memory; the look at line ⑨; the start-up check of `hold_on_unknown` (D1, D3, D7) |
| `migrations/033_holds.sql` | **New.** `dsor.holds`, behind the company's lock, added and never changed (D1) |
| `contracts/payment.execute.json`, `contracts/payment.cancel.json` | `payment.execute` binds its payment and holds it and its invoice; `payment.cancel` binds its payment and the invoice found on it (D2) |
| `src/bound.ts` | Line ⑨ reads a bound payment, and the invoice found on it, and gives back each bound record's address (D2) |
| `src/pipeline.ts` | The holds placed with step 36's note; line ⑨ looks at them first; a dry run looks too (D3, D6) |
| `src/claims.ts`, `src/release.ts` | `RESOURCE_HELD` keeps nothing, and a release that hears it waits (D3, D4) |
| `src/postgres.ts`, `store.json`, `src/registry.ts`, `src/approve.ts`, `src/main.ts` | The holds on the database; the map; the start-up check; the approval's look reads payments; the scene |
| `test/holds.test.ts`, `test/holds.db.test.ts` | **New.** The claims C1 to C5 |
| The other tests | `dsor.holds` in the lists of tables, privileges, and policies; a second attempt hears `RESOURCE_HELD`; a cancel during a send in memory. Each says "Changed in step 37" |

```bash
git diff --no-index ../mj_36b_the_record_and_the_work_together/src src
git diff --no-index ../mj_36b_the_record_and_the_work_together/test test
```

## Run it

As in step 36b: a local PostgreSQL 17 and a database of its own. This step adds migration 033.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-19, the bank's world in memory, shortened to the silent day:

```text
  a silent day; user_123 sends PAY-902: OUTCOME_UNKNOWN: payment "PAY-902": the bank did not answer within 200 ms, so it may or may not have been sent
    the bank sent TRF-2: 8900.50 USD to VENDOR-44 for PAY-902, key dsor_e6cb17617cc…
  the bank is back; user_123 tries PAY-902 again with a new key: RESOURCE_HELD: payment "PAY-902" is held while a payment's outcome is unknown; try again once it is reconciled
  user_123 tries to cancel PAY-902: RESOURCE_HELD: payment "PAY-902" is held while a payment's outcome is unknown; try again once it is reconciled
  user_123 tries a new draft of INV-1002: RESOURCE_HELD: invoice "INV-1002" is held while a payment's outcome is unknown; try again once it is reconciled
  transfers the bank made: 2
```

And the story of "Why it matters", run again on this step's code:

```text
user_123 sends the same payment again, new key: RESOURCE_HELD
user_123 cancels that payment: RESOURCE_HELD
user_123 drafts a NEW payment of INV-1002: RESOURCE_HELD
  payments in the records: PAY-901 draft
  transfers the bank made: 1
```

The books no longer lie: PAY-901 stays a draft until someone finds out what the bank did.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | Step 37 from zero, five parts, each settled by a real run |
| 2 | Decide | Seven choices, one at a time, by the learner; D6 and D7 refined before the build |
| 3 | The copy | Step 36b copied, its markers removed |
| 4 | Red | 17 unit tests; 10 red on an empty store of holds |
| 5 | Memory | The contracts, line ⑨'s payment read, the look, the placing, "not now" |
| 6 | Database | Migration 033, the store, the map, 5 database tests with a real `SIGKILL` |
| 7 | Break it | B1 to B7, in copies of the folder |
| 8 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 37 in learner mode from the design in
docs/baby_steps_tutorials/mj_37_outcome_unknown/README.md.
```

## Check yourself

1. PAY-901's bank went silent. user_123 cancels PAY-901. What does DSoR answer, and why did step
   36b let it through?
2. Why is INV-1002 held, and not only PAY-901?
3. A cancel arrives while the bank is still sending PAY-901, on the database. What does it hear,
   and why is that not `RESOURCE_HELD`?
4. cfo_100 approves another payment of a held bill. Is it refused? And its release?
5. A cancel heard `RESOURCE_HELD`. Reconciliation later settles PAY-901 `FAILED`. Can the same key
   cancel it now?

<details>
<summary>Answers</summary>

1. `RESOURCE_HELD`, retried after reconciliation. In step 36b no rule linked "PAY-901 is unknown" to
   "PAY-901 must not change", and `payment.cancel` named no record a hold could match (D2).
2. The danger is a second payment of the same bill, whatever slip it goes out on. The contract's
   `hold_on_unknown` names both (D2).
3. `STALE_STATE`. Line ⑨ reads the payment under its row lock, so the cancel waits for the send;
   when it gets the lock, the payment is `COMMITTED` and its hold no longer counts (D6, D7).
4. The approval goes through: it changes no held record. The release hears `RESOURCE_HELD`, and the
   proposal stays approved, waiting (D4).
5. Yes. `RESOURCE_HELD` keeps nothing with the claim, so the same key runs again once the hold no
   longer counts (D3).

</details>

## Think it through

### Found while building

- **`invoice.issue` is not built in this tutorial.** It binds the invoice, so it would be held, but
  it answers `UNSUPPORTED_CAPABILITY` first. No test can show it held.
- **`RESOURCE_HELD` had to mean "not now".** Kept with the claim, as a refusal of the request would
  be, it left a `DENIED` proposal and made the same key replay it for ever, though its own advice
  says to try again after reconciliation. And a release's check invalidated the waiting proposal.
  Now it keeps nothing, and a release that hears it waits (D3, D4).
- **Memory did not undo a proposal made inside line ⑧** when line ⑧ itself refused: the claim never
  learned the proposal's id. It remembers the proposal it creates now, as the database's rollback
  removes it.
- **On the database, a cancel during a send waits for the payment's lock** and hears `STALE_STATE`,
  not `RESOURCE_HELD` (D6's downside).
- **The order of a list.** The database lists tables by name, so `dsor.holds` comes before
  `dsor.idempotency` in the pinned lists, not after it.

### What the review found

(Filled in after the review.)

### Left open on purpose

- **Reconciliation** (step 38). Nothing settles an unknown payment, so its holds stand until a
  person or step 38 does. The tests settle by hand.
- **A draft at the same moment as a send.** A new draft of INV-1002 that passes line ⑨ before the
  send's holds commit is drafted. It cannot be sent: its send meets the hold.
- **The payment read is not in the decision bundle yet.** The payments store gives no freshness
  label, so line ⑨'s payment read is not noted as the invoice's is.
- **Hold rows are never removed.** A settled proposal's rows stay, and no longer count.
- **Two database tests fail on a throwaway server**, as in steps 34 to 36b: one that accepts any
  password, and an owner that belongs to no other role.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-UNK-03b | While a payment's outcome is unknown, what its contract lists is held, and a command that binds a held record hears `RESOURCE_HELD` | [§25.2](../../../specs/dsor/03-execution.md#252-unknown-outcomes) | [`test/holds.test.ts`](test/holds.test.ts), [`test/holds.db.test.ts`](test/holds.db.test.ts) |
| DSOR-UNK-02 | Still met: the same key gives back `OUTCOME_UNKNOWN`, not `RESOURCE_HELD` | [§25.2](../../../specs/dsor/03-execution.md#252-unknown-outcomes) | [`test/holds.test.ts`](test/holds.test.ts), [`test/holds.db.test.ts`](test/holds.db.test.ts) |

**Next:** step 38, reconciliation: a job asks the fake bank what really happened, using the key, and
the holds come down.
