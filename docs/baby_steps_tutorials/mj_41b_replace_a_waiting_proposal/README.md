# Step 41b · Replace a waiting proposal

**New in this step:** a new proposal can replace one that still waits. The new command names the
old proposal in `supersedes`, and in one transaction the old one moves to `CANCELLED`, with its
lines and its booking, and the new one is checked from the start. The old payload never changes
(DSOR-APR-12).

## In plain words

A *proposal* is DSoR's record of one command and its state (step 22). Its *payload* is the request
it keeps: for a payment run, the list of bills. A payload never changes after it is made. That rule
is old: the database refuses the change.

But people make mistakes. A run of 12 bills waits for cfo_100, and one bill turns out to be wrong.
Until this step, nobody could take that bill out, and nobody could withdraw the run. While the run
waits, it holds every one of its bills, so no other attempt at them can start (step 41's claim C7).

This step adds the way out that the rules give. The agent sends a new command, here a new run of the
11 good bills, and names the old run in a field called `supersedes`. DSoR then does three things in
one transaction: it checks that this caller may replace the old run, it moves the old run and its
lines to `CANCELLED` and gives back its booking, and it checks the new run from the start. Either
all of that happens, or none of it does. The CFO's approval of the old run never carries over: she
approves the new list again.

**Words this step uses.**

- A *line* is one bill of a run. Each line is a proposal of its own, tied to its run (step 41).
- A *booking* is the amount a proposal takes from its slip's limit for one day (step 24).
- A *release* is `proposal.execute`, which runs a proposal that waited (step 31).
- The *request envelope* is what travels beside a call's input: who calls, in which company, the
  idempotency key, the mode (steps 05, 10, 20, and 23).
- A *claim* is DSoR's note that a request's idempotency key is in use, with the request's
  fingerprint. The same key with another request is refused (step 20).
- To *supersede* a proposal is to replace it with a new one. The old one is the *superseded*
  proposal.

## Why it matters

A real run on 2026-10-22, on step 41's finished code (`55b4fb9`), in memory, in a scratch copy. The
week's bills of step 41's "Why it matters" are added to the world. The labels are the script's;
the answers are DSoR's own. The ids of proposals are this run's.

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

Three things went wrong:

1. **One wrong line locks eleven good bills for a week.** The run waits until 2026-10-13, seven
   days. Until then, nobody can draft INV-3012's 42,000.00 USD for VENDOR-12, alone or in a new
   run. Vendors are paid late because of a bill that is not theirs.
2. **The only fast way out pays the wrong bill.** cfo_100 can approve all 12 lines as they are, and
   INV-3031, a copy of a paid bill, is drafted. Someone must then remember to cancel that draft by
   hand. The approval says "I approve these 12", and that is not what anyone meant.
3. **Nobody can say "stop".** Not the agent that proposed the run, not user_123, not the CFO. A
   proposal that waits can only be approved, or left to expire.

**Common mistake:** editing the waiting proposal in place. Take INV-3031 out of the stored list,
and cfo_100's approval, given for 12 lines and 187,250.00 USD, now seems to cover 11 lines and
186,075.00 USD that she never saw. The rule forbids that edit. A change is a new proposal, with
a new fingerprint, which she approves again.

## The design, before any code

### How this step was made

While designing step 41, the learner decided D8: a new run that replaces a waiting one. Checking
the design showed that D8 is a second idea, DSOR-APR-12, which holds for every proposal, not only
for runs. So the learner moved it to this step. On 2026-10-22 Claude Code showed the run above, on
step 41's code. Then the learner made the decisions D1 to D11, one question at a time, and made the
predictions P1 to P3. Step 41 was copied into this folder, its markers removed. The whole
conversation is kept in
[`../mj_41b_why_this_step.md`](../mj_41b_why_this_step.md).

### What the rules say

From [§26.1](../../../specs/dsor/03-execution.md#261-one-model):

- **DSOR-APR-12:** "A proposal's payload MUST NOT be modified after creation; a change is a new
  proposal that names the one it supersedes, and the superseded proposal moves to `CANCELLED`."
- The table of §26.1 also lists `proposal.cancel`, `proposal.reject`, and
  `proposal.revoke_approval`. This step builds none of them (D1).
- [§26.2](../../../specs/dsor/03-execution.md#262-lifecycle) says `CANCELLED` means "withdrawn,
  superseded, or its delegation was revoked or expired".

From [§8](../../../specs/dsor/01-model.md#8-batch-operations): "A changed manifest is a new proposal
(§26.1), so an approval can never carry over to it." The specification's `proposal.schema.json`
has a field `supersedes`: the address of the proposal that this one replaces.

The first half of DSOR-APR-12 is built already. The database's trigger refuses any change to a
payload (step 22 on), and a run keeps its fingerprint and totals for good (step 41). No test is
titled by the rule yet; this step adds those titles.

### The claims

| Claim | What it says |
|---|---|
| C1 | `supersedes` travels in the request envelope, beside `mode` and `idempotency_key`. Line ① checks that it is a proposal's address. Only a command that runs the company's code takes it: a query, a release, and DSoR's own work refuse it. The new proposal keeps it beside its payload, written once. The payload and its hash are the bills only |
| C2 | The claim keeps `supersedes` beside the fingerprint and the mode. The same key with another `supersedes`, or with none, is `IDEMPOTENCY_CONFLICT`. The same key with the same request replays |
| C3 | Who and when. The old proposal must be the company's, and there: else `RESOURCE_NOT_FOUND`. It must have been asked for by this caller: a person by the same person, an agent by the same agent under the same slip; else `AUTHORIZATION_DENIED`. It must not be a line of a run, nor DSoR's own work, and it must be `READY`, `PENDING_APPROVAL`, or `APPROVED`; else `CONFLICT` |
| C4 | One transaction, in this order: the lock; the checks of C3; the old proposal and each of its lines move to `CANCELLED`, each move recorded with the new proposal as its cause; the old booking is given back; then the new command's whole checklist. The new one then waits, or runs, as its own checks say. Any proposal: a single `payment.create` or a run, either way |
| C5 | A refused replacement changes nothing of the old proposal: it still waits, with its lines, its invoices, and its booking. The new proposal ends `DENIED`, the claim keeps the refusal, and the refusal is recorded before the answer |
| C6 | The old booking is given back before the new total is booked, so the new one may use that room. Two replacements of one proposal at once: one wins, the other hears `CONFLICT`, and the freed room is used once |
| C7 | An approval or a release of a replaced proposal is refused with `CONFLICT`, and the answer names the new proposal. No event is written |
| C8 | On the database, a line moves to `CANCELLED` only with its run. A tear-up of a slip cancels a waiting run first, then its lines |
| C9 | A dry run of a replacement answers what the real call would: it checks C3, then the new command as if the old one were cancelled, and changes nothing |
| C10 | What it does not do: withdraw a proposal with nothing new (`proposal.cancel`), reject one, revoke an approval, carry an approval over, or tell the CFO before she acts |

### Decisions

The learner's decisions, 2026-10-22, each asked one at a time.

- **D1. Replace only.** The step builds DSOR-APR-12: a new proposal names the waiting one it
  replaces. `proposal.cancel`, a withdrawal with nothing new, is not built. *Downside:* a run that
  is not wanted at all still waits until it expires.
- **D2. Any proposal** may be replaced: a single `payment.create` or a run, and either by either.
  *Downside:* more cases to test, such as a single draft replaced by a run.
- **D3. Until it executes.** A proposal may be replaced while it is `READY`, `PENDING_APPROVAL`, or
  `APPROVED`. Never once it is `EXECUTING`, because from there the bank may already hold the
  instruction, and never from a final state (DSOR-APR-01c). An approval is cancelled with its
  proposal and never carries over (§8). *Downside:* the CFO's work on the old one is lost.
- **D4. A field on the new command.** The new command carries `supersedes`, the address of the old
  proposal, and the new proposal keeps it, as `proposal.schema.json` has it. One call makes the new
  one and cancels the old one. *Downside:* every command gains one optional field to check.
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
- **D9. `supersedes` travels in the request envelope**, beside `mode` and `idempotency_key`: it
  says how to treat the call, not what to pay. The payload stays the bills, so no input schema
  changes, and the proposal keeps `supersedes` beside its payload. *Downside:* the idempotency
  claim must compare it too, or the same key with another `supersedes` would replay silently.
- **D10. For an agent, "own requester" is the same agent under the same slip**, as DSOR-APR-11
  binds a release (step 31). *Downside:* a new slip cannot replace work done under the old one;
  tearing up the old slip cancels that work anyway (step 25).
- **D11. On the database, a line moves to `CANCELLED` only with its run**, one rule more in the
  trigger of migration 045's kind. *Downside:* one more rule, with its test and its break.

### What follows from rules already built

These are the design's, not choices:

- **The order inside the one transaction:** lock the old proposal; check it may be replaced; move it
  and its lines to `CANCELLED` and give its booking back; then run the new command's checklist. So
  the new proposal's check for an attempt in flight no longer sees the old one's invoices. Any
  refusal rolls all of it back (D6).
- **Two replacements of one proposal at once:** the lock makes the second wait. It then finds the
  old one `CANCELLED`, and hears `CONFLICT`.
- **The refusal is still recorded** before the answer (DSOR-EXE-02), as every refusal is.
- **Bad addresses answer as `proposal.approve` does today.** See the first point below.

### Found while checking the design

Checking the design against the code and the rules found six points. None changes a decision.

- **Another company's address answers `TENANT_MISMATCH`, as `proposal.approve` does.** The note of
  the decisions says "one of another company is `RESOURCE_NOT_FOUND`". But `proposal.approve` never
  gets that far: every address a call names is checked against the active company first, and one of
  another company is refused with `TENANT_MISMATCH` (step 10). `supersedes` gets the same check, so
  a replacement answers as an approval does. An address of this company that names no proposal is
  `RESOURCE_NOT_FOUND`.
- **Only the company's code is replaced, and only by the company's code.** The rule's "change" is
  a new request for the same work. A release (`proposal.execute`) makes no new request, and DSoR's
  own work, such as a rule or a brake prepared in `propose_only` mode, is never released (step 31's
  D14). So `supersedes` on a query, a release, or DSoR's own command is refused with
  `VALIDATION_FAILED`, and an old proposal of DSoR's own work is refused with `CONFLICT`.
- **The lock is the company's ending lock.** A tear-up, the expiry sweep, and an approval each take
  it before they move a waiting proposal or give a booking back. Two movers that took locks in
  different orders could each wait for the other for ever (step 25c's review, M1). A replacement
  moves a waiting proposal and gives its booking back, so it takes the same lock, after the brake's
  and the slip's, as a tear-up does.
- **"Rolls it back" needs a savepoint.** A refusal of the new command is kept with the claim: the
  new proposal ends `DENIED`, and a retry with the same key hears the same refusal (DSOR-IDM-01c).
  So the claim's transaction commits, and only the replacement's part must be undone. The database
  takes a savepoint before the old one moves, and rolls back to it on a refusal. Memory has no
  transaction, so it undoes those moves and that booking itself. A run's lines are made before the
  savepoint, so a refused run still keeps every line, `DENIED` (step 41's claim C3).
- **D11 changes the tear-up.** A tear-up cancels its slip's waiting work in the order of the
  proposals' ids. A line whose id comes before its run's would be cancelled first, and the trigger
  of D11 would refuse it. So a tear-up now cancels a run first, then its lines.
- **A dry run of a replacement answers as the real one would** (DSOR-OPR-05, DSOR-OPR-06). Step 41's
  review, H1, found a dry run of a run that answered `ALLOW` while the real run was refused. A dry
  run that ignored `supersedes` would answer `CONFLICT` for the invoices the old one holds, while the
  real call passes. So the dry run checks who and when, then the new command as if the old one were
  cancelled: its proposals and their booking are left out of what it counts. It takes no lock and
  books nothing.

### This tutorial's decisions, where the rules are silent

- **The field's name** in the envelope is `supersedes`, the name `proposal.schema.json` gives it.
- **The cause of the old proposal's move** names the new one: `replaced by proposal <address>`.
  A line's move says `its run was replaced by proposal <address>`.
- **A due proposal may be replaced.** A proposal whose time has come, before the sweep has moved
  it, is still waiting. A replacement cancels it, where the sweep would have expired it. Either way
  it ends, with its booking given back.

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | A `supersedes` that is not a proposal's address is refused at line ①; another company's is `TENANT_MISMATCH`; on a query, a release, or DSoR's own command it is refused; the new proposal keeps it, and its payload hash is the bills' |
| C2 | The same key with another `supersedes`, or none, is `IDEMPOTENCY_CONFLICT`; the same key and the same request replays and makes nothing new |
| C3 | No such proposal; another requester; another agent; the same agent under another slip; a line of a run; DSoR's own work; each state that may not be replaced: each refused with its code, and the old one unchanged |
| C4 | A run replaced by a run, a draft by a draft, a draft by a run, and a run by a draft: the old one and its lines `CANCELLED`, each record naming the new one; its booking given back; the new one waits or runs; replacing an `APPROVED` run cancels its approval too |
| C5 | A new run with a suspended vendor, and one over the day's limit, are refused: the old run still waits with its lines, and its booking is held; the new one is `DENIED`; the record of the refusal is written |
| C6 | 187,250 booked, the new 186,075 fits once the old is given back; two replacements of one run at once on PostgreSQL: one wins, one hears `CONFLICT`, and the day holds one booking |
| C7 | cfo_100 approves the replaced run: `CONFLICT`, naming the new one; the agent releases a replaced `APPROVED` run: the same; no event |
| C8 | As `dsor_runtime`, a line moved to `CANCELLED` alone is refused; with its run, it passes; a tear-up cancels a waiting run and every line |
| C9 | A dry run of a replacement that the real call would allow says so, and changes nothing; one the real call refuses is refused with the same code |

The tests of C4 to C6 run on PostgreSQL too, where the database holds the rule: the savepoint, the
lock, the trigger, and the booking.

### The learner's predictions

Asked as stories, before any design or code. A real run settles each one after the build.

| | The story | The learner's answer |
|---|---|---|
| P1 | The 12-line run waits for cfo_100, booked 187,250.00 of the 200,000 USD day. The agent proposes the 11 good lines, 186,075.00 USD, with `supersedes` naming the old run. What does DSoR answer, and how much of the day is booked after? | The new run waits; 186,075.00 booked |
| P2 | After P1, cfo_100 approves the old run with its fingerprint and totals. What does she hear, and what happens to the old run? | Refused, naming the new run; the old run stays `CANCELLED` |
| P3 | The run of 12 is `APPROVED`. user_123, not the agent, proposes the 11 lines with `supersedes` naming it. What does he hear, and what state is the old run in after? | Refused; the old run is still `APPROVED` |

### The breaks

| Break | What it removes |
|---|---|
| B1 | The claim does not compare `supersedes` |
| B2 | Any caller may replace a proposal, not only its requester |
| B3 | An agent may replace work done under another slip |
| B4 | A line of a run may be replaced alone |
| B5 | Any state may be replaced, not only the three of D3 |
| B6 | The old proposal's lines are not cancelled with it |
| B7 | The old booking is not given back |
| B8 | A refused replacement keeps the old one cancelled: no savepoint |
| B9 | The old one is cancelled after the new command's checks, not before |
| B10 | The approval of a replaced proposal does not name the new one |
| B11 | Migration 046: a line may move to `CANCELLED` without its run |
| B12 | A dry run ignores `supersedes` |
| B13 | The new proposal does not keep `supersedes` |

The rest of this README comes with the build, piece by piece.
