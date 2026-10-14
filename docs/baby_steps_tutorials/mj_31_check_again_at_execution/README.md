# Step 31 · Check again at execution

**New in this step:** `proposal.execute` releases a waiting payment. It runs every check again on
live data, and it runs only the request that was stored.

## In plain words

Steps 27 to 30 made a payment wait: for the CFO's approval, or, in `propose_only` mode, for a
person to release it. Nothing released it, so an approved payment waited until it expired. This
step builds the release, `proposal.execute`.

Hours or days can pass between the approval and the release. So DSoR does not trust Tuesday's
checks on Friday. Think of the pilot's checklist again: after a long wait at the gate, the pilot
runs the checklist again before take-off, because the weather and the runway may have changed. At
the release, DSoR runs its checklist again, for the stored request, on live data. If any check now
says no, or a rule now asks for an approval that the payment does not have, the payment is not
made. Its proposal, the order-tracking page of that request, says `INVALIDATED`.

## Why it matters

On Tuesday the agent drafts INV-2012, 35,000.00 USD. It waits for the CFO and a tenant
administrator. On Wednesday cfo_100 and admin_100 approve it. On Thursday cfo_100 switches on a
stricter version of the CFO rule: above 25,000 USD, two CFOs. On Friday the agent releases
INV-2012. If DSoR trusted Wednesday's approvals, it would pay 35,000.00 USD with one CFO's yes,
where the company's rule now asks for two. The specification names this bug: "What was true when
you checked is not guaranteed to be true when you act" (time of check to time of use).

A second danger is the release itself. If `proposal.execute` took a request from its caller, the
agent could release INV-1008's approved proposal and send INV-1002 with it, a bill nobody approved.
So the release takes only the proposal's address, and runs the request that was stored.

## The design, before any code

The circled numbers are lines of DSoR's checklist, as in step 30. Line ③ checks the slip, line ④
the emergency brake, line ⑤ the caller's permission, and line ⑥ the input. Line ⑦ claims the
idempotency key, line ⑧ makes the proposal, or, for a release, loads it. Line ⑨ is DSoR's own
look before any work, and line ⑩ checks the rules and the limits.

### How this step was made

The learner designed this step on 2026-10-14 and 2026-10-15, one decision at a time, and asked for
the build to follow. Every decision below is the learner's. D12 was found while building began,
and the learner took it too. This folder is a copy of step 30.

### What each rule says

- **DSOR-APR-03a:** "Executing a proposal MUST re-evaluate the target command's preconditions,
  controls, segregation of duties, limits, delegation, and operational controls against `CURRENT`
  state" ([§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution)). The
  *target command* is the command the proposal holds, here `payment.create`.
- **DSOR-APR-03b:** "Each `REQUIRE_APPROVAL` outcome of the re-evaluation MUST be satisfied by
  unexpired, unrevoked approvals on this proposal that meet the role and quorum the current
  evaluation demands" ([§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution)).
- **DSOR-APR-03c:** "A proposal MUST move to `INVALIDATED` without executing when a precondition
  fails, a re-evaluated requirement is unsatisfied, a new `REQUIRE_*` or `DENY` outcome appears, or
  the stored payload hash does not verify"
  ([§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution)).
- **DSOR-APR-10:** "`proposal.execute` MUST execute the stored canonical payload of the proposal"
  ([§26.1](../../../specs/dsor/03-execution.md#261-one-model)).
- **DSOR-APR-13:** "`proposal.execute` MUST NOT accept a payload from its caller"
  ([§26.1](../../../specs/dsor/03-execution.md#261-one-model)).
- **Beside them:** DSOR-APR-03d, "When a bound control has a new active version at execution, DSoR
  MUST evaluate the new version and record both versions in the decision bundle", which D3 relies
  on. And DSOR-APR-11, "An agent principal MUST NOT execute a proposal that was created under a
  delegation other than its own", which D2 keeps.

### Decisions (the learner's)

- **D1. Step 31 checks again what DSoR already checks:** the slip, the emergency brake, the
  requester's permission, the invoice's version, the company's rules, the limits, segregation of
  duties, and the approvals. The map said step 31 is done when suspending VENDOR-44 after the
  approval invalidates the proposal. DSoR keeps no vendor record yet: checking a vendor's status is
  a precondition, step 32's idea. So step 31 is done when a stricter rule switched on after the
  approval makes INV-2012 `INVALIDATED`. *Downside:* the map's "done when" changes, in the map, in
  the open.
- **D2. Who may release:** the agent that asked, under the same slip, and only if that slip holds
  the full `payment:create`, not only `payment:create.propose` (DSOR-APR-11). Or any person in the
  company who holds `payment:create`, such as user_123. *Downside:* one more check than the
  specification's table names, written down as this tutorial's reading: without it, an agent
  limited to preparing could release its own prepared payment.
- **D3. An approval still counts while the current rules ask for a role and quorum it meets.**
  cfo_100 approved for version 8 of the CFO rule. If version 9 asks for one CFO too, the approval
  counts, and the record names both versions (DSOR-APR-03d). A version that asks for two CFOs, a new
  rule that asks someone else, or a `DENY`, makes the proposal `INVALIDATED`. *Downside:* cfo_100
  approved under version 8's line; version 9's other changes do not ask the CFO again.
- **D4. The booking is kept, then spent.** Tuesday's booking of 31,400.00 USD against `del_100`'s
  day is found again by the proposal's id and is not booked again. The one-payment limit, 50,000
  USD, is checked again on live data. If the payment runs, the booking is spent. If the proposal
  is `INVALIDATED`, the booking goes back to the day. *Downside:* Friday's own day never sees
  INV-1008: it counts on Tuesday, the day it was drafted.
- **D5. A changed invoice invalidates.** The stored request names `expected_version: 1`. If the
  invoice is now version 2, the proposal is `INVALIDATED` before any work: a failed precondition,
  not a failed payment. *Downside:* a harmless change to the invoice sends the payment back to be
  drafted and approved again.
- **D6. A prepared payment that a rule now stops is invalidated.** A `READY` proposal, prepared
  before a rule existed, does not move on to wait for an approval: DSOR-APR-03c says a new
  `REQUIRE_*` outcome invalidates. The agent prepares it again. *Downside:* the specification's
  picture of states has no move from `READY` to `INVALIDATED`. This step adds it, as step 25c added
  `READY` to `CANCELLED`, and the question goes to the specification.
- **D7. Only an `APPROVED` or a `READY` proposal runs.** One that still waits hears
  `APPROVAL_REQUIRED` (§28). Any other state hears `CONFLICT`. *Downside:* a caller who releases too
  early learns that the proposal still waits.
- **D8. The caller hears `APPROVAL_INVALIDATED`, with the cause.** The proposal moves to
  `INVALIDATED` with its record, and its booking goes back. *Downside:* the cause tells the caller
  what changed, which the caller may not have known.
- **D9. The input is `{ proposal }`, and nothing else.** Any other field, such as a new amount or
  another invoice, is refused at line ⑥ (DSOR-APR-13), and the stored request runs (DSOR-APR-10).
  *Downside:* a caller who wants a change drafts a new payment, which is approved again.
- **D10. A proposal runs at most once.** `proposal.execute` carries its own idempotency key. The same
  key gives back the same answer. A new key on a proposal that already ran hears `CONFLICT`.
  *Downside:* none beyond step 20's: a lost answer is found again only with the same key.
- **D11. The program tells four scenes.** The agent releases INV-1008, which cfo_100 approved:
  `COMMITTED`, and a payment is drafted. cfo_100 switches on a version of the CFO rule that asks for
  two CFOs, and the agent releases INV-2012: `INVALIDATED`, and its booking goes back. The agent
  tries to release with a new amount: refused at line ⑥. user_123 releases a payment that the agent
  prepared in `propose_only` mode: `COMMITTED`. *Downside:* a longer program run to read.
- **D12. Line ⑤ checks no permission of its own for `proposal.execute`.** Line ⑤ runs before DSoR
  knows which proposal is released. So, as the specification's table says, "the requester, or a
  human holding the target permission" may release, and line ⑨ decides by D2 once line ⑧ has loaded
  the proposal. The contract says so in an extension, and start-up refuses that extension on any
  other command. *Downside:* line ⑤ checks nothing for this one command.

### The story's numbers

| When | Who | Asks | DSoR answers |
|---|---|---|---|
| Friday | the agent | releases INV-1008, 31,400.00 USD, which cfo_100 approved | `COMMITTED`, a payment is drafted, the booking is spent |
| Friday | cfo_100 | switches on a version of the CFO rule that asks for two CFOs | active |
| Friday | the agent | releases INV-2012, 35,000.00 USD, which one CFO and one tenant administrator approved | `APPROVAL_INVALIDATED`: two CFOs are asked for now. The proposal is `INVALIDATED`, and its 35,000.00 USD goes back to the day |
| Friday | the agent | releases a proposal, with `invoice: INV-1002` in the input | `VALIDATION_FAILED` at line ⑥ |
| Friday | user_123 | releases a payment the agent prepared in `propose_only` mode | `COMMITTED`, a payment is drafted |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | Only the stored request runs: the input is `{ proposal }` only, and the stored payload executes, its fingerprint verified (DSOR-APR-13, DSOR-APR-10) |
| C2 | Who may release, and what: D2, D7, and D12 |
| C3 | Every check runs again on live data: the slip, the brake, the requester's permission, the invoice's version, the rules, the limits, and segregation of duties (DSOR-APR-03a) |
| C4 | An approval counts only for the role and quorum that the rules ask for now, and the record names both versions (DSOR-APR-03b, D3) |
| C5 | A failed check invalidates: `INVALIDATED`, `APPROVAL_INVALIDATED` with the cause, the booking back, nothing paid; a `READY` proposal too (DSOR-APR-03c) |
| C6 | A release that passes runs once: `EXECUTING`, then `COMMITTED`, a payment drafted, the booking spent; the same key replays, and two releases at once make one payment (D4, D10) |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. The release skips the check on live data, and trusts Tuesday's decision | INV-2012 is paid with one CFO's approval | `COMMITTED`, a payment drafted |
| B2. `proposal.execute` runs what the caller sends, not the stored request | INV-1002 is paid, and INV-1008's proposal says `COMMITTED` | INV-1002 paid |
| B3. An `INVALIDATED` proposal's booking is never given back | the next 20,000.00 USD draft that day is refused | `LIMIT_EXCEEDED` |
| B4. The check of D2 is gone: an agent whose slip lists only `payment:create.propose` releases its own prepared payment | INV-1009 is paid, though only a person was meant to release it | `COMMITTED`, paid |

### Left open, and not this step's idea

- A vendor's status, and every other precondition written in CEL: step 32.
- `strict_version` binding for a `CRITICAL` operation (DSOR-APR-03e, L3).
- Revoking an approval (DSOR-APR-04b), and superseding a proposal with a changed one
  (DSOR-APR-12).
- Whether an approver must still hold the role at the release. This step reads the role the
  approval recorded.
- The intent record before the work, and an outcome that is not known: steps 36 and 40.
