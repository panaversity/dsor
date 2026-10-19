# Step 38b · Alert at once, escalate after an hour

**New in this step:** a payment whose outcome is unknown raises an alert in the same moment, and an
alert still open after an hour is escalated to a named person (DSOR-UNK-04b, DSOR-UNK-04c).

## In plain words

DSoR is a careful clerk between a company's people and AI workers and its real systems, its books
and its bank. When DSoR asks the bank to send a payment and the bank never answers, nobody knows
whether the money left. DSoR says so, `OUTCOME_UNKNOWN`. Since step 37 it holds the payment and its
bill, and since step 38 `payment.reconcile` can ask the bank what happened and settle it.

But only if someone calls it. Until this step, nobody is told that a payment went unknown. An
*alert* is DSoR's note "this payment needs a person", raised the moment the payment goes unknown.
To *escalate* is to hand the note to a named, more senior person when nobody has settled it in
time. The specification gives the times in [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds):
an alert within one minute, and a person after one hour at most.

Think of a parcel the courier's scanner shows as "in transit" and then loses. A good courier does
not wait for you to phone. Its own desk sees the parcel flagged at once. If the desk has not sorted
it out by the end of the day, a supervisor gets it, by name.

## Why it matters

user_123 sends PAY-901, 8,900.50 USD to VENDOR-44 for INV-1002. The bank takes it and goes silent.
A real run on step 38's code, on 2026-10-19:

```text
14:30  user_123 sends PAY-901: OUTCOME_UNKNOWN
       what DSoR keeps: 2 decision records; the last says payment.execute@1 ALLOW
16:30  two hours later, the proposal is still OUTCOME_UNKNOWN; the bill stays held
```

Step 38's code has no alert, no notice, and no list of unknown payments: a search of its `src/`
finds none. `payment.reconcile` waits for a caller that nobody tells to call. INV-1002 stays held,
the money may have left, and VENDOR-44 phones a company that does not know there is a question.

**Common mistake:** raising the alert only where the bank goes silent. A payment can go unknown in
three ways: the bank's silence, a failure after the bank was asked, and the start-up sweep after a
crash (step 36). The crash is the case where no person was watching at all.

## The design, before any code

### How this step was made

On 2026-10-19 the learner asked to build the step after step 38. The problem was shown with the run
above, and the learner decided seven choices, each the recommended option. Then one more came up:
a list of open alerts needs DSoR's first query over its own store, which is a second idea. The
learner split it into step 38c (D0).

### What the rules say

- **DSOR-UNK-04b:** "Each `OUTCOME_UNKNOWN` occurrence MUST raise an alert within the bound of §44."
- **DSOR-UNK-04c:** "An occurrence unresolved after the bound of §44 MUST escalate to a human."
  ([§25.3](../../../specs/dsor/03-execution.md#253-reconciliation); the bounds are one minute and
  one hour)

The specification does not say what an alert is, who receives it, or who the human is. Those are
this tutorial's decisions, below.

### The claims

| Claim | What it says |
|---|---|
| C1 | A proposal's move to `OUTCOME_UNKNOWN` raises one open alert for it, in the same transaction, at the move's time. No other move raises one |
| C2 | Every way into `OUTCOME_UNKNOWN` raises it: the bank's silence, a failure after the bank was asked, and the start-up sweep after a real `SIGKILL` |
| C3 | A move out of `OUTCOME_UNKNOWN`, to `COMMITTED` or `FAILED`, closes the alert in the same transaction, naming the outcome, open or escalated |
| C4 | `alert.escalate_due` escalates each of the company's open alerts older than its escalation bound to the company's named person, once. A younger alert, a closed one, and another company's are not touched |
| C5 | Only DSoR's own scheduled login may call `alert.escalate_due`. An agent and a person are refused |
| C6 | Start-up refuses an `alerts.json` that leaves out a company where a login works, names a role that is not in the role table or that no person of the company holds, names someone who is not a person of the company, or gives a bound that is not a duration or is over §44's ceiling |
| C7 | On the database, an alert is never removed; the only changes are open to escalated and to closed; each company sees only its own |

### Decisions

- **D0. Split: the list of alerts is step 38c's** (the learner's choice). This step raises,
  escalates, and closes alerts. Step 38c adds `alert.list`, DSoR's first query over its own store.
  *Downside:* until 38c, a person sees alerts only in the program's scene and in the tests, as step
  28b's notices to a rule's owner.
- **D1. An alert is a row, written with the move** (the learner's choice). `dsor.alerts`, written in
  the transaction that moves the proposal to `OUTCOME_UNKNOWN`. It cannot be lost, and it is raised
  in no time at all. *Downside:* delivering it by email or a pager is step 40's outbox.
- **D2. The receivers are a role named for each company** (the learner's choice). `alerts.json`
  names it: org_456's `ap_supervisor`, user_123. *Downside:* one more file to keep in step. The
  row does not copy the role: step 38c's list reads it from the file (Claude Code's detail).
- **D3. Escalation is a sweep run by `dsor-scheduler`** (the learner's choice). `alert.escalate_due`
  is DSoR's own command, as step 25c's expiry sweep is: it escalates every open alert past the
  bound, once, and leaves its decision record. *Downside:* nothing runs it on a timer in this
  tutorial, the same as the expiry sweep.
- **D4. The human is a named person, checked at start-up** (the learner's choice). org_456's is
  cfo_100. Start-up refuses a name that is not a person of that company. *Downside:* one person; if
  they leave, start-up stops until the file changes.
- **D5. Every way in raises it, at the move** (the learner's choice). The alert is written by the
  proposal store's move itself, which every path into `OUTCOME_UNKNOWN` uses. *Downside:* the move
  gets one more job.
- **D6. The alert closes with the settlement** (the learner's choice). The move out of
  `OUTCOME_UNKNOWN` closes it, in the same transaction, so `payment.reconcile` needs no change of
  its own. A closed alert is never escalated. *Downside:* the alert row changes, so it is not
  append-only like the holds.
- **D7. The two bounds are declared and checked at start-up** (the learner's choice). `alerts.json`
  gives `alert_within` and `escalate_after` for each company, and start-up refuses either one over
  §44's ceiling, one minute and one hour. *Downside:* one more check at start-up.

### The tests, by claim

| Claim | Tests |
|---|---|
| C1 to C5 | `test/alerts.test.ts`, in memory |
| C2, C3, C4, C7 | `test/alerts.db.test.ts`, on the database, with a real `SIGKILL` |
| C6 | `test/alerts-file.test.ts` |

### The breaks

The learner chose not to predict. Each break ran on 2026-10-19 in a fresh copy of this folder, with
a fresh database, against `test/alerts.test.ts`, `test/alerts-file.test.ts`, and
`test/alerts.db.test.ts`.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The move to `OUTCOME_UNKNOWN` raises no alert | 15 | 4 |
| **B2** | The settlement does not close the alert | 4 | 1 |
| **B3** | The sweep escalates every open alert, at once, whatever its age | 1 | 1 |
| **B4** | The sweep escalates a closed alert too | 2 | 1 |
| **B5** | The contract no longer says only a system login may call the sweep | 1 | not run |
| **B6** | Start-up takes an agent or a system login as the person to escalate to | 2 | not run |
| **B7** | The trigger lets any change through | 0 | 1 |

B1 is the dangerous one: a payment goes unknown and nobody is ever told, which is the failure this
step exists to stop. B5 first passed every test. No person's role holds `alert:escalate`, and an
agent's slip needs a signer who holds it, so the permission check refused everyone before the
system-only guard was reached. A test with the permission added to the AP supervisor's role now
shows the guard working alone. B7 is caught only on the database, because the trigger is the
database's.

## What changed since step 38

| File | What changed |
| --- | --- |
| `alerts.json`, `src/alerts.ts` | **New.** Each company's receivers, person, and bounds, checked at start-up (D2, D4, D7) |
| `src/proposals.ts`, `src/postgres.ts`, `migrations/034_alerts.sql` | The proposal store's move raises and closes the alert; `dsor.alerts` and its trigger (D1, D5, D6) |
| `src/escalation.ts`, `contracts/alert.escalate_due.json`, `inputs/AlertEscalateDueRequest.schema.json`, `examples/alert.escalate_due.json` | **New.** The escalation sweep (D3) |
| `src/registry.ts`, `src/revocation.ts`, `src/pipeline.ts` | Start-up checks the file; DSoR's own work gets the company's alerts |
| `roles.json`, `classifications.json`, `store.json` | `alert:escalate` for the scheduler; the sweep's answer's labels; the store map names `dsor.alerts` |
| `src/main.ts` | The scene: PAY-902's alert raised, escalated, closed |
| `test/alerts.test.ts`, `test/alerts-file.test.ts`, `test/alerts.db.test.ts`, `test/owner-alerts.ts` | **New.** The claims C1 to C7 |
| The other tests | Twenty contracts, 225 attacks, the roles, the labels, the store map. Each says "Changed in step 38b" |

```bash
git diff --no-index ../mj_38_reconciliation/src src
git diff --no-index ../mj_38_reconciliation/test test
```

## Run it

As in step 38: a local PostgreSQL 17 and a database of its own. Migration 034 is new.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-19, the silent day in the bank's world, shortened:

```text
  a silent day; user_123 sends PAY-902: OUTCOME_UNKNOWN: payment "PAY-902": the bank did not answer within 200 ms, so it may or may not have been sent
  user_123 tries to cancel PAY-902: RESOURCE_HELD: payment "PAY-902" is held while a payment's outcome is unknown; try again once it is reconciled
  PAY-902's alert: open, raised 2026-10-06T15:05:00.000Z, for ap_supervisor
  dsor-scheduler's escalation sweep, at once: 0 escalated to cfo_100
  PT1H later, the sweep again: 1 escalated to cfo_100
  PAY-902's alert: escalated, to cfo_100
  dsor-scheduler reconciles PAY-902: COMMITTED, the bank sent TRF-2: 8900.50 USD to VENDOR-44
  PAY-902's alert: closed, COMMITTED
```

In step 38 the same run went from `RESOURCE_HELD` to the reconcile, and nobody was told in between.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real run on step 38's code |
| 2 | Decide | Seven choices by the learner, and the split into 38c |
| 3 | The copy | Step 38 copied, its markers removed |
| 4 | Red | 15 unit tests and the start-up check's, all red |
| 5 | Memory and database | The move's alert, the file, the sweep, migration 034 |
| 6 | Earlier tests | The lists and counts that name every operation, and the store map |
| 7 | Break it | B1 to B7, in copies of the folder |
| 8 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 38b in learner mode from the design in
docs/baby_steps_tutorials/mj_38b_alert_and_escalate/README.md.
```

## Check yourself

1. PAY-901 goes unknown after a crash, and the start-up sweep moves it to `OUTCOME_UNKNOWN`. Is an
   alert raised? Why?
2. Why is the alert written by the proposal's move, and not by `payment.execute` where the bank
   goes silent?
3. The bank answers `payment.reconcile` 40 minutes after PAY-901 went unknown. What happens to the
   alert, and does cfo_100 ever hear of it?
4. Someone writes `"escalate_to": "accounts-payable-fte"` in `alerts.json`. What happens?
5. Two sweeps run at once, an hour after PAY-901 went unknown. How many times is its alert escalated?

<details>
<summary>Answers</summary>

1. Yes. Every way into `OUTCOME_UNKNOWN` goes through the proposal store's move, and the move raises
   the alert in its own transaction (C2, D5). The database test proves it with a real `SIGKILL`.
2. A payment goes unknown in three ways, and the crash is one where `payment.execute` never gets to
   its next line. The move is the one place all three pass (D5).
3. The reconcile's move closes it, naming `COMMITTED`, in the same transaction (C3). A closed alert
   is never escalated, so cfo_100 is not told (C4).
4. DSoR does not start: "is not a person of org_456". An agent is never the human DSOR-UNK-04c asks
   for (C6, D4).
5. Once. The database's escalation is one statement that changes only an open alert; the second
   sweep waits for the first's row lock, then finds it escalated (C4).

</details>

## Think it through

### Found while building

- **A list in an answer must hold records of a named kind.** The sweep first answered a list of
  addresses, and the masking check refused it as `INTERNAL_ERROR`. Each escalated alert is now a
  small record, `{ proposal, raised_at }`, with its labels in `classifications.json`.
- **A column the database fills must not also be one DSoR moves.** `state` had a default and an
  `UPDATE` grant, and the store map's check refused that. The trigger now writes `open` on the
  insert, and the column has no default.
- **In memory, the alert is read from the move's records.** So when memory undoes a call after an
  accident, as the database's rollback would, the alert goes with the move. Only the escalation is
  kept apart, and memory does not undo it.
- **The system-only guard is a second wall** (B5). The permission check already refuses everyone
  but `dsor-scheduler`; the guard is what holds if someone later gives a person's role
  `alert:escalate`.

### What the review found

(Filled in after the review.)

### Left open on purpose

- **The list of alerts** (step 38c). Until then, a person sees an alert only in the scene and the
  tests.
- **Delivery** by email or a pager is step 40's outbox. An alert is a row, and a row tells nobody
  who does not read it.
- **Nothing runs the sweep on a timer**, as for the expiry sweep. A deployment's timer would run it
  every minute.
- **`alert_within` is a promise, not a wait.** The alert is raised with the move, in no time at all,
  so any value within one minute is met. The file declares it so a reviewer can see the bound.
- **One person per company.** If cfo_100 is away, the alert waits for them.
- **Two database tests fail on a throwaway server**, as in steps 34 to 38: one that accepts any
  password, and an owner that belongs to no other role.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-UNK-04b | Each unknown outcome raises an alert within one minute | [§25.3](../../../specs/dsor/03-execution.md#253-reconciliation), [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds) | [`test/alerts.test.ts`](test/alerts.test.ts), [`test/alerts-file.test.ts`](test/alerts-file.test.ts), [`test/alerts.db.test.ts`](test/alerts.db.test.ts) |
| DSOR-UNK-04c | One still unresolved after one hour goes to a human | [§25.3](../../../specs/dsor/03-execution.md#253-reconciliation), [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds) | [`test/alerts.test.ts`](test/alerts.test.ts), [`test/alerts-file.test.ts`](test/alerts-file.test.ts), [`test/alerts.db.test.ts`](test/alerts.db.test.ts) |

**Next:** step 38c, the list of alerts: DSoR's first query over its own store.
