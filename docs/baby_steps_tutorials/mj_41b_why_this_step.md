# Step 41b · Why this step: a new run that replaces a waiting one

This note keeps the context of step 41b before any design or code. A new session can start
from it. It holds the problem, a real run of it, what the rules say, what is built today, and
the questions for the learner. It decides nothing: every decision below is the learner's.

## Where we are

- **Part 5 is complete.** The tutorial's map ends Part 5, "Actions that cannot be undone", with
  step 41, and says "Stage 5 is complete" there. Step 41 is on GitHub at `55b4fb9`.
- **Step 41b is the learner's own extra step.** While designing step 41, the learner decided D8:
  a new run that replaces a waiting one. Checking the design showed that D8 is a second idea,
  DSOR-APR-12, which holds for every proposal, not only for runs. So the learner moved it to a
  step of its own (step 41's README, decision D8).
- **After 41b comes Part 6**, "Real front doors", which starts with step 42, a REST API.

## The problem, in plain words

A *proposal* is DSoR's record of one command and its state (step 22). After step 41, a payment
run that waits for the CFO holds every one of its invoices: while it waits, no other attempt at
those invoices can start (step 41's claim C7).

Now one line of the waiting run turns out to be wrong. Nobody can take that line out. Nobody can
withdraw the run either: DSoR has no command for it. So the run's good bills are locked too. The
only ways out are to wait until the run expires, or to have the CFO approve a list with the wrong
line in it.

## The problem, run for real

A real run on 2026-10-22, on step 41's finished code (`55b4fb9`), in memory, in a scratch copy.
The week's bills of step 41's "Why it matters" are added to the world. The labels are the
script's; the answers are DSoR's own. The ids of proposals are this run's.

```text
Monday 15:05. accounts-payable-fte proposes a run of 12 lines, INV-3003, INV-3005, INV-3006, INV-3007, INV-3008, INV-3010, INV-3012, INV-3023, INV-3031, INV-3032, INV-3035, INV-3036:
  DSoR answers: PENDING_APPROVAL; totals 187250.00 USD; it waits until 2026-10-13T15:05:00.000Z
  the run PENDING_APPROVAL; its lines: 9 READY, 3 PENDING_APPROVAL

Monday 15:20. user_123 finds INV-3031 (VENDOR-31, 1,175.00 USD) is a copy of a bill already paid. It must leave the run.
  the agent proposes the 11 good lines as a new run: CONFLICT: line 1 of "payment.run": invoice INV-3003 has an attempt in flight already: proposal dsor://org_456/proposal/prop_308a456c-a6d1-4f7b-ac8a-306ec592b524, READY
  the agent asks to cancel the waiting run: UNSUPPORTED_CAPABILITY: no operation named "proposal.cancel"
  user_123 asks to cancel it: UNSUPPORTED_CAPABILITY: no operation named "proposal.cancel"
  user_123 drafts INV-3012 (42,000.00 USD) alone: CONFLICT: invoice INV-3012 has an attempt in flight already: proposal dsor://org_456/proposal/prop_38c86345-97ac-4d5d-97d4-2b2efd61dc5e, PENDING_APPROVAL
  cfo_100 rejects the run: UNSUPPORTED_CAPABILITY: no operation named "proposal.reject"
  after: the run PENDING_APPROVAL; its lines: 9 READY, 3 PENDING_APPROVAL; drafts: 0

The one way to pay the 11 today: cfo_100 approves all 12 as they are, and the agent releases:
  cfo_100 approves: APPROVED
  the agent releases: COMMITTED; drafts: 12, INV-3031's among them: true
```

## Why it matters

1. **One wrong line locks eleven good bills for a week.** The run waits until 2026-10-13, seven
   days. Until then, nobody can draft INV-3012's 42,000.00 USD for VENDOR-12, alone or in a new
   run. Vendors are paid late because of a bill that is not theirs.
2. **The only fast way out pays the wrong bill.** cfo_100 can approve all 12 lines as they are,
   and INV-3031, a copy of a paid bill, is drafted. Someone must then remember to cancel that
   draft by hand. The approval says "I approve these 12", and that is not what anyone meant.
3. **Nobody can say "stop".** Not the agent that proposed the run, not user_123, not the CFO.
   A proposal that waits can only be approved, or left to expire.

## What the rules say

From [§26.1](../../specs/dsor/03-execution.md#261-one-model):

- **DSOR-APR-12:** "A proposal's payload MUST NOT be modified after creation; a change is a new
  proposal that names the one it supersedes, and the superseded proposal moves to `CANCELLED`."
- The table of §26.1 lists `proposal.cancel`, a command for "the requester or a tenant
  administrator", with the input `{ proposal, reason }`. It also lists `proposal.reject`, for an
  approver, and `proposal.revoke_approval`, for the approver who approved.
- [§26.2](../../specs/dsor/03-execution.md#262-lifecycle) says `CANCELLED` means "withdrawn,
  superseded, or its delegation was revoked or expired".

From [§8](../../specs/dsor/01-model.md#8-batch-operations): "A changed manifest is a new proposal
(§26.1), so an approval can never carry over to it."

The specification's `proposal.schema.json` has a field `supersedes`: the address of the proposal
that this one replaces.

## What is built today, at step 41

- A payload never changes after it is made: the database's trigger refuses it (step 22 on), and
  a run's fingerprint and totals are kept for good (step 41). The first half of DSOR-APR-12 is
  kept, but no test is titled by it yet.
- No `proposal.cancel`, no `proposal.reject`, and no `proposal.revoke_approval`. No proposal names
  another in `supersedes`.
- A proposal moves to `CANCELLED` only when its slip is torn up (DSOR-DEL-04c, step 25), with its
  booking given back.
- A waiting proposal ends `EXPIRED` after its lifetime, seven days, when `dsor-scheduler` calls
  `proposal.expire_due`. Its booking is then given back.

## What the learner leaned to during step 41

The learner's first D8, before it moved to 41b, was: a new run names the run it replaces; one
transaction cancels the old run and its lines and makes the new one; only the old run's requester
may replace it; and only before it is released. **These are to be asked again**, not taken as
decided: they were said before the rule was found to cover every proposal.

## The questions for the learner

Each is a choice that the specification leaves to the step. Ask them one at a time, with the
trade-off of each option, and wait.

1. **One idea or two?** Is the step "replace a waiting proposal" (DSOR-APR-12) only, or also
   "withdraw it with nothing new" (`proposal.cancel`)? The second is another operation of §26.1.
2. **Which proposals?** Only a run, or any waiting proposal, a single `payment.create` too? The
   rule says "a proposal".
3. **How is the replacement asked for?** A field on the new command, such as `supersedes`, or a
   command of its own? Who may ask: the requester only, also a person of the company, or also a
   tenant administrator?
4. **Until when?** Only while the old one waits for the CFO, also once it is approved, or never
   once it is executing?
5. **Together or apart?** Does the old proposal move to `CANCELLED` in the same transaction that
   makes the new one, so the invoices pass from one to the other with no gap? What if the new one
   is refused: does the old one still wait?
6. **What carries over?** Nothing of the approval may carry over (§8). What of the booking of
   the day's limit: given back and booked again, or moved?
7. **Who is told?** Does a CFO who was about to approve the old run learn that it was replaced?

## Predictions to ask, once the design is settled

Asked as stories, before any code. For example: "The run of 12 waits. The agent proposes the 11
good lines and names the old run as the one it replaces. What does DSoR answer, what state is the
old run in, and how much of the day's limit is booked after?"

## How to continue in a new session

```text
Start step 41b of the DSoR baby-steps tutorial in learner mode, on branch mjunaidca/baby-steps.
Read docs/baby_steps_tutorials/mj_41b_why_this_step.md first. Show me the problem, then ask the
questions in it one at a time and wait for my answer. Do not build anything before I decide.
```
