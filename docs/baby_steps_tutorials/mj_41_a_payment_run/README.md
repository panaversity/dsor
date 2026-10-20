# Step 41 · A payment run

**New in this step:** a payment run, many drafts proposed as one list. Each line keeps its own
checks and its own record. The day's limit is booked once, for the run's total. The CFO approves
the list once, with its fingerprint and its totals, and the run drafts every line, or none
(DSOR-BAT-01a, DSOR-BAT-01b, DSOR-BAT-02a, DSOR-BAT-02b).

## In plain words

A *payment run* is a list of bills that the agent asks to draft together, as one unit. Each bill
in the list is a *line*. Until now, the agent drafted bills one call at a time, with
`payment.create`. In this step it can send one `payment.run` with up to 50 lines.

DSoR still checks each line as it checks a single draft: the bill, its vendor, its version, the
CFO's rule, and the limit for one payment. Then it adds up the lines. The day's limit is checked
once, against the run's total. If any line fails, or the total does not fit, the whole run is
refused, and nothing is drafted.

When a line is above 25,000 USD, the run waits for cfo_100. She approves the whole list once. Her
approval carries the list's *fingerprint*, a SHA-256 hash over its lines in their order, and the
*totals* she saw, per currency and per vendor. If one line changes, the fingerprint changes. If one
bill's amount changes, the totals change. Either way, her approval no longer matches.

**Words this step uses.** A *proposal* is DSoR's record of one command and its state (step 22). A
*claim* is the hold DSoR takes on a request's idempotency key, and a command's work runs inside
the claim's one database transaction (steps 20 and 36b). A *booking* is the amount a proposal
takes from its slip's limit for one day (step 24). A *release* is `proposal.execute`, which runs a
proposal that waited (step 31).

## Why it matters

A real run on 2026-10-20, on step 40c's own code, in a scratch copy. This week org_456 has 37
issued bills, 430,845.50 USD in all, from VENDOR-44, VENDOR-12, and VENDOR-31. The bills
INV-3001 to INV-3037 are made up for this run; the story's six bills are too few. Today the only
way to draft them is one call each, so `accounts-payable-fte` calls `payment.create` 37 times,
under del_100, with its limits of 50,000 USD a payment and 200,000 USD a day:

```text
the week: 37 issued bills of org_456, 430,845.50 USD
accounts-payable-fte, under del_100 (50,000 a payment, 200,000 a day), drafts each with payment.create:
  INV-3001 VENDOR-44 4,200.00 USD: COMMITTED
  INV-3002 VENDOR-12 12,850.00 USD: COMMITTED
  INV-3003 VENDOR-31 640.00 USD: COMMITTED
  INV-3005 VENDOR-12 27,300.00 USD: PENDING_APPROVAL
  INV-3008 VENDOR-44 31,400.00 USD: PENDING_APPROVAL
  INV-3012 VENDOR-12 42,000.00 USD: PENDING_APPROVAL
  INV-3016 VENDOR-44 26,500.00 USD: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one day
  INV-3037 VENDOR-12 9,450.00 USD: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one day
  (the other lines are shortened)
what the 37 calls ended as: {"COMMITTED":16,"PENDING_APPROVAL":3,"LIMIT_EXCEEDED":18}
drafted or waiting: 198,950.50 USD of 430,845.50; the first refused: INV-3016
left with no draft, by vendor: {"VENDOR-44":"107,800.00","VENDOR-12":"114,950.00","VENDOR-31":"9,145.00"}
cfo_100's inbox: 3 separate approvals. One of them, as the proposal holds it:
  {"operation":"payment.create@1","payload":{"invoice":"dsor://org_456/invoice/INV-3005","expected_version":1},"payload_hash":"sha256:1d63a6773a609…"}
  cfo_100 approves INV-3005: COMMITTED APPROVED
  cfo_100 approves INV-3008: COMMITTED APPROVED
  cfo_100 approves INV-3012: COMMITTED APPROVED
nothing in any approval names the run, its 37 lines, or its totals.
```

Three things went wrong:

1. **The order of the calls decided who was paid.** The first bills used the day's 200,000 USD, and
   18 bills were refused after them, small ones too. Nobody chose to leave VENDOR-12 with
   114,950.00 USD unpaid. Its bills sat late in the list.
2. **The CFO never saw the week.** cfo_100 approved three single drafts, each naming one invoice.
   No approval showed the 37 lines, the total, or how much goes to each vendor.
3. **Nobody could ask "may I draft this list?"** DSoR had no list to check against the day's limit
   before anything was drafted. The week ended half done, and the agent found out at bill 16.

**Common mistake:** approving a run by its total only. The CFO sees "430,845.50 USD", approves,
and the agent then drafts a list with one bill swapped for another of the same amount. The total
still matches. The fingerprint of the ordered lines is what catches the swap. The totals catch a
changed amount. A run's approval needs both.

## The design, before any code

### How this step was made

On 2026-10-20, right after step 40c, the learner started step 41. Claude Code showed the run above,
then asked, one question at a time. The learner made the decisions D1 to D7. Checking the design
against the rules then found D8 to be a second idea, DSOR-APR-12, which holds for every proposal.
The learner moved it to a step of its own, 41b.

### What the rules say

From [§8](../../../specs/dsor/01-model.md#8-batch-operations):

- **DSOR-BAT-01a:** "A batch command MUST declare its atomicity (`all_or_nothing` or `per_item`) and
  a maximum item count."
- **DSOR-BAT-01b:** "Each batch item MUST have its own derived idempotency key, control evaluation,
  and recorded outcome."
- **DSOR-BAT-02a:** "Approval of a batch MUST bind to a manifest hash over the ordered canonical item
  payloads and to the batch totals per currency and per counterparty."
- **DSOR-BAT-02b:** "Cumulative limits MUST be evaluated atomically against the batch total."
- §8 adds: "A changed manifest is a new proposal (§26.1), so an approval can never carry over to
  it."

DSOR-BAT-01c (a partial run answers `BATCH_PARTIAL`) and DSOR-BAT-02c (a refused line is shown to
the approver) are for runs that let some lines through. This step's runs are all or nothing (D2),
so neither applies yet.

### The claims

| Claim | What it says |
|---|---|
| C1 | `payment.run`'s contract declares `all_or_nothing` and at most 50 lines. A run of 51 lines, or one that names one bill twice, is refused before any bill is read |
| C2 | Each line is its own `payment.create` proposal, tied to its run, with a key that DSoR derives from the run's key and the line's invoice. Each line passes its own checks at lines ⑨ and ⑩: the bill and its vendor, the version, one attempt at a time, the CFO's rule, and the limit for one payment. Each line's moves are recorded |
| C3 | All or nothing. A line that fails its check refuses the whole run before anything is drafted: the run and every line end `DENIED`, and the answer names the line. A run that passes drafts every line in one transaction, each with its `payment.created`, or none |
| C4 | The day's limit is booked once, for the run's total, keyed by the run, in the run's transaction. A total that would pass the day's limit refuses the whole run |
| C5 | The run's proposal keeps its fingerprint and its totals per currency and per vendor, which DSoR adds up from the bills it read. An approval of a run carries the payload hash, the fingerprint, and the totals. If any of the three differs, the approval is refused with `APPROVAL_MISMATCH`, and the run still waits |
| C6 | A run waits for the CFO when any of its lines would. One approval of the run approves every line. A line is never approved or released alone |
| C7 | While a run waits, each line holds its invoice: a single draft of that invoice is refused with `CONFLICT` |
| C8 | At the release, each line is checked again, and the totals are added up again from the bills as they are now. Any difference voids the run and every line, `INVALIDATED`, and the booking is given back |
| C9 | What it does not do: change a run that waits (step 41b); send the drafts to the bank, which stays one `payment.execute` per payment; let some lines through (DSOR-BAT-01c, DSOR-BAT-02c); or judge a run's total by a rule of its own |

### Decisions

- **D1. A run drafts its lines only** (the learner's). Sending each draft to the bank stays a
  `payment.execute` of its own. The CFO's rule and the day's limit act on drafting, and drafts live in
  DSoR's own database, so a run can draft every line in one transaction. The other ways were to
  draft and send, which cannot be all or nothing because a bank payment cannot be taken back, and to
  send drafts already made, which leaves today's problem in place. *Downside:* after the approval,
  someone still sends each payment one by one.
- **D2. All or nothing** (the learner's). One bad line refuses the whole run before anything is
  drafted, and the answer names it. The agent removes the line and proposes again: a new list, which
  the CFO approves again. The other way was each line on its own, which drafts a list nobody
  approved. *Downside:* one bad line delays every good one until the agent proposes again.
- **D3. At most 50 lines** (the learner's). The week's 37 fit, and a person can still read 50
  lines. *Downside:* a week of 60 bills is two runs and two approvals.
- **D4. The approval carries the fingerprint and the totals** (the learner's). cfo_100 states both
  the lines and the money she approved. DSoR compares both, and at the release it reads the bills and
  adds them up again. The other ways were the fingerprint only, which leaves no trace of the totals
  she saw, and amounts inside the fingerprint, which no person can check. *Downside:* her screen
  must send the totals exactly as shown.
- **D5. Each line is its own proposal** (the learner's): a `payment.create` proposal, tied to its
  run. It gets what a single draft has: its state, its record of each move, its `payment.created`,
  and its hold on its invoice. The other way was to keep the lines inside the run's proposal, where
  step 32's guard against two attempts at one invoice does not reach. *Downside:* a run of 37 lines
  makes 38 proposals, and the run must move its lines with it.
- **D6. A line's key is derived from the run's key and the line's invoice** (the learner's). A run
  sent again with the same key gives every line the same key, so nothing is drafted twice. A run that
  names one invoice twice is refused. The other ways were the run's key and the line's position, and
  a key from the agent for each line. *Downside:* a line's key is a long hash, not a word a person
  reads.
- **D7. A run waits for the CFO when any line would** (the learner's). A run asks exactly what its
  lines would ask alone. The other ways were to make every run wait, and to add a rule on the run's
  total, a second new idea. *Downside:* 37 lines of 24,000 USD need no approval, as 37 single drafts
  need none today; the day's limit still caps the agent.
- **D8. A new run that replaces a waiting one** (the learner's, moved to step 41b). Step 41 builds
  nothing for it. A run that waits holds its invoices until it is approved and released, or until it
  expires.

### Found while checking the design

- **Every approval carries `payload_hash`.** DSOR-APR-09 refuses an approval whose `payload_hash`
  differs from the proposal's. So a run's approval carries it too, beside the fingerprint and the
  totals of D4. For a run, both hashes are over its lines; the rules ask for both, so both are kept.
- **The specification's proposal has no place for totals per vendor.** `proposal.schema.json` has
  `manifest_hash`, and `totals` as a list of amounts, one per currency. DSOR-BAT-02a also asks for
  totals per counterparty, and the schema has no field for them. This tutorial keeps them in a field
  of its own, `vendor_totals`, and records the gap as a question for the specification.
- **Today a waiting proposal cannot be withdrawn.** No `proposal.cancel` exists, and DSOR-APR-12 is
  not built. With D5, each line of a waiting run holds its invoice. So D8 was needed, and it is a
  second idea: step 41b.

### This tutorial's decisions, where the rules are silent

- **The run's input** is `{ "lines": [ { "invoice": …, "expected_version": … }, … ] }`, each line the
  input of one `payment.create`, and nothing else. No amount, no vendor, no key: DSoR reads and
  derives those itself.
- **The fingerprint** is `payloadHash` over the list of lines, in order: the same SHA-256 over
  canonical JSON that every proposal's `payload_hash` uses.
- **A run needs the permission to draft**, `payment:create`, and its approval needs `payment:approve`,
  as one draft's does.
- **A line waits for what its run waits for.** A line moves with its run: `PENDING_APPROVAL`,
  `APPROVED`, `EXECUTING`, then `COMMITTED`, or `DENIED`, `INVALIDATED`, or `FAILED` together.

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | The contract declares both; start-up refuses a batch contract without them; 51 lines, or one bill twice, are refused with `VALIDATION_FAILED`, and no proposal is made |
| C2 | A run of three lines makes four proposals; each line is a `payment.create` proposal naming its run, with the derived key; the same run sent again with the same key makes no new line; the run's record names each line's controls |
| C3 | A suspended vendor on line 2 refuses the run with the line named, and nothing is drafted; a run that passes drafts every line, each with its `payment.created`; a draft that fails on line 3 at the release leaves lines 1 and 2 undrafted |
| C4 | A run whose total passes the day's limit is refused whole, and nothing is booked; a run that fits books its total once, under the run's id, and no line books |
| C5 | An approval with the right three is counted; a wrong fingerprint, wrong totals, or wrong vendor totals are each refused with `APPROVAL_MISMATCH`, and the run still waits |
| C6 | A run with one line above 25,000 waits; a run of small lines is drafted at once; approving the run moves every line to `APPROVED`; approving or releasing a line alone is refused |
| C7 | While a run waits, `payment.create` of one of its bills is refused with `CONFLICT`, naming the line |
| C8 | A bill's amount changed after the approval, or a vendor suspended, voids the run and every line at the release, gives the booking back, and drafts nothing |

The same tests run against PostgreSQL where the database holds the rule: the line proposals and
their key, the one booking, and the drafts in one transaction.

### The learner's predictions

Asked before the build, as stories. A real run settles each one after the build.

| | The story | The learner's answer |
|---|---|---|
| P1 | `accounts-payable-fte` proposes the whole week as one run: 37 lines, 430,845.50 USD, under del_100. What does DSoR answer, and how many drafts exist after? | Refused, no drafts |
| P2 | A run of 12 lines, 187,250.00 USD, waits for cfo_100. Her screen was wrong and showed 186,250.00. She approves with the right fingerprint and the totals she saw. What does DSoR answer, and what state is the run in after? | Mismatch, still waits |
| P3 | While that run waits, user_123 drafts INV-3008, one of its lines, alone with `payment.create`. What does user_123 hear, and how many drafts of INV-3008 exist after? | Refused, none |
| P4 | cfo_100 approved the 12-line run. Before the release, the accounts team suspends VENDOR-31, the vendor of one line. The agent releases the run. What happens, and how many lines are drafted? | Whole run void, none |

### The breaks

| Break | What it removes |
|---|---|
| B1 | The day's limit is not checked for a run |
| B2 | A line that fails is skipped, and the other lines go on |
| B3 | An approval's totals are not compared, only its fingerprint |
| B4 | The fingerprint sorts the lines before hashing, so their order is lost |
| B5 | A line holds no invoice while its run waits |
| B6 | The release checks the run, and not each line again |
| B7 | The release compares the approval's totals with the stored ones, and does not add up the bills again |
| B8 | Every line of a run gets the run's own key |
| B9 | A line may be approved alone |
| B10 | The most lines a run may hold is not checked |

## What changed since step 40c

| File | What changed |
| --- | --- |
| `contracts/payment.run.json`, `inputs/PaymentRunRequest.schema.json`, `examples/payment.run.json` | **New.** The run's contract, with its batch, all or nothing and 50 lines, and the operation its lines are; its input, the lines and nothing else; its example (C1) |
| `src/run.ts` | **New.** Start-up's check of a run's contract; line ⑥'s check of its length and of a bill named twice; a line's derived key; the totals per currency and per vendor (C1, C2, C5) |
| `src/pipeline.ts` | A run at lines ⑧ to ⑩: each line's proposal, its checks, the one booking of the total, the denial of the whole run; its work, which drafts every line in the claim's one transaction; its check again at the release; and its lines' moves with it (C2 to C4, C6 to C8) |
| `src/approve.ts`, `inputs/ProposalApproveRequest.schema.json`, `examples/proposal.approve.json` | A run's approval carries its fingerprint and its totals, compared last; a line is never approved alone; the run approved moves its waiting lines (C5, C6) |
| `src/proposals.ts`, `src/postgres.ts`, `migrations/044_payment_runs.sql`, `store.json` | **New migration.** A line's run and a run's fingerprint, written with the proposal; a run's totals, written once when it starts to wait; a run's lines, listed; the trigger's rules for each, and the map's privileges (C2, C5) |
| `src/limits.ts` | The day's limit for a run: every line's amount converted as one draft's is, added up, and booked once, keyed by the run (C4) |
| `src/claims.ts` | Memory's claim undoes every proposal an accident's call made, a run's lines too (C3) |
| `src/registry.ts`, `classifications.json` | Start-up runs the run's check; a drafted run's answer, its payments, is labelled |
| `src/main.ts` | The story's scene of a payment run |
| `test/run.test.ts`, `test/run.db.test.ts`, `test/owner-run-bills.ts`, `test/db.ts` | **New.** The claims in memory and on PostgreSQL; the owner's program that adds the runs' own bills |
| `test/cross-tenant.test.ts`, `test/cross-tenant.db.test.ts`, `test/modes.test.ts`, `test/contract.test.ts`, `test/registry.test.ts`, `test/startup.test.ts`, `test/semantics.test.ts`, `test/classifications-file.test.ts`, `test/program.db.test.ts`, `test/audit.db.test.ts`, `test/catalogs.ts`, `test/store-map.test.ts` | The earlier tests that list every contract, every attack, and every privilege name the run. Each says "Changed in step 41" |

```bash
git diff --no-index ../mj_40c_one_bad_event_does_not_block/src src
git diff --no-index ../mj_40c_one_bad_event_does_not_block/test test
git diff --no-index ../mj_40c_one_bad_event_does_not_block/migrations migrations
```

## Run it

As in step 40c: a local PostgreSQL 17 and a new database of its own. Migration 044 is new.

```bash
pnpm install
pnpm migrate
pnpm test:db test/run.db.test.ts
pnpm start          # the story; its last scene is a payment run
```

`pnpm start` ends with the run's scene, in memory. In that world PAY-901 is the first payment
drafted, of INV-1002, not the story's PAY-901 of INV-1008:

```text
a payment run, in memory, in a world of its own:
  the agent proposes INV-1002, INV-1008, and INV-1006 as one run:
    PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
    it keeps its fingerprint, sha256:111abbaa9bf7…, its total, 40940.50 USD, and per vendor: VENDOR-31 640.00, VENDOR-44 40300.50
    its lines wait: INV-1008 PENDING_APPROVAL, INV-1002 READY, INV-1006 READY
  cfo_100's screen showed 39,940.50 USD; she approves with it: APPROVAL_MISMATCH: the totals are not run prop_5a8052ff-…'s
  she approves with the run's own totals: answered, apr_92ce8c8e-…
  the agent releases the run: COMMITTED, PAY-901 of INV-1002, PAY-902 of INV-1008, PAY-903 of INV-1006
```

(The two ids are shortened here.)

## Break it

### The learner's predictions, run for real

A real run on 2026-10-20, on this step's own code, in memory, in a copy. The week's 37 bills of
"Why it matters" are added to the world. P2 to P4 use 12 of them, 187,250.00 USD in all: INV-3008
is among them, and three of VENDOR-31's. The words are DSoR's own; the ids are this run's:

```text
P1. accounts-payable-fte proposes the whole week as one run, 37 lines, 430,845.50 USD:
  DSoR answers: LIMIT_EXCEEDED: "payment.run" would pass slip del_100's limit for one day
  drafts: 0; bookings held: 0
  the run DENIED; its lines: 37 DENIED

P2. A run of 12 lines, INV-3003, INV-3005, INV-3006, INV-3007, INV-3008, INV-3010, INV-3012, INV-3023, INV-3031, INV-3032, INV-3035, INV-3036:
  DSoR answers: PENDING_APPROVAL
  the run keeps: totals [{"value":"187250.00","currency":"USD"}]
  cfo_100 approves with the right fingerprint and the totals her screen showed, 186,250.00 USD: APPROVAL_MISMATCH: the totals are not run prop_d6ec481c-9089-4672-829a-5d7facaa0115's
  after: the run PENDING_APPROVAL; its lines: 9 READY, 3 PENDING_APPROVAL

P3. While the run waits, user_123 drafts INV-3008 alone with payment.create:
  DSoR answers: CONFLICT: invoice INV-3008 has an attempt in flight already: proposal dsor://org_456/proposal/prop_cc879011-9517-4096-a647-401232ad3ecd, PENDING_APPROVAL
  drafts of INV-3008: 0

P4. cfo_100 approves the run with what the run keeps; then the accounts team suspends VENDOR-31; the agent releases:
  cfo_100 approves: APPROVED
  DSoR answers: APPROVAL_INVALIDATED: proposal prop_d6ec481c-9089-4672-829a-5d7facaa0115 is INVALIDATED: CONFLICT: line 1 of "payment.run": a precondition of payment.create does not hold: state.vendor.status == "approved"
  drafts: 0; the run INVALIDATED; its lines: 12 INVALIDATED
  the run's booking: released
```

| | The learner's answer | What the run shows |
|---|---|---|
| P1 | Refused, no drafts | Right: `LIMIT_EXCEEDED` for the whole run. The run and its 37 lines are `DENIED`, and no booking is held |
| P2 | Mismatch, still waits | Right: `APPROVAL_MISMATCH` on the totals, and the run and its three CFO lines still wait |
| P3 | Refused, none | Right: `CONFLICT`, naming the line that holds INV-3008, and no draft of it |
| P4 | Whole run void, none | Right: `APPROVAL_INVALIDATED`, naming line 1, the first of VENDOR-31. The run and all 12 lines are `INVALIDATED`, nothing is drafted, and the booking is given back |

All four were right.

### The breaks

Each break was run for real, in a copy of this step on a new database: change one thing, migrate,
run `test/run.test.ts` and `test/run.db.test.ts`, and count the tests that fail. A break is caught
when at least one fails. With no break, none fails.

| Break | What it changes | Unit tests that fail | Database tests that fail |
|---|---|---|---|
| B1 | The day's limit is not checked for a run | 4 | 3 |
| B2 | A line that fails is skipped, and the other lines go on | 1 | 0 |
| B3 | An approval's totals are not compared, only its fingerprint | 1 | 1 |
| B4 | The fingerprint sorts the lines before hashing, so their order is lost | 1 | 0 |
| B5 | A line holds no invoice while its run waits | 1 | 1 |
| B6 | The release checks the run, and not each line again | 2 | 1 |
| B7 | The release compares the approval's totals with the stored ones, and does not add up the bills again | 1 | 0 |
| B8 | Every line of a run gets the run's own key | 1 | 1 |
| B9 | A line may be approved alone | 1 | 0 |
| B10 | The most lines a run may hold is not checked | 1 | 0 |

Five more were added while building, for the parts the design's list did not reach:

| Break | What it changes | Unit tests that fail | Database tests that fail |
|---|---|---|---|
| B11 | Migration 044: a run's totals may change after it starts to wait | 0 | 0, then 1 |
| B12 | Migration 044: a line's run, or a run's fingerprint, may change | 0 | 0, then 1 |
| B13 | Migration 044: a line may be made for any run, at any time | 0 | 0, then 1 |
| B14 | The database's store does not write a run's totals | 0 | 9 |
| B15 | Memory's claim undoes only the first proposal after an accident | 1 | 0 |

**B11 to B13 first left every test green.** The tests changed those columns as `dsor_runtime`, and
something else refused first: `dsor_runtime` holds no right to update a run or a fingerprint, and
the trigger refuses an update that is not a move. So each rule got a test of its own: a move that
also rewrites the totals; the owner's own change of a line's run or a run's fingerprint, through
`test/owner-runs.ts`; and a line added to a run that waits, to a draft, or to no run. Run again
with them, each break is caught.

Memory and the database share the run's code, so a break in that code is caught where its test
runs: B2, B4, B7, B9, and B10 by the unit tests.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real run of step 40c's code: 37 bills, one call each |
| 2 | Decide | Seven decisions by the learner, D1 to D7; the learner moved D8 to step 41b |
| 3 | Predict | P1 to P4, asked as stories before any code |
| 4 | The copy | Step 40c copied, its markers removed |
| 5 | Build, piece by piece | Five pieces, each with its tests written first and seen red: the run's shape; proposing a run; approving it; releasing it; the database |
| 6 | Earlier tests | The lists of contracts, attacks, privileges, and columns |
| 7 | Break it | P1 to P4, then the breaks, for real |
| 8 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 41 in learner mode from the design in
docs/baby_steps_tutorials/mj_41_a_payment_run/README.md.
```

## Check yourself

1. Why can a run that drafts be all or nothing, and a run that sends money cannot?
2. The agent proposes 37 bills one call at a time, and the day's limit stops it at bill 16. What
   does a run change?
3. cfo_100 approves a run. Why does her approval carry the totals as well as the fingerprint?
4. A line of a waiting run waits `READY`, because no rule asks about it. Why can the agent not
   release that line alone?
5. Between the approval and the release, INV-1006's open amount changes, and its version does not.
   What does the release do, and how does it know?

<details>
<summary>Answers</summary>

1. A draft lives in DSoR's own database, so 37 drafts can be made in one transaction, which
   commits or rolls back whole. A payment the bank sent cannot be taken back (D1, D2).
2. The run is checked as a whole before anything is drafted: its total against the day's limit,
   once (DSOR-BAT-02b). If it does not fit, nothing is drafted, and no bill is left out because of
   where it sat in the list (C4, P1).
3. The fingerprint covers the lines, which name bills, not amounts. The totals are the money she
   approved. Both are bound, so a list she did not see, or money she did not see, is refused
   (DSOR-BAT-02a, D4, P2).
4. Its run is the unit the CFO approved. A line released alone would draft a list nobody approved,
   one line long (D2, D7).
5. It voids the run and every line, `INVALIDATED`, and drafts nothing. It adds the totals up again
   from the bills as they are now, and they no longer match the ones the approval bound (C8).

</details>

## Think it through

### Found while building

- **A vendor has no address in line ⑨'s read.** Line ⑨ keeps the address of each invoice and
  payment it binds, not of the vendor. So a run takes each line's vendor from the invoice line ⑨
  read, and writes its address itself.
- **Memory undid one proposal after an accident.** A call has made one proposal until now, so
  memory's claim undid only the first. A run makes one for each line, so its lines stayed
  `EXECUTING`, each holding its invoice. Memory now undoes every proposal the call made, as the
  database's rollback does.
- **A fixed idempotency key in a database test replayed an earlier test run.** The database keeps
  every claim, so the second run of the test was answered with a run made before the database kept
  fingerprints. DSoR was right to replay; the test now makes a key of its own each run.
- **The approval's example names a vendor now.** The cross-company suite attacks every field of an
  example, so it swaps the vendor of a run's totals too: 15 more attacks.
- **`bank.db`'s D7 fails on this machine**, alone too, as it does for step 40c's own code on its
  own database, 3 of 3. It is open question 158: the holds left by earlier runs slow every send.

### What the review found

The review is running.

### Left open on purpose

- **A run that waits cannot be changed** (D8): its lines hold their invoices until it is approved
  and released, or until it expires. Step 41b builds a new run that replaces a waiting one.
- **A run drafts and does not send** (D1). Each payment is still sent with a `payment.execute` of
  its own.
- **No run lets some lines through** (D2). DSOR-BAT-01c and DSOR-BAT-02c wait for a step that
  builds `per_item`.
- **The specification has no place for totals per vendor.** `proposal.schema.json`'s `totals` is a
  list of amounts per currency. This tutorial adds `vendor_totals`, and the question goes to the
  specification.
- **The run's decision record lists each line's controls in the order of the lines**, and does not
  name the line each came from. Each line's own proposal shows what its rule asked.
- **No rule judges a run's total** (D7).
- **The answer of a waiting run carries no fingerprint or totals**: `result-envelope.schema.json`
  has no field for them, and the approver reads them from the run's proposal, never through the
  agent.

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-BAT-01a | A batch command declares its atomicity and its most items | [§8](../../../specs/dsor/01-model.md#8-batch-operations) | `test/run.test.ts`, C1 |
| DSOR-BAT-01b | Each item has its own derived key, control evaluation, and recorded outcome | [§8](../../../specs/dsor/01-model.md#8-batch-operations) | `test/run.test.ts`, C2; `test/run.db.test.ts`, C2 |
| DSOR-BAT-02a | A batch's approval binds a manifest hash over its ordered items, and its totals per currency and per counterparty | [§8](../../../specs/dsor/01-model.md#8-batch-operations) | `test/run.test.ts`, C5 and C8; `test/run.db.test.ts`, C5 and C8 |
| DSOR-BAT-02b | Cumulative limits are evaluated atomically against the batch's total | [§8](../../../specs/dsor/01-model.md#8-batch-operations) | `test/run.test.ts`, C4; `test/run.db.test.ts`, C4 |

All or nothing, a line never approved or released alone, and a line's hold on its invoice are this
tutorial's rules: those tests are titled by step 41's decisions D2, D5, and D7.

**Next:** step 41b, a new run that replaces a waiting one.
