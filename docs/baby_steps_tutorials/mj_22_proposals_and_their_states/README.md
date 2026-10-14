# Step 22 · Proposals and their states

**New in this step:** every command call that passes line ⑦ becomes a *proposal*, a record whose
state moves only along the picture in §26.2, never out of a final state, with a record of each
move (DSOR-APR-01a, DSOR-APR-01b, DSOR-APR-01c, DSOR-IDM-04).

## In plain words

A *proposal* is one record for one attempt to change something. It says what was asked, who
asked, and where the attempt stands now: its *state*. Line ⑧ of the checklist makes it, right
after line ⑦ has claimed the call's idempotency key. The state then moves, one step at a time,
only along the picture of §26.2. In this step a command's proposal moves PROPOSED, READY,
EXECUTING, and then COMMITTED when the code answers, or FAILED when the code refuses.

A state with no way out in the picture is *final*. COMMITTED and FAILED are final, and so are
DENIED, REJECTED, EXPIRED, CANCELLED, REVOKED, INVALIDATED, COMPENSATED, and COMPENSATION_FAILED.
Once there, a proposal never moves again. Each move leaves one record in the log: who made it,
and why.

The answer names the proposal, so the caller can refer to it later. The answer now has the
specification's own shape: `outcome: "COMMITTED"`, the proposal's URI, and the payload hash.

In the office picture, every letter that asks the new clerk to do something gets a tracking page,
like an online order: placed, paid, shipped, delivered. The clerk moves the page along, one box at
a time, and writes each move in the day book. An order marked delivered is never marked "placed"
again.

## Why it matters

Tuesday, 02:07. accounts-payable-fte drafts PAY-901 for INV-1008, 31,400.00 USD. At 02:30,
user_123 asks: what happened to the agent's request, and where does it stand? Before this step,
the answer was in three places: a decision record in `dsor.audit`, a claim with its answer in
`dsor.idempotency`, and PAY-901 in `app.payments`. None of them was "this attempt, and its
state". The agent's answer named no id for the attempt, so nobody could look it up.

And it gets worse later. In step 29 the CFO must approve 31,400.00 USD, which is over the 25,000
USD threshold. "Waiting for cfo_100" needs a place to wait. If a bug could move that waiting
record straight to EXECUTING, the payment would run with no approval, and every state on the
record would still be a real state. Only the move would be wrong. So the moves are the rule, and
two guards check each one.

## The design, before any code

The learner took the decisions below on 2026-10-07, after an understanding session on the first
two parts of the step, through questions with a recommendation each. Claude Code took the
details, marked "(Claude Code)", and built the step while the learner was away. Each decision is
this tutorial's, with its downside.

The specification it relies on was read on 2026-10-07:

- [§26.1](../../../specs/dsor/03-execution.md#261-one-model): "Every command invocation in
  `execute` or `propose_only` mode creates a proposal."
- [§26.2](../../../specs/dsor/03-execution.md#262-lifecycle): the picture, its table of states,
  DSOR-APR-01a, DSOR-APR-01b, and DSOR-APR-01c. "States on the right-hand edge are final."
- [§21](../../../specs/dsor/03-execution.md#21-command-pipeline): line 8, "Create the proposal,
  or load it (proposal.execute)", after line 7, the idempotency claim.
- [§22](../../../specs/dsor/03-execution.md#22-idempotency): DSOR-IDM-04, "A proposal MUST be
  executed at most once; the proposal id is the idempotency key of its execution."
- [§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence): DSOR-AUD-01, "every
  proposal transition" produces an audit record. The audit record's schema has a kind for it:
  `proposal_transition`.
- The schemas `proposal.schema.json`, `result-envelope.schema.json`, and
  `error-envelope.schema.json`, which has a `proposal` field.

### The intent and the outcome

**Intent.** Every attempt to change something has one record, and its state moves only as the
specification draws, with a record of each move.

**Outcome.** What is true when this step is done:

1. user_123 drafts PAY-901. The answer says `outcome: "COMMITTED"`, names its proposal, and the
   proposal moved PROPOSED, READY, EXECUTING, COMMITTED: four records in the log.
2. The agent's draft decided on version 2 of INV-1008, which is at version 1: `STALE_STATE`, and
   the error envelope names its proposal, which ended FAILED.
3. The same request again, with the same key, names the same proposal, and makes none.
4. A query, or a call refused before line ⑧, makes no proposal.
5. A COMMITTED proposal refuses every other state, in DSoR's code and in the database: the map's
   "done when".

**Not the outcome of this step:**

- `proposal.get` and `proposal.list`. The tests and the program read proposals through the store.
- `propose_only`, `proposal.execute`, approvals, expiry, and the compensation states.
- Loading a proposal at line ⑧ for `proposal.execute`.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-APR-01a | **C1.** A proposal moves only along the picture of §26.2 | Unit: every pair of the 17 states, against the picture typed out again in the test. Database: every pair from each of the 14 states there is a way to, against the trigger |
| DSOR-APR-01a | **C2.** A command's proposal moves PROPOSED, READY, EXECUTING, then COMMITTED, or FAILED when the code refuses | The story's calls, in memory and on the database |
| DSOR-APR-01c | **C3.** No move leaves a final state | Unit: none of the 10 final states has a move out, in the table or in the store. Database: a COMMITTED proposal refuses all 17 states, and a FAILED one COMPENSATING |
| DSOR-APR-01b, DSOR-AUD-01 | **C4.** Every move is recorded, with its actor and its cause, as a `proposal_transition` record, in the move's own transaction | The records of each move. A move whose record cannot be written does not happen. A move with no cause or no actor is refused |
| DSOR-IDM-04 | **C5.** A proposal is executed at most once | A replay names the same proposal and makes none. Two movers to EXECUTING at the same moment, on two real connections: one wins |
| (our decision) | **C6.** A query, and a call refused before line ⑧, makes no proposal | Refusals at lines ⑤, ⑥, and ⑦, a query, and the same key with another request |
| DSOR-SCH-01 | **C7.** The answer names its proposal and passes `result-envelope.schema.json`; a refusal from the code names its proposal and passes `error-envelope.schema.json` | Both schemas, through ajv |
| (our decision) | **C8.** The proposal keeps the request as line ⑥ checked it, and nobody can change it | It passes `proposal.schema.json`. `dsor_runtime` holds UPDATE on `state` only, and the trigger refuses even the owner |
| DSOR-TEN-01b | **C9.** A proposal is read and moved only inside its company | In memory and on the database, with the company's lock |
| (our decision) | **C10.** The store map names the proposals' trigger in full | Start-up refuses it missing, switched off, or changed |

### Decisions the specification leaves to us

1. **COMMITTED and FAILED are final.** Every state on the picture's right-hand edge is final. The
   picture's last line, COMMITTED or FAILED to COMPENSATING, is not built: undoing PAY-901 is a
   new proposal, for `payment.cancel`. *Downside:* the picture's last line is not followed. A
   later step that builds compensation has to change this (open question 89).
2. **Every refusal that the claim keeps ends FAILED.** The code runs as one piece, at line ⑨,
   after the proposal is READY and EXECUTING, so a refusal inside it is a failed run. An
   accident, an INTERNAL_ERROR, or a refusal whose retry class is `safe_same_key` keeps no claim
   (step 20's README, decision 9), so it rolls the proposal back with the claim (decision 9).
   *Downside:* "INV-1001 is not issued" reads as a failed run, not a denial, until step 32 moves
   the business rule into the contract, before the work.
3. **Two guards: DSoR's code, and a trigger in the database.** `src/proposals.ts` checks each move
   before any statement. The trigger `dsor.proposal_moves()` refuses a move that the picture does
   not draw, a new proposal in any state but PROPOSED, and a change to any column but the state,
   from anyone, the table's owner too. The store map names the trigger in full, in a new kind,
   `control-moved`: the only kind on DSoR's side that may have a trigger. *Downside:* the picture
   is written twice, in TypeScript and in SQL. A database test compares the two, move by move.
   Start-up checks that the trigger is there and switched on, but not its function's body (open
   question 88).
4. **Each move is a record in the log.** One record of kind `proposal_transition` in
   `dsor.audit`, in the same transaction as the move, the way step 19b records a suspended slip.
   The first choice was a table of its own. Then DSOR-AUD-01 was found: every proposal transition
   must produce an audit record. So the log is the place, and a second table would be a copy.
   *Downside:* a proposal's history is read from the log by the proposal's URI, beside every other
   record.
5. **The answer names the proposal.** A command's answer gets `outcome: "COMMITTED"`, the
   proposal's URI, and the payload hash, so it passes the specification's
   `result-envelope.schema.json`. Step 17's decision 2 waited for this. A refusal from the code
   names its FAILED proposal in the error envelope, and the call's decision record names the
   proposal too. Only the checklist names the proposal, from what the claim gave back: no code
   can name one in a refusal of its own. `proposal.get` comes later. *Downside:* in this step, no caller can read a
   proposal through DSoR. Only the owner's tools and the tests can.
6. **At most once: the move to EXECUTING is one conditional statement.** `UPDATE … SET state =
   'EXECUTING' WHERE … AND state = 'READY'`. If two movers read READY, only one changes the row.
   *Downside:* a payment row does not name its proposal. A key passed down to the system of
   record is DSOR-IDM-03, a later step.
7. **No proposal before line ⑧.** A query makes none. A call refused at lines ① to ⑦ makes
   none, and a replay stops at line ⑦ and names the first call's proposal. *Downside:* §26.1
   says that every command invocation creates a proposal. A permission denial at line ⑤ leaves
   only its decision record (open question 91).
8. **The whole picture is built,** all 17 states and 20 moves, though this step reaches only six
   states. *Downside:* the moves that no step makes yet, such as an approval or an expiry, are
   tested as entries of the table, not through real calls.
9. **The proposal lives inside the claim's transaction (Claude Code).** Line ⑧ opens it after
   the claim's INSERT, and before the savepoint of the code's work. Its last move follows the
   savepoint. So a refusal that undoes the code's writes keeps the proposal and ends it FAILED,
   and an accident rolls back the claim, the proposal, and the work together. *Downside:* in
   memory nothing rolls back. After an accident, a proposal in memory stays EXECUTING.
10. **A proposal's id is `prop_` and a random UUID (Claude Code).** *Downside:* no order can be
    read from it, so a history is ordered by the log's own sequence.
11. **Who asked: the request's security context (Claude Code).** An agent's proposal names the
    person who signed its slip as the subject, the agent in the actor chain, the slip, and the
    role source's time. A person's names the person, in `direct` mode, with the time of the call
    and the source `token`. *Downside:* "token" for a person is this tutorial's reading: DSoR's
    own role table stands in for the scopes of a real token.
12. **Who moves it, and why (Claude Code).** The first move is the caller's. The others are
    DSoR's own, named `dsor`, on the authority the call carried, as step 19b's suspension names
    DSoR. *Downside:* PROPOSED, READY, and EXECUTING all happen at line ⑧ in this tutorial,
    though §21 puts READY after line ⑩, the controls, and EXECUTING at line 14. Steps 27 and 33
    move them.
13. **The proposal keeps the request as line ⑥ checked it (Claude Code).** Its payload is line
    ①'s copy, its resources are every URI the request names, and it passes the specification's
    `proposal.schema.json`. That schema and `security-context.schema.json` are copied byte for
    byte. *Downside:* two more copies to keep equal, which `test/schemas.test.ts` checks.
14. **Only `execute` (Claude Code).** The database's CHECK allows the mode `execute` alone.
    *Downside:* step 23 must change the CHECK to add `propose_only`.
15. **Migration 015 runs only where no claim holds an answer yet (Claude Code, from the review).**
    A claim answered before proposals existed keeps none, so its replay could name none, and
    every retry with its key would hear INTERNAL_ERROR, forever: claims are never removed. So the
    migration refuses a database that holds such claims, and asks for a database of its own.
    *Downside:* an existing database cannot be upgraded to this step. Replaying an old claim in
    its old shape is the way for a real deployment, and is left open.

### The tests, by claim

| Claims | Where |
| --- | --- |
| C1, C3 | [`test/proposals.test.ts`](test/proposals.test.ts) (the picture, the store); [`test/proposals.db.test.ts`](test/proposals.db.test.ts) (the trigger) |
| C2, C4, C5, C6, C7, C8 | `test/proposals.test.ts` (through the checklist); `test/proposals.db.test.ts` (on the database) |
| C9 | Both files, in memory and with the company's lock |
| C10 | [`test/inspector.test.ts`](test/inspector.test.ts), [`test/store-map.test.ts`](test/store-map.test.ts) |

### Breaks we will try, and what we expect

| Break | What we expect |
| --- | --- |
| B1. The trigger lets every move through | DSoR's own `UPDATE` moves a COMMITTED proposal back to READY. The database test of every move fails |
| B2. DSoR's own check of a move is gone | The database still refuses the move, with the same words, as error 23514 |
| B3. Line ⑧ runs inside the savepoint of the code's work | A refusal from the code rolls the proposal back with the work. The last move finds no proposal, and the call ends with INTERNAL_ERROR and no proposal |

The learner's predictions for these come in the understanding session's parts 3 to 5, on this
code.

### Left open, and not this step's idea

- `proposal.get`, `proposal.list`, and the rules of who may read a proposal.
- `propose_only` and `proposal.execute` (step 23), approvals (step 29), expiry, and compensation.
- A proposal for a refusal before line ⑧ (decision 7, open question 91).
- A READY proposal that can never be cancelled or expire: the picture draws no such move (open
  question 90).
- The trigger function's body, which start-up does not read (open question 88).

## Before you build: set up a database

As in step 21: a local PostgreSQL 17, a database of the step's own, `.env` written by a command
that prints nothing, and `pnpm migrate`. Migration 015 runs.

## What changed since step 21

| File | What changed |
| --- | --- |
| `migrations/015_proposals.sql` | **New.** `dsor.proposals`, its company's lock, its grants, the trigger `dsor.proposal_moves()`, and the log's third kind of record |
| `src/proposals.ts` | **New.** The picture as a table, the final states, the store in memory, and line ⑧: open a proposal, and close it |
| `src/claims.ts` | A claim runs line ⑧ before the code and the last move after it, and keeps the proposal's URI beside the outcome |
| `src/postgres.ts` | The proposals store on the database, each move with its record. Inside a claim, line ⑧ comes before the savepoint |
| `src/pipeline.ts` | Line ⑧. The answer names the outcome, the proposal, and the payload hash. A refusal from the code names its proposal |
| `src/envelope.ts`, `src/masking.ts` | The answer's three new fields. A refusal, masked or not, carries its proposal |
| `src/log.ts` | The record of a move. The decision's record names its proposal |
| `src/store.ts`, `store.json` | The kind `control-moved`, and `dsor.proposals` with its trigger |
| `src/main.ts` | The program shows user_123's draft's proposal and the FAILED proposal of a refused cancel |
| `schemas/proposal.schema.json`, `schemas/security-context.schema.json` | **New.** Copies of the specification's own |
| `test/proposals.test.ts`, `test/proposals.db.test.ts`, `test/owner-proposals.ts` | **New.** The claims C1 to C10, and the tests the review and the sweeps asked for |
| `test/owner-store.ts`, `test/owner-claims.ts`, `test/db.ts` | The owner runs the proposals store across companies, and plants claims a bug could leave |
| The other tests | The answer's three new fields, line ⑧ in the lines that run, the seventh table, and decision records read by kind |

```bash
git diff --no-index ../mj_21_optimistic_concurrency/src src
git diff --no-index ../mj_21_optimistic_concurrency/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-07, shortened. user_123 drafts a payment for INV-1008. The answer
names its proposal, and the program reads the proposal back:

```text
{
  outcome: 'COMMITTED',
  proposal: 'dsor://org_456/proposal/prop_a9cf2ea6-90b2-4cdc-a5d3-4722ee943999',
  payload_hash: 'sha256:f9e407e3c5a699ba22b4401cc8ee2dd8c54593d8ba612096956af2f725e5f1d0',
  data: { … id: 'PAY-1090', invoice_id: 'INV-1008', status: 'draft', version: 1 },
  classification: 'confidential',
  semantics: 'compensatable',
  correlation: { request_id: 'ap-desk-7', principal_id: 'user_123' }
}
its proposal, COMMITTED: dsor://org_456/proposal/prop_a9cf2ea6-90b2-4cdc-a5d3-4722ee943999
  (new) → PROPOSED, by user_123: payment.create called
  PROPOSED → READY, by dsor: no control asks for an approval: controls are not built yet
  READY → EXECUTING, by dsor: execute mode: the work starts
  EXECUTING → COMMITTED, by dsor: the work ended
```

She cancels the draft, and then cancels again on the cancelled version. The code refuses, so the
second cancel's proposal ends FAILED, and stays so:

```text
{
  code: 'CONFLICT',
  message: 'payment "PAY-1090" is not a draft, so it cannot be cancelled',
  retry: 'never',
  proposal: 'dsor://org_456/proposal/prop_54e5a70a-b890-4597-9b88-f4a6e1f61469',
  correlation: { request_id: 'ap-desk-7', principal_id: 'user_123' }
}
its proposal, FAILED: dsor://org_456/proposal/prop_54e5a70a-b890-4597-9b88-f4a6e1f61469
  (new) → PROPOSED, by user_123: payment.cancel called
  PROPOSED → READY, by dsor: no control asks for an approval: controls are not built yet
  READY → EXECUTING, by dsor: execute mode: the work starts
  EXECUTING → FAILED, by dsor: the code refused: CONFLICT
```

The payment's number is PAY-901 on a fresh database, and a higher one on each run after.

## Break it

Each break ran in a copy of this step outside the repository, on a local PostgreSQL 17 database
of its own, on 2026-10-07. The output is copied as it was printed.

**B1. The trigger lets every move through.** In the copy's migration 015, `IF NOT EXISTS (` became
`IF false AND NOT EXISTS (`. A COMMITTED proposal, made through the store, then `dsor_runtime`'s
own `UPDATE` back to READY, in a transaction that is rolled back after:

```text
=== built
the proposal is COMMITTED
dsor_runtime's own UPDATE to READY: 23514 no move from COMMITTED to READY in the picture of section 26.2
=== B1, the trigger lets every move through
the proposal is COMMITTED
dsor_runtime's own UPDATE to READY: READY (rolled back after)
```

DSoR's own check never sees a hand-written `UPDATE`. Only the database's guard does. The sweep
below ran the same break against the tests: the database test of every move failed.

**B2. DSoR's own check of a move is gone.** In the copy's `src/proposals.ts`, `if
(!canMove(from, to)) {` became `if (false) {`. The store is asked to move a new proposal from
PROPOSED straight to COMMITTED:

```text
=== built
PROPOSED → COMMITTED refused by DSoR's own check: no move from PROPOSED to COMMITTED in the picture of section 26.2
the proposal is PROPOSED
=== B2, DSoR's own check gone
PROPOSED → COMMITTED refused by the database (23514): no move from PROPOSED to COMMITTED in the picture of section 26.2
the proposal is PROPOSED
```

The second guard holds when the first one is gone. That is why there are two (decision 3).

**B3. Line ⑧ runs inside the savepoint of the code's work.** In the copy's `src/postgres.ts`, the
line that opens the proposal moved below `SAVEPOINT work`. user_123 drafts INV-1008 on version 2,
and INV-1008 is at version 1, so the code refuses:

```text
=== built
user_123 hears: {"code":"STALE_STATE","message":"invoice \"INV-1008\" is at version 1, and the request was decided on version 2","retry":"after_state_refresh","proposal":"dsor://org_456/proposal/prop_20d92b27-e9a3-430f-aedc-bef7cdcaba5c","correlation":{"request_id":"req_8fb08ab7-3d8d-488f-b702-30998af658c1","principal_id":"user_123"}}
its proposal: FAILED, PROPOSED → READY → EXECUTING → FAILED
=== B3, line ⑧ inside the code's savepoint
user_123 hears: {"code":"INTERNAL_ERROR","message":"DSoR hit an unexpected error","retry":"never","correlation":{"request_id":"req_01319423-c88d-4cdf-885b-507197223921","principal_id":"user_123"}}
its proposal: none
```

The refusal undid the code's work, and the proposal with it. The last move then found nothing to
move, which is an accident, so the whole claim rolled back. The order inside the claim's
transaction is the design (decision 9).

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | Parts 1 and 2 of the understanding session, on the picture and on one record for each attempt |
| 2 | Decide | Six questions to the learner, each with a recommendation. A seventh after DSOR-AUD-01 was found, which moved the history into the log |
| 3 | Database | Migration 015, tried first by hand on the step's database: three moves allowed, a move out of COMMITTED, a changed payload, and a new proposal in COMMITTED refused |
| 4 | Red | The unit tests first, which failed because `src/proposals.ts` did not exist |
| 5 | Green | The store, line ⑧ inside the claim, the answer's fields, and the log's record of a move |
| 6 | The old tests | The answer's three new fields, line ⑧ in the lines that run, the seventh table, the trigger, the grants, the policy, and decision records read by kind |
| 7 | The database tests | The trigger move by move, the records, the race to EXECUTING on two connections, the company's lock, and the calls on the database |
| 8 | The program | Shows a draft's proposal and a refused cancel's |
| 9 | Break it | B1 to B3 in a copy outside the repository, on a local PostgreSQL |
| 10 | Review | A reviewer who had not seen the conversation attacked the rules and the code. A sweep of small breaks ran in a copy. Both are under "Think it through" |

To start it in a new session:

```text
Build step 22 in learner mode from the design in
docs/baby_steps_tutorials/mj_22_proposals_and_their_states/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Red | The new unit test file, before any of its tests ran: `Cannot find module '../src/proposals.ts'` |
| Green, the old unit tests | 12 tests in 4 files: answers typed out without the three new fields, refusals typed out without their proposal, and lines that run without ⑧ |
| Green, the old database tests | 10 tests in 7 files: the grants typed out, the triggers, the policies, the planted catalog, an answer, and four tests that read every record of a request and met the records of its proposal's moves |
| The map | 2 unit tests that name the tables and the kinds |

## Check yourself

Walk each call through the checklist, and stop at the first line that says no.

1. user_123 drafts PAY-901 for INV-1008, and the draft is made. Name the four states its
   proposal passed through, and who made each move.
2. The agent's draft for INV-1008 is decided on version 2, and INV-1008 is at version 1. What
   does the agent hear, and what is its proposal's state?
3. The agent's answer is lost, and it sends the same request again with the same key. How many
   proposals are there now, and which one does the answer name?
4. A bug in DSoR runs `UPDATE dsor.proposals SET state = 'READY'` on a COMMITTED proposal. What
   happens?
5. The CFO, who holds only `invoice:read`, sends `payment.create`. Is there a proposal?

<details>
<summary>Answers</summary>

1. PROPOSED, by user_123, then READY, EXECUTING, and COMMITTED, each by `dsor`. Four records in
   the log, each with its cause.
2. `STALE_STATE`, from the code at line ⑨. The error envelope names the proposal, which is
   FAILED, with four moves (decision 2).
3. One. Line ⑦ finds the key and gives back the first answer, which names the first proposal.
   Line ⑧ does not run (DSOR-IDM-04, decision 7).
4. The database's trigger refuses it with error 23514, and the proposal stays COMMITTED
   (DSOR-APR-01c, decision 3). DSoR's own check never saw the statement.
5. No. Line ⑤ refuses it, before line ⑧ (decision 7). Its decision record is the only trace.

</details>

## Think it through

Claude Code ran its own sweep of 33 small breaks once the step was green. Then a reviewer who
had not seen the conversation attacked it: the rules against the code and the tests, and 26
breaks of its own. Claude Code chose each fix, and left the two points that question the
learner's decisions for the learner.

**What the review found, and what changed.**

| # | Found | Fixed by |
| --- | --- | --- |
| H1 | A claim answered before migration 015 keeps no proposal. Its replay would hear INTERNAL_ERROR at every retry, forever, and a retry with a new key would draft again | Migration 015 refuses a database whose claims hold answers (decision 15). An owner-run test tries the guard on an empty table, then with one answered claim |
| M1 | Decision 1 makes COMMITTED final for a command that the picture says can be undone, and two tests named that DSOR-APR-01c | The two tests are titled by the decision. The choice stays the learner's: open question 89 |
| M2 | The records say "allowed, started, done" before line ⑪ records the decision. Decision 2 said every refusal ends FAILED, though an accident rolls the proposal back | Decision 2's words. The order is steps 17 and 20's, the work before its record, until step 36. Left open |
| M3 | The second clause of DSOR-IDM-04, the proposal id as the key of its execution, is not built | The rules table, `rules-met.md`, and the status page say "partly" |
| M4 | The order of lines ⑦, ⑧, and ⑨ was tested in memory only | A database test of the lines that run. It fails when line ⑧ runs after the code's work |
| M5 | Any code could name a proposal, another company's too, in a refusal of its own, and the envelope sent it | Only the checklist names the proposal, from the claim. A Refusal carries none (decision 5). A test plants one |
| L1 | DSoR's own company filter on proposals was hidden by the database's lock | The owner, whom no policy stops, runs the store across companies. A forged record of another company is left out of the history |
| L2 | A test titled DSOR-AUD-01 proved nothing of that rule, and comments named the rule as met | The test is titled by the step. Comments name DSOR-AUD-01 as the reason for the log, never as met |
| L3 | A mover's mode, or the time of an authority, could change unseen | A test checks each record's mover in full, with the time of the directory's answer from a read a moment before, and an application's own call |
| L4, L5 | A masked refusal could drop its proposal. The proposal could keep the input as sent, not line ⑥'s copy | Code whose refusal is above the agent's clearance. An input that reads differently the second time |
| L6, L7 | Start-up reads the trigger's definition, not its function. A move without its record is caught by DSoR's store alone | Left open: open question 88, and a check the database could make at commit |
| L8 | In memory, an accident leaves its proposal EXECUTING | A test pins it, as decision 9's downside |
| L9, L10 | A replay trusted any text as its proposal. The history took the first namespace there. The last move cut the id out of a URI by its length | A replay takes only a proposal of its claim's company, tried with three planted claims. Both reads fixed, and each part tried alone |

**What the sweeps found.**

- **The first sweep:** 33 breaks of the step's own pieces. 29 failed a test. 4 survived: DSoR's
  own company filter, the input kept as sent, a masked refusal's proposal, and a replay's check
  of its proposal. Each now has a test.
- **The second sweep:** the reviewer's breaks, rewritten for the fixed code, and one of the
  migration's guard, 27 in all. 20 failed a test. 7 survived, each in a part that no call of the
  story reaches: a URI named twice, an actor chain of two, another namespace, a lost move to
  EXECUTING, a bad URI at the last move, an application's call, and a forged record of another
  company. Each part is now tried alone.
- **The third run:** the 7 survivors, and the break whose first result was the runner's own
  (below), 8 in all, against the new tests. Each of the 8 failed a test.
- **One result was the runner's own.** Removing the pin of the trigger's `search_path` seemed to
  break 202 tests. The runner's `replace` had written `AS $` for `AS $$`, the same trap
  that wrote `DO $` into the migration's guard during the build. The runner now uses split and
  join, and the break was run again.

**What the build taught.**

- **The schema cannot hold the picture.** `proposal.schema.json` lists the 17 states and no
  move, so a record with PENDING_APPROVAL to EXECUTING in its history passes it. The moves live in
  DSoR's code and in the trigger, and a test compares the two, move by move.
- **Where line ⑧ sits inside the claim is the design.** Inside the savepoint of the code's work,
  a refusal took the proposal with the work (break B3).
- **Two guards, each shown holding alone** (breaks B1 and B2).
- **A fact found after a decision goes back to the learner.** DSOR-AUD-01 was found after the
  learner had chosen a table of its own for the history. The learner chose again: the log.

**Left open on purpose:** `proposal.get`; `propose_only` and `proposal.execute` (step 23);
approvals (step 29); the compensation line (open question 89, and the review's challenge to
decision 1); a READY proposal that can never be cancelled (open question 90); a proposal for a
refusal before line ⑧ (open question 91); the order of the records, READY and EXECUTING before
line ⑨'s checks and COMMITTED before line ⑪, until steps 27, 33, and 36; the trigger's function
body (open question 88); a database check that every move has its record; and an old claim
replayed in its old shape, for a real upgrade.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-APR-01a | Proposals follow the state machine of §26.2 | [§26.2 Lifecycle](../../../specs/dsor/03-execution.md#262-lifecycle) | Unit tests in [`test/proposals.test.ts`](test/proposals.test.ts): every pair of states, the store, and the calls. Database tests in [`test/proposals.db.test.ts`](test/proposals.db.test.ts): the trigger move by move, a new proposal, and the calls |
| DSOR-APR-01b | Every proposal transition is recorded with its actor and its cause | [§26.2 Lifecycle](../../../specs/dsor/03-execution.md#262-lifecycle) | Unit and database tests: the records of each move, and a move whose record cannot be written does not happen |
| DSOR-APR-01c | A proposal never leaves a terminal state | [§26.2 Lifecycle](../../../specs/dsor/03-execution.md#262-lifecycle) | Unit tests: no move out of the 10 final states. Database tests: a COMMITTED proposal refuses all 17 states. Inspector tests: start-up refuses the guard missing or switched off |
| DSOR-IDM-04 | A proposal is executed at most once, and its id is the key of its execution | [§22 Idempotency](../../../specs/dsor/03-execution.md#22-idempotency) | Partly: the first clause. A replay names the same proposal and makes none. Two movers to EXECUTING at the same moment, on two connections: one wins. The second clause has nothing to key until `proposal.execute` (step 23) |

## Next

Step 23 · Three ways to call. `execute` does it, `propose_only` prepares it for someone else to
release, and `validate_only` is a dry run with no side effects at all.
