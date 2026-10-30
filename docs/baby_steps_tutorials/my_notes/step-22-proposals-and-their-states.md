# Step 22 · Proposals and their states

Folder: [`my_22_proposals_and_their_states`](../my_22_proposals_and_their_states/README.md) · 833
tests, plus 57 in the database tier
Spec: [§26.2](../../../specs/dsor/03-execution.md#262-lifecycle) · `DSOR-APR-01a`, `DSOR-APR-01b`,
`DSOR-APR-01c`, and `DSOR-IDM-04` in part
The database tier, 57 tests, passes on a local PostgreSQL 17 set up like Neon, twenty migrations
applied, on the final code; on Neon, `dsor_step22` waits for this folder's `.env`. Decisions
[136](decisions.md) and [137](decisions.md).

## What the step is

Every command that gets past its key's claim becomes a proposal at §21.8: its payload as the text
that was hashed, who asked, its key. Its history is a list of moves, each with an actor and a cause,
and its state is its last move. The map of §26.2, without its compensation line, is a table, every move must be on it, and the
history is one line: a state is entered once and left once, and a move out needs the move in. So a
finished proposal cannot move, and one proposal cannot run twice, and both are the database's rules,
not the code's. The door moves each proposal: DENIED when a later stage refuses, READY and
EXECUTING together before the handler, then COMMITTED, FAILED or OUTCOME_UNKNOWN.

## How it was built

Built on the learner's standing instruction: the problem stated first, and every decision taken with
the recommended option ([decision 136](decisions.md)), each open to reversal.

1. **The tables and the store**: migration 020, `src/proposal.ts`, start-up's eight tables.
2. **The stage at §21.8 and the door's moves**, and the receipt naming the real proposal.
3. **The demo**: this run's proposals, the stale cancel move by move, a finished one refusing.
4. **The race on a real server**, and a test for leaving a state twice.

## What the build found

**A design changed before its first line.** The first plan kept the state in a column, guarded by a
restrictive policy as step 20 keeps an answer, with the map in a table the policy read. Start-up lets
the application read only the tenant tables, so the policy could not read the map. The history became
the state instead, and a foreign key, checked as the table's owner, reads the map for it.

**The orderings test would have held 3,628,800 arrays.** With a tenth stage, it walks them one at a
time from a generator, and keeps only the count.

**The receipt's proposal was a counter** that started again with every run. It is the store's now,
and still checked against the company.

## Limits, stated

- The proposal id is not passed on as the key of the work: `DSOR-IDM-04` in part.
- One key is one proposal, except after a released claim.
- A store that failed is DENIED, the only finished state out of PROPOSED; its cause says so.
- Proposal numbers come from one sequence for every company, as payment numbers do.
- A creation whose reply was lost stays PROPOSED, and a last move not written stays EXECUTING.
- No `proposal.get`; one mode, `execute`.

## The hostile review

One reviewer, read-only, with probes in its own copy. It found the map equal to §26.2's, but for the compensation line no step builds, the history
one line, a finished proposal refused even to raw SQL, the rights narrow, the tenants apart. It found,
measured, and fixed as [decision 137](decisions.md):

- **A proposal left READY or EXECUTING for good** when a move before the handler failed or lost its
  reply, and a second proposal for the retry. READY and EXECUTING are one statement now, and a lost
  reply is read back.
- **A careless handler's TRANSACTION_FAILED was believed**, and the proposal finished as FAILED.
  FAILED now only for the four codes that say nothing was done.
- **Nothing tested the door finding its proposal moved.** A test now does, and the handler is never
  called.

Five were written down instead; they are the limits above.

Decision 137's three fixes were broken once each and failed exactly their one test, though the
one-statement half of the first was first broken by decision 153; the README's
five breaks were measured twice on the final code, agreeing: 5, 3, 40, 16 and 9 failing.
