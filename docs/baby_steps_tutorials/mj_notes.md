# Notes beside the mj_ builds

These are our own thoughts while learning DSoR through the `mj_` learner builds. They
are notes, not decisions. Nothing here changes the specification, the map, or anyone
else's work. When a note becomes a decision, it moves to the place that owns it: the
spec through a pull request, a step's README, or the `build-baby-step` skill.

## Questions for the specification

Things a step ran into that the specification does not settle. Each is a thought to
raise, not a proposal yet.

### Can a money amount have more decimal places than its currency has?

`{ value: "100.50", currency: "JPY" }` passes DSOR-MON-01, but the yen has no
smaller unit. Somewhere later, a bank refuses it or rounds it without saying so, and
[§6.1](../../specs/dsor/01-model.md#61-canonical-scope) says data must never be rounded
quietly. Against a blanket rule: a unit price like `0.0035 USD`, and the steps inside a
tax calculation, need more places than a currency has. A rule, if one is needed, would
cover only amounts that are paid or settled. The spec has no word for those yet. Look
again at step 17 (payments) or step 26 (money arithmetic).

### How can anyone test that a URI holds no name?

DSOR-RID-01b says a display name must never appear in a canonical URI. But the
schema's tenant pattern, `^[A-Za-z0-9_\-]+$`, accepts `acme`, and
[§5](../../specs/dsor/01-model.md#5-resource-identity) never says what a tenant id
looks like or who makes it. A test that only reads a URI cannot tell `acme` from
`org_456`. Our step 02 fixed a form of its own, `org_` and digits, and says that it is
our decision. The rule really bites at the moment an id is made: whatever creates
tenants must never make an id out of a name. Tenants are first created in step 10, so
that is the place to think about this again.

### Can a list of undo operations be empty?

The contract schema says a `compensatable` or `saga` command needs
`execution.compensated_by`, the operations that undo it. A command that can never be
undone needs `in_flight`, the records no other command may touch while it runs. But
the schema accepts `compensated_by: []` and `in_flight: {}`. Both fields are there, and
neither says anything. `compensated_by` can also name an operation that has no
contract. Step 03 found this in review and left it open. The question for the spec:
should "required" here mean "present and not empty", and must each named operation
exist?

Steps 04 and 05 recorded their questions in
[`research/open-questions.md`](../../research/open-questions.md#found-by-the-baby-steps-added-2026-09-26)
instead: 19 and 20 from step 04, and 21 to 25 from step 05. Each one rests on a
sentence of the specification, so it belongs with the specification's open questions.

## Our builds, compared with another learner's

Another learner builds the same steps on the branch `wania/dev-DSoR-in-baby-steps`
with the `my_` prefix. We read that work to learn from it. We do not take decisions
from it.

**Step 01.** Both builds keep money as a decimal string and a currency code. Ours
also refuses a `number` that slips past the types (the `typeof` check) and checks the
currency against Node's list of ISO 4217 codes. Theirs locks the stored invoices with
`Object.freeze`, which we left for later because it is a second idea.

**Step 02.** Both builds chose the same tenant form, `org_` and digits, without
talking to each other. Theirs keeps the URI on the invoice as a field. Ours derives it
with `invoiceUri()`. Ours has a test that checks each refused tenant still has the
schema's shape, so the test proves DSOR-RID-01b and not DSOR-RID-01a. We checked one
thing in theirs by running it: `parseUri` accepts an array that holds a valid URI,
because the pattern turns the array into text first.

**Step 03.** They split step 03 in their copy of the map. Their reasoning: step 03
taught two ideas, "a spec sheet is data, and a bad one stops the program" and "the
first action that changes stored state". So step 03 keeps both contracts but runs only
the query, and `invoice.issue` runs from step 04, where a command gives error envelopes
a reason to exist. Our step 03 made the same choice after reading theirs: `invoice.issue`
has a contract, and a call to it is refused as "not built yet". So our build differs
from the map, which has `invoice.issue` change the invoice in step 03. The map itself
is unchanged. We have not yet compared the two step 03 builds.

**Ways of working we noticed.** They run a mutation sweep: break each guard in the
code, one at a time, and check that some test fails. They split a large README review
into five narrow passes, because one large review stalled. We now ask the step's
reviewer for a mutation sweep too.

## Ways of working that helped

- Stop after each section of the skill. Teach and quiz before code. Write "In plain
  words" and "Why it matters" before the first test. All three now live in the
  `build-baby-step` skill.
- One commit per move: copy, teaching half, one rule each, README, review fixes. The
  diff of each commit is one lesson.
- A test can prove the tool instead of the rule. In step 02, the test for "every
  invoice has a URI" built the URI itself, so it only proved that `formatUri` works.
  Ask of every test: would it fail if the rule were broken, or only if the tool were?
- A list with one item cannot catch a function that ignores its argument. Test with a
  second item.
- When the spec is silent and we decide, the README says it is our decision.
- Design first (step 03). Write the claims, the decisions, and predicted breaks before
  code. Then check the design against the real schema before the first test. That
  check found five missing tests. Without them, three of the nine predicted breaks
  would have left every test green.
- A test that expects "no" catches a change that turns "no" into "yes". We predicted
  that `coerceTypes` and `removeAdditional` would survive. Both were caught, because a
  refusal test got no refusal.
- **A friction item for the skill.** Step 03's README has a section, "The design,
  before any code", that the `build-baby-step` skill's README shape (§6) does not
  list. It sits between "Why it matters" and "What changed". If design first stays,
  the skill's heading order should include it.
- **Copied schema files.** A step that copies whole schema files can check them itself.
  Step 03's `test/schemas.test.ts` compares each copy with the original when the
  repository is there, and is skipped outside it. CI runs every step's tests, so a copy
  that drifts fails CI. A `pnpm guard` check for copied files, which we had planned, is
  now optional.
- **Check the design against the rule sentences, not only the schemas** (step 05).
  Decisions 6 and 7 each made sense alone. Together, they let a caller with no login
  get `VALIDATION_FAILED`, an answer before DSoR knew who was calling. DSOR-IDN-01
  forbids that. The check came before the first test, so no code had to change.
- **"Yes" tests pass before any code.** In step 05's red run, the test that the agent's
  own id is accepted passed with no code at all, because nothing said no yet. A "no"
  test passes only once the code that says no exists. Predicting the red run showed it.
- **Which refusal wins is part of the design.** When a call breaks two rules, the order
  of the checks decides what the evidence says. Step 05's review found a bad request id
  hiding an attempt to act as the CFO.
- **Some breaks change nothing a caller can see.** Step 05's sweep made 85 breaks, and
  15 passed. Four of them changed nothing observable, such as a cast that changes
  nothing. Write those down as such, and answer the rest with tests.
- **Name the step in every README reference**, even the step's own: "(step 05's README,
  decision 7)". A bare "(README, decision 7)" is right only in the folder that wrote it,
  and every copy into a later step broke it.
- **A decision's cost is its "Downside".** It was "Price", and in a story about
  payments a reader might take a price for money.
- **A friction item for the skill.** The `build-baby-step` skill does not yet ask for
  three things steps 04 and 05 now do: name the step in every reference, label a
  decision's cost "Downside", and have the review try the §10.2 threats with inputs of
  its own. Step 06 starts with them only if the skill says so.

## Bugs found in earlier builds

A later step's review can find a bug that an earlier build has. The fix belongs in the
earliest build that has it. Then it is carried forward by hand, one build at a time.
Step 04's review found these on 2026-09-26:

- **A query returns the stored record itself** (from `mj_01`). `getInvoice` returns the
  object in the `invoices` list, and from step 04 `call` hands it to the caller as
  `data`. A caller that sets `answer.data.open_amount.value = "0.00"` changes INV-1008
  for every later caller. A read can write. The fix: return a copy, or freeze the stored
  invoices. Freezing was left for later in step 01, and again in step 03.
- **Three weak tests in `mj_03`.** Each one lets a break pass:
  - No test runs the program with a broken contract. A refused start-up that exits
    with 0 passes.
  - No test has a contract file that holds `null`. Without the `continue` after the
    schema's problems, start-up would crash with a `TypeError` instead of naming every
    problem.
  - The name-order test cannot see a missing `.sort()` on macOS, which reads a folder in
    name order anyway. On Linux it might.

Step 05 found two more on 2026-09-26:

- **Comments pointed at the wrong README** (from `mj_04`). Comments copied from step 03
  said "(README, decision N)", and in step 04's folder that meant step 04's decisions.
  Fixed in `mj_04`, then carried into `mj_05`: every such comment now names its step.
- **"This step" in `uri.ts`** (from `mj_02`). The comment says "this step fixes one form
  for every tenant id". Step 02 made that choice, but in every later copy "this step"
  reads as the later step. Not fixed yet.

## Still unknown

- **Whether learner builds belong on `main`.** For now they live on our branch only.
- **The cost of running every step's check in CI.** Every step installs its own
  packages, on two operating systems. Deferred until it matters.
- **Our map and the other learner's map differ at step 03.** That is fine. Both of us
  are learning.
- **What the agent may do before step 18.** From step 06, permissions decide what a
  caller may do. The agent's authority comes from a delegation, and delegations arrive
  in step 18. So steps 06 to 17 must give the agent some authority of its own, or refuse
  it everything. Step 06's design has to choose. Open question 25 asks the
  specification the same thing.
- **Where DSOR-OPR-03a is taught.** The rule says an agent must never get a general
  tool, like `execute_sql` or "call any API". The specification's §7 and step 03's
  story both lead with it. No step in the map names it yet.
