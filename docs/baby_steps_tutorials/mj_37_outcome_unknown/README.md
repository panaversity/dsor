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
| C1 | When a payment's proposal turns `OUTCOME_UNKNOWN`, DSoR holds the records its contract's `hold_on_unknown` lists, the payment and its invoice, in the same transaction. This happens live and at the start-up sweep |
| C2 | A command that binds a held record hears `RESOURCE_HELD`, retried only after reconciliation, before any work: a cancel of PAY-901, a new draft of INV-1002, a send of that draft, a change to INV-1002, a release of an older proposal of INV-1002 |
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
- **D6. Every way in places the hold** (the learner's choice). A silent bank, a failure after the
  note of step 36, and the start-up sweep each move a proposal to `OUTCOME_UNKNOWN`, and each writes
  its holds in the same transaction. *Downside:* the sweep reads each proposal's contract to know
  what to hold.
- **D7. A hold ends with its payment; finding out is step 38** (the learner's choice). A hold counts
  only while its proposal is still `OUTCOME_UNKNOWN`, so settling the payment frees the records.
  Step 38 also records when. A same-key retry keeps answering `OUTCOME_UNKNOWN`: re-sending with
  the same key, or looking the payment up, is step 38's. *Downside:* each check reads the proposal's
  state as well as the hold.

### The tests, by claim

| Claim | Tests (to be written first, red) |
|---|---|
| C1 | `test/holds.test.ts`: a silent bank places two holds, PAY-901 and INV-1002. `test/holds.db.test.ts`: the same in `dsor.holds`, and after the start-up sweep |
| C2 | `test/holds.test.ts` and `test/holds.db.test.ts`: each refused request, with its answer |
| C3 | `test/holds.test.ts`: each request the hold leaves alone |
| C4 | `test/holds.test.ts`, `test/holds.db.test.ts`: a settled proposal frees its records |
| C5 | `test/holds.test.ts`: the contracts, and start-up refusing a bad `hold_on_unknown` |

### The breaks, planned

| Break | What it removes |
|---|---|
| B1 | No hold is placed when a payment turns unknown |
| B2 | The hold is checked after "one attempt at a time", so a second send hears `CONFLICT` |
| B3 | `payment.cancel` binds nothing again |
| B4 | A hold outlives its payment: the check ignores the proposal's state |
| B5 | The start-up sweep places no hold |
| B6 | A release is not checked against holds, so an older approved proposal of a held bill runs |
