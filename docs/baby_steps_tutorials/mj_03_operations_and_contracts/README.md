# Step 03 · Operations and contracts

**New in this step:** everything a caller can do has a name and a spec sheet, and a
spec sheet with a missing field stops the program before it starts (DSOR-OPR-01,
DSOR-OPR-02a, DSOR-OPR-02b).

## In plain words

Until now, code called `getInvoice` directly. From this step, a caller asks for an
**operation** by its name, such as `invoice.get`. An operation is one thing a caller
can do. A **query** reads, like `invoice.get`. A **command** changes something, like
`invoice.issue`.

Every operation has a **contract**: its spec sheet. The contract says what goes in,
what comes out, which permission it needs, how risky it is, and whether it can be
undone. In this step, each contract is a JSON file. It holds data, never program code.
Its few rules, such as `state.invoice.status == "draft"`, are text that a later step
reads.

A **registry** is the list of every operation this program knows, each with its
contract. The
program builds the registry at **start-up**, the moment it begins, before any caller
can ask for anything. The registry checks each contract against the specification's
own **JSON Schema** for contracts, `operation-contract.schema.json`. In this tutorial,
one wrong contract stops the whole program (decision 2). The refusal names every
problem it found.

One rule is easy to break by being helpful. When a contract leaves out its risk level,
the registry must not fill one in. Not a low one, and not even a high one. It refuses
the contract, so that the person who wrote it has to decide.

## Why it matters

**An action with no name cannot be checked.** A general `invoice.update(fields)` could
set INV-1008 to `paid` when no money was sent. The rule "payments above 25,000 USD need
`cfo_100`" would never run, because nothing was called a payment. A rule can only be
attached to an operation that says what it does, like `invoice.issue`.

**A missing field must not be guessed.** Suppose the contract for `payment.execute`
leaves out its risk level, and the code says `contract.risk?.level ?? "low"`. The most
dangerous operation in the system now looks harmless. From step 27, a company rule can
read an operation's risk level, for example "every high-risk operation needs a second
person". That rule now never runs for `payment.execute`. Nothing fails and nothing
warns.

**Common mistake:** checking a contract with your own `if` statements instead of the
schema. A list of the 16 field names feels complete. But the schema has more rules than
that. A command that can never be undone also needs `in_flight`, the records no other
command may touch while it runs, and `approve_permission`, the permission a person
needs to approve it. A hand-written list forgets them. Check against the schema itself, and the rules
you did not know about are checked too.

## The design, before any code

This section was written before the first test. It is the plan the code must follow.
If the code finds the plan wrong, the plan changes here first.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-OPR-01 | **C1.** Nothing is called through the registry without a contract | Code for an operation with no contract stops start-up, and is never run |
| DSOR-OPR-01 | **C2.** The contract passes the real schema, not a copy of some of its checks | Our contracts pass, and a wrong value such as `risk.level: "extreme"` is refused |
| DSOR-OPR-02a | **C3.** A contract missing a field every contract needs is refused | Each of the 10 always-required fields, removed in turn |
| DSOR-OPR-02a | **C4.** A command needs more fields, and a query does not | A command missing each of the 6 is refused, and so is one missing a field its `execution.semantics` asks for. A query without them is accepted |
| DSOR-OPR-02a, with decisions 2 and 7 | **C5.** The refusal happens at start-up, and names every problem | The registry never loads. Two problems in one file, and problems in two files, are all named |
| DSOR-OPR-02b | **C6.** Nothing is filled in for the four fields the rule names | `risk: {}`, `execution: {}`, `idempotency: {}`, and a missing `effect` are each refused |
| DSOR-OPR-02b | **C7.** A loaded contract is exactly what was written | Nothing is added, changed, or removed while loading. Two contracts with one id are refused, not one picked (decision 7) |

The schema decides which fields are required. Every contract needs `id`, `version`,
`kind`, `effect`, `input`, `output`, `authorization`, `tenancy`, `risk`, and `audit`. A
command also needs `delegation`, `idempotency`, `concurrency`, `execution`,
`preconditions`, and `controls`. A query's `effect` must be `read`.

Two more rules depend on `execution.semantics`, the promise about undoing a command:

- `compensatable` or `saga` (it can be undone by other operations) also needs
  `execution.compensated_by`, the list of those operations.
- `non_compensatable` (it can never be undone) also needs `in_flight` and
  `authorization.approve_permission`, as the Common mistake above explains.

A field can be missing inside an object that is there. `risk: {}` has a `risk` and no
level. The schema refuses it. The test for it is separate from the test with no `risk`
at all, because code can guess a level in one case and not in the other.

A schema can say "if this, then that". The contract schema says: if `kind` is
`command`, then 6 more fields are required. The rules above are written this way.

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **This step is one idea: contracts, checked at start-up, and calls by name.**
   `invoice.issue` gets its contract, because a real command contract is needed to test
   C4. It does not change any invoice yet. Changing an invoice raises a new question at
   once: what if the invoice is already issued? The caller needs an answer it can act
   on. That answer is an **error envelope**, a fixed shape for a refusal, and it is
   step 04. *Downside:* this step differs from the map of all steps (`../readme.md`),
   which has `invoice.issue` change the invoice here. Asking to run `invoice.issue` is
   refused, with a message that says the operation is not built yet.
2. **One broken contract stops the whole program.** *Downside:* one typo stops
   everything. So the refusal must name every problem at once. Otherwise the author
   fixes one, restarts, and meets the next.
3. **The two schema files are copied into this step.** The step must run outside the
   repository, so it cannot read `packages/spec`. `schemas/operation-contract.schema.json`
   and `schemas/common.schema.json` are byte-for-byte copies, because the first one
   points into the second. *Downside:* two copies of one file. So a test compares each copy
   with the original in `../../../packages/spec/schemas/` when that folder is there.
   Outside the repository it is not there, and the test is skipped. Inside it, CI, the
   checks that run on every pull request, runs `pnpm check` in every step. So a copy
   that drifts fails CI.
4. **Contracts are JSON files in `contracts/`.** A contract is data. It is checked the
   way anything from outside the program is checked. *Downside:* start-up reads files from
   disk.
5. **The validator is ajv 8.20.0, the version the repository already pins.** A
   **validator** is a library that checks a document against a JSON Schema. The
   specification's schemas are written in the 2020-12 edition of JSON Schema, so the
   code uses `Ajv2020`. The plain `Ajv` reads an older edition. `allErrors` is on, so
   every problem is reported. `useDefaults`, `coerceTypes`, and `removeAdditional` stay
   off, because each one changes the contract while checking it. `strict` is off, as in
   the repository. With `strict: true`, ajv refuses to read the schema at all. The rule
   "a command needs 6 more fields" names fields that strict mode wants declared in the
   same place (its `strictRequired` check). Left at its default, ajv reads the schema.
   But it prints six warnings at every start-up (its `strictTypes` check). Both
   checked 2026-09-25. The repository
   also installs ajv-formats, which checks values such as dates. This step does not: no
   field of a contract has a `format`. *Downside:* ajv checks the schema file itself less
   strictly. The test in decision 3 keeps that file equal to the original.
6. **The registry is handed each file's text, not an object.** It parses and checks the
   text itself, so no code outside `buildRegistry` sees a contract before it is
   checked.
7. **Two contracts with the same id stop start-up.** Keeping one of them would be a
   guess about which one the author meant. *Downside:* none found yet.
8. **`invoice.issue` is `atomic`.** It changes one invoice, all at once or not at all.
   `non_compensatable` would need `in_flight` and an approver permission, and
   `compensatable` would point to `invoice.cancel`, which has no contract. The
   permission `invoice:read` is a name the specification uses. `invoice:issue` has the
   same `<resource>:<action>` form, like the specification's `payment:execute`.
   *Downside:* the semantics are chosen before the command does anything.

### The tests, by claim

- **C1:** `invoice.get` by name runs, with the caller's input. An unknown name,
  `invoice.delete`, is refused. So are `toString` and `constructor`, which every
  JavaScript object already has. Code registered for an operation with no contract
  stops start-up, and is never run even in a registry built by hand. `invoice.issue`
  has a contract and no code yet, so a call is refused.
- **C2:** both contracts pass. `risk.level: "extreme"` is refused.
- **C3:** one test for each of the 10 always-required fields.
- **C4:** one test for each of the 6 command-only fields. A query without them passes.
  A query with `effect: "mutating"` is refused. `non_compensatable` without `in_flight`
  is refused, and without `approve_permission`. `compensatable` and `saga` without
  `compensated_by` are refused.
- **C5:** the registry does not load. A contract with two problems gets both named. Two
  broken files, a file that is not JSON, and code with no contract, are all named in
  one refusal. The code of a broken contract is not also called "no contract".
- **C6:** `risk: {}` in a command and in a query, `execution: {}`, `idempotency: {}`,
  and a contract with no `effect` are each refused.
- **C7:** the loaded contract equals the file. `version: "1"`, text instead of a
  number, is refused. An unknown extra field is refused, not deleted. Two files with
  the id `invoice.get` are refused, even when one is broken. These two tests carry no
  rule id: they prove decision 7.
- **Start-up:** only `.json` files are read, in name order, and `pnpm start` runs.
- **The copies:** each file in `schemas/` equals its original, when the original is
  there.

### Breaks we will try, and what we expect

These are run against the finished step. Before any code existed, the learner
predicted which would survive, meaning every test stays green. M7 to M9 were added
with the design fixes and predicted before they were run. The results go under
"Think it through".

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| M1 | The registry skips a bad contract and loads the rest | C5 | caught |
| M2 | `allErrors` off, so only the first problem is named | C5, two problems | caught |
| M3 | `coerceTypes` on, so `"1"` quietly becomes `1` | C7, `version: "1"` | survives |
| M4 | `removeAdditional` on, so unknown fields are quietly deleted | C7, unknown field | survives |
| M5 | `useDefaults` on, so defaults from the schema are filled in | nothing: the schemas have no `default` to fill in | survives |
| M6 | A call runs code without checking for a contract | C1 | caught |
| M7 | The registry stops at the first broken file | C5, two files | caught |
| M8 | Two files with one id: the last one wins | C7, two files | caught: "it shall fail to start" (not sure) |
| M9 | A level is filled in when `risk` is there without one | C6, `risk: {}` | "nope" |

The learner also predicted that C1 is the claim a first build would most likely miss.

## What changed since step 02

```text
contracts/invoice.get.json     NEW: the contract for the query invoice.get
contracts/invoice.issue.json   NEW: the contract for the command invoice.issue
schemas/*.schema.json          NEW: byte-for-byte copies of the specification's
                               operation-contract and common schemas
src/registry.ts                NEW: readContracts(), buildRegistry(), and call()
src/operations.ts              NEW: the code behind each operation, by name
src/main.ts                    changed: builds the registry first, then reads INV-1008
                               through invoice.get
test/contract.test.ts          NEW: what the schema refuses (C2, C3, C4, C6)
test/registry.test.ts          NEW: the registry and calls by name (C1, C5, C7)
test/startup.test.ts           NEW: reading the contracts folder, and the program itself
test/schemas.test.ts           NEW: the two copies equal the originals
test/helpers.ts                NEW: what the test files share
src/invoice.ts, src/uri.ts,    changed: step 02's NEW IN STEP markers are now plain
test/uri.test.ts               comments
package.json                   changed: the step's name and description, and ajv 8.20.0
```

**The one new dependency is ajv 8.20.0**, the validator (decision 5). Checking a
contract against the real schema is the lesson of this step, and ajv reads the
2020-12 edition of JSON Schema that the specification uses.

Every new region is marked `NEW IN STEP 03`. To see the whole diff, run this from
`docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_02_canonical_uris/src mj_03_operations_and_contracts/src
git diff --no-index mj_02_canonical_uris/test mj_03_operations_and_contracts/test
```

Three choices in the code are worth a look:

- **The registry is handed text, not objects.** `buildRegistry` parses each file's text
  and checks it on the next lines. No code outside `buildRegistry` sees a contract
  before it is checked, so no such code can fill in a field first (decision 6).
- **Every problem is collected before anything is refused.** Broken files, text that is
  not JSON, two files with one id, and code with no contract all go into one list. The
  refusal is thrown once, at the end (decision 2).
- **Names are looked up in a `Map`, not a plain object.** A plain object already has
  `toString` and `constructor`, so `handlers["toString"]` finds a function. `call()`
  looks the name up in the contracts `Map` first, and a `Map` holds only what was put
  in it.

## Run it

```bash
cd docs/baby_steps_tutorials/mj_03_operations_and_contracts
pnpm install
pnpm start
```

```text
$ node src/main.ts
operations: [ 'invoice.get', 'invoice.issue' ]
{
  id: 'INV-1008',
  vendor_id: 'VENDOR-44',
  amount: { value: '31400.00', currency: 'USD' },
  open_amount: { value: '31400.00', currency: 'USD' },
  status: 'issued'
}
dsor://org_456/invoice/INV-1008
{ tenant_id: 'org_456', entity: 'invoice', id: 'INV-1008' }
refused: "invoice.issue" is not built yet
```

`pnpm check` runs the type check, then 125 tests:

```text
 Test Files  7 passed (7)
      Tests  125 passed (125)
```

Outside the dsor repository, the two tests that compare the schema copies have no
original to compare with, so they are skipped: `123 passed | 2 skipped`.

## Break it

**Break two contracts.** In `contracts/invoice.issue.json`, change
`"risk": { "level": "medium" }` to `"risk": {}`. In `contracts/invoice.get.json`, change
`"version": 1` to `"version": "1"`. Then run `pnpm start`:

```text
$ node src/main.ts
the registry refused to start:
  invoice.get.json: /version must be integer
  invoice.issue.json: /risk must have required property 'level'
[ELIFECYCLE] Command failed with exit code 1.
```

Nothing ran, not even `invoice.get`. Both problems are named in one refusal. Put the
files back with `git checkout -- contracts`.

**Break the registry.** Now make the registry "helpful". In `src/registry.ts`, above the
line `const id = (data as { id?: unknown } | null)?.id;`, add a guess for a missing
level:

```ts
const risk = (data as { risk?: { level?: unknown } } | null)?.risk;
if (risk && typeof risk === "object" && risk.level === undefined) risk.level = "low";
```

Run `pnpm test`. These are the lines that matter:

```text
     × DSOR-OPR-02b: a command with no risk level is refused, not given one 4ms
     × DSOR-OPR-02b: a query with no risk level is refused, not given one 0ms
 FAIL  test/contract.test.ts > C6: nothing is filled in for the four fields the rule names > DSOR-OPR-02b: a command with no risk level is refused, not given one
AssertionError: expected '' to match '/risk must have required property \'l…'
      Tests  2 failed | 123 passed (125)
```

Two tests in 125 see it. The test that removes the whole `risk` still passes, because
the guess only runs when `risk` is there. Delete the two lines, and `pnpm check` is
green again.

## Build it yourself with Claude Code

This is how the step was built. Each row is one commit or more, and every commit after
the design passes `pnpm check`, except the red ones, which fail on purpose:

| # | Move | What you do |
|---|---|---|
| 1 | Copy | Copy your step 02. Change the name in `package.json` |
| 2 | Design first | Write "In plain words", "Why it matters", and "The design, before any code": the rules split into claims, the decisions the spec leaves to you, and the breaks you predict |
| 3 | Check the design | Run the real schema through ajv before writing code. Fix the design where the schema says it is wrong |
| 4 | Red | Write the tests, one group per claim. Watch every one fail for the right reason |
| 5 | Green | Write the smallest code that passes them |
| 6 | Break it | Run every predicted break. Compare the results with your predictions |
| 7 | Review | A reviewer who has not seen your conversation attacks the step. Fix what it finds |

Move 3 found five tests the first design lacked. Before the review, three of the breaks
were caught only by those tests. Move 7 found seven more places where broken code
passed every test.

Build your own step 03 from a copy of your step 02. From `docs/baby_steps_tutorials`:

```bash
cp -R my_02_canonical_uris my_03_operations_and_contracts
cd my_03_operations_and_contracts
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 03. Design first: before any
code, we split the three rules into claims and I predict which breaks survive. Then
check the design against the real schema. Two questions to settle with me: a contract
with risk: {} has a risk and no level, so what could code guess, and which test
catches it? And should one broken contract stop the whole program?
```

When `pnpm check` is green in your folder, and once the official step 03 exists:

```text
Now compare this folder with ../03_operations_and_contracts. Explain every difference,
and tell me which ones matter and why.
```

## Check yourself

1. Why is `invoice.update(fields)` more dangerous than `invoice.issue`, even when both
   change the same field?
2. A contract leaves out its risk level. The code fills in `"high"`, the strictest
   level. Does that meet DSOR-OPR-02b? Why?
3. Why does the program refuse to start, instead of refusing each call to the broken
   operation?
4. A query's contract has no `idempotency` field. Is it refused?
5. Why does the registry have to name every problem, not only the first?

<details>
<summary>Answers</summary>

1. `invoice.issue` says what the caller means, so a rule can be attached to it.
   `invoice.update` hides the meaning. A rule about issuing, or about payments, never
   runs, because nothing says an invoice is being issued or paid. And one contract
   cannot fit every change `update` might make. Its risk level, its idempotency, and
   its preconditions would have to be right for all of them at once.
2. No. The rule forbids any default for the risk level, even the strictest one. A
   default hides the fact that nobody decided. It also makes the log show `high` as if someone chose it. And there is no
   safe default for every field the rule covers. The contract is refused, so its author
   decides.
3. At start-up the mistake is found before any caller can reach anything. A refusal per
   call lets the program run, and the mistake waits for the first unlucky caller.
4. No. A query only reads, so it does not declare `idempotency`. The schema says "if
   `kind` is `command`, then `idempotency` is required", so the rule asks it of
   commands only. A test for each side proves it: a command without it is refused, and
   a query without it is accepted.
5. Because one mistake stops the whole program (decision 2). If only the first problem
   is named, the author fixes it, restarts, and meets the next one, again and again.
   There is a second reason, found by break M2. The first problem can be the
   misleading one. With only the first named, a contract with no `kind` was refused
   for its `effect`, and the missing `kind` was never shown.

</details>

## Think it through

### The breaks, run

Each break was made in `src/registry.ts`, all tests were run, and the file was put
back. The results below are from the finished step, after the review.

| # | The break | Learner's prediction | Result |
| --- | --- | --- | --- |
| M1 | Skip a bad contract, load the rest | caught | caught, by 34 tests |
| M2 | `allErrors` off | caught | caught, by 2 tests |
| M3 | `coerceTypes` on | survives | caught, by 1 test: `version: "1"` |
| M4 | `removeAdditional` on | survives | caught, by 1 test: the unknown field |
| M5 | `useDefaults` on | survives | survives |
| M6 | A call skips the contract check | caught | caught, by 5 tests |
| M7 | Stop at the first broken file | caught | caught, by 1 test |
| M8 | Two files, one id: the last one wins | caught (not sure) | caught, by 2 tests |
| M9 | Fill a level when `risk` has none | "nope" | caught, by 2 tests |

What the results teach:

- **M3 and M4 were caught.** Each option changes the contract so that it passes. The
  test expected a refusal, got none, and failed. A test that expects "no" catches a
  change that turns "no" into "yes".
- **M2 was caught for a surprising reason.** With `allErrors` off, ajv stops at the
  first problem. For a contract with no `kind`, the first problem is the misleading one:

  ```text
  the registry refused to start:
    invoice.issue.json: /effect must be equal to constant
  ```

  The real problem, the missing `kind`, is never shown. With `allErrors` on, it is the
  third line.
- **M5 survives, and nothing can catch it today.** `useDefaults` fills in only a
  `default` written in the schema, and the schemas have none. It becomes a real danger
  the day the schema gains one. The danger DSOR-OPR-02b names comes from our own
  code, as M9 shows.
- **M6 was first caught only by the words of the refusal.** With the check gone, an
  unknown name reaches the `handlers` Map, finds nothing, and is refused as "not built
  yet". `buildRegistry` puts only names with a contract into that Map, so a second
  check stands behind the first. The review added a test that builds a registry by
  hand, with code and no contract. It shows the code is never run.
- **M7, M8, and M9 were each caught by exactly one test.** All three tests were added
  when the design was checked against the schema. The first design would have let all
  three survive. The review added a second test for M8 and M9.

### What the review found

Two reviewers who had not seen how the step was built attacked it. One checked each
rule against the tests and the code. The other broke the code in 35 more ways and
read this README against the house style.

Fixed:

- **A guess made only for queries passed every test.** The `risk: {}` test used only
  the command. A query test now catches it.
- **`invoice.get` could ignore its input** and always return INV-1008, because there
  is only one invoice. A call for INV-9999 must now return nothing.
- **Two files with one id were named only when both were valid.** Now both are named
  at once, even when one is broken.
- **The code of a broken contract could also be reported as "no contract".** That
  sends the author to the wrong file. A test now forbids it.
- **The file order, the `.json` filter, and `main.ts` itself had no test.** Now they
  do. `pnpm start` runs inside the tests.
- **Two tests were titled DSOR-OPR-02b but proved decision 7.** They have no rule id
  now. Refusing both contracts is this tutorial's choice. The rule says nothing about
  two files.

Left open, on purpose. The next step starts from this list:

- **A loaded contract is not frozen.** `readonly` is checked only by TypeScript. After
  start-up, code can still write `contract.risk.level = "low"`. DSOR-OPR-02b is about
  the registry while it loads. Freezing is a second idea. It belongs with the first
  step whose code reads a contract.
- **A field written twice in one file.** `JSON.parse` keeps the last one, with no
  error. `{ "risk": { "level": "critical" }, "risk": { "level": "low" } }` loads as
  `low`. This is a downside of decision 4. Catching it needs a different JSON reader,
  which is a second idea.
- **The values inside the shipped contracts are not tested.** Changing
  `invoice.issue`'s risk from `medium` to `high` passes every test. What a value means
  is tested by the step that uses it: permissions, risk rules.
- **`main.ts` could call `handlers["invoice.get"]` directly** and print the same thing.
  No test tells the two apart.
- **Error messages about contract files are not shortened.** A huge id or field name in
  a contract is printed whole. The team writes contract files, and a caller does not,
  so this step shortens only what a caller sends.
- **A folder named `x.json`, or a file that cannot be read,** stops start-up with its
  own error, outside the list of problems.
- **The schema accepts empty lists.** `compensated_by: []`, `in_flight: {}`, and
  `controls: []` all pass. `compensated_by` may also name an operation that has no
  contract. This is a question for the specification.

Found while checking the design against the schema, before any code:

- A contract with no `kind` gets two misleading problems as well as the true one. The
  schema's "if `kind` is `command`" passes when there is no `kind`. So does its "if
  `kind` is `query`". Both "then" rules apply:
  the command fields are asked for, and `effect` must be `read`. "Name every problem"
  also names problems that are not really there. The true one, "must have required
  property 'kind'", is always in the list.
- The specification's rule against a general tool, DSOR-OPR-03a, has no step in the
  map of all steps yet.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-OPR-01 | Every operation has a contract that validates against `operation-contract.schema.json` | [§7 Operations and the operation contract](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract), and [`operation-contract.schema.json`](../../../packages/spec/schemas/operation-contract.schema.json) | 12 tests: 8 in `test/registry.test.ts` (C1), 2 in `test/contract.test.ts` (C2), and 2 in `test/schemas.test.ts` (the copies) |
| DSOR-OPR-02a | The registry rejects a contract that omits a mandatory field | [§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract) | 27 tests: 23 in `test/contract.test.ts` (C3, C4), and 4 in `test/registry.test.ts` (C5) |
| DSOR-OPR-02b | The registry never fills in a default for risk level, execution semantics, effect, or idempotency | [§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract) | 8 tests: 5 in `test/contract.test.ts` (C6), and 3 in `test/registry.test.ts` (C7) |

Seven more tests carry no rule id. They prove this tutorial's own choices: two
contracts with one id (decision 7), how start-up reads the folder, the program itself,
an input `invoice.get` refuses, and the length of a refusal.

The two schema files in `schemas/` are copies of the specification's. Inside the dsor
repository, `test/schemas.test.ts` fails if a copy drifts, and `pnpm guard` checks every
rule id and every link on this page.

**Next:** step 04, result and error envelopes.
