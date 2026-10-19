# Step 27 · Controls in CEL

**New in this step:** the company's policy becomes a *control*, a rule written in CEL with its owner,
the policy it came from, and test cases that must pass before it is switched on; DSoR evaluates it at
every payment.

## In plain words

org_456's finance policy says: "Payments above 25,000 USD or equivalent require CFO approval." It
lives in KSoR, the company's record of what it knows, as version 4 of
`finance/payment-approval-policy`. Until this step, nothing in DSoR knew it. `del_100` lets the agent
pay up to 50,000.00 USD a payment, so the agent's 31,400.00 USD payment for INV-1008 was made, and no
CFO ever saw it.

A policy is English, and a program cannot run English. Someone translates the sentence into a
condition a program can evaluate. That translation is a **control**:

```text
policy (KSoR, v4)   "Payments above 25,000 USD or equivalent require CFO approval."
control (DSoR, v8)  dsor_exceeds(input.amount, dsor_money("25000", "USD"))  →  REQUIRE_APPROVAL by the CFO
```

The condition is written in **CEL**, the Common Expression Language. CEL works like the condition of
an `if` statement. It cannot loop forever, call the network, or read anything it was not handed. What
it is handed is listed in the specification's
[Appendix B](../../../specs/dsor/appendix-b-cel.md): eight variables, such as `input`, the payment's
arguments, and `principal`, who is asking, and the money functions. `dsor_exceeds` is step 26's
`exceeds`, so 50,000,000.00 PKR is compared exactly, at the company's own rates.

A control is kept in DSoR's own store, `dsor.controls`, with its owner (`cfo_100`), the policy
sentence and version it came from, and five **test cases**. It arrives *in review*. Switching it on
runs every case, with the exchange rates the case pins, and refuses if one gives the wrong answer.

Once it is on, every payment is checked, a person's as well as the agent's. Above the line, the
payment does not run: its proposal waits at **PENDING_APPROVAL**, its amount still booked against the
day, and the caller is told who must approve, how many, and until when. Nobody can approve it until
step 29. If the condition cannot be evaluated, a currency with no rate, say, the control applies:
a rule that crashes is never "no rule today".

## Why it matters

Each quick fix for the CFO's policy is a hole:

- **Write it in TypeScript**, `if (amount > 25000)`. The CFO cannot read it or test it, nobody can
  walk from a payment back to the sentence that allowed it, and changing the policy needs a
  programmer.
- **Write it as numbers and a currency name**, `amount > 25000 && currency == "USD"`. 50,000,000.00
  PKR, about 178,571 USD, goes straight through, because it is not in dollars. Measured below.
- **Skip a rule that crashes.** On the day the rate service is down, a rule that cannot convert would
  mean no rule at all.

## What changed since step 26b

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_26b_the_start_up_gaps ../my_27_controls_in_cel
```

| File | What |
| --- | --- |
| `src/cel.ts` | new — Appendix B's environment: eight variables, `dsor_money`, `dsor_exceeds` and `dsor_covers` over step 26's exact comparisons; `checkCondition` refuses a name outside it, `matches`, and anything that is not true or false |
| `src/policy-controls.ts` | new — the controls in the store; `evaluateControl`, which applies a control whose condition cannot be evaluated and denies one that cannot be read; `mostRestrictive`; `switchOn`, which runs the cases |
| `migrations/028_controls.sql` | new — `dsor.controls`, under the second lock; the application reads them and changes a status |
| `migrations/029_the_cfo_control.sql` | new — org_456's `high-value-payment` v8 on `payment.create`, in review, with its five cases |
| `migrations/030_the_record_names_its_controls.sql` | new — the log's `controls` column |
| `migrations/031_a_control_is_only_switched_on.sql` | new — the application may move a waiting control to active, and nothing else |
| `src/operations.ts` | a new stage, *evaluate the controls*, at §21.10 before the slip's limits; DENY refuses `POLICY_DENIED`; REQUIRE_APPROVAL waits at PENDING_APPROVAL (`waitAt`, from step 23's `prepare`); §21.6 refuses a malformed amount |
| `src/pipeline.ts`, `src/envelopes.ts`, `src/audit.ts` | the context's controls; the PENDING_APPROVAL receipt; the record's controls, inside the hash |
| `src/database.ts` | start-up's questions about `dsor.controls` and its second policy; step 26b's review fixes, carried |
| `src/main.ts` | the control switched on, and a payment above the line waiting for the CFO |
| `test/cel.test.ts`, `test/controls-store.test.ts`, `test/switching-on.test.ts`, `test/controls-at-the-door.test.ts`, `test/controls-review.test.ts` | new |
| `test/pipeline.test.ts`, `test/main.test.ts` and four others | the new stage, the demo's counts, the new table |
| `package.json` | `@marcbachmann/cel-js` 8.0.0, exactly, the CEL library the repository's own specification tests use |

## Run it

```bash
pnpm install
pnpm start
```

After the money section:

```text
org_456's policy: payments above 25,000 USD or equivalent need the CFO. Its control:

  case 1  expects ALLOW             gives ALLOW
  case 2  expects REQUIRE_APPROVAL  gives REQUIRE_APPROVAL
  case 3  expects REQUIRE_APPROVAL  gives REQUIRE_APPROVAL
  case 4  expects ALLOW             gives ALLOW
  case 5  expects REQUIRE_APPROVAL  gives REQUIRE_APPROVAL
  high-value-payment v8: switched on

user_123              VALIDATED                the decision would be REQUIRE_APPROVAL; nothing was done
user_123              PENDING_APPROVAL         dsor://org_456/proposal/prop_32  waits for 1 by CFO (high-value-payment v8)
                                              until 2026-10-22T19:22:52.249Z
accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-916  draft      compensatable
                        withheld: amount (clearance)
```

The five cases run before the control is switched on. Then user_123 asks first, with a dry run, and
is told the decision would be REQUIRE_APPROVAL. The real payment waits for one approval by the CFO,
for 72 hours, and nothing is paid. The agent's 2,500.00 USD is below the line, and is made. Run it a
second time, without deleting `.local-database`, and the control says it is on already; the agent's
2,500.00 is then past the day's limit.

### The database tier

`pnpm check` needs no server. The seventy-five tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_26b_the_start_up_gaps/.env .env     # then dsor_step26b -> dsor_step27 in both lines
pnpm migrate && pnpm test:db
```

`pnpm migrate` applies 028 to 031 on a server that has step 26b's twenty-seven. This step adds no
test to the tier: a control is read through the same store as everything else, and the start-up
questions about `dsor.controls` are asked of the real server by `test/audit.db.test.ts`. Run on Neon on 2026-10-19, on `dsor_step27`: 75 passed; and 75 again after the review's migration 031.

## Break it

Three, each measured on the full suite in a copy outside the repository, where one test skips
because the specification is not beside it.

### Break 1 · the rule written in numbers

The map's break. In `migrations/029_the_cfo_control.sql`, change the condition to
`double(input.amount.value) > 25000.0 && input.amount.currency == "USD"`.

```text
      Tests  43 failed | 1151 passed | 1 skipped (1195)
```

The control is never switched on: cases 3 and 5 fail, 50,000,000.00 PKR and a currency with no rate,
which the rule calls ALLOW. Every test that needs the control on fails with it, and so does the demo,
which prints `not switched on: high-value-payment v8 failed its own test cases`. Written in numbers,
the rule is caught before it governs anything.

### Break 2 · a condition that cannot be evaluated allows

In `src/policy-controls.ts`, in `evaluateControl`'s `catch`, answer `outcome: "ALLOW"` instead of the
control's effect.

```text
      Tests  43 failed | 1151 passed | 1 skipped (1195)
```

The same 43, for a different reason: case 5, 100.00 in XXX, has no rate, and now gives ALLOW, so the
control again fails its own cases and is never switched on. The case in XXX is there for exactly this.

### Break 3 · a payment that needs the CFO runs anyway

In `src/operations.ts`, make `needsApproval` answer `false`.

```text
      Tests  18 failed | 1176 passed | 1 skipped (1195)
```

The control is evaluated and recorded, and nobody waits: every payment above the line is made. The
receipts, the dry run, the replay, the stale control and the demo all say so.

## Build it yourself with Claude Code

Copy `my_26b_the_start_up_gaps` to a new folder, without its `.env`, and ask:

> Start step 27, controls in CEL. Before any code: show me the agent's 31,400.00 USD payment made
> with no CFO, and the rule `amount > 25000 && currency == "USD"` letting 50,000,000 PKR through.
> Then ask me the step's decisions one at a time. Then build it a piece at a time, red first, and
> break each piece on purpose.

## Check yourself

1. Why is the CFO's condition `dsor_exceeds(input.amount, dsor_money("25000", "USD"))` and not
   `amount > 25000`?
2. The rate service is down, and user_123 pays 2,800,000.00 PKR. What does the control say, and why?
3. What happens to a control whose test cases fail?
4. A payment above the line waits at PENDING_APPROVAL. Is its amount booked against the day?
5. Why is the brake, `control.suspend`, governed by no control?

<details>
<summary>Answers</summary>

1. `dsor_exceeds` converts to dollars at the company's rates and compares exactly, so 50,000,000.00
   PKR is above 25,000 USD. A number compared with 25000 knows nothing about currency.
2. It requires approval. Its condition cannot be evaluated, because the rupees cannot be converted,
   and a control whose condition cannot be evaluated applies (`DSOR-CTL-07`).
3. It is not switched on, and governs nothing. The rule written in numbers fails cases 3 and 5.
4. Yes. It stays booked while it waits, so the day errs toward refusing, never toward paying more.
5. A brake only ever makes things safer, and must work when the controls cannot be read.

</details>

## The rules this step meets

- **[DSOR-CTL-01a · L1]** A control MUST validate against `control.schema.json` — checked when it is
  switched on, and a control in force that does not is denied.
- **[DSOR-CTL-02c · L2]** Activation MUST run the control's test vectors and fail if any vector fails.
- **[DSOR-CTL-02e · L2]** A test vector that depends on a currency conversion MUST pin the rates it
  assumes — and those rates, never the live service's, are used.
- **[DSOR-CTL-05 · L1]** Control conditions MUST be CEL expressions evaluated in the environment of
  Appendix B — three of its six functions in this step.
- **[DSOR-CTL-06 · L1]** An expression MUST NOT have access to anything outside that environment.
- **[DSOR-CTL-07 · L2]** When a control condition fails to evaluate, the control's effect MUST apply.
- **[DSOR-AUT-02a · L1]** ALLOW, DENY and REQUIRE_APPROVAL. **[DSOR-AUT-02b · L1]** The most
  restrictive outcome wins.
- **[DSOR-EXE-02 · L1]** The decision is recorded with the controls evaluated, before the response.

**What this step leaves, said plainly.** Nobody can approve a waiting payment until step 29, and
nothing carries one out until step 31; nothing moves one to EXPIRED when its 72 hours end. Who may
switch a control on, and what happens when the policy it came from changes, are step 28's: here no
operation reaches `switchOn`, and the demo calls it in the administrator's place. `dsor_sum`,
`dsor_in_flight` and `dsor_is_new_counterparty` wait for the steps that need them, and `state` is
empty until step 32 binds resources. A condition about who is asking cannot be switched on, because
the schema's test cases have no place for the principal; `payment.create`'s contract still lists no
controls, since a company's controls are in its own store. Both are questions for the specification
(decision 164). Everything earlier steps claimed still holds.

**Next:** step 28, `where_a_rule_came_from`: each control points at the policy sentence it was built
from, a changed policy marks it stale without switching it off, and only the control's human owner
may switch one on.
