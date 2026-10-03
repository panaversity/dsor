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
  - **Give each parallel agent its own scratch folder.** Two agents saved a copy under the
    same file name, and one restore put `mj_14`'s code into `mj_12` for one break run. The
    agent noticed a column its migrations lack, threw the run away, and redid it.
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
