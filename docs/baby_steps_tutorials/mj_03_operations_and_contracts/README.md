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
undone. In this step, each contract is a JSON file. It holds data only, never code.

A **registry** is the list of every operation DSoR knows, each with its contract. The
program builds the registry at **start-up**, the moment it begins, before any caller
can ask for anything. The registry checks each contract against the specification's
own **JSON Schema** for contracts, `operation-contract.schema.json`. If one contract is
wrong, the program refuses to start, and it names every problem it found.

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
that. A command that cannot be undone also needs `in_flight` and `approve_permission`,
and a hand-written list forgets them. Check against the schema itself, and the rules
you did not know about are checked too.

## The design, before any code

This section was written before the first test. It is the plan the code must follow.
If the code finds the plan wrong, the plan changes here first.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-OPR-01 | **C1.** Nothing can be called without a contract | Code for an operation with no contract stops start-up |
| DSOR-OPR-01 | **C2.** The contract passes the real schema, not a copy of some of its checks | Our contracts pass, and a wrong value such as `risk.level: "extreme"` is refused |
| DSOR-OPR-02a | **C3.** A contract missing a field every contract needs is refused | Each of the 10 always-required fields, removed in turn |
| DSOR-OPR-02a | **C4.** A command needs more fields, and a query does not | A command missing each of the 6 is refused, and so is one missing a field its `execution.semantics` asks for. A query without them is accepted |
| DSOR-OPR-02a | **C5.** The refusal happens at start-up, and names every problem | The registry never loads. Two problems in one file, and problems in two files, are all named |
| DSOR-OPR-02b | **C6.** Nothing is filled in for the four fields the rule names | `risk: {}`, `execution: {}`, `idempotency: {}`, and a missing `effect` are each refused |
| DSOR-OPR-02b | **C7.** A loaded contract is exactly what was written | Nothing is added, changed, or removed while loading. Two contracts with one id are refused, not one picked |

The schema decides which fields are required. Every contract needs `id`, `version`,
`kind`, `effect`, `input`, `output`, `authorization`, `tenancy`, `risk`, and `audit`. A
command also needs `delegation`, `idempotency`, `concurrency`, `execution`,
`preconditions`, and `controls`. A query's `effect` must be `read`.

Two more rules depend on `execution.semantics`, the promise about undoing a command:

- `compensatable` or `saga` (it can be undone by other operations) also needs
  `execution.compensated_by`, the list of those operations.
- `non_compensatable` (it can never be undone) also needs `in_flight` and
  `authorization.approve_permission`.

A field can be missing inside an object that is there. `risk: {}` has a `risk` and no
level. The schema refuses it. The test for it is separate from the test with no `risk`
at all, because code can guess a level in one case and not in the other.

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a price.

1. **This step is one idea: contracts, checked at start-up, and calls by name.**
   `invoice.issue` gets its contract, because a real command contract is needed to test
   C4. It does not change any invoice yet. The first change to stored data raises a new
   question at once, "what if the invoice is already issued?", and a caller needs an
   answer it can act on. That answer is an error envelope, which is step 04.
   *Price:* this step differs from the map, which has `invoice.issue` change the
   invoice here. Asking to run `invoice.issue` is refused, with a message that says the
   operation is not built yet.
2. **One broken contract stops the whole program.** *Price:* one typo stops
   everything. So the refusal must name every problem at once. Otherwise the author
   fixes one, restarts, and meets the next.
3. **The two schema files are copied into this step.** The step must run outside the
   repository, so it cannot read `packages/spec`. `schemas/operation-contract.schema.json`
   and `schemas/common.schema.json` are byte-for-byte copies, because the first one
   points into the second. *Price:* two copies of the same truth. So a test compares each
   copy with the original in `../../../packages/spec/schemas/` when that folder is
   there. Outside the repository it is not there, and the test is skipped. CI runs
   `pnpm check` in every step, so a copy that drifts fails CI.
4. **Contracts are JSON files in `contracts/`.** A contract is data. It is checked the
   way anything from outside the program is checked. *Price:* start-up reads files from
   disk.
5. **The validator is ajv 8.20.0, the version the repository already pins.** A
   **validator** is a library that checks a document against a JSON Schema. The
   specification's schemas are written in the 2020-12 edition of JSON Schema, so the
   code uses `Ajv2020`. The plain `Ajv` reads an older edition. `allErrors` is on, so
   every problem is reported. `useDefaults`, `coerceTypes`, and `removeAdditional` stay
   off, because each one changes the contract while checking it. `strict` is off, as in
   the repository. With `strict: true`, ajv refuses to read the schema at all, because
   the rule "a command needs 6 more fields" names fields in a way strict mode does not
   accept (`strictRequired`). Left at its default, ajv reads the schema but prints six
   warnings at every start-up (`strictTypes`). Both checked 2026-09-25. The repository
   also installs ajv-formats, which checks values such as dates. This step does not: no
   field of a contract has a `format`. *Price:* ajv checks the schema file itself less
   strictly. The test in decision 3 keeps that file equal to the original.
6. **The registry is handed each file's text, not an object.** It parses and checks the
   text itself, so no code can change a contract before it is checked.
7. **Two contracts with the same id stop start-up.** Keeping one of them would be a
   guess about which one the author meant. *Price:* none found yet.
8. **`invoice.issue` is `atomic`.** It changes one invoice, all at once or not at all.
   `non_compensatable` would need `in_flight` and an approver permission, and
   `compensatable` would point to `invoice.cancel`, which has no contract. The two
   permissions, `invoice:read` and `invoice:issue`, are the names the specification
   uses. *Price:* the semantics are chosen before the command does anything.

### The tests, by claim

- **C1:** `invoice.get` by name runs. An unknown name, `invoice.delete`, is refused.
  So are `toString` and `constructor`, which every JavaScript object already has. Code
  registered for an operation with no contract stops start-up. `invoice.issue` has a
  contract and no code yet, so a call is refused.
- **C2:** both contracts pass. `risk.level: "extreme"` is refused.
- **C3:** one test for each of the 10 always-required fields.
- **C4:** one test for each of the 6 command-only fields. A query without them passes.
  A query with `effect: "mutating"` is refused. `non_compensatable` without `in_flight`
  is refused, and without `approve_permission`. `compensatable` and `saga` without
  `compensated_by` are refused.
- **C5:** the registry does not load. A contract with two problems gets both named. Two
  broken files, a file that is not JSON, and code with no contract, are all named in
  one refusal.
- **C6:** `risk: {}`, `execution: {}`, `idempotency: {}`, and a contract with no
  `effect` are each refused.
- **C7:** the loaded contract equals the file. `version: "1"`, text instead of a
  number, is refused. An unknown extra field is refused, not deleted. Two files with
  the id `invoice.get` are refused.
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

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

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
   runs, because nothing says an invoice is being issued or paid.
2. No. The rule forbids filling in any default. A default hides the fact that nobody
   decided. It also makes the log show `high` as if someone chose it. And there is no
   safe default for every field the rule covers. The contract is refused, so its author
   decides.
3. At start-up the mistake is found before any caller can reach anything. A refusal per
   call lets the program run, and the mistake waits for the first unlucky caller.
4. No. Only a command must declare `idempotency`. A test for each side of the rule
   proves that the registry asks it of commands and not of queries.
5. Because one mistake stops the whole program. If only the first problem is named, the
   author fixes it, restarts, and meets the next one, again and again.

</details>

## Think it through

_To be written after the review, with the result of every break in the table above._

Found while checking the design against the schema, before any code:

- A contract with no `kind` gets two misleading problems as well as the true one. A
  schema `if` about `kind` passes when there is no `kind`, so both `then` rules apply:
  the command fields are asked for, and `effect` must be `read`. "Name every problem"
  also names problems that are not really there. The true one, "must have required
  property 'kind'", is always in the list.
- The specification's rule against a general tool, DSOR-OPR-03a, has no step in the
  map yet.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-OPR-01 | Every operation has a contract that validates against `operation-contract.schema.json` | [§7 Operations and the operation contract](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract), and [`operation-contract.schema.json`](../../../packages/spec/schemas/operation-contract.schema.json) | _to be counted_ |
| DSOR-OPR-02a | The registry rejects a contract that omits a mandatory field | [§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract) | _to be counted_ |
| DSOR-OPR-02b | The registry never fills in a default for risk level, execution semantics, effect, or idempotency | [§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract) | _to be counted_ |

**Next:** step 04, result and error envelopes.
