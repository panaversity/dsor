---
name: implement-spec
description: The discipline for implementing any DSoR requirement or learning-path stage in this repo — pick requirement ids, write red tests titled by id, implement in requirement-sized commits, attack the result with the threat table, break it on purpose (crash, race, timeout), then sweep docs/status.md. Load before writing the first line of implementation code under packages/dsor/.
metadata:
  version: "1.0.0"
  origin: adapted from panaversity/ksor .agents/skills/implement-spec (2026-09-19)
---

# Implementing the DSoR specification

The specification is the contract. This skill is how the contract becomes code without
losing a guarantee on the way. Follow it in order.

## 1 · Choose the work by requirement id

1. Open `docs/status.md` and `docs/learn/learning-path.md`. Find the current stage.
2. Run `pnpm coverage:req --list`. It prints every requirement id that no test names.
3. Pick a small set of ids from the current stage. Read each one in
   `packages/spec/requirements.json`, then read its whole section in `specs/dsor/`,
   including **Why it matters** and **Common mistake**. The mistake named there is the
   one you are about to make.
4. Write the list of ids into the branch's first commit message or PR description.
   An id with no test planned is a hole. Fix the plan now.

## 2 · Red first

Turn each requirement into a **failing test before any implementation**.

- The test title **starts with the requirement id**:
  `it("DSOR-EXE-02: a denied command is recorded before the response", …)`.
  `pnpm coverage:req` counts coverage from these titles.
- Test the negative promise, not only the happy path. `MUST NOT` requirements need a
  test that tries the forbidden thing and watches it fail.
- Put it in the right tier. Anything about tenant isolation, atomic reservation, the
  idempotency claim, or audit immutability is a `*.db.test.ts` against real PostgreSQL.
  Never a mock (AGENTS.md → Testing).
- Run the test. Watch it fail **for the right reason**.

Every artifact the code emits (result, error, proposal, approval, decision bundle,
audit record, event) is validated in tests against its schema from
`@panaversity/dsor-spec`.

## 3 · Implement in requirement-sized commits

One requirement, its test, its code. The smallest change that turns that red test
green. Never batch five requirements into one commit; review dies there.

Keep the pipeline order of §21 visible in the code. A reader should be able to put the
seventeen steps beside the function and tick them off.

## 4 · Attack your own work

Before saying "done":

- **Clause by clause.** Re-read each requirement against the diff. Each has a passing
  test or a written reason it cannot.
- **Threat table.** Walk `specs/dsor/02-security.md` §10.2. For every threat your
  change touches, say how the code stops it, and point to the test.
- **The agent is hostile.** Ask: what if the caller lies in every argument, replays
  the request, sends it twice in parallel, and changes its task id? Which line of
  code, not which prompt, stops each one?
- **Hostile review.** Ask the `requirement-reviewer` subagent for a pass, giving it the
  requirement ids and the diff. Findings get fixed or recorded in the PR. Never
  quietly dropped.

## 5 · Break it on purpose

Tests prove clauses. Only breaking the system proves a guarantee.

- **Crash:** kill the process between the intent record and the final outcome. After
  restart the proposal must read `OUTCOME_UNKNOWN`.
- **Race:** fire N parallel requests with one idempotency key, and N parallel commands
  against one cumulative limit. Exactly one executes; the limit is never exceeded.
- **Silence:** make the fake connector accept the request and never answer. The caller
  gets `OUTCOME_UNKNOWN`, the holds appear, and a second payment of the same invoice
  is refused.
- **Tamper:** edit one old audit row as a superuser. The chain verifier must fail.
- **Stale:** change the vendor after approval and before execution. The proposal
  becomes `INVALIDATED`.

Record what a live run taught beside the code: `// found live 2026-10-02: …`.

## 6 · The detail pass

Every error carries a code from §28 and a retry class. No amount is a `number`. No
secret is in a log line. Every timestamp is UTC from the server. No present-tense
claim about unbuilt behavior is anywhere in the diff.

## 7 · Truth sweep and gate

- Update `docs/status.md`: stage, what now works, `pnpm coverage:req` numbers.
- If implementing showed a requirement is wrong, unclear, or untestable, load the
  `change-the-spec` skill and fix the specification **in the same pull request**.
- Run `pnpm check`. Report what it printed.
