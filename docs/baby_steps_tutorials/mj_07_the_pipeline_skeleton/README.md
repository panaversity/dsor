# Step 07 · The pipeline skeleton

**New in this step:** every call runs one fixed checklist, numbered as the
specification numbers it, and one line is new: "is the input valid?" (DSOR-EXE-01a,
DSOR-OPR-04a).

## In plain words

By step 06, `call` already asks three questions: who are you, which operation, and may
you. But their order is only the order the lines happen to sit in. Nothing says why,
and nothing stops the next change from moving them.

This step turns those checks into a **pipeline**: one list of checks that every call
goes through, in one fixed order. The order is the one in the specification's diagram in
[§21](../../../specs/dsor/03-execution.md#21-command-pipeline), where each check has a
number. The function is written so that you can read it top to bottom beside that
diagram.

Think of a pilot's checklist before take-off. The same items, in the same order, on
every flight, whoever the pilot is. A new item is added in its place, and never moves
the others. The analogy stops at one point: a pilot can skip a line. Here a test fails
if a line moves.

One check is new. Line ⑥ of the diagram asks **is the input valid?** Each operation
gets an **input schema**: a JSON Schema that says exactly which fields its input may
have. `invoice.get` takes `{ id }`. `invoice.issue` takes `{ invoice }`, an invoice's
canonical URI. Any other field is refused.

Most lines of the diagram belong to later steps. They appear in the function as
numbered comments that say which step will fill them. None of them is a function that
does nothing and says "fine".

## Why it matters

**The order of the checks is part of the security.** Steps 05 and 06 each learned this
once:

| If this were checked first | What would go wrong |
| --- | --- |
| Which operation, before who is calling | A caller with no login learns which operations exist (step 05) |
| "Is it built?", before the permission | The test "a reader cannot issue" passes with no permission check at all (step 06) |
| Is the input valid, before the permission | A caller who may not issue can still learn, one refusal at a time, what a valid `invoice.issue` looks like |

The rule under all three: the earlier checks protect the later ones. DSoR must know who
you are before it says what exists, and whether you may, before it discusses how.

**Every door must lead to the same checklist.** Step 42 adds a web door, and step 46 a
door for AI agents. If each door ran its own checks, one would sooner or later run them
in another order, or leave one out. The same invoice would be guarded through one door
and open through the other. DSOR-OPR-04a says every interface invokes the same
pipeline. Then there is only one list to get right.

§21's own "Why it matters" and "Common mistake" are about writing the decision down
before the answer. That is step 08. The reason for a fixed order comes from steps 05 and
06.

**Common mistake:** a check that does nothing yet, written as a function that returns
without complaint, so the list looks complete. It is a door that opens when the power
fails. A reader believes the tenant is checked, and it is not.

## The design, before any code

This section was written before the first test, in a learner session. Every sentence of
the specification it relies on was read on 2026-09-26: §7 (DSOR-OPR-04a) and §21. If the
code finds the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** Every check already built lives somewhere in `call`, and its order already
carries security. This step makes that order one fixed checklist, the same for every
call, and pins it with a test. The analogy is the pilot's checklist.

**Outcome.** What is true when this step is done:

1. Every call goes through one function whose lines follow §21's numbers: ① who are
   you, ⑤ may you, ⑥ is the input valid.
2. "Is the input valid?" is a real line of the checklist, not something each operation
   does in its own way.
3. When a call would fail two checks, the refusal comes from the earlier line, always.
4. The code behind an operation is reached only through the checklist.
5. The function reads top to bottom beside §21's diagram. That is the map's "done
   when".

**Not the outcome of this step.** The lines of later steps: ② which company (step 10),
③ whose permission slip (step 18), ④ suspended (step 25), ⑦ seen this request before
(step 20), ⑪ write the decision down (step 08), and the rest.

**The success signal.** A test records which lines of the checklist ran for a call, in
order, and compares them with §21's numbers. Swap any two lines, and it fails.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-EXE-01a | **C1.** Every call runs the lines of the checklist in §21's order | The record of the lines that ran matches §21's numbers, for `invoice.get` and for `invoice.issue` |
| DSOR-EXE-01a | **C2.** When two lines would refuse, the earlier one answers | The table below |
| (our decision) | **C3.** Line ⑥ checks the input against the operation's input schema, and a field the schema does not list is refused | `as_user`, and a `principal` that agrees with the login, are refused with `VALIDATION_FAILED` |
| (our decision) | **C4.** Start-up is refused for a contract whose input schema is missing or broken | Step 03's lesson: loud, and early |
| DSOR-OPR-04a | **C5.** The code behind an operation is reached only through the checklist | Code that records each time it runs never runs on a call that a line refuses, and `main.ts` reaches operations only through `call` |
| (our decision) | **C6.** A line not built yet is a numbered comment that names its step. No code pretends to check | Read beside §21 |

DSOR-EXE-01a says that **commands** pass through the steps in the order given. So C1
and C2 test `invoice.issue`, the one command, which now passes lines ①, ⑤, and ⑥ before
it hears "not built yet". §21 also says that queries pass through steps 1 to 6, so
`invoice.get` follows the same order.

C2, for calls to `invoice.issue` that are wrong in more than one way:

| Caller | Input | Answer | Because |
| --- | --- | --- | --- |
| no login | bad | `AUTHENTICATION_REQUIRED` | ① comes first |
| `cfo_100`, who may not issue | bad | `AUTHORIZATION_DENIED` | ⑤ comes before ⑥ |
| `user_123`, who may issue | bad | `VALIDATION_FAILED` | ⑥ comes before "is it built?" |
| `user_123` | good | "not built yet" | it passed every line |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **A line not built yet is a comment:** `// ② Which company? Not checked yet: step 10.`
   A function that did nothing would be a check that always says "fine", and a sentence
   about behavior that does not exist. *Downside:* nothing makes step 10 put its check
   on line ②. The order test and the review must.
2. **Each operation's input schema is a JSON file of this tutorial's own,** in
   `inputs/`, named by the contract: `inputs/InvoiceGetRequest.schema.json` is
   `{ id }`, and `inputs/InvoiceIssueRequest.schema.json` is `{ invoice }`. The
   `invoice` field points at the specification's own `resourceUri` definition in the
   copied `common.schema.json`, by its URN, so no pattern is copied a second time. The
   `invoice.issue` contract already says `"bind": { "invoice": "input.invoice" }`.
   Start-up reads every file in `inputs/`, the way it reads `contracts/`, and looks each
   contract's input schema up among those files. It never builds a path from the text
   of a contract. Every input schema refuses a field it does not list. The specification's
   `resourceUri` accepts any tenant of the right shape, `acme` too. Step 02's stricter
   rule, `org_` and digits, still applies wherever the URI is read with `parseUri`, so
   line ⑥ checks the shape only. *Downside:* the specification
   names these inputs and never defines them. They are this tutorial's invention, and
   the question goes to `research/open-questions.md`.
3. **A principal named in the arguments is now refused at line ⑥ even when it agrees
   with the login,** because no input schema lists it. One that disagrees is still
   refused earlier, at line ①, with `AUTHORIZATION_DENIED` (DSOR-SRC-02b). This narrows
   step 05's gap: `as_user: "cfo_100"` is no longer accepted. *Downside:* it is refused
   as a bad input, with `VALIDATION_FAILED`, and not as a principal who disagrees with
   the login. DSOR-SRC-02b names `AUTHORIZATION_DENIED` for that, but DSoR cannot tell
   that a field it does not know names a principal. It also changes step 05's "accepted
   and not used". "Think it through" records the change.
4. **"Which operation?" comes right after ①,** before the comment for ②. §21 does not
   list it, but ⑤ needs the contract to know which permission applies, and ③ and ④ will
   likely need it too: a permission slip covers operations, and a breaker can stop one
   operation. *Downside:* a line of ours inside §21's numbering, and ②'s comment sits
   after it. The function marks it as ours.
5. **"Is it built?" comes after ⑥,** where §21 goes on to ⑦. *Downside:* also ours. It
   goes away when commands are built.
6. **The order test sees the lines through an observer:** an optional function the
   checklist tells each line's number as it runs it. Each line is written as one call,
   `line(5, () => checkPermission(…))`, so a check cannot move without its number.
   *Downside:* production code carries a hook that only tests use. Spying on the
   functions of a module would be harder to read.
7. **Line ⑥'s other half, "compute payload hash", waits for approvals in step 29.**
   Line ⑥'s comment says so.
8. **The request id is still checked in line ①,** as part of "build the request
   security context". So `cfo_100` with a bad request id hears `VALIDATION_FAILED`
   before line ⑤. *Downside:* one `VALIDATION_FAILED` comes before "may you?". It is
   about the envelope beside the arguments, so it tells the caller nothing about what
   an operation's input looks like.

### The tests, by claim

- **C1:** the lines that ran, for `invoice.get` and for `invoice.issue`, match §21's
  order.
- **C2:** the four rows of the table above.
- **C3:** `invoice.get` refuses `{}`, `{ id: 1008 }`, `{ id: "INV-1008", as_user:
  "cfo_100" }`, and `{ id: "INV-1008", principal: "accounts-payable-fte" }` from the
  agent. `invoice.issue` refuses an `invoice` that is not a canonical URI. The good
  inputs pass.
- **C4:** start-up is refused when an input schema file is missing, and when one is not
  valid JSON Schema.
- **C5:** for every refused call in C2 and C3, the operation's code never runs. The
  rest is a reading check: `main.ts` reaches operations only through `call`. In one
  program, any code can reach a function. The rule is about doors, and today there is
  one door. Steps 42 and 46 add the second and third.
- **C6:** a reading check, done by the review, beside §21's diagram.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction | What happened |
| --- | --- | --- | --- | --- |
| R1 | Lines ⑤ and ⑥ are swapped: the input is checked before the permission | C1, C2 | survives | Caught: 16 tests fail |
| R2 | Line ② becomes a real function, `checkTenant()`, that does nothing | only a reader: no answer changes | survives | Survives: all 427 pass. Written as `line(2, …)`, it is caught by 6 tests, because the order test sees a line ② |
| R3 | An input schema allows fields it does not list | C3 | survives | Caught: 16 tests fail for `InvoiceGetRequest`, 1 for `InvoiceIssueRequest` |
| R4 | A contract whose input schema file is missing loads, and its input is never checked | C4 | survives | Caught: 4 tests fail |

R2 is different from every break so far. It changes no answer to any call, so no test
can catch it, even in principle. That is why decision 1 forbids it, instead of trusting
a test to find it.

The review also attacks the step with the §10.2 threats that fit its idea: T2, an agent
reaching past its task through a door with fewer checks, and T1, instructions hidden in
an input's extra fields.

### Left open, and not this step's idea

- **Should an operation's input name a record by its canonical URI?** `invoice.get`
  still takes `{ id }`. `invoice.issue` already takes a URI. DSOR-RID-03 says the same URI
  identifies a resource across every interface.
- **Should an unknown field that names a principal be refused as a denied principal?**
  DSOR-SRC-02b wants `AUTHORIZATION_DENIED`. DSoR cannot recognise every spelling, so
  `as_user` gets `VALIDATION_FAILED` (decision 3).
- **The lines of later steps,** each in its numbered place: ② step 10, ③ step 18, ④ step
  25, ⑦ step 20, ⑪ step 08.

## What changed since step 06

```text
inputs/                        NEW: one input schema per operation (decision 2)
src/pipeline.ts                NEW: call(), moved here from registry.ts. It is now the
                               checklist: line ①, ours "which operation?", comments for
                               ② to ④, line ⑤, line ⑥, ours "is it built?", and
                               comments for ⑦ to ⑰. Each built line runs through
                               line(n, check), which tells an optional observer its number
src/inputs.ts                  NEW: readInputs() and checkInputs() find and compile each
                               contract's input schema at start-up. checkInput() is
                               line ⑥
src/registry.ts                changed: buildRegistry() takes the input schemas, and
                               names their problems with the others. call() moved out
src/operations.ts              changed: invoice.get's code no longer checks its input.
                               Line ⑥ has done it (outcome 2)
src/main.ts                    changed: shows user_123 refused at line ⑥ for an id where
                               invoice.issue needs a URI
test/pipeline.test.ts          NEW: the checklist, by claim (C1 to C5)
test/helpers.ts                changed: the shipped input schemas, a good and a bad
                               input for invoice.issue, and line ⑥'s message. Calls that
                               expect "not built yet" send a good input
test/who-is-calling.test.ts,   changed: a principal that agrees with the login, and an
test/permissions.test.ts       empty list of permissions, are now refused at line ⑥
                               (decision 3)
test/registry.test.ts,         changed: calls send inputs that pass line ⑥, and
test/call.test.ts,             contracts made up by a test get an input schema.
test/startup.test.ts           The program refuses to start when an input schema has
                               no file
src/, test/                    step 06's NEW IN STEP markers are now plain comments
```

There is no new dependency. Line ⑥ uses ajv, which step 03 added to check contracts.

Every new region is marked `NEW IN STEP 07`. To see the whole diff, run this from
`docs/baby_steps_tutorials`. `inputs/` is new, beside `contracts/`:

```bash
git diff --no-index mj_06_permissions_deny_by_default/src mj_07_the_pipeline_skeleton/src
git diff --no-index mj_06_permissions_deny_by_default/test mj_07_the_pipeline_skeleton/test
```

Three choices in the code are worth a look:

- **A line and its number are one statement.** `line(5, () => checkPermission(…))`
  tells the observer "5", then runs the check. Moving the check moves the number with
  it, so the order test sees what really ran.
- **A line not built yet is a comment, and says which step builds it.** Read `call()`
  beside §21's diagram. Every number from ① to ⑰ is there, in order. Only ①, ⑤, and ⑥
  run code.
- **Checking never changes the input.** `checkInputs()` creates ajv with
  `removeAdditional: false`, `coerceTypes: false`, and `useDefaults: false`. With
  `removeAdditional` on, `as_user` would be quietly deleted, and the call would go on.
  Refused is the only safe answer.

## Run it

From the root of the dsor repository:

```bash
cd docs/baby_steps_tutorials/mj_07_the_pipeline_skeleton
pnpm install
pnpm start
```

```text
$ node src/main.ts
operations: [ 'invoice.get', 'invoice.issue' ]
{
  data: {
    id: 'INV-1008',
    vendor_id: 'VENDOR-44',
    amount: { value: '31400.00', currency: 'USD' },
    open_amount: { value: '31400.00', currency: 'USD' },
    status: 'issued'
  },
  correlation: {
    request_id: 'req_31a3730c-2b7f-4b31-ba36-3760ddc8f64d',
    agent_id: 'accounts-payable-fte'
  }
}
dsor://org_456/invoice/INV-1008
{ tenant_id: 'org_456', entity: 'invoice', id: 'INV-1008' }
{
  code: 'RESOURCE_NOT_FOUND',
  message: 'no invoice "INV-9999"',
  retry: 'never',
  correlation: {
    request_id: 'req_256503b9-69c5-432a-b34f-db143513a04e',
    agent_id: 'accounts-payable-fte'
  }
}
{
  code: 'AUTHORIZATION_DENIED',
  message: '"invoice.issue" needs invoice:issue, which the caller does not hold',
  retry: 'never',
  correlation: {
    request_id: 'req_5690733b-3785-4081-b027-6e40d9c5f34d',
    agent_id: 'accounts-payable-fte'
  }
}
{
  code: 'AUTHENTICATION_REQUIRED',
  message: 'log in first: the call has no login token that DSoR gave',
  retry: 'never',
  correlation: { request_id: 'req_de037088-1bff-4d48-bd79-69c54b2acd73' }
}
{
  code: 'AUTHORIZATION_DENIED',
  message: 'the arguments name someone other than the caller, in principal',
  retry: 'never',
  correlation: {
    request_id: 'req_3e5e1c92-659e-4ec1-9e96-03f4646b2dae',
    agent_id: 'accounts-payable-fte'
  }
}
{ request_id: 'ap-desk-7', principal_id: 'user_123' }
{
  code: 'UNSUPPORTED_CAPABILITY',
  message: '"invoice.issue" is not built yet',
  retry: 'never',
  correlation: { request_id: 'ap-desk-7', principal_id: 'user_123' }
}
{
  code: 'VALIDATION_FAILED',
  message: 'the input of "invoice.issue" is not valid: /invoice must match pattern "^dsor://[A-Za-z0-9_\\-]+/[a-z][a-z0-9_]*/[A-Za-z0-9_.\\-]+$"',
  retry: 'never',
  correlation: { request_id: 'ap-desk-7', principal_id: 'user_123' }
}
```

Look at the last two answers. user_123 may issue, so both calls pass line ⑤. The first
sends a canonical URI, passes line ⑥, and hears "not built yet". The second sends
`INV-1008`, an id and not a URI, and line ⑥ refuses it. Your request ids will be
different.

The success signal from the design is the order test. Run it on its own:

```bash
pnpm test -t "in §21's order"
```

```text
 Test Files  1 passed | 11 skipped (12)
      Tests  3 passed | 424 skipped (427)
```

`pnpm check` runs the type check, then 427 tests:

```text
 Test Files  12 passed (12)
      Tests  427 passed (427)
```

Outside the dsor repository, the three tests that compare the schema copies have no
original to compare with, so they are skipped: `424 passed | 3 skipped`.

## Break it

**Check the input before the permission.** This is R1 from the design. In
`src/pipeline.ts`, find lines ⑤ and ⑥:

```ts
    line(5, () => checkPermission(caller, contract, registry.roles));
    …
    line(6, () => checkInput(name, registry.inputs, input));
```

Swap the two statements, so the input is checked first. Run `pnpm start`. The output
is the same, apart from the request ids. The agent is still denied `invoice.issue`,
because the input it sent was good.

Run `pnpm test`. These are the lines that matter, and "…" marks what is left out:

```text
…
 FAIL  test/pipeline.test.ts > C2: when two lines would refuse, the earlier one answers > DSOR-EXE-01a: cfo_100, who may not issue, with a bad input: ⑤ answers before ⑥
AssertionError: expected { code: 'VALIDATION_FAILED', …(3) } to strictly equal { code: 'AUTHORIZATION_DENIED', …(3) }

- Expected
+ Received

  {
-   "code": "AUTHORIZATION_DENIED",
+   "code": "VALIDATION_FAILED",
    "correlation": {
      "principal_id": "cfo_100",
      "request_id": "req_ca7458e8-91c0-4da7-b4e6-3ac02f72c6f3",
    },
-   "message": "\"invoice.issue\" needs invoice:issue, which the caller does not hold",
+   "message": "the input of \"invoice.issue\" is not valid: /invoice must match pattern \"^dsor://[A-Za-z0-9_\\-]+/[a-z][a-z0-9_]*/[A-Za-z0-9_.\\-]+$\"",
    "retry": "never",
  }
…
      Tests  16 failed | 411 passed (427)
```

`cfo_100` may not issue. Still, the answer now tells the CFO what a valid
`invoice.issue` input looks like, down to the pattern. Try again with a URI, and the
answer changes to "denied". One refusal at a time, a caller who may not issue learns
the shape of the input. The order test fails too: it expected `[1, 5, 6]` and saw
`[1, 6, 5]`. Ten older tests fail as well. They send `invoice.issue` an input that is
not valid, from a caller who may not issue, and expect "denied". They had passed only
because line ⑤ answered first. Put
the two lines back, and `pnpm check` is green again.

**Now try R2.** Add a function `checkTenant()` that does nothing, and call it where the
comment for line ② is. Run `pnpm test`: all 427 pass. No test can see a check that
changes no answer. Only a reader can, which is why decision 1 forbids it.

## Build it yourself with Claude Code

This is how the step was built. Each row is one commit or more:

| # | Move | What you do |
|---|---|---|
| 1 | Copy | Copy your step 06. Change the name and the description in `package.json` |
| 2 | Design first | Write "In plain words", "Why it matters", and "The design, before any code": the intent and the outcome, the rules split into claims, the decisions the spec leaves to you, and the breaks you predict |
| 3 | Check the design | Read §7 and §21 again, DSOR-SRC-02b, and `resourceUri` in `common.schema.json`. Fix the design where they say it is wrong |
| 4 | Make room | Move `call()` into `src/pipeline.ts`, with no change in behavior. `registry.ts` had passed 150 lines |
| 5 | Red | Write the tests, one group per claim. Predict which pass before any code, then watch every one fail for the right reason |
| 6 | Green | The checklist and line ⑥. One commit: both rules live in the same function |
| 7 | Break it | Run every predicted break. Compare the results with your predictions |
| 8 | Review | A reviewer who has not seen your conversation attacks the step. Fix what it finds |

Move 3 changed C5's test and decision 3, and pinned decisions 4, 6, and 8. In the red
run, 43 tests fail. 8 of the 37 new tests pass before any code. Each of those says
"yes", and sits beside a "no" test that fails. All of this is under "Think it through".

Build your own step 07 from a copy of your step 06. From `docs/baby_steps_tutorials`:

```bash
cp -R my_06_permissions_deny_by_default my_07_the_pipeline_skeleton
cd my_07_the_pipeline_skeleton
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 07. Design first: the intent and
the outcome, then the rules split into claims, and I predict which breaks survive. Then
check the design against §7, §21, DSOR-SRC-02b, and resourceUri in common.schema.json.
Three questions to settle with me: where do the checks that already exist sit among
§21's numbers? How does a test see the order the lines ran in? What is refused when an
input carries a field its operation does not name?
```

When `pnpm check` is green in your folder, and once the official step 07 exists:

```text
Now compare this folder with ../07_the_pipeline_skeleton. Explain every difference, and
tell me which ones matter and why.
```

## Check yourself

1. Why must "may you?" (⑤) come before "is the input valid?" (⑥)?
2. Line ② is a comment, not a function that does nothing. Why does that matter, when
   both change no answer today?
3. `cfo_100` sends `invoice.issue` with a bad input. Which refusal comes back, and why
   that one?
4. Why does step 42's web door not get checks of its own?
5. The agent sends `{ id: "INV-1008", principal: "accounts-payable-fte" }`. The
   principal is the agent itself. Why is the call refused?

<details>
<summary>Answers</summary>

1. Otherwise a caller who may not run an operation can still learn, one refusal at a
   time, what a valid input for it looks like. DSoR decides whether you may before it
   discusses how.
2. A function that does nothing looks like a check. A reader believes the tenant is
   checked, and it is not. A comment says plainly that the check does not exist yet,
   and which step brings it.
3. `AUTHORIZATION_DENIED`. `cfo_100` may not issue, and line ⑤ runs before line ⑥, so
   the input is never looked at.
4. Every door must lead to the same checklist (DSOR-OPR-04a). A door with checks of its
   own could run them in another order, or leave one out.
5. `invoice.get`'s input schema lists only `id`, so any other field is refused at line
   ⑥, even one that agrees with the login. This is this tutorial's decision, and it
   changes step 05's behavior.

</details>

## Think it through

_The review's findings, and the result of every break in the table above, are written
after the review._

What checking the design against the specification changed, before the first test:

- **C5's test changed.** The plan said "the only exported way to run an operation is
  `call`". That was already false: `operations.ts` exports the code, and the registry
  keeps it in a map anyone can read. The test now proves what DSOR-OPR-04a is about: a
  call that the checklist refuses never reaches the code.
- **Decision 3 overclaimed.** It said `as_user` closes step 05's gap. It narrows it:
  `as_user` is refused, but with `VALIDATION_FAILED`, not the `AUTHORIZATION_DENIED`
  that DSOR-SRC-02b names.
- **Decision 4 got a place,** right after ①, and **decision 6 got a shape,**
  `line(n, check)`, so a check and its number cannot be separated.
- **Decision 8 is new.** It says where the request id check sits.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-EXE-01a | Commands pass through the pipeline steps in the order given | [§21 Command pipeline](../../../specs/dsor/03-execution.md#21-command-pipeline) | 5 tests in `test/pipeline.test.ts`, C1 and C2 |
| DSOR-OPR-04a | Every interface invokes the same DSoR pipeline | [§7 Operations and the operation contract](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract) | 6 tests in `test/pipeline.test.ts`, C5. Today there is one interface, `call` |

**Next:** step 08, write the decision first.
