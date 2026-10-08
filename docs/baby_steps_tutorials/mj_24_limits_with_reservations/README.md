# Step 24 · Limits with reservations

**New in this step:** a slip can carry a limit for one payment and a limit for one day, and line ⑩
keeps the day's limit by reserving each amount in one database statement, keyed by the proposal
(DSOR-DEL-06a to DSOR-DEL-06e).

## In plain words

A permission slip can say how much its agent may spend: at most 50,000 USD in one payment, and at
most 200,000 USD in one day. DSoR compares one amount with the first limit. The second limit is a
*running total* for the day, and a running total has a race.

Here is the race. The day has 43,000.00 USD of room left, and two drafts of 31,400.00 USD arrive
at the same moment. Each request reads the total, sees room, and writes its draft. Now the day
holds 19,800.00 USD more than its limit. The fix is a *reservation*. DSoR adds the amount to the
day's total and checks the limit in one database statement. Only one of the two requests can win,
and the other hears `LIMIT_EXCEEDED`.

Each reservation belongs to one proposal. It is *held* while the work runs, and while a prepared
proposal waits. When the proposal ends COMMITTED, the reservation is *committed*: it stays counted.
When the proposal ends FAILED, the reservation is *released*: the day gets the amount back.

DSoR never takes the caller's word for the amount. The contract of `payment.create` says what the
command spends: the open amount of the invoice its input names. DSoR reads that invoice itself, at
line ⑨, and checks the limits at line ⑩, before any work.

In the office picture, the day's limit is the last hotel room. Two clerks phone at the same
moment. The hotel gives the key to one of them, and tells the other that the hotel is full.

## Why it matters

Tuesday, 02:00. accounts-payable-fte works through the night's payments under del_100, which
user_123 signed: at most 50,000 USD in one payment, and 200,000 USD in one day. Five drafts of
31,400.00 USD are 157,000.00 USD, so 43,000.00 of room is left. At 02:40 two more drafts arrive at
the same moment, on two connections. Each one reads 157,000.00, sees room for 31,400.00, and
writes. The day now holds 219,800.00 USD against a limit of 200,000.00. No check failed on its own.
The two checks ran at the same time, and the race broke the limit.

## The design, before any code

The learner asked for this step to be built overnight, with no one to answer questions. So Claude
Code made every decision below, marked "(Claude Code)", each with its downside. **Each one is for
the learner to review in the morning**, before the understanding session of steps 22 to 24. A
decision the learner changes is changed in the code, with its tests.

The specification it relies on was read on 2026-10-08:

- [§13](../../../specs/dsor/02-security.md#13-delegation): the slip's example carries
  `per_transaction_limit: { value: "50000", currency: USD }` and `cumulative_limits: [{ window:
  P1D, amount: { value: "200000", currency: USD } }]`.
- [§13.4](../../../specs/dsor/02-security.md#134-cumulative-limits): DSOR-DEL-06a to DSOR-DEL-06e.
  "Common mistake. Reading the total, checking it in application code, then writing the new
  total."
- [§21](../../../specs/dsor/03-execution.md#21-command-pipeline): line 9, "Read bound state", and
  line 10, "Evaluate controls, SoD, limits (reserve, keyed by proposal)". "A `validate_only`
  invocation … takes no reservation in step 10." Line 16 commits or releases reservations.
- [§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract): a contract's
  `bind`, "aliases available to CEL as state.<alias>".
- [§26.2](../../../specs/dsor/03-execution.md#262-lifecycle): PROPOSED to DENIED, "Rejected at
  decision".
- [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution): "The reservation
  taken when the proposal was created is found again by proposal id." Read again after the
  review, for decision 9.

### The intent and the outcome

**Intent.** An agent never spends more than its slip allows, in one payment or in one day, however
many requests arrive at the same moment.

**Outcome.** What is true when this step is done:

1. Under a slip with the story's limits, six drafts of 31,400.00 USD are made, and a seventh is
   refused with `LIMIT_EXCEEDED`. Its proposal ends DENIED.
2. Fifty drafts at the same moment, on the database, make six drafts. The day's total is
   188,400.00 USD, never more.
3. A draft that the code refuses after its reservation ends FAILED, and the day gets its amount
   back.
4. A dry run checks both limits, and reserves nothing. A `propose_only` call checks both limits
   and reserves its amount. The reservation is held while the proposal waits in READY.
5. A draft over 50,000 USD is refused, whatever the day's total.
6. The work drafts only on the invoice that line ⑨ read, at the version it read. A draft on any
   other version is refused with `STALE_STATE`, and its reservation is released.

**Not the outcome of this step:**

- Holds, the other thing a dry run must not take. They come with unknown outcomes (step 37).
- The states that hold or release a reservation and that no step reaches yet: PENDING_APPROVAL,
  APPROVED, OUTCOME_UNKNOWN, REJECTED, EXPIRED, CANCELLED, REVOKED, and INVALIDATED.
- Limits on a person's own calls, and a rule per vendor against split payments: controls, step 27.

### What each rule says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-DEL-06e | **C1.** A draft that would pass the slip's limit for one day is refused with `LIMIT_EXCEEDED` | Unit and database: six fit, and the seventh is refused |
| DSOR-DEL-06e | **C2.** A draft over the limit for one payment is refused, and reserves nothing | Unit: 60,000.00 USD refused, exactly 50,000.00 made |
| DSOR-DEL-06a | **C3.** The day's total grows in one statement, so drafts at the same moment never pass the limit | Unit: seven at once. Database: fifty at once, on twenty connections |
| DSOR-DEL-06b | **C4.** One proposal holds at most one reservation | Unit and database: a second reserve for the same proposal adds nothing |
| DSOR-DEL-06c | **C5.** A reservation is held while the work runs | Unit: code that looks during the work sees `held` |
| DSOR-DEL-06d, DSOR-DEL-06a | **C6.** FAILED releases the reservation, and the day gets its amount back. COMMITTED commits it | Unit and database |
| (decision 6) | **C7.** A refusal at lines ⑨ and ⑩ ends the proposal DENIED, and the claim keeps the refusal | Unit and database: the proposal's moves, and a replay |
| (decision 2) | **C8.** DSoR reads the amount itself, at line ⑨. A bound invoice that nobody has is refused there | Unit: the reserved amount is the invoice's, and INV-9999 is refused at line ⑨ |
| (decision 8) | **C9.** A dry run checks the limits, and reserves nothing | Unit and database |
| (decision 13) | **C10.** A reservation starts held and leaves held once. `dsor_runtime` cannot remove one, or change an amount or a day. Each company sees only its own | Database: hand-written SQL as `dsor_runtime` |
| (decisions 3, 11) | **C11.** A new day starts at zero, on UTC's date. Another currency fits no limit. Amounts are compared exactly | Unit and database |
| DSOR-DEL-06a (decision 9) | **C12.** A prepared call reserves its amount, keyed by its proposal. The reservation is held while the proposal waits in READY | Unit and database |
| DSOR-CON-01b (decision 16) | **C13.** The work drafts only on what line ⑨ read. When the invoice changes after line ⑨, the draft is refused with `STALE_STATE`, and its reservation is released | Unit. Database: another transaction holds the day's total while the owner raises INV-9001 |
| DSOR-EXE-02, DSOR-IDM-01c (decision 17) | **C14.** A replay of a refusal from lines ⑨ and ⑩ gives the same refusal, in both modes. Its record says DENY, as the first call's does | Unit and database |
| (decisions 18, 19) | **C15.** An amount of 0.00 reserves nothing. A slip with a limit that DSoR cannot read is refused at line ③ | Unit. Database: the amount of 0.00 |

### Decisions the specification leaves to us

1. **Two limits on a slip (Claude Code).** A slip may carry `per_transaction_limit`, and
   `cumulative_limits` with one window of `P1D`, as in §13's example. Line ③ still refuses any
   other constraint, and any other window: a constraint that nothing checks is a promise nobody
   keeps (step 18's decision 6). *Downside:* a weekly limit is refused until a later step builds
   one.
2. **The contract says what a command spends (Claude Code).** `payment.create` binds `invoice:
   input.invoice`, in the contract's own `bind` field. Under this tutorial's own name it says
   `spends: state.invoice.open_amount`. DSoR reads that invoice itself at line ⑨, through the
   company's store, before any work. The specification writes a bind in CEL, which arrives in step
   27, so only the plain path `input.<field>` is accepted until then. Start-up refuses any other
   form. `invoice.issue`'s contract binds its invoice too, since step 03. The specification has no
   field for what a command spends (open question 99). *Downside:* the code reads the invoice a
   second time for its draft. The review found that a change between the two reads could draft
   another amount than the one line ⑩ reserved. Decision 16 closes that gap.
3. **The day is today in UTC (Claude Code),** by the clock of the store that keeps the total: the
   database's own for the program. *Downside:* a payment at 23:59 and one at 00:01 count in two
   days.
4. **One total for each slip, day, and currency; one statement reserves (Claude Code).**
   `INSERT … ON CONFLICT … DO UPDATE SET used = used + amount WHERE used + amount <= limit`: the
   last hotel room. A second request waits on the row, then checks again with the first one's
   amount in the total. *Downside:* every payment under one slip waits for the one before it to
   commit.
5. **One reservation for each proposal (Claude Code).** Its key is the proposal's id
   (DSOR-DEL-06b). A second reserve for the same proposal adds nothing. *Downside:* none in this
   step. It matters when step 31 checks a proposal again at its release.
6. **Line ⑩ before the work, and READY after it (Claude Code).** Line ⑧ makes the proposal,
   PROPOSED. Line ⑨ reads the bound state, and line ⑩ checks the limits. Then the proposal moves
   to READY, and in execute mode to EXECUTING, and the work runs. A refusal at line ⑨ or ⑩ ends
   the proposal DENIED, a move the picture draws, and the claim keeps the refusal. Step 22's
   decision 12 put READY and EXECUTING at line ⑧, and said a later step would move them: this is
   that step. The command's work no longer reports itself as line ⑨. It runs after line ⑩, where
   §21's line 14 will be (step 36). *Downside:* the work runs with no line number of its own.
7. **COMMITTED commits, and FAILED releases (Claude Code).** The reservation ends with its
   proposal, in the same transaction. An accident rolls back the claim, the proposal, and the
   reservation together. *Downside:* a draft that is cancelled later gives nothing back to the day
   (open question 97).
8. **A dry run checks, and reserves nothing (Claude Code).** §21 says a dry run "takes no
   reservation in step 10". It reads the bound state, and checks both limits against the day's
   total. It hears `LIMIT_EXCEEDED`, the real call's refusal, or `VALIDATED`. This extends step
   23's decision 2: a dry run now runs lines ⑨ and ⑩ too. Both are DSoR's own, and write nothing,
   and the code still never runs. *Downside:* a dry run's yes can be wrong a moment later, when
   another draft takes the room.
9. **A prepared call reserves (Claude Code; changed by the review).** §21 takes no reservation at
   line 10 for one mode only, the dry run. §26.4 says that when a proposal is released, "the
   reservation taken when the proposal was created is found again by proposal id". So a
   `propose_only` call reserves its amount at line ⑩, and the reservation is held while the
   proposal waits in READY. The first build reserved nothing here, because DSOR-DEL-06c does not
   name READY. The review showed that §21 and §26.4 answer the question. *Downside:* a prepared
   proposal holds its room, and no step ends READY yet. Step 31 releases a proposal, and nothing
   expires or cancels one (open question 90). Its amount counts on the day it was prepared, not
   on the day it runs.
10. **Only an agent's call has limits (Claude Code).** Limits are on the slip. A person's own call
    runs under no slip, so no limit applies. *Downside:* user_123 may draft without limit until
    controls arrive (step 27).
11. **What cannot be compared fits no limit (Claude Code).** A limit in USD and an amount in EUR
    cannot be compared before step 26 converts currencies. An amount that cannot be read exactly,
    such as `1e5`, cannot be compared either. Both resolve restrictively: `LIMIT_EXCEEDED`, as
    DSOR-MON-04 asks for a comparison that cannot convert. *Downside:* a real payment in another
    currency is refused.
12. **The story's del_100 keeps no limits in the shared database (Claude Code).** A day's spending
    is real state. The program and the tests run many times a day, and the same 200,000 USD would
    run out. So the program tells the limits in memory, as step 19b tells the suspension. The
    database tests use a slip of their own, del_190 for intake-fte, which the owner adds and
    removes, as INV-9001. *Downside:* the database's del_100 does not show §13's limits.
13. **Migration 017 (Claude Code).** `dsor.limit_counters` and `dsor.reservations`, behind the
    company's lock, both of the kind `control-claimed`. A restrictive policy lets a reservation
    start only as held, and another lets it leave held once, to committed or released.
    `dsor_runtime` can change a total and a reservation's state, and nothing else. *Downside:*
    nothing in the database itself checks that a total equals its reservations. DSoR's code keeps
    them together, in one transaction.
14. **A limit's refusal names the slip and the limit, never an amount (Claude Code).** An agent's
    clearance can hide the invoice's amounts, so the words must not show them. *Downside:* the
    agent does not learn how much room is left.
15. **`LIMIT_EXCEEDED` says `after_delay`, and the claim keeps the refusal (Claude Code).** §28
    gives the code the retry class `after_delay`. A refusal inside the claim is kept, as §22 keeps
    a recorded DENY. So a retry tomorrow needs a new key. *Downside:* the retry class says "wait",
    and the key says "never again" (open question 98).

The review added four decisions, and changed decision 9. Each one is the fix of a finding under
"Think it through".

16. **The work drafts only on what line ⑨ read (Claude Code; added by the review).** Line ⑨ reads
    INV-1008 at version 1, and line ⑩ reserves its 31,400.00 USD. The code then reads the invoice
    again. Suppose the accounts system raises it to 120,000.00 USD, version 2, between the two
    reads, and the caller named version 2. The first build then drafted 120,000.00 USD under a
    reservation of 31,400.00. Now the work gets a payments store pinned to line ⑨'s read. A draft
    on any other version than the one line ⑨ read is refused with `STALE_STATE`, because DSoR
    decided on another version (DSOR-CON-01b). The proposal ends FAILED, and the reservation is
    released. *Downside:* the pin is on the payments store only. Each later command that spends
    must be pinned in the same way, or it has the same gap.
17. **A replay of a refusal is recorded DENY (Claude Code; added by the review).** The claim keeps
    the refusal of lines ⑨ and ⑩, and a mark that the first call was denied. A replay gives back
    the same refusal, in execute and `propose_only` modes alike, and its record says DENY, as the
    first call's does (DSOR-EXE-02, DSOR-IDM-01c). The first build recorded ALLOW for every
    replay. On the database, a replay of a refused prepared call gave `INTERNAL_ERROR`.
    *Downside:* a claim that an earlier step's code kept has no mark, and its replay would say
    ALLOW. Each step has its own database, so no such claim exists here.
18. **An amount of nothing reserves nothing (Claude Code; added by the review).** A paid invoice's
    open amount is 0.00. Line ⑩ takes nothing from the day for it, and the code then refuses the
    draft with `CONFLICT`, as before this step. The first build tried to keep a reservation of
    0.00. The database refused it (`CHECK (amount_value > 0)`), and the call heard
    `INTERNAL_ERROR`. *Downside:* a proposal for 0.00 has no reservation, so a report that lists
    each proposal's reservation finds a gap.
19. **A limit DSoR cannot read is refused at line ③ (Claude Code; added by the review).** The
    slip's schema accepts a limit of `-5`, or one with seven digits after the point. DSoR cannot
    compare either one exactly (decision 11), so every payment under the slip would hear
    `LIMIT_EXCEEDED`, with a retry class that says "wait". Line ③ now refuses such a slip with
    `DELEGATION_REQUIRED`: the slip "carries a limit DSoR cannot read". *Downside:* the signer
    learns of the mistake only when the agent's first call is refused, not when the slip is
    written.

### The tests, by claim

| Claims | Where |
| --- | --- |
| C1 to C9, C11 to C15 | [`test/limits.test.ts`](test/limits.test.ts). Each group of tests names its claims |
| C1, C3, C4, C6, C9 to C15 | [`test/limits.db.test.ts`](test/limits.db.test.ts) |
| C7 | Also [`test/modes.test.ts`](test/modes.test.ts) and [`test/slips.test.ts`](test/slips.test.ts), whose lines and rules changed |

### Breaks we will try, and what we expect

| Break | What we expect |
| --- | --- |
| B1. Read the total, check it, then write: the common mistake | Fifty drafts at once make more than six, and the day's total passes 200,000.00 USD |
| B2. FAILED releases nothing | A draft that was never made keeps its amount in the day's total |
| B3. A dry run reserves | Six dry runs fill the day, and the real draft after them is refused |

The learner's predictions for these come in the understanding session: a talk-through of this
code with the learner, through the `understand-baby-step` skill.

### Left open, and not this step's idea

- Holds, which a dry run must not take either (DSOR-OPR-06; step 37).
- The states of DSOR-DEL-06c and DSOR-DEL-06d that no step reaches yet. Approvals come in step 29,
  revocation in step 25, the release of a proposal in step 31, and unknown outcomes in step 37.
  Each must hold or release the reservation as the rule says.
- A proposal that waits in READY holds its room, and no step ends READY yet (open questions 90
  and 96).
- A cancelled draft gives nothing back (open question 97).
- `after_delay` and a kept refusal (open question 98).
- How DSoR knows what a command spends, which the specification does not say (open question 99).
- Limits on a person, and a rule per vendor against split payments (§13.4's SHOULD): controls,
  step 27.
- A sub-slip's spending, which must count against its root slip's limits (DSOR-DEL-05d).

The open questions are in [`research/open-questions.md`](../../../research/open-questions.md).

## Before you build: set up a database

As in step 23: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Migration 017 runs.

## What changed since step 23

| File | What changed |
| --- | --- |
| `migrations/017_limits.sql` | **New.** `dsor.limit_counters` and `dsor.reservations`, their company's lock, their policies, and their grants |
| `src/limits.ts` | **New.** The limits a slip carries, exact amounts, the reservations in memory, and line ⑩'s check |
| `src/bound.ts` | **New.** Line ⑨'s read of the state a contract binds, what the command spends, and the pin: the work drafts only on what line ⑨ read |
| `src/pipeline.ts` | Lines ⑨ and ⑩ before the work, in all three modes. A command's work runs after line ⑩, with no number of its own, on payments pinned to line ⑨'s read. A replay of a denial is recorded DENY |
| `src/operations.ts`, `src/envelope.ts` | Comments only: where the code writes now, and a proposal that ends DENIED |
| `src/proposals.ts` | Opening a proposal runs lines ⑨ and ⑩: READY after them, or DENIED |
| `src/claims.ts`, `src/postgres.ts` | A claim keeps a DENIED proposal's refusal, with a mark that it was denied, and holds the reservations. The reservations on the database |
| `src/delegation.ts` | Line ③ accepts the two limits on a slip, and refuses a limit that DSoR cannot read |
| `src/registry.ts` | Start-up checks each contract's `bind` and what it spends |
| `contracts/payment.create.json`, `store.json` | What a draft spends. The two new tables |
| `src/main.ts` | The day's limit, told in memory: seven drafts at once, and a dry run of an eighth |
| `test/limits.test.ts`, `test/limits.db.test.ts`, `test/owner-limits.ts` | **New.** The claims C1 to C15, and the tests' own limited slip |
| The other tests | Lines ⑨ and ⑩ in the lines that run, the limits a slip may carry, the two new tables, and an invoice store where line ⑨ now reads |

```bash
git diff --no-index ../mj_23_three_ways_to_call/src src
git diff --no-index ../mj_23_three_ways_to_call/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-08, shortened. After the changed payee, the program tells the day's
limit in memory:

```text
the day's limit, in memory, because a day's spending in the database carries on:
  seven drafts of 31,400.00 USD at once: 6 made, and LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one day
  a dry run of an eighth: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one day
```

## Break it

Each break ran in a copy of this step outside the repository, on a local PostgreSQL 17 database
of its own, on 2026-10-08. intake-fte drafted INV-9001, credited to 31,400.00 USD, under del_190:
50,000 USD in one payment, and 200,000 USD in one day. Each scenario started with the whole day's
room. It ran first on the step's code as it is ("built" in the output), then once with the break.
The output is copied as it was printed.

**B1. Read the total, check it, then write.** In the copy's `src/postgres.ts`, the one statement
became §13.4's common mistake: a `SELECT` of the total, a check in TypeScript, and then an add with
no condition.

```text
=== built: race
fifty drafts at once: 6 made, 44 refused, 0 other
the day's total: 188400.00 USD of 200000.00
=== B1, read, check, then write
fifty drafts at once: 25 made, 25 refused, 0 other
the day's total: 785000.00 USD of 200000.00
```

Twenty connections read the total at the same moment, and each saw room. The day spent nearly
four times its limit. The one statement is the design (decision 4).

**B2. FAILED releases nothing.** In the copy's `src/pipeline.ts`, the line that releases a FAILED
proposal's reservation was deleted. intake-fte drafts on a version that is not the invoice's:

```text
=== built: failed
a draft decided on a version that is not the invoice's: STALE_STATE
the day's total after it: 0.00 USD
=== B2, FAILED releases nothing
a draft decided on a version that is not the invoice's: STALE_STATE
the day's total after it: 31400.00 USD
```

No draft was made, and the day still counted 31,400.00 USD. Five such mistakes would close the day.

**B3. A dry run reserves.** In the copy's `src/pipeline.ts`, a dry run reserved under a new
proposal id, as a real call does:

```text
=== built: dryruns
seven dry runs: VALIDATED VALIDATED VALIDATED VALIDATED VALIDATED VALIDATED VALIDATED
then a real draft: COMMITTED
the day's total: 31400.00 USD
=== B3, a dry run reserves
seven dry runs: VALIDATED VALIDATED VALIDATED VALIDATED VALIDATED VALIDATED LIMIT_EXCEEDED
then a real draft: LIMIT_EXCEEDED
the day's total: 188400.00 USD
```

Six questions spent the day, and no payment was made. That is why §21 says a dry run takes no
reservation (decision 8).

## Build it yourself with Claude Code

This is how the step was built, overnight, with every decision Claude Code's own.

| # | Move | What was done |
|---|---|---|
| 1 | Read | §13, §13.4, §21, the contract's `bind`, and the slip's schema. The specification does not say how DSoR knows what a command spends, so the contract says it (decision 2) |
| 2 | Decide | Fifteen decisions, in the README first, for the learner to review. The review changed one of them and added four |
| 3 | Code | `src/limits.ts`, `src/bound.ts`, migration 017, lines ⑨ and ⑩ in the checklist, and the proposal's new moves |
| 4 | The old tests | Lines ⑨ and ⑩ in the lines that run, the limits a slip may carry, and the two new tables |
| 5 | The new tests | `test/limits.test.ts` and `test/limits.db.test.ts`, with the fifty drafts at the same moment |
| 6 | The program | The day's limit, told in memory |
| 7 | Break it | B1 to B3 in a copy outside the repository, on a local PostgreSQL |
| 8 | Review | A sweep of 40 small breaks, and a reviewer who had not seen the conversation. Then the fixes, red first, and a third sweep. All are under "Think it through" |

**One move was out of order.** The code came before its tests in this step, against the rule of
red first. The tests were then run against step 23's code, and failed before any of them ran:
`Cannot find module '../src/limits.ts'`. The sweep below is the real proof that each test can fail.

To start it in a new session:

```text
Build step 24 in learner mode from the design in
docs/baby_steps_tutorials/mj_24_limits_with_reservations/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| The type check | 1 place: a test of step 22 that opened a proposal with no decision |
| The old unit tests | 11 tests in 7 files: lines ⑨ and ⑩ in the lines that run (8), the two limits a slip may carry now (2), and a planted command whose registry had no invoices for line ⑨ to read (1) |
| The old database tests | 6 tests in 4 files: the grants, the policies, and the tables with a company's lock written out in full (3), lines ⑨ and ⑩ (2), and a slip with a limit, which line ③ accepts now (1). And the map's list of tables (1) |
| The review's new unit tests, before their fixes | 5 of the 34 in `test/limits.test.ts`, one for each of decisions 9, 16, 17, 18, and 19 |

## Check yourself

Walk each call through the checklist, and stop at the first line that says no. The slip is del_100
with the story's limits, as in the program's memory.

1. Five drafts of 31,400.00 USD were made today. Two more arrive at the same moment. What happens?
2. The agent's draft is decided on version 2, and INV-1008 is at version 1. What happens to its
   reservation?
3. Five drafts were made today. The agent prepares a sixth with `propose_only`, and it waits in
   READY. Then the agent sends a dry run of a seventh. What does the dry run hear, and what
   changes in the day's total?
4. user_123 logs in and drafts seven payments directly. How many are made?
5. The agent drafts a payment for INV-9999, which nobody has. Which line refuses it, and where does
   its proposal end?

<details>
<summary>Answers</summary>

1. One is made, and the day holds 188,400.00 USD. The other hears `LIMIT_EXCEEDED`, and its
   proposal ends DENIED. The reservation is one statement, so only one of the two wins the room
   (DSOR-DEL-06a).
2. Line ⑩ reserves 31,400.00 USD. Then the code refuses with `STALE_STATE`, the proposal ends
   FAILED, and the reservation is released: the day gets the amount back (DSOR-DEL-06d).
3. `LIMIT_EXCEEDED`, the real call's refusal. The prepared sixth holds 31,400.00 USD, so the day
   holds 188,400.00, and one more would make 219,800.00. The dry run reserves nothing, so the
   total does not change. Its record says DENY (decisions 8 and 9).
4. All seven. A person's own call runs under no slip, so no limit applies (decision 10).
5. Line ⑨, which reads the invoice itself, refuses it with `RESOURCE_NOT_FOUND`. The proposal ends
   DENIED (decision 6).

</details>

## Think it through

The review had three parts. First, two sweeps of small breaks. Then a hostile reviewer who had not
seen the conversation. Then the fixes, red first, and a third sweep. Every break ran in a copy of
this step outside the repository, on a local PostgreSQL 17 database.

### The sweeps

A *break* is one small change to the code, such as `<=` made into `<`. A break that leaves every
test green shows a guarantee that no test proves. The third sweep first ran both tiers on the
unchanged code, and both were green, so each failure after it came from its break.

| Sweep | Breaks | Caught | What survived, and what changed |
| --- | --- | --- | --- |
| First | 40 | 36 | L2, two daily limits on one slip. D3, the day's first amount never checked on the database. D9, a denied claim that keeps no proposal. Each got a test. P6 was a syntax error, so its 46 failures proved nothing. It ran again as a valid break |
| Second | The 4 above | 4 | Nothing |
| The reviewer's | 27 | 10 | 17 survived: the findings below. Two of the ten, M8 and M65, were caught only because the test of fifty drafts locked up the pool of connections, not by an assertion. M58 was caught only by an unused-parameter error |
| Third | The reviewer's 17, and each of the 6 fixes undone | 21 of 23 | M5, a day's first amount equal to the day's limit. M7, the day taken from the session's time zone. Each got a database test, and both are caught now |

### What the review found, and what changed

| Finding | What went wrong | What changed |
| --- | --- | --- |
| H1, high | Line ⑨ read INV-9001 at one version, and line ⑩ reserved its 31,400.00 USD. The agent named the invoice's next version. The accounts system raised the invoice to 120,000.00 USD between the two reads, and the code drafted 120,000.00. On the database: three drafts of 120,000.00 USD each, while the day's total said 125,600.00 | Decision 16: the work drafts only on line ⑨'s read |
| M1 | On the database, a replay of a prepared call that line ⑨ or ⑩ refused gave `INTERNAL_ERROR` | Decision 17: a kept refusal is a valid answer in both modes |
| M2 | A replay of a denied call was recorded ALLOW. An agent could turn each DENY into an ALLOW record by sending its key again | Decision 17: the claim keeps the mark that the first call was denied |
| M3 | On the database, a draft of a paid invoice, whose open amount is 0.00, gave `INTERNAL_ERROR`. Any agent could write a record of a DSoR fault whenever it liked | Decision 18: an amount of 0.00 reserves nothing |
| M4 | A prepared call reserved nothing, against §21 and §26.4 | Decision 9, changed |
| 17 breaks survived | The code was right in most of them, but no test would catch a regression: the database's currency and precision guard (M1, M27), the day's boundaries (M2 to M7), a total below zero (M10), a dry run's masking and record (M11, M59), a refused prepared call on the database (M12), a query that says it spends (M63), the memory store's currency (M40, M41), a slip with only a limit for one payment (M43), and an accident's rollback (M65b) | A test for each. All 17 are caught now |
| Low | A slip with a limit of `-5` passed line ③, and every payment then heard `LIMIT_EXCEEDED` | Decision 19 |

The five unit tests of decisions 9, 16, 17, 18, and 19 ran red first, before their fixes. The
database tests came with their fixes, and the third sweep is their proof: it undid each fix, and a
test failed each time.

### Left open on purpose

The review's other findings are recorded here, and not fixed in this step:

- **The day is UTC's (decision 3).** The story's slip keeps Karachi hours: §13's example names
  `tz: Asia/Karachi`, five hours ahead of UTC. So an agent can spend 200,000 USD at 04:59 Karachi
  time, and 200,000 more at 05:00.
- **DSOR-MON-06 counts a total in the limit's currency.** Here the total is kept in the amount's
  currency. The two are the same today, because another currency fits no limit (decision 11).
  Step 26, which converts currencies, must keep the total in the limit's currency.
- **The refusal says which limit.** "for one payment" tells an agent that the open amount is over
  50,000 USD, even when its clearance hides amounts. The real call says the same. This sits
  against DSOR-ERR-01b (decision 14).
- **A reservation is not checked again.** `reserve` says yes to a proposal that has reserved
  already, and checks nothing. Step 31 runs the checks again at the release (DSOR-APR-03a), and
  must check the limits again too.
- **Line ⑨ reads any bound URI as an invoice.** A payment's URI is refused only because no invoice
  has its id. A test shows that refusal. Start-up does not check that the bound field is required,
  or that it names an invoice.
- **The program pays INV-1008 six times,** to show the day's limit. Nothing stops several payments
  of one invoice until step 32 (DSOR-EXC-01).
- **Every call under one slip waits for one row.** Each waiting call holds a connection from the
  pool, so a burst from one agent can starve other companies. This is threat T15, a runaway agent.
  §18's operational controls start in step 25.
- **The `.env.example` test fails here.** The file was not copied into this folder, because
  Claude Code may not touch a file named `.env.*`. The learner copies it from step 22.

Step 25 starts from this list. When it cancels a waiting proposal, the proposal's reservation must
be released (DSOR-DEL-06d).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-DEL-06a | Cumulative limits are enforced with atomic reserve, commit, and release in the control-plane store | [§13.4 Cumulative limits](../../../specs/dsor/02-security.md#134-cumulative-limits) | Database tests in [`test/limits.db.test.ts`](test/limits.db.test.ts): fifty drafts at the same moment, six made. Unit tests in [`test/limits.test.ts`](test/limits.test.ts): seven at once, commit and release. Unit and database: a prepared call's reservation, held while its proposal waits in READY, and a day's limit reached exactly |
| DSOR-DEL-06b | A reservation is keyed by proposal id, so the same proposal never reserves twice | [§13.4 Cumulative limits](../../../specs/dsor/02-security.md#134-cumulative-limits) | Unit and database: a second reserve for one proposal adds nothing |
| DSOR-DEL-06c | A reservation stays held while its proposal is PENDING_APPROVAL, APPROVED, EXECUTING, or OUTCOME_UNKNOWN | [§13.4 Cumulative limits](../../../specs/dsor/02-security.md#134-cumulative-limits) | Partly: EXECUTING, the one of the four that a step reaches. Code that looks during the work sees the reservation held |
| DSOR-DEL-06d | A reservation is released when its proposal reaches FAILED, REJECTED, EXPIRED, CANCELLED, REVOKED, or INVALIDATED | [§13.4 Cumulative limits](../../../specs/dsor/02-security.md#134-cumulative-limits) | Partly: FAILED, the one of the six that a step reaches. Unit and database: the day gets the amount back |
| DSOR-DEL-06e | A command that would exceed a limit is refused with LIMIT_EXCEEDED | [§13.4 Cumulative limits](../../../specs/dsor/02-security.md#134-cumulative-limits) | Unit: the limit for one payment, and a slip with only that limit. Unit and database: the limit for one day. The amount checked is the one drafted, since the work drafts only on line ⑨'s read (decision 16) |

## Next

Step 25 · Revocation and the emergency brake. Tear up the permission slip, and its waiting work is
cancelled. Suspend one agent, or freeze every agent in the company. When a proposal that holds a
reservation is cancelled, the reservation must be released (DSOR-DEL-06d).
