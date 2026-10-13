# Step 23 · Three ways to call

Folder: [`my_23_three_ways_to_call`](../my_23_three_ways_to_call/README.md) · 868 tests, plus 57 in
the database tier
Spec: [§7.3](../../../specs/dsor/01-model.md#73-invocation-modes) · `DSOR-OPR-05`, `DSOR-OPR-06`
The database tier, 57 tests, passes on a local PostgreSQL 17 set up like Neon, twenty-one migrations
applied, on the final code; on Neon, `dsor_step23` waits for this folder's `.env`. Decisions
[138](decisions.md) and [139](decisions.md).

## What the step is

A command is called one of three ways, said beside its arguments as the key is. `execute` does it.
`propose_only` walks the same checklist, makes the proposal and stops at READY, "waiting to be
released". `validate_only` skips the claim and the proposal, as §21 says, still asks the limit and
records the decision, as VALIDATED, and answers VALIDATED, ALLOW, with nothing done. The claim keeps
the mode, so the same key in another mode is another request.

## How it was built

Built on the learner's standing instruction: the problem stated first, and every decision taken with
the recommended option ([decision 138](decisions.md)), each open to reversal.

1. **The mode, read and checked, and kept on the claim**: migration 021.
2. **The dry run**: no claim, no proposal, recorded as VALIDATED, answered and not carried out.
3. **The prepared command**: its proposal to READY, and nothing run.
4. **The demo**: one payment, three ways, and only the third makes it.

## What the build found

**A receipt with no row.** The demo's printer, two tests and the stale section all read a receipt's
`data`, which a READY or VALIDATED answer does not have; the type says so now, and they ask.

**A rename that reached too far.** Naming the new section's counter the same as the step-20 one
clashed, and the rename caught both; the old one was put back by line.

## Limits, stated

- A dry run, and a prepared command, are decided without the handlers' preconditions, until step 32.
- A prepared proposal waits at READY until `proposal.execute`, step 31, with nothing to cancel it.
- No `.propose` permission; no reservations or holds yet for a dry run to leave alone.

## The hostile review

One reviewer, read-only, with probes in its own copy. It found a dry run claiming and proposing
nothing, recorded before it is answered, the mode read once, the claim keeping it with no right to
change it, and no path from a prepared command to a handler. It found, measured, and fixed as
[decision 139](decisions.md):

- **One request could leave two READY proposals**, when a move's reply was lost and the read-back
  failed too: now `OUTCOME_UNKNOWN`, with the claim kept, before READY and before a handler.
- **A mode on the request's prototype was ignored, and the call executed.** Now refused.
- **Nothing tested how the mode is read**, or a READY reply lost. Now it does.

Written down: a dry run skips the handlers' preconditions, pinned by a test until step 32.

Decision 139's three fixes were broken once each and failed exactly their one test; the README's
three breaks were measured twice on the final code, agreeing: 14, 2 and 17 failing, the first more
than predicted.
