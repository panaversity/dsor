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

**Next:** the build, piece by piece, with each piece's tests written first.
