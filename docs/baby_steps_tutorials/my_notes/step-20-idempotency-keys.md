# Step 20 · Idempotency keys

Folder: [`my_20_idempotency_keys`](../my_20_idempotency_keys/README.md) · 702 tests, plus 52
in the database tier
Spec: [§22](../../../specs/dsor/03-execution.md#22-idempotency) · `DSOR-IDM-01a`, `DSOR-IDM-01b`,
`DSOR-IDM-01c`, `DSOR-IDM-01d`, and `DSOR-TEN-02a` for the claims' table
The database tier, 52 tests, passes on a local PostgreSQL 17 set up like Neon, eighteen migrations
applied, on the final code, with the step's race run five more times on its own; on Neon,
`dsor_step20` waits for this folder's `.env`. Decisions [131](decisions.md) and
[132](decisions.md).

## What the step is

Every command carries an idempotency key, a name the caller chooses for one logical request, beside
its arguments and never inside them. DSoR claims the key at §21.7 with one INSERT, under a primary
key on the company, the caller who logged in, the operation and the key, and keeps the request's
fingerprint and its answer on the claim. The same key and the same request get the same answer, word
for word, and nothing runs again; the same key with a different request is refused with
`IDEMPOTENCY_CONFLICT`; the same request still being carried out is waited for; and fifty requests
with one key, sent at once, make one payment.

## How it was built

Built on the learner's standing instruction while they slept: the problem stated first, and every
decision taken with the recommended option ([decision 131](decisions.md)), each open to reversal.

Then the copy, its markers made plain, and the pieces, each red first and committed alone:

1. **The claims' table.** Migration 018, under the second lock; the application claims and answers
   and deletes and rewrites nothing; start-up knows six tenant tables.
2. **The door takes what travels beside the arguments**, and the tests knock on a door that gives
   each request a fresh key, as a careful client would. No behavior changed.
3. **The claim at §21.7**: replay, conflict, the wait for a request still being carried out, and the
   release of an answer that invites the same key again.
4. **The demo**: a payment sent twice, a different one under the same key, and fifty at once.
5. **The race on a real server**, fifty requests over a pool of twenty connections.

## What the build found

**The database reorders an answer's keys.** The answer was first kept as JSONB, and a replay was the
same answer with its keys in another order: the same, but not word for word. It is kept as the text
it was written now.

**The stages' own tests had to learn a ninth stage.** The tests that pin the pipeline counted eight
stages and 40,320 orderings; with the claim there are nine and 362,880, and still exactly one order
is accepted. A stage lazied to do nothing for a command is caught at §21.11, which refuses a command
with no claim.

**A test of the registry said nothing reads a contract's delegation or idempotency.** Both are read
now, and both say true for every command.

**The race test was formatted from inside the step folder**, where the repository's formatter
settings do not reach, and the root check found it.

## Limits, stated

- Claims are kept for ever; `DSOR-IDM-02` asks for at least 24 hours, and clearing old ones is later.
- A claim left with no answer, a handler that threw, a lost reply, a store that failed after the
  request ran, is a key no retry can use until reconciliation, step 37.
- A replay records nothing; whether §29 asks it to is a question for the specification.
- The fingerprint depends on the order of the request's fields until canonical JSON, step 29.
- One mode, execute; `propose_only` and the proposal as its own key (`DSOR-IDM-04`) are steps 22 and
  23. Passing the key on to the bank (`DSOR-IDM-03`) waits for a connector that takes one.

## The hostile review

One reviewer, read-only, with probes in its own copy. It found `DSOR-IDM-01a` to `01d` met for the
answers that are kept: one INSERT on the primary key, the caller who logged in as the principal, a
different request refused before any waiting, and a replay that cannot skip §21.3 to §21.5. It found
three broken guarantees, each measured, and all were fixed on the learner's standing instruction, with
the recommended option, as [decision 132](decisions.md), each red first and in a commit of its own:

- **A handler's "safe to send again" reopened the claim** after the payment was made: three attempts
  under one key, three payments. Only a refusal from the walk releases a claim now.
- **The application's right to write an answer was the right to rewrite one**: a kept receipt was
  overwritten with "released", and the same request paid twice; a forged answer was replayed. A
  second, restrictive policy keeps an answer once written, start-up asks for it, and a replay is
  checked against its caller.
- **A claim whose reply was lost left a key no retry could use**, with two messages that said more
  than DSoR knew. The messages say what is known, a failed settle is tried again, and the dead key
  is written down for step 37's reconciliation.

And: the key read as the request's own field, a wait that looks less often, eleven tests for what
nothing tested, and comments that said what the grants and the steps did not hold.

Four were written down instead: a replay records nothing, which §29 may say it should; the wait
running out is recorded as a `DENY`; the fingerprint depends on field order until step 29; and
`LIMIT_EXCEEDED` says `after_delay` while the same key replays it.

Six breaks, one per fix, each broken once, in a copy, on the whole suite, with the prediction written
first ([decision 132](decisions.md) has the table). All six failed as predicted. The README's five
were measured twice, and the two runs agreed; one, a key for every caller, failed fifteen tests where
two were predicted, because the break also stopped every answer being found again.
