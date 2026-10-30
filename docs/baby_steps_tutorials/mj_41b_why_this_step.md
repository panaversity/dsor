# Step 41b · Why this step: a new run that replaces a waiting one

This note keeps the context of step 41b before any design or code. A new session can start
from it. It holds the problem, a real run of it, what the rules say, what is built today, and
the questions for the learner. Every decision in it is the learner's, asked one at a time.

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

## The learner's decisions (2026-10-22)

Asked one at a time, in this session, after the problem above.

- **D1. Replace only.** The step builds DSOR-APR-12: a new proposal names the waiting one it
  replaces. `proposal.cancel`, a withdrawal with nothing new, is not built. *Downside:* a run that
  is simply not wanted still waits until it expires.
- **D2. Any proposal** may be replaced: a single `payment.create` or a run. *Downside:* more cases
  to test, such as a single draft replaced by a run.
- **D3. Until it executes.** A proposal may be replaced while it is `READY`, `PENDING_APPROVAL`, or
  `APPROVED`; never once it is `EXECUTING`, because from there the bank may already hold the
  instruction, and never from a final state (DSOR-APR-01c). An approval is cancelled with its
  proposal and never carries over (§8). *Downside:* the CFO's work on the old one is lost.
  The learner asked how DSoR could cancel something affected by the outside world, such as a cheque
  in transit. The answer: a proposal that waits has done nothing outside DSoR yet. A payment that
  may be on its way is `EXECUTING` or `OUTCOME_UNKNOWN`, which the state picture never moves to
  `CANCELLED`; steps 37 and 38 handle it. A change in the world while a proposal waits is caught by
  the check again at the release (`INVALIDATED`, step 31).
- **D4. A field on the new command.** The new command carries `supersedes`, the address of the old
  proposal, and the new proposal keeps it, as `proposal.schema.json` has it. One call makes the new
  one and cancels the old one. *Downside:* every command's input gains one optional field to check.
- **D5. The old proposal's own requester only.** *Downside:* user_123 cannot fix a run the agent
  made.
- **D6. One transaction.** The new proposal and the old one's move to `CANCELLED` happen together,
  or neither does. A refused replacement changes nothing: the old one still waits, with its lines,
  its invoices, and its booking. *Downside:* a refused replacement leaves the old one in place.
- **D7. The old booking is given back first.** Inside the one transaction, the old proposal's
  booking of the day's limit is given back, then the new total is checked and booked. A refusal
  rolls the old booking back. *Downside:* the order must be exact, and two replacements at once
  must not both use the freed amount.
- **D8. The record and the refusal tell.** The old proposal's move to `CANCELLED` is recorded with
  its cause, the new proposal (DSOR-APR-01b). An approval or a release of the old one is refused,
  and the answer names the new one. No event is written. *Downside:* the CFO learns only when she
  acts on the old one.

## Found while checking the decisions, and settled (2026-10-22)

The learner decided three of them:

- **D9. `supersedes` travels in the request envelope**, beside `mode` and `idempotency_key`: it
  says how to treat the call, not what to pay. The payload stays the bills, so no input schema
  changes, and the proposal keeps `supersedes` beside its payload. *Downside:* the idempotency
  claim must compare it too, or the same key with another `supersedes` would replay silently.
- **D10. For an agent, "own requester" is the same agent under the same slip**, as DSOR-APR-11
  binds a release (step 31's `release.ts`). *Downside:* a new slip cannot replace work done under
  the old one; tearing up the old slip cancels that work anyway (step 25).
- **D11. On the database, a line moves to `CANCELLED` only with its run**, one rule more in the
  trigger of migration 045's kind. *Downside:* one more rule, with its test and its break.

The rest follow from rules already built, so they are the design's, not choices:

- **Order inside the one transaction:** lock the old proposal; check it may be replaced (same
  company, its requester, a state of D3, not a line); move it and its lines to `CANCELLED` and give
  its booking back; then run the new command's checklist. So the new proposal's check for an
  attempt in flight no longer sees the old one's invoices. Any refusal rolls all of it back (D6).
- **Two replacements of one proposal at once:** the old proposal's lock makes the second wait, and
  it then finds the old one `CANCELLED` and hears `CONFLICT`.
- **The refusal is still recorded** before the answer (DSOR-EXE-02), as every refusal is.
- **Bad addresses answer as `proposal.approve` does today:** no such proposal, or one of another
  company, is `RESOURCE_NOT_FOUND`; another requester is `AUTHORIZATION_DENIED`; a state that may
  not be replaced, or a line of a run, is `CONFLICT`.

## The learner's predictions (2026-10-22)

Asked as stories, before any design or code. A real run settles each one after the build.

| | The story | The learner's answer |
|---|---|---|
| P1 | The 12-line run waits for cfo_100, booked 187,250.00 of the 200,000 USD day. The agent proposes the 11 good lines, 186,075.00 USD, with `supersedes` naming the old run. What does DSoR answer, and how much of the day is booked after? | The new run waits; 186,075.00 booked |
| P2 | After P1, cfo_100 approves the old run with its fingerprint and totals. What does she hear, and what happens to the old run? | Refused, naming the new run; the old run stays `CANCELLED` |
| P3 | The run of 12 is `APPROVED`. user_123, not the agent, proposes the 11 lines with `supersedes` naming it. What does he hear, and what state is the old run in after? | Refused; the old run is still `APPROVED` |

## Questions for the learner, answered (2026-10-23)

Found by the hostile review of the build, finding H1. The build stopped here until the learner
answered.

**The learner's answer: (c), decision D12.** A new command with `supersedes` never runs at once; it
waits `READY` or for its approval. Built red first on 2026-10-23.

### Q1. The company's code refuses after a replacement passed its checks. Does the old one stay cancelled?

**The problem, run for real** on the build's own code (`9f8dadfd`), in memory, in a scratch copy. The
company's `payment.create` is made to refuse, as an accounts system might at the last moment:

```text
the agent's run of INV-1002, INV-1008, INV-1006: PENDING_APPROVAL; booked 40940.50 USD
the agent replaces it with a draft of INV-1002, and the company's code refuses: CONFLICT: the accounts system refuses INV-1002 now
after: the old run CANCELLED, its lines CANCELLED, CANCELLED, CANCELLED; the new draft FAILED; booked 0.00 USD
cfo_100 approves the old run: CONFLICT: proposal prop_e18129e6-… was replaced by proposal dsor://org_456/proposal/prop_3b2dc7a4-…, so it is not approved
```

The agent heard "no", and still the old run is gone, its bills are free, and its booking is back.
Why: D6 rolls back a replacement when the new command's **checks** refuse (lines ⑨ and ⑩). In
`execute` mode a new command that needs no approval then runs the company's code at once, in the
claim's own work, after the replacement. A refusal there undoes only the code's writes, as it has
since step 22: the new proposal ends `FAILED`, and the replacement stays. D6 says "A refused
replacement changes nothing", and the README's claim C5 says the same, so the code and the words
disagree. Only a new command that runs at once can reach this: one that waits for the CFO, or a
call in `propose_only` mode, runs no code.

**The options:**

- **(a) The replacement stands, and the answer says so.** The old proposal was replaced in its own
  right; then the new command's work failed, as any work can fail. C5 becomes "a replacement refused
  at its checks changes nothing", and the refusal's words add "proposal … was replaced first".
  *Downside:* a "no" that still changed something. The agent must propose again, without
  `supersedes`, and the CFO's approval of the old one is lost.
- **(b) The code's refusal undoes the replacement too.** The old proposal waits again, with its lines
  and its booking; the new one ends `FAILED`. *Downside:* the most code. The replacement happens at
  line ⑧, before the work's own savepoint, so both stores must undo it after the work, and memory
  imitates it by hand again. More to test, and more to break.
- **(c) A replacement never runs at once.** A new command with `supersedes` stops `READY`, as in
  `propose_only` mode, or waits for its approval; it runs only when it is released. So no code runs
  in the call that replaces, and D6 holds as written. *Downside:* a replacement that needs no one
  costs one more call, the release. The run "replaced by one draft that needs no one" no longer
  drafts at once.

**Recommendation: (c).** It keeps D6 exactly as decided, one transaction where the new one waits or
nothing changes, with the least new code. (a) is the smallest change, but it makes "refused" mean
"changed" for one path. (b) keeps the words true at the highest cost.

### Also found by the review, for the learner to know (no decision needed)

- **D1's downside is not quite true.** "A run that is not wanted at all still waits until it
  expires": the agent can replace it with any small proposal in `propose_only` mode and let that one
  expire. So a run can be withdrawn in two calls. It is still not a `proposal.cancel`.

## Next

Step 41b is built: pieces 1 to 9, D12 after the review, the breaks, and the hand-over
(`docs/status.md`, `rules-met.md`, `mj_notes.md`, open questions 160 and 161). Next is Part 6, step
42, a REST API.

## How to continue in a new session

```text
Step 41b is finished. Read docs/baby_steps_tutorials/mj_41b_replace_a_waiting_proposal/README.md
for what it built and what it left open.
```
