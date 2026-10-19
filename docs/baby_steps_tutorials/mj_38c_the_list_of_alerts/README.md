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
| C9 | Start-up refuses a read of DSoR's store that has no contract, or that shares its name with other code |

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
| C9 | `test/alert-list.test.ts`: start-up refuses a read with no contract, or one that shares a name with other code |

### The breaks

The learner chose not to predict. Each break ran on 2026-10-19 in a fresh copy of this folder, with
a fresh database, against `test/alert-list.test.ts`, `test/cross-tenant.test.ts`, and
`test/alert-list.db.test.ts`.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | `alerts.json` is not asked: anyone with `alert:read` sees every unsettled alert | 3 | 1 |
| **B2** | The named person sees every unsettled alert, not only the escalated ones | 2 | 1 |
| **B3** | A closed alert is listed too | 1 | 1 |
| **B4** | The contract no longer refuses an agent | 0 | 0 |
| **B5** | The cursor is ignored, so the second page repeats the first | 1 | 0 |
| **B6** | The label says the list may be stale | 1 | 1 |
| **B7** | The look reads org_456's alerts, whatever company the call is in | 44 | 1 |

B7 is the dangerous one: org_789's people would see org_456's unknown payments. The cross-company
suite caught it many times over, because it now plants an alert in each company. B4 passes every
test, and that is expected: an agent holds no role and is never the named person, so the file
check refuses every agent before the guard is needed. The guard is a second wall, the same one
step 38's `payment.reconcile` has, and that step tests it alone.

## What changed since step 38b

| File | What changed |
| --- | --- |
| `src/alert-list.ts` | **New.** DSoR's own read (`OwnRead`), its look bound to one company, `alert.list`, and the start-up check of own reads (D1 to D7) |
| `contracts/alert.list.json`, `inputs/AlertListRequest.schema.json`, `examples/alert.list.json` | **New.** The query, its input, and its example |
| `src/registry.ts`, `src/pipeline.ts` | The registry keeps DSoR's own reads; the pipeline runs one at line ⑨ with the look |
| `roles.json`, `classifications.json` | `alert:read` for the AP supervisor and the CFO; the page's and each alert's labels |
| `src/main.ts` | The scene: each person lists their alerts |
| `test/alert-list.test.ts`, `test/alert-list.db.test.ts` | **New.** The claims C1 to C9 |
| `test/cross-tenant.ts` | The suite plants an unsettled alert in each company, and settles it after |
| The other tests | Twenty-one contracts, the roles, the labels, the lists of every operation. Each says "Changed in step 38c" |

```bash
git diff --no-index ../mj_38b_alert_and_escalate/src src
git diff --no-index ../mj_38b_alert_and_escalate/test test
```

## Run it

As in step 38b: a local PostgreSQL 17 and a database of its own. No new migration.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-19, the silent day in the bank's world, shortened:

```text
  PAY-902's alert: escalated, to cfo_100
  user_123 lists its alerts: 1: PAY-902 escalated
  cfo_100 lists its alerts: 1: PAY-902 escalated
  the agent lists alerts: AUTHORIZATION_DENIED: "alert.list" is never for an agent, and accounts-payable-fte is one
  dsor-scheduler reconciles PAY-902: COMMITTED, the bank sent TRF-2: 8900.50 USD to VENDOR-44
  PAY-902's alert: closed, COMMITTED
  user_123 lists its alerts again: 0: none
```

In step 38b, cfo_100 held the alert and could not see it.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real run on step 38b's code |
| 2 | Decide | Four choices by the learner; three details by Claude Code |
| 3 | The copy | Step 38b copied, its markers removed |
| 4 | Red | 11 unit tests and 1 database test, all red |
| 5 | Code | DSoR's own read, `alert.list`, the start-up check |
| 6 | Earlier tests | The lists of every operation; the suite's planted alerts |
| 7 | Break it | B1 to B7, in copies of the folder |
| 8 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 38c in learner mode from the design in
docs/baby_steps_tutorials/mj_38c_the_list_of_alerts/README.md.
```

## Check yourself

1. PAY-901's alert is open, not yet escalated. Who sees it in `alert.list`: user_123, cfo_100,
   admin_100, the agent?
2. Why is the list's freshness `current`, and why does it name `dsor` as its connector?
3. PAY-901 is reconciled `COMMITTED`. Where can someone still see that it once had an alert?
4. Why did the cross-company suite need to plant an alert before it could check `alert.list`?

<details>
<summary>Answers</summary>

1. Only user_123, of the receivers role. cfo_100 sees an alert only once it is escalated to them;
   admin_100 is not named in `alerts.json`; the agent is refused by the contract and by the file
   (C1 to C3).
2. It is read in the call, never kept, so it is as fresh as it can be (DSOR-FRS-01b forbids
   `current` only for a cached value). It names `dsor` because DSoR's own store is not one of the
   company's connectors: this tutorial's name (D6).
3. In the proposal's moves, which name the move to `OUTCOME_UNKNOWN` and the reconcile, and in the
   records. The list shows only alerts that still need a person (D3).
4. An empty page proves nothing about which company's rows a list returns. The suite counts a list
   that answers no rows as a finding, so it plants one unsettled alert in each company, as the
   story's invoices are there for `invoice.list`.

</details>

## Think it through

### Found while building

- **DSoR refused own work for a query.** Its start-up check said "DSoR's own work changes DSoR's
  store, so it is a command". A read is a new kind, `OwnRead`, with its own check: it must have a
  contract, share no name with other code, and be a query.
- **A row is named by its kind.** The record named each alert `dsor://org_456/listedalert/…` until
  the kind was called `Alert`.
- **A registry of a few contracts.** Tests build registries from one or two contracts; the shipped
  reads are given only for the contracts a registry has. Reads a caller names are checked in full.
- **The cross-company suite counts an empty list as a finding.** It now plants an unsettled,
  escalated alert in each company through the registry's own proposal store, and settles it after.

### What the review found

(Filled in after the review.)

### Left open on purpose

- **Nobody is told.** A person sees an alert only by asking. Delivery by email or a pager is step
  40's outbox.
- **No acknowledgement.** Reading an alert does not mark it seen, so two AP supervisors may both
  call `payment.reconcile`; the second hears `CONFLICT`.
- **No history screen** (D3). Settled alerts are found in the proposals' moves and the records.
- **Two database tests fail on a throwaway server**, as in steps 34 to 38b.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-UNK-04b | Each unknown outcome raises an alert, which now reaches the receivers | [§25.3](../../../specs/dsor/03-execution.md#253-reconciliation) | [`test/alert-list.test.ts`](test/alert-list.test.ts), [`test/alert-list.db.test.ts`](test/alert-list.db.test.ts) |
| DSOR-UNK-04c | One still unresolved goes to a human, who can now see it | [§25.3](../../../specs/dsor/03-execution.md#253-reconciliation) | [`test/alert-list.test.ts`](test/alert-list.test.ts), [`test/alert-list.db.test.ts`](test/alert-list.db.test.ts) |
| DSOR-QRY-01 | Every query has a server-side maximum page | [§7.1](../../../specs/dsor/01-model.md#71-queries) | [`test/alert-list.test.ts`](test/alert-list.test.ts) |
| DSOR-FRS-01a | Every query result states its freshness | [§27](../../../specs/dsor/03-execution.md#27-freshness-and-consistency) | [`test/alert-list.test.ts`](test/alert-list.test.ts), [`test/alert-list.db.test.ts`](test/alert-list.db.test.ts) |

**Next:** step 39, a log nobody can quietly edit.
