# Step 38c · The list of alerts

**New in this step:** `alert.list`, DSoR's first query over its own store, shows each person the
unknown payments waiting for them: the AP supervisors every unsettled alert, and the named person
the ones escalated to them (DSOR-UNK-04b, DSOR-UNK-04c).

## In plain words

DSoR is a careful clerk between a company's people and AI workers and its real systems, its books
and its bank. When the bank never answers a payment, DSoR says the outcome is unknown. Since step
38b it raises an *alert* in the same moment, a record that says "this payment needs a person", and
near the hour it writes a more senior person's name on it.

Think of the order-tracking page, which is what a proposal is. Step 38b put a red flag on the page
and a manager's name beside it, but the page had no screen. `alert.list` is the screen. Each person
who asks sees the flags meant for them, and the payment and bill each one is about, so they can
call `payment.reconcile`. Nobody is phoned or emailed yet: that is step 40's outbox.

Every query until now read the company's records, through a connector. This one reads DSoR's own
records. It answers the way every query does: in pages, with a label saying how sensitive it is,
and a label saying how fresh it is and where it was read.

## Why it matters

user_123 sends PAY-901, 8,900.50 USD to VENDOR-44 for INV-1002, and the bank goes silent. A real run
on step 38b's code, on 2026-10-19:

```text
user_123 sends PAY-901: OUTCOME_UNKNOWN
59 minutes later, dsor-scheduler's sweep: 1 escalated to cfo_100
what DSoR keeps: {"state":"escalated","raised_at":"2026-10-06T15:05:00.000Z","escalated_to":"cfo_100","escalated_at":"2026-10-06T16:04:00.000Z"}
cfo_100 asks DSoR for its alerts: UNSUPPORTED_CAPABILITY
user_123 asks too:                UNSUPPORTED_CAPABILITY
```

The escalation is a column nobody can read. cfo_100 holds the alert and does not know it. The bill
stays held, and the money may have left.

## The design, before any code

### How this step was made

On 2026-10-19, after step 38b, the learner asked to build this step. The problem was shown with the
run above, and the learner decided four choices, each the recommended option (D1 to D4). Two
things are not choices, because the specification settles them: the list has a server-side
maximum page size (DSOR-QRY-01), and its answer states its freshness (DSOR-FRS-01a).

### What the rules say

- **DSOR-UNK-04b:** "Each `OUTCOME_UNKNOWN` occurrence MUST raise an alert within the bound of §44."
- **DSOR-UNK-04c:** "An occurrence unresolved after the bound of §44 MUST escalate to a human."
  ([§25.3](../../../specs/dsor/03-execution.md#253-reconciliation))
- And every query's rules: a maximum page size (DSOR-QRY-01,
  [§7.1](../../../specs/dsor/01-model.md#71-queries)), a classification label (DSOR-CLS-03), and a
  freshness label (DSOR-FRS-01a, DSOR-FRS-01b).

Steps 38 and 38b raised and escalated the alert. This step makes the person able to see it, so the
alert reaches someone and the escalation reaches the named human.

### The claims

| Claim | What it says |
|---|---|
| C1 | `alert.list` answers a person of the company's receivers role with every unsettled alert of the company: open and escalated |
| C2 | It answers the company's named person with the alerts escalated to them, and no others |
| C3 | Anyone else is refused: a person neither the file names, and an agent, even with a slip that lists `alert:read` |
| C4 | A closed alert is never listed |
| C5 | Each alert names its proposal, its state, when it was raised, and, once escalated, to whom and when, with the payment and the invoice the proposal sends |
| C6 | The list comes in pages of at most 10, whatever the caller asks for, with a cursor for the next; another company's alerts are never in it |
| C7 | The answer carries its labels: `internal`, and freshness `current`, read now from DSoR's own store |
| C8 | On the database, the same, through `dsor_runtime` and the company's rule |

### Decisions

- **D1. Whom `alerts.json` names** (the learner's choice). The contract's permission `alert:read`
  goes to the AP supervisor's and the CFO's roles. Then the file decides the rows: the receivers
  role sees every unsettled alert, the named person the ones escalated to them, and anyone else is
  refused. *Downside:* two checks, the permission and the file, to keep in step.
- **D2. No agent** (the learner's choice). The contract says no agent may call it, as
  `payment.reconcile`'s does. *Downside:* an agent cannot tell its person "you have alerts".
- **D3. Only unsettled alerts** (the learner's choice). Open and escalated. A closed alert drops
  off; its history stays in the proposal's moves and the records. *Downside:* no screen of past
  alerts.
- **D4. The alert and its payment** (the learner's choice). Each alert names the payment and the
  invoice, as addresses, read from its proposal: enough to call `payment.reconcile`. *Downside:* the
  amount and the vendor need `invoice.get`.
- **D5. In the order of their proposals' ids, with the last id as the cursor** (Claude Code's), as
  `invoice.list` pages. *Downside:* not the order they were raised in.
- **D6. The freshness label names DSoR's own store** (Claude Code's). Mode `current`, because it is
  read now and never kept; connector `dsor`, because DSoR's own store is not a company connector;
  observed at the time the read starts. *Downside:* `dsor` is this tutorial's name, not the
  specification's.
- **D7. Each alert is a row** (Claude Code's). It carries its company and an id, its proposal's, so
  the call's record names every alert it read, as `dsor://org_456/alert/prop_…`. *Downside:* the
  address names an alert by its proposal's id.

### The tests, by claim

| Claim | Tests |
|---|---|
| C1 to C7 | `test/alert-list.test.ts`, in memory |
| C8 | `test/alert-list.db.test.ts`, on the database |
