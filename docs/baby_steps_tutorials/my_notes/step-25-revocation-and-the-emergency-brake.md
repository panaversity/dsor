# Step 25 · Revocation and the emergency brake

Folder: [`my_25_revocation_and_the_emergency_brake`](../my_25_revocation_and_the_emergency_brake/README.md)
· 1014 tests, plus 72 in the database tier
Spec: [§13.3](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation),
[§18](../../../specs/dsor/02-security.md#18-operational-controls) · `DSOR-OPS-01a`,
`DSOR-OPS-01c`, `DSOR-OPS-01d`, and `DSOR-DEL-04a` and `DSOR-DEL-04c` in part
The database tier, 72 tests, passes on a local PostgreSQL 17 set up like Neon, twenty-six migrations
applied, on the final code; on Neon, `dsor_step25` waits for this folder's `.env`. Decisions
[142](decisions.md) and [143](decisions.md). Stage 3 of the learning path is complete.

## What the step is

A brake, kept in DSoR's own store: `control.suspend` stops one agent in one company, or every agent in
it, and releases it. §21.4, a stage of its own, refuses a stopped agent's commands
`AGENT_SUSPENDED` and lets its reads through; the move to EXECUTING, and a prepared command's to
READY, ask the brake again in the same statement. `delegation.revoke` marks a slip revoked, with who
and why, and cancels in the same statement every proposal under it waiting for approval or approved,
releasing their reservations. Who may revoke, the signer, and who may release a brake, a person, are
decided at §21.9 and recorded. None of it asks the agent to cooperate.

## How it was built

Built on the learner's standing instruction: the problem stated first, and every decision taken with
the recommended option ([decision 142](decisions.md)), each open to reversal.

1. **The brake's record**: migration 024, `src/controls.ts`.
2. **§21.4**, and the stage-order test made a proof by its parts.
3. **The second lock**, on the move to EXECUTING.
4. **`control.suspend`.**
5. **`delegation.revoke`**, migrations 025 and 026.
6. **The demo**: the brake at 3 a.m., and a month-end freeze.

## What the build found

**Eleven stages would take a minute to walk.** All 39,916,800 orderings took 65 seconds; the test
became a proof by its parts, and a review then found the parts missing a cycle of three.

**An argument named `delegation` is refused at §21.6**, so that no request names the slip it runs
under; the slip a revocation names is its `target`. A question for the specification, written down.

**The cross-tenant suite needs every example's address in both companies**: org_789 got a del_100 of
its own, signed for an agent of its own, so the story's agent still has no slip there.

**The second lock catches what §21.4 misses, in other words**: with §21.4 taken out, a stopped agent's
payment was still stopped, after an ALLOW was on the record.

## Limits, stated

- A tenant administrator who could revoke any slip is nobody in the cast.
- Nothing cancels what waits under a slip that expired.
- A command already past §21.3 when its slip is revoked is still decided under it, and runs
  (decision 156).
- A brake committing during the move to EXECUTING is not seen by that move.
- "A person" is whoever logged in, until steps 43 and 44.

## The hostile review

One reviewer, read-only, with probes in its own copy. It found the brake before the claim, read from
DSoR's store, never the arguments; freezes kept to their company; a lift final; a slip beyond the
application's reach once revoked or expired (a suspended one, too, until decision 156 let its signer
revoke it); and revoking and cancelling in one statement. It found, as
[decision 143](decisions.md):

- **A refusal recorded as ALLOW** (measured): who may revoke, and who may release, moved to §21.9.
- **The brake on the move to EXECUTING was optional** (measured): now required, and no single move
  enters EXECUTING.
- **A prepared command was not stopped by a brake pulled after §21.4** (measured): now it is.
- **Smaller ones**: an agent named `*`, a revocation with no name, start-up's column list, §21.4 for
  queries, and the ordering proof's cycles of three.

Written down: `DSOR-SRC-02b` read literally against `DSOR-DEL-04a`, a question for the editor; the
expiry half of `DSOR-DEL-04c`; a command past §21.3 when its slip is revoked; the race of one statement; the
login believed.

Every fix was broken once and failed as predicted; the README's three breaks were measured twice on
the final code, agreeing: 11, 3 and 8 failing.
