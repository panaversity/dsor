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
  the operation only. The control's id and its reason go to the record, because the reason is the
  company's own text, which has no label (DSOR-CLS-01). *Downside:* the caller cannot tell which
  rule refused it.
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
