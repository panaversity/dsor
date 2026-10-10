# Step 25c · A READY proposal can end

**New in this step:** a READY proposal can end without running. A tear-up cancels it with the
slip's other waiting work, and it expires when its company's lifetime runs out, through a sweep
command that a scheduler login calls.

> **This step builds a proposed change to the specification, not the specification as
> written.** §26.2 draws no move out of READY but EXECUTING, and DSOR-DEL-04c names only
> PENDING_APPROVAL and APPROVED. The learner proposed the change on 2026-10-10. It is written in
> [`../mj_notes.md`](../mj_notes.md), under "What happens to a READY proposal when its slip is
> torn up?", and it answers open question 90 in
> [`research/open-questions.md`](../../../research/open-questions.md).

## In plain words

Since step 23, a call in `propose_only` mode makes a *prepared draft*: a proposal that waits at
READY until someone releases it. Nothing could end one. It held its *booking*: the part of its
slip's day's limit that step 24 reserves for each draft, as a hotel books its last room for one
guest. And its record said "allowed, may go", for as long as it existed.

This step gives READY two more ways out:

- **CANCELLED**, when its slip is torn up. The tear-up now lists READY work beside
  PENDING_APPROVAL and APPROVED work, cancels it, and gives its booking back to the day.
- **EXPIRED**, when it has waited longer than its company allows. Each proposal gets an
  `expires_at` when it is made: the database's clock, plus its company's *lifetime* from
  `ready-lifetimes.json`. A *sweep* command, `proposal.expire_due`, moves each READY proposal
  past its time to EXPIRED, with a record, and gives its booking back. Only a new login,
  `dsor-scheduler`, may call it. In a deployment, a timer calls it each night. This step builds no
  timer: its program calls the sweep itself.

In the picture of the new clerk, the clerk's desk has a tray of prepared forms, each waiting for
someone to release it. Now each form carries a "use by" date. When the clerk is told to clear the
tray, the forms past their date go out of it, and each one is written in the log. Clearing the tray
is a job of its own, for one of DSoR's own logins, and it happens only when that login asks for it.
And when a permission slip is torn up, its forms in the tray go out with it.

## Why it matters

Wednesday, 10:00. user_123 tears up del_100. The agent's prepared draft for INV-1008, made at
03:00, stays READY. It can never run: when step 31 builds the release, line ③ will find the slip
torn up. But it still holds 31,400.00 USD of the day, and any list of READY work shows it as
ready to go. A prepared draft that nobody releases has the same problem with no tear-up at all:
it waits for ever (open questions 90 and 96).

## The design, before any code

The circled numbers are lines of DSoR's checklist, which every call runs through in order, as a
pilot runs through a checklist: ③ finds the agent's slip, ⑤ checks the caller's permission, ⑥
checks the input, ⑦ claims the call's *idempotency key*, which makes a repeated call safe, ⑧ makes
the proposal, ⑨ is DSoR's own look at the state before any work, and ⑩ checks the limits. Lines
⑦ to ⑩ run inside one transaction of the database, the *claim's transaction* (step 20).

### How this step was made

In the understanding session of 2026-10-10, the learner predicted that a tear-up cancels a READY
proposal with the waiting ones. A scratch copy of step 25b with two lines changed did that, in
memory. The learner then proposed the change to the specification, and asked for it to be built.
It is one new idea, "a READY proposal can end", so it is a step of its own, built before step 26.
Step 26 then copies this step.

### What each rule says

- **DSOR-APR-01a:** proposals follow the state machine of
  [§26.2](../../../specs/dsor/03-execution.md#262-lifecycle). This step follows the proposed
  picture, which adds READY → CANCELLED and READY → EXPIRED beside READY → EXECUTING.
- **DSOR-APR-01c:** no move out of a final state. CANCELLED and EXPIRED stay final.
- **DSOR-APR-01b:** every move is recorded with its actor and its cause. A tear-up's move names
  the person who tore up the slip. A sweep's move names `dsor-scheduler`.
- **DSOR-DEL-04c, as proposed:** on revocation, every proposal under the slip that is
  PENDING_APPROVAL, APPROVED, **or READY** moves to CANCELLED
  ([§13.3](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation)).
- **DSOR-DEL-06d:** a reservation is released at CANCELLED and at EXPIRED
  ([§13.4](../../../specs/dsor/02-security.md#134-cumulative-limits)). This step reaches EXPIRED
  for the first time.

### The learner's decisions

- **L1. A tear-up and expiry end a READY proposal in this step.** `proposal.cancel` comes with
  the release, in step 31. *Downside:* a requester cannot cancel a prepared draft by hand yet.
- **L2. Each company's lifetime is a setting,** stored in each proposal's `expires_at`, a field
  that `proposal.schema.json` already has. Start-up refuses more than `P30D`, §44's ceiling for an
  approval ([§44](../../../specs/dsor/06-conformance.md#44-operational-bounds)). *Downside:* one
  more file to keep.
- **L3. A sweep command expires them:** `proposal.expire_due`, DSoR's own command through the
  checklist, with a key, a proposal, and a record. *Downside:* something must call it, on a
  timer.
- **D1. `dsor-scheduler` calls it:** a new login of the spec's subject type `system`, neither a
  person nor an agent. Its role, `scheduler`, holds `proposal:expire`. The brake never stops it,
  because it is not an agent. *Downside:* a fourth kind of caller in the story.
- **D2. The lifetimes live in `ready-lifetimes.json`,** one line for each company, checked at
  start-up. *Downside:* step 26's money policy may want to share one file with it later.
- **D3. A READY proposal made before this step expires 7 days after it was made.** Migration 020
  fills its `expires_at`, with the trigger paused for that one statement. *Downside:* a migration
  that pauses a guard, once.
- **D4. An EXPIRED move's record names the sweep's caller,** `dsor-scheduler`, with the cause
  "waited past its lifetime". *Downside:* none found.

### Found while designing (Claude Code)

- **D5. Every proposal gets an `expires_at`,** not only one that stops at READY: one column, never
  empty. A proposal in execute mode leaves READY in the same transaction, so its time never
  matters. *Downside:* a value that most rows never use.
- **D6. The database sets `expires_at`:** its own clock plus the lifetime, inside the claim's
  transaction. A CHECK, a rule that the database applies to every row it writes, keeps it after
  `created_at`, and within 720 hours of it. The program's clock never sets it. Time is counted in
  hours, never in calendar days, since the review (finding L6). *Downside:* the memory store uses
  the program's clock, as memory always has.
- **D7. `expires_at` is written once,** like the request: the trigger refuses a change to it,
  even from the owner, except in migration 020's one paused statement.
- **D8. One sweep is one transaction:** every due proposal of the company expires, or none does.
  *Downside:* a very long list makes one long transaction. A limit per sweep is a later idea.
- **D9. The sweep answers with a count,** `{ tenant_id, expired }`, as the tear-up counts what it
  cancelled. Each expired proposal's own record names it.
- **D10. The `scheduler` role holds only `proposal:expire`.** It does not hold
  `delegation:revoke`, which every person's role holds since step 25, because the tear-up is for
  people only. The test that every role holds `delegation:revoke` now leaves out `scheduler`, and
  checks that no person holds it. *Downside:* a role that a person must never hold, which only a
  test watches.
- **D11. The sweep names its company,** as a URI: `{ "company": "dsor://org_456/tenant/org_456" }`.
  Line ⑨ refuses an id that is not the call's own company, and the check of the URIs refuses
  another company's URI before that. *Found while building:* with no URI in its input, the
  cross-tenant suite, the test that sends every operation another company's URIs and expects a
  refusal (step 12), had nothing to swap, and reported the sweep as a gap (see "Found while
  building"). *Downside:* the caller says what DSoR already knows from the call.

### Found by the review (Claude Code)

- **D12. Line ③ again, inside the claim, under the slip's lock.** Right after line ⑧, beside the
  brake's check, a command under a slip reads its slip again, and holds the slip's lock, shared,
  until its transaction ends. The tear-up takes the lock alone before it tears up the slip. So a
  tear-up waits for a draft already past this point, and then cancels the draft's proposal if it
  is READY. And a draft that comes during a tear-up waits for it, then hears `DELEGATION_REVOKED`.
  On the database the lock is an *advisory lock*, a lock on a number that DSoR chooses, as the
  brake's is (step 25b's README, decision D8). It is not a lock on the slip's row. The database's
  *row-level security*, its rules about which rows a login may read and change, has a rule,
  `slip_moves`, that lets `dsor_runtime` lock only an active or suspended slip. So a torn-up slip
  would vanish from the read. Memory has no transactions, so there the slip is read again and
  nothing is held: the race is proved on the database only, with real parallel calls. *Found by
  the review (finding H1):* step 25 had left this for step 29, and this step's claim C2 broke
  without it. *Downside:* a tear-up waits for every draft on its way under the slip, with no time
  limit, as a pull of the brake does (step 25b's review, finding M1).
- **D13. One ending at a time in a company.** The tear-up's list and the sweep's list each take
  the company's *ending lock*, alone, until their transaction ends. *Found by the review (finding
  M1):* without it, a tear-up and a sweep could each hold what the other waited for, a proposal
  and a day's total, and PostgreSQL failed one of them. *Downside:* two tear-ups of two slips in
  one company wait for each other too.
- **D14. The sweep is for DSoR's own system logins only.** Its contract says `system_only`, this
  tutorial's own field beside step 25's `people_only`, and line ⑤ refuses any other caller,
  whatever its slip lists and its signer holds. *Found by the review (finding M2):* with a role
  that granted `proposal:expire` and a slip that listed it, an agent swept. *Downside:* one more
  field of this tutorial's own in a contract.
- **D15. A prepared sweep is a prepared draft like any other.** In `propose_only` mode the sweep
  expires nothing and waits at READY. A later sweep expires it when its own time comes, and counts
  it. *Found by the review (finding L3).* *Downside:* a count that can include a sweep.

### The tests, by claim

| Claim | What it says |
| --- | --- |
| C1 | The picture draws READY → CANCELLED and READY → EXPIRED, in the code and in the trigger, and no other new move |
| C2 | A tear-up cancels a READY proposal under the slip, with a record that names the person, and releases its booking. A prepared draft on its way when the slip is torn up is cancelled too, or refused |
| C3 | Every proposal gets `expires_at`: its company's lifetime after `created_at`, by the database's clock. The CHECK keeps it after `created_at` and within 720 hours, and the trigger keeps it as written. `dsor_runtime`, which writes it, is trusted to write the company's lifetime |
| C4 | The sweep expires each READY proposal of the company past its time, with a record that names `dsor-scheduler`, and releases its booking. A READY proposal not yet due, a proposal in another state, and another company's proposal are left alone |
| C5 | Only one of DSoR's own system logins, holding `proposal:expire`, sweeps. A person and an agent are refused, whatever they hold. The brake does not stop the scheduler |
| C6 | Start-up refuses a lifetime that is not a duration, is zero, passes `P30D`, or a company with none |
| C7 | Migration 020 gives an older READY proposal `created_at` plus 7 days |
| C8 | A sweep is one transaction: an accident rolls back every move and every release |

### Breaks we will try, and what we expect

In these breaks, P3 is the agent's prepared draft for INV-1008, 31,400.00 USD, whose time has
come. P6 is a draft prepared a minute before the sweep.

| Break | What we expect | The learner predicted |
| --- | --- | --- |
| B1. Migration 020's trigger forgets READY → EXPIRED | The database refuses the move. The sweep answers INTERNAL_ERROR, nothing expires, and P3 stays READY with its booking | P3 becomes EXPIRED: the code's own check is enough |
| B2. The sweep forgets to release the booking | P3 is EXPIRED, and its 31,400.00 USD stays in the day's total | The database releases the booking by itself |
| B3. The sweep ignores `expires_at` | Every READY proposal expires, even one prepared a minute ago | P3 and P6 both expire |
| B4. The tear-up's list keeps only two states | P3 stays READY after the tear-up, until the sweep expires it | CANCELLED anyway, because the picture allows it |

### Left open, and not this step's idea

- `proposal.cancel`, and its release, `proposal.execute` (step 31).
- The change to the specification itself: §26.2's picture, DSOR-DEL-04c, and a requirement for
  READY's expiry (open question 90).
- A limit on how many proposals one sweep expires.
- The expiry half of DSOR-DEL-04c, a slip that passes its date (step 29).
- The timer itself. This step has the sweep and the login that calls it. What calls it on time,
  and what happens when a night's sweep is missed, belong to a deployment.
- A READY proposal whose time has come but which no sweep has reached yet still holds its
  booking. Step 31's release must check `expires_at` itself, and never trust that a sweep ran.
- A replay of a prepared draft's own key, after the draft expired, answers READY: the answer that
  was recorded, which DSOR-IDM-01c allows. Whether a replay should say the proposal's state now is
  left open (the review's finding L1).
- A tear-up waits for every draft on its way under the slip, with no time limit (decision D12).
- Step 19b's suspension of a slip takes no slip lock, so a draft on its way can still finish after
  it. Nothing in this step's claims depends on it.

## Before you build: set up a database

As in step 25b: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Migration 020 runs. It gives every proposal an `expires_at`,
and gives each proposal made before it its `created_at` plus 7 days (decision D3).

## What changed since step 25b

| File | What changed |
| --- | --- |
| `contracts/proposal.expire_due.json`, `inputs/ProposalExpireDueRequest.schema.json`, `examples/proposal.expire_due.json` | **New.** The sweep's contract, its input (the company, as a URI), and the cross-tenant suite's example |
| `ready-lifetimes.json`, `src/lifetimes.ts` | **New.** Each company's READY lifetime, and the start-up check of the file |
| `src/expiry.ts` | **New.** The sweep, as DSoR's own work: line ⑨'s check of the company, then each move to EXPIRED and each release |
| `migrations/020_ready_can_end.sql` | **New.** `expires_at` and its CHECK, the trigger's two new moves out of READY, and `expires_at` in the trigger's list of what never changes |
| `src/proposals.ts` | The picture's two new moves. Each proposal's `expires_at`. READY in the tear-up's list, in the order of the ids. The store's `due`: the company's READY proposals past their time |
| `src/postgres.ts` | The same on the database: `expires_at` from the database's clock, in milliseconds, READY in the tear-up's list, and `due`. The slip's lock, which the tear-up takes alone, and the company's ending lock, which the tear-up's list and the sweep's list take |
| `src/delegation.ts`, `src/slips.ts` | Line ③ again, inside the claim: `holdSlip`, and the store's `hold`, which reads the slip under its lock (decision D12) |
| `src/permissions.ts` | `system_only`, beside `people_only` (decision D14) |
| `src/registry.ts`, `src/pipeline.ts`, `src/authority.ts` | Start-up reads and checks the lifetimes. Line ⑧ makes each proposal with its company's lifetime. The check after line ⑧ reads the slip again |
| `src/principals.ts`, `roles.json`, `classifications.json`, `store.json` | The login `dsor-scheduler`, the role `scheduler`, the answer's kind `ProposalExpiry`, and `expires_at` in the store map |
| `src/revocation.ts`, `src/main.ts` | DSoR's own work includes the sweep. The program shows the tear-up cancel the prepared draft, and a prepared draft expire |
| `test/ready-ends.test.ts`, `test/ready-ends.db.test.ts` | **New.** The claims C1 to C8, and the review's tests |
| `test/revocation.db.test.ts` | A draft and a tear-up at the same moment, in both orders: the tear-up waits for a draft on its way, and a draft that comes during a tear-up waits for it (decision D12) |
| `test/owner-proposals.ts` | Two new commands for the owner: `backfill`, which counts what migration 020 found, and `due`, which reads org_456's list of due proposals with no policy behind it |
| The other tests | The picture's table, the nine contracts, the suite's 87 attacks, the seventh login, the roles, the labels, the store map, `dsor_runtime`'s privileges, and `expires_at` in each proposal that a test writes by hand. Each test world that builds its own claims now gives them its slips, which the claim reads again |

Step 25b's markers are gone, as the build skill asks. Since step 25c, a search for "NEW IN STEP"
finds only this step's lesson.

```bash
git diff --no-index ../mj_25b_the_emergency_brake/src src
git diff --no-index ../mj_25b_the_emergency_brake/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-10, shortened. The tear-up now cancels the agent's prepared draft:

```text
tearing up the slip, in memory, because a torn-up slip never comes back:
  03:00, the agent prepares a draft: READY
  03:10, the CFO tries to tear up del_100: AUTHORIZATION_DENIED: "delegation.revoke": cfo_100 may not tear up slip "del_100": only its signer or a tenant administrator may
  03:10, user_123 tears up del_100: answered, del_100
  03:11, the agent drafts again: DELEGATION_REVOKED: "payment.create": slip del_100 was torn up
  the prepared draft: CANCELLED, its booking released
```

After the brake, the program tells a prepared draft that nobody releases. It runs in memory, with
a clock of its own, because the program cannot wait a week:

```text
a prepared draft that nobody releases, in memory, with a clock of its own:
  Wednesday 03:00, the agent prepares a draft: READY
  it expires at 2026-10-14T03:00:00.000Z
  Thursday 00:00, dsor-scheduler sweeps org_456: answered, 0 expired
  Thursday 09:00, user_123 tries to sweep: AUTHORIZATION_DENIED: "proposal.expire_due" is for DSoR's own system logins only, and user_123 is not one
  next Thursday 00:00, dsor-scheduler sweeps org_456: answered, 1 expired
  the prepared draft: EXPIRED, its booking released
```

This step has no timer. The program calls the sweep itself, at each time on its clock. In a real
deployment, a scheduler, such as `cron` or a cloud scheduler, calls it each night with
`dsor-scheduler`'s token. Each night's call needs an idempotency key of its own, such as
`sweep-2026-10-15`. A key sent again gives back its first answer, and expires nothing more (the
review's finding L2).

## Break it

Each break ran in a copy of this step outside the repository, on 2026-10-10. B1 and B2 ran on a
local PostgreSQL 17 database of their own, because their predictions are about the database. B3
and B4 ran in memory, with the story's own names and a clock of their own. Each story ran first on
the step's code as it is ("built"), then once with the break. The output is copied as it was
printed.

On the database, the story uses the database tests' agent, intake-fte, under del_190, for INV-9001
of 31,400.00 USD. The database's own del_100 has no day's limit, so a draft under it books
nothing. The lifetime there is one second, so the run can wait for it.

**B1. The trigger forgets READY → EXPIRED.** In the copy's migration 020, the trigger's picture
lost `('READY', 'EXPIRED')`. The code's picture kept it.

```text
=== built
intake-fte prepares P3 for INV-9001, 31,400.00 USD, under del_190: READY
the day's booked total under del_190: 31400.00 USD
P3's lifetime, one second here, passes. dsor-scheduler sweeps org_456: answered, 1 expired
P3: EXPIRED, its booking released
the day's booked total under del_190: 0.00 USD
=== B1, the trigger forgets READY → EXPIRED
intake-fte prepares P3 for INV-9001, 31,400.00 USD, under del_190: READY
the day's booked total under del_190: 31400.00 USD
P3's lifetime, one second here, passes. dsor-scheduler sweeps org_456: INTERNAL_ERROR: DSoR hit an unexpected error
P3: READY, its booking held
the day's booked total under del_190: 31400.00 USD
```

The learner predicted that P3 becomes EXPIRED, because the code's own check allows the move. The
code's check did pass. Then the database's trigger refused the move, because the database keeps
its own copy of the picture (step 22's README, decision 3). The sweep is one transaction, so
nothing moved and nothing was released (decision D8). Each copy of the picture guards against a
mistake in the other: a move happens only when both allow it. Three database tests caught it:
the test that the trigger allows exactly the code's moves, and both sweep tests in
`test/ready-ends.db.test.ts`.

**B2. The sweep forgets the booking.** In the copy's `src/expiry.ts`, the sweep moved each
proposal and did not release its booking.

```text
=== built
intake-fte prepares P3 for INV-9001, 31,400.00 USD, under del_190: READY
the day's booked total under del_190: 31400.00 USD
P3's lifetime, one second here, passes. dsor-scheduler sweeps org_456: answered, 1 expired
P3: EXPIRED, its booking released
the day's booked total under del_190: 0.00 USD
=== B2, the sweep forgets the booking
intake-fte prepares P3 for INV-9001, 31,400.00 USD, under del_190: READY
the day's booked total under del_190: 31400.00 USD
P3's lifetime, one second here, passes. dsor-scheduler sweeps org_456: answered, 1 expired
P3: EXPIRED, its booking held
the day's booked total under del_190: 31400.00 USD
```

The learner predicted that the database releases the booking by itself. It does not. A booking is
a row of `dsor.reservations`, and nothing in the database ties that row to the proposal's state.
Only DSoR's code releases it, in the same transaction as the move (DSOR-DEL-06d). So P3 can never
run, and its 31,400.00 USD still fills the day. The sweep's unit test and its database test
caught it, and so did the program's test, because the program now printed "its booking held".

**B3. The sweep ignores `expires_at`.** In the copy's `src/proposals.ts`, the memory store's `due`
listed every READY proposal of the company.

```text
=== built
Wednesday 03:00, the agent prepares P3 for INV-1008, 31,400.00 USD: READY
next Wednesday 23:59, the agent prepares P6 for INV-1009, 7,425.00 USD: READY
Thursday 00:00, one minute later, dsor-scheduler sweeps org_456: answered, 1 expired
P3: EXPIRED, its booking released
P6: READY, its booking held
=== B3, the sweep ignores expires_at
Wednesday 03:00, the agent prepares P3 for INV-1008, 31,400.00 USD: READY
next Wednesday 23:59, the agent prepares P6 for INV-1009, 7,425.00 USD: READY
Thursday 00:00, one minute later, dsor-scheduler sweeps org_456: answered, 2 expired
P3: EXPIRED, its booking released
P6: EXPIRED, its booking released
```

The learner predicted this: P3 and P6 both expire. One more fact: the CHECK on `expires_at` keeps
the value within its 30 days, and says nothing about when a sweep may move a proposal. Only the
sweep's own filter decides that. Two unit tests caught it: the sweep's test, and the test that a
proposal is due at its `expires_at` and not one millisecond before.

**B4. The tear-up's list keeps two states.** In the copy's `src/proposals.ts`, the memory store's
list of waiting proposals kept only PENDING_APPROVAL and APPROVED, as in step 25.

```text
=== built
Wednesday 03:00, the agent prepares P3 for INV-1008, 31,400.00 USD: READY
Wednesday 10:00, user_123 tears up del_100: answered, del_100 revoked, 1 cancelled
P3: CANCELLED, its booking released
next Thursday 00:00, dsor-scheduler sweeps org_456: answered, 0 expired
P3: CANCELLED, its booking released
=== B4, the tear-up's list keeps two states
Wednesday 03:00, the agent prepares P3 for INV-1008, 31,400.00 USD: READY
Wednesday 10:00, user_123 tears up del_100: answered, del_100 revoked, 0 cancelled
P3: READY, its booking held
next Thursday 00:00, dsor-scheduler sweeps org_456: answered, 1 expired
P3: EXPIRED, its booking released
```

The learner predicted CANCELLED anyway, because the picture allows the move. The picture says
which moves may happen. It never makes one. A move happens only when some code asks for it, and
the tear-up asks only for the proposals in its list. P3 was not in the list, so it waited on with
its booking for a week, until the sweep expired it. Three unit tests caught it: the two tear-up
tests in `test/ready-ends.test.ts`, and the one in `test/revocation.test.ts` that this step turned
round.

B1 and B4 were missed for the same reason: both predictions let the picture decide. In B1 the
code's copy of the picture was taken as the only one. In B4 a move that the picture allows was
taken as a move that happens. In both, the decision was made by other code: the database's
trigger in B1, and the tear-up's list in B4.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The session on steps 22 to 25b. The learner predicted that a tear-up cancels a READY proposal, and a scratch copy of step 25b with two lines changed did it, in memory |
| 2 | Propose | The learner proposed the change to the specification. It is written in `../mj_notes.md` |
| 3 | Decide | L1 to L3 and D1 to D4, each asked with its downside. The learner took each recommendation, and predicted each break |
| 4 | Red | `test/ready-ends.test.ts` and `test/ready-ends.db.test.ts` first. Two old tests turned round: the picture's table, and the tear-up's READY test |
| 5 | Green | The lifetimes and their check, `expires_at`, the sweep, the scheduler's login and role, and migration 020 |
| 6 | The old tests | The lists, the counts, the roles, the labels, the store map, the catalog, and `expires_at` in each proposal that a test writes by hand |
| 7 | The program | The tear-up's last line, and the expiry told in memory |
| 8 | Break it | B1 to B4 in a copy outside the repository, and claim C7 on a database with older proposals |
| 9 | Review | A sweep of small breaks, and a reviewer who had not seen the conversation |
| 10 | Fix | The review's findings, each with a test written red first, then decisions D12 to D15, then a second sweep of breaks |

To start it in a new session:

```text
Build step 25c in learner mode from the design in
docs/baby_steps_tutorials/mj_25c_ready_can_end/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Red | `test/ready-ends.test.ts` did not load: `src/lifetimes.ts` did not exist yet. In the old files, the 2 tests that this step turned round went red: the picture's table, where READY → EXPIRED was not drawn, and the tear-up's READY test, where P3 stayed READY |
| Green, the first full run | 148 tests in 16 files, from three main causes. The tests' copy of the database's catalog had no `expires_at`, so the inspector found the database and the map different. The tests' own role table had no `scheduler`, so start-up refused every registry they built. And the cross-tenant suite found no URI in the sweep's example (decision D11) |
| The old unit tests, after those three | 14 tests in 10 files: the lists that name every contract, the suite's 81 attacks that became 87, the seventh login, the labels, the store map, the proposal's shape, and the tear-up's role test (decision D10) |
| The old database tests | 13 tests in 6 files: `dsor_runtime`'s privileges column by column, the suite's lists and counts, the program's list of operations, and every proposal that a test writes by hand, which had no `expires_at`. And the first tear-up in the tear-up's own file, which now cancelled 3 READY drafts that other files had left under del_190 |
| The new database file | None: `test/ready-ends.db.test.ts` passed on its first run |
| The review's tests, red | 6 unit tests: four where the slip changed between line ③ and the claim, the agent's sweep, and the order of the memory list. 4 database tests: three races of a draft and a tear-up, and the race of a sweep and a tear-up, which deadlocked for real and answered INTERNAL_ERROR |
| The fix of H1, the first run | 53 unit tests: every test world that built its own claims without the slips. The claim now reads the slip again, and with no slips it refused every agent's draft, as it must |
| The first `holdSlip` | Every agent's draft was refused: it read the slip's id from the call's authority, which has no `id`. vitest runs TypeScript without checking its types, so it ran the mistake. It was found by reading the refusal. A typecheck run afterwards, on that code, names it: `TS2345: Argument of type 'Authority \| undefined' is not assignable to parameter of type 'Slip \| undefined'` |

## Check yourself

Walk each case through the story, and say what the database holds after.

1. The agent prepares a draft for INV-1008 on Wednesday at 03:00, in org_456, whose lifetime is
   `P7D`. dsor-scheduler sweeps on Thursday at 00:00, and again a week later. What does each sweep
   do to the draft, and to its booking?
2. On Wednesday at 10:00, user_123 tears up del_100. Under it, P3 is READY and P5 is EXECUTING.
   What happens to each?
3. user_123 calls `proposal.expire_due` for org_456. What does user_123 hear, and at which line?
4. The owner, whom no grant stops, adds a day to P3's `expires_at`. What happens?
5. Someone writes `"org_456": "P45D"` in `ready-lifetimes.json`. What happens when DSoR starts?

<details>
<summary>Answers</summary>

1. The first sweep leaves it READY, because its time, the next Wednesday at 03:00, has not come.
   The second moves it to EXPIRED, with a record that names dsor-scheduler and "waited past its
   lifetime", and gives its 31,400.00 USD back to the day (claim C4).
2. P3 moves to CANCELLED, with a record that names user_123, and its booking is released (claim
   C2). P5 stays EXECUTING. It is not in the tear-up's list, and the picture draws no move from
   EXECUTING to CANCELLED: its call is already on its way to the company's system.
3. `AUTHORIZATION_DENIED` at line ⑤: the sweep is for DSoR's own system logins only, and user_123
   is a person (decision D14). A person is refused even with a role that grants
   `proposal:expire`. Nothing expires.
4. The trigger refuses it: "only the state of a proposal changes". `expires_at` is written once
   (decision D7). Only migration 020's one paused statement wrote it after a proposal was made.
5. DSoR does not start. Start-up names the problem: the lifetime is over 30 days, the longest that
   §44 lets an approval live at L2 (claim C6). The database's CHECK refuses such an expiry too
   (decision D6).

</details>

## Think it through

### Found while building

- **The sweep had no URI, so the suite could not attack it.** The cross-tenant suite swaps each
  example's URIs of org_456 for another company's, and expects a refusal. The sweep's first input
  named nothing, so the suite reported it as a gap: a gap is never a skip. The input now names the
  company (decision D11).
- **The tests' own role table had no `scheduler`.** The tests type the role table out again, so a
  mistake in `roles.json` is not copied into them. Start-up refuses a login whose role the table
  does not have, so every registry built with the tests' table refused to start. The table has
  the role now.
- **The tear-up's list on the database had no order.** Its comment said "in the order of their
  ids", and the SQL had no `ORDER BY`. It has one now. This README then said that the memory store
  sorted already. It did not: the review found that, and it sorts now too.
- **The first tear-up of a test file found other files' drafts.** On the database, drafts that
  other files prepared under del_190 wait at READY. The first tear-up in the tear-up's own file
  cancelled 3 of them, where the test expected 0. The test now counts what the database holds
  before the tear-up.
- **Every proposal that a test writes by hand needed an `expires_at`.** The database refuses a
  proposal with none, with `23502`. Four tests and one owner's program wrote one without it.
- **A marker cut in two.** One comment had "NEW IN" at the end of a line and "STEP 25c" at the
  start of the next, so a search for "NEW IN STEP" missed it.
- **The program's opening comment** said nothing of the tear-up and the brake, steps 25 and 25b.
  One sentence now names them, and this step's two endings.
- **Claim C7's test proves nothing on a new database.** It counts the proposals that migration 020
  found. A database built from nothing has none, so `wrong: 0` holds whatever the migration does.
  A copy checked C7 by hand: migrations 001 to 019, then two older proposals added by a superuser,
  then migration 020:

  ```text
    proposal   |   state   | lifetime | still_waits
  -------------+-----------+----------+-------------
   k-old-done  | COMMITTED | 7 days   | f
   k-old-ready | READY     | 7 days   | t
  the trigger: on
  the owner's count, as the test reads it: {"before":2,"wrong":0}
  a superuser tries to move the READY one's expiry a day on:
  ERROR:  only the state of a proposal changes
  ```

  A test that builds such a database is left open. Note that a READY proposal more than 7 days old
  when migration 020 runs is due at the first sweep after it.

### The sweep of small breaks

A sweep makes one small break at a time in a copy of the step, runs the tests meant for it, and
puts the code back. It made 33 breaks, and each one undid one part of this step. They took out:

- each new move, in the code's picture and in the trigger;
- the expiry's time filter, and each company filter;
- each check of the lifetimes file, and its ceiling;
- the record's actor and cause, and the sweep's count and answer;
- the CHECK's floor and ceiling, and `expires_at` in the trigger's list of what never changes;
- migration 020 switching the trigger on again after its backfill.

The tests meant for them killed 26. Seven survived, and each got a test:

| Break | Why no test saw it | The test now |
| --- | --- | --- |
| K4. In memory, the list of due proposals holds every company's | A move names its company too, so the sweep moved nothing of org_789's | The store's list holds only its own company's proposals |
| K5. In memory, the store takes any lifetime | Start-up refuses such a lifetime first | The store refuses zero and over 30 days, as the CHECK does |
| K10. The sweep counts and releases a move that did not happen | That move fails only when a tear-up ends the proposal between the sweep's list and its move | The sweep gets stores where that happened a moment before, and counts 0 |
| K18. The duration pattern loses its `^` | No test put text before a duration. The spec guard compares a copied pattern with the specification's | Start-up refuses `"xP7D"` and `"P3Dx"` |
| K23. The sweep's input takes a URI of any kind | Line ⑨ compares the id only | An invoice's URI is refused at line ⑥ |
| K25. On the database, the list has no company in DSoR's own WHERE | Row-level security kept the list inside the company | The owner, whom no policy stops, reads org_456's list beside a due proposal of org_789 (DSOR-TEN-01b) |
| K28. On the database, the store reads `created_at` as the expiry | No database test read the expiry back through the store | The C3 database test reads it back |

A second run of the seven, with the new tests, on 2026-10-10, killed each one with the test meant
for it.

### The hostile review

A reviewer who had not seen the build attacked it on 2026-10-10. It ran the unit tests, 15 breaks
of its own, and 11 attacks, in copies outside the repository, with no database. It found one
problem of high weight, three of medium weight, and seven small ones.

| Finding | What it found | What changed |
| --- | --- | --- |
| H1, high | A prepared draft already inside its transaction when its slip was torn up reached READY after the tear-up had listed the slip's waiting work, so nothing cancelled it. It held its 31,400.00 USD until the sweep ended it, up to a week later, with the wrong cause. Line ③ read the slip once only, before the claim | Line ③ again, inside the claim, under the slip's lock (decision D12). Three database races, in both orders, and four unit tests |
| M1, medium | A sweep and a tear-up could each hold what the other waited for: a proposal, and a day's total. The reviewer reasoned it from the order of the locks | A database test made the race happen, and PostgreSQL failed one of the two calls. One ending runs at a time in a company now (decision D13) |
| M2, medium | Only the role table kept an agent from sweeping. With a role that granted `proposal:expire` and a slip that listed it, an agent swept, and its records said it called in its own name | `system_only` (decision D14), and a test |
| M3, medium | The sweep's records were tested for their actor and cause only. Another mode, authority, or request id passed every test | The unit and database tests check the whole identity, and the call's own request id |
| L1 | A replay of a prepared draft's key, after the draft expired, still answers READY | Left open: DSOR-IDM-01c allows the recorded answer |
| L2 | A timer that sends one key every night stops expiring after the first night, because the key replays | "Run it" says that each night needs a key of its own, and a test shows the replay |
| L3 | A sweep in `propose_only` mode had no test and no decision | Decision D15, and a test |
| L4 | Six more of its breaks left every test green: a lifetime that is a list, the order of the memory list, a sweep that names no company, a company with no lifetime given 30 days, "people only" that lets a system login through, and an input schema with no `resourceUri` | A test for each of the first five. The last is still refused, by the check of the URIs |
| L5 | Sentences that said what is not built or not true: a timer, in four places; "the memory store sorted already"; and C3's "the CHECK and the trigger keep it so" | Rewritten, and the memory store sorts now |
| L6 | Two clocks for "30 days". The CHECK added calendar days of the session's time zone, and the code adds milliseconds. The real run below shows the difference | The database counts in hours and milliseconds now |
| L7 | The README's writing: a timer pictured as if it were built, "the day book" beside "the day's limit", words used before they were defined, a sentence of 75 words, and a rules table that left out rules its tests name | Rewritten |

The run that showed L6. A session in New York's time zone, and a proposal made four days before
the clocks there change:

```text
          made          | + '30 days', as hours |   + '7 days'    | + 604800000 ms | 720 hours within '30 days'?
------------------------+-----------------------+-----------------+----------------+-----------------------------
 2027-03-10 12:00:00-05 | 29 days 23:00:00      | 6 days 23:00:00 | 7 days         | f
```

There, "30 days" is 719 hours, so the old CHECK refused a lifetime of `P30D`, which memory takes.
And "7 days" is 167 hours, where memory counts 168.

### The second sweep

After the fixes, a second sweep made 19 breaks on 2026-10-10. Eleven undid a fix: the claim's
second read of the slip, the slip's lock in each of its three places, the ending lock in each of
its two, the system-only check, the public words, the memory list's order, and the check of the
slip's status and company inside the claim. The other eight were the reviewer's own breaks that
had left every test green. The tests meant for them killed 18. The one that survived, a second
read that took another company's slip, got a test, and a run with that test killed it too.

### Left open on purpose

The list under "Left open, and not this step's idea" above. And from step 25b: the records still
do not pass `audit-record.schema.json`, and a READY proposal waits for step 31's release, which
must check the brake and `expires_at` itself. Step 26 starts from there.

## The rules this step meets

This step builds a proposed change, so most of its tests are titled by the step. A test that
proves a rule as the specification writes it is titled by the rule. The rules below still hold as
written, and two of them hold as proposed.

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-APR-01a, as proposed | Proposals follow the state machine of §26.2, with READY → CANCELLED and READY → EXPIRED added | [§26.2 Lifecycle](../../../specs/dsor/03-execution.md#262-lifecycle) | Unit tests in [`test/ready-ends.test.ts`](test/ready-ends.test.ts) (C1) and [`test/proposals.test.ts`](test/proposals.test.ts). Database: [`test/proposals.db.test.ts`](test/proposals.db.test.ts), where the trigger allows exactly the code's moves |
| DSOR-APR-01b | Every proposal transition is recorded with its actor and its cause | [§26.2 Lifecycle](../../../specs/dsor/03-execution.md#262-lifecycle) | A tear-up's move names user_123, and a sweep's names dsor-scheduler, with "waited past its lifetime". Unit tests in [`test/ready-ends.test.ts`](test/ready-ends.test.ts), and the database test of the sweep in [`test/ready-ends.db.test.ts`](test/ready-ends.db.test.ts) |
| DSOR-APR-01c | A proposal does not leave a terminal state | [§26.2 Lifecycle](../../../specs/dsor/03-execution.md#262-lifecycle) | CANCELLED and EXPIRED stay final, in the code and in the trigger. Unit and database |
| DSOR-DEL-04c, as proposed | On revocation, every proposal under the slip that is PENDING_APPROVAL, APPROVED, **or READY** moves to CANCELLED | [§13.3 Revocation and subdelegation](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation) | Unit tests in [`test/ready-ends.test.ts`](test/ready-ends.test.ts) and [`test/revocation.test.ts`](test/revocation.test.ts). Database tests in [`test/revocation.db.test.ts`](test/revocation.db.test.ts). The expiry half of the rule waits for step 29 |
| DSOR-DEL-06d | A reservation is released when its proposal reaches EXPIRED or CANCELLED, among others | [§13.4 Cumulative limits](../../../specs/dsor/02-security.md#134-cumulative-limits) | EXPIRED for the first time: the sweep releases each booking in its own transaction. Unit, and database (claims C4 and C8) |
| DSOR-DEL-04b | A revocation takes effect for new decisions within the bound of §44 | [§13.3 Revocation and subdelegation](../../../specs/dsor/02-security.md#133-revocation-and-subdelegation) | Still met, and now in both orders: a draft on its way finishes before the tear-up, and a draft that comes during a tear-up waits for it, then is refused (decision D12). Database tests in [`test/revocation.db.test.ts`](test/revocation.db.test.ts) |
| DSOR-TEN-01b | Tenant isolation is kept in two independent layers | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | Still met. The sweep's list keeps its company with DSoR's own WHERE alone, as the owner reads it with no policy behind it: [`test/ready-ends.db.test.ts`](test/ready-ends.db.test.ts) |
| DSOR-TEN-02b | A cross-tenant suite attacks every operation with a foreign URI | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | Still met, with the sweep: 87 attacks in [`test/cross-tenant.test.ts`](test/cross-tenant.test.ts) and on the database |
| DSOR-OPR-06 | A `validate_only` call makes no proposal and no change | [§7.3 Invocation modes](../../../specs/dsor/01-model.md#73-invocation-modes) | Still met: a dry run of the sweep expires nothing. [`test/ready-ends.test.ts`](test/ready-ends.test.ts) |
| DSOR-IDM-01c | A key sent again with the same request gives back the recorded answer | [§22 Idempotency](../../../specs/dsor/03-execution.md#22-idempotency) | Still met: a sweep sent again with its first key, a week later, replays its first answer. [`test/ready-ends.test.ts`](test/ready-ends.test.ts) |

## Next

Step 26 · Money done right. Compare amounts exactly, in any currency, with a table of exchange
rates. If an amount cannot be converted, the strict answer wins (DSOR-MON-02 to DSOR-MON-04).
Step 26 copies this step.
