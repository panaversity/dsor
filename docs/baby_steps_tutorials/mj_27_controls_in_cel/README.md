# Step 27 · Controls in CEL

**New in this step:** a company's business rule, "payments above 25,000 USD need the CFO", becomes
a *control*: a condition written in CEL, with tests that must pass before it is switched on. Line
⑩ checks it on every payment.

## In plain words

Until now, DSoR enforced the limits on an agent's permission slip, and no rule of the company. In
this step, org_456's payment policy becomes a control in `controls.json`: a condition, an effect, a
human owner, the policy it came from, and its tests. Start-up runs the tests, and refuses to start
when one fails. On every `payment.create`, line ⑩ checks the condition: when it is true, the
payment waits for the CFO, and when it cannot be checked, it counts as true. The new clerk works
the same way, with a card for each of the company's rules on the desk.

## Why it matters

The agent drafts INV-1008, 31,400.00 USD. del_100 allows 50,000.00 USD for one payment, so step 26
pays it. But org_456's policy says that any payment above 25,000 USD needs the CFO. The policy lives
in KSoR, the record of what the company knows, and nothing in DSoR checks it. And the quick way to
write the rule, "the amount is over 25000 and the currency is USD", lets INV-2004 through without
the CFO: 14,000,000.00 PKR, which is 50,000.00 USD (§9).

## The design, before any code

The circled numbers are lines of DSoR's checklist, which every call runs through in order, as a
pilot runs through a checklist. ③ finds the agent's slip, ⑤ checks the caller's permission, ⑧
makes the proposal, ⑨ is DSoR's own look at the state before any work, and ⑩ checks the controls
and the limits.

### How this step was made

The understanding session of 2026-10-11 covered two parts: what a control is, and CEL with the PKR
hole. Then the learner asked for the build first, and the review after. So every decision below is
Claude Code's, for the learner to review, and each one says what it costs.

### What each rule says

- **DSOR-CTL-01a:** a control must pass `control.schema.json`: a version, a condition, an effect, a
  status, a named human owner, and an authority reference, which points at the policy it came from
  ([§17.2](../../../specs/dsor/02-security.md#172-control-record)).
- **DSOR-CTL-05:** a condition is written in CEL, and evaluated in the environment of
  [Appendix B](../../../specs/dsor/appendix-b-cel.md): eight variables and the `dsor_*` functions
  ([§17.3](../../../specs/dsor/02-security.md#173-expression-language)). CEL is a small language
  for conditions. It cannot loop for ever, cannot call the network, and sees only what DSoR gives
  it.
- **DSOR-CTL-07:** when a condition fails to evaluate, the control's effect applies.
- **DSOR-CTL-02c:** switching a control on runs its tests, and fails when one fails
  ([§17.4](../../../specs/dsor/02-security.md#174-lifecycle-and-drift)).
- **DSOR-AUT-02a:** checks can answer at least `ALLOW`, `DENY`, and `REQUIRE_APPROVAL`
  ([§15](../../../specs/dsor/02-security.md#15-authorization)).
- **DSOR-AUT-02b:** when several checks apply, the most restrictive answer wins: `DENY` over any
  `REQUIRE_*`, and any `REQUIRE_*` over `ALLOW`.
- **DSOR-EXE-02**, met since step 08: the decision's record names the controls evaluated
  ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline)). This step is the first with
  controls to name.

### Decisions (Claude Code)

- **D1. Controls live in `controls.json`, one list for each company,** each control a record that
  `control.schema.json` accepts. Start-up checks the file, as it checks `money-policies.json`.
  *Downside:* a new rule needs a restart. Step 28 gives controls a lifecycle that people drive.
- **D2. Start-up refuses to start when a control is broken or fails one of its tests.** A control
  that never became active would leave its rule unenforced, so DSoR does not run at all.
  *Downside:* one bad control stops DSoR for every company.
- **D3. Line ⑩ evaluates the controls whose status is `active` or `stale_authority`.** A stale
  control is never skipped (DSOR-CTL-03b, step 28's rule, kept early because it fails closed).
  `draft`, `in_review`, `suspended`, and `retired` controls are checked against the schema and CEL,
  and never evaluated. *Downside:* a draft's tests run only when it is switched on.
- **D4. The story's control governs `payment.create` and reads `state.invoice.open_amount`.** It is
  §17.2's `high-value-payment`, moved to the command and the bind this tutorial has: the spec's
  example names `payment.execute` and `state.payment.amount`. *Downside:* the spec's example does
  not run here as written.
- **D5. The environment gives all eight variables of Appendix B, and three of its six functions:**
  `dsor_money`, `dsor_exceeds`, and `dsor_covers`. Start-up refuses a condition that calls
  `dsor_sum`, `dsor_in_flight`, or `dsor_is_new_counterparty`, which later steps build, and one that
  names anything outside the environment (DSOR-CTL-06). *Downside:* rules that need those three
  wait.
- **D6. The money functions use step 26's rates:** the newest sheet of the company's source, fresh
  by the store's clock, both rates from that sheet. With no usable rate, the condition fails to
  evaluate, so the effect applies (DSOR-CTL-07, DSOR-MON-04). *Downside:* an old sheet stops every
  payment in another currency at the CFO.
- **D7. A test's pinned rates are per one unit of the company's `control_currency`,** as
  `control.schema.json` describes them. Step 26 checked that setting at start-up, and this step is
  the first to read it. *Downside:* a test cannot pin a rate between two other currencies.
- **D8. Two effects are built: `deny` and `require_approval`.** Start-up refuses `require_step_up`
  and `require_verification`, which DSOR-AUT-02a does not ask for. *Downside:* those two wait for a
  later step.
- **D9. At line ⑩ the controls come first, then step 24's limits.** A control's `DENY` refuses
  before anything is booked. A limit is a `DENY` too. A payment that needs an approval still books
  its amount against the day, and holds it while it waits (DSOR-DEL-06c). *Downside:* a payment
  that waits for the CFO holds its share of the day.
- **D10. A call that needs an approval stops at `PENDING_APPROVAL`,** in `execute` and
  `propose_only` modes. The work does not run. The answer is the result envelope's
  `PENDING_APPROVAL`, with what it `requires` (each control's role and quorum) and its `expires_at`,
  the proposal's own since step 25c. A replay gives the same answer. *Downside:* nothing can approve
  until step 29, so in this step such a payment waits until a tear-up or its expiry ends it.
- **D11. The sweep expires a `PENDING_APPROVAL` proposal past its time too,** and gives back its
  booking, as step 25c does for READY. §26.2 draws PENDING_APPROVAL → EXPIRED. *Downside:* an
  approval that comes too late finds the proposal expired.
- **D12. A dry run answers `VALIDATED` with the decision the real call would get:** `ALLOW` or
  `REQUIRE_APPROVAL`. A `DENY` is refused, as the real call is. *Downside:* none found.
- **D13. A control's `DENY` answers `POLICY_DENIED`, and its proposal ends DENIED.** The words name
  the operation only, because the control's reason is the company's own text, which has no label
  (DSOR-CLS-01). The record names the control by its id and version, and that version of the
  control holds the reason. The record cannot hold the reason itself: the audit record's
  `controls` field allows no other fields. *Downside:* the caller cannot tell which rule refused
  it, and a reader of the record looks the reason up in the control.
- **D14. The decision's record names each control evaluated,** in the audit record's own field
  `controls`: its id, version, outcome, authority, and `evaluation_error` when it could not be
  checked (DSOR-EXE-02). The authority part is step 28's DSOR-CTL-04, met early. *Downside:* a
  record grows with each control.
- **D15. A control applies to every caller of its operation in the company,** a person's own call
  too. user_123's own draft of INV-1008 needs the CFO, as the policy says. *Downside:* none, by the
  policy's own words.
- **D16. The tests and stories of earlier steps keep their idea, with no controls.** Their worlds
  say so in one line, so a test about a tear-up still tests a tear-up. This step's tests, its story,
  and the registry's default use the shipped `controls.json`. *Downside:* most test worlds have no
  CFO rule, which a reader could copy.
- **D17. CEL comes from `@marcbachmann/cel-js` 8.0.0,** the version that the repository's catalog
  pins and that decision 6 checked against the spec's tests. *Downside:* one more dependency in
  the step.
- **D18. A control may govern a command that has the company's own code, never a query or DSoR's
  own operations.** A tear-up, a brake, a sweep, and a load of rates must answer at once, and
  DSOR-APR-08 forbids `REQUIRE_APPROVAL` on `proposal.*`. Start-up refuses the rest. *Downside:* no
  rule can govern DSoR's own commands.

### The story's numbers

org_456's control: payments above 25,000.00 USD need the CFO. Tuesday's sheet of `ecb-daily`, from
step 26, converts. del_100 still allows 50,000.00 USD for one payment and 200,000.00 USD a day.

| Who drafts | Bill | In USD | The control | The limit | DSoR answers |
| --- | --- | --- | --- | --- | --- |
| the agent | INV-1008, 31,400.00 USD | 31,400.00 | needs the CFO | within | `PENDING_APPROVAL` |
| the agent | INV-2002, 9,000.00 EUR | 9,720.00 | allows | within | `COMMITTED` |
| the agent | INV-2004, 14,000,000.00 PKR | 50,000.00 | needs the CFO | within, at the limit | `PENDING_APPROVAL` |
| the agent | INV-2003, 49,000.00 GBP | 62,025.32 | needs the CFO | over | `LIMIT_EXCEEDED`: `DENY` wins |
| user_123, own call | INV-2006, 100,000 JPY | no rate | cannot be checked, so needs the CFO | none for a person | `PENDING_APPROVAL` |

The control's own tests, with their pinned rate of 280 PKR to the dollar: 25,000.00 USD is allowed,
25,000.01 USD needs the CFO, 50,000,000.00 PKR needs the CFO, 6,000,000.00 PKR is allowed, and
100.00 in `XXX`, which has no rate, needs the CFO.

### The tests, by claim

| Claim | What it says |
| --- | --- |
| C1 | Start-up refuses a control that `control.schema.json` refuses: no owner, no authority, a status or an effect it does not know |
| C2 | Start-up refuses a condition that is not CEL, returns no `bool`, or names anything outside the environment, and a control on a query or on DSoR's own operations |
| C3 | Start-up runs each control's tests with the rates they pin, and refuses to start when one fails |
| C4 | At line ⑩, a condition that is true applies the control's effect, false allows, and one that fails to evaluate applies the effect |
| C5 | Several controls and the limits combine: `DENY` wins over `REQUIRE_APPROVAL`, and `REQUIRE_APPROVAL` over `ALLOW` |
| C6 | A call that needs an approval waits at `PENDING_APPROVAL` with its booking, in `execute` and `propose_only` modes; a dry run answers `VALIDATED` with `REQUIRE_APPROVAL`; a replay gives the same answer; the sweep expires it |
| C7 | The decision's record names each control evaluated, with its outcome and authority |
| C8 | On the database: the waiting proposal, its booking, its claim's answer, and the record's controls |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
| --- | --- | --- |
| B1. The control is the quick rule, "over 25000 and in USD" | Its test of 50,000,000.00 PKR fails, so start-up refuses to start | (asked at the review) |
| B2. The quick rule, and start-up skips the tests | The rule goes active, and the agent's draft of INV-2004, 50,000.00 USD in rupees, is paid without the CFO | (asked at the review) |
| B3. A condition that fails to evaluate counts as false | user_123's draft of INV-2006 in JPY, which no sheet lists, is paid without the CFO | (asked at the review) |
| B4. The least restrictive answer wins | With a second control that denies payments above 45,000 USD, INV-2004 waits for the CFO instead of being refused | (asked at the review) |

### Left open, and not this step's idea

- Only a human switches a control on, a policy that changes, and a stale control: step 28.
- Approving, `proposal.approve`, and two approvals for two rules (DSOR-AUT-02c): step 29.
- The effects `require_step_up` and `require_verification`, and the functions `dsor_sum`,
  `dsor_in_flight`, and `dsor_is_new_counterparty`.
- DSOR-CTL-02d, an L3 rule: a control on a money threshold must have a test in another currency and
  one in a currency with no rate. The story's control has both, and nothing checks it yet.

## Before you build: set up a database

As in step 26: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Migration 022 runs: `dsor.audit` gets the column `controls`,
and `dsor_runtime` may write it and never change it.

Give the step a server of its own, or at least a database of its own with its own `.env`.
`pnpm migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server, so a second step
migrated on the same server changes the first step's login.

## What changed since step 26

| File | What changed |
| --- | --- |
| `controls.json`, `schemas/control.schema.json` | **New.** org_456's control `high-value-payment` v8, with its five tests, and the specification's schema, byte for byte |
| `src/cel.ts` | **New.** The environment a condition runs in: Appendix B's eight variables, and `dsor_money`, `dsor_exceeds`, and `dsor_covers`. The check of a condition at start-up, and its evaluation |
| `src/controls.ts` | **New.** Each company's controls, checked at start-up against the schema, CEL, their effect, and what they govern, with their tests run. At line ⑩: each control's answer, the most restrictive answer, and what a waiting payment requires |
| `migrations/022_record_controls.sql` | **New.** The column `controls` of `dsor.audit`, and one more column that `dsor_runtime` may insert |
| `src/pipeline.ts` | Line ⑩ asks the controls first, then the limits. A `DENY` answers `POLICY_DENIED`. A call that needs an approval answers `PENDING_APPROVAL`. A dry run answers its decision |
| `src/proposals.ts`, `src/claims.ts`, `src/envelope.ts` | A proposal waits at `PENDING_APPROVAL`, with what it requires and when it expires. A claim keeps that answer for a replay. The answer's shape |
| `src/expiry.ts` | The sweep expires a waiting payment too, and gives its booking back |
| `src/log.ts`, `src/postgres.ts` | The record names each control evaluated, in memory and in `dsor.audit`. The claim's waiting answer, and the sweep's list, on the database |
| `src/registry.ts`, `src/rates.ts` | Start-up checks `controls.json`, and what a control may govern. A condition gets the operation's risk level. Line ⑩ gets the newest fresh sheet |
| `src/main.ts` | Start-up checks the controls before any story. The company's rule, told in memory |
| `package.json` | `@marcbachmann/cel-js` 8.0.0 (decision D17) |
| `test/cel.test.ts`, `test/controls.test.ts`, `test/control-decisions.test.ts`, `test/control-decisions.db.test.ts` | **New.** The claims C1 to C8 |
| `test/helpers.ts`, `test/db.ts`, and nine test files | The earlier steps' worlds give no controls, through `withoutControls` (decision D16) |
| The other tests | The program's start-up and its story, the store map and the catalog, the privileges, and the sweep's list |

Step 26's markers are gone, as the build skill asks. A search for "NEW IN STEP" finds only this
step's lesson.

```bash
git diff --no-index ../mj_26_money_done_right/src src
git diff --no-index ../mj_26_money_done_right/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

Before the program does anything, start-up checks `controls.json` and runs the control's five
tests. A silent start means that they passed.

From a real run on 2026-10-12, shortened. After step 26's money story, the program tells the
company's rule, in memory, with a clock of its own.

```text
the company's rule, in memory, with a clock of its own:
  Tuesday 15:05, the agent drafts INV-1008, 31,400.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  Tuesday 15:05, the agent drafts INV-2002, 9,000.00 EUR: answered, PAY-901
  Tuesday 15:05, the agent drafts INV-2004, 14,000,000.00 PKR: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  Tuesday 15:05, the agent drafts INV-2003, 49,000.00 GBP: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one payment
  Tuesday 15:05, user_123 drafts INV-2006, 100,000 JPY: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  INV-1008's record: ALLOW PENDING_APPROVAL, high-value-payment v8 REQUIRE_APPROVAL
  INV-2006's record: ALLOW PENDING_APPROVAL, high-value-payment v8 REQUIRE_APPROVAL, error: no usable rate compares JPY with USD
  a dry run of INV-1008: VALIDATED, REQUIRE_APPROVAL
  the day's total under del_100: 91120.00 USD
  a week later, dsor-scheduler sweeps org_456: answered, 3 expired
  INV-1008's payment: EXPIRED, its booking released
```

What each line shows:

- **INV-1008 waits for the CFO.** 31,400.00 USD is above 25,000.00 USD. The work does not run, so
  no payment is drafted. The answer says whose approval it needs, and until when.
- **INV-2004 waits too.** On Tuesday's sheet, 14,000,000.00 PKR is exactly 50,000.00 USD. A rule
  that checks only "over 25000 and in USD" would let it through.
- **INV-2002 is paid.** 9,000.00 EUR is 9,720.00 USD, under 25,000.00 USD.
- **INV-2003 is refused.** The control asks for the CFO, and del_100's limit for one payment
  refuses it. A refusal is a `DENY`, and `DENY` wins (DSOR-AUT-02b).
- **user_123's own bill in yen waits.** No sheet lists JPY, so the condition cannot be checked, and
  the control's effect applies (DSOR-CTL-07). The record names the error. A person's own call meets
  the rule too (decision D15).
- **The dry run** says what the real call would get, and books nothing (decision D12).
- **The day's total** is 31,400.00 and 50,000.00 USD for the two waiting payments, and 9,720.00
  USD for the paid one. A waiting payment holds its booking (decision D9).
- **A week later**, nobody has approved, because approving comes in step 29. org_456's proposals
  live seven days (step 25c), so the sweep expires the three waiting payments, and their bookings
  go back (decision D11).

## Break it

Each break ran on the step's own code on 2026-10-12, and the code was restored after each run. The
output is copied as it was printed, shortened.

**B1. The control is the quick rule.** In `controls.json`, the condition became "over 25000 and in
USD":

```text
double(state.invoice.open_amount.value) > 25000.0 && state.invoice.open_amount.currency == "USD"
```

```text
$ pnpm start
the registry refused to start:
  controls.json: org_456's control high-value-payment v8 fails its test 3: expects REQUIRE_APPROVAL, gives ALLOW
  controls.json: org_456's control high-value-payment v8 fails its test 5: expects REQUIRE_APPROVAL, gives ALLOW
```

Test 3 is 50,000,000.00 PKR. At the test's own rate of 280 rupees to the dollar, that is about
178,571 USD. Test 5 is 100.00 in `XXX`, a currency with no rate. The quick rule allows both, and
each test expects the CFO. So the control never switches on, and DSoR does not start (decision
D2). This break also found a defect, now fixed: the program first ran all its other stories, and
refused only at the end. See "Found while building".

**B2. The quick rule, and start-up skips the tests.** In `src/controls.ts`, the list of failed
tests was always empty.

```text
  Tuesday 15:05, the agent drafts INV-2004, 14,000,000.00 PKR: answered, PAY-902
  Tuesday 15:05, user_123 drafts INV-2006, 100,000 JPY: answered, PAY-903
  INV-2006's record: ALLOW ok, high-value-payment v8 ALLOW
```

This is the map's own break. 50,000.00 USD in rupees is paid without the CFO, and so is the bill
in yen. The quick rule never converts, so it never fails, and it says `ALLOW`. The control's tests
are the only thing between the quick rule and these payments.

**B3. A condition that fails to evaluate counts as false.** In `src/controls.ts`, an error answered
`ALLOW`.

```text
$ pnpm start
the registry refused to start:
  controls.json: org_456's control high-value-payment v8 fails its test 5: expects REQUIRE_APPROVAL, gives ALLOW
```

The design expected user_123's bill in yen to be paid. It was not: the control's own test 5, the
currency with no rate, caught the break at start-up. The design's expectation was wrong, and DSoR
was safer than predicted. With the tests skipped too, as in B2, the bill in yen is paid:

```text
  Tuesday 15:05, user_123 drafts INV-2006, 100,000 JPY: answered, PAY-902
  INV-2006's record: ALLOW ok, high-value-payment v8 ALLOW, error: no usable rate compares JPY with
  USD
```

The record still names the error. The break turned "I cannot tell" into "no".

**B4. The least restrictive answer wins.** In `src/controls.ts`, `mostRestrictive` kept the least
restrictive answer.

```text
 × DSOR-AUT-02b: with a second control that denies payments above 45,000 USD, INV-2004's 14,000,000.00 PKR, 50,000.00 USD, hears POLICY_DENIED, ...
AssertionError: expected { outcome: 'PENDING_APPROVAL', …(6) } to match object { code: 'POLICY_DENIED', …(1) }
 × DSOR-AUT-02b: the most restrictive answer wins: DENY over REQUIRE_APPROVAL, and REQUIRE_APPROVAL over ALLOW, in any order; no answer at all is ALLOW
 × DSOR-AUT-02b: INV-2004's 14,000,000.00 PKR, 50,000.00 USD, meets both controls: the CFO's asks for an approval, the second denies, and DENY wins
      Tests  3 failed | 40 passed (43)
```

With a second rule that refuses payments above 45,000 USD, INV-2004 waited for the CFO instead. A
CFO could then approve a payment that the company's rules refuse.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The session of 2026-10-11: two parts, what a control is, and CEL with the PKR hole. Then the learner asked for the build first, and the review after |
| 2 | Decide | D1 to D18, each Claude Code's, each with its downside, for the learner's review |
| 3 | The copy | Step 26 copied, its markers removed, `@marcbachmann/cel-js` 8.0.0, and a PostgreSQL of its own |
| 4 | Piece A | The environment a condition runs in, red first |
| 5 | Piece B | `controls.json`, its schema, and its check at start-up, with the tests, red first |
| 6 | A fix | The operation's risk level, which a condition saw as "[object Object]" |
| 7 | Piece C1 | Several controls, one answer, red first |
| 8 | Piece C2 | Line ⑩: the controls, `PENDING_APPROVAL`, `POLICY_DENIED`, a dry run's decision, and the record |
| 9 | Piece C3 | The database: migration 022, the record's controls, and a waiting payment, red first |
| 10 | Piece D11 | The sweep expires a waiting payment, red first |
| 11 | Piece G | The program's story of the company's rule |
| 12 | Break it | B1 to B4 on the step's own code, each restored. B1 found that the program checked the controls late |

To start it in a new session:

```text
Build step 27 in learner mode from the design in
docs/baby_steps_tutorials/mj_27_controls_in_cel/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Piece A | 13 tests, red first. Broken on purpose: an error counted as false (5 tests failed), and amounts compared without conversion (3) |
| Piece B | 21 tests, red first. Broken on purpose: the tests skipped at switch-on (5), and a draft evaluated (1) |
| The risk fix | 1 test, red first: a control that asks `risk == "medium"` failed its own test on `payment.create` |
| Piece C1 | 6 tests, red first. Broken on purpose: the least restrictive answer winning (2), and every control answering every operation (1) |
| Piece C2, the old tests | 132 tests: the shipped control asked for the CFO on payments that the earlier steps' tests expect to be paid. Fixed with `withoutControls` (decision D16) |
| Piece C2, broken | No `POLICY_DENIED` (1), a proposal that ignores what a control requires (6), a dry run that always says `ALLOW` (1), and the limits before the controls (2) |
| The program's test | 2 tests: ajv warned about the "date-time" format at start-up, and the program must start silently |
| Piece C3 | 5 tests, red first: no column `controls`. Then 2 old tests: the pinned privileges, and a stand-in INSERT with 14 values |
| Piece C3, broken | The log writes no controls (2), store.json forgets the column (3), and the log's read drops them (none at first; 1 after a new test) |
| Piece D11 | 2 tests, red first. The third, "one millisecond before", passed before the code, and guards it. Broken on purpose: the database lists READY only (1), memory lists READY only (2), the sweep always moves from READY (3) |
| Piece G, broken | The story's world with no controls: the program's test failed |
| B1 | The program ran its other stories and refused late. A new start-up test failed without the fix |

## Check yourself

Use Tuesday's sheet: 1 EUR buys 1.0800 USD, 0.8532 GBP, or 302.40 PKR, and no JPY. del_100 allows
50,000.00 USD for one payment. org_456's control asks for the CFO above 25,000.00 USD.

1. The agent drafts INV-2004, 14,000,000.00 PKR. What does it hear, and why?
2. user_123 drafts INV-2006, 100,000 JPY, as a person, with no slip. What does user_123 hear, and what
   does the decision's record say?
3. The agent drafts INV-2003, 49,000.00 GBP. The control asks for the CFO. What does the agent hear?
4. Someone writes the control as "over 25000 and in USD", and restarts DSoR. What happens?
5. The agent's payment of INV-1008 waits for the CFO, and nobody approves. What happens to it, and
   to its 31,400.00 USD on the day's total?

<details>
<summary>Answers</summary>

1. `PENDING_APPROVAL`, for the CFO. 14,000,000.00 PKR is exactly 50,000.00 USD, which is above
   25,000.00 USD. The control compares through the money functions, which convert with the
   company's sheet (decisions D5 and D6).
2. `PENDING_APPROVAL`, for the CFO. No sheet lists JPY, so the condition cannot be evaluated, and
   the effect applies (DSOR-CTL-07). The record says `ALLOW` for the right to ask,
   `PENDING_APPROVAL` for the result, and names the control with the error "no usable rate compares
   JPY with USD". The control applies to every caller of the operation (decision D15).
3. `LIMIT_EXCEEDED`. 49,000.00 GBP is about 62,025 USD, above del_100's 50,000.00 USD. The limit's
   refusal is a `DENY`, and `DENY` wins over `REQUIRE_APPROVAL` (DSOR-AUT-02b). Nothing is booked,
   and the proposal ends DENIED.
4. DSoR does not start. The control's tests 3 (rupees) and 5 (a currency with no rate) expect the
   CFO, and the quick rule allows both, so the control cannot switch on (DSOR-CTL-02c, decision D2).
5. It waits seven days, org_456's lifetime for a proposal. Then dsor-scheduler's sweep moves it to
   EXPIRED, and its 31,400.00 USD goes back to the day (decision D11, DSOR-DEL-06d).

</details>

## Think it through

### Found while building

- **A condition saw the operation's risk as "[object Object]".** The registry gave
  `String(contract.risk)`, and risk is an object. Now a condition gets the risk level, as Appendix
  B says, with its own test.
- **The earlier steps' tests met the company's rule.** 132 tests failed, because their payments
  of INV-1008 waited for the CFO. Their worlds now give no controls, in one line each, so a test
  about a tear-up still tests a tear-up (decision D16).
- **ajv warned at start-up** about the "date-time" format of a control's `effective_from`. The
  checker turns formats off, as `src/slips.ts` does. Nothing in this step reads that field.
- **pg writes a JavaScript array as a PostgreSQL array,** which a `jsonb` column refuses. The log
  writes the list of controls as JSON text.
- **The log's read could drop the controls,** and no test saw it, because every database test
  read the row with SQL. A test now reads the record back through the log.
- **The program checked the controls late.** Found by B1: the earlier stories' worlds give no
  controls, so only the last world read `controls.json`. Start-up now checks the controls beside
  the contracts, the roles, the inputs, the labels, and the map, before any caller can ask
  (decision D2). A controls file can be named as the program's seventh file, so a test can start
  with a broken one.
- **B3's expectation was wrong.** The design expected the bill in yen to be paid. The control's own
  test 5, a currency with no rate, stopped the break at start-up. DSOR-CTL-02c guards DSOR-CTL-07.
- **D13's first words were wrong.** They said that the control's reason goes to the record. The
  audit record's `controls` field allows no other fields, so the record names the control by its
  id and version, and that version of the control holds the reason. D13 now says so.
- **The order of controls and limits.** §21 lists "controls, SoD, limits" at line ⑩, and decision
  D9 follows it. The specification's walk-through of the nightly run, in
  [§41](../../../specs/dsor/05-bindings.md#41-reference-profile-vertical-and-workflow-informative),
  checks the limits first. The final answer is the same either way. The order changes only which
  refusal the caller hears when both say `DENY`.
- **The program's header never named step 26's money story.** Step 27's header names both stories.
  Step 26's own header still leaves it out. That fix belongs in step 26's folder.
- **`ready-lifetimes.json` is the lifetime of every proposal now,** a waiting payment's too. Its
  name still says READY, as step 25c named it.

### Left open on purpose

- The list under "Left open, and not this step's idea" above.
- **DSOR-CTL-04 is met early.** The record names each control's id, version, and authority
  (decision D14). The map gives that rule to step 28, which adds the version in force when a
  policy changes.
- **A waiting payment's record says `ALLOW`.** The audit record's `authorization` allows only
  `ALLOW` or `DENY`, and the call was not denied. Its `result` says `PENDING_APPROVAL`.
- **`src/controls.ts` is 276 lines,** past the 150 that the build skill names. The start-up check
  and line ⑩'s evaluation could live in two files, in a step of their own.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-CTL-01a | A control validates against `control.schema.json`: a version, a condition, an effect, a status, a named human owner, and an authority reference | [§17.2 Control record](../../../specs/dsor/02-security.md#172-control-record) | Start-up refuses a control with no owner, no authority, or a status or an effect that the schema does not know. [`test/controls.test.ts`](test/controls.test.ts) |
| DSOR-CTL-05 | Conditions are CEL, evaluated in Appendix B's environment | [§17.3 Expression language](../../../specs/dsor/02-security.md#173-expression-language) | The eight variables and three money functions, and start-up refuses a condition that is not CEL or does not answer true or false. [`test/cel.test.ts`](test/cel.test.ts), [`test/controls.test.ts`](test/controls.test.ts) |
| DSOR-CTL-06 | An expression has nothing outside that environment | [§17.3 Expression language](../../../specs/dsor/02-security.md#173-expression-language) | Start-up refuses a condition that names anything else, a function of a later step included. `state` is DSoR's own look, never the caller's. [`test/cel.test.ts`](test/cel.test.ts) |
| DSOR-CTL-07 | A condition that fails to evaluate applies the control's effect | [§17.3 Expression language](../../../specs/dsor/02-security.md#173-expression-language) | A bill in yen that no sheet lists waits for the CFO, and the record names the error. [`test/cel.test.ts`](test/cel.test.ts), [`test/control-decisions.test.ts`](test/control-decisions.test.ts) |
| DSOR-CTL-02c | Switching a control on runs its tests, and fails when one fails | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | The quick rule fails tests 3 and 5, and start-up refuses. [`test/controls.test.ts`](test/controls.test.ts), [`test/startup.test.ts`](test/startup.test.ts) |
| DSOR-AUT-02a | Checks answer at least `ALLOW`, `DENY`, and `REQUIRE_APPROVAL` | [§15 Authorization](../../../specs/dsor/02-security.md#15-authorization) | INV-2002 is allowed, INV-1008 waits for the CFO, and a deny control refuses. [`test/control-decisions.test.ts`](test/control-decisions.test.ts) |
| DSOR-AUT-02b | The most restrictive answer wins | [§15 Authorization](../../../specs/dsor/02-security.md#15-authorization) | A limit's `DENY` and a control's `DENY` both win over the CFO's approval, in any order. [`test/controls.test.ts`](test/controls.test.ts), [`test/control-decisions.test.ts`](test/control-decisions.test.ts), [`test/control-decisions.db.test.ts`](test/control-decisions.db.test.ts) |
| DSOR-EXE-02 | The decision, with the controls evaluated, is recorded before the answer | [§21 Command pipeline](../../../specs/dsor/03-execution.md#21-command-pipeline) | Still met, now with controls to name: each record names each control, its version, outcome, and authority, in memory and in `dsor.audit`. [`test/control-decisions.test.ts`](test/control-decisions.test.ts), [`test/control-decisions.db.test.ts`](test/control-decisions.db.test.ts) |
| DSOR-DEL-06d | A booking is released when its proposal ends | [§13.4 Cumulative limits](../../../specs/dsor/02-security.md#134-cumulative-limits) | Still met: a waiting payment that expires gives its booking back. [`test/control-decisions.test.ts`](test/control-decisions.test.ts), [`test/control-decisions.db.test.ts`](test/control-decisions.db.test.ts) |

## Next

Step 28 · Where a rule came from. Each control points at the exact policy sentence and version it
was built from. When the policy changes, the control is marked stale and its owner is told. Only
a human may switch a control on.
