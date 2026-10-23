# Step 41b · Replace a waiting proposal

**New in this step:** a new request can replace one that still waits. The new request names the old
one, and in one step the old one is withdrawn, with its lines and its share of the day's limit, and
the new one is checked from the start. The old request itself never changes (DSOR-APR-12).

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
  proposal. `supersedes` is the field that names it.
- `CANCELLED` is the state of a proposal that was withdrawn and will never run (§26.2).
- A *transaction* is a group of database changes that are kept together or not at all. A
  *savepoint* is a mark inside a transaction: DSoR can undo the changes made after it and keep the
  ones made before.
- A *trigger* is a rule the database itself runs on every change of a table, for every login.
- The company's *ending lock* is a lock that DSoR takes before it withdraws a waiting proposal or
  gives back its booking. Only one call holds it at a time in one company (step 25c).
- A *tear-up* is `delegation.revoke`, which ends a slip and withdraws its waiting work (step 25).
  The *sweep* is `proposal.expire_due`, which ends waiting proposals whose time has come (step 25c).
- A *dry run* is a call in `validate_only` mode: DSoR answers what it would do, and changes nothing
  (step 23).
- *Lines ⑥, ⑧, ⑨, and ⑩* are steps of the checklist every command runs (§21): ⑥ checks the input,
  ⑧ makes the proposal, ⑨ reads the records, ⑩ applies the rules and the limits.
- A run's *fingerprint* is the hash of its list of lines, in their order (step 41).

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

1. **One wrong line holds eleven good bills for a week.** The run waits until 2026-10-13, seven
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
| C3 | Who and when. The old proposal must be the company's: else `TENANT_MISMATCH`. It must be there: else `RESOURCE_NOT_FOUND`. It must have been asked for by this caller: a person by the same person, an agent by the same agent under the same slip; else `AUTHORIZATION_DENIED`. It must not be a line of a run, nor DSoR's own work, and it must be `READY`, `PENDING_APPROVAL`, or `APPROVED`; else `CONFLICT` |
| C4 | One transaction, in this order: the company's ending lock, and the new request's bills' locks; for a run, its lines' proposals; then, as one part a refusal undoes, the checks of C3; the old proposal and each of its lines move to `CANCELLED`, each move recorded with the new proposal as its cause; the old booking is given back; then the new command's whole checklist. The new one then waits: `READY`, or for its approval. It never runs in the call that replaces; it runs at its release (D12). Any proposal: a single `payment.create` or a run, either way |
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
- **D12. A replacement never runs at once** (the learner's answer to Q1, 2026-10-23, after the
  review's H1). A command with `supersedes` makes its proposal and stops: `READY`, or waiting for
  its approval, in either mode. The company's code runs only when it is released. So no code can
  refuse in the call that replaces, and a refused replacement is always a refusal of its checks,
  which changes nothing (D6). The other ways were to let the replacement stand when the code
  refuses, or to undo it after the code too. *Downside:* a replacement that needs no one costs one
  more call, its release.

### What follows from rules already built

These are the design's, not choices:

- **The order inside the one transaction:** take the lock (the company's ending lock, see below); check it may be replaced; move it
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
| C4 | A run replaced by a run, a draft by a draft, a draft by a run, and a run by a draft: the old one and its lines `CANCELLED`, each record naming the new one; its booking given back; the new one waits or runs; replacing an `APPROVED` run cancels its approval too; a replacement that needs no one waits `READY`, the code is not called, the same key replays `READY`, and its release drafts it (D12) |
| C5 | A new run with a suspended vendor, and one over the day's limit, are refused: the old run still waits with its lines, and its booking is held; the new one is `DENIED`; the record of the refusal is written |
| C6 | 150,000 booked, the new 135,000 fits once the old is given back; two replacements of one run at once on PostgreSQL: one wins, one hears `CONFLICT`, and the day holds one booking |
| C7 | cfo_100 approves the replaced run: `CONFLICT`, naming the new one; the agent releases a replaced `APPROVED` run: the same; no event |
| C8 | As `dsor_runtime`, a line moved to `CANCELLED` alone is refused; with its run, it passes; a tear-up cancels a waiting run and every line |
| C9 | A dry run of a replacement that the real call would allow says so, and changes nothing; one the real call refuses is refused with the same code |

Most of the tests of C4 to C9 run on PostgreSQL too, where the database holds the rule: the
savepoint, the lock, the trigger, and the booking.

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

## What changed since step 41

| File | What changed |
| --- | --- |
| `src/supersede.ts` | **New.** The look at the old proposal: is it there, who may replace it, what it is, and its state (C3); its cancel, with its lines and its booking (C4); and, for a dry run, the stores as the replacement would leave them (C9) |
| `src/request.ts` | The envelope may carry `supersedes`, read once at line ①: a proposal's address (C1) |
| `src/pipeline.ts` | `supersedes` refused on a query, a release, and DSoR's own work, and checked against the company with the input's addresses; the claim's ending lock; the replacement and the new command's checks as one part a refusal undoes alone; the dry run of a replacement (C1, C3 to C6, C9) |
| `src/claims.ts` | The claim keeps `supersedes` and compares it (C2); memory's undoable part, and its undo of a replaced proposal's booking after an accident (C5) |
| `src/proposals.ts` | A proposal keeps `supersedes`; the store's ending lock and `replacedBy` (C1, C6, C7) |
| `src/limits.ts` | Memory's `restore` of a booking given back; `fits` with a booking a dry run counts as given back (C5, C9) |
| `src/approve.ts`, `src/release.ts`, `src/revocation.ts` | An approval and a release of a replaced proposal name the new one (C7); a tear-up cancels a run before its lines (C8) |
| `src/postgres.ts`, `migrations/046_supersedes.sql` | **New migration.** The `supersedes` column of proposals and of claims, written once; its checks; the savepoint; the ending lock; `replacedBy`; the trigger's rule that a line moves to `CANCELLED` only with its run (C1, C2, C4 to C8) |
| `src/main.ts` | The story's scene of a run replaced while it waits |
| `test/replace.test.ts`, `test/replace.db.test.ts`, `test/supersede.test.ts` | **New.** The claims in memory and on PostgreSQL; the cancel alone, with a store that moved on |
| `test/helpers.ts`, `test/store-map.test.ts`, `store.json`, `test/audit.db.test.ts`, `test/owner-attempts.ts`, `test/owner-runs.ts` | The earlier lists of the envelope's fields, the store's columns, and the privileges name `supersedes`; the owner ends a run before its lines; the owner tries to change what a proposal replaces. Each says "Changed in step 41b" |

```bash
git diff --no-index ../mj_41_a_payment_run/src src
git diff --no-index ../mj_41_a_payment_run/test test
git diff --no-index ../mj_41_a_payment_run/migrations migrations
```

## Run it

As in step 41: a local PostgreSQL 17 and a new database of its own. Migration 046 is new.

```bash
pnpm install
pnpm migrate
pnpm test:db test/replace.db.test.ts
pnpm start          # the story; near its end, a run replaced while it waits
```

Near its end, `pnpm start` shows the scene, in memory, after step 41's run. The ids of proposals
change from run to run; they are shortened here:

```text
a run replaced while it waits, in memory, in a world of its own:
  the agent proposes INV-1002, INV-1008, and INV-1006: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  INV-1006 is wrong; the agent proposes the other two, superseding the first: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
    the first run is CANCELLED, its lines CANCELLED, CANCELLED, CANCELLED: "replaced by proposal dsor://org_456/proposal/prop_4491e071-…"
  cfo_100 approves the first run, as her screen showed it: CONFLICT: proposal prop_8ac1173c-… was replaced by proposal dsor://org_456/proposal/prop_4491e071-…, so it is not approved
  she approves the second run, 40300.50 USD: answered, apr_b1b76015-…
```

## Break it

### The learner's predictions, run for real

A real run on 2026-10-23, on this step's own code, in memory, in a copy. The week's 12 bills of
"Why it matters" are added to the world, 187,250.00 USD in all. The note gives the amounts of
INV-3003, INV-3005, INV-3008, INV-3012, and INV-3031; the other seven amounts are the script's own,
chosen so the total matches. The words are DSoR's own; the ids are this run's:

```text
P1. accounts-payable-fte's run of 12 lines waits: PENDING_APPROVAL
  booked: 187250.00 of 200,000 USD
  the agent proposes the 11 good lines, superseding it: PENDING_APPROVAL
  the old one: the run CANCELLED; its lines: 12 CANCELLED
  the new one: the run PENDING_APPROVAL; its lines: 8 READY, 3 PENDING_APPROVAL
  booked after: 186075.00 USD

P2. cfo_100 approves the old run with its fingerprint and totals:
  DSoR answers: CONFLICT: proposal prop_c8ab26ee-66c8-4a5b-a88e-fc4d5b46ca7a was replaced by proposal dsor://org_456/proposal/prop_85f7f368-4b66-497d-a731-f550ab99f739, so it is not approved
  after: the run CANCELLED; its lines: 12 CANCELLED

P3. cfo_100 approves the run of 12: COMMITTED "APPROVED"
  user_123 proposes the 11 lines, superseding it: AUTHORIZATION_DENIED: user_123 may not replace proposal prop_17df8280-868b-4cf3-a048-0dbc1a3cd7fd: user_123 did not ask for it
  after: the run APPROVED; its lines: 3 APPROVED, 9 READY
```

| | The learner's answer | What the run shows |
|---|---|---|
| P1 | The new run waits; 186,075.00 booked | Right: `PENDING_APPROVAL`, and the day holds 186,075.00. The old run and its 12 lines are `CANCELLED`, and its 187,250.00 went back first |
| P2 | Refused, naming the new run; the old run stays `CANCELLED` | Right: `CONFLICT`, naming the new run's address, and the old run and its lines stay `CANCELLED` |
| P3 | Refused; the old run is still `APPROVED` | Right: `AUTHORIZATION_DENIED`, because user_123 did not ask for the agent's run (D5). The run and its lines are as they were |

All three were right.

### The breaks

Each break was run for real, on 2026-10-23, on the final code, in a copy of this step on a new
database: change one thing, migrate, run `test/replace.test.ts` and `test/supersede.test.ts`, then
`test/replace.db.test.ts`, and count the tests that fail. A break is caught when at least one fails.
With no break, none fails. The last column says whether the break also stops `tsc --noEmit`: a break
that leaves a name unused does.

| Break | What it changes | Unit tests that fail | Database tests that fail | Typecheck fails |
|---|---|---|---|---|
| B1 | The claim does not compare `supersedes` | 2 | 1 | yes |
| B2 | Any caller may replace a proposal, not only its requester | 6 | 0 | yes |
| B3 | An agent may replace work done under another slip | 1 | 0 | yes |
| B4 | A line of a run may be replaced alone | 1 | 0 | yes |
| B5 | Any state may be replaced, not only the three of D3 | 12 | 2 | no |
| B6 | The old proposal's lines are not cancelled with it | 13 | 5 | no |
| B7 | The old booking is not given back | 8 | 2 | no |
| B8 | A refused replacement keeps the old one cancelled: no savepoint | 3 | 3 | yes |
| B9 | The old one is cancelled after the new command's checks, not before | 18 | 5 | no |
| B10 | The approval and the release of a replaced proposal do not name the new one | 2 | 2 | yes |
| B11 | Migration 046: a line may move to `CANCELLED` without its run | 0 | 1 | no |
| B12 | A dry run ignores `supersedes` | 7 | 1 | yes |
| B13 | The new proposal does not keep `supersedes` | 20 | all 20 | no |

B13's database count is all of them: the first tests fail on what they check, and the break leaves a
run `EXECUTING` beside lines still `READY`, which the owner's clean-up between tests cannot end, so
every later test's set-up fails too.

Twelve more, beyond the design's list, for the parts the list did not reach, for the review's
findings, and for D12:

| Break | What it changes | Unit tests that fail | Database tests that fail | Typecheck fails |
|---|---|---|---|---|
| B14 | A replacement takes no ending lock | 1 | 1 | no |
| B15 | Memory does not hold a replaced proposal's booking again after an accident | 1 | 0 | no |
| B16 | A tear-up cancels in the order of the ids, lines before their run | 1 | 1 | yes |
| B17 | Migration 046: the trigger lets `supersedes` change | 0 | 1 | no |
| B18 | Another company's address in `supersedes` is not refused | 1 | 0 | no |
| B19 | A move that finds the old proposal moved on is not refused | 1 | 0 | yes |
| B20 | A single draft's replacement takes the new bill's lock last (review, M1) | 0 | 1 | no |
| B21 | One person may replace another person's direct request (review, M5) | 1 | 0 | no |
| B22 | Line ① does not check that the address names a proposal (review, L2) | 1 | 0 | no |
| B23 | A refused run's lines do not name the line that refused (review, L5) | 1 | 0 | yes |
| B24 | A replacement runs at once, as before D12 | 6 | 1 | no |
| B25 | The database's replay refuses a kept `READY` for a replacement in `execute` mode | 0 | 1 | no |

**B19 first left every test green**, but for the typecheck. Its only test was the database race of
a release and a replacement, eight rounds, and none landed between the replacement's look and its
move. So `test/supersede.test.ts` gives the cancel a store whose move finds the proposal moved,
every time: with B19 one test fails, without it both pass.

B11, B17, B20, and B25 are rules of the database, of its locks, or of its claim, so only the
database tests catch them. B20's test needs its 30 rounds: 12 rounds did not hit the deadlock.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real run of step 41's code: one wrong line holds a run of 12 |
| 2 | Decide | Eleven decisions by the learner, D1 to D11, asked one at a time; D12 after the review |
| 3 | Predict | P1 to P3, asked as stories before any code |
| 4 | The copy | Step 41 copied, its markers removed |
| 5 | Build, piece by piece | Seven pieces, each with its tests written first and seen red: the design; `supersedes` in the envelope; who and when; the replacement in one transaction; the refusal that names the new one; the dry run; the database; then the story's scene |
| 6 | Break it | P1 to P3, then the breaks, for real |
| 7 | Review | A reviewer who had not seen the conversation; its findings fixed, red first; H1 answered by the learner's D12, then built red first |

To start it in a new session:

```text
Build step 41b in learner mode from the design in
docs/baby_steps_tutorials/mj_41b_replace_a_waiting_proposal/README.md and the decisions in
docs/baby_steps_tutorials/mj_41b_why_this_step.md.
```

## Check yourself

1. A run of 12 waits for cfo_100, and one bill is wrong. Why may DSoR not take that bill out of the
   stored run?
2. The agent's replacement is refused because a vendor of the new run is suspended. What happens to
   the old run, its lines, and its booking?
3. Why does DSoR give the old booking back before it checks the new total, and not after?
4. user_123 signed del_100, the agent's slip. Why may she not replace the agent's waiting run?
5. Two replacements of one run arrive at the same moment. What stops both from winning?

<details>
<summary>Answers</summary>

1. cfo_100's approval, if she gave it, was for 12 lines and their totals. An edited list would seem
   to carry an approval she never gave. A change is a new proposal, which she approves again
   (DSOR-APR-12, §8).
2. Nothing changes: the old run still waits, with every line, its bills, and its booking. The
   replacement and the checks are one part that a refusal undoes (D6, C5).
3. Otherwise the old booking would count against the new one, and a smaller new run could not fit
   the day where the old one fitted (D7, P1).
4. D5: only the proposal's own requester replaces it. For the agent's run that is the agent, under
   the slip it asked under (D10). user_123 drafts in her own name, with her own login.
5. The company's ending lock: the second waits, then finds the old run `CANCELLED` and hears
   `CONFLICT`. Even without the lock, the move to `CANCELLED` happens only from the state each call
   read, so only one move can succeed (C6).

</details>

## Think it through

### Found while building

- **The baseline was muddied by the build.** The first full database run started before the
  database piece was written, and a test in it ran `pnpm migrate` while migration 046 was being
  written. The database suite was run again, whole, after the piece: 714 of 717 passed. Of the three
  that failed: `program.db`'s `DSOR-AUD-04a` expects the owner to belong to other roles, as Neon's
  owner does; this machine's scratch owner is a superuser. `store.db` passed alone: its planted
  catalog changed during the run. `bank.db`'s D7 failed alone too on that database, and passed twice
  on a fresh one, for step 41's code and for this step's: open question 158, the holds left by
  earlier runs. On the final code, on a fresh database, 723 of 724 pass; the one that fails is
  `DSOR-AUD-04a`, for the superuser owner.
- **Two owners of the tests' database ended runs and lines in one statement.** `test/attempts.ts`
  and `test/owner-attempts.ts` ended every proposal in flight with one `UPDATE`. D11's rule refused a
  line whose run came later in that statement. Each now ends the proposals that are no line first.
- **Two test mistakes, not code faults.** One database test drafted a bill that the old run still
  held; another drafted a bill that waits for the CFO, so the broken code it meant to reach never ran.
  And intake-fte's clearance hides DSoR's internal words, so the tests that read those words call as
  user_123.

### What the review found

A reviewer who had not seen the conversation read the step at commit `ad553542`, with the database
piece. It made 52 small breaks of the unit tests' code, one at a time. Each finding was fixed with
its test written first and seen red, except H1, which needs the learner.

| | What it found | The fix |
|---|---|---|
| H1 | In `execute` mode, a new command that needs no approval runs the company's code at once. A refusal there undoes the code's writes, and leaves the old proposal `CANCELLED`, its booking given back, while the caller hears "refused". C5 and D6 say a refused replacement changes nothing | The learner's D12, the answer to Q1 in [`../mj_41b_why_this_step.md`](../mj_41b_why_this_step.md): a replacement never runs at once, so the code runs only at a release, a call of its own. Five tests were red first; the database's replay of such a call was red too, `INTERNAL_ERROR`, until its check of the kept answer allowed `READY` for a replacement |
| M1 | On the database, a single draft's replacement gave back the old booking, which locks the day's total, before it took the new bill's lock. A plain draft of the same bill took them the other way round: a deadlock, `INTERNAL_ERROR` | The replacement takes the new bill's lock first, as a run does. A test of 30 rounds saw `INTERNAL_ERROR` before the fix, and none after |
| M2 | A release takes no ending lock, so only the move's check of the state keeps a release and a replacement apart. No test showed it, and a comment said every mover takes the lock | A database race of a release and a replacement, 8 rounds; a unit test where the move finds the proposal moved, every time (break B19); the comment corrected |
| M3 | The tests of two replacements at once used new runs that shared a bill, so the bill's lock kept them apart, and the lock of C6 was never needed | New runs that share no bill; the loser's words say it found the old one `CANCELLED` |
| M4 | The database dry run fitted the day either way, so the database's own subtraction of the freed booking was never needed | A dry run that fits only once the old booking counts as given back |
| M5 | The person's side of D5 had no test either way | user_123 replaces her own direct draft; cfo_100, given the right to draft, may not replace it |
| L1 | A condition that could never decide | Removed |
| L2 | An invoice's address with a proposal's id passed line ①'s test of the id, and only a later check caught it, as `INTERNAL_ERROR` | A test of that address at line ① |
| L3 | The database test of the tear-up's order passed the old order one time in 18 | A unit test where the run's id comes after its lines' ids, always |
| L4 | No CHECK kept a claim's `supersedes` in its company, and two rules had no test | The CHECK, and the tests. The CHECK `proposals_line_supersedes_nothing` cannot be reached: the trigger refuses first |
| L5 | Smaller gaps: a refused run's lines' cause, a dry run of DSoR's own work, a release and a refused draft on the database | A test for each |

The review also found words that were wrong: C3 named `RESOURCE_NOT_FOUND` for another company's
address; the order of C4 left out the bills' locks; C6's test named other numbers; "lock the old
proposal" was the company's ending lock; terms were used before they were defined; and "one wrong
line locks eleven bills" used "lock" for a second meaning. They are fixed above. The branches it
named that no call can reach today, such as memory's undo of a booking made inside the undone part,
stay as guards.

### Left open on purpose

- **A release of a replacement can still be refused by the code**, as any release can. That is a
  call of its own: the new proposal ends `FAILED`, and the replacement, made in an earlier call,
  stands. The agent proposes again, without `supersedes`.
- **No `proposal.cancel`** (D1). The review found that the agent can still withdraw a waiting run in
  two calls: replace it with a small proposal in `propose_only` mode, and let that one expire.
- **No event tells the CFO** that a proposal was replaced (D8). She learns it when she acts on it.
- **Memory's undo of a booking is not locked.** On the database the day's total stays locked until
  the claim ends. In memory, a call in between could book the room that a refused replacement gave
  back for a moment. The database tests hold this rule; memory is the unit tests' store.
- **A release's refusal names the replacing proposal** to any person who may release the old one,
  though the new one may be of an operation they cannot read. Only its address leaves.
- **The specification is silent** on who may supersede, on where a command names what it replaces,
  on whether one transaction is needed, and on whether the new proposal may run at once: open
  questions 160 and 161.

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-APR-12 | A payload never changes after creation; a change is a new proposal that names the one it supersedes, which moves to `CANCELLED` | [§26.1](../../../specs/dsor/03-execution.md#261-one-model) | `test/replace.test.ts`, C1 to C7; `test/replace.db.test.ts`, C1 to C8 |

The dry run of a replacement is tested by DSOR-OPR-05's title: `test/replace.test.ts` and
`test/replace.db.test.ts`, C9. Who may replace, one transaction, the booking given back first, the
refusal that names the new one, and a line cancelled only with its run are this tutorial's rules:
those tests are titled by step 41b's decisions D3 to D12.

**Next:** Part 6, "Real front doors", which starts with step 42, a REST API.
