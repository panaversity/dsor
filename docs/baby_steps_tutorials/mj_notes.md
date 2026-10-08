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
exist? Step 17 refuses all of it at start-up, and recorded the question as open question
64.

### Does a weaker label remove a guard?

The contract schema asks a `non_compensatable` command for two more fields:
`authorization.approve_permission` and `in_flight`. A `compensatable` command needs
neither. So a contract can label `payment.execute` as `compensatable`, name
`payment.refund` as its undo, and pass the schema with no approver. A refund needs the
vendor to act, so it is not an undo that DSoR can run. The schema cannot see that. We
found this on 2026-10-03 with the real schema. The question for the spec: must a
compensating operation be one that DSoR can run to the end by itself?

### Which error code does a denial under DSOR-IDN-06 use?

DSOR-IDN-06 says DSoR denies a command when the delegator's authority is older than the
§44 bound. It names no error code. `AUTHORIZATION_DENIED` means "never retry", but the
company directory can come back a minute later. Until the spec says, step 19's design
must choose.

Step 19's design chose `FRESHNESS_UNSATISFIABLE`, retry `after_delay` (step 19's decision 4),
and found a second question beside it. DSOR-FRS-02b, the rule that defines that code, also
says "not fall back to a cache". Step 19 keeps the directory's last answer for an outage, and
uses it while it is younger than the bound. Is an answer inside the bound of DSOR-IDN-06 fresh,
or is it the cache that DSOR-FRS-02b forbids? And does DSOR-IDN-06, which says "command", cover
an agent's reads? Step 19 refuses them too (decision 5). Recorded as open questions 73 and 74.

### Which constraints does DSOR-DEL-02 cover, and what if DSoR cannot check one?

DSOR-DEL-02 computes authority from "the delegation's grants and constraints". The slip's
schema holds a time window, a list of counterparties, resources, and limits. Only the
limits have rules of their own (DSOR-DEL-06a to 06e). No rule names `time_window` or
`counterparties`. And no rule says what DSoR does with a constraint it cannot check, such
as `approved_vendors_only` before vendor records exist. DSOR-MON-04 and DSOR-CTL-07 answer
"restrictively" for limits and controls. The question for the spec: does the same hold
for every constraint on a slip?

### What does a token with no scopes allow?

DSOR-DEL-02 puts the token's scopes into the intersection, and DSOR-DEL-01b says a token
never widens a slip. But a token can carry no scopes at all, and this tutorial's tokens
carry none. If "no scopes" means everything, the token never narrows. If it means
nothing, every agent call is refused. The spec does not say which.

Steps 04 and 05 recorded their questions in
[`research/open-questions.md`](../../research/open-questions.md#found-by-the-baby-steps-added-2026-09-26)
instead: 19 and 20 from step 04, and 21 to 25 from step 05. Each one rests on a
sentence of the specification, so it belongs with the specification's open questions.

Step 16 recorded its questions there too:

- 57: what a row-level security policy says.
- 58: who besides `dsor_runtime` may touch DSoR's store.
- 59: how often DSoR checks its store.
- 60: a foreign table on a real database.
- 61: a store that takes a record and keeps no row.
- 62: a foreign table that seems to share a transaction.
- 63: a security check that reads look-alikes in `public`.

Step 17 recorded three:

- 64: an undo list that is empty, or names nothing DSoR can run.
- 65: what a caller hears when the record fails after a command ran.
- 66: whether a payment's link to its invoice is `invoice` or `invoice_id`.

Step 18 recorded six, the first two from this page:

- 67: which constraints DSOR-DEL-02 covers, and what DSoR does with one it cannot check.
- 68: what a token with no scopes allows.
- 69: which slip decides the refusal when none is usable.
- 70: which code a suspended slip gives.
- 71: whether anyone but a person may sign a slip.
- 72: whether the running example's slip should run out on 2026-12-31.

### Who may lift a slip's hold?

Recorded as open question 76. Step 19b's decision 16 renamed a hold a suspension.

DSOR-IDN-07 says DSoR suspends every slip of a signer whom the role source reports as
suspended or deprovisioned. No rule says who may turn a suspended slip on again. DSOR-DEL-04a
names who may revoke a slip (its signer and a tenant administrator), and DSOR-OPS-01d says an
agent's suspension is lifted only by a person who holds `control:suspend`. Nor does IDN-07 say
how fast the slips change, or whether a report from one company's role source reaches the
person's slips in another company. Step 19b's design must choose, until the spec says.

### Is `none` a concurrency strategy?

§23 lists three strategies: `optimistic`, `pessimistic`, and `connector_managed`. The contract
schema, `operation-contract.schema.json`, allows a fourth: `none`. DSOR-CON-01a says that every
command must declare a strategy. If `none` counts, a command can declare that nothing is
checked, and the rule asks only for a word. Step 21's learner build accepts `none` at start-up,
and no shipped command declares it. Should §23 name `none`, and say which commands may use it?

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
- **A friction item for the skill, now closed.** The `build-baby-step` skill did not ask
  for three things steps 04 and 05 do: name the step in every reference, label a
  decision's cost "Downside", and have the review try the §10.2 threats with inputs of
  its own. Since version 2.2.0 (2026-09-26) it asks for them, and for the design written
  before any code. Every build from `mj_01` to `mj_06` carries that copy.
- A suite behind one gate tests the gate (step 12). Ask the reviewer to plant operations
  that leak, and see whether the suite notices. The first version of step 12's suite
  passed all three.
- **A test can pass before its code, in two ways** (step 13). Five times the learner
  predicted red and saw green. A "yes" test passes while nothing says no: "exactly 64 KiB
  is answered", and "a cursor of 64 characters is accepted". A "no" test passes when
  earlier code already says no: C1's `"type": "integer"` refused the limits 1.5 and
  `"10"` before C4 existed, and step 12's code already said no to `invoice.peek`. Neither
  kind proves the new code. Only a break that turns it red does. Before a red run, ask of
  each test: which code already answers this?
- **The cap must hold where the rows are read** (step 13). The mutation sweep found that
  a handler could ask the store for a million rows, and the SQL could read 1,000 extra,
  and every test stayed green, because the page was cut afterwards. Test what the store
  is asked for, not only what the caller receives.

- **A "no" test can pass for an earlier step's reason** (step 15). Ten "a broken label gives
  `INTERNAL_ERROR`" tests passed before any code: the label rode on the invoice as a field
  with no label holding an object, and step 14 refused that. They turned red at C1 and
  passed again only with C4's check. Ask which code answers a test before trusting a red run.
- **A new refusal can hide an older check** (step 15). "A query that read nothing is
  refused" made planted code that answered from memory fail anyway, so deleting step 10's
  answer check left three suite tests green. Take the new check last, and let planted code
  read first, so each older test still fails for its own reason.
- **A field that differs on every call breaks exact comparisons** (step 15). Each answer's
  read time made step 12's in-company pair differ by a millisecond, now and then. Set such
  fields aside where answers are compared, as the request id already was.
- **Edit by script, all or nothing.** Check every anchor in every file before writing any
  file. One half-applied run had to be found and redone (step 15).
- **Give each parallel agent a scratch folder of its own** (the step 09 fixes,
  2026-10-03). Seven agents carried one fix into seven builds at the same time. Two
  agents saved a copy under the same file name, and one restore put step 14's code into
  step 12. That agent saw a column that step 12's migrations do not have. It discarded
  the run and ran it again.
- **"No warning" is a signal, not a guard** (the step 09 fixes, 2026-10-04). The test
  for the pool's pin expected no warning from PostgreSQL. A pool that skipped the pin
  sent no `SET LOCAL`, so nothing warned, and the test passed. Now the test records each
  statement and expects the exact list. This is Habit 1 in a test: credit for a question
  that the check does not ask.
- **Guessing test counts did not teach** (step 17, 2026-10-04). The build asked, again and
  again, how many old tests a change would break, and how many new tests would fail. The
  learner said: "always asking me to guess next count of tests which make me feel lost and
  i answer randomly". The answers show it: 0 for every change, then 28, 76, 4, and 1. A
  count is a fact about this repository's tests, not about DSoR. The questions that
  taught, in the understanding sessions, asked what DSoR does: who is refused, at which
  line, and whether the draft is there.
- **Time a slow hook directly** (step 18, 2026-10-05). vitest's JSON report gives a file's
  start time after its `beforeAll` hook, so the hook's own time never shows there. Step
  18's cross-company database suite looked fast alone, and seemed to stall for 200 seconds
  after the slips tests. Logging the time inside the hook showed 194 seconds alone and 237
  after: a slow suite, not a stall.
- **Count skipped tests, not only failures** (step 18). When a `beforeAll` hook runs out of
  time, vitest reports the file's tests as skipped. A run that listed only failures missed
  five skipped tests for one commit.
- **Run each break as a pair** (step 18). Every prediction for B1 to B4 described DSoR with
  its check still in place. Running each story on the step as built, then on the broken
  copy, showed the learner's answer beside the break's.
- **A rule proved in memory is not proved on the database** (step 18). The sweep found that
  the code that turns a database row into a slip could drop its limit, its parent, or its
  modes with every test green: each rule was tested only on slips in memory. Each rule that
  a row must carry now has a database test too.
- **Name the folder even for a reviewer who only reads** (step 18). The README's reviewer, told
  to edit nothing, made a copy of the step to run checks in, in the scratchpad folder that
  held the build's break scripts, and deleted it after. The build rebuilt its scripts from the
  session. Every agent now gets the name of the one folder it may write in.
- **Ask which idea led to the answer** (steps 20 and 21, 2026-10-07). The same wrong answer came
  four times in step 21's part 1. Explanations and runs side by side did not move it. A question
  whose options were the possible reasons did: the learner picked two, and each one got its own
  answer. Then one line of code, traced with the run's values, and the learner ran the script
  with two values in their own terminal.

## Bugs found in earlier builds

A later step's review can find a bug that an earlier build has. The fix belongs in the
earliest build that has it. Then it is carried forward by hand, one build at a time.
Step 04's review found these on 2026-09-26:

- **A query returns the stored record itself** (from `mj_01`). `getInvoice` returns the
  object in the `invoices` list, and from step 04 `call` hands it to the caller as
  `data`. A caller that sets `answer.data.open_amount.value = "0.00"` changes INV-1008
  for every later caller. A read can write. The fix: return a copy, or freeze the stored
  invoices. Freezing was left for later in step 01, and again in step 03. **Fixed on
  2026-09-26:** `getInvoice` returns a copy, with a test, in `mj_01` and every build
  after it. From `mj_04`, a second test changes an answer's data and reads again.
- **Three weak tests in `mj_03`.** Each one lets a break pass:
  - No test runs the program with a broken contract. A refused start-up that exits
    with 0 passes.
  - No test has a contract file that holds `null`. Without the `continue` after the
    schema's problems, start-up would crash with a `TypeError` instead of naming every
    problem.
  - The name-order test cannot see a missing `.sort()` on macOS, which reads a folder in
    name order anyway. On Linux it might.

  **Fixed on 2026-09-26**, in `mj_03` and every build after it. The program takes
  another folder of contracts on its command line, and a test starts it with a broken
  one. A test sends `null` beside another broken file. The sort moved into
  `contractFiles()`, and a test hands it names out of order. Each break was put back in
  a copy and was caught.

Step 05 found two more on 2026-09-26:

- **Comments pointed at the wrong README** (from `mj_04`). Comments copied from step 03
  said "(README, decision N)", and in step 04's folder that meant step 04's decisions.
  Fixed in `mj_04`, then carried into `mj_05`: every such comment now names its step.
- **"This step" in `uri.ts`** (from `mj_02`). The comment says "this step fixes one form
  for every tenant id". Step 02 made that choice, but in every later copy "this step"
  reads as the later step. **Fixed on 2026-09-26:** it says "step 02", in `mj_02` and
  every build after it.

Step 06 found two more on 2026-09-26:

- **A key written twice in a JSON file** (from `mj_03`). `JSON.parse` keeps the last
  value and says nothing. So a contract that wrote `risk` twice, or `permission` twice
  inside `authorization`, loaded with one of its two values, picked without a word. Step
  03 had left it open, thinking it needed another JSON reader. **Fixed on 2026-09-26:**
  `keysWrittenTwice()` in `src/json.ts` scans the text that `JSON.parse` accepted, in
  `mj_03` and every build after it, and such a contract stops start-up. In `mj_06` the
  same scan refuses a role written twice in `roles.json`.
- **The guard could not see a pattern whose marker was deleted.** Deleting the
  `// copied from` line above a pattern turned its check off, so a loosened pattern
  passed `pnpm guard`. **Fixed on 2026-09-26:** every pattern that a step's `src/`
  gives a name must say where it comes from, `// copied from …` or
  `// not copied: <why>`. `TENANT_ID` (from `mj_02`) gained the note in every build.

Step 07 found one more on 2026-09-26:

- **`call` could throw** (from `mj_05`). It read the caller's request id before its
  `try`, so a request envelope whose `request_id` could not be read made `call` throw,
  although it promises an envelope every time. JSON cannot carry such an envelope, but
  code in the same program can. **Fixed on 2026-09-26:** the request id is read inside
  the `try`, and a test sends that envelope, in `mj_05` and every build after it.

Step 08 found one more on 2026-09-27:

- **`toEnvelope` could throw** (from `mj_04`). A thrown value can run code of its own
  when DSoR looks at it: a Proxy that throws when asked "is this a Refusal?", or a
  Refusal whose `code` throws when read. `toEnvelope` then threw, so `call` threw with
  the value's own message. From step 08 it also meant line ⑪ never ran, and nothing was
  recorded. Step 04's promise covered what JSON can carry, and code in the same program
  can throw more. **Fixed on 2026-09-27:** the whole of `toEnvelope` sits in a `try`, and
  anything thrown while it looks becomes the fixed `INTERNAL_ERROR` envelope, in
  `mj_04` and every build after it. Two rows in each build's table of bugs failed before
  the fix. Step 08 had first guarded it in its own `pipeline.ts`; that guard went once
  the root was fixed.
- **`envelope.ts` passed 150 lines** with that fix: 156 in `mj_04`, 157 from `mj_05`.
  Step 07 named 150 as the point to split it. The next change to it should split it.

- **Step 11's owner-store test read the log as other tests had left it.** Found on step 15's
  branch made fresh from `main`: on an empty log it failed, and with no `org_789` record it
  had no teeth. It now writes a record of each company first, and may take 60 s, the limit
  of the program it starts. Fixed in step 15, and carried back to steps 11 to 14 on
  2026-10-02.

- **The log trusts an INSERT that kept nothing** (from `mj_09`). Found by step 16's review
  on 2026-10-03. `add` sends its `INSERT` and returns, and never asks how many rows were
  written. The owner added a rule on `dsor.audit`, `DO INSTEAD NOTHING`. Every `INSERT`
  then kept nothing, and the program answered every call and printed "14 calls answered,
  so 14 records were written". A trigger that returns NULL does the same. Step 16 refuses
  such a rule or trigger at start-up, but one added while the program runs is not seen.
  **Done, 2026-10-03, from `mj_09` to `mj_16`** (`c109581`, then one commit per build).
  `add` throws unless its `INSERT` kept one row, inside `inCompany`'s work from `mj_11` on.
  Red first in every build with `DSOR-EXE-03b: a log whose INSERT keeps no row gives no
  invoice, and no record`, which swaps the log's `INSERT` for `INSERT … SELECT … WHERE
  false` on the real database. By hand, once, on a local PostgreSQL where the owner added
  the rule `DO INSTEAD NOTHING`: `mj_09` before the fix answered all 8 calls and kept 0
  rows; after it, all 8 were refused with `EVIDENCE_STORE_UNAVAILABLE`.
- **The login check reads names through the search path** (from `mj_09`). Found by step
  16's review on 2026-10-03, while fixing the same weakness in step 16's catalog read.
  `runtimeRoleProblems` calls `has_table_privilege`, `has_any_column_privilege`, and
  `pg_has_role`, and reads `pg_roles`, `pg_class`, and `pg_auth_members`, by bare name. The
  owner can set `dsor_runtime`'s search path to `public, pg_catalog` and put look-alikes in
  `public` that say "no". Then a login that can change the log passes the check.
  **Done, 2026-10-03, from `mj_09` to `mj_16`.** `runtimeRoleProblems` reads inside a
  transaction of its own that starts with `SET LOCAL search_path TO pg_catalog, pg_temp`,
  and takes one connection as well as a pool. Red first with the owner's child program
  `test/owner-login-check.ts`. A review of the `mj_15` port then found two breaks that
  passed every test: `pg_catalog.` written on the three functions instead of the pin, and
  the pin skipped for the pool's own connections. Fixed on 2026-10-04 in all eight builds:
  the child also plants a `pg_roles` view, and the pool's test requires exactly
  `BEGIN READ ONLY`, the pin, the check, and `ROLLBACK`. In `mj_16`, the catalog read got
  the same two guards, a `pg_class` view and the list of statements, after removing its
  pool's `BEGIN` passed every test.
  **Left open:** the check run on one connection outside a transaction pins nothing,
  because `SET LOCAL` only warns there; no caller does that today. And only an `INSERT`
  that keeps 0 rows is tested. In `mj_09` and `mj_10` the `INSERT` commits before its count
  is checked, so one that kept 2 rows would be refused and kept. From `mj_11` on it is
  rolled back.
- **How both fixes travelled** (the Stage 2 campaign's way). `mj_09` first, by hand, then
  one agent per build for `mj_10` to `mj_16`, each on its own Neon branch, with every diff
  checked and committed one build at a time. Two lessons:
  - **A shared scratch file name let one run use another build's code.** See "Ways of
    working that helped".
  - **Database runs time out under load.** With seven suites on Neon at once, a few tests
    timed out at 30 seconds, in runs before and after the fix. Every rerun was green.

## Proposed for the house list and the map

Proposals only. The analogy list lives in the `write-for-learners` skill, and the map is
the official tutorial's. A learner build does not change either. A maintainer decides.

- **Analogies, from steps 09 and 10.** The **letterbox** (step 09): anyone at the slot
  can drop a letter in and see what is inside, and nobody there can take one out or
  change it. It fits "add, never change", which no analogy on the list does, and it stops
  at the owner's key (step 39). The **bank teller who does not say who banks there**
  (step 10): the same answer whether a name is a customer or not, which is
  DSOR-ERR-01b. Step 10 first used a hotel desk, and changed to the teller. "Tenants of
  one building" is the plain meaning of the word, more than an analogy. Step 10 also
  uses "lock" as §14 does, for one independent check. That is not the list's "lock that
  stays locked when the power fails", and a reader may mix them up.
- **Step 05's envelope, reversed by step 10.** Step 05 ignored any field of the request
  envelope other than `token` and `request_id`. Step 10's decision 11 closes it: `token`,
  `tenant`, and `request_id`, and any other field is refused. The review found
  `{ token, tenant: "org_456", tenant_id: "org_789" }` working in `org_456` with the
  second company ignored. If the official steps follow, step 05's entry in the map should
  say the envelope is closed from the start, so no later step has to reverse it.
- **Step 10's "done when".** See open question 35: "the same answer whether the resource
  exists or not" instead of "the same 'not found'".
- **Analogy, from step 12: the bank's mystery shopper.** A tester the bank sends in,
  posing as a customer. For every service on the bank's list, the new ones too, the
  shopper hands the teller a form that names another customer's account, and expects
  "not your account". Then the shopper asks about their own account and opens the
  envelope: only their own papers may be inside. It reuses step 10's teller. The counter
  is the checklist every call runs, and the back office is each operation's own code.
  Step 12 first used a hotel inspector trying a stranger's key card. The review flagged
  it: "hotel" is already the list's "booking the last hotel room", and the inspector hid
  that every door shares one front desk. Step 12 also renamed its "control call" to
  "same-company call", because a control is a CEL rule in DSoR.
- **Analogy, from step 13: the new clerk, not a library.** Step 13's design used a library
  that lends ten books per visit, with a slip that says where you stopped. The README
  review flagged it as new. It had no picture for the byte cap, and lending removes a
  book where a read only copies it. The learner chose the list's **new clerk** instead:
  the clerk hands over at most ten invoices, never a bundle too heavy to carry, with a
  note that says where the pile stopped, and every handover goes in the logbook. It
  covers both caps, the cursor, and the record, and it stops at the clerk's memory:
  nothing counts the visits.
- **Analogy, from step 14: the blacked-out copy.** A document released with some lines
  blacked out: the bars stay on the page, so the reader knows something was there. It
  fits DSOR-CLS-02b exactly, with the list of what was withheld playing the bars, and it
  stops there: DSoR leaves a field out, it does not cover it. It is not on the house
  list. The hostile review caught a slip in the first wording, "the clerk takes a
  marker": on the house list the new clerk is the agent, so the agent would do the
  hiding. It now reads: the records office blacks out the copy before it hands it to
  the new clerk. A candidate for the list, beside the new clerk.
- **A step for row budgets.** Step 13 leaves the slow read open: a caller can follow the
  cursor to the end, one recorded page at a time. The specification's answer is §19.2's
  row budget: DSOR-CLS-04b, budgets on rows returned per agent principal and per
  delegation over a time window, and DSOR-CLS-04c, never keyed on an identifier the
  caller can mint. Both are L2. No step in the map names either. They need delegations
  (step 18), so they could sit near step 25's emergency brake. Step 13's README first
  said the gap was "recorded in the map", which was not true, and was corrected on
  2026-10-01.
- **Step 12's entry in the map.** "Runs on a fresh Neon branch" needs a Neon API key
  that can delete branches in `.env`; the learner build ran on its own branch instead.
  And "adding a new operation without tenant checks makes this suite fail" is met only
  through the same-company call, because the checklist refuses every foreign URI before
  an operation's code runs (open question 41).

- **The bakery sticker** (step 15, new, flagged by its review): "baked this morning" never
  goes on yesterday's bread. It fits DSOR-FRS-01b, and the README says where it stops: bread
  goes stale by the clock, data when the real record changes.
- **"Before you build" for a Neon reset.** Neon's MCP tool for a password reset returns the
  new password, so it puts the password in the chat. Step 15 reset it through Neon's API
  from a script that printed only the status. The map's setup could say: the console, or
  such a script, never the MCP tool.
- **Analogy, from step 16: the clerk's notebook.** The new clerk keeps a personal
  notebook of past work, notes, and lessons. That notebook is the agent's context. DSoR's
  paperwork is never kept in it, and never copied from it. It fits DSOR-MOD-01's
  "separate from agent context". Step 16's README stops the picture there: the notebook
  does not explain the store's map.
- **Step 16's entry in the map.** The map says of DSoR's store: "It is a second schema,
  `dsor`, in the same Neon database". In the learner builds, step 09 already put the log
  in `dsor`. So step 16's new idea was the map of the store, `store.json`, and the check
  at start-up against it. The map entry could say that. Or step 09 could keep the log in
  `app` until step 16.
- **Step 17's entry in the map: vendors wait.** The map names step 17 "Vendors and
  payments: two more record types". The learner build makes payments only. The draft
  copies the invoice's `vendor_id`, and no check in step 17 reads a vendor. A vendors table
  must exist by step 29: §26.3's approval binds the version of `VENDOR-44`, beside PAY-901
  and INV-1008.
- **Analogies, from step 17.** A payment slip **stamped VOID**: it stays in the file, as a
  cancelled payment stays in `app.payments`. Writing the slip was `compensatable`. Money
  **sent by bank wire**: the office alone cannot call it back, which is
  `non_compensatable`. The first version said "tear the slip up" and "a posted cheque".
  The review found that a torn slip is gone, unlike a cancelled row, and that a cheque can
  often be stopped before it is cashed.
- **Step 17 refuses every agent's command.** The map gives DSOR-DEL-01a to step 18. But
  step 17 is the first step where a command runs, so it must already say what an agent may
  do with one. The learner build refuses every agent's command at line ③, before line ⑤
  looks at a role, and claims DSOR-DEL-01a only in that sense. Step 12's cross-company
  suite then asks line ③'s own question to pick its attackers. If the official steps
  follow, step 17's entry could name DSOR-DEL-01a, "refused until step 18".
- **The map's steps 35 and 36: money before its note.** Step 35 builds `payment.execute`,
  which sends money. Step 36 writes the note before the side effect (DSOR-EXE-03a, 03b).
  So for one step, a payment can be sent and leave no record. AGENTS.md lists
  DSOR-EXE-03b among the six rules that are easiest to break. Step 36 could come before
  step 35, or step 35 could start with the note.
- **The build skill's questions** (`00_foundation`'s `build-baby-step`, learner mode). It
  says to ask "which new tests will pass before any code exists". Step 17's copy now asks
  what DSoR does in the story, never about tests, and settles each answer with a real run
  (2690f49). See "Guessing test counts did not teach" above. The official skill could say
  the same.
- **Seven delegation rules have no step on the map.** A scan of the map against
  `requirements.json` on 2026-10-04 found no step for DSOR-IDN-07 (a fired person's slips
  are suspended), DSOR-DEL-09 (two slips and no name is a refusal), DSOR-DEL-04b
  (revocation within the §44 bound), or DSOR-DEL-05a to 05d (subdelegation). IDN-07 fits
  step 19, beside the role source that reports a firing. DEL-09 fits step 18 or 19.
- **Step 18's entry in the map: "up to a limit".** The map says user_123 allows the agent "to
  create payments, up to a limit, until a date". Limits are checked from step 24. So the
  learner build's slips carry no constraints, and a slip that carries one is refused (step
  18's decision 6). The entry could drop "up to a limit", or step 24 could add the limit to
  `del_100`.
- **No step lets a person sign a slip.** Step 18's learner build writes its slips with a
  migration (step 18's decision 3), and step 25 tears slips up. No step adds an operation
  for a person to sign one. A command for people only, never for agents, that grants no more
  than the signer holds, could come beside revocation in step 25.
- **Step 18's entry in the map: two more rules.** Step 05's entry gives the slip part of
  DSOR-SRC-02b to step 18, but step 18's entry lists only DSOR-DEL-01a, 01b, and 02. And
  once the slip's signer is the subject, DSOR-IDN-03a asks the company to be one where the
  signer works. The learner build met both after its review (step 18's decisions 17 and 18).
  The entry could list them. DSOR-DEL-07 and DSOR-DEL-08 arrived early too, from step 19
  (decision 1).
- **Step 19b, the leaver's slips (DSOR-IDN-07).** An earlier bullet here put DSOR-IDN-07 in
  step 19, beside the role source that reports a firing. Step 19's design split it out (step
  19's decision 6): building it inside step 19 brings a second idea, DSoR's first write to its
  own slips, with the problem of two writes in two orders. Step 19 refuses a suspended or
  deprovisioned signer's agent at line ③ and leaves the slip `active`. Step 19b, built right
  after it, suspends every slip the person signed and records the change, with the audit
  record's kind `delegation_change`. Step 25's revocation could then reuse that write. The
  map could add the step, or give DSOR-IDN-07 to step 25.
- **Analogies, from step 18.** A slip **torn up**, for a revoked one: it fits "it no longer
  works", and misleads where the slip must stay in the table, so step 18's README says that it
  stays there as `revoked`. The map's step 25 says "Tear up the permission slip". **Lock**, for a check that
  keeps a company apart: step 11's two locks are DSoR's own `WHERE` and row-level security.
  Step 18 adds a third check on the slip it gets, and calls it a check, not a lock.

## The Stage 2 review (2026-10-01)

Six reviewers audited steps 10 to 14 on 2026-10-01: one per step, and one for the seams between steps. Each worked in
its own copy outside the repository. The orchestrator then re-ran the most serious findings on the final code.

**The verdict: no live leak.** With today's data, agents, and operations, no reviewer found a way for one company to:

- read another company's data,
- use another company's roles,
- learn whether another company's invoices exist,
- drain a table,
- or see a masked field.

Every break count a reviewer re-ran matched its README. What they found sits one step further out. Some guarantees
hold only because of today's data. Some holes sit at the seams, where one step trusts another. And some sentences say
more than the code does.

**The high finding.** Both locks trust the company that the operation's code hands to the store. Two runs on step 14
showed it:

- A one-line fallback in `invoice.get` let `user_700`, in `org_789`, read `org_456`'s `INV-1001`, and all 761 tests
  passed.
- An answer with `tenant_id` rewritten to the caller's company gave `cfo_100` `VENDOR-77` and 99,000.00 USD, and the
  mystery shopper reported nothing.

The learner chose to fix the high finding and every medium one in the step that introduced each, and to carry each
fix forward through every later folder. The fixes are F1 to F9:

| Fix | Origin step | What it closes |
| --- | --- | --- |
| F1 | 07 | One JSON copy of the input, made at line ①. Before this, ① and ② checked the raw input, and line ⑥ copied it again for the code |
| F2 | 10 | A company id of at most 18 digits, and a size cap on the record's `extensions`. One refused call had left a 1 MB record |
| F3 | 10 | A store bound to the active company, and a check that every `tenant_id` in an answer is the active company |
| F4 | 11 | A transaction counts only when its `COMMIT` really committed |
| F5 | 11 | The start-up check's `BYPASSRLS` and membership facts, tested on the real database |
| F6 | 11 | The guard for tenant tables: every schema, every view, and every `SECURITY DEFINER` function |
| F7 | 12 | The shopper searches for values only the other company has, tests its judge through the suite, and checks an operation's own "not found" |
| F8 | 13 | The shopper walks every page of a list, and the 64 KiB backstop is tested at its edge |
| F9 | 14 | A clearance that is not one of the four labels gets `public`. Labels apply at every depth. A row is any kind with `tenant_id` and `id`. A redaction never copies a key |

**Done, on 2026-10-01.** Each fix was written red first. An agent made each folder's fix, and the orchestrator
ran the folder's checks and committed it. Every folder's own tests pass, unit and database, and the repository's
`pnpm check` exits 0 after each.

| Step | Commit | Fixes | Unit tests | Database tests |
| --- | --- | --- | --- | --- |
| 07 | `b6cc3ce` | F1 | 441 → 451 | — |
| 08 | `5916fed` | F1 | 477 → 489 | — |
| 09 | `2f5e1ac` | F1 | 501 → 513 | 28 |
| 10 | `e463f6c` | F1–F3 | 576 → 628 | 39 → 45 |
| 11 | `44fc939` | F1–F6 | 577 → 629 | 61 → 75 |
| 12 | `ccbc75a` | F1–F7 | 628 → 719 | 64 → 80 |
| 13 | `b35da68` | F1–F8 | 669 → 774 | 75 → 92 |
| 14 | `f4c7015` | F1–F9 | 761 → 924 | 82 → 100 |

Commit `8d18292` carried F5 back to step 09, because a hostile pass found that the start-up facts dated from
there.

What the extra passes found:

- The fixes had their own hostile passes, and these found more:
  - **Step 10.** The answer check first checked the code's live object and then sent it, so a row changed after
    returning leaked. Now it checks and sends one JSON copy.
  - **Step 12.** It found five gaps in the new shopper.
  - **Step 13.** The orchestrator found a walk that checked only pages 1 and 2.
  - **Step 14.** A caller type DSoR did not know, such as `Agent`, was not masked.
- **The four probes, re-run on step 14.** The orchestrator re-ran them after the fixes:
  - the rewritten-`tenant_id` leak now gives 18 findings;
  - the one-way fallback is refused;
  - a clearance spelled `INTERNAL` reads as `public`;
  - a million-digit company id leaves a 383-byte record.

**Low findings, recorded and not fixed now:**

- **Spellings and text matching**
  - `active_tenant`, the specification's own spelling in `security-context.schema.json`, is not among the four checked
    tenant fields. Neither are `Tenant`, `tenant_ID`, or a tenant field nested deeper (step 10).
  - The URI check reads only the start of a text. `" dsor://org_789/…"` and `"see dsor://org_789/…"` reach the code.
    Nothing leaks today, because the code reads inside the active company (step 10).
- **Records and history**
  - When a non-member names a company in the envelope, the record keeps it. When a caller names one in the arguments,
    the record does not (step 10).
  - The log on `step-10`, and on every branch made from it, holds 1,128 records from before migration 002 with no
    tenant. It also holds 30 `ALLOW` records with no tenant, written while break U6 ran against the database, and the
    39 records rewritten in step 09. From step 15, a fresh branch.
- **Database privileges (step 11)**
  - `REPLICATION` is not refused at start-up. With it, logical decoding would read every company's rows. Neon's
    `wal_level` makes that unreachable today.
  - `dsor_runtime` holds `TEMP`, so a temporary table would trip the "owns no table" check.
  - These show volume across companies: `pg_stat_user_tables`, `reltuples`, `EXPLAIN ANALYZE` with no company, and the
    gaps in the audit counter.
  - `pg_stat_activity` shows another `dsor_runtime` session's SQL text. DSoR passes values as parameters, so today it
    shows no data.
- **Pages (step 13)**
  - `capped` can report a cut that did not happen: `org_789` asking for 50 gets its 5 rows and `capped: { asked: 50 }`.
  - `next_cursor` is whatever id is stored, and `app.invoices.id` has no CHECK. So DSoR could hand out a cursor it then
    refuses.
  - No migration pins the ordering of ids, `COLLATE "C"`. On a database with another default, memory and Postgres
    could page differently.
- **Answer shapes (step 14)**
  - A `__proto__` key in an answer changes the copy's prototype instead of adding a field.
  - Map, Set, and Date values survive the deep copy and measure as `{}` against the 64 KiB limit.
  - Redactions name only the fields a row actually has, so an optional withheld field shows, row by row, whether it is
    present.
  - Principals of type `application` and `system` are not masked. The specification allows it.
- **Tests**
  - `pnpm test:db` runs the owner's migration from step 10 on. It needs the owner's key and resets `dsor_runtime`'s
    password on every run.

## Understanding sessions

From step 17, each step starts with a session that writes no code. The session teaches
the step in small parts, one in each turn. A real run settles each prediction, and each
part says what production needs. The session ends with the design questions that the
design session starts from. The `understand-baby-step` skill in `.claude/skills/` holds
the method.

**Why this order.** Steps 01 to 16 taught inside the build. Understanding then shared
each session with decisions, tests, and commits, and many predictions were about test
counts. When understanding had a session of its own, each question was about what DSoR
does, and a real run answered it within a minute.

### Steps 08 to 20, for production (2026-10-03)

- **Habit 1: credit for a question the check does not ask.** Step 09's start-up check
  asks six fixed questions, so `GRANT UPDATE ON app.invoices` passed it. Step 12's test
  that expects no findings still passed with the judge removed.
- **Habit 2: a "yes" that DSoR cannot prove now.** A map that matches the database but
  breaks its kind (step 16). A refund called an undo (17). An active slip after its
  signer left (18). A directory answer 30 hours old (19).
- **Parallel requests do not take turns (step 20).** A claim in two steps, first ask
  and then insert, gave 12, 6, and 7 payments in three runs of 50 requests.

### Step 17, before design (2026-10-04)

- **Habit 1 again, three times.** A label is more than a word: `non_compensatable`
  makes the schema ask for an approver. A valid answer is not a true answer: a made-up
  proposal URI passes the schema. Line ⑤ never sees the amount: `checkPermission`
  reads no part of the request.
- **Design questions for Phase A:**
  1. The shape of a command's answer. `COMMITTED` needs a proposal (step 22) and a
     payload hash. Build small ones early, or use a tutorial shape that is recorded as
     not meeting DSOR-SCH-01.
  2. Who writes `app.payments`. Step 16's `business` kind allows only `SELECT`. Add a
     kind for company records that DSoR writes, or a second login that stands in for a
     connector.
  3. Whether the agent is refused `payment.create` until step 18, because DSOR-DEL-01a
     asks for a delegation.
  4. `compensatable` or `atomic` for a draft that one transaction writes.
  5. Start-up checks that each undo list is not empty and names a real operation. See
     "Can a list of undo operations be empty?" above.
  6. How `payment.cancel` refuses a payment that is not a draft, before preconditions
     arrive in step 32.
  7. Which roles get `payment:create` and `payment:cancel`.

### Step 18, before design (2026-10-04)

- **Habit 1 again: credit for a check that does not exist yet.** We expected a firing to
  suspend the person's slips. That is DSOR-IDN-07, and it needs a role source that reports
  the firing. In step 18 nothing tells DSoR, and no step on the map names the rule.
- **Habit 2's family: a "yes" taken without asking whose.** With two slips that could
  cover a request, we expected DSoR to use the first. Then the order of rows in a table
  decides whose name goes on a payment. DSOR-DEL-09 refuses instead.
- **Design questions for Phase A:**
  1. Which way the agent calls. "Beside a logged-in person" needs token exchange (step
     45), and "alone at night" has its own rules (step 19).
  2. Whether `ap_agent` keeps its read role until step 19. DSOR-DEL-01a covers commands;
     DSOR-DEL-07 covers every unattended request, reads too.
  3. Where slips live: a table on the step 16 map, its kind (a slip's status changes),
     row-level security, and who may write a slip. Never the agent.
  4. The constraints step 18 cannot check yet (vendors, limits): leave them off the
     tutorial's slip until their checks exist, refuse, or skip and record DSOR-DEL-02 as
     partly met. See "Which constraints does DSOR-DEL-02 cover" above.
  5. The time window: check it now in the slip's time zone, or wait. No step names it.
  6. Token scopes: this tutorial's tokens have none. See "What does a token with no
     scopes allow?" above.
  7. Two slips and no name (DSOR-DEL-09): build it here, or record it.
  8. A fired person (DSOR-IDN-07): step 18 cannot see it. Record it, and propose it for
     step 19.
  9. The record: `identity` (mode, subject, actor chain, the source and time of the
     authority) and `delegation`. The schema requires `identity`, and DSOR-DEL-10 is on the
     map only at step 45.
  10. The code for a slip past its date: `DELEGATION_EXPIRED` or `DELEGATION_REQUIRED`.
  11. What line ⑤ checks for an agent: the effective set, not the agent's own role.

### Step 18, the design (2026-10-05)

- **Eleven decisions, each with a spec sentence or a real run,** are in step 18's README.
  Question 11 above became decision 5: line ③ finds a usable slip, and line ⑤ checks what the
  slip and the signer both allow.
- **Every break was predicted with its check still in place.** B1 to B4 each delete one check,
  and each prediction gave the answer of the unbroken DSoR, after a note on what a break is,
  and after a sketch of B3. The answers reason from the data ("there is no slip in org_456")
  and not from the code that is left. This is Habit 1 once more: credit for a question that no
  line asks any more. The build should run each break as a pair, the learner's case beside
  the real one.

### Step 17, again after the build (2026-10-04)

The learner missed all three Check-yourself questions of step 17. A second session took each
miss as one part. Real runs on `mj_17`'s code, and on a local PostgreSQL, settled each one.

- **The lines need names, not only numbers.** "Lines that ran: 1, 2, 3, 11" meant nothing
  until a table gave each line its question: ③ asks for a person's slip, ⑤ for a permission,
  ⑨ runs the code, and ⑪ writes the record. Teach that table before a run that lists lines.
- **"The role decides", a second time (Habit 1).** Step 14 expected a role to decide what a
  caller sees. Here, `payment:cancel` added to `ap_agent` was expected to let the agent
  cancel, and line ③ still refused it. Four runs side by side settled it: line ③ in place or
  removed, and the role with or without the permission. Only "removed" and "with" cancelled.
- **A rule of the specification, credited to the step's code (Habit 1, as with step 18's
  firing).** Twice, for a create and for a cancel, the learner expected DSOR-EXE-03b's
  answer: `EVIDENCE_STORE_UNAVAILABLE`, and nothing changed. In step 17, line ⑨ commits
  before line ⑪, so a failed record leaves the change, and the caller hears `INTERNAL_ERROR`
  (decision 17). The learner's answer is right for a call that never reaches line ⑨, such
  as the agent's. Plain SQL showed the root: a failure takes back only the writes of its own
  transaction. Two transactions, as in step 17, kept the cancel. One transaction, as step 36
  plans, took it back.
- **What a check asks.** An opposite operation does not make a command `compensatable`.
  Start-up asks whether DSoR can run the undo: a contract, a command, code, and a role that
  may run it. With no role for `payment:cancel`, start-up refused the label, and the opposite
  still existed. The learner then chose `non_compensatable` for `payment.execute` with a
  refund, as the specification's own example contract does.
- **Design questions:** none new. Step 18's eleven stand, and question 11 has more weight:
  a role alone must never let an agent act.
- **The re-check missed too, and showed the belief underneath: an error answer means that
  nothing happened.** After `INTERNAL_ERROR`, the same request was sent again. The learner
  expected one draft. The run gave two, PAY-901 and PAY-902, and one record, for PAY-902
  only. In most programs an error comes before the act. Here it comes after line ⑨. The
  picture tried next: the bank teller posts the deposit, then finds the bank's journal
  locked, and says "something went wrong". The deposit stays.
- **What landed it: the old rule, and where it stops.** For 16 steps every operation read,
  so "fail closed" (the door that stays locked when the power fails) always left the world
  as it was. But a locked door keeps a person out only while the person is outside. A sketch
  of two writes in two orders, with one journal that fails, showed that only the order
  decides. The learner then placed a refusal at line ⑥ before the cancel, and a failure at
  line ⑪ after it, right. The run also showed the log and the table disagree: the log holds
  one refused cancel, and the table holds a cancelled PAY-901.
- **To check again at step 20.** Step 20 exists to stop the second draft, so its session can
  start from the retry run.
- **Part 1, told a second way, landed half.** From step 06 to step 16, the role decided
  every call. That is still true for reads and for a person's commands, and the learner got
  the read right. Three checks of the order then missed: an empty role, a broken input, and
  cfo_100's broken cancel. Each answer named the plainest problem, not the first line that
  says no. DSoR does not weigh problems. It walks the lines in order and stops at the first
  no. The gap is older than step 17: in step 09, the learner placed ⑤ before "which
  operation?". Seven real calls in one table showed the pattern. Then a page for practice,
  "Walk the Checklist" (a private artifact): 15 real calls of step 17, walked one line at a
  time, each reason checked by a script against its run.

### The foundations course, and step 19 before design (2026-10-05)

After step 18's build, the learner asked to start again from zero: the spec in a logical
order, with diagrams and everyday examples. Eight short lessons in the chat, one picture for
the whole course (an office: the agent is a new clerk, DSoR the checking desk), and practice
pages for the parts that did not land.

- **The root gap was order, not facts.** Five answers in a row named line ⑤ for problems that
  line ③ stops first. Asked how they chose, the learner said "the action's problem decides":
  the reason closest to the request feels like the real one. DSoR does not weigh reasons; it
  walks the lines and stops at the first no. A practice page that walks each line, yes or no,
  fixed the order where four-option questions had not.
- **Token and slip were one idea in the learner's picture.** "Who issues a slip, when we have a
  token?" A token comes from the login system and says who is calling (line ①). A slip is
  signed by a person, kept in DSoR's own store, and read at lines ③ and ⑤. The spec names no
  operation that creates a slip, and no step builds one: migration 010 stands in. The bank
  mandate was the picture that landed: the bank keeps the mandate in its own file.
- **Questions must carry every fact.** The learner caught two practice questions that left out
  a fact the walk needs: the company on the envelope, and the CFO role's list. Every practice
  question now has a fact card, and the role table stays on the page.
- **A label read literally.** "③ A usable slip?" invited "no" for a person, who has none. The
  line is now "③ slip check (agents only)", and its full question is written out: is the slip
  alive, does it fit the call, and does its signer work here.
- **Still loose at the end:** the signer is checked twice. Where she works is line ③'s
  question, and what she may do is line ⑤'s. And line ② asks about the caller, line ③ about the
  signer. Step 19 is about exactly this, so it moved on with this gap named.
- **Step 19's habits, from its understanding session:** "the desk waits" (DSoR never holds a
  request; with no fresh answer it denies at once), and "turned off means revoked" (a suspended
  slip is not torn up; the spec gives it no code of its own, open question 70).
- **Design questions for step 19's Phase A:** the role source's form (a fake directory, or a
  role table DSoR reads at every call); whose roles it answers (the absent signer only, or
  people calling for themselves too); the freshness limit and whether DSoR keeps the last
  answer with its time; which line and which code refuse when no fresh answer exists; reads or
  commands only; DSOR-IDN-07 (suspend a leaver's slips) now or later; and the two breaks (the
  directory switched off, a signer demoted while the agent runs).

### Step 19, the design (2026-10-05)

- **Nine decisions, chosen by two tests the learner named.** At decision 2 the learner answered
  with a question: "which goes near to production and deep understanding". From then on every
  recommendation said how it met both tests. The learner chose the recommended option in all
  seven decisions they chose directly. For decisions 2 and 8, the recommended option was taken
  by those two tests after the learner's answer.
- **Two answers came back as questions, and both helped.** For DSOR-IDN-07 the learner asked
  when a split step would be built, and then what building it inside would cost. A story of
  the five things line ③ would then do, with step 17's two writes named, settled it: step 19b.
  For the setting's place the learner answered "a or b". Checking option b showed that its
  "step 10's company table" does not exist. Every fact inside an option needs checking before
  the question goes out, not after.
- **Break predictions: 2 of 4 as expected.** B1 and B2 matched. B3 followed the broken lookup
  to its end and left out the check that stays (C10): the opposite of step 18's habit. B4
  described DSoR with its time limit still in place: Habit 1 again. Step 18's predictions were
  0 of 4. The fact card in every question may be what changed.

### Step 19, the build (2026-10-05)

- **A prediction that matches the code is not yet a right answer.** Before the green run the
  learner predicted C10's story: a strange answer at 01:40, the directory off at 01:50, and the
  agent answered on the 01:30 answer. The run agreed, and Claude Code said "right". The
  hostile review then showed that this behaviour broke decision 11's own reason, so the
  prediction, the test, and the code were wrong together (H1). Settle a prediction against the
  decision's reason too, not only against a run.
- **A check that moves can lose part of what it asked.** Step 18's signer check asked two
  questions: is she a person, and does she work here. Step 19 moved it to the directory, which
  answers only the second, and a slip signed by an agent drafted a payment (H2). When a check
  moves, list each question it asked, and ask each one again in its new place.
- **"Aren't we logging all?"** The learner took the kept answer for the log. A two-column table
  (the log is for people afterwards, and DSoR never reads it to decide; the kept answer is
  DSoR's note for the next outage) and a sticky note beside a filing cabinet settled it.
- **Predictions in the build:** the restart (part 5 of the program) right; C10's story right
  by the code, wrong by the decision; breaks 2 of 4 at design time (B3 left out the check
  that stays, B4 kept the 2-second limit in place).
- **Deleting data stays the learner's.** The learner asked three times for Claude Code to delete
  Neon's `step-13`. It would not, and the learner ran the command, one click.
- **Neon from here:** each call took 2 to 3 seconds, so `pnpm start` took 66 seconds, and the
  program's tests now wait up to 180. The step adds no table.
- **Check yourself: 2 of 5 right, and half of the fifth.** Q1 used H1's bin for a silent
  directory: the note goes in the bin only after a strange answer, and silence reads it. Q3 sent
  a job change to line ③: a change of status stops at line ③, and a change of job at line ⑤,
  the ③-and-⑤ split again in a new form. Q5 gave the right code and predicted step 19b's write
  to the slip. One card settled all three: what the directory says, and where DSoR stops.

### Step 19b, before design (2026-10-06)

Step 19b is this learner build's own step: DSOR-IDN-07, split out of step 19 (step 19's
decision 6). Five parts: the gap and the rule, every slip she signed, the change and its
record, coming back, and two calls at once. Real runs on step 19's code, and on a throwaway
PostgreSQL in the scratchpad for the transaction and the race.

- **"Turned off means revoked", the third and fourth time.** Part 1 answered
  `DELEGATION_REVOKED` for a suspended slip, and its re-check answered `revoked` for a person
  who left for good. The everyday phrase "revoke her access" pulls hard. What the rule says:
  IDN-07 suspends, for "deprovisioned" too, and a hold is lifted by a person, while a torn-up
  slip never comes back. A three-row card (on hold, torn up, past its date) closed the part.
- **Step 17's rule, carried inside a transaction.** Part 3 kept the first write when the
  second failed, which is right without a transaction. A plain SQL side-by-side (each write on
  its own: `del_100` on hold and one record; one transaction: nothing changed) gave the rule
  its missing clause: unless both writes are inside one transaction.
- **Design questions for step 19b's Phase A:** which of her slips (only the reporting
  company's, or every company's); when (only at a call, or also a sweep of every signer); a
  new store question, every slip a person signed; the new database right, `status` only; the
  holds and their `delegation_change` records in one transaction, and whether the call's own
  record joins it; the record's `identity` for a change DSoR makes on the directory's word;
  who lifts a hold, and through what; a call that heard "suspended" just before an admin's
  lift; and the breaks (the record fails, two calls at once, she comes back, one slip lifted).

### Step 19b, the design (2026-10-06)

- **Eight decisions, each chosen by the two tests the learner named,** closest to production
  and deepest understanding: the folder `mj_19b_suspended_slips`; only the reporting company's
  slips; only at a call; `UPDATE (status)` only, with a new kind in `store.json`; the holds and
  their records in one transaction at line ③; the record names DSoR itself; no lift through
  DSoR before step 25; a hold that cannot be written gives `INTERNAL_ERROR`; and "not listed"
  counts as gone. The learner took the recommended option every time.
- **Break predictions: 3 of 4 as expected.** B1 (no hold), B2 (no company filter: the second
  lock holds), and B4 (two transactions: holds without records) matched. B4 shows that Part 3's
  transaction lesson landed. B3 kept "only if still active" in place after the break deleted
  it, so a torn-up slip stayed `revoked` in the prediction: Habit 1, credit for a check that no
  line asks any more.
- **Nothing is committed,** by the learner's rule from 2026-10-06. The project's `CLAUDE.md`
  asks for each built piece to be committed; the learner's rule wins on this branch.

### Step 19b, the build (2026-10-06)

- **"The database cancels both".** The learner predicted that two calls at once leave no record
  of a suspension. A scratch PostgreSQL ran the same two transactions three ways: as built (the
  second waits, reads again, changes nothing: 1 record), under SERIALIZABLE (the database does
  cancel, but only the second: still 1), and without "only if still active" (2). The instinct
  is half right: a database cancels on a collision, and one side always wins. The last hotel
  room carried it: the second clerk finds the hook empty.
- **B3 at run time, as at design.** The broken copy turned the torn-up `del_101` into a
  suspended slip, with a record. The prediction described the step as built: Habit 1 again,
  credit for a check that the break had deleted.
- **A right on a column limits the column, not the words in it.** The review's highest
  finding: `GRANT UPDATE (status)` let `dsor_runtime` write `active` over `revoked`. A
  restrictive row-level security policy (migration 012b) now allows one change only, active to
  suspended. It was tried on a scratch database before the learner chose it.
- **A word already taken.** "Hold" is the specification's word for a resource held while an
  outcome is unknown (`RESOURCE_HELD`, `hold_on_unknown`), and `AGENTS.md` lists "holds"
  in the control-plane store. The step now says "suspend", the rule's own word. These notes
  keep "on hold" where they quote the learner.
- **Decisions 12 to 16:** DSoR's own log reader reads decisions only; the database allows only
  active to suspended; the record carries the call's whole correlation (DSOR-COR-01a); an
  answer that says she is not active needs no roles; and the word "suspend". The learner took
  the recommended option each time.
- **Facts the build got wrong, and fixed:** migration 012 ran four minutes into the first
  database run, while the notes said it had not run; the database test files run one at a
  time, so per-test signers exist because a suspension is permanent; and the first message,
  "could not put", claimed more than DSoR knew: "could not confirm".
- **A scratch PostgreSQL as the sweep's database.** The whole database suite in 44 seconds,
  against 20 minutes on Neon, and breaks that would have suspended the story's real slips on
  the shared branch ran there safely. Two changes made it behave like Neon: the owner joins
  `pg_write_all_data`, and the cluster checks passwords.
- **Sweeps:** 33 breaks first, 9 survived (two only changed an order). After the fixes, 18
  breaks, all caught, among them the policy made permissive.
- **Nothing is committed,** by the learner's rule from 2026-10-06.

### Step 20, understanding (2026-10-07)

Five parts were planned: the lost answer, one insert, the fingerprint, the four parts of a
claim's scope, and the claim inside the transaction. Part 1, the lost answer, ran on step 19b's
own code: a retry of `payment.create` for INV-1008 drafted PAY-902 beside PAY-901, and the log
held two records with one request id. The learner predicted it. The learner stopped at part 2
and was away for the rest of the step.

- **Design questions left for Phase A:** where the key travels; its form; whether a query may
  carry one; which parts make up a claim's scope, and whether the contract's version is one;
  what a fingerprint covers; whether the claim and the work share a transaction; what a replay
  returns, and how it is masked; and what a refusal from the code leaves behind. Claude Code
  took all of them while the learner was away: step 20's README, decisions 1 to 13.

### Step 20, the build (2026-10-07)

The learner was away and asked for steps 20 and 21 to be built, with every decision taken by
the learner's two tests: closest to production, and deepest understanding.

- **§22's last paragraph reversed a decision.** Decision 9 first let a refusal from the code
  keep no claim. "A recorded `DENY` is replayed like any other result": a late copy of a refused
  request must not draft after the caller has moved on. The claim now keeps the code's refusal,
  and only an accident, an `INTERNAL_ERROR`, or a `safe_same_key` refusal releases it.
- **Break B1, measured.** Look first, then insert: one draft, because the primary key still
  held, and 9 of 50 callers heard `INTERNAL_ERROR`. Without the primary key: 10 drafts of
  31,400.00 USD. The `SELECT` protected nothing.
- **A green suite that tests less.** The cross-tenant suite passed while every command it sent
  stopped at line ⑦ for want of a key. It sends keys now.
- **A test that two callers pass cannot see a missing company.** B2 needed one caller,
  firm-ap-fte, in both companies. The review found the same gap on the database for the caller
  and the operation: user_123 heard the agent's PAY-902.
- **A test that passes when nothing happens.** Nothing deletes a claim, so the 24-hour test
  passed with an age command that aged nothing. It now reads the age from the database's clock.
- **Local PostgreSQL again,** because every Neon branch is in use: the full database suite in 50
  seconds. The learner can delete `step-11` and make `step-20` from `step-19b` later.
- **Review and sweep:** the reviewer's 35 breaks left 15 survivors; after the fixes, 32 breaks,
  all caught. Final: 1388 unit tests, 217 database tests, the clean copy, the root check.
- **Nothing is committed,** by the learner's rule from 2026-10-06.

### Step 21, the build (2026-10-07)

Built while the learner was away, after step 20, with every decision taken by the learner's two
tests. No understanding session yet: it is owed, with step 20's parts 2 to 5.

- **The lock that was not allowed.** The first plan locked the invoice with `FOR SHARE`. A real
  run refused it to `dsor_runtime` (`42501`): a row lock needs a right to change the table. The
  check moved into the write itself, `INSERT … WHERE EXISTS` and `UPDATE … WHERE version`, which
  is optimistic concurrency's own form.
- **The story must match what the caller sees.** The first story was a credit note, but the
  agent's clearance hides amounts. A changed payee, VENDOR-44 to VENDOR-99, is a failure the
  agent can see. A run of step 20's code drafted PAY-901, 31,400.00 USD to VENDOR-99.
- **A test that two outcomes pass cannot tell them apart.** A payment changes only when it is
  cancelled, so the status alone refused every stale cancel. Only a draft changed outside DSoR,
  still a draft, shows the version doing its work: break B4.
- **The review's two highest findings:** a trigger switched off passed start-up, because
  PostgreSQL prints it as if it were on; and the check held only at `READ COMMITTED`, which DSoR
  now sets itself. That also closes the level that step 20's claims relied on.
- **Review and sweep:** the reviewer's 29 breaks left 10 survivors; after the fixes, 29 breaks,
  all caught. Final: 1434 unit tests, 234 database tests on a local PostgreSQL, the clean copy,
  and the root check.
- **Nothing is committed,** by the learner's rule from 2026-10-06.

### Steps 20 and 21, understanding after the build (2026-10-07)

Both steps were built while the learner was away, so this session came after the build. Step 20
resumed at part 2. Step 21 had five parts: the changed payee, who raises the version, the check
is the write, facts first, and what a version cannot see. A real run settled every answer: the
step's own code in memory, scratch copies that followed the learner's rule, and a local
PostgreSQL 17.

- **A new habit: "DSoR's own read replaces the caller's claim."** Step 17's rule, "DSoR reads the
  facts itself", was stretched over `expected_version`. The learner expected a draft on the
  version that DSoR reads now: with no version, with a screen's version, and with a wrong
  version. But a version is a claim about the caller's own decision. DSoR reads the invoice to
  check that claim, never to replace it. Four predictions in step 21's part 1 came from this one
  idea.
- **Habit 1 again.** Step 20's part 5 named it. In step 21, line ⑥'s pass got credit for "may
  this run?", but line ⑥ asks only whether the input is well formed. The trigger got credit for
  "did a value change?", but it runs at every `UPDATE`.
- **Habit 2's family again.** In step 20's part 4, a claim's scope was taken as the slip
  signer's, not the calling principal's. In step 21, "a draft on the current version" said yes
  to a decision that nobody can show was made on that version.
- **What moved the new habit.** Two explanations and two runs side by side did not. A question
  that listed the possible reasons found it: the learner picked "DSoR reads facts itself" and "a
  valid input runs". Then line 70, traced with the run's values, and the learner's own run of
  `node future21.ts 1` and `2`. From then on, the predictions reasoned with versions. Part 4's
  prediction joined the two steps: the same key with a new version hears
  `IDEMPOTENCY_CONFLICT`, because the version is part of the fingerprint.
- **The learner's own design.** A trigger with `WHEN (OLD.* IS DISTINCT FROM NEW.*)` raises the
  version only when a value changes. It removes decision 2's downside: a caller sent back for a
  save that changed nothing. A scratch run showed its cost: a row with a `json` column cannot be
  compared (`42883 operator does not exist: json = json`).
- **Wording to fix in step 21.** The migration's first comment and the README's definition of a
  trigger say "at each change of a row". Both mean every `UPDATE`, also one that changes no
  value. The learner read "change" as "a value changes".
- **Design questions for a later revision of step 21:**
  1. Should a save that changes no value raise the version? Every `UPDATE` (now: any table, but
     callers read again for nothing), or a real change only (the learner's trigger: fewer
     refusals, and no `json` columns).
  2. A row removed and added again restarts at version 1 (open question 87). A scratch run
     drafted PAY-905 to VENDOR-99 on a decision made on the old row. Options: one sequence for
     every row's version, a content hash, or no removal of invoices.
  3. A counter is easy to guess. A draft with a guessed `expected_version` of 1, and no read,
     passed. Accept it, because the check is about change and not about reading, or use a
     version that is hard to guess.
  4. There is no `payment.get`. After a stale cancel, the refusal's message is the only place
     where a caller finds the payment's version (decision 7).
  5. Only start-up reads the triggers, so a trigger switched off while DSoR runs is not seen
     until the next start. Check at each command, check on a timer, or accept it and record it.

### Step 22, before design: two parts, then decide and build (2026-10-07)

- **Built in another order.** After part 2 the learner asked whether to build first and understand
  after. Claude Code recommended a middle way: take the decisions now, build, and finish parts 3
  to 5 on the real code. Before the build every run was a sketch, and part 1 had felt ambiguous.
  The learner chose that.
- **Part 1, told again.** The first telling put three places, a dump of JSON, a list of schema
  errors, and the spec's example in one turn, and its question offered a "stale" call decided on a
  version higher than the record's. The learner called half of it ambiguous. Told again as one
  story in time order, with one picture of the four states and one question, it landed: a replay
  with the same key names the same proposal, and makes none.
- **The decisions, all the recommended ones:** COMMITTED and FAILED are final; a refusal from the
  code ends FAILED; two guards, DSoR's code and a trigger; the answer names the proposal; the move
  to EXECUTING is one conditional statement. Two followed from the spec and were stated, for the
  learner to object to: no proposal before line ⑧, and the whole picture built.
- **A fact found after a decision.** DSOR-AUD-01 makes every proposal transition an audit record.
  It was found while reading the code for the build, after the learner had chosen "a table of its
  own" for the history. The decision went back to the learner, and changed to the log.
- **Questions for the specification:** open questions 89 to 91.

### Step 22, the build (2026-10-07)

Built after the learner's decisions, while the learner was away.

- **The schema cannot hold the picture.** `proposal.schema.json` lists the 17 states and no move:
  a record with PENDING_APPROVAL to EXECUTING in its history passes it. So the moves live in
  DSoR's code and in a trigger, and a database test compares the two, move by move, from every
  state, the three that nothing reaches yet too.
- **Where line ⑧ sits in the claim's transaction is the design.** Opened inside the savepoint of
  the code's work, a refusal rolled the proposal back with the work, and the call ended
  INTERNAL_ERROR with no proposal (break B3). Opened before it, the proposal ends FAILED and
  keeps its records.
- **Two guards, each shown holding alone.** With the trigger gone, `dsor_runtime`'s own UPDATE
  moved a COMMITTED proposal back to READY (B1). With DSoR's check gone, the database refused the
  same move with the same words (B2).
- **The review's highest finding: an upgrade that breaks replays.** A claim answered before
  migration 015 keeps no proposal, and its replay would answer INTERNAL_ERROR forever. Migration
  015 now refuses a database whose claims hold answers. And any code could name a proposal,
  another company's too, in a refusal of its own: only the checklist names it now, from the claim.
- **Three sweeps.** 33 breaks of the step's pieces, 29 caught. The reviewer's 26, rewritten for
  the fixed code, with one of the migration's guard: 27, 20 caught. The 11 that survived each
  reached a part no call of the story reaches, and each part got a test of its own. A third run
  caught all 8 it ran.
- **A JavaScript trap, found live.** `String.replace` reads `$$` in its replacement as one
  `$`. A script that inserted the migration's guard wrote `DO $`, and the migration failed on a
  fresh database. Edits by script now use split and join, which read nothing.
- **Nothing is committed,** by the learner's rule from 2026-10-06.

### Step 23, the decisions and the build (2026-10-08)

The learner chose to build step 23 first and understand steps 22 and 23 together after, as with
steps 20 and 21. Seven decisions in two rounds, each with a recommendation; the learner took every
one. Claude Code built the step while the learner was away.

- **The decisions.** No `proposal.execute` until step 31. A dry run runs lines ① to ⑥ only. Its
  "no" is the real call's error envelope. The mode travels in the envelope, and a key keeps its
  mode. The `.propose` permission is built, and ap_clerk gets `payment:create.propose`. A dry run
  carries no key. A query carries no mode, not even `execute`.
- **A missing stop that fails closed.** With the dry run's stop deleted, the dry run went on to
  line ⑦, which asked for a key. A dry run carries none, so it was refused, and wrote nothing
  (break B1). One decision guarded another.
- **One word between "prepare" and "pay".** With the `.propose` form wanted in every mode, the
  clerk's agent drafted PAY-903 in `execute` mode (break B3).
- **A key that forgets its mode answers the wrong question truthfully.** A call that asked to
  prepare heard that a payment was made, and a call that asked to execute heard READY while nothing
  ran (break B2).
- **No re-indent.** Lines ① to ⑩ became one function, `decide`, which returns where each mode
  stops. Its body kept its place, so the diff shows the change and not the move.
- **A false kill in the sweep.** `store.json` changed, and only the database tests ran after it.
  One unit test then failed with no break at all, and it "killed" 13 database-side breaks. The
  test was fixed, and the 13 ran again. Before a sweep, run both tiers on the step itself, and read
  which test killed each break.
- **The review: no guarantee broke, and four gaps had one cause.** In `propose_only` mode no code
  runs, so the checks before line ⑦ are the whole guard, and only `payment.create` was tried in
  the new modes. A copy where only `payment.create` heard the mode cancelled PAY-901 when asked
  to prepare its cancel, and every test passed. Now every command is tried in each mode, and step
  12's cross-tenant suite runs in both new modes too.
- **A spec tension, found by the review.** A dry run that learns its signer is gone suspends the
  signer's slips (DSOR-IDN-07), though DSOR-OPR-06 forbids a dry run's side effects. Kept, and
  recorded as open question 95.
- **The README review caught a false promise.** Decision 2 said step 32 would bring the version
  check before the work. It does not: §21 checks the version at line 14, after a dry run returns.
- **`.env.example` is the learner's to copy.** The deny rule on `.env.*` stops Claude Code from
  reading or writing it, so the copy of step 22 left it out, and one test fails until it is there.
- **Next: one understanding session for both steps:** step 22's parts 3 to 5, then step 23, on the
  real code. Three points from step 22 to tell the learner: the reviewer's challenge to decision 1
  (M1, open question 89), the order of the records (M2), and decision 15, which Claude Code took.
- **Nothing is committed.**

### Step 24, built overnight (2026-10-08)

The learner asked for step 24 too, and went to sleep: "also do 24 then we will understand these 3".
No one could answer questions, so Claude Code made every decision, each marked "(Claude Code)" in
the README with its downside, for the learner to review before the session on steps 22 to 24.

- **The one big choice: how DSoR knows what a command spends.** The specification does not say
  (open question 99). The contract says it: `payment.create` binds its invoice, and spends the
  invoice's open amount. DSoR reads it itself at line ⑨, before the limits at line ⑩, so a dry run
  can check the limits too.
- **Line ⑩ before the work.** READY and EXECUTING moved after it, as step 22 promised, and a
  refusal there ends a proposal DENIED. The code's work runs after line ⑩ with no number.
- **Step 23's decision 2 is extended,** not reversed: a dry run now runs lines ⑨ and ⑩, which are
  DSoR's own and write nothing. The learner should confirm this.
- **The story's del_100 keeps no limits in the shared database.** A day's spending carries from run
  to run. The program tells the limits in memory, and the database tests use del_190 for intake-fte.
- **Breaks, measured.** Read, check, then write: fifty drafts at once made 25, and the day held
  785,000 USD against 200,000. FAILED that releases nothing kept 31,400 USD for a draft never made.
  A dry run that reserves: six questions filled the day.
- **Tests after the code, this once.** The code came first, against red first. The tests then
  failed against step 23's code, at import. The sweep is the real proof: 40 breaks, and every one
  now fails a test, after three new tests (two daily limits on one slip, the day's first amount
  alone over the limit, and a replay of a refused draft on the database). One "kill" was a syntax
  error, not a test, and was run again as a real break.
- **The review's high finding: the limits checked one amount, and the code drafted another.** Line
  ⑨ read the invoice at one version, and the code read it again. An agent that named the next
  version drafted 120,000.00 USD under a reservation of 31,400.00, on the real database. Now the
  work drafts only on the version line ⑨ read (decision 16). The first build's decision 2 said
  step 21's version check covered this gap. It did not, because the caller chooses that version.
- **A decision reversed by the specification.** Decision 9 said a prepared call reserves nothing,
  because DSOR-DEL-06c does not name READY. §21 and §26.4 say otherwise: only a dry run takes no
  reservation. A prepared call reserves now. The learner should look at this one first.
- **Three smaller fixes.** A replay of a denial was recorded ALLOW (decision 17). A refused
  prepared call could not be replayed on the database. A paid invoice's 0.00 hit a database check
  as an accident (decision 18). And a slip with a limit of `-5` refused every payment (decision 19).
- **Seventeen breaks left every test green,** though the code was right in most of them. Each got
  a test. A third sweep then ran them again with each fix undone: 21 of 23 failed a test. The two
  left, the day's first amount equal to the limit and the day taken from the session's time zone,
  got database tests. The time-zone test runs in two sessions, twelve hours behind UTC and fourteen
  ahead, because the test database's own Karachi zone shares UTC's date for 19 hours a day.
- **The unit tests' group names did not match the README's claims.** The groups said C1 to C6, and
  the README's claims are C1 to C15. Each group now names the README's claims.
- **Nothing is committed.**

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
