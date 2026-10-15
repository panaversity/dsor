# Step 32 · Preconditions and one attempt at a time

**New in this step:** before a payment is drafted, DSoR checks what must be true right now: the
invoice is issued, the vendor is approved, and something is left to pay. Only one attempt may be
open on an invoice at a time.

## In plain words

A pilot's checklist asks about the world right now, not only about the pilot: is the runway clear?
DSoR's checklist does too. Its rules and limits, from steps 24 to 27, ask who may pay how much. Its
*preconditions* ask what is true of the records right now: INV-1008 is issued, its vendor VENDOR-44
is approved, and some of INV-1008 is still unpaid. Each precondition is one line of CEL, the small
language of conditions from step 27, written in the operation's contract. DSoR reads the invoice and
the vendor itself, fresh, and never takes the caller's word for them.

The second idea is one attempt at a time. Every request to pay has its order-tracking page, its
proposal, since step 22. While the page of one request to pay INV-1008 is still open, because the
request waits for the CFO, a second request to pay INV-1008 is refused, and DSoR gives the address
of the open page. And when DSoR works out how much of an invoice is left to pay, it counts a request
that still waits as spending all of it.

In this tutorial, a payment is a draft. PAY-901 is DSoR's record that VENDOR-44 is to be paid. No
step sends money yet: a later step pays a draft. So "paid", in this README, means that a payment was
drafted.

## Why it matters

On Tuesday the agent asks to pay INV-1008, 31,400.00 USD, to VENDOR-44. The request waits for the
CFO, by the CFO's rule, and the agent is told so. Trying to help, the agent asks again, with a new
idempotency key. Step 20's key stops the same request sent twice, but a new key makes a new request.
In step 31 both requests wait. The CFO approves both, and the agent releases both. This was run on
step 31's code before this step began. PAY-901 and PAY-902 were drafted for one invoice, 31,400.00
USD each: 62,800.00 USD to VENDOR-44, through a perfectly legal path. §25.1 of the specification
tells this story. This step stops requests that overlap: one that waits, and another while it waits.
A second payment drafted after the first one was drafted is not stopped yet, and D9 says why.

The second danger is a vendor that must not be paid. Before this step DSoR keeps no vendor record,
so it cannot see that the accounts team suspended VENDOR-44 after a fraud alert. It drafts the
payment anyway, at once or at a release. Here is the worst case. On Wednesday cfo_100 approves
INV-1008. On Thursday VENDOR-44 is suspended. On Friday the agent releases INV-1008. Step 31 checks
again at the release, but it has no vendor to check, so the payment is drafted. §4 of the
specification warns of this: "Yesterday a human suspended that vendor."

## The design, before any code

The circled numbers are lines of DSoR's checklist, as in step 31. Line ⑦ claims the idempotency
key, line ⑧ makes the proposal, or, for a release, loads it. Line ⑨ is DSoR's own check before any
work: it reads the records the contract binds. Line ⑩ checks the rules and the limits.

Words this step uses:

- **An attempt.** One request to pay an invoice: one proposal, from line ⑧ on.
- **A payment.** What DSoR writes when a request runs: a draft, such as PAY-901. An invoice can be
  a draft too, until someone issues it: INV-1005 is one.
- **A precondition.** A condition, written in CEL in the contract, that must hold on the records
  DSoR read, or the command does not run. A *control* (step 27) is the company's rule about who may
  do what. A precondition is about the records: is this invoice still owed? The specification calls
  each one a *predicate*.
- **In flight.** The specification's word for a proposal that may still run, or runs: `READY`,
  `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`, or `OUTCOME_UNKNOWN` (§25.1). A request that waits
  for the CFO is in flight. `OUTCOME_UNKNOWN` is a payment sent with no answer back, step 37's idea.
- **The look.** Line ⑨'s search for another attempt in flight over the same invoice.
- **Bound state, and an alias.** The records line ⑨ reads for a command, named in the contract's
  `bind`, each by a name of its own, its *alias*, such as `invoice`. Since step 24,
  `payment.create` binds the invoice its input names. Now it binds the invoice's vendor too, as
  `vendor`.
- **A booking.** The amount set aside against the slip's limit for the day when a request is
  decided, like holding the last hotel room (step 24's reservation).
- **A freshness label.** Each read says how fresh it is (step 15). From the strongest: `current`,
  read from the system just now; `bounded_staleness`, no older than an age; `connector_defined`, as
  the connector promises; and `observational`, from a cache, with no promise.
- **A classification label.** Each message says how secret it is (step 14). A `public` message is
  heard by every caller, and an `internal` one only by a caller cleared for it.
- **An accident.** An error that is not a business refusal, such as a lost connection. The call's
  work is undone, and nothing of it is kept (step 20).
- **The picture.** §26.2's drawing of the moves between a proposal's states (step 22).
- **An advisory lock.** A lock that PostgreSQL holds on a number DSoR chooses, not on a row (step
  25b).

### How this step was made

The learner chose to build first and understand afterwards, as for steps 27 to 30: "implement 32
now we will understand later". So every decision below is Claude Code's, for the learner to
review, and each one says what it costs. This folder is a copy of step 31.

### What each rule says

- **DSOR-EXC-01:** "While a proposal is in flight, a second proposal for the same operation over
  the same `exclusive_over` resource MUST be refused with `CONFLICT`, naming the existing proposal"
  ([§25.1](../../../specs/dsor/03-execution.md#251-in-flight-exclusivity)).
- **DSOR-EXC-02:** "A precondition over an available amount — an open balance, a credit limit,
  stock on hand — MUST count amounts committed to in-flight proposals as unavailable"
  ([§25.1](../../../specs/dsor/03-execution.md#251-in-flight-exclusivity)).
- **DSOR-FRS-02a:** "Preconditions of `HIGH` and `CRITICAL` commands MUST be evaluated on `CURRENT`
  reads unless the contract explicitly permits bounded staleness"
  ([§27](../../../specs/dsor/03-execution.md#27-freshness-and-consistency)).
- **Beside them:** DSOR-CTL-08, "When a precondition predicate fails to evaluate, the predicate
  MUST be treated as false". DSOR-FRS-02b, "When the connector cannot deliver the required
  freshness, DSoR MUST return `FRESHNESS_UNSATISFIABLE` and not fall back to a cache". DSOR-MOD-03,
  preconditions read only what DSoR reads itself. And DSOR-APR-03a and DSOR-APR-03c from step 31:
  the release checks the preconditions again, and one that fails invalidates.

### Decisions (Claude Code)

- **D1. Vendors are the accounts system's records, beside its invoices.** A new table,
  `app.vendors`, holds each company's vendors with a status, `approved` or `suspended`. DSoR reads
  it and never writes it. The store that reads invoices reads vendors too. Every vendor of the
  story starts approved. No DSoR command suspends a vendor: the accounts team does, in the accounts
  system, and the tests change the row as that team would. *Downside:* DSoR's log never says who
  suspended a vendor, or when. It sees only the status now.
- **D2. The vendor is bound through the invoice:** `"vendor": "state.invoice.vendor_id"`. A bind
  may now name the `vendor_id` of a record bound before it, and line ⑨ reads that vendor itself,
  in the call's own company. The request never names a vendor (DSOR-MOD-03). Start-up refuses any
  other new kind of bind. *Downside:* the link is found by the field's name, `vendor_id`, this
  tutorial's reading of §6's pattern (step 17's decision 15).
- **D3. `payment.create` has three preconditions, in its contract:**
  `state.invoice.status == "issued"`, `state.vendor.status == "approved"`, and something is left to
  pay, `dsor_exceeds(state.invoice.open_amount, dsor_money("0.00", state.invoice.open_amount.currency))`.
  The code's own check that the invoice is issued, kept there since step 17 "until step 32 moves
  it to the contract", is gone from the code. *Downside:* the code now trusts line ⑨, so a contract
  that loses its precondition writes a payment for an invoice nobody issued. Break B5 shows it.
- **D4. A precondition that does not hold answers `CONFLICT`,** before any rule is asked and
  anything is booked: §28 keeps `CONFLICT` for business-rule conflicts. The words name the first
  one that fails, in the contract's order. One that cannot be evaluated, such as a vendor that is
  not in the table, is false (DSOR-CTL-08), and the words say so: like a lock that stays locked
  when the power fails, a condition that cannot be checked does not let the payment through. The proposal ends `DENIED`, and
  the record says `DENY`. *Downside:* the caller learns which condition failed, such as that the
  vendor is not approved.
- **D5. Every bound read must be as fresh as the contract asks.** `payment.create` asks
  `current`. A read whose freshness label is weaker than the contract asks is refused with
  `FRESHNESS_UNSATISFIABLE`, and DSoR does not fall back to a cache (DSOR-FRS-02b). That code's retry
  class is `after_delay`: the caller may try again later. A release reads `current`, even when the
  contract permits older reads (D11). *Changed by the review, L5:* a contract that asked
  `connector_defined` took an `observational` read. Start-up refuses a `HIGH` or `CRITICAL` command whose
  preconditions ask less than `current`, unless they ask `bounded_staleness` with a
  `max_age_seconds` (DSOR-FRS-02a). *Downside:* this holds every command to its own contract, not
  only the `HIGH` and `CRITICAL` ones the rule names.
- **D6. One attempt per invoice:** `payment.create`'s contract says
  `"in_flight": { "exclusive_over": ["invoice"] }`. This tutorial allows one alias at most, and
  only an alias bound from the input. *Downside:* the schema allows a list, and a command over two
  records would need a lock, and a database key, over both.
- **D7. The look takes the invoice's lock first.** Inside the claim of a new attempt, line ⑨ takes
  a lock for this operation and this invoice, alone, and holds it until the claim ends. Then it
  looks for another proposal in flight. A dry run looks without a lock, and so does a release: the
  proposal it releases stays in flight until the release ends, so a new attempt meanwhile finds it
  and is refused. The database keeps a key too, a unique index on the proposals: two proposals of
  one operation over one invoice cannot both be in flight. *Changed by the review, L4 and X9:* a
  dry run and a release took the lock too. *Downside:* two attempts on one invoice wait for each
  other, though only one can win.
- **D8. The refusal names the proposal that waits, and its state:** `invoice INV-1008 has an
  attempt in flight already: proposal prop_…, PENDING_APPROVAL`. Every caller hears these words,
  whatever their clearance: the message is `public`, since DSOR-EXC-01 asks for the name. *Changed
  by the review, M3:* it was `internal`, and an agent with no clearance heard no name. The second
  proposal ends `DENIED`, and the record says `DENY`. *Downside:* a second agent of the same company learns the address of
  the first agent's proposal.
- **D9. What is left to pay** is the invoice's open amount, unless another proposal in flight
  spends the invoice: then nothing is left (DSOR-EXC-02). `payment.create` drafts all that is left,
  so one in flight holds all of it. Only the preconditions read this count: the rules and the
  booking read the invoice's real amount (the sweep's break M04). *Changed while building:* this
  decision first counted the drafts too, the payments made and not cancelled. DSOR-EXC-02 counts
  what is committed to proposals in flight, and no step pays a draft yet, so this step counts what
  the rule names.
  *Downside:* two drafts of one invoice can still be made one after the other. The step that pays
  a draft must count the payments in flight then.
- **D10. Withdrawn while building.** It said the draft is for what is left, worked out in the code
  and in line ⑨. With D9 as it is now, whenever the code runs, what is left is the whole open
  amount, so the code drafts the open amount, as before.
- **D11. At the release, line ⑨ runs again in full:** the reads, the look, and the preconditions on
  the invoice and the vendor as they are now. The reads must be `current`, even when the contract
  permits older ones: §26.4 re-evaluates "against `CURRENT` state". *Changed by the review, M2.*
  The proposal being released is in flight itself, so it is left out of its own count. A precondition that fails invalidates
  (DSOR-APR-03c). A read that is not fresh enough leaves the proposal waiting, as step 31's D15
  does. *Downside:* a vendor suspended for an hour by mistake sends the payment back to be drafted
  and approved again.
- **D12. The program tells three scenes.** The agent asks twice for INV-1008: the second is refused,
  naming the first. VENDOR-44 is suspended after cfo_100's approval, and the release invalidates.
  INV-1005, a draft invoice, is refused by its precondition. *Downside:* a longer program run to
  read.

### Decisions found while building (Claude Code)

- **D13. Line ⑨ checks the version a call names, before the preconditions.** Step 21 checked it in
  the code, and step 31 at the release. With the preconditions before the code, a request decided
  on another version of a draft invoice heard the precondition's `CONFLICT` before `STALE_STATE`.
  Facts come first (step 21's decision 7), so line ⑨ compares the version for every call, in every
  mode. *Downside:* a stale request prepared in `propose_only` mode, or tried as a dry run, now
  hears `STALE_STATE` at once, where step 23 let it wait `READY` or said `ALLOW`. Tests that used a
  stale version to make the code refuse now give the code a refusal of its own.
- **D14. Memory undoes what a call did after an accident, as the database does.** In memory, a
  code that broke left its proposal `EXECUTING`, where the database rolls it back with the claim
  (step 22's decision 9). `EXECUTING` is in flight, so the retry was refused by its own leftover.
  Now memory drops the records that call wrote and puts the proposal back in the state of its last
  record left: a release goes back to `APPROVED`. A proposal the call made goes, with the booking
  it made. *Changed by the review, M1:* memory first deleted the proposal, even one it had only
  loaded for a release. *Downside:* memory still does not undo a payment the code wrote before it broke. The
  database does.
- **D15. Each database test starts with no proposal in flight.** Runs of earlier steps left about
  eighty proposals waiting in the tests' database, and each would hold INV-1008. Before each file,
  the owner ends them, in a child process of its own, along moves the picture draws: `CANCELLED`,
  or `FAILED` for one that was running. It deletes nothing. The tests of one file draft the tests'
  own INV-9001 one after another. The owner's child process takes half a second, too long before
  every test, so before each test DSoR's own login ends them in the same way. Both change the state alone: no record of the move, and the bookings stay held,
  which no test reads. *Downside:* a proposal that a defect left in flight would be ended before
  the next test could see it.

### The story's numbers

| When | Who | Asks | DSoR answers |
|---|---|---|---|
| Tuesday | the agent | drafts INV-1008, 31,400.00 USD | `PENDING_APPROVAL`, for the CFO |
| Tuesday | the agent | drafts INV-1008 again, with a new key | `CONFLICT`, naming the proposal that waits. The second proposal is `DENIED` |
| Wednesday | cfo_100 | approves INV-1008 | `APPROVED` |
| Thursday | the accounts team | suspends VENDOR-44 | (in the accounts system) |
| Friday | the agent | releases INV-1008 | `APPROVAL_INVALIDATED`: the vendor is not approved. The proposal is `INVALIDATED`, and its 31,400.00 USD goes back to the day |
| Tuesday | user_123 | drafts INV-1005, 1,999.99 USD, a draft invoice nobody issued | `CONFLICT`: the precondition `state.invoice.status == "issued"` does not hold |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | The contract's preconditions run at line ⑨, on what DSoR read: an invoice that is not issued, a vendor that is not approved or not there, nothing left to pay. Each is `CONFLICT`, `DENY`, before any booking; a dry run hears the same (DSOR-MOD-03, DSOR-CTL-08) |
| C2 | One attempt at a time: a second `payment.create` over an invoice with one in flight is `CONFLICT`, naming it, in every state of flight; one that ended frees the invoice; ten at once leave one in flight, in memory and on the database (DSOR-EXC-01) |
| C3 | What is left to pay counts the proposals in flight that spend the invoice, `READY` ones too; one that ended frees it; the proposal being released is not counted against itself, nor is its dry run (DSOR-EXC-02) |
| C4 | Freshness: a bound read weaker than the contract asks is `FRESHNESS_UNSATISFIABLE`; start-up refuses a `HIGH` or `CRITICAL` contract that asks less than `current` (DSOR-FRS-02a, DSOR-FRS-02b) |
| C5 | The release checks the preconditions again: VENDOR-44 suspended after the approval makes the proposal `INVALIDATED`; the proposal is not counted against itself (DSOR-APR-03a, DSOR-APR-03c) |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. The look for a proposal in flight is gone | the second attempt on INV-1008 is still refused, by the count of what is left to pay: two checks stop the same thing | (asked at the review) |
| B2. The release does not read the vendor again | INV-1008's payment is drafted to a suspended VENDOR-44 | (asked at the review) |
| B3. The look and the count are both gone | both attempts on INV-1008 wait, and both payments are drafted: step 31's failure comes back | (asked at the review) |
| B4. The proposal being released counts against itself | INV-1008's own release finds nothing left to pay, and is `INVALIDATED` | (asked at the review) |
| B5. `payment.create` loses its precondition on the invoice's status | INV-1005, a draft invoice, gets a payment drafted | (asked at the review) |
| B6. On the database, the invoice's lock is gone | two attempts at once both pass the look, and the database's key refuses the second | (asked at the review) |

### Left open, and not this step's idea

- `dsor_in_flight` and `dsor_sum`, Appendix B's functions for amounts in flight: this step counts
  them in DSoR's own code, and a condition that calls either is still refused at start-up.
- Holding a resource when an outcome is unknown (`hold_on_unknown`): step 37.
- A vendor's payment details changing, and new vendors (`dsor_is_new_counterparty`): later steps.
- The decision bundle that names every record version read: step 33.

## What changed since step 31

| File | What changed |
| --- | --- |
| `migrations/028_vendors.sql`, `src/vendor.ts` | **New.** The accounts system's vendors, behind the company's row-level security (step 11), read-only for `dsor_runtime`, each with a version (D1) |
| `src/invoice.ts`, `src/postgres.ts` | The store that reads invoices reads one vendor too, with its read's label |
| `src/bound.ts` | A bind may follow an invoice's `vendor_id` (D2). The bound invoices are kept apart from the state a condition reads. A bound address must be an invoice's (review L1) |
| `src/preconditions.ts` | **New.** The contract's freshness checked against each read (D5), its predicates evaluated in order (D3, D4), and start-up's check of a `HIGH` or `CRITICAL` contract (DSOR-FRS-02a) |
| `src/inflight.ts` | **New.** The look for an attempt in flight, under the invoice's lock (D6 to D8), and what is left to pay while another proposal spends the invoice (D9) |
| `src/pipeline.ts` | Line ⑨: the reads, their freshness, the version decided on (D13), the look, the count, then the preconditions. Line ⑧ writes the record a proposal is exclusive over |
| `src/proposals.ts`, `src/claims.ts`, `migrations/029_one_attempt.sql` | The proposals in flight over a record, the lock, and the database's key `proposals_one_attempt`, with memory's copy of it. Memory holds a real lock per record, and undoes a proposal after an accident (D14) |
| `src/operations.ts` | `payment.create`'s code no longer checks the invoice's status: the precondition does |
| `src/registry.ts` | Start-up takes a command's predicates, refuses a query's and a release's own, and checks `in_flight` and the freshness of `HIGH` and `CRITICAL` commands |
| `src/limits.ts` | Memory's reservations forget the booking of a proposal that an accident undid (D14) |
| `contracts/payment.create.json` | The vendor's bind, the three preconditions, and `in_flight.exclusive_over` |
| `src/main.ts` | The story of this step, in three scenes, in a world of its own (D12). Two of the earlier stories prepare INV-1012 and INV-1004 instead of INV-1008, and the rule story's dry run asks about INV-1004: a prepared or waiting INV-1008 is in flight there |
| `test/vendors*.ts`, `test/preconditions.test.ts`, `test/left-to-pay.test.ts`, `test/one-attempt*.ts`, `test/release-vendor*.ts` | **New.** The claims C1 to C5 |
| `test/review.test.ts` | **New.** What the review found: each fix, red first, and a test for each break that survived |
| `test/db-setup.ts`, `test/attempts.ts`, `test/owner-attempts.ts` | Each database test file and each test start with no proposal in flight (D15) |
| The other tests | Tests that opened several attempts on one invoice use several invoices. Tests that used a stale version or a draft invoice to make the code refuse give the code a refusal of its own. Each says "Changed in step 32" |

Step 31's markers are gone, as the build skill (`.claude/skills/build-baby-step`) asks. A search
for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_31_check_again_at_execution/src src
git diff --no-index ../mj_31_check_again_at_execution/test test
```

## Run it

As in step 31, the step needs a local PostgreSQL 17 and a database of its own. Its `.env` is
written by a command that prints nothing. Give the step a server of its own if you can: `pnpm
migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server. Run one suite at a time on
it: two runs at once change the tests' own invoice under each other. This step adds two
migrations, 028 and 029.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-16. After step 31's scenes, the program tells this step's story in a
world of its own:

```text
preconditions and one attempt at a time, in memory, in a world of their own:
  the agent drafts INV-1008, 31,400.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  the agent drafts INV-1008 again, with a new key: CONFLICT: invoice INV-1008 has an attempt in flight already: proposal dsor://org_456/proposal/prop_6549a98d-8df3-4561-9bec-31174a2ff44a, PENDING_APPROVAL
  cfo_100 approves the first: APPROVED
  the accounts team suspends VENDOR-44
  the agent releases INV-1008: APPROVAL_INVALIDATED: proposal prop_6549a98d-8df3-4561-9bec-31174a2ff44a is INVALIDATED: CONFLICT: a precondition of payment.create does not hold: state.vendor.status == "approved"
  INV-1008's proposal: INVALIDATED, its booking released
  user_123 drafts INV-1005, a draft invoice: CONFLICT: a precondition of payment.create does not hold: state.invoice.status == "issued"
  payments drafted in this world: 0
```

The second attempt names the first, which waits for the CFO. The first is approved, and then the
accounts team suspends VENDOR-44. At the release, line ⑨ reads the vendor again, and the proposal
is invalidated, its 31,400.00 USD given back to the day. INV-1005 never reaches a rule: its
precondition refuses it first. No payment is drafted in this world.

## Break it

Each break ran on 2026-10-16 in a copy of this folder outside the repository, never in the folder
itself, and the copy was restored after each run. A short script told four scenes in memory, each
numbered by the break it shows: S1, the agent's two attempts on INV-1008, each approved by cfo_100
and released if it waits, for B1 and B3; S2, a release after VENDOR-44 is suspended; S4, a release
with nothing changed; S5, the agent's draft of INV-1005, a draft invoice. Then the whole unit suite
ran. Unbroken, the scenes read:

```text
S1, the agent's second attempt on INV-1008: CONFLICT: invoice INV-1008 has an attempt in flight already: proposal dsor://org_456/proposal/prop_c654e383-7d9d-4d2d-963c-63c8f628e0e0, PENDING_APPROVAL
S1, after cfo_100 approves and the agent releases each that waits: drafted PAY-901 INV-1008 31400.00
S2, the release after VENDOR-44 is suspended: APPROVAL_INVALIDATED: proposal prop_76f637bb-b1f4-457e-83c3-7f00144e61b0 is INVALIDATED: CONFLICT: a precondition of payment.create does not hold: state.vendor.status == "approved"; drafted none
S4, the release of the approved INV-1008, nothing changed: COMMITTED; drafted PAY-901 INV-1008 31400.00
S5, the agent drafts INV-1005, a draft invoice: CONFLICT: a precondition of payment.create does not hold: state.invoice.status == "issued"; drafted none
```

**B1. The look for an attempt in flight is gone.** In `src/pipeline.ts`, line ⑨ skipped
`checkExclusive`:

```text
S1, the agent's second attempt on INV-1008: CONFLICT: a precondition of payment.create does not hold: dsor_exceeds(state.invoice.open_amount, dsor_money("0.00", state.invoice.open_amount.currency))
S1, after cfo_100 approves and the agent releases each that waits: drafted PAY-901 INV-1008 31400.00
```

The second attempt is still refused, by the count of what is left to pay: the first is in flight,
so nothing is left. Two checks stop the same thing, and the words show which one held. 10 tests failed:
the ones that read DSOR-EXC-01's words, which name the first proposal, and the limits' seven drafts
at once. The look takes the invoice's lock, so the lock went with it, and drafts at the same moment
met each other in flight.

**B2. The release skips the preconditions.** The design's B2 said "the release does not read the
vendor again". As made, line ⑨ in `src/pipeline.ts` checked the preconditions only when no request
was stored, which is never at a release: it read the vendor, and never looked at what it read.

```text
S2, the release after VENDOR-44 is suspended: COMMITTED; drafted PAY-901 INV-1008 31400.00
```

INV-1008's payment is drafted to VENDOR-44, which the accounts team suspended after cfo_100's
approval: the bug of "Why it matters". 4 tests failed, all of `test/release-vendor.test.ts`'s invalidations.

**B3. The look and the count are both gone.** B1, and the count of what is left found nothing in
flight:

```text
S1, the agent's second attempt on INV-1008: INTERNAL_ERROR: DSoR hit an unexpected error
S1, after cfo_100 approves and the agent releases each that waits: drafted PAY-901 INV-1008 31400.00
```

The design expected both attempts to wait and both payments to be drafted. They are not. Memory's
copy of the database's key refuses the second proposal as it moves to `PENDING_APPROVAL`, an
accident, so the caller hears `INTERNAL_ERROR`: a third check, the last one. One payment is drafted. 14 tests failed.

**B4. The proposal being released counts against itself.** In `src/inflight.ts`, the count no
longer left out the proposal being decided:

```text
S4, the release of the approved INV-1008, nothing changed: APPROVAL_INVALIDATED: proposal prop_5c8c26f0-299b-403e-829f-6c3524662cb0 is INVALIDATED: CONFLICT: a precondition of payment.create does not hold: dsor_exceeds(state.invoice.open_amount, dsor_money("0.00", state.invoice.open_amount.currency)); drafted none
```

An approved payment, with nothing changed, finds itself in flight at its own release, nothing left
to pay, and is `INVALIDATED`. In S1, the first attempt's release did the same, and nothing was
drafted at all. 27 tests failed: every release that should draft a payment, in memory, and their
dry runs.

**B5. `payment.create` loses its precondition on the invoice's status.** In
`contracts/payment.create.json`, the first predicate was gone:

```text
S5, the agent drafts INV-1005, a draft invoice: COMMITTED; drafted PAY-901 INV-1005 1999.99
```

INV-1005, a draft invoice nobody issued, gets PAY-901: since this step the code trusts line ⑨ (D3).
7 tests failed.

**B6. On the database, the invoice's lock is gone.** In `src/inflight.ts`, the look no longer took
the lock. Ten attempts on INV-9001 at the same moment, each in `propose_only` mode, heard:

```text
9 x INTERNAL_ERROR: DSoR hit an unexpected error
1 x READY
```

Without the lock, the attempts look at the same moment, and none finds another in flight. The
database's key `proposals_one_attempt` keeps one proposal in flight, and refuses the others as
they move to `READY`: an accident to DSoR, so `INTERNAL_ERROR`, never a second payment waiting. In
an earlier run of the same break, one attempt came after the first was written, and heard
`CONFLICT`. The test of ten at once failed: it expects nine to hear `CONFLICT`.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Merge | Staging's pull request #6 merged in first; step 31's open questions renumbered to 132 to 134 |
| 2 | The problem | Step 31's code, run: two attempts on INV-1008, both approved, and both drafted, 62,800.00 USD |
| 3 | Decide | D1 to D12, Claude Code's, written down before any code, as the learner chose to build first. Each one the build or the review found wrong was changed in the open, and says so |
| 4 | The copy | Step 31 copied, its markers removed, and a PostgreSQL of its own |
| 5 | Piece A | Vendors and the bind through the invoice, red first |
| 6 | Piece B | The preconditions and their freshness, red first; the version checked at line ⑨ (D13) |
| 7 | Pieces C and D | What is left to pay, and one attempt at a time, with the lock and the key; D9 changed and D10 withdrawn; D14 and D15 found |
| 8 | Piece E | The release reads the vendor again: the "done when", in memory and on the database |
| 9 | Piece F | The program's story |
| 10 | Break it | B1 to B6, run for real, in a copy of the folder |
| 11 | Review | A sweep of 30 small breaks by a second session of this build: 8 survived, one a real flaw (M04). Then a reviewer who had not seen the conversation, who broke the code 34 times in a copy of its own: four medium, six low, nine breaks no test caught |
| 12 | Fix | M04, M1, M2, M3, L1, L2, L4, L5, and X9, each red first; a test for each break that survived; M4, L3, and L6 recorded |

To start it in a new session:

```text
Build step 32 in learner mode from the design in
docs/baby_steps_tutorials/mj_32_preconditions_and_one_attempt_at_a_time/README.md.
```

## Check yourself

1. The agent asks to pay INV-1008 while an earlier request for it waits for the CFO. What does it
   hear, and what happens to the second proposal?
2. Why does DSoR read VENDOR-44 itself, through the invoice, and not take the vendor from the
   request?
3. cfo_100 approved INV-1008 on Wednesday, and VENDOR-44 was suspended on Thursday. What happens at
   Friday's release, and where does the 31,400.00 USD go?
4. At its own release, INV-1008's proposal is in flight. Why does it not find "nothing left to pay"?
5. A store answers from a cache, and `payment.create` asks for current reads. What does the caller
   hear, and may it retry?

<details>
<summary>Answers</summary>

1. `CONFLICT`, naming the first proposal and its state, `PENDING_APPROVAL`. The second proposal
   ends `DENIED`, and its record says `DENY` (D8). Nothing is booked for it: the look is at line ⑨,
   and line ⑩ books.
2. DSoR never takes the caller's word for a fact (DSOR-MOD-03). If the request could name a vendor,
   it could name an approved one, VENDOR-12, while the invoice's own vendor, VENDOR-44, is
   suspended, and the precondition would check the wrong vendor. The bind follows the invoice's
   own `vendor_id`, and a request that names a vendor is refused at line ⑥ (D2).
3. The release runs line ⑨ again. The precondition `state.vendor.status == "approved"` does not
   hold, so the proposal is `INVALIDATED`, the caller hears `APPROVAL_INVALIDATED` with that cause,
   and the booking goes back to the day (D11).
4. The proposal being decided is left out of its own count. Break B4 shows what happens without
   that: the proposal invalidates itself.
5. `FRESHNESS_UNSATISFIABLE`, whose retry class is `after_delay`: it may try again later (D5).
   DSoR does not fall back to the cache (DSOR-FRS-02b). At a release, the payment waits, as step
   31's D15 decided.

</details>

## Think it through

### Found while building

- **Step 31's check of the version skipped itself once two records were bound.** It checks the one
  record line ⑨ read, and returns when there are more. Binding the vendor made two. The bound
  invoices are now kept apart from the state a condition reads (piece A).
- **Facts first, again.** With the precondition before the code, a request decided on another
  version of a draft invoice heard `CONFLICT` before `STALE_STATE`. Line ⑨ checks the version for
  every call now (D13).
- **D9 changed: drafts are not counted.** D9 first counted the drafts as spent. DSOR-EXC-02 counts
  what is committed to proposals in flight, and no step pays a draft yet, so D9 counts what the
  rule names, and D10 is withdrawn. The day's limit tests showed what counting drafts would have
  meant: they draft one invoice seven times, and every draft after the first would have been
  refused, though no payment had left.
- **Memory needed a real lock.** A comment said memory runs one call at a time. It does not: calls
  interleave at each `await`, and seven drafts at once all passed the look. Memory's claims hold a
  lock per record until the claim ends, as the database's advisory lock is held (D7).
- **An accident left a proposal in flight, in memory.** Memory left it `EXECUTING`, where the
  database rolls it back, and the retry was refused by its own leftover (D14).
- **The tests' database was full of old attempts.** About eighty proposals in flight from earlier
  runs would have held INV-1008. Each file and each test now starts with none (D15). The first try,
  a child process of the owner before each test, took half a second a test, so DSoR's own login
  ends them instead.
- **Two runs on one database.** A second session of this build, started a day earlier, ran its
  breaks against the same database, and in the same folder, while this one ran the database suite.
  Eight tests failed that pass alone: each run's tests changed the tests' own invoice, INV-9001, and
  the tests' own slip, while the other run's tests were using them. The step now runs on a database of its own, and one suite at a time.
- **Who loses a race of two releases changed.** Step 31's test of two releases at once expected
  user_123's release to lose and read why. With the invoice's lock, either could lose for a while,
  and the agent, whose clearance is below `internal`, hears the same `CONFLICT` masked. The test
  now accepts either loser. Since the review, a release takes no lock (X9 below).

### The reviews

A sweep of 30 small breaks, made by that second session in a copy of its own, left 8 with every
test it ran green. Claude Code checked each one against the whole unit suite, in a copy of its own:

- **The sweep's break M04, fixed: the count reached line ⑩.** While another attempt was in flight, the count set the
  invoice's open amount to zero, and line ⑩ read that state. So a contract without the precondition
  over what is left met the CFO's rule with 0.00, skipped the approval, and booked nothing for a
  draft of 31,400.00 USD. Now only the preconditions read the count, and line ⑩ reads what DSoR
  read. The precondition hid it: it refuses first.
- **Six more, each now a test:** an attempt in flight of an operation that spends nothing (M05,
  M06); the record a proposal is exclusive over, on the database (M08); memory's copy of the key
  (M14); a `bounded_staleness` read where `current` is asked (M17); another company's INV-1008 in
  memory (M28).
- **One equivalent:** reading the vendor in the invoice's own company, not the call's (M26). They
  are one company: the store reads only the call's.

Then a reviewer who had not seen the conversation read the code and broke it 34 times in a copy of
its own, on the unit tests only. It found no way past the three checks with the shipped contracts:
the look under the lock, the count of what is left, and the database's key. Four medium findings,
six low, and nine breaks that no test caught:

- **M1, fixed: memory's undo deleted an approved proposal.** When a release had an accident, memory
  removed the proposal and its whole history, and left its 31,400.00 USD held. Now memory undoes
  only what that call wrote: a release goes back to `APPROVED`, and a draft that broke leaves no
  proposal and no booking (D14).
- **M2, fixed: a release read at the contract's freshness.** A contract that permits five minutes
  of staleness drafted a payment to a suspended VENDOR-44, from a cache four minutes old. A release now reads
  `current`, whatever the contract permits (D11, DSOR-APR-03a).
- **M3, fixed: an agent with no clearance heard no name.** The refusal of a second attempt was
  `internal`, so intake-fte, a test agent with no clearance, heard it masked. DSOR-EXC-01 asks for
  the name: the words are `public` now (D8).
- **M4, recorded:** the 62,800.00 USD of "Why it matters" can still be drafted one attempt after
  the other: drafted, released, then drafted and released again. D9 says why, and "Why it matters"
  says so now. The learner reviews D9.
- **L1, fixed:** an address of another kind with an invoice's id, such as
  `dsor://org_456/payment/INV-1008`, read INV-1008, and the look searched the invoice's own address:
  two attempts over one invoice. Only the input schema's `/invoice/` stopped it. Line ⑨ now refuses
  an address that is not an invoice's.
- **L2, fixed:** a predicate in `proposal.execute`'s own contract was taken at start-up and never
  evaluated. Start-up refuses it now.
- **L3, recorded:** the vendor is not pinned at the write. A vendor suspended between line ⑨'s read
  and the draft's write still gets the draft. The draft is pinned to the invoice's version only.
- **L4 and X9, fixed:** on the database, a dry run took the invoice's lock, and no test could show
  what a release's lock protected. Neither takes it now (D7).
- **L5, fixed:** a contract that asks `connector_defined` took an observational read. A weaker
  label is refused, whatever the contract asks (D5).
- **L6, recorded:** the tests' cleanup changes a proposal's state alone, with no record, and would
  hide a proposal that a defect left in flight (D15).
- **The nine breaks no test caught, each now a test** but the last: the lock taken after the
  look; no record of what a proposal is exclusive over, in memory; `exclusive_over` on a query; the
  look before the check of the version; a dry run that skips the freshness; a `connector_defined`
  read where `current` is asked; an `observational` read under bounded staleness; memory's key that
  checks `READY` only; and a release without the lock, which showed the lock protected nothing
  there (L4 and X9 above).

A second reviewer read this README as a beginner would. It found "paid" used for a payment that is
only drafted, and "the second danger is time" where the danger is a vendor DSoR could not see. It
found words with two meanings ("label", "draft", "the look", "key"), terms used before they were
defined, a new analogy of guards at a door, and a hotel room that clashed with step 24's booking.
And it found decisions that the review had changed without saying so. The word list, "drafted",
the order-tracking page, and a "Changed by the review" in each decision fix these.

### Left open on purpose

- **A draft is not counted as spent (D9).** Two drafts of one invoice can be made one after the
  other. The step that pays a draft must count the payments in flight then. Open question 136 asks
  what a proposal in flight commits.
- **Who may hear the address of a proposal in flight (D8).** DSOR-EXC-01 asks the refusal to name
  it, and DSOR-ERR-01b keeps an error from revealing what the caller may not read. Open question
  135.
- **Several resources in `exclusive_over` (D6),** open question 137, and **the version checked at
  line ⑨ as well as at the work (D13),** open question 138.
- **A vendor suspended between the read and the write (L3).** The connectors of step 34 and the
  write before the act of step 36 are where a read and a write meet.
- **A precondition converts no currency.** A comparison across currencies cannot be evaluated, so
  it is false, the restrictive answer. `payment.create`'s only money precondition compares an amount
  with zero in its own currency.
- **`dsor_in_flight` and `dsor_sum`** are still refused at start-up. This step counts in DSoR's own
  code.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-EXC-01 | A second proposal of one operation over a record with one in flight is refused with `CONFLICT`, naming the first | [§25.1](../../../specs/dsor/03-execution.md#251-in-flight-exclusivity) | Every state of flight, a person too, a dry run, a replay; ten at once on the database, one waits; the database's key behind the look. [`test/one-attempt.test.ts`](test/one-attempt.test.ts), [`test/one-attempt.db.test.ts`](test/one-attempt.db.test.ts) |
| DSOR-EXC-02 | A precondition over an available amount counts what proposals in flight commit as spent | [§25.1](../../../specs/dsor/03-execution.md#251-in-flight-exclusivity) | With no `exclusive_over`, a second attempt finds nothing left to pay, `READY` ones too; a release is not counted against itself, nor its dry run. [`test/left-to-pay.test.ts`](test/left-to-pay.test.ts) |
| DSOR-FRS-02a | Preconditions of `HIGH` and `CRITICAL` commands are read current, unless the contract permits bounded staleness | [§27](../../../specs/dsor/03-execution.md#27-freshness-and-consistency) | Start-up refuses observational, connector-defined, and bounded staleness with no age; a read 20 seconds old passes a 60-second bound, and one 90 seconds old is refused. [`test/preconditions.test.ts`](test/preconditions.test.ts) |
| DSOR-FRS-02b | A read less fresh than asked is `FRESHNESS_UNSATISFIABLE`, never a cache | [§27](../../../specs/dsor/03-execution.md#27-freshness-and-consistency) | A cached invoice or vendor, at a draft and at a release, where the payment waits. [`test/preconditions.test.ts`](test/preconditions.test.ts), [`test/release-vendor.test.ts`](test/release-vendor.test.ts) |
| DSOR-CTL-08 | A predicate that fails to evaluate is false | [§17.3](../../../specs/dsor/02-security.md#173-expression-language) | A vendor the accounts system does not list; a field no record has. [`test/preconditions.test.ts`](test/preconditions.test.ts) |
| DSOR-MOD-03 | Preconditions read only state DSoR reads itself, through its stores | [§4](../../../specs/dsor/01-model.md#4-authority-boundaries-and-precedence) | VENDOR-44 read through INV-1008's own link, in org_456 only; a request that names a vendor is refused at line ⑥. In part: the rules read DSoR's own reads since step 27. [`test/vendors.test.ts`](test/vendors.test.ts), [`test/preconditions.test.ts`](test/preconditions.test.ts) |
| DSOR-CON-01b | A request decided on another version than DSoR read is `STALE_STATE` | [§23](../../../specs/dsor/03-execution.md#23-concurrency) | Since this step, at line ⑨ for every call and mode, before the preconditions and the look: a stale draft of INV-1005, a prepared one, a dry run, and a second attempt while the first waits. [`test/concurrency.test.ts`](test/concurrency.test.ts), [`test/modes.test.ts`](test/modes.test.ts), [`test/review.test.ts`](test/review.test.ts) |
| DSOR-APR-03a | The release re-evaluates the preconditions against `CURRENT` state | [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution) | VENDOR-44 read again at the release; a contract that permits bounded staleness still reads `current` there; a vendor approved again before the release lets it through. [`test/release-vendor.test.ts`](test/release-vendor.test.ts), [`test/review.test.ts`](test/review.test.ts) |
| DSOR-APR-03c | A precondition that fails at the release invalidates the proposal | [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution) | VENDOR-44 suspended after the approval, in memory and on the database; an invoice cancelled; a prepared payment. [`test/release-vendor.test.ts`](test/release-vendor.test.ts), [`test/release-vendor.db.test.ts`](test/release-vendor.db.test.ts) |

**Next:** step 33 · The decision bundle. One complete file per decision: which rules ran, which
records were read at which versions, which exchange rate was used, who approved.
