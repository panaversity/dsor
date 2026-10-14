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
the build to follow. D1 to D13 are the learner's. D12 and D13 were found as building began, and the
learner took them too. D14 to D18 were found later in the build. They are Claude Code's, each with
its downside, for the learner to review. This folder is a copy of step 30.

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
  other command. *Downside:* line ⑤ checks nothing for this one command. So the caller who may
  release is checked once, at line ⑨, and nowhere else.
- **D13. A release takes two modes, not three.** A dry run, `validate_only`, runs line ⑨'s gate
  and the check again, and moves nothing. `propose_only` is refused with `VALIDATION_FAILED`: a
  release that was only prepared would wait for another release. The refusal comes after the check
  that every address names the caller's company, so an attempt on another company is refused as
  one. *Downside:* DSOR-OPR-05 says every command takes the three modes. This is the tutorial's
  choice against it, and a question for the specification.

### Decisions found while building (Claude Code)

- **D14. Only a proposal of the company's code is released.** DSoR's own work, such as a brake or a
  rule, can be prepared in `propose_only` mode. Its release would have to run DSoR's own look at
  line ⑨ again first. In this step it hears `UNSUPPORTED_CAPABILITY`, from the gate, so a dry run
  hears it too. *Downside:* a prepared brake waits until it expires.
- **D15. A check that cannot be made now is not a "no".** When the company's directory has no recent
  answer (`FRESHNESS_UNSATISFIABLE`), or DSoR meets a fault, the proposal stays `APPROVED` or
  `READY`. The idempotency claim is undone, so the same key may try again later. *Downside:* a
  directory that stays down keeps the payment waiting until it expires.
- **D16. A signer the directory reports as gone invalidates, and suspends nothing yet.** Line ③
  suspends a gone signer's slips (step 19b). The release does not: the agent's next call does.
  *Downside:* the suspension's record comes one call later.
- **D17. Every cause starts with its own code.** The caller hears, for example, `APPROVAL_REQUIRED:
  high-value-payment version 9 asks for 2 approvals by CFO, and 1 counts`. The words are shown only
  when their label allows: `public` or `internal`. The proposal's move names the code alone.
  *Downside:* a caller whose clearance is below `internal` hears only `APPROVAL_INVALIDATED`.
- **D18. What counts as a "new" rule.** An approval counts for a rule the request was decided under,
  in any version, and only for the role that its approval met. A rule the request was never decided
  under is new, and invalidates, even when it asks for a role an approver holds. This is
  DSOR-APR-03c's "a new `REQUIRE_*` outcome appears". *Downside:* a new rule that asks for the CFO
  sends a payment back, though the CFO approved it.

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

## What changed since step 30

| File | What changed |
| --- | --- |
| `contracts/proposal.execute.json`, `inputs/ProposalExecuteRequest.schema.json`, `examples/proposal.execute.json` | **New.** The release's contract, its input, `{ proposal }` and nothing else, and an example. The contract's extension says that line ⑨, not line ⑤, decides its caller (D12) |
| `src/release.ts` | **New.** Who may release and what (`mayRelease`, D2 and D7). The asker checked again (`askerNow`). The approvals against what the rules ask for now, with segregation of duties (`checkApprovals`, D3 and D18). The version the request was decided on (`checkDecidedOn`, D5). Which refusals invalidate (`invalidates`, D15), and the cause the caller hears (`causeOf`, D17) |
| `src/pipeline.ts` | Line ⑤ skips a release. Line ⑧ loads the proposal instead of making one. The check again runs inside the claim: line ⑨ and line ⑩'s own code, now for any request and asker, not only the call's own. Then the move to `EXECUTING`, the stored request's work, and its end, with its booking |
| `src/proposals.ts`, `migrations/027_ready_can_be_invalidated.sql` | The move from `READY` to `INVALIDATED`, in memory and in the database's trigger (D6) |
| `src/log.ts` | A release's record names the rule versions its request was decided under, `approved_under` (DSOR-APR-03d) |
| `src/registry.ts` | Start-up refuses the release's extension on any other command, and `proposal.execute` without it |
| `src/main.ts` | The story of the release, in four scenes, in a world of its own (D11) |
| `test/release.test.ts`, `test/release-run.test.ts`, `test/recheck.test.ts`, `test/release.db.test.ts` | **New.** The claims C1 to C6 |
| `test/rule-world.ts`, `test/owner-proposals.ts` | The test world shows its invoices and directories, so a test changes them between an approval and a release. The owner can change a stored request behind the trigger's back, for one test |
| The other tests | The pinned lists grow by one contract, its 36 cross-company attacks, its modes, and the new move out of `READY` |

Step 30's markers are gone, as the build skill (`.claude/skills/build-baby-step`) asks. A search
for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_30_who_may_not_approve/src src
git diff --no-index ../mj_30_who_may_not_approve/test test
```

## Run it

As in step 30, the step needs a local PostgreSQL 17 and a database of its own. Its `.env` is
written by a command that prints nothing. Give the step a server of its own if you can: `pnpm
migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server. This step adds one
migration, 027.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-15. After step 30's scenes, the program releases payments in a world of
its own. In step 30's world, two more rules were switched on after INV-1008 was approved, so its
release there would be invalidated. Here only the CFO's rule is on at first.

```text
releases, in memory, in a world of their own:
  the agent drafts INV-1008, 31,400.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  cfo_100 approves it: APPROVED
  the agent releases it: COMMITTED, INV-1008 31400.00 USD drafted
  INV-1008's proposal: COMMITTED, its booking committed
  cfo_100 switches on admin-above-30000: version 1, active
  the agent drafts INV-2012, 35,000.00 USD: PENDING_APPROVAL, needs tenant_admin x1 (admin-above-30000), CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  cfo_100 approves it: PENDING_APPROVAL
  admin_100 approves it: APPROVED
  cfo_100 switches on a version that asks for two CFOs: version 9, active, version 8 retired
  the agent releases INV-2012: APPROVAL_INVALIDATED: proposal prop_32023fa2-60c5-472d-8f15-1a0ac8741aa8 is INVALIDATED: APPROVAL_REQUIRED: high-value-payment version 9 asks for 2 approvals by CFO, and 1 counts
  INV-2012's proposal: INVALIDATED, its booking released
  the agent releases INV-1008's proposal and sends invoice INV-1002 with it: VALIDATION_FAILED: the input of "proposal.execute" is not valid: must NOT have additional properties: "invoice"
  the agent prepares INV-1009, 7,425.00 USD, in propose_only mode: READY
  user_123 releases it: COMMITTED, INV-1009 7425.00 USD drafted
  payments drafted in this world: INV-1008, INV-1009
```

INV-1008 is paid: cfo_100's approval still meets what the rules ask. INV-2012 had both of its
approvals. Then a version of the CFO's rule asked for two CFOs, and one CFO's yes no longer counts.
The release says so, and its 35,000.00 USD goes back to the day. org_456 has one CFO, so INV-2012
cannot be paid until the rule changes again, or a new draft is approved. The third release is
refused at line ⑥, before DSoR even loads the proposal. INV-1008's proposal has ended anyway: a
second release of it would hear `CONFLICT`.

## Break it

Each break ran on 2026-10-15, in this folder, and the code was restored after each run, byte for
byte. A short script told four scenes in memory, one for each break. Unbroken, they read:

```text
B1, release after two CFOs: APPROVAL_INVALIDATED: … asks for 2 approvals by CFO, and 1 counts; drafted: none
B2, release with INV-1002: VALIDATION_FAILED: … must NOT have additional properties: "invoice"; INV-1008 still APPROVED
B3, after INV-1008's invalidated release, INV-2007, 21,000.00 USD: PENDING_APPROVAL
B4, the preparing agent releases its own INV-1009: AUTHORIZATION_DENIED: … its slip allows payment:create.propose only, and a release needs payment:create
```

B3's scene gives `del_100` a limit of 50,000 USD for one day, so that one booking more or less
decides the next draft. The design said 20,000 USD; the story's bill is INV-2007, 21,000.00 USD.

**B1. The release trusts Tuesday's decision.** In `src/pipeline.ts`, the check again was skipped:

```text
B1, release after two CFOs: COMMITTED; drafted: INV-1008 31400.00
the agent releases INV-2012: COMMITTED, INV-2012 35000.00 USD drafted
```

The learner predicted `COMMITTED`, and a payment drafted. Right. The second line is the program's:
35,000.00 USD paid on one CFO's yes, where the rule now asks for two. This is the time-of-check to
time-of-use bug of "Why it matters". All 13 tests of `test/recheck.test.ts` failed.

**B2. The release runs what the caller sends.** The first try did not start. An input schema that
takes any field is refused at start-up: "must refuse fields it does not list". That rule is step
07's. So the break did what a developer adding "a little flexibility" would do: it listed an
`invoice` field in the release's input. Then it was run in two forms.

In the first form, only the work used the caller's fields:

```text
B2a, release with INV-1002: INTERNAL_ERROR: DSoR hit an unexpected error; drafted: none
```

Nothing was paid. Line ⑨ read INV-1008, and the payments store is pinned to what line ⑨ read (step
24). A draft of INV-1002 was refused as a fault. In the second form, the check and the work both
used them, and the fingerprint was worked out again from the new request:

```text
B2b, release with INV-1002: COMMITTED; drafted: INV-1002 8900.50; INV-1008's proposal COMMITTED
```

The learner predicted INV-1002 paid. Right: a bill nobody approved is paid, and the record says
INV-1008's approved proposal ran. One test failed, DSOR-APR-13's "another invoice". Without the new
fingerprint, the check of the stored request's fingerprint would have invalidated it.

**B3. An invalidated proposal keeps its booking.** In `src/pipeline.ts`, the booking's release after
`INVALIDATED` was gone:

```text
B3, after INV-1008's invalidated release, INV-2007, 21,000.00 USD: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one day
INV-2012's proposal: INVALIDATED, its booking held
```

The learner predicted `LIMIT_EXCEEDED`. Right. 31,400.00 USD of a payment that will never be made
still counted, and 21,000.00 more passed the day's 50,000. The second line is the program's. One
test failed, and so did the program's.

**B4. An agent that may only prepare releases what it prepared.** In `src/release.ts`, D2's check
of the full permission was gone:

```text
B4, the preparing agent releases its own INV-1009: COMMITTED; drafted: INV-1009
```

The learner predicted `COMMITTED`, and paid. Right. The check again did not stop it: the agent
asked in `propose_only` mode, and still holds `payment:create.propose`, so its request is still
allowed. Only D2 says that preparing is not releasing. One test failed.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The learner asked to design step 31 (2026-10-14) |
| 2 | Decide | D1 to D13, the learner's, one at a time, and a prediction for each break |
| 3 | The copy | Step 30 copied, its markers removed, and a PostgreSQL of its own |
| 4 | Piece A | The release's contract, who may release, and what, red first |
| 5 | Piece B | The stored request runs, once, red first |
| 6 | Piece C | The check again on live data, red first: before it, every stale approval was paid |
| 7 | Piece D | The database: migration 027, and two releases at once |
| 8 | Piece E | The program's story |
| 9 | Break it | B1 to B4, against the learner's predictions; and breaks of each piece |

To start it in a new session:

```text
Build step 31 in learner mode from the design in
docs/baby_steps_tutorials/mj_31_check_again_at_execution/README.md.
```

What each move broke, measured. Each piece was broken on purpose, one small change at a time, and
restored. When a break survives, no test holds what it broke.

| Move | What failed |
| --- | --- |
| Piece A | 15 tests, red first. Broken on purpose 8 ways: each check of the gate gone, in turn, and the extension on another command. Each made tests fail; the extension's break, start-up |
| Piece B | 8 tests, red first: a release answered "not built yet". Broken on purpose 3 ways: the booking given back on success, the answer's fingerprint taken from the release's input, and a lost race allowed to run. The first two made tests fail. The race survived in memory, where the second release finds the proposal moved at the gate already. The database test of piece D holds it |
| Piece C | 12 tests, red first: every one was `COMMITTED`, the bug of "Why it matters". One more test, of an approval that met another role, after a gap was seen. Broken on purpose 7 ways: approvals not compared, an approval counted for any role, the asker not checked again, a "not now" that invalidates, no check of the invoice's version, no segregation of duties, and the booking kept. Each made tests fail |
| Piece D | 7 database tests. Broken on purpose 2 ways: the lost race allowed to run, which the race test caught, and the trigger without migration 027, where the release of a `READY` proposal failed with `INTERNAL_ERROR` |
| Piece E | The program's test. B1 and B3 changed its lines |

## Check yourself

Use the story: cfo_100 approved INV-1008, 31,400.00 USD, on Tuesday, under version 8 of
`high-value-payment`: above 25,000 USD, one CFO. The agent works under `del_100`, which user_123
signed. Each question changes one thing before the release on Friday.

1. On Thursday, cfo_100 switches on version 9: above 25,000 USD, two CFOs. The agent releases
   INV-1008. What does it hear, and what happens to the 31,400.00 USD booked on Tuesday?
2. Version 9 asks for one CFO, as version 8 did, above 20,000 USD. Is the payment made? What does
   the record name that it did not name before?
3. The agent sends `{ proposal, invoice: INV-1002 }`. What happens, and why can the caller never
   change the request at the release?
4. The directory moves user_123 to `ap_clerk` on Thursday. user_123, who still has `payment:create`
   on their own login, releases INV-1008. What happens, and whose permission was checked?
5. The directory is off on Friday, and its last answer is two hours old. What does the release hear,
   and can the same idempotency key be sent again later?

<details>
<summary>Answers</summary>

1. `APPROVAL_INVALIDATED`: version 9 asks for 2 approvals by CFO, and 1 counts. The proposal
   moves to `INVALIDATED`, nothing is paid, and the booking goes back to the day (D3, D4, D8).
2. Yes. cfo_100's approval met the role and the quorum the rules ask for now. The record names
   version 9 in its controls, and version 8 in `approved_under`: both versions (DSOR-APR-03d).
3. Line ⑥ refuses it, `VALIDATION_FAILED`: the input is `{ proposal }` and nothing else. The
   approval was for the request that was stored, with its fingerprint. A release that ran anything
   else would run a request that nobody approved (DSOR-APR-13, DSOR-APR-10, B2).
4. `APPROVAL_INVALIDATED`, with `AUTHORIZATION_DENIED` as its cause. The release checks the asker
   again, not only the caller. The asker is the agent, and it acts with what user_123 holds now:
   `ap_clerk` may only prepare a payment (D1).
5. `FRESHNESS_UNSATISFIABLE`. The proposal still waits, and its booking is held. The claim was undone,
   so the same key may try again, and it succeeds once the directory answers (D15).

</details>

## Think it through

### Found while building

- **Two more of D1's rules.** D12, that line ⑤ cannot check the caller of a release, and D13, a
  release's modes, were found as building began. The learner took both. D14 to D18 were found later,
  and are Claude Code's.
- **A world of its own for the story.** In step 30's world, two more rules were on, switched on after
  INV-1008 was approved. Its release there is invalidated, rightly. So D11's first scene, a release
  that pays, needs a world where only the CFO's rule is on at first.
- **More guards than the design named, for B2.** Start-up refuses an input schema that takes any
  field. The payments store is pinned to what line ⑨ read. The stored request's fingerprint is
  checked. Each one alone stopped a form of B2. Only a break of all three paid INV-1002.
- **A test that passed for the wrong reason.** In the database, intake-fte, the tests' own agent,
  is a login only while a test plants it. A release by user_123 outside the plant invalidated the
  proposal, because the agent that asked "has no login now". The `READY` test passed for that
  reason, not for the rule. Its message is pinned now.
- **Masking hides the cause from a low clearance.** intake-fte's clearance is below `internal`, so it
  hears `APPROVAL_INVALIDATED` without the words (D17). The database tests that read a cause release
  as user_123.
- **A lost race needs the database.** In memory, two releases at once never both pass the gate. The
  database test holds the proposal's row from a third connection, so both releases pass the gate and
  wait at the move. One moves it. The other finds it moved, and hears `CONFLICT`.

### Left open on purpose

- **A vendor's status.** The map said step 31 is done when suspending VENDOR-44 after the approval
  invalidates the proposal. DSoR keeps no vendor record yet: that is a precondition, step 32's idea.
  So this step is done when a stricter rule makes INV-2012 `INVALIDATED` (D1). The map's "done
  when" changes with this step.
- **`READY` to `INVALIDATED`.** §26.2's picture does not draw this move. This step adds it (D6), as
  step 25c added `READY` to `CANCELLED`. A question for the specification.
- **No `propose_only` for a release.** DSOR-OPR-05 says every command takes the three modes. This
  step refuses one (D13). A question for the specification.
- **Releasing DSoR's own work** (D14), **suspending at the release** (D16), and **whether an
  approver must still hold the role** at the release: this step reads the role the approval
  recorded.
- **`strict_version` binding** for a `CRITICAL` operation (DSOR-APR-03e, L3), **revoking an
  approval** (DSOR-APR-04b), and **superseding a proposal** with a changed one (DSOR-APR-12).
- **The intent record before the work, and an outcome that is not known:** steps 36 and 40. Until
  then, the work runs inside the claim, as every command's does since step 20.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-APR-03a | The release checks the stored request's preconditions, controls, segregation of duties, limits, delegation, and operational controls again, on current state | [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution) | A brake, a demoted signer, a new exchange rate, a changed invoice, and a planted approval by the slip's signer, each after the approval, each invalidates. [`test/recheck.test.ts`](test/recheck.test.ts), [`test/release.db.test.ts`](test/release.db.test.ts) |
| DSOR-APR-03b | Each approval the rules ask for now is met by approvals of the role and quorum they ask for now | [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution) | Two CFOs asked, one counts: invalidated. Another role asked: cfo_100's approval does not count. One CFO asked, in version 9: the payment is made. [`test/recheck.test.ts`](test/recheck.test.ts), [`test/release.db.test.ts`](test/release.db.test.ts) |
| DSOR-APR-03c | A failed check, an unmet approval, a new rule's outcome, or a fingerprint that does not verify moves the proposal to `INVALIDATED`, without running | [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution) | A new rule, `APPROVED` and `READY` alike; a changed invoice, before any work; a stored request changed behind the trigger's back. Nothing drafted, the booking released. [`test/recheck.test.ts`](test/recheck.test.ts), [`test/release.db.test.ts`](test/release.db.test.ts) |
| DSOR-APR-03d | A rule with a new version is checked in its new version, and the record names both | [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution) | The release's record names version 9 in its controls, and version 8 in `approved_under`. [`test/recheck.test.ts`](test/recheck.test.ts) |
| DSOR-APR-10 | `proposal.execute` runs the stored request | [§26.1](../../../specs/dsor/03-execution.md#261-one-model) | The agent's approved INV-1008 and the prepared INV-1009 are drafted as they were stored, in memory and on the database. [`test/release-run.test.ts`](test/release-run.test.ts), [`test/release.db.test.ts`](test/release.db.test.ts) |
| DSOR-APR-11 | An agent never releases a proposal made under another slip | [§26.1](../../../specs/dsor/03-execution.md#261-one-model) | firm-ap-fte, under `del_101`, cannot release the agent's INV-1008, made under `del_100`. [`test/release.test.ts`](test/release.test.ts) |
| DSOR-APR-13 | `proposal.execute` takes no request from its caller | [§26.1](../../../specs/dsor/03-execution.md#261-one-model) | Another invoice, a new amount, a whole request, or a version beside the proposal: refused at line ⑥. [`test/release.test.ts`](test/release.test.ts) |

**Next:** step 32 · Preconditions and one attempt at a time. Conditions that must be true right
now, written in CEL, such as "the vendor is approved". Only one attempt may be open on a payment.
Then suspending VENDOR-44 after an approval can invalidate a proposal, the release's check that
this step could not build yet.
