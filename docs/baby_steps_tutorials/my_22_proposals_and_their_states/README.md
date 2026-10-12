# Step 22 · Proposals and their states

**New in this step:** every command becomes a *proposal*, a record with a state you can look up,
like an order-tracking page. Its state moves only forward, and never out of a finished state.

## In plain words

When the agent asks DSoR to cancel a payment, DSoR now writes down a proposal first: what was
asked, who asked, and the request's fingerprint. Then, as the request goes, it writes down each
*move*. This is the demo's last cancel, which found the payment had moved on:

```text
            -> PROPOSED   accounts-payable-fte  payment.cancel@1 invoked
  PROPOSED  -> READY      dsor                  allowed: the decision is recorded as audit:org_456:41
  READY     -> EXECUTING  dsor                  handed to payment.cancel
  EXECUTING -> FAILED     dsor                  the handler answered STALE_STATE
```

A proposal's *state* is its last move. Each move says who made it, the *actor*, and why, the
*cause*. The first move is made by whoever logged in to ask; the rest are DSoR's own.

The states and the moves between them come from the specification's map, §26.2, all but its last
line, compensation, which this tutorial never builds. This step uses the plain path:

- **DENIED**: a check after the proposal was written said no, for example the slip's limit.
- **READY**, then **EXECUTING**: allowed, and handed to the code that carries it out.
- **COMMITTED**: it was done. **FAILED**: the code refused, for example a stale version.
- **OUTCOME_UNKNOWN**: the code crashed, said itself that it does not know, or refused with a code
  that does not say nothing was done. Nobody knows whether it ran, so DSoR does not pretend to. A
  caller whose code refused that way is told `OUTCOME_UNKNOWN` too, never "safe to send again".

DENIED, COMMITTED and FAILED are *finished*: there is no move out of them on the map. The other
states on the map, waiting for approval, approved, rejected, expired and the rest, arrive with
approvals.

The receipt names the proposal, `dsor://org_456/proposal/prop_1`. A request refused before the
proposal is written, because nobody is logged in, the company is wrong, the caller lacks the
permission or the arguments are bad, has none: there was nothing to propose. A query has none
either: it changes nothing. A proposal keeps its command's arguments for good, so their size is the
server's: arguments that take more than 64 KiB written down are refused at §21.6, before any
proposal is made.

Three rules make "never out of a finished state" true, and all three live in the database, not in
the code, so no handler, careless or not, can get round them:

- **The map is a table.** Every move written must be one of its moves, and a finished state has
  none out of it, so a move out of COMMITTED has nothing to point at and is refused.
- **The history is one line.** The map has no loops, so a proposal enters each state once and
  leaves it once, and a move out of a state needs the move into it. Two requests that both try to
  move a proposal out of READY cannot both be written: a proposal runs at most once.
- **Only the first move has no "from".** The rules above check a move's "from" against the map and
  against the history, and PostgreSQL skips those checks when the "from" is NULL, its word for "no
  value". So a CHECK says the one move with no "from" is the first, into PROPOSED. Without it, a
  DENIED proposal could be given a fresh move into READY, and then run.

The application, `dsor_runtime`, may add proposals and moves and read them, and do nothing else: no
changing, no deleting, and no touching the map. Start-up refuses an application that may.

## Why it matters

The agent asks for a payment at 2 a.m. In the morning `user_123` asks what became of it. Without
proposals the answer is spread over three places that were never meant to be read together: a
decision in the audit log, an answer on an idempotency claim, and a payment, if there is one. A
request refused by the slip's limit leaves no payment. One whose code crashed leaves a claim with
no answer. Nothing says "this request, and where it is now".

And nothing would keep it there. Step 23 prepares a command now for step 31 to release later, and
approvals attach to a waiting command. Both need a record whose state moves only forward. A payment that is
COMMITTED and could be moved back to EXECUTING is a payment that can run twice.

## What changed since step 21

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_21_optimistic_concurrency ../my_22_proposals_and_their_states
```

| File | What |
| --- | --- |
| `migrations/020_proposals.sql` | new — the map of moves, the proposals, written once, and their moves; the constraints that keep the map, and a history that is one line; the application may add and read, and nothing else |
| `src/proposal.ts` | new — make a proposal with its first move, move it, move it through several states in one statement, read its moves, its state, and a company's list |
| `src/operations.ts` | §21.6 refuses a command whose arguments take more than 64 KiB, since its proposal keeps them for good; a stage at §21.8 makes the proposal; §21.11 refuses a command with none; the door moves it to READY and EXECUTING together before the handler, and to COMMITTED, FAILED or OUTCOME_UNKNOWN after, and tells the caller `OUTCOME_UNKNOWN` when it is; DENIED when a later stage refuses, and after a lost reply, "nothing was done" only once DENIED is written |
| `src/pipeline.ts` | the stage is required by name, after the claim; the context carries the proposal and the payload's text |
| `src/envelopes.ts` | the receipt names the real proposal, handed in, not counted; one from another company is refused |
| `src/database.ts` | start-up knows eight tenant tables, and refuses an application that may change a proposal, a move or the map |
| `src/main.ts` | where each command of this run went, the stale cancel move by move, and a COMMITTED proposal refusing to move back |
| `test/proposals.test.ts` | new — the map, the moves, finished proposals refusing every move, the race, the rights, and the door's moves on every path |
| `test/proposals.db.test.ts` | new — twenty moves out of READY at once on a real server, and twenty out of COMMITTED |
| the tests that pin the pipeline | ten stages now, and all 3,628,800 orderings walked one at a time |

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes after the two decisions on one payment:

```text
Where each command went: org_456's proposals from this run

  prop_1    invoice.issue@1   COMMITTED
  prop_2    payment.create@1  COMMITTED
  prop_3    payment.cancel@1  COMMITTED
  prop_4    payment.cancel@1  FAILED
  prop_5    payment.create@1  DENIED
  prop_6    payment.create@1  COMMITTED
  prop_7    payment.create@1  COMMITTED
  prop_8    payment.create@1  COMMITTED
  prop_9    payment.cancel@1  COMMITTED
  prop_10   payment.cancel@1  FAILED

prop_10, move by move:

            -> PROPOSED   accounts-payable-fte  payment.cancel@1 invoked
  PROPOSED  -> READY      dsor                  allowed: the decision is recorded as audit:org_456:41
  READY     -> EXECUTING  dsor                  handed to payment.cancel
  EXECUTING -> FAILED     dsor                  the handler answered STALE_STATE

  prop_1 is COMMITTED. Moved back to EXECUTING: refused
```

Ten proposals, though the demo sends more commands than that. The ones refused before §21.8 have
none: cfo_100's issue, the agent after `user_123` lost the permission, the directory switched off
and the stale directory, the key used for another amount, and every request with another company's
address. prop_4 is the cancel of a payment already cancelled, `CONFLICT`; prop_5 is the payment over
the slip's limit; PAY-903 is prop_6, sent twice with one key and one proposal; the fifty requests
with one key are one proposal, prop_7. The numbers count up
across runs, because the store keeps every run's.

The last line asks, with the application's own rights, to move a finished proposal back. The
database refuses.

### The database tier

`pnpm check` needs no server. The fifty-five tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_21_optimistic_concurrency/.env .env     # then dsor_step21 -> dsor_step22 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step22` through the owner
login. `pnpm migrate` applies the twenty migrations; on a server that already had step 21's
nineteen, it applies 020. The two new tests race on a real pool: twenty requests try to move one
proposal out of READY at the same moment, and exactly one is written; twenty try to move a COMMITTED
proposal anywhere, and none is.

## Break it

Three, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `753` with `1 skipped`; in the repository it is `753 passed`.

### Break 1 · the map gets a way out of COMMITTED

The map's "break it". In `migrations/020_proposals.sql`, add one more move to the map:
`('COMMITTED', 'FAILED')`.

```text
 Tests  4 failed | 748 passed | 1 skipped (753)
```

The map test, the two tests that try every move out of a COMMITTED proposal, and the one that writes
the SQL itself: a payment that was made can now be recorded as one that failed. Notice what a way
out of COMMITTED back to EXECUTING would have done: almost nothing, because a proposal enters each
state once, and it has already been EXECUTING. The two rules guard each other.

### Break 2 · a state may be left twice

In `migrations/020_proposals.sql`, delete `UNIQUE (tenant, proposal, from_state),`.

```text
 Tests  1 failed | 751 passed | 1 skipped (753)
```

The test of two different moves out of one state at once fails: approved and rejected together,
and both written. So does the test of a move whose reply was lost and that lands late: "left once"
is what makes a written DENIED proof that the lost move can never land, so without it DENIED is
written beside the late move, the history forks into DENIED and EXECUTING, and the claim is
released. Two moves into the same state, the race out of READY, are still caught, by "entered
once".

### Break 3 · the handler runs without the move to EXECUTING

In `src/operations.ts`, delete the line ``["READY", "EXECUTING", `handed to ${contract.id}`],``.

```text
 Tests  9 failed | 743 passed | 1 skipped (753)
```

The handler runs on a proposal that is only READY, and its last move, out of EXECUTING, has nothing
to point at, so every proposal the door carries out is left READY: the demo's list, and eight tests
of the door's moves. The handler still ran, and the payment was still made. Nothing in the history
says so.

## Build it yourself with Claude Code

Copy `my_21_optimistic_concurrency` to a new folder and ask:

> Start step 22, proposals and their states. Before any code: show me a request at 2 a.m. and the
> three places I would have to look in the morning to know what became of it. Then ask me the
> step's decisions one at a time. Then build it a piece at a time, red first, and break each piece
> on purpose.

## Check yourself

1. The agent's payment is refused because it is over the slip's limit. Is there a proposal, and
   what state is it in? And cfo_100's attempt to issue an invoice?
2. Why is a proposal's state its last move, and not a column of its own?
3. What stops a COMMITTED proposal from being moved back to EXECUTING, if a careless handler next
   year writes the SQL itself?
4. Two requests try to move one proposal out of READY at the same moment. What happens?
5. A handler answers `TRANSACTION_FAILED`. Why is its proposal `OUTCOME_UNKNOWN` and not `FAILED`?

<details>
<summary>Answers</summary>

1. Yes, DENIED, with the cause `refused: LIMIT_EXCEEDED`: the limit is checked after §21.8. cfo_100
   has none: the permission is checked before it, and there was nothing to propose.
2. A column would be a second copy of the truth beside the history, and the two could disagree. It
   would also need the right to change rows, which is the right to change a finished one.
3. The database. The map has no move out of COMMITTED, so the move has nothing to point at; and the
   application may not change or delete a move, so it cannot rewrite the history either. A move
   with no "from", which no foreign key checks, is refused by the CHECK that keeps it for the first
   move, into PROPOSED.
4. Exactly one is written. A state is left only once, and the database checks it. That is how a
   proposal runs at most once.
5. FAILED is finished, and says nothing happened. Only a refusal whose code says nothing was done,
   `CONFLICT`, `STALE_STATE`, `RESOURCE_NOT_FOUND` or `VALIDATION_FAILED`, is believed. A handler
   that made the payment and then answered `TRANSACTION_FAILED` would otherwise leave a payment
   nobody looks for. The caller is told `OUTCOME_UNKNOWN` as well: `TRANSACTION_FAILED` says "safe
   to send again", an invitation to pay twice.

</details>

## The rules this step meets

- **[DSOR-APR-01a · L2]** Proposals MUST follow this state machine.
  ([§26.2](../../../specs/dsor/03-execution.md#262-lifecycle))
- **[DSOR-APR-01b · L2]** Every proposal transition MUST be recorded with its actor and its cause.
- **[DSOR-APR-01c · L2]** A proposal MUST NOT leave a terminal state.
- **[DSOR-IDM-04 · L2]** A proposal MUST be executed at most once; the proposal id is the
  idempotency key of its execution. ([§22](../../../specs/dsor/03-execution.md#22-idempotency))

**What this step leaves, said plainly.** The proposal id is not passed on to the system that does
the work as its key: a proposal runs at most once because READY is left once, and passing a key on
waits for a connector that takes one (`DSOR-IDM-03`), so `DSOR-IDM-04` is met in part. One key is
one proposal, except after a released claim: the retry makes a second, and the first is DENIED.
When the door's own move lost its reply, the claim is released only once DENIED is written,
because only that proves the lost move can never land; if DENIED is refused or cannot be written,
the answer is `OUTCOME_UNKNOWN` and the key stays taken.
DENIED is the only finished state the map has out of PROPOSED, so a store that failed is DENIED too,
with a cause that says it was the store. §26.2's last line moves COMMITTED and FAILED on to
COMPENSATING, for commands that can be undone, such as `payment.create`; with no compensation here,
COMMITTED and FAILED are finished for every command, as §26.2's own plain words say. That is why
prop_2 stays COMMITTED after prop_3 cancels its payment. Proposal numbers, like payment numbers
since step 17, come from one sequence for every company, so a number hints at how busy the others
are. Start-up does not yet ask whether the application may set that sequence, or the one that
orders a proposal's moves, as step 17 asks of the payments' numbers: an application given UPDATE on
`dsor.proposal_numbers` could choose the next proposal's number and still start; step 26 adds the
question. No rule's guarantee rests on it: a number set back onto one already used is refused, and
nothing runs.
A proposal whose creation committed with its reply lost stays PROPOSED, and one whose last move
could not be written stays EXECUTING: both wait for reconciliation, step 38. A handler that throws
leaves its proposal OUTCOME_UNKNOWN, but the throw still reaches the caller as a throw, not as an
`OUTCOME_UNKNOWN` answer; that is step 37's. There is no `proposal.get` yet, because who may read a
proposal is a rule of its own; the demo reads the store. Only one mode, `execute`, is built;
`propose_only` and `validate_only` are step 23's, and the approval states step 29's.

Everything earlier steps claimed still holds.

**Next:** step 23, `three_ways_to_call` — `execute` does it, `propose_only` prepares it for
someone else to release, and `validate_only` is a dry run with no side effects at all.
