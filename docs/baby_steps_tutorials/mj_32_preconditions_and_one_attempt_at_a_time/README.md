# Step 32 · Preconditions and one attempt at a time

**New in this step:** before a payment is drafted, DSoR checks what must be true right now: the
invoice is issued, the vendor is approved, and something is left to pay. Only one attempt may be
open on an invoice at a time.

## In plain words

A pilot's checklist has items about the aircraft, and items about the world right now: is the
runway clear? DSoR's checklist has both kinds too. Its rules and limits say who may pay how much.
Its *preconditions* say what must be true of the records right now: INV-1008 is issued, its vendor
VENDOR-44 is approved, and some of INV-1008 is still unpaid. Each precondition is one line of CEL,
the small language of conditions from step 27, written in the operation's contract. DSoR reads the
invoice and the vendor itself, fresh, and never takes the caller's word for them.

The second idea is one attempt at a time. While one request to pay INV-1008 waits for the CFO, a
second request to pay INV-1008 is refused, and DSoR names the one that waits. It is like booking
the last hotel room: while one booking for the room is open, a second booking for the same room is
refused. And when DSoR works out how much of an invoice is left to pay, it counts the payments
already waiting as spent.

## Why it matters

On Tuesday the agent asks to pay INV-1008, 31,400.00 USD, to VENDOR-44. It waits for the CFO, by
the CFO's rule. The agent is told so, and, trying to help, asks again with a new idempotency key.
In step 31 both requests wait. The CFO approves both, and the agent releases both. This was run on
step 31's code before this step began: PAY-901 and PAY-902 were drafted, 31,400.00 USD each, for
one invoice: 62,800.00 USD to VENDOR-44 through a perfectly legal path. §25.1 of the specification
tells this story.

The second danger is time. On Wednesday cfo_100 approves INV-1008. On Thursday the accounts team
suspends VENDOR-44 after a fraud alert. On Friday the agent releases INV-1008. Step 31 checks
again at the release, but DSoR keeps no vendor record, so it cannot see the suspension, and it
pays. §4 of the specification warns of this: "Yesterday a human suspended that vendor."

## The design, before any code

The circled numbers are lines of DSoR's checklist, as in step 31. Line ⑦ claims the idempotency
key, line ⑧ makes the proposal, or, for a release, loads it. Line ⑨ is DSoR's own look before any
work: it reads the records the contract binds. Line ⑩ checks the rules and the limits.

Words this step uses:

- **A precondition.** A condition, written in CEL in the contract, that must hold on the records
  DSoR read, or the command does not run. A *control* (step 27) is the company's rule about who
  may do what. A precondition is about the records: is this invoice still owed?
- **In flight.** A proposal is in flight while it is `READY`, `PENDING_APPROVAL`, `APPROVED`,
  `EXECUTING`, or `OUTCOME_UNKNOWN` (§25.1): it may still run, or it is running.
- **Bound state.** The records line ⑨ reads for a command, named in the contract's `bind`. Since
  step 24, `payment.create` binds the invoice its input names. Now it binds the invoice's vendor
  too.
- **A label.** Each read says how fresh it is: `current`, read from the system just now, or older
  (step 15's freshness labels).

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
  that loses its precondition drafts for a draft invoice. Break B5 shows it.
- **D4. A precondition that does not hold answers `CONFLICT`,** before any rule is asked and
  anything is booked: §28 keeps `CONFLICT` for business-rule conflicts. The words name the first
  one that fails, in the contract's order. One that cannot be evaluated, such as a vendor that is
  not in the table, is false (DSOR-CTL-08), and the words say so. The proposal ends `DENIED`, and
  the record says `DENY`. *Downside:* the caller learns which condition failed, such as that the
  vendor is not approved.
- **D5. Every bound read must be as fresh as the contract asks.** `payment.create` asks
  `current`. A read with a weaker label is refused with `FRESHNESS_UNSATISFIABLE`, and DSoR does
  not fall back to a cache (DSOR-FRS-02b). Start-up refuses a `HIGH` or `CRITICAL` command whose
  preconditions ask less than `current`, unless they ask `bounded_staleness` with a
  `max_age_seconds` (DSOR-FRS-02a). *Downside:* this holds every command to its own contract, not
  only the `HIGH` and `CRITICAL` ones the rule names.
- **D6. One attempt per invoice:** `payment.create`'s contract says
  `"in_flight": { "exclusive_over": ["invoice"] }`. This tutorial allows one alias at most, and
  only an alias bound from the input. *Downside:* the schema allows a list, and a command over two
  records would need a second key.
- **D7. The look takes the invoice's lock first.** Inside the claim, line ⑨ takes a lock for this
  operation and this invoice, alone, and holds it until the claim ends. Then it looks for another
  proposal in flight. A release takes the same lock, so a new attempt and a release over one
  invoice go one at a time. A dry run looks without a lock. The database keeps a key too: two
  proposals in flight for one operation and one invoice cannot both be written. *Downside:* two
  attempts on one invoice wait for each other, though only one can win.
- **D8. The refusal names the proposal that waits, and its state:** `invoice INV-1008 has an
  attempt in flight already: proposal prop_…, PENDING_APPROVAL`. The second proposal ends `DENIED`,
  and the record says `DENY`. *Downside:* a second agent of the same company learns the address of
  the first agent's proposal.
- **D9. What is left to pay** is the invoice's open amount, minus each of its payments drafted and
  not cancelled, never below zero. If another proposal in flight spends the invoice, nothing is
  left: `payment.create` drafts all that is left, so it commits all of it (DSOR-EXC-02). Counting
  the drafts is this tutorial's own: no step pays a draft yet, so a draft is a payment that waits.
  *Downside:* a draft nobody cancels holds the invoice for ever.
- **D10. The draft is for what is left.** The code works the amount out the same way, and the
  store refuses a draft of any other amount than line ⑨'s. *Downside:* one sum, worked out in two
  places.
- **D11. At the release, line ⑨ runs again in full:** the reads and their freshness, the lock, and
  the preconditions on the invoice and the vendor as they are now. The proposal being released is
  in flight itself, so it is left out of its own count. A precondition that fails invalidates
  (DSOR-APR-03c). A read that is not fresh enough leaves the proposal waiting, as step 31's D15
  does. *Downside:* a vendor suspended for an hour by mistake sends the payment back to be drafted
  and approved again.
- **D12. The program tells three scenes.** The agent asks twice for INV-1008: the second is refused,
  naming the first. VENDOR-44 is suspended after cfo_100's approval, and the release invalidates.
  INV-1002 is drafted, a second draft finds nothing left to pay, and after the first is cancelled
  it is drafted again. *Downside:* a longer program run to read.

### The story's numbers

| When | Who | Asks | DSoR answers |
|---|---|---|---|
| Tuesday | the agent | drafts INV-1008, 31,400.00 USD | `PENDING_APPROVAL`, for the CFO |
| Tuesday | the agent | drafts INV-1008 again, with a new key | `CONFLICT`, naming the proposal that waits. The second proposal is `DENIED` |
| Wednesday | cfo_100 | approves INV-1008 | `APPROVED` |
| Thursday | the accounts team | suspends VENDOR-44 | (in the accounts system) |
| Friday | the agent | releases INV-1008 | `APPROVAL_INVALIDATED`: the vendor is not approved. The proposal is `INVALIDATED`, and its 31,400.00 USD goes back to the day |
| Tuesday | the agent | drafts INV-1002, 8,900.50 USD | `COMMITTED`, a payment drafted |
| Tuesday | the agent | drafts INV-1002 again | `CONFLICT`: nothing is left to pay |
| Tuesday | user_123 | cancels that payment, then the agent drafts INV-1002 again | `COMMITTED`, a new payment drafted |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | The contract's preconditions run at line ⑨, on what DSoR read: an invoice that is not issued, a vendor that is not approved or not there, nothing left to pay. Each is `CONFLICT`, `DENY`, before any booking; a dry run hears the same (DSOR-MOD-03, DSOR-CTL-08) |
| C2 | One attempt at a time: a second `payment.create` over an invoice with one in flight is `CONFLICT`, naming it, in every state of flight; one that ended frees the invoice; two at once on the database make one proposal (DSOR-EXC-01) |
| C3 | What is left to pay counts the payments waiting: drafts, and proposals in flight; a cancelled draft frees its amount; the draft is for what is left (DSOR-EXC-02) |
| C4 | Freshness: a bound read weaker than the contract asks is `FRESHNESS_UNSATISFIABLE`; start-up refuses a `HIGH` or `CRITICAL` contract that asks less than `current` (DSOR-FRS-02a, DSOR-FRS-02b) |
| C5 | The release checks the preconditions again: VENDOR-44 suspended after the approval makes the proposal `INVALIDATED`; the proposal is not counted against itself (DSOR-APR-03a, DSOR-APR-03c) |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. The look for a proposal in flight is gone | the second attempt on INV-1008 is still refused, by the count of what is left to pay: two guards hold one door | (asked at the review) |
| B2. The release does not read the vendor again | INV-1008 is paid to a suspended VENDOR-44 | (asked at the review) |
| B3. Drafts are not counted | INV-1002 is drafted twice, 8,900.50 USD each | (asked at the review) |
| B4. The proposal being released counts against itself | INV-1008's own release finds nothing left to pay, and is `INVALIDATED` | (asked at the review) |
| B5. `payment.create` loses its precondition on the invoice's status | INV-1005, a draft invoice, gets a payment | (asked at the review) |

### Left open, and not this step's idea

- `dsor_in_flight` and `dsor_sum`, Appendix B's functions for amounts in flight: this step counts
  them in DSoR's own code, and a condition that calls either is still refused at start-up.
- Holding a resource when an outcome is unknown (`hold_on_unknown`): step 37.
- A vendor's payment details changing, and new vendors (`dsor_is_new_counterparty`): later steps.
- The decision bundle that names every record version read: step 33.

The rest of this README is written as the step is built.
