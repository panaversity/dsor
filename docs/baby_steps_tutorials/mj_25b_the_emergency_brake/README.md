# Step 25b · The emergency brake

**New in this step:** a person who holds `control:suspend` pulls an emergency brake inside DSoR,
on one agent or on every agent of the company. Line ④ then refuses each command from that agent,
and a draft already on its way cannot slip past the brake. Only a person lifts it
(DSOR-OPS-01a to DSOR-OPS-01d).

## In plain words

Step 25 gave user_123 one way to stop the agent: tear up its slip. That is final. The agent
needs a new slip, and its waiting work is cancelled. Sometimes a person needs a stop that is
quick and that can be undone: "stop now, and we look at it in the morning".

This step adds that stop, the *emergency brake*. A person who holds the permission
`control:suspend` can:

- *suspend* one agent in one company, such as accounts-payable-fte in org_456, or
- *freeze* the company: every agent of org_456 at once.

While a brake is on, each command from an agent it stops hears `AGENT_SUSPENDED`, in every mode.
The agent can still read. People are never stopped. Only a person who holds `control:suspend`
can lift the brake, and the agent can never lift it.

Think of DSoR as the careful new clerk who runs one checklist for every request. The brake is a
note that user_123 pins on the clerk's desk: "take no change from accounts-payable-fte until I
take this note down". The clerk reads the notes on the desk at line ④, for every request. A form
already in the clerk's hands is finished first, and recorded, and the note goes up after it. The
clerk still answers the agent's questions, because the note stops changes, not reads. And the
agent can never take the note down: only a person who holds `control:suspend` can.

**Two words that look alike.** Step 19b *suspends slips*: when the directory says that user_123
has left, the slips user_123 signed are suspended. This step *suspends an agent*: that is the
brake. A suspended slip stops one slip. A suspended agent stops the agent, under every slip it
holds.

## Why it matters

Tuesday, 03:10. accounts-payable-fte has gone wrong. Text inside an invoice tells it to pay, and
it drafts one payment of 31,400.00 USD after another. user_123 sees the alert after three
drafts, 94,200.00 USD. What can user_123 do?

- Ask the agent to stop. That is a prompt, and the agent may ignore it. Nothing in DSoR may
  depend on the agent's good behaviour (AGENTS.md, critical rule 2).
- Tear up del_100 (step 25). The agent stops, but for good, and its waiting work is cancelled.
  At 03:10 nobody knows yet whether the agent or the invoice is at fault.
- Wait for step 24's limit. It stops the agent only after six drafts, 188,400.00 USD.

Before this step, line ④ of the checklist, "check operational status", was a comment: "Not
checked yet". And the race is real. A draft that passed line ④ a moment before the brake would
still run. §18 says that a proposal of a braked agent must never enter EXECUTING.

## The design, before any code

### How this step was made

On 2026-10-09 the learner chose to build the brake as a step of its own, 25b, before step 26. The design of step 25 held the
brake's questions, L6 to L9, with options, downsides, and recommendations. Then the learner asked
for the build at once, while away: "go ahead, build 25b after 25 is done". So Claude Code took
each recommendation, and built the step. Each decision below says that it was Claude Code's,
and each is **for the learner to review** in the session. A decision the learner changes is
changed in the code, with its tests.

The specification it relies on, read on 2026-10-09:

- [§18](../../../specs/dsor/02-security.md#18-operational-controls): "This is the emergency
  brake." Its table: an agent suspension means "One agent principal can make no state change in
  the tenant", and a tenant agent freeze means "no agent principal can change state in the
  tenant". Both answer `AGENT_SUSPENDED`. DSOR-OPS-01a, DSOR-OPS-01b, DSOR-OPS-01c, and
  DSOR-OPS-01d.
- [§21](../../../specs/dsor/03-execution.md#21-command-pipeline): line 4, "Check operational
  status (suspension, freeze, breaker)", after line 3, the slip, and before line 5, the
  permission. Queries pass through lines 1 to 6 too.
- [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds): a suspension or freeze takes
  effect within 60 s at L2, and 5 s at L3.
- [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes): `AGENT_SUSPENDED`,
  retry "never (a human must lift)".
- [§45](../../../specs/dsor/06-conformance.md#45-security-invariants): "Agents never approve,
  never activate controls, never lift suspensions, and never resolve unknown outcomes."
- `audit-record.schema.json`: the record kind `operational_control`, and its list `resources`.

What step 25 already had: DSoR's own work, with a check at line ⑨ and a change after line ⑩
(step 25's README, decision D7), and line ⑤'s "people only". What it lacked: all of line ④.

### The intent and the outcome

**Intent.** A person can stop an agent at once, from inside DSoR, and lift the stop later. The
agent can neither block the stop nor undo it.

**Outcome.** What is true when this step is done:

1. user_123 suspends accounts-payable-fte in org_456. Its next command, in any mode, hears
   `AGENT_SUSPENDED`. Its reads still answer. user_123's own commands still work, and so do
   firm-ap-fte's.
2. A freeze of org_456 stops every agent in org_456, firm-ap-fte too. In org_789, firm-ap-fte
   still works.
3. A draft already inside its transaction when the brake is pulled finishes, and is recorded.
   The brake waits for it. No draft enters EXECUTING after the brake takes effect.
4. Only a person who holds `control:suspend` pulls or lifts the brake. The agent's own try is
   refused, even when its slip lists the permission.
5. One brake for each target. A second pull of the same brake, and a lift with no brake on, are
   refused with `CONFLICT`. Every pull and every lift stays in the history.
6. The agent's own code is not changed. That is the map's test for this step: "a suspended agent
   is refused and you did not touch the agent's code".

### What each rule says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-OPS-01a | **C1.** A person can suspend one agent in one company. Its commands are refused in every mode. Its reads pass, and so do a person's calls and another agent's | Unit and database |
| DSOR-OPS-01a | **C2.** A person can freeze every agent of one company, and only of that company | Unit and database: firm-ap-fte in org_456 and in org_789 |
| DSOR-OPS-01b | **C3.** The brake takes effect for the next decision, and the lift too: line ④ reads the store at every call, with no cache | Unit and database |
| DSOR-OPS-01c | **C4.** No proposal of a braked agent enters EXECUTING after the brake takes effect. A draft inside its transaction finishes first, and the brake waits for it. A draft that comes during the pull waits for it. Then it is refused, and its proposal ends DENIED. Both orders, for an agent's brake and for a freeze | Database: drafts in flight, in both orders |
| DSOR-OPS-01d | **C5.** Only a person who holds `control:suspend` lifts the brake. The braked agent's own lift is refused at line ④, as each of its commands is. Another agent is refused at line ⑤, in every mode, even when its slip lists the permission. So is an application, and so is the CFO, who does not hold it | Unit and database |
| (decision L6) | **C6.** The same people, and only they, pull the brake | Unit |
| (decision L9) | **C7.** One brake for each target. A second pull, and a lift with no brake on, give `CONFLICT`. Two pulls at once leave one brake on | Unit and database |
| DSOR-AUD-01 | **C8.** Each pull and each lift is a command with its decision record, and leaves one `operational_control` record: the person, their words, the call, and the target | Unit and database |
| (decision D2) | **C9.** The target is this company, or an agent of it. Another company's URI is refused at the URI check. An agent DSoR does not know here, or a person, is "no agent" | Unit |
| (decisions D5, D9) | **C10.** The database's own rules: `dsor_runtime` can add a brake only as one that is on, lift it once, and never delete it or change who pulled it. Row-level security, and DSoR's own WHERE, keep each brake in its company | Database: hand-written SQL as `dsor_runtime`, and the owner, whom no policy stops |

### Decisions the specification leaves to us

Each one is Claude Code's, taken because the learner asked for the build while away, and each is
for the learner to review. L3 and L6 to L9 are step 25's design questions, about the brake. D1 to
D14 came up while designing and building this step.

**The design's questions, about the brake**

- **L3. `control:suspend` for `ap_supervisor` and `tenant_admin` (Claude Code).** DSOR-OPS-01d
  names the permission. Here the permission is the whole rule: there is no "own brake", as there
  is an own slip. So the CFO does not hold it, and neither does a clerk. *Downside:* every
  supervisor can brake every agent of the company.
- **L6. Only a person who holds `control:suspend` may pull the brake (Claude Code).** DSOR-OPS-01d
  says who may lift it. Nothing says who may pull it (open question 102). One rule for both, and
  line ⑤'s "people only" refuses every caller that is not a person. *Downside:* at 03:10 the
  brake waits for a person to wake up. A watchdog agent, which watches other agents, is a later
  idea.
- **L7. The brake stops every command from the agent, in every mode (Claude Code).** Line ④
  refuses it with `AGENT_SUSPENDED`: a real call, a prepared call, and a dry run, which hears the
  real call's answer (step 23's decision 3). Its queries pass, because §18 stops "state change".
  *Downside:* a braked agent can still read, and so can still copy out what it reads.
- **L8. Line ④, and the same check again inside the claim's transaction, under a lock (Claude
  Code).** Line ④ runs before the claim's transaction. A draft can pass line ④ at
  03:10:00.000, and the brake can take effect at 03:10:00.001. So right after line ⑧, inside the
  claim, DSoR checks the brake again, under a lock. Many drafts can hold the lock at the same
  time. A pull waits until no draft holds it, and new drafts wait behind the pull. So a draft
  inside its transaction finishes before the brake can take effect. A draft that comes during the
  pull waits for it. Then it hears `AGENT_SUSPENDED`, and its proposal ends DENIED. *Downside:*
  every command from an agent takes one more lock, and the brake waits for the drafts on their
  way. That is usually milliseconds, but nothing limits the wait yet: a stuck draft holds the
  brake back (finding M1 under "Think it through").
- **L9. One brake for each target (Claude Code).** An agent, or the company, is braked or not. A
  second pull is refused, and one lift releases it. Every pull and every lift stays in the
  history. *Downside:* when two people pull for two reasons, one lift releases both.

**Found while designing and building**

- **D1. Two commands through the checklist (Claude Code).** `control.suspend { target, reason }`
  pulls the brake, and `control.lift { target, reason }` lifts it. Each has a key, a proposal, and
  a decision record, as step 25's tear-up does. Each is DSoR's own work, with a check at line ⑨
  and a change after line ⑩ (step 25's README, decisions D2 and D7). The specification names no operation for
  the brake (open question 103). *Downside:* a person needs a login to pull the brake.
- **D2. The target is a URI (Claude Code).** `dsor://org_456/agent/accounts-payable-fte` names one
  agent. `dsor://org_456/tenant/org_456` names the company, so every agent of it. The URI check
  refuses another company's URI, as it refuses any other. An id that is not an agent of this
  company in DSoR's table of logins is "no agent", and so is a person's id. *Downside:* `agent` and
  `tenant` are this tutorial's own entity names.
- **D3. Line ④ reads the brakes at every call, with no cache (Claude Code).** So a brake reaches
  every decision after its pull commits, and so does a lift. The pull itself waits for the drafts
  on their way, so §44's bound of 5 s holds only while no draft is stuck (finding M1). Only a
  caller that DSoR treats as an agent is checked, and only for a command. *Downside:* one more
  read on every agent's command.
- **D4. The second check, after line ⑧ (Claude Code).** Inside the claim, before line ⑨, as L8
  asks. Its refusal is a "no" before any work, as line ⑨'s and line ⑩'s are: the proposal ends
  DENIED, and the record says DENY. *Downside:* a braked agent's call that raced the brake leaves
  a proposal, where one refused at line ④ leaves none.
- **D5. The brakes live in `dsor.brakes` (Claude Code).** One row for each pull, and its lift in
  the same row, once: who, when, and why, both times. At most one brake on for each target, by a
  unique index. *Downside:* the row of a lifted brake stays for ever.
- **D6. Records (Claude Code).** Each pull and each lift leaves one `operational_control` record
  in the command's own transaction: `suspended`, `frozen`, or `lifted`, the person's words, the
  call, and the target's URI in `resources`. *Downside:* to see who pulled a brake, one reads the
  log or the brake's row.
- **D7. The brake's words (Claude Code).** `AGENT_SUSPENDED`: "accounts-payable-fte may make no
  change in org_456: an emergency brake is on". It names no person and no reason, so a
  misbehaving agent learns nothing to work around. *Downside:* the agent's operator learns the
  reason from the people, not from the error.
- **D8. The lock is a PostgreSQL advisory lock (Claude Code).** A lock on a number that the
  program chooses, not on a row: one number for each agent of each company, and one for each
  company. An agent's command holds both numbers, and many commands can hold them at once. A
  pull waits until no command holds its target's number, then holds it alone. *Downside:* the
  store map does not see an advisory lock, so only a test proves it.
- **D9. Migration 019 (Claude Code).** The table, its company's lock, two policies (a brake
  starts on, and is lifted once), the grants, and the log's new kind of record. *Downside:* none
  found.
- **D10. A lift takes no lock (Claude Code).** A lift only lets work go again. A draft that still
  sees the brake for a moment is refused, and the agent must send it again as a new call.
  *Downside:* a draft refused just before a lift needs a new call.
- **D11. A brake's time is when it was written (Claude Code).** `pulled_at` is
  `clock_timestamp()`, the moment of the insert, after the pull waited for the drafts on their
  way. `now()` would give the start of the pull's transaction, before the wait. A CHECK keeps a
  lift after its pull. *Downside:* each record's time is the start of its own transaction, so a
  record can show an earlier time than its brake.
- **D12. The program brakes in memory (Claude Code).** As step 25's tear-up does (step 25's
  README, decision D9). *Downside:* the shared database never shows a brake.
- **D13. The examples name intake-fte (Claude Code).** The cross-tenant suite makes a real call
  with each example. With accounts-payable-fte as the target, the suite braked the agent, and
  every later attack by it was refused for the wrong reason. intake-fte is an agent that only the
  tests plant, so the suite's call hears "no agent", and brakes nobody. *Downside:* the example
  names an agent that the program does not know.
- **D14. The answer is the brake (Claude Code).** `{ tenant_id, id, target, status }`, a row of
  kind `Brake`, so the decision record names the brake's URI. *Downside:* none found.

### The tests, by claim

| Claims | Where |
| --- | --- |
| C1 to C3, C5 to C9 | [`test/brakes.test.ts`](test/brakes.test.ts) |
| C1 to C5, C7, C8, C10 | [`test/brakes.db.test.ts`](test/brakes.db.test.ts) |

### Breaks we will try, and what we expect

| Break | What we expect |
| --- | --- |
| B1. Line ④ is gone | The braked agent's draft is still refused, inside the claim, but its dry run says VALIDATED |
| B2. No second check inside the claim | A draft that passed line ④ before the brake, and is slow inside its transaction, enters EXECUTING while the brake is on |
| B3. The second check, with no lock | The same: the check runs before the brake is written, and the draft finishes after it |
| B4. The lift forgets "people only" | The agent lifts its own brake |

The learner's predictions for these come in the understanding session.

### Left open, and not this step's idea

- A braked agent's prepared proposal, which waits in READY. Nothing releases one before step 31,
  and step 31's release must check the brake (DSOR-OPS-03b).
- Rate limits (DSOR-OPS-02), operation freezes and circuit breakers (DSOR-OPS-03a): later steps.
- A watchdog agent that may pull the brake (decision L6, open question 102).
- A time limit for a draft on its way, so that a stuck draft cannot hold a brake back past §44's
  bound (finding M1). What should the draft hear when its own time runs out? That is a decision
  for the session. Step 35's slow bank and step 51's measured brake come back to it.
- A lift's time is written by DSoR's own statement, from the database's clock, and a CHECK keeps
  it after the pull. But `dsor_runtime` holds the column, so a bug could write another time
  (finding L5). A trigger would make it the database's own, and the store map allows no trigger
  on this kind of table.
- A registry built with no brakes store says that no brake is on (finding L8). A start-up check
  that a registry with the brake's commands also has their store is a later fix.

## Before you build: set up a database

As in step 25: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Migration 019 runs.

## What changed since step 25

| File | What changed |
| --- | --- |
| `contracts/control.suspend.json`, `contracts/control.lift.json`, `inputs/BrakeRequest.schema.json`, `examples/control.*.json` | **New.** The brake's two contracts, their input, and the cross-tenant suite's examples |
| `src/brakes.ts` | **New.** The brakes in memory, line ④'s check and the check after line ⑧, and the two commands as DSoR's own work |
| `migrations/019_brakes.sql` | **New.** `dsor.brakes`, its company's lock, `starts_on` and `lifts_once`, the grants, and the log's `operational_control` |
| `src/pipeline.ts` | Line ④ checks the brake. The check runs again after line ⑧, inside the claim. Line ⑨'s look gets the brakes |
| `src/postgres.ts` | The brakes on the database: line ④'s read, the lock, the pull, the lift, and their records |
| `src/claims.ts`, `src/registry.ts`, `src/revocation.ts`, `src/log.ts` | The claim's stores and the registry hold the brakes. DSoR's own work includes the brake. The record of a pull or a lift |
| `roles.json`, `classifications.json`, `store.json`, `src/main.ts` | `control:suspend`, the answer's kind `Brake`, the store map's `dsor.brakes`, and the brake told in memory |
| `test/brakes.test.ts`, `test/brakes.db.test.ts`, `test/owner-brakes.ts` | **New.** The claims C1 to C10, and the owner, who removes the tests' brakes |
| The other tests | Line ④ in every list of the lines a call runs, the eight contracts, the cross-tenant suite's 81 attacks, and the tenth table |

Step 25's markers are gone, as the build skill asks. Since step 25b, a search for "NEW IN STEP"
finds only this step's lesson.

```bash
git diff --no-index ../mj_25_revocation/src src
git diff --no-index ../mj_25_revocation/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-09, shortened. After the tear-up, the program tells the brake in
memory:

```text
the emergency brake, in memory, so the database's agents keep working:
  03:10, user_123 pulls the brake on accounts-payable-fte: answered, the brake is on
  03:11, the agent drafts: AGENT_SUSPENDED: accounts-payable-fte may make no change in org_456: an emergency brake is on
  03:11, the agent reads INV-1008: answered, INV-1008
  03:11, user_123 drafts: answered, PAY-901
  03:12, the agent tries to lift its own brake: AGENT_SUSPENDED: accounts-payable-fte may make no change in org_456: an emergency brake is on
  03:12, the CFO tries to lift it: AUTHORIZATION_DENIED: "control.lift" needs control:suspend, which the caller does not hold
  08:00, user_123 lifts it: answered, the brake is lifted
  08:01, the agent drafts again: answered, PAY-902
  08:05, admin_100 freezes org_456: answered, the brake is on
  08:06, firm-ap-fte drafts in org_456: AGENT_SUSPENDED: firm-ap-fte may make no change in org_456: an emergency brake is on
  08:06, firm-ap-fte drafts in org_789: answered, PAY-903
```

## Break it

Each break ran in a copy of this step outside the repository, on 2026-10-09: B1 and B4 in memory,
B2 and B3 on a local PostgreSQL 17 database of their own. Each scenario ran first on the step's
code as it is ("built"), then once with the break. The output is copied as it was printed.

**B1. Line ④ is gone.** In the copy's `src/pipeline.ts`, line ④ checked nothing. user_123 pulls
the brake, then the agent asks for a dry run of a draft, and drafts:

```text
=== built
user_123 pulls the brake on accounts-payable-fte: COMMITTED
the agent asks for a dry run of a draft: AGENT_SUSPENDED: accounts-payable-fte may make no change in org_456: an emergency brake is on
then the real draft: AGENT_SUSPENDED: accounts-payable-fte may make no change in org_456: an emergency brake is on
the lines it ran: 1 2 3 4 11
its proposal: none
=== B1, line ④ is gone
user_123 pulls the brake on accounts-payable-fte: COMMITTED
the agent asks for a dry run of a draft: VALIDATED
then the real draft: AGENT_SUSPENDED: accounts-payable-fte may make no change in org_456: an emergency brake is on
the lines it ran: 1 2 3 4 5 6 7 8 11
its proposal: DENIED
```

The real draft is still refused, by the check after line ⑧, but only after a proposal was made.
The dry run promised what the real call refused. Line ④ is the check that every mode passes
through (decision L7).

**B2. No second check inside the claim.** In the copy's `src/pipeline.ts`, the check after line ⑧
was deleted. intake-fte's draft is inside its transaction, held at line ⑩, when user_123 pulls
the brake:

```text
=== built
intake-fte's draft is inside its transaction, held at line ⑩
user_123 pulls the brake: no answer yet, the pull waits for the draft
the draft is let go: COMMITTED
the pull's answer: COMMITTED
intake-fte drafts again: AGENT_SUSPENDED: intake-fte may make no change in org_456: an emergency brake is on
=== B2, no second check inside the claim
intake-fte's draft is inside its transaction, held at line ⑩
user_123 pulls the brake: COMMITTED, while the draft is still on its way
the draft is let go: COMMITTED
the pull's answer: COMMITTED
intake-fte drafts again: AGENT_SUSPENDED: intake-fte may make no change in org_456: an emergency brake is on
```

**B3. The second check, with no lock.** In the copy's `src/postgres.ts`, the check after line ⑧
took no lock. The same scenario:

```text
=== built
intake-fte's draft is inside its transaction, held at line ⑩
user_123 pulls the brake: no answer yet, the pull waits for the draft
the draft is let go: COMMITTED
the pull's answer: COMMITTED
intake-fte drafts again: AGENT_SUSPENDED: intake-fte may make no change in org_456: an emergency brake is on
=== B3, the second check, with no lock
intake-fte's draft is inside its transaction, held at line ⑩
user_123 pulls the brake: COMMITTED, while the draft is still on its way
the draft is let go: COMMITTED
the pull's answer: COMMITTED
intake-fte drafts again: AGENT_SUSPENDED: intake-fte may make no change in org_456: an emergency brake is on
```

In both breaks, the brake took effect while the draft was still on its way, and the draft
entered EXECUTING after it, which DSOR-OPS-01c forbids. A check that takes no lock cannot see a
brake that is not written yet, and nothing makes the pull wait for the draft (decision L8).

**B4. The lift forgets "people only".** In the copy's `contracts/control.lift.json`, `people_only`
became `false`. firm-ap-fte's slip lists `control:suspend`, and user_123, who signed it, holds
it:

```text
=== built
user_123 pulls the brake on accounts-payable-fte: COMMITTED
firm-ap-fte, whose slip lists control:suspend, lifts it: AUTHORIZATION_DENIED: "control.lift" is for people only, and firm-ap-fte is not a person
accounts-payable-fte drafts: AGENT_SUSPENDED: accounts-payable-fte may make no change in org_456: an emergency brake is on
=== B4, the lift forgets people only
user_123 pulls the brake on accounts-payable-fte: COMMITTED
firm-ap-fte, whose slip lists control:suspend, lifts it: COMMITTED
accounts-payable-fte drafts: COMMITTED
```

An agent lifted a brake, which DSOR-OPS-01d forbids. Line ⑤'s permission check alone let it
through, because its slip and its signer both allowed it (decision L6).

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Design | The brake's questions, L6 to L9, were written open in step 25's design |
| 2 | Decide | The learner asked for the build while away, so Claude Code took each recommendation |
| 3 | Red | `test/brakes.test.ts` and `test/brakes.db.test.ts` first, with a stub of `src/brakes.ts` so the tests load |
| 4 | Green | The contracts, the brakes store in memory and on the database, line ④, the check after line ⑧, and migration 019 |
| 5 | The old tests | Line ④ in every list of lines, the contract lists, the suite's counts, the roles, the labels, the store map, and the database's catalog |
| 6 | The program | The brake, told in memory |
| 7 | Break it | B1 to B4 in a copy outside the repository |
| 8 | Review | A sweep of small breaks, and a reviewer who had not seen the conversation |
| 9 | Fix | The review's findings: tests that fail with each break that left every test green, then the fixes, then a sweep of the review's own breaks. All under "Think it through" |

To start it in a new session:

```text
Build step 25b in learner mode from the design in
docs/baby_steps_tutorials/mj_25b_the_emergency_brake/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Red | All 22 new unit tests: `control.suspend` was not built yet |
| Green, the first run | One test expected the record's result `COMMITTED`. A command's decision record says `ok` |
| The line lists | 34 lists in 14 test files, which now name line ④ |
| The old unit tests | 28 tests in 8 files: the lists that name every contract, the suite's 63 attacks that became 81, the shipped roles, and the labels written out in full |
| The old database tests | 5 tests in 4 files: the tables with row-level security, the policies written out in full, `dsor_runtime`'s privileges column by column, the unit tests' catalog against the real one, and the program's list of operations |
| The first database run of the new file | 3 of 12 tests. The planted agent had no clearance, so its read came back empty. A row-level security check ran before a CHECK that the test wanted to reach. And the brake's refusal was masked inside the claim (decision D7) |
| The review's tests | One was red on the step: `dsor_runtime` could lift a brake at a time before its pull (finding L5). The others pass on the step, because each guards a break that left every test green. Each fails with its break |
| The CHECK of finding L5 | The owner's own fixture, an old lifted brake whose `lifted_at` was `now()`: the start of its transaction, before its `pulled_at` |

## Check yourself

Walk each call through the checklist, and stop at the first line that says no.

1. user_123 pulls the brake on accounts-payable-fte at 03:10. At 03:11 the agent reads INV-1008,
   then drafts a payment. What does it hear each time?
2. admin_100 freezes org_456. What does firm-ap-fte hear for a draft in org_456, and in org_789?
3. A draft from the agent waits inside its transaction, at line ⑩, when user_123 pulls the brake.
   What happens to the draft, and to the pull?
4. The agent's slip lists `control:suspend`, and user_123, who signed it, holds it. Can the agent
   lift its own brake? Can firm-ap-fte lift it?
5. user_123 pulls the brake on accounts-payable-fte, and then admin_100 pulls it too. What does
   admin_100 hear, and where does the proposal of the call end?

<details>
<summary>Answers</summary>

1. The read answers: §18 stops a change of state, not a read. The draft hears `AGENT_SUSPENDED`
   at line ④, before line ⑧, so there is no proposal (decision L7).
2. In org_456, `AGENT_SUSPENDED`: the freeze stops every agent of the company. In org_789 the
   draft is made: a brake belongs to one company (DSOR-OPS-01a).
3. The draft finishes and is recorded. It took the brake's lock, shared, at its check after line
   ⑧, so the pull waits until the draft's transaction ends. Then the brake is on, and the next
   draft is refused (DSOR-OPS-01c, decision L8).
4. Its own lift is a command from a braked agent, so line ④ refuses it with `AGENT_SUSPENDED`.
   firm-ap-fte is refused at line ⑤: the lift is for people only (DSOR-OPS-01d, decision L6).
5. `CONFLICT`: the brake on accounts-payable-fte is on already. Line ⑨ refuses it, so the
   proposal ends DENIED. One brake for each target (decision L9).

</details>

## Think it through

### Found while building

- **The brake's words were masked in one place only.** A refusal inside the claim is masked by
  the caller's clearance, and a refusal at line ④ is not. With the label `internal`, an agent of
  low clearance heard the brake's words at line ④, and "its reason is above the caller's
  clearance" from the check after line ⑧. The words name only the agent and its own company, so
  they are `public` now (decision D7). A unit test calls both checks, for an agent of public
  clearance.
- **A planted agent with no clearance reads nothing.** The database test planted intake-fte with
  no clearance, so masking left its read empty, and the test said "the read failed". It has the
  clearance of the story's own agents now.
- **A database check that the policy reaches first.** The test of "a lift is whole" set only the
  lifter. Row-level security's own check ran before the table's CHECK, and refused it first. The
  test now passes the policy and leaves out only the reason.

### The sweep of small breaks

A sweep makes one small break at a time in a copy of the step, and runs the tests. It made 28
breaks, each one undoing one part of the brake: line ④, the check after line ⑧, each lock, each
company filter, each check at line ⑨, people only, the records, the label, and each part of
migration 019. It took three runs:

1. **The first run** went wrong part of the way through, because of two mistakes (below). Its database results cannot be trusted. Its 7 kills by unit tests stand, because unit
   tests touch no database. It still showed two gaps, and each got a test before the second run:
   - **K6**, a brake that stops the exact type `agent` only, passed every unit test. A caller of a
     type DSoR does not know acts as an agent, so the brake must stop it too.
   - **K12**, a lift that takes a lifted brake too, passed the brake's database file. The policy
     `lifts_once` still held, so only DSoR's own WHERE was missing. The owner's test of that
     WHERE now has an old lifted brake of org_456 beside the others.
2. **The second run** killed 18 of the other 21 breaks with the tests meant for them. Two
   survived, and one ran past the time limit:
   - **K13**, a pull with no `ON CONFLICT`. The test of two pulls at once never reached the
     insert: by the time the second pull came to line ⑨, the first had committed. A new test
     makes the first pull wait after its insert, so the second passes line ⑨ and meets it there.
   - **K18**, line ⑨ that never sees "no brake is on". The change then refused with the same
     words, after the work had begun. The test now checks that the proposal ends DENIED and the
     record says DENY.
   - **K3**, the check after line ⑧ with no lock, made a race test fail while its draft was on its
     way. The next test's owner script then blocked the test process, so the draft held its lock
     for ever. Each race test now waits for its calls to end, pass or fail.
3. **The third run** killed K3, K13, and K18. So all 28 are killed by the tests meant for them.

One kill is weaker than the rest. K23, a migration with no `starts_on`, is caught only by the
test of the policies written out in full, because the column grants refuse the same inserts first.

### Three mistakes in the sweep

- **A failing test must still end.** In the first run, the two race tests left their transaction
  open when they failed, so the whole file waited until the time limit. Each now ends what it
  started, in a `finally`.
- **A time limit must kill the whole run.** The sweep's runner killed `npx` at its limit, and the
  vitest under it went on running against the sweep's database, beside the next break's run. So
  some breaks were "killed" by other runs: K6's run found that INV-9001 was gone.
  The runner now starts each run in a process group of its own, and kills the whole group. The
  breaks that touch the database ran again.
- **Two copies in one folder.** For 17 minutes the reviewer used the sweep's own copy as its own,
  and pointed its `.env` at the reviewer's database. So the sweep's database runs in that window
  hit the reviewer's database, while the reviewer's tests ran there too. Each break of that
  window ran again. Lesson: every copy gets a folder and a database of its own, checked first.

### The hostile review

A reviewer who had not seen the build attacked it. It found nothing of high weight: no broken
guarantee in the shipped code. It found three problems of medium weight and ten small ones.

| Finding | What it found | What changed |
| --- | --- | --- |
| M1, medium | The pull waits for the drafts on their way, with no time limit. One draft held at line ⑩ by a row lock kept the brake back for 65 s, past §44's 60 s and 5 s. Meanwhile the agent's dry run said VALIDATED. And drafts that queued behind the pull filled the pool, so user_123's own read waited too | The claims are true now: DSOR-OPS-01b is met in part. A time limit is left open, because what a draft hears when its own time runs out is a decision for the learner |
| M2, medium | The race tests braked one agent only. With the company's number left out of the lock, or out of the check's own read, a freeze slipped past a draft, and every test stayed green | Two race tests for a freeze, in both orders |
| M3, medium | No database test lifted a freeze. With the look comparing the agent by `=`, a freeze could never be lifted on the database | A database test lifts a freeze, and refuses a second one at line ⑨ |
| L1 | With the check after line ⑧ in execute mode only, a prepared call that raced a pull left a READY proposal of a braked agent | A test races a prepared call against a pull |
| L2 | With no brakes for a dry run's line ⑨, a dry run of a second pull said VALIDATED | Unit and database tests of a person's dry run of the brake's commands |
| L3 | The memory store's check after line ⑧ was never reached | A unit test pulls the brake while a draft is at line ⑤ |
| L4 | No test sent a reason past its 200 characters | A unit test |
| L5 | `dsor_runtime` could lift a brake at a time before its pull | A CHECK keeps a lift after its pull, with its test. Its value is still DSoR's own, and left open |
| L6 | A test's title named an application that never pulled | The application pulls, and is refused |
| L7 | C5 said that line ⑤ refuses the braked agent. Line ④ does | C5's words are right now |
| L8 | The registry and the claims default to no brakes, so a registry built without them says no brake is on | Left open |
| L9 | The status row left out that CI does not run `pnpm test:db` | Added |
| L10 | Two inherited race tests released their holder without a rollback when they failed | Fixed in steps 25 and 25b. Step 24's copy is noted in the learner notes |

The README, against the skill for learners' writing:

- **The analogy.** The first README pictured a train's emergency brake. It misfit in three ways: a
  passenger pulls it, where here only a person who holds `control:suspend` may; the passenger
  pulls and the crew releases, where here the same people do both; and the driver, the agent in
  the picture, belongs to the crew, so the picture let the agent release its own brake. The
  README now uses the established new clerk, and a note pinned on the clerk's desk.
- **The words.** "Lever" and "switch" both meant the brake, and "in flight" meant "on its way".
  Each idea now has one word. Seven sentences that a reader of English as a second language
  could not follow are rewritten, such as "the map's done when" and "takes it alone".

The review's own sweep found eight more breaks that left every test green, outside the 28
above: R1 to R6, R8, and R9. Each has a test now. A sweep of the eight on 2026-10-09 killed each
one with the test meant for it, and the break of L5's CHECK too.

### Left open on purpose

The list under "Left open, and not this step's idea" above. And from step 25: the records still
do not pass `audit-record.schema.json`. Step 26 starts from there.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-OPS-01a | DSoR provides per-agent suspension and a tenant-wide agent freeze | [§18 Operational controls](../../../specs/dsor/02-security.md#18-operational-controls) | Unit tests in [`test/brakes.test.ts`](test/brakes.test.ts): one agent, the company, and the other company untouched. Database tests in [`test/brakes.db.test.ts`](test/brakes.db.test.ts) |
| DSOR-OPS-01b | A suspension or freeze takes effect for new decisions within the bound of §44, without cooperation from the agent runtime | [§18 Operational controls](../../../specs/dsor/02-security.md#18-operational-controls) | Partly. Line ④ reads the brakes at every call, so a brake reaches the next decision after its pull commits. But the pull waits for the drafts on their way, with no time limit yet, so a stuck draft holds it back past the bound (finding M1). Unit and database: the next draft after the pull, and after the lift |
| DSOR-OPS-01c | While a suspension or freeze is active, a proposal from an affected agent does not enter EXECUTING | [§18 Operational controls](../../../specs/dsor/02-security.md#18-operational-controls) | Database tests in [`test/brakes.db.test.ts`](test/brakes.db.test.ts): a draft on its way, in both orders, for an agent's brake and for a freeze, and a prepared call. A READY proposal waits for step 31's release, which must check the brake |
| DSOR-OPS-01d | A suspension or freeze is lifted only by a human holding `control:suspend` | [§18 Operational controls](../../../specs/dsor/02-security.md#18-operational-controls) | Unit tests in [`test/brakes.test.ts`](test/brakes.test.ts): two people lift it, and the agent, another agent, an application, and the CFO are refused |

## Next

Step 26 · Money done right. Compare amounts exactly, in any currency, with a table of exchange
rates. If an amount cannot be converted, the strict answer wins (DSOR-MON-02 to DSOR-MON-04).

