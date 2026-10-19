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
