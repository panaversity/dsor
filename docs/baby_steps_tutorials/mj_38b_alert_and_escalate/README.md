# Step 38b · Alert at once, escalate before the hour

**New in this step:** a payment whose outcome is unknown raises an alert in the same moment, and an
alert still open near the hour is escalated to a named person who can settle it (DSOR-UNK-04b,
DSOR-UNK-04c).

## In plain words

DSoR is a careful clerk between a company's people and AI workers and its real systems, its books
and its bank. When DSoR asks the bank to send a payment and the bank never answers, nobody knows
whether the money left. DSoR says so, `OUTCOME_UNKNOWN`. Since step 37 it holds the payment and its
bill, and since step 38 `payment.reconcile` can ask the bank what happened and settle it.

But only if someone calls it. Until this step, nobody is told that a payment went unknown. An
*alert* is DSoR's record "this payment needs a person", raised the moment the payment goes unknown.
To *escalate* is to hand the alert to a named, more senior person when nobody has settled it in
time. The specification gives the times in [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds):
an alert within one minute, and a person after one hour at most.

Think of the order-tracking page, which is what a proposal is. The moment an order's status turns
to "unknown", the page shows a red flag. If the flag is still there near the hour, the page writes
a manager's name beside it. In this step the flag is raised and the name is written. Nobody is
phoned or emailed yet: that is step 40's outbox.

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
learner split it into step 38c (D0). The review found four more choices, and the learner decided
those too (D8 to D11).

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
| C1 | A proposal's move to `OUTCOME_UNKNOWN` raises one open alert for it, in the same transaction, at the time of the move's own record. No other move raises one |
| C2 | Every way into `OUTCOME_UNKNOWN` raises it: the bank's silence, an error after the bank was asked, a record that cannot be kept after the bank was asked, the start-up sweep after a real `SIGKILL`, and the upgrade to migration 034 |
| C3 | A move out of `OUTCOME_UNKNOWN`, to `COMMITTED` or `FAILED`, closes the alert in the same transaction, naming the outcome, whether the alert was open or escalated |
| C4 | `alert.escalate_due` records the escalation of each of the company's open alerts older than its bound to the company's named person, once, three sweeps at once included. A younger alert, a closed one, and another company's are not touched |
| C5 | Only DSoR's own scheduled login may call `alert.escalate_due`. An agent and a person are refused, even when their role holds the permission |
| C6 | Start-up refuses an `alerts.json` that leaves out a company where a login works, names a role that is not in the role table or that no person of the company holds, names someone who is not a person of the company or who holds no `payment:reconcile` there, or gives a bound that is not a duration, an `alert_within` over one minute, or an `escalate_after` that with one sweep's wait can pass the hour |
| C7 | On the database, the database itself raises and closes an alert when the proposal's state changes, whoever writes it; `dsor_runtime` may only escalate one, while its payment is unknown; an alert is never removed or emptied, and each company sees only its own |

### Decisions

- **D0. Split: the list of alerts is step 38c's** (the learner's choice). This step raises,
  escalates, and closes alerts. Step 38c adds `alert.list`, DSoR's first query over its own store.
  *Downside:* until 38c, a person sees alerts only in the program's scene and in the tests. Step
  28b's notices to a rule's owner are kept the same way, and nothing shows them yet either.
- **D1. An alert is a row, written with the move** (the learner's choice). `dsor.alerts`, written in
  the transaction that moves the proposal to `OUTCOME_UNKNOWN`, so the move and its alert are kept
  together or not at all. *Downside:* delivering it by email or a pager is step 40's outbox.
- **D2. The receivers are a role named for each company** (the learner's choice). `alerts.json`
  names it: org_456's `ap_supervisor`, user_123. *Downside:* one more file to keep in step. One
  detail is Claude Code's, not the learner's: the row does not copy the role, and step 38c's list
  will read it from the file.
- **D3. Escalation is a sweep run by `dsor-scheduler`** (the learner's choice). `alert.escalate_due`
  is DSoR's own command, as step 25c's expiry sweep is: it escalates every open alert past the
  bound, once, and leaves its decision record. *Downside:* nothing runs it on a timer in this
  tutorial, the same as the expiry sweep.
- **D4. The human is a named person, checked at start-up** (the learner's choice). org_456's is
  cfo_100, and org_789's is user_700. Start-up refuses a name that is not a person of that company.
  *Downside:* one person; if they leave, start-up stops until the file changes.
- **D5. Every way in raises it, at the move** (the learner's choice). In memory the proposal
  store's move writes the alert; on the database, the database's own trigger does (D9). Every path
  into `OUTCOME_UNKNOWN` is a move. *Downside:* the move gets one more job.
- **D6. The alert closes with the settlement** (the learner's choice). The move out of
  `OUTCOME_UNKNOWN` closes it, in the same transaction, so `payment.reconcile` needs no change of
  its own. A closed alert is never escalated. *Downside:* the alert row changes, so it is not
  append-only like the holds.
- **D7. The two bounds are declared and checked at start-up** (the learner's choice). `alerts.json`
  gives `alert_within` and `escalate_after` for each company, and start-up refuses either one over
  §44's ceiling. `alert_within` is a declaration only: the alert is raised with the move, so
  changing the number changes nothing DSoR does. *Downside:* one more check at start-up.
- **D8. A send that fails after the bank was asked is settled unknown at once** (the learner's
  choice, after the review's H1). The bank sent PAY-902, then DSoR's record of the send could not be
  kept. The claim then ends its own note in a fresh transaction, as the start-up sweep would: the
  proposal moves to `OUTCOME_UNKNOWN`, and its alert is raised. *Downside:* it changes step 36b's
  behaviour, where the proposal waited at `EXECUTING` for the sweep; and if the database is down
  too, it still waits for the sweep.
- **D9. The database ties an alert to its proposal** (the learner's choice, after the review's M1).
  A trigger on `dsor.proposals` raises and closes the alert, so no write of a proposal's state can
  leave the two apart. `dsor_runtime` may only escalate an alert, and only while its payment is
  unknown. *Downside:* the rule lives in two places: the trigger, and memory's move.
- **D10. The sweep's period is declared too** (the learner's choice, after the review's M2). An
  alert is escalated at the first sweep after its bound, so `alerts.json` gives `sweep_every`
  (`PT1M`), and start-up refuses an `escalate_after` that with one sweep's wait can pass the hour.
  org_456 escalates after `PT59M`. *Downside:* the promise depends on a timer this tutorial does not
  build.
- **D11. The person must be able to settle** (the learner's choice, after the review's M3).
  Start-up refuses a person who holds no `payment:reconcile` in the company, and the CFO role gains
  it. *Downside:* the CFO holds one more permission, and in org_789 the person is user_700, who also
  receives the alerts.

### The tests, by claim

| Claim | Tests |
|---|---|
| C1 to C5 | `test/alerts.test.ts`, in memory |
| C2, C3, C4, C7 | `test/alerts.db.test.ts` and `test/sealed.db.test.ts`, on the database, with a real `SIGKILL` |
| C2, the upgrade | A real run on 2026-10-19: a payment left unknown on step 38's schema got its open alert when migration 034 ran |
| C6 | `test/alerts-file.test.ts` |

### The breaks

The learner chose not to predict. Each break ran on 2026-10-19 in a fresh copy of this folder, with
a fresh database, against `test/alerts.test.ts`, `test/alerts-file.test.ts`, and
`test/alerts.db.test.ts`.

| Break | What it removes | Unit tests failed | Database tests failed |
|---|---|---|---|
| **B1** | The move to `OUTCOME_UNKNOWN` raises no alert | 17 | 7 |
| **B2** | The settlement does not close the alert | 4 | 3 |
| **B3** | The sweep escalates every open alert, at once, whatever its age | 1 | 1 |
| **B4** | The sweep escalates a closed alert too | 3 | 1 |
| **B5** | The contract no longer says only a system login may call the sweep | 1 | 0 |
| **B6** | Start-up takes an agent or a system login as the person to escalate to | 2 | 0 |
| **B7** | The alert's trigger lets any change through | 0 | 2 |

These are the counts after the review's fixes, rerun on 2026-10-19.

B1 is the dangerous one: a payment goes unknown and nobody is ever told, which is the failure this
step exists to stop. B5 first passed every test. No person's role holds `alert:escalate`, and an
agent's slip needs a signer who holds it, so the permission check refused everyone before the
system-only guard was reached. A test with the permission added to the AP supervisor's role now
shows the guard working alone. B5 and B6 are start-up and permission checks, which the database
tests do not reach. B7 is caught only on the database, because the trigger is the database's.

## What changed since step 38

| File | What changed |
| --- | --- |
| `alerts.json`, `src/alerts.ts` | **New.** Each company's receivers, person, bounds, and sweep period, checked at start-up (D2, D4, D7, D10, D11) |
| `src/proposals.ts`, `migrations/034_alerts.sql` | Memory's move raises and closes the alert; `dsor.alerts`, its trigger, and the proposals' trigger that raises and closes it on the database (D1, D5, D6, D9) |
| `src/claims.ts`, `src/postgres.ts` | A send that fails after the bank was asked ends its own note at once, as the start-up sweep would (D8) |
| `src/escalation.ts`, `contracts/alert.escalate_due.json`, `inputs/AlertEscalateDueRequest.schema.json`, `examples/alert.escalate_due.json` | **New.** The escalation sweep (D3) |
| `src/registry.ts`, `src/revocation.ts`, `src/pipeline.ts` | Start-up checks the file; DSoR's own work gets the company's alerts |
| `roles.json`, `classifications.json`, `store.json` | `alert:escalate` for the scheduler and `payment:reconcile` for the CFO; the sweep's answer's labels; the store map names `dsor.alerts` and the new triggers |
| `src/main.ts` | The scene: PAY-902's alert raised, escalated, closed |
| `test/alerts.test.ts`, `test/alerts-file.test.ts`, `test/alerts.db.test.ts`, `test/owner-alerts.ts` | **New.** The claims C1 to C7 |
| The other tests | Twenty contracts, 228 attacks, the roles, the labels, the store map; step 36's and 36b's tests of a send that fails after the bank was asked now find it `OUTCOME_UNKNOWN`. Each says "Changed in step 38b" |

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
  PT59M later, the sweep again: 1 escalated to cfo_100
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
4. Someone writes `"escalate_to": "accounts-payable-fte"` in `alerts.json`. And then
   `"escalate_to": "admin_100"`, the tenant administrator. What happens each time?
5. Two sweeps run at once, an hour after PAY-901 went unknown. How many times is its alert escalated?

<details>
<summary>Answers</summary>

1. Yes. Every way into `OUTCOME_UNKNOWN` goes through the proposal store's move, and the move raises
   the alert in its own transaction (C2, D5). The database test proves it with a real `SIGKILL`.
2. A payment goes unknown in three ways, and the crash is one where `payment.execute` never gets to
   its next line. The move is the one place all three pass (D5).
3. The reconcile's move closes it, naming `COMMITTED`, in the same transaction (C3). A closed alert
   is never escalated, so cfo_100 is not told (C4).
4. DSoR does not start, either time. The agent "is not a person of org_456": an agent is never the
   human DSOR-UNK-04c asks for (D4). admin_100 is a person, but "holds no payment:reconcile in
   org_456", so could not settle the payment it was handed (D11).
5. Once. The database's escalation is one statement that changes only an open alert; the second
   sweep waits for the first's row lock, then finds it escalated (C4).

</details>

## Think it through

### Found while building

- **The step 36 and 36b tests of a send that fails after the bank was asked changed** (D8). They
  said the proposal waits at `EXECUTING` for the start-up sweep; now the claim ends it at once.
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

A reviewer who had not seen the conversation read the rules, the code, and this README, and broke
the code in copies. The learner decided the four findings that needed a choice (D8 to D11). Each
fix below was undone once in a copy, and its test failed.

| # | What it found | What was done |
|---|---|---|
| H1 | The bank sent, then DSoR's record of the send could not be kept. The caller heard `OUTCOME_UNKNOWN`, but the proposal stayed `EXECUTING` with no alert until a restart | D8: the claim ends its own note at once, as the start-up sweep would. Tested in memory and on the database |
| H2 | A payment already unknown when migration 034 runs never got an alert | The migration raises one for each. A real upgrade run showed it |
| M1 | On the database, nothing tied an alert to its proposal: a direct UPDATE of a proposal left its alert open, and `dsor_runtime` could close an alert of a payment still unknown | D9: a trigger on `dsor.proposals` raises and closes it; `dsor_runtime` may only escalate, while the payment is unknown |
| M2 | `PT1H`, with a sweep every minute, escalated up to a minute after the hour | D10: `sweep_every` declared; start-up refuses a bound that with one sweep can pass the hour; `PT59M` shipped |
| M3 | cfo_100 could not settle the payment it was handed. "Escalates to" claimed more than a column | D11: the person must hold `payment:reconcile`, and the CFO role gains it. The claims say "records the escalation" |
| M4 | In memory, three sweeps at once each said they escalated the same alert | The read and the change happen with no wait between. A test runs three at once |
| M5 | The alert's time is the transaction's start, a little before the bank's answer; after a restart, it is dated from the restart | C1 says "the time of the move's own record". The restart case is left open, below |
| Tests | Six small breaks passed every test: a receiver role held only in another company, the ceilings loosened, the company id check removed, the refusal code changed, `raised_at` read from the last move | A test for each |
| L1 to L4 | TRUNCATE was not refused; `alert_within` read like a setting; a name capitalised by the marker removal; PAY-901 and PAY-902 | A TRUNCATE trigger; D7 says it is a declaration; fixed; the tests' world has PAY-901, the program's scene PAY-902 |
| Prose | The courier analogy was not on the list and promised a desk and a hand-over this step does not build; "note" already meant the intent record | The order-tracking page, with what is not built said plainly; "alert" throughout |

### Left open on purpose

- **The list of alerts** (step 38c). Until then, a person sees an alert only in the scene and the
  tests.
- **Delivery** by email or a pager is step 40's outbox. An alert is a row, and a row tells nobody
  who does not read it.
- **Nothing runs the sweep on a timer**, as for the expiry sweep. A deployment's timer would run it
  every minute.
- **`alert_within` is a promise, not a wait.** The alert is raised with the move, so any value within
  one minute is met. The file declares it so a reviewer can see the bound.
- **One person per company.** If cfo_100 is away, the alert waits for them. In org_789 the person,
  user_700, is also the one who receives the alerts: that company has no second person who can
  settle a payment.
- **After a restart, the clock starts again** (M5). The start-up sweep raises the alert when it
  runs, so after three hours down the hour is counted from the restart, not from when the money may
  have left (open question 154).
- **The database cannot check the bound or the person.** Both live in `alerts.json`, so a bug in
  DSoR's own code could still escalate an alert early, or to someone else. The trigger checks only
  that the payment is still unknown.
- **The owner can switch the triggers off**, as migration 020 does for its own change. "Never
  removed" holds while the triggers are on.
- **Two database tests fail on a throwaway server**, as in steps 34 to 38: one that accepts any
  password, and an owner that belongs to no other role.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-UNK-04b | Each unknown outcome raises an alert within one minute | [§25.3](../../../specs/dsor/03-execution.md#253-reconciliation), [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds) | [`test/alerts.test.ts`](test/alerts.test.ts), [`test/alerts-file.test.ts`](test/alerts-file.test.ts), [`test/alerts.db.test.ts`](test/alerts.db.test.ts) |
| DSOR-UNK-04c | One still unresolved after one hour goes to a human | [§25.3](../../../specs/dsor/03-execution.md#253-reconciliation), [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds) | [`test/alerts.test.ts`](test/alerts.test.ts), [`test/alerts-file.test.ts`](test/alerts-file.test.ts), [`test/alerts.db.test.ts`](test/alerts.db.test.ts) |

**Next:** step 38c, the list of alerts: DSoR's first query over its own store.
