# Step 22 · Proposals and their states

**New in this step:** every command becomes a *proposal*, a record with a state you can look up,
like an order-tracking page. Its state moves only forward, and never out of a finished state. And
every move is written in the company's audit log, by the same statement that makes the move.

## In plain words

When the agent asks DSoR to cancel a payment, DSoR now writes down a proposal first: what was
asked, who asked, and the request's fingerprint. Then, as the request goes, it writes down each
*move*. This is the demo's last cancel, which found the payment had moved on:

```text
            -> PROPOSED   accounts-payable-fte  audit:org_456:75   payment.cancel@1 invoked
  PROPOSED  -> READY      dsor                  audit:org_456:77   allowed: the decision is recorded as audit:org_456:76
  READY     -> EXECUTING  dsor                  audit:org_456:78   handed to payment.cancel
  EXECUTING -> FAILED     dsor                  audit:org_456:79   the handler answered STALE_STATE
```

A proposal's *state* is its last move. Each move says who made it, the *actor*, and why, the
*cause*. The first move is made by whoever logged in to ask; the rest are DSoR's own. Each move
also names its *record*, `audit:org_456:77` and so on: its line in the company's audit log, which
the next part of this page is about.

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

### Every move is in the log

A proposal's history is not the audit log. The log, `dsor.audit`, is the one place where each record
carries the *fingerprint*, the hash, of the record before it, so a record changed afterwards shows
(step 08). Until now it held decisions and reads, and not one move.

Now each move is written twice: in the proposal's history, and in the company's audit log. One SQL
statement writes both, so the database keeps both or neither. If the log cannot take the record,
the move is not written either: the door never hands a command to its code on a move that nobody
wrote down. And a move the database refuses leaves no record that says it happened.

The record of a move says:

- which proposal moved, and the state it entered;
- the state it left, who moved it, and why, in its reason: `READY -> EXECUTING by dsor: handed to
  payment.cancel`;
- whose request it was, in the same words as that request's decision. For the agent's cancel, that
  is `user_123`'s authority, used by `accounts-payable-fte` under `del_100`. Never `dsor`'s: DSoR
  holds no authority of its own.

In the printed log, a move is a line marked `move`:

```text
75  move   payment.cancel@1     user_123               PROPOSED prop_10        sha256:2b51dbb...  unattended: by accounts-payable-fte under del_100
76  ALLOW  payment.cancel@1     user_123               ALLOWED                 sha256:990e16e...  unattended: by accounts-payable-fte under del_100
77  move   payment.cancel@1     user_123               READY prop_10           sha256:efb44a7...  unattended: by accounts-payable-fte under del_100
78  move   payment.cancel@1     user_123               EXECUTING prop_10       sha256:e0ddd15...  unattended: by accounts-payable-fte under del_100
79  move   payment.cancel@1     user_123               FAILED prop_10          sha256:c013700...  unattended: by accounts-payable-fte under del_100
```

The proposal is made before its decision, so its first record comes first. That record cannot name
the proposal. PostgreSQL gives the proposal its number inside the same statement, after the record's
fingerprint is made, and the program may not choose the number: start-up refuses one that may. So
each move names its record instead, in a column of its own, and the database refuses a move that
names none, or names a record the log does not have. The demo finds a creation's proposal that way.

### When two requests reach the end of the log together

A record's fingerprint covers its place in the log, and the fingerprint of the record before it.
So DSoR reads the end of the log first, and then writes. Two requests can read the same end. The
database keeps the first statement. It refuses the second one whole, the move with it, so nothing of
it was written. In step 09 the second request was then refused. Now it waits a few milliseconds,
chosen at random so that the requests that lost do not all come back at once. Then it reads the new
end and tries the next place, up to ten places. After ten it gives up. Before the handler runs, the
request is then refused, with nothing done. After it, the payment stands and the caller is told so,
and the proposal stays EXECUTING, in its history and in the log, for reconciliation (below).
Decisions and the records of reads follow the same rule.

## Why it matters

The agent asks for a payment at 2 a.m. In the morning `user_123` asks what became of it. Without
proposals the answer is spread over three places that were never meant to be read together: a
decision in the audit log, an answer on an idempotency claim, and a payment, if there is one. A
request refused by the slip's limit leaves no payment. One whose code crashed leaves a claim with
no answer. Nothing says "this request, and where it is now".

And nothing would keep it there. Step 23 prepares a command now for step 31 to release later, and
approvals attach to a waiting command. Both need a record whose state moves only forward. A payment that is
COMMITTED and could be moved back to EXECUTING is a payment that can run twice.

And the log would say less than the history. Before the moves had records, the log said ALLOW for
the agent's last cancel, and nothing after it, while the history said the cancel FAILED. An auditor
who reads the log, the record with fingerprints, saw a cancel that was allowed, and could not tell
whether it ran. Measured on a real PostgreSQL before this change, fifty payments sent at once left
104 moves in the history, and not one of them in the log.

## What changed since step 21

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_21_optimistic_concurrency ../my_22_proposals_and_their_states
```

| File | What |
| --- | --- |
| `migrations/020_proposals.sql` | new — the map of moves, the proposals, written once, and their moves; the constraints that keep the map, and a history that is one line; the application may add and read, and nothing else; each move names its record in the audit log, and the database refuses a move that names none |
| `src/proposal.ts` | new — make a proposal with its first move, move it, move it through several states in one statement, read its moves, its state, and a company's list; each move is written with its record in the log by the same statement, and the creation's record is found through the move that names it |
| `src/audit.ts` | the parts of writing a record have names (`copyOf`, `theEndOf`, `sealAt` and the rest), so a move's statement can write its record; `recordTogether` writes every record, and one that loses its place at the end of the log waits a random moment and tries the next, up to ten places; after any other failure it looks for its record first, and an error of SQLSTATE class 08 is a connection lost, not the server's refusal; a record of another company's is refused |
| `src/operations.ts` | §21.6 refuses a command whose arguments take more than 64 KiB, since its proposal keeps them for good; a stage at §21.8 makes the proposal; §21.11 refuses a command with none; the door moves it to READY and EXECUTING together before the handler, and to COMMITTED, FAILED or OUTCOME_UNKNOWN after, and tells the caller `OUTCOME_UNKNOWN` when it is; DENIED when a later stage refuses, and after a lost reply, "nothing was done" only once DENIED is written; the records of the moves are in the request's name, and a creation nobody can confirm is `OUTCOME_UNKNOWN`, which stays so when its decision cannot be written either; a move that can never land is not read back |
| `src/pipeline.ts` | the stage is required by name, after the claim; the context carries the proposal and the payload's text |
| `src/envelopes.ts` | the receipt names the real proposal, handed in, not counted; one from another company is refused |
| `src/database.ts` | start-up knows eight tenant tables, and refuses an application that may change a proposal, a move or the map |
| `src/main.ts` | where each command of this run went, the stale cancel move by move with each move's record, a COMMITTED proposal refusing to move back, and each move in the printed log as a line marked `move` |
| `test/proposals.test.ts` | new — the map, the moves, finished proposals refusing every move, even one with no "from", the race, the rights, and the door's moves on every path, a lost reply that lands late or cannot be read back among them |
| `test/proposals.db.test.ts` | new — twenty moves out of READY at once on a real server, and twenty out of COMMITTED, each leaving no record of a move that was refused |
| `test/transitions.test.ts` | new — every move's record, what it says and in whose name; no record for a refused move; a move without a record refused by the database; the record of the move to EXECUTING that cannot be written; a place in the log taken once, and every time; lost replies, of a move and of a creation; every path of the door |
| `test/transitions.db.test.ts` | new — twenty payments at once on a real server: every move with its record, and most of them carried out |
| `test/audit-lost-reply.test.ts` | a decision that loses its place is written at the next one, and one that loses every place is given up after ten; four of step 09's tests now see ours written at the next place, theirs untouched; a write that ran and came back with a server's error is found by its record, and an error of class 08 is unknown |
| `test/audit-per-tenant.test.ts` | a record of another company's is never written in this company's chain |
| `test/decision-first.test.ts`, `test/pipeline.test.ts`, `test/audit-permissions.test.ts` | the log has records of moves now: they read its decisions, or count the moves; TRUNCATE takes the moves with the log; a command whose decision alone cannot be written is carried out by nobody |
| `test/support/database.ts`, `test/audit.db.test.ts`, `test/classified-reads.db.test.ts`, `test/commit-dies.db.test.ts` | a reset deletes the company's moves before its log, because a move names its record; the words a test's own moves are recorded under |
| `src/store.ts` | a comment: tests now swap the database in the middle of a write, to take its place in the log |
| the tests that pin the pipeline | ten stages now, and all 3,628,800 orderings walked one at a time |
| `test/database.test.ts` | the new start-up refusal, one right at a time: an application that may change a proposal, a move or the map |
| `test/control-plane-store.test.ts` | DSoR's store has six tables now: the proposals, their moves and the map |
| `test/envelopes.test.ts` | a receipt names a real proposal, and one naming another company's proposal is never built |
| `test/main.test.ts` | the demo's list of where each command went, one proposal move by move |
| `test/payments.test.ts` | the careless handlers pass the proposal on |
| `test/the-lock-at-start-up.test.ts` | the table a helper builds in the lock's way is `dsor.approvals` now, since `dsor.proposals` is real; an account one `SET ROLE` from owning the proposals is refused; and the lock's refusals are asked of the proposals and their moves too |
| `test/support/story.ts` | the reset empties the proposals and their moves, and numbers them from 1 again |
| `test/arguments.test.ts`, `test/cross-tenant.test.ts`, `test/decision-first.test.ts`, `test/freshness.test.ts`, `test/model-boundary.test.ts`, `test/operations.test.ts`, `test/request-id.test.ts` | no proposal counter to reset: a receipt names `prop_1`, or any real proposal |

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

            -> PROPOSED   accounts-payable-fte  audit:org_456:75   payment.cancel@1 invoked
  PROPOSED  -> READY      dsor                  audit:org_456:77   allowed: the decision is recorded as audit:org_456:76
  READY     -> EXECUTING  dsor                  audit:org_456:78   handed to payment.cancel
  EXECUTING -> FAILED     dsor                  audit:org_456:79   the handler answered STALE_STATE

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

`pnpm check` needs no server. The fifty-seven tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_21_optimistic_concurrency/.env .env     # then dsor_step21 -> dsor_step22 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step22` through the owner
login. `pnpm migrate` applies the twenty migrations; on a server that already had step 21's
nineteen, it applies 020. Migration 020 was changed in place when the moves gained their records. A
database that ran the older 020 is refused: `pnpm migrate` says 020 "has changed since it was
applied". Make `dsor_step22` again.

Four of the tests race on a real pool. Twenty requests try to move one proposal out of READY at the
same moment: exactly one is written, with one record of EXECUTING. Twenty try to move a COMMITTED
proposal anywhere: none is, and no record says one was. Twenty payments are sent at once: every move
has its record, and every record of a move has its move. And at least fifteen of those twenty are
carried out, because a request that loses its place at the end of the log tries the next one. Only a
real server can show that: PGlite runs one statement at a time, so nothing in the unit tier ever
reaches the end of the log together. Measured on a local PostgreSQL 17 with a pool of twenty: twenty
of twenty were carried out in each of four runs, and fifty of fifty in each of four runs of fifty.
With no pause before the next place, 3 or 4 of twenty. With one place and no second, none.

## Break it

Five, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `829` with `1 skipped`; in the repository it is `829 passed`.

### Break 1 · the map gets a way out of COMMITTED

The map's "break it". In `migrations/020_proposals.sql`, add one more move to the map:
`('COMMITTED', 'FAILED')`.

```text
 Tests  5 failed | 823 passed | 1 skipped (829)
```

The map test, the two tests that try every move out of a COMMITTED proposal, and the one that writes
the SQL itself: a payment that was made can now be recorded as one that failed. And the test that a
move the map refuses writes no record: it tries this very move, and now the move is written, with
its record in the log. Notice what a way out of COMMITTED back to EXECUTING would have done: almost
nothing, because a proposal enters each state once, and it has already been EXECUTING. The two
rules guard each other.

### Break 2 · a state may be left twice

In `migrations/020_proposals.sql`, delete `UNIQUE (tenant, proposal, from_state),`.

```text
 Tests  3 failed | 825 passed | 1 skipped (829)
```

The test of two different moves out of one state at once fails: approved and rejected together,
and both written. So does the test of a move whose reply was lost and that lands late: "left once"
is what makes a written DENIED proof that the lost move can never land, so without it DENIED is
written beside the late move, the history forks into DENIED and EXECUTING, and the claim is
released. And so does the test that a move the map refuses writes no record: in it, a proposal
already READY leaves PROPOSED a second time, into DENIED, and that move is now written, with its
record. Two moves into the same state, the race out of READY, are still caught, by "entered once".

### Break 3 · the handler runs without the move to EXECUTING

In `src/operations.ts`, delete the line ``["READY", "EXECUTING", `handed to ${contract.id}`],``.

```text
 Tests  37 failed | 791 passed | 1 skipped (829)
```

The handler runs on a proposal that is only READY, and its last move, out of EXECUTING, has nothing
to point at, so every proposal the door carries out is left READY. The handler still ran, and the
payment was still made. Nothing in the history says so, and nothing in the log either: for each
command carried out, the log is two records short, with no EXECUTING and no ending. So thirty-seven
tests that follow a command to its end fail: fourteen of the door's moves, eleven of the moves'
records, the demo's list and five tests of its log, and six more that read the log, five in
`test/decision-first.test.ts` and one in `test/pipeline.test.ts`.

### Break 4 · the records are written just before the moves

In `src/proposal.ts`, in `moveProposalThrough`, write the records in a statement of their own, and
the moves in a second one. Replace the `try` block's `await recordTogether(...)`, all of it, with:

```ts
    const { records } = await recordTogether(
      tenant,
      path.map(([from, to, cause]) => transition(by, tenant, id, from, to, actor, cause)),
      (sealed) => {
        const params: unknown[] = [];

        return { sql: `WITH ${theRecordsIn(sealed, params)} SELECT 1`, params };
      },
    );
    const params: unknown[] = [tenant, id, actor];
    const moves = path.map(([from, to, cause], i) => {
      params.push(from, to, cause, records[i]?.record_id);

      const at = params.length;

      return `($1, $2, $${at - 3}, $${at - 2}, $3, $${at - 1}, $${at})`;
    });

    await theDatabase(tenant).query(
      `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause, record)
       VALUES ${moves.join(", ")}`,
      params,
    );
```

```text
 Tests  16 failed | 812 passed | 1 skipped (829)
```

Every move the database refuses now leaves a record that says it happened. The demo's last line
asks to move prop_1, which is COMMITTED, back to EXECUTING. The database refuses, and the printed
log has a line 80 all the same, a `move` of prop_1 into EXECUTING: 81 records where there were 80.
The sixteen: the demo's four tests of its log; a move the map refuses, and the race out of READY,
each of which leaves a record of the move that lost; and ten tests of a place lost, a reply lost or
a record that cannot be written, where the records and the moves no longer go together.

### Break 5 · a lost place is not tried again

In `src/audit.ts`, change `export const PLACES_TO_TRY: number = 10;` to
`export const PLACES_TO_TRY: number = 1;`.

```text
 Tests  9 failed | 819 passed | 1 skipped (829)
```

A request whose place at the end of the log is taken is refused again, as in step 09, with nothing
written. The unit tier sees it only where a test takes a place on purpose: six tests in
`test/audit-lost-reply.test.ts`, and three in `test/transitions.test.ts`. On a real server it is the
crowd that pays. A payment now writes four statements into the log, each of which must win its
place the first time: twenty payments sent at once made none, in each of three runs, and the
database tier's test of twenty at once fails.

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
6. Why are a move and its record written by one statement, and not one just after the other?
7. Two requests read the same end of the log. What happens to the one that writes second, and why
   may it try again?
8. Why does the record of a new proposal not name the proposal?

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
6. So the database keeps both or neither. With the record just after the move, a failure between
   the two leaves a move nobody recorded, and the door could run a payment on it. With the record
   just before, the database can still refuse the move, and the log would say it happened.
7. The database refuses its whole statement, the move with it, so nothing of it was written, and
   writing it at the next place cannot write anything twice. When the reply is lost instead, DSoR
   looks at that place first. Its own record there means it was written. Another request's means
   it was not, and the next place is tried. An empty place means nobody knows yet, so it is not
   tried again.
8. PostgreSQL gives the proposal its number inside the statement, after the record's fingerprint
   is made, and the program may not choose the number. So the first move names the record instead.

</details>

## The rules this step meets

- **[DSOR-APR-01a · L2]** Proposals MUST follow this state machine.
  ([§26.2](../../../specs/dsor/03-execution.md#262-lifecycle))
- **[DSOR-APR-01b · L2]** Every proposal transition MUST be recorded with its actor and its cause.
- **[DSOR-APR-01c · L2]** A proposal MUST NOT leave a terminal state.
- **[DSOR-IDM-04 · L2]** A proposal MUST be executed at most once; the proposal id is the
  idempotency key of its execution. ([§22](../../../specs/dsor/03-execution.md#22-idempotency))
- **[DSOR-AUD-01 · L1]** Every command decision, every proposal transition, and every read covered by
  `DSOR-CLS-05` MUST produce a durable audit record that validates against `audit-record.schema.json`.
  ([§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence))

Step 08 met `DSOR-AUD-01` for decisions, and step 14 for reads. This step adds the transitions:
every move is a record in the log, written by the statement that makes the move, and the records
are checked against the schema in the tests.

**What this step leaves, said plainly.** The proposal id is not passed on to the system that does
the work as its key: a proposal runs at most once because READY is left once, and passing a key on
waits for a connector that takes one (`DSOR-IDM-03`), so `DSOR-IDM-04` is met in part. One key is
one proposal, except after a released claim: the retry makes a second. The first is DENIED, or
stays PROPOSED when even DENIED cannot be written. Nothing here carries out a PROPOSED proposal.
When the reply to a proposal's creation is lost, DSoR looks for the creation's record. Found, the
request carries on with that one proposal. Not found, or the proposal cannot be read back, the
answer is `OUTCOME_UNKNOWN` and the key stays taken, so no second proposal is made.
When the door's own move lost its reply, the claim is released only once DENIED is written,
because only that proves the lost move can never land. If the proposal cannot be read back, or
DENIED is refused or cannot be written, the answer is `OUTCOME_UNKNOWN` and the key stays taken.
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
A proposal whose creation nobody could confirm stays PROPOSED, if it was written at all, and one
whose last move could not be written, after two tries of ten places each, stays EXECUTING, in its
history and in the log: both wait for reconciliation, step 38. A handler that throws
leaves its proposal OUTCOME_UNKNOWN, but the throw still reaches the caller as a throw, not as an
`OUTCOME_UNKNOWN` answer; that is step 37's. There is no `proposal.get` yet, because who may read a
proposal is a rule of its own; the demo reads the store. Only one mode, `execute`, is built;
`propose_only` and `validate_only` are step 23's, and the approval states step 29's.

The records of the moves leave limits of their own:

- **The record of a creation does not name its proposal.** Its first move names the record. A
  reader who has only the log links the two through the request id.
- **The database checks that a move's record exists, not that it is that move's own.** The tests
  check the pairing; a careless new path could still point a move at another record.
- **The owner can still delete.** It can delete a move and then its record, or the end of the log,
  and the chain shows an edit, not a deletion from the end. While a move names a record, that
  record cannot be deleted by itself, and the log cannot be emptied with TRUNCATE by itself; a
  TRUNCATE of the log and the moves together, or with CASCADE, empties both.
- **Each company's log has one end that all its requests share.** A request that loses ten places
  before its handler runs is refused, with nothing done; a last move that loses them twice leaves
  its proposal EXECUTING, as said above. Ten places, and a pause of up to 25 milliseconds more after each
  place lost, were measured on one machine against a local PostgreSQL 17, not on Neon, where each
  round trip takes longer.
- **A request in a crowd waits**: up to about 1.1 seconds for one record, and twice that for a last
  move tried twice. A retry with the same key waits 2 seconds for the first request, so it can be
  told `OUTCOME_UNKNOWN` while the first is still in the crowd.
- **Proposal numbers can skip.** A creation that loses its place has already taken its number.
- **The record's schema has no field for the state a move left, its actor or its cause.** They are
  words in the record's reason. That is a question for the specification.
- **Two clocks.** A move's time is the database's clock; its record's time is the program's.
- **Start-up does not ask** whether a move must still name its record, as it asks about the
  application's rights.

Everything earlier steps claimed still holds.

**Next:** step 23, `three_ways_to_call` — `execute` does it, `propose_only` prepares it for
someone else to release, and `validate_only` is a dry run with no side effects at all.
