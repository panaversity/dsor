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

### Who is a tenant administrator?

DSOR-DEL-04a says a slip "MUST be revocable by its delegator and by a tenant administrator", and
§26.1 lets "the requester or a tenant administrator" call `proposal.cancel`. The specification
defines no role and no permission for a tenant administrator, and the running example has none.
Step 25's design proposes a role of the tutorial's own, `tenant_admin`, held by a new person,
`admin_100` (decision L2). Should the specification name the role, or a permission for it?

### May an agent pull the emergency brake?

DSOR-OPS-01d lets only "a human holding `control:suspend`" lift a suspension or a freeze, and §45
says that agents "never lift suspensions". Nothing says who may *pull* the brake. A watchdog
agent could stop a runaway agent in seconds, at 03:10, when no person is awake. A compromised
agent could freeze every agent in the company. Step 25's design recommends people only, both
ways (decision L6). Should §18 say who may apply a suspension or a freeze?

### What happens to a READY proposal when its slip is torn up?

DSOR-DEL-04c cancels the slip's PENDING_APPROVAL and APPROVED proposals, and §26.2 draws no move
from READY to CANCELLED. So a draft prepared in `propose_only` mode stays READY under a torn-up
slip, with its booking held. It can never run, because the release checks the slip again. Its
record says "allowed, may go" about work that can never go (open question 90; step 25's decision
L4). In the understanding session of 2026-10-10, the learner expected the tear-up to cancel it
with the rest. A scratch copy with two lines changed did that, in memory: the tear-up cancelled
three proposals, not two, and the day's total fell to 31,400.00 USD, not 62,800.00. On the
database, the trigger would still refuse the move until its picture changed too. Should §26.2
draw READY → CANCELLED, and should DSOR-DEL-04c name READY?

**Proposed by the learner (2026-10-10): yes, and READY can expire too.** The change to propose:
§26.2 draws READY → CANCELLED and READY → EXPIRED; DSOR-DEL-04c names READY beside
PENDING_APPROVAL and APPROVED; a new requirement gives a READY proposal an expiry. DSOR-DEL-06d
already releases the booking at CANCELLED and at EXPIRED. One more reason: §26.1 gives the
requester `proposal.cancel`, and today the picture lets nobody cancel a prepared draft. The
learner asked for it to be built too. It is one new idea, so it gets a small step of its own, and
that step's README names this proposal. Built on 2026-10-10 as step 25c, `mj_25c_ready_can_end`
(open questions 90, 96, and 105).

### Should a suspended agent's dry run be refused?

§18 says a suspended agent "can make no state change". A dry run makes none, so the words allow
it. Step 25b refuses it (decision L7), because a dry run must hear what the real call would hear
(step 23's decision 3). AWS answers the same way: EC2's `DryRun` gives `UnauthorizedOperation`
when the real call would be refused. **Proposed by the learner (2026-10-10):** §18 says that a
suspension or a freeze refuses a command in every invocation mode, `validate_only` included. No
code changes: step 25b does this already (open question 104).

### May a connector use a system's own MCP server?

Raised by the learner on 2026-10-17, before step 34: "won't most banks make their own MCP as
well, and MCP is more like an API call, so why redefine?" Our reading: MCP is how a call travels;
a connector is DSoR's contract for one system, which holds its keys and states what it guarantees.
A bank's MCP server could sit underneath a connector, never beside the agent. The specification is
silent, so this is open question 145.

### Who should pick a stale rule's `on_stale`?

The learner's view on step 28b (2026-10-17): `require_approval` during a stale rule's grace makes
even a 640 USD invoice wait for the CFO for up to seven days, and "it's a problem". Our reply: it is
the price of not guessing, and the fix is a fast new version and a short grace, not a softer rule.
Still open: whether the rule's owner or the company should choose `on_stale` and the grace.

### Where does a run keep its totals per vendor?

Found while designing step 41 (2026-10-20). DSOR-BAT-02a binds a run's approval to its totals per
currency and per counterparty, and `proposal.schema.json` has a field only for the first. Step 41
keeps the second in `vendor_totals`, a field of its own. This is open question 159.

### How does DSoR tell an agent's token from a person's own login?

Found while the learner questioned step 43d (2026-10-26). An approval counts only from the
approver's own `direct` login (DSOR-APR-05a), never through anything that travels via the
requesting agent (DSOR-APR-05b). But in MCP's normal flow (MCP 2026-07-28), an agent's MCP client
asks for a token for its user: `sub` names the person, and `client_id` names the agent's client. A
DSoR that reads only `sub` takes the agent's call for the person's own.
[§37](../../specs/dsor/05-bindings.md#37-identity-binding) shows a token for `on_behalf_of` (with
`act`) and one for `unattended` (`sub` is the agent). It shows none for `direct`, and it does not
say how DSoR knows one. Options found, none chosen:

- every token carries `client_id`, and DSoR treats each client as an agent unless DSoR lists it as
  its own approval app;
- the approval app is a resource of its own (RFC 8707), so a token for the MCP door does not work at
  the approval door;
- an agent always holds an exchanged token with `act` (RFC 8693), never a plain one.

### Is an MCP token for a person, held by an agent, the agent's own credential?

Found while the learner questioned step 43d (2026-10-26). In MCP's usual flow, a person connects an
agent once, and the agent's client keeps a refresh token. At 2 a.m. the agent's token says `sub` is
the person and `client_id` is the agent, though the person is absent. That is neither of
[§37](../../specs/dsor/05-bindings.md#37-identity-binding)'s two shapes: `on_behalf_of` (RFC 8693,
with `act`) or `unattended` (`sub` is the agent, DSOR-RP-10 and DSOR-RP-11). DSOR-IDN-02a says an
agent authenticates with its own credentials, never a human's session. If DSoR records `client_id`
as the actor (DSOR-IDN-02b) and takes the authority from the slip, the purpose of DSOR-IDN-02a may
still hold. Neon Auth's OAuth path offers only this flow, because it has no `client_credentials`
grant. To raise: does the spec accept this token as an agent's own credential, at L1 and L2, and
what must DSoR check before it does?

### Should a suspension cancel the slip's waiting work?

Found in step 43d's part 5 (2026-10-26). A revocation or an expiry moves the slip's
`PENDING_APPROVAL` and `APPROVED` proposals to `CANCELLED` (DSOR-DEL-04c). A suspension, when the
role source reports the signer gone (DSOR-IDN-07), says nothing about them. In step 43c, after
user_123 left, the agent's release of the approved PAY-901 was refused at line ③. So the proposal
stayed `APPROVED`, with 31,400.00 USD booked, until its expiry seven days later. Nothing makes a
suspended slip active again: no command does it, and step 19b keeps a suspension when the signer
returns. So the waiting work can never run, and it fills approval queues and holds bookings. Only
an administrator's tear-up cancels it. To raise: should a suspension under DSOR-IDN-07 also cancel
the slip's waiting work, as DSOR-DEL-04c does for a revocation?

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

### A race test that fails while its draft is on its way (found 2026-10-09)

- **Where:** `test/limits.db.test.ts`, the test of a draft decided on the invoice's next version, in
  step 24 (`mj_24_limits_with_reservations`). Step 25 copied the same pattern into
  `test/revocation.db.test.ts`.
- **What:** the test holds a row lock from a second connection, and its `finally` releases that
  connection with no ROLLBACK. When the test fails before its COMMIT, the row stays locked and the
  draft stays on its way. The next test's owner script runs with `spawnSync`, which blocks the
  test process, so the draft can never finish, and the script waits for its lock until its time
  limit. Step 25b's reviewer hit a 10-minute pile-up.
- **Fixed in:** steps 25 and 25b. Their `finally` rolls back, releases, and waits for the draft.
- **Still in:** step 24. Repeat the fix there by hand, if step 24 is run again.

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

### Step 25, the design before the session (2026-10-09)

The learner read the story page of steps 22 to 24, then asked for step 25's design: "design 25
… and then 22-25 will be understood after that". So this design came before the step's
understanding session, against the usual order, at the learner's request. Steps 22 to 24 were
committed and pushed on 2026-10-08, at the learner's request: c155f8f, f6dbc25, 6bd3909,
2a36250, and bf56a81 for the `.env.example` files the learner copied in.

- **The folder:** `mj_25_revocation_and_the_emergency_brake`, a copy of step 24, with
  `.env.example` this time. Its README holds the design only. Its code and tests are step 24's.
- **Nothing is decided.** Nine questions for the learner, L1 to L9, each with options, downsides,
  and a recommendation, and ten details that Claude Code proposes, D1 to D10.
- **The first question is the step's size (L1).** Tearing up a slip and pulling the brake are one
  goal and two mechanisms. The recommendation is to split them, 25 and 25b, as 19 and 19b were.
- **The hardest question is the race (L8).** Line ④ runs before the claim's transaction, so a
  draft can pass line ④ a moment before the brake, and still enter EXECUTING. The recommendation
  checks again inside the claim's transaction, under a lock that the brake takes alone.
- **Step 24 already has part of it:** line ③ refuses a torn-up slip with `DELEGATION_REVOKED`,
  and reads the slip from the store at every call, which meets §44's L3 bound for revocation.
- **Two words that look alike:** step 19b suspends slips, and step 25 suspends agents. The README
  warns about it, and the session should check that the difference landed.
- **Two questions for the specification,** above: who a tenant administrator is, and whether an
  agent may pull the brake. They go to `research/open-questions.md` at the hand-over.
- **Next:** the understanding session of steps 22 (parts 3 to 5), 23, 24, and 25. Then L1 to L9
  through the ask tool, one at a time. Then the build.
- **Nothing is committed.**

### Step 25, the build and the review (2026-10-09)

The learner asked for the build before the understanding session: "first complete 25 build",
then "Keep 25b, then 26". So Claude Code took each recommendation of the design, and marked each
decision "(Claude Code)", for the learner to review.

- **The folder** became `mj_25_revocation` when decision L1 split the step. Step 25b, the
  emergency brake, is a folder of its own.
- **The README names its decisions as the code does:** L1 to L5 for the design's questions, D1
  to D15 for the ones found while designing and building. The first README numbered them 1 to
  16, and most of the code's references pointed nowhere.
- **The first sweep:** 35 small breaks. 26 were killed, 8 survived and got tests, and 1 was
  killed by accident, by a test that timed out under load. Two mistakes: two sweeps ran at once
  on one database, and two tests waited on the whole server's locks.
- **The review:** two medium findings and five small ones. The check of who is asking ran inside
  the work, after DSoR had said yes, so a refusal was recorded ALLOW, and a dry run said
  VALIDATED (M1). "Revocable by its delegator" held only because every signer was a supervisor
  (M2). All were fixed red first, except two that are a comment and an open question. A sweep of
  the 18 fixes: 16 killed, 1 survived and got a test, and 1 was caught by a timeout.
- **Lessons for the next builds:**
  - A check that only reads belongs at line ⑨, not in the work. A refusal from the work is
    recorded ALLOW, and a dry run cannot see it.
  - A refusal that tells "not yours" from "not there" tells which records exist.
  - "People only" is `type === "human"`, never "not an agent". A list of what is refused misses
    the type nobody thought of.
  - Inside a claim, read only through the claim's own stores. A read that takes a second
    connection from a small pool can wait for ever.
  - Redact `postgresql://` as well as `postgres://`. A scratch copy's `.env` was printed by
    mistake on 2026-10-09: local passwords only, for the scratch PostgreSQL.
- **For the learner's session:** each "(Claude Code)" decision, and the six that the review
  changed: L3, D3, D4, D7, D13, and D15.

### Step 25b, the emergency brake, built while the learner was away (2026-10-09)

The learner chose the split, "Keep 25b, then 26", and then asked for the build at once: "go ahead,
build 25b after 25 is done". So Claude Code took the recommendations of step 25's design
questions L6 to L9, and marked each decision "(Claude Code)", for the learner to review.

- **The folder:** `mj_25b_the_emergency_brake`, a copy of step 25, database `dsor_step25b`. Step 24's
  markers were still in step 25, and were removed there first; step 25's were removed in 25b.
- **Line ④ is built.** It reads `dsor.brakes` at every call and refuses each command from a braked
  agent, in every mode. The check runs again right after line ⑧, inside the claim, under a
  PostgreSQL advisory lock: shared for an agent's command, alone for a pull.
- **Found while building:** the brake's refusal was masked inside the claim and not at line ④, so
  an agent of low clearance heard two different answers for one brake. Its words are public now.
- **Found by the sweep:** a test that fails must still end. The two race tests left a transaction
  open when they failed, and the file waited for ever.
- **A mistake in the sweep's runner:** a time limit killed `npx`, and vitest went on running
  against the sweep's database beside the next break's run, so the first run's database
  results could not be trusted, and the sweep ran again. Lesson: a time limit kills the whole
  process group. In the end all 28 breaks were killed by the tests meant for them.
- **For the learner's session:** L3, L6 to L9, and D1 to D14 in the README, and the two new
  questions for the specification, 102 and 103.

### Steps 22 to 25b, understanding after the build (2026-10-09 to 2026-10-10)

All five steps were built before this session, two of them while the learner was away. The first
message started in the middle of step 22. It used code names before plain words, and gave no
sentence from the spec and no example from production. The learner rejected it: "your
explanation is failing on all ends i.e: connection to spec, prod systems, real world understanding
and explain in simple english". So each part got the same eight sections: the everyday picture,
the problem, the spec's words, real companies, what DSoR does, a real run, known and unknown, and
one prediction. While the learner was busy, the session became a workbook page: ten parts, every
run done in advance on scratch copies of `mj_22` and `mj_25b`, and the learner's first choice of
each prediction saved in the page's own store. The answers were read back the next morning, and
the two parts marked "not clear yet" were taught again in the conversation.

- **A new shape of Habit 1: "when the slip goes, all its work goes."** Part 8's prediction
  cancelled P3 (READY) with P1 and P2. The re-check cancelled P5, which was EXECUTING. The
  question that listed the possible reasons came back with all four: the slip is checked all the
  time, all open work is cancelled, any state can be cancelled, and stopping is safer. Two of them
  credit a check with a question it does not ask: line ③ asks once for each call, and the
  tear-up's list asks for two states only. What moved it: one run for each reason, then
  `src/proposals.ts:309` traced with each proposal's state, then the learner's own run of
  `node zz-move.ts EXECUTING CANCELLED`. The four runs were a tear-up in the middle of P5's work
  (P5 finished COMMITTED), the five proposals after a tear-up (`cancelled: 2`), the picture asked
  through the step's own `canMove`, and a copy where a tear-up may cancel EXECUTING work. That
  copy left a CANCELLED record beside a payment that was written.
- **Part 9 was predicted right, but all four of its pieces were unclear:** why a dry run is
  refused, why reads work, brake or tear-up, and who pulls and who lifts. One line answered all
  four: line ④ stops a call only when the caller is an agent and the call is a command
  (`src/brakes.ts:126`). The re-check, a brake over a weekend, was right: the waiting work was
  untouched, and reads went on.
- **What worked:** the eight sections, a page that saves only the first choice, and a copy changed
  in two lines, so that the learner's answer comes true beside the real one.
- **A mistake caught before the learner saw it:** every right answer on the first page was A. The
  options were shuffled, and the page was published again.
- **The scratchpad was wiped overnight,** with the scratch database and the outputs of the runs.
  The page and its saved answers live on claude.ai, so nothing the learner did was lost. The runs
  that need no database were made again from the step folders.
- **Design questions for the learner, not decided:**
  1. A READY proposal under a torn-up slip (open question 90): cancel it, as the learner
     expected, or leave it, as the spec says now. The spec changes first, then both guards. For
     step 31, which builds the release.
  2. Should a braked agent's dry run hear AGENT_SUSPENDED (step 25b's decision L7), when §18
     stops only "state change"?
  3. Should a braked agent still read? It can copy out what it reads (the downside of L7).
  4. Who holds `control:suspend` (decision L3: not the CFO), and may an agent pull the brake
     (L6, open question 102)?
  5. What a draft on its way hears when the pull's wait reaches a time limit (finding M1).
  6. One lift releases a brake that two people pulled for two reasons (L9).
  7. Step 26's seven questions, drafted on the workbook page: where the rates live, who writes
     them, where a company's money policy lives, how two amounts are compared, when a rate is too
     old, whether DSOR-MON-06 belongs in step 26, and whether the record keeps the rate now or in
     step 33.
  8. Every decision marked "(Claude Code)" in the READMEs of steps 22 to 25b is still the
     learner's to review.
- **Claude Code's answers for production, asked for by the learner (2026-10-10), not decided:**
  1. Cancel a READY proposal under a torn-up slip, and let READY expire too. `proposal.cancel`
     (§26.1) cannot cancel a prepared draft today either, because the picture has no READY →
     CANCELLED.
  2. Keep L7: a braked agent's dry run hears AGENT_SUSPENDED, as an AWS `DryRun` answers
     `UnauthorizedOperation` when the real call would be refused.
  3. Let the person choose at the pull: stop changes only, or stop reads too, for an agent that
     may be hijacked.
  4. Make pulling wide and lifting narrow: two permissions. The CFO and a watchdog may pull; a
     watchdog may brake one agent only, never freeze the company, and each automatic pull calls
     a person. Only people lift.
  5. Keep the lock's window tiny: no transaction stays open during the bank's call (step 36). A
     draft out of time before EXECUTING is refused and safe to retry; during the call it is
     "outcome unknown" (step 37). A time limit on the pull calls a person, and never skips the
     rule.
  6. One hold for each person and reason, as in lockout–tagout: the agent works again only when
     every hold is lifted.
  7. Step 26's questions: answered one at a time in step 26's session.
  8. Change for production: the limit's day in the company's own time zone (step 24, decision 3);
     a checksum of each guard's body at start-up (step 22, decision 3); the proposal id passed
     to the bank as its idempotency key (DSOR-IDM-03); a dry run for a `.propose` holder (step
     23, decision 5); step-up authentication for an administrator's tear-up of another person's
     slip (step 25, L2); a narrow database path for the tear-up (step 25, D5).
- **The learner's answers (2026-10-10):** 1, propose the spec change, write it in these notes and
  in the README of the step that builds it, and build it (see "What happens to a READY proposal
  when its slip is torn up?"). 2, the same: a proposal, with no code change. 3 and 4, agreed: a
  brake that can also stop reads, and two permissions, wide to pull and narrow to lift. Each
  waits for a step of its own. 5 to 8: not answered yet.
- **The learner's question: should the database not run on UTC, with the time zone in a
  setting?** Yes, for storage and clocks: `timestamptz` and UTC everywhere, as now. A company's
  business day is a separate thing: one DSoR serves companies in many time zones, so the zone
  belongs in each company's policy, not in the server's settings. The day of a limit is then the
  UTC moment seen in that zone, `(now() AT TIME ZONE 'Asia/Karachi')::date`. The setting holds an
  IANA zone name, never a fixed offset such as `+05:00`, because daylight saving time moves the
  offset twice a year in many places. This changes step 24's decision 3, so it waits for a later
  step, and start-up would check the name against `Intl.supportedValuesOf("timeZone")`.

### Step 26, understanding and the decisions (2026-10-10)

The first step taught with the eight sections from the start. Five parts: the PKR hole, exact
comparison, where a rate comes from, no good rate, and the day's total in another currency. The
runs used the spec package's own reference (`packages/spec/src/reference-money.ts`) and its tests,
scratch copies of `mj_25b` in memory, and sketches marked as sketches. The scratch database was
gone, and no part needed one.

- **One miss, settled by its re-check:** a cancelled booking given back "in the invoice's own
  money, 9,000.00 EUR". The run put three ways beside the real spending: the stored 9,782.61 USD
  matches it; Thursday's rate makes 444.66 USD of room from nothing; EUR leaves the USD total as
  it was and takes a EUR total below zero. The re-check, a commit on Thursday that keeps 9,782.61
  USD, was right.
- **The learner's questions:** a company's time zone for the day of a limit (above, for a later
  step), and how currencies are managed in production, which became the step itself.
- **The decisions, all as recommended:**
  1. Rates live in DSoR's own table: one row for each source, currency, and time.
  2. A rate is written by a DSoR command, `rate.load`, through the checklist with a record. A
     scheduled job calls it.
  3. Each company's money policy lives in a file checked at start-up against the spec's
     tenant-policy schema, as `role-sources.json` is.
  4. The database's clock decides that a rate is too old.
  5. Two amounts in different currencies are compared by multiplying across, with no rounding.
  6. DSOR-MON-06 comes into step 26. A booking is converted when it is made, stored in the
     limit's currency rounded up at the sixth decimal place, and given back as stored.
  7. A decision that converted records the rate, its source, and its time in its log record.
     DSOR-MON-05 itself stays step 33's.
  8. Step 25c, a READY proposal that can be cancelled and can expire, is built first, from 25b.
     Step 26 then copies 25c.
- **The design questions, 2026-10-10, after 25c was built,** all taken as recommended: a new
  login `dsor-rates` loads the rates; each company keeps its own; a rate is kept as its source
  wrote it; one conversion takes both rates from the newest sheet; a rate's age counts from the
  sheet's publication, by the database's clock; a sheet is written once; a refusal for no usable
  rate names the cause; a sheet from a source the policy does not name is refused. They are D1 to
  D8 in `mj_26_money_done_right/README.md`.
- **The break predictions:** B1, B4, and B5 as expected. B2, an old sheet used as if fresh, was
  predicted as still refused, "something else in DSoR still finds the sheet too old". B3 showed a
  mistake in the design, not in the learner: the design expected a booking kept in EUR to pass,
  and the learner said it is refused from the first, because step 24's reservation store refuses
  another currency. The learner was right, so B5 was added for this step's own rule, one day's
  total in the limit's currency.

### Step 25c, the learner's proposal, built (2026-10-10)

The learner proposed a change to the specification, "a READY proposal can end", and asked for it
to be built before step 26: "We propose spec change document in ntes and step radmen and implment
tlik this". It is one new idea, so it became a small step of its own, `mj_25c_ready_can_end`,
copied from step 25b, with database `dsor_step25c`. Step 26 copies it.

- **The decisions:** L1 to L3 and D1 to D4 were the learner's, each taken as recommended. D5 to
  D15 are Claude Code's, for the learner to review: D5 to D10 found while designing, D11 while
  building, and D12 to D15 from the review.
- **The breaks, against the learner's predictions:** B3 was predicted right. B1 and B4 were
  missed for one reason: both let the picture decide. In B1 the code's copy of the picture was
  taken as the only one, and the database's trigger refused the move. In B4 a move that the
  picture allows was taken as a move that happens, and the tear-up's list never asked for it. B2
  expected the database to release a booking by itself; only DSoR's code does.
- **Found while building:** the tests' own role table had no `scheduler`, so start-up refused
  every registry built with it; the tear-up's list on the database had no `ORDER BY`; the first
  tear-up of a test file now cancels READY drafts that other files left; and claim C7's test
  proves nothing on a database built from nothing, so it was checked by hand on one with older
  proposals.
- **The first sweep:** 33 small breaks, 26 killed. The 7 that survived each got a test, and a
  second run killed all 7.
- **The review:** one high finding, three medium, seven small. The high one: a prepared draft
  already inside its transaction when its slip was torn up still reached READY, because line ③
  read the slip once, before the claim. Step 25 had left that for step 29; this step's own claim
  needed it now. The fix reads the slip again inside the claim, under an advisory lock that the
  tear-up takes alone (D12). A sweep and a tear-up could deadlock, and a database test made it
  happen (D13). An agent could sweep when a role and a slip both allowed it (D14).
- **The second sweep:** 19 breaks of the fixes and of the reviewer's untested breaks. 18 were
  killed at once; the one that survived got a test, and was killed by it.
- **Lessons for the next builds:**
  - A check made once, before a transaction, cannot see what changes during it. A guarantee about
    "after the tear-up" needs the check again inside the claim, under a lock the tear-up takes.
  - Two operations that each move many rows and then give back a shared total can deadlock. One
    lock per company, taken first, keeps them one at a time.
  - Run `pnpm typecheck` after each edit, not only the tests. vitest runs TypeScript without
    checking types: `holdSlip` read an id from an object that had none. It was found by reading
    a refusal; a typecheck run afterwards names it at once.
  - On a shared database, a test that counts must count what the database holds. Other files
    leave rows behind.
  - A migration's backfill test needs rows made before the migration. On a database built from
    nothing it passes whatever the migration does.
  - Count time in hours and milliseconds, never in calendar days: a day of a time zone whose
    clocks change is 23 or 25 hours long.
  - `pnpm migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server. A broken copy
    gets a server of its own, so it can never change the step's own password.
- **For the learner's session:** D5 to D15, the habit behind B1 and B4, and open questions 104
  and 105.

### Step 26, money done right, built (2026-10-10)

Step 26 copies step 25c, as decision L8 asked, with database `dsor_step26`.

- **The decisions:** L1 to L8 and D1 to D8 were the learner's, each taken as recommended. D9 to
  D15 are Claude Code's, found while designing, for the learner to review. The review changed the
  learner's D7 and added D16 and D17, for the learner to review too.
- **The breaks, against the learner's predictions:** B1, B3, B4, and B5 were predicted right. B2
  was missed: the learner expected that "something else in DSoR still finds the sheet too old".
  Nothing else does. One line decides that a rate is too old, and without it Tuesday's sheet
  converted on Saturday. Whether a second guard belongs there is left open.
- **Found while building:** the tests' own role table had no `rate_loader`; step 24's test of
  another currency expected the old words; the claim store had to give its rates to a dry run; a
  refusal records the rates it was refused with; and the owner's `add` made every test invoice in
  USD.
- **The sweep:** 41 small breaks, 34 killed. The 7 that survived each got a test, and a second run
  killed all 7.
- **The review:** one high finding, three medium, and several small ones. The high one: the words
  of a refusal for no usable rate named the bill's currency, which the agent's clearance hides, and
  a dry run told it with no key at all. D7, as recommended, carried the leak, and its downside was
  written as "which currencies have no rate", so the learner could not see it. Now the agent hears
  "no usable rate", and the record names the currency and the cause. The medium ones: a repeated or
  future sheet was refused inside the work, after DSoR said yes (D16 moves it to line ⑨); nothing
  tested each company's own policy, source, and sheets; and nothing loaded an older sheet after a
  newer one.
- **The second sweep:** 20 breaks, 8 of them the reviewer's that no test saw. All 20 were killed.
- **Lessons for the next builds:**
  - A guard that stands behind two others still needs a test of its own. The schema and the
    database's CHECK both keep a rate of zero away, so nothing tested the third guard, and a zero
    there makes every bill fit.
  - `toMatchObject` proves only what it names. A record that says too much passes it.
  - A test of a unique index needs rows that every other key lets through. Here the primary key
    refused each second sheet first, so the one-base index was never tried.
  - Test a function at its own edge. With a sheet that lists USD, "USD kept as it is" and "USD
    converted at 1" give the same answer.
  - Words are output too. A refusal's message leaves DSoR like any field, so everything it holds
    must be within the caller's clearance. A decision's downside must name what the caller learns,
    and from whom it is hidden.
  - A check that refuses inside the work, after DSoR said yes, ends the proposal FAILED and lets a
    dry run say yes. Step 25 found this once; ask "does every refusal come before the work?" for
    each new command.
  - When both companies of the story share a setting, a test cannot tell "this company's setting"
    from "the first company's". Give the second company a different value in at least one test.
  - A race is tested by making it happen: hold the first call inside its claim, wait until the
    second is waiting on its lock, then let the first go.
- **For the learner's session:** D9 to D17, D7 as the review changed it, the habit behind B2, and
  open questions 106 and 107.

### Steps 25c and 26, understanding after the build (2026-10-11), stopped at part 5

Six parts were planned, to hand back about twenty "(Claude Code)" decisions, four missed breaks,
and open questions 104 to 107. Parts 1 to 4 ran, each with real runs in a scratch copy of step 26
and a scratch database: a sweep sent twice with one key, a rate of zero written past `rate.load`,
a change to `expires_at`, a tear-up racing a prepared draft, and an agent that holds `rate:load`.

- **The habit, again: "the role decides" (a form of Habit 1).** Four answers stopped at the first
  check that said yes: "rate.load is the only way in", "it moves proposals, so it may change any
  column", "it holds rate:load", and "right login, right role". Each time another guard said no:
  the database's CHECK, a right on one column only, line ⑤'s `system_only`, and line ⑨'s source
  rule, decision D8, which the learner chose. The answers that followed a timeline were right.
- **The learner, in their words:** "feels like i am not thinking before answer anymore", then "I
  don't want to answer, why are we studying this, you have lost me". The parts were long, the
  options were written to tempt, and the session drifted into the database's internals, far from
  the two steps' ideas. Its purpose was never agreed.
- **What changed (2026-10-11):** each step from 27 on goes understand, discuss, look at it
  visually, document the decisions, build in steps, test, review, then test the understanding.
  Questions that test understanding come at the end, not in every part. Every piece is its own
  commit.
- **Left for the learner to read, not to be quizzed on:** 25c's D5 to D15 and 26's D9 to D17,
  in each step's README under "(Claude Code)", and open questions 104 to 107.

### Step 27, controls in CEL, built while the learner was away (2026-10-11 to 2026-10-12)

The learner asked for the whole build first, and the review after: "first build it all then i will
review". Step 27 copies step 26, with a database of its own on a scratch server.

- **The decisions:** D1 to D18 are Claude Code's, written before any code, each with its downside.
  The review changed D3, D5, D9, D10, D12, D13, and D16, and added D19 to D21. All of them are for
  the learner to review.
- **The pieces:** A, the environment a condition runs in; B, `controls.json` and its check at
  start-up, with the tests; C1, several controls, one answer; C2, line ⑩ and `PENDING_APPROVAL`;
  C3, the record's controls on the database; D11, the sweep expires a waiting payment; G, the
  program's story. One commit each, each test red first, each broken on purpose.
- **The breaks:** B1, B2, and B4 went as the design expected. B3's expectation was wrong: the
  control's own test of a currency with no rate stopped the break at start-up. B1 found that the
  program checked `controls.json` only when its last world was built. The learner's predictions
  are still to be asked.
- **The sweep:** 85 small breaks, 28 survived, every one a missing test. Each got a test. Run
  again, 25 were caught, and the other 3 are defensive copies.
- **The review:** two high findings, five medium, seventeen low. The high ones: the program's
  database stories run with no controls, and nothing said so; and the controls and the limits each
  read "the newest sheet", so a sheet loaded between the two split one decision. The medium ones:
  a stale control evaluated as active; contract predicates neither evaluated nor refused; a test
  that tests nothing passing by its error; and "after the command ran" said of a waiting payment.
- **Lessons for the next builds:**
  - Read the store once for one decision. Two parts of one line that each ask the store can see
    two different worlds.
  - An error applies a control's effect. So a test whose control asks for the CFO, or denies,
    passes when the condition errs, and proves nothing about what the condition read. Give the
    condition an answer that differs from its error's: a control that allows the story's case.
  - A test vector that gives nothing passes by its error. Ask "what if the test gives nothing?"
  - A world that the program builds late is checked late. Check every file at start-up, before
    the first story.
  - A comment that says "not built yet" goes stale on the day it is built. Search for the step's
    own number when it lands.
  - Run the repository's formatter on each changed file before its commit.
- **For the learner's session:** D1 to D21, the four breaks to predict, open questions 108 to 113,
  and the refusal of `matches`.

### Step 27, understanding after the build (2026-10-12)

The session followed the order of 2026-10-11: the purpose first, three short parts with real runs and
no quiz inside them, one picture, the learner's review of the 21 decisions as one list, then four
predictions, each settled by a real run in a scratch copy of the step.

- **The parts:** a rule that a program can check (the control and its five sample cases); what line
  ⑩ answers (allow, wait for the CFO, or refuse, and the strictest answer wins); and what happens
  when DSoR cannot tell (an error applies the control's effect). The learner then clicked every box
  of the picture of line ⑩, and each question got an answer with a run.
- **The decisions:** the learner asked to talk about groups A (where rules live, and start-up) and B
  (what a condition sees), heard each decision's reason and its other way, and kept all 21.
- **A new habit: "straight to the payment".** Predictions 1 and 3 went to the call and skipped the
  sample cases that start-up runs before any payment. Asked which ideas led there, the learner
  picked four: a control's tests taken for the developers' test suite; start-up taken to check a
  control's shape only; a change to the code taken to touch calls only; and test 5's error not
  seen. Each got its own run, and the learner ran the deciding line with two values.
- **Prediction 4 was not answered.** The learner said: "Honestly I am unable to answer, so why not
  build first and complete, and then make a visual story for me." The run showed the fourth break
  caught only by the developers' tests, and that gave the story its picture of two nets.
- **The visual story:** "The CFO Rule", an artifact page of ten scenes, at
  https://claude.ai/artifact/8hziAceZsXoiW59FRL9GkL (private to the learner).
- **For the next sessions:** before any prediction, draw where each check runs: at start-up, or at
  a call. Then ask about one call at a time. When a prediction cannot be answered, show it as a
  story instead of asking again.
- **Design questions for step 28:** whether a broken control should stop only its own company (D2's
  other way), and how a stale control behaves through `on_stale` and its grace (D3).

### Step 28, who may switch a rule on, built first by the learner's choice (2026-10-12 to 2026-10-13)

The understanding session of step 28 began from zero, and the learner said the explanations assumed
half of what they knew. Then they asked "why not build first understand later", heard the reason
for the usual order, and chose to build first, with a visual story after. The map's step 28 holds
two ideas, so the build is its first half, who may switch a rule on; the second half, where a rule
came from, is step 28b, not built. Step 28 copies step 27, with a database of its own.

- **The decisions:** D1 to D19 are Claude Code's, written before any code, each with its downside;
  D19, org_789's tenant administrator, came while building. The review changed D5, D6, D10, D12,
  D15, and D16, and added D20 and D21. All of them are for the learner to review.
- **The pieces:** A, the rules in a store, read by line ⑩ at every call; B, `dsor.controls` on the
  database; C, `rule.draft` and the four contracts; D, `rule.activate` and its race on the
  database; E, `rule.suspend` and `rule.retire`; G, the program. One commit each, each test red
  first, each broken on purpose.
- **The breaks:** B1 to B4 went as the design expected. B2 showed two checks, line ⑤ and line ⑨,
  either of which holds. The break of line ⑥ during piece C found a hole: a draft that named a
  time it took effect looked switched on before, and could move the owner of record.
- **The sweep:** 58 small breaks, 16 survived, 13 of them missing tests. Run again with a test for
  each, 13 were caught; the other 3 change nothing that DSoR does.
- **The review:** two high findings, five medium, sixteen low. The high ones: in memory, a switch-on
  was two moves, so a retirement at the same moment left no rule, and a payment between the two
  moves met none; and a condition could loop inside a loop and stall every company. The medium
  ones: a new rule's owner names themselves (left open, question 114); the owner switched on a
  version by its number, unread (D20, and question 115); a deadlock on the database, shown live;
  and two missing tests. The database now has a trigger that draws a version's moves.
- **Lessons for the next builds:**
  - A change of two parts is one step of the store, or it is not one change. In memory, a wait
    between the parts lets another call in.
  - Inside a claim, read every store through the claim. A second connection from the same pool
    waits for ever when the pool is full.
  - A rule that a person writes over the network is code that the server runs: bound what it can
    do, its loops too.
  - Write a commit's counts only after the run that prints them. Twice a count was written before
    its run, and twice it was wrong.
  - Copying a step's `.env` into a scratch copy was refused once. Run database breaks in a copy
    whose own `.env` was written by command for its own server, such as the sweep's.
- **For the learner's session:** the visual story, D1 to D21, the four breaks to predict, and open
  questions 113 to 115.

### Step 28b, where a rule came from, built first by the learner's choice (2026-10-13)

The second half of the map's step 28, copied from step 28, with a database of its own. The
learner's choice of 2026-10-12, to build first and understand after, covered both halves.

- **The decisions:** D1 to D15 are Claude Code's, written before any code, each with its downside.
  The review changed the words of D4, D5, D11, D12, and D13, and made D6 true for the two
  commands. All of them are for the learner to review, beside step 28's D1 to D21.
- **The pieces:** A, a stand-in for KSoR and DSoR's question to it; B, the stale mark, in memory and
  on the database (migration 024, and `dsor.notices`); C, line ⑩'s answer for a stale rule, and
  the record; D, the sweep, `rule.check_authority`; E, what a rule may cite, and a grace of at most
  30 days; F, a switch-on asks KSoR; G, the program. One commit each, each test red first, each
  piece broken on purpose.
- **The breaks:** B1 to B4 went as the design expected. Each piece's own breaks, about 70 in all,
  found five survivors: four have tests now, and one changes nothing a caller can see.
- **Found while building:** piece F's first test found that a switch-on could not replace a stale
  version. It looked for the live version among the active and suspended ones only.
- **The review:** one high finding, five medium, six low. The high one: the owner could not suspend
  or retire a stale version through the commands, so a stale rule whose `on_stale` is `deny`,
  with KSoR down, refused every payment, and nobody could stop it. The medium ones: the record
  lost the fingerprint of the text the rule enforces; three places where the code was right and no
  test held it; and DSOR-CTL-03a met in part, with no timer and a notice that nothing reads.
- **Lessons for the next builds:**
  - A test of a store is not a test of the command over it. H1 passed every test of the store.
  - Name a thing once. "Policies" meant the money policies and KSoR's both, until the question
    to KSoR was named `ksor`.
  - zsh does not split a variable into words: a list of test files in one variable ran no test at
    all. Name each file, or run the script with bash.
  - A commit's message says what its runs proved. One message said six breaks were caught where
    five were, and was corrected before the next commit.
- **The visual story:** "When the CFO Rule Changes", an artifact page of fourteen scenes in two
  acts, at https://claude.ai/artifact/XSRMSYFiSjsvxte2XbfGEg (private to the learner).
- **For the learner's session:** the visual story of both halves, step 28's D1 to D21 and step
  28b's D1 to D15, the eight breaks to predict, and open questions 113 to 119.

### Step 29, approvals, built first by the learner's choice (2026-10-13)

Copied from step 28b, with a database of its own. On 2026-10-13 the learner asked to build step 29
first, and to talk through steps 28, 28b, and 29 together after.

- **The decisions:** D1 to D15 are Claude Code's, written before any code, each with its downside.
  The build changed the words of D4 (the schema's own field, `requires`), D5 (the state before the
  role), and D9 (the company's ending lock, not a lock of the proposal's row). The review changed
  D5, D7, D10, and D13 again. All of them are for the learner to review.
- **The pieces:** A, canonical JSON in full; B, a waiting proposal keeps what it waits for
  (migration 025); C, DSoR keeps each approval (migration 026); D, `proposal.approve`; E, an
  approval expires with its proposal; F, a rule asks only for an approval someone can give; G, the
  program. One commit each, each test red first, each piece broken on purpose.
- **The breaks:** B1 and B3 went as the design expected. B2 and B4 did not: a second check stopped
  each, line ⑨'s own look at the identity mode, and the next check of the roles. Each piece's own
  breaks, about 60 in all, found four survivors, and each changed the code or added a test.
- **The review:** no high finding, seven medium, eleven low, and 59 breaks of the reviewer's own,
  14 of which survived. The medium ones: an approval given after the expiry, when it waited for a
  sweep's lock, since `now()` is the time a transaction began; a rule that asks for a role without
  `proposal:approve`; a README that said the fingerprint alone protects the approver; and four
  places where code was right and no test held it. All were fixed, each test red first; L8 and L11
  were recorded, with open question 122.
- **Lessons for the next builds:**
  - A refusal can carry a `state` too. A test that told success from refusal by `state` read a
    refusal as an approval; tell them apart by a field only success has.
  - A list in an answer needs labels of its own, field by field, or the masking step refuses the
    whole answer, `INTERNAL_ERROR`.
  - A draft in the step folder is part of the step. Piece D's draft of `src/approve.ts` failed the
    typecheck of piece C's check. Drafts belong in the scratchpad until their piece starts.
  - `now()` in PostgreSQL is the time the transaction began. A check of time after a lock wait reads
    `clock_timestamp()`.
  - The cross-tenant suite sends another company's address with a made-up id, and expects
    `TENANT_MISMATCH`. An input pattern stricter than the specification's breaks it; refuse the
    form of an id in line ⑨'s look instead.
  - Run first, then write the commit. One message named a count before the run printed it, and the
    count was wrong. Another said the formatter changed no token, and it adds trailing commas. Both
    messages were corrected before the next commit.
- **The visual story:** "When the CFO Rule Changes", version 2, adds Act 3, the approvals, six
  scenes from real runs, and step 29's breaks and review, at the same address,
  https://claude.ai/artifact/XSRMSYFiSjsvxte2XbfGEg (private to the learner).
- **For the learner's session:** steps 28, 28b, and 29 together: the visual story, now with a third
  act; step 28's D1 to D21, step 28b's D1 to D15, and step 29's D1 to D15; the twelve breaks to
  predict; and open questions 113 to 122.

### Step 30, who may not approve, built first by the learner's choice (2026-10-13)

Copied from step 29, with a database of its own. On 2026-10-13, after step 29, the learner chose
"Build 30 too, review 4": build step 30 the same way, and then review steps 28, 28b, 29, and 30
together.

- **The decisions:** D1 to D10 are Claude Code's, written before any code, each with its downside.
  The review changed D8: the count itself counts people now (finding L5). All of them are for the
  learner to review.
- **The pieces:** A, AP supervisors may approve (D5), and a rule may ask for one (D6); B, DSOR-SOD-02
  at line ⑨, in `src/segregation.ts`; C, tests titled DSOR-SOD-01a, 01b, and 04c for what step 29
  holds; D, the program's story. One commit each, each test red first, each piece broken on purpose.
- **The breaks:** B2 went as the design expected. B1, B3, and B4 did not. The subject check covers
  the slip's signer for an agent's call; the count itself counts people since the review; and an
  agent holds no role, so no approve permission of its own. Of 26 breaks of my own, in memory and
  on the database, two survived, and each became a test: the slip read in org_789, and the signer
  read on the database.
- **The review:** no high finding, one medium, seven low, and 33 breaks of the reviewer's own, 4 of
  which survived. M1, two approvals by one person at once, became two database tests. Their first
  version passed with no lock and no key, because the two calls did not overlap, so the tests hold
  the company's ending lock by hand until both calls wait for it. L1, L2, L3, L5, and L6 were fixed;
  L4 and L7 were recorded. L7 is the store of slips in memory, from an earlier step, which accepts
  two slips with one id.
- **Lessons for the next builds:**
  - Two calls sent with `Promise.all` need not overlap. A concurrency test proves something only
    when it makes the overlap happen, and fails without the lock: hold the lock by hand until both
    calls wait for it.
  - A new permission can weaken an old test. With `payment:approve` on ap_supervisor, a test of a
    person with two roles passed with code that read only the first role.
  - A break can be held by a check the design did not name. Run the break before writing what it
    shows.
  - The session's deny rules cover `.env.example` too. A copy without it fails one test in every
    run: say so, and leave that test out of the counts.
- **The visual story:** "When the CFO Rule Changes", version 4, at the same address,
  https://claude.ai/artifact/XSRMSYFiSjsvxte2XbfGEg (private to the learner). Version 3 added who
  may not approve: four scenes from real runs, the chain drawn link by link, and step 30's breaks
  and review. Version 4 opens with step 27, at the learner's request ("I don't know that"): the
  rule itself, eight scenes from step 27's own page "The CFO Rule", with its breaks, review, and
  decisions in the closing scenes. The page now has five acts and 32 scenes.
- **For the learner's session:** steps 27, 28, 28b, 29, and 30 together: the visual story, now with
  five acts; step 27's D1 to D21, step 28's D1 to D21, step 28b's D1 to D15, step 29's D1 to D15,
  and step 30's D1 to D10; the twenty breaks to predict; and open questions 108 to 123.

### Step 31, check again at execution, designed by the learner (2026-10-14 to 2026-10-15)

Copied from step 30, with a database of its own (port 55462, `dsor31`). The learner asked to design
step 31 and took every decision, one at a time: D1 to D11 through questions, six points the
specification settles accepted as one list, and D12 and D13 as building began. The learner also
predicted all four breaks before any code. The build followed in five pieces.

- **The decisions:** D1 to D13 are the learner's. D14 to D18 were found later in the build and are
  Claude Code's, each with its downside, for the learner to review: DSoR's own work is not
  released (D14); a check that cannot be made now leaves the payment waiting (D15); a gone signer
  invalidates and suspends nothing yet (D16); a cause starts with its own code (D17); a rule the
  request was never decided under is new, and invalidates (D18). The learner reviewed them, each
  after a short story, and kept all five: D14 on 2026-10-15, D15 to D18 on 2026-10-16, after step
  32 was built. The visual story's online copies are gone; the link above no longer opens.
- **The pieces:** A, the release's front, who may release, and what; B, the stored request runs,
  once; C, the check again on live data, whose 12 tests were all `COMMITTED` before it, the stale
  approval paid; D, the database, migration 027 and two releases at once; E, the program's four
  scenes, in a world of their own, since step 30's world has two later rules on.
- **The learner's breaks:** all four predictions right. B1, the check skipped: INV-2012 paid on one
  CFO's yes. B2, the caller's request run: INV-1002 paid, but only once three guards were broken
  (start-up's schema check, the payment pinned to what line ⑨ read, and the fingerprint). B3, the
  booking kept: the next 21,000.00 USD draft hears `LIMIT_EXCEEDED`. B4, D2 gone: the preparing
  agent releases its own INV-1009.
- **The review:** one high, three medium, four low, and 18 breaks of the reviewer's own, 9 of which
  survived. H1, the dry run that skipped the check again, Claude Code had found already, rereading
  D13 while answering the README's review. M1, a late sheet of rates that invalidated an approved
  payment, now waits (D15). M2, the expiry read once before a wait of up to two seconds, is read
  again before the work. M3, the survivors, each became a test. L1 fixed; L2, L3 recorded (L3 is
  open question 134); one break of the slip's lock still survives, recorded.
- **The reader's review:** the second idea had no picture (the flight plan to Lahore is it now),
  "gate" meant two things, and ten words were undefined.
- **Counts:** unit 2210, database 489, at 54c30e2.
- **Lessons for the next builds:**
  - Reread each decision against the code at the end. D13's dry run was written and never built,
    and every test passed.
  - A test login planted with `withPlanted` is gone outside it. A check of the asker then says "no
    login now", and a test can pass for that reason. Pin the cause, not only the code.
  - A store made with `now = Date.now` keeps the real clock: faking `Date` later does not reach it.
  - Masking hides a cause from a low clearance. Read causes as a person, or the test reads a mask.
  - In memory, two calls at once never both pass a read before either writes. Hold the row from a
    third connection on the database, and use a pool of its own for the holder and the watcher: the
    registry's pool of two serves the calls, and a third need hangs every test after it.
  - Start-up's own checks stop some breaks before they run. Report the break as the developer would
    really make it, and say which guards had to go.

### Step 32, preconditions and one attempt at a time, built first by the learner's choice (2026-10-16)

Copied from step 31, with a database of its own (port 55463, `dsor32`; from the review on, a second
one, port 55464, `dsor32b`, after another session used the first). The learner said "implement
32 now we will understand later", so every decision is Claude Code's, each with its downside, for
the learner to review. Before the copy, staging's pull request #6 was merged in, and step 31's open
questions became 132 to 134.

- **The decisions:** D1 to D12 before any code; D13 (the version checked at line ⑨), D14 (memory
  undoes what a call did), and D15 (each database test starts with nothing in flight) found while
  building. D9 changed: drafts are not counted, only proposals in flight, as DSOR-EXC-02 says. D10
  is withdrawn.
- **The pieces:** A, vendors and the bind through the invoice (migration 028); B, the preconditions
  and their freshness; C and D, what is left to pay and one attempt at a time, with the invoice's
  lock and the key `proposals_one_attempt` (migration 029); E, the release reads the vendor again,
  the map's "done when"; F, the program's three scenes.
- **The breaks:** B1, the look gone: the count still refuses. B2, the release skips the
  preconditions: a suspended VENDOR-44 is paid. B3, the look and the count gone: memory's copy of
  the key holds, a third guard. B4, a release counts itself: it invalidates itself. B5, the status
  precondition gone: a draft invoice is paid. B6, the database's lock gone: the key holds.
- **The reviews:** a sweep of 30 breaks by a second session of this build: 8 survived, one a real
  flaw, M04, the count reaching line ⑩, where the CFO's rule saw 0.00. Then the hostile review: no
  high, four medium (M1, memory's undo deleted an approved proposal; M2, a release read at the
  contract's freshness; M3, the refusal masked for a caller with no clearance; M4, the double
  payment one attempt after the other, recorded for the learner's review of D9), six low, nine
  breaks no test caught. Each fixed one, and each survivor, has a test.
- **The learner's review:** after the story's act 7, the learner kept every decision: D9, D8, D13,
  D5, and D11 one at a time, each after its story, and the other nine as one list.
- **Counts:** unit 2286, database 503, at b1c51e1.
- **Lessons for the next builds:**
  - Two sessions of one build ran at once, on one folder and one database, for an hour. The first
    sign was a test that failed with others and passed alone, and a scratch file that changed by
    itself. When that happens, look at the sessions and the processes before anything else. Give
    each run a database of its own, and make breaks in a copy of the folder, never in the folder.
  - Never undo a break with `git checkout`: it takes the uncommitted work with it. Keep a copy.
  - A count made for the preconditions must not reach the rules. Give each line the state it is
    meant to read.
  - An undo in memory undoes what one call wrote, found by its request id, never a whole record.
  - A cleanup before each database test makes the tests independent, and hides what a defect left
    behind. Say so where the cleanup is.

### Step 33, the decision bundle, built first by the learner's choice (2026-10-16)

Copied from step 32, with a database of its own (port 55465, `dsor33`). In the middle of the Part 4
understanding session, the learner said "maybe do 33 so part 4 is done, then we do the full story
in a better way". So every decision is Claude Code's, each with its downside, for the learner to
review, and the better story of Part 4 comes next.

- **The decisions:** D1 to D14 before any code. D1 reads "consequential" as every command, from line
  ④ on, in every mode. D2 and D3: a bundle and its record in one transaction, append-only. D4 to D9:
  facts only; what line ⑨ read; each conversion once; the approvals a release counted; a release's
  bundle names the stored request; how the work ended. D10 to D12: the agent's words in the
  envelope's own field, kept apart, and read by no check. D13: the specification's schema and this
  tutorial's extensions. D14: no operation reads a bundle yet.
- **The pieces:** A, a bundle for each command decision, sealed with its record; B, what line ⑨ read
  and what a release counted; C, each conversion; D, the agent's words; E, the database's table and
  one transaction (migration 030); F, the program's story.
- **Found while building:** since step 32, an approval named VENDOR-44 by an invoice's address
  (fixed, DSOR-APR-02a). Seven breaks of the pieces survived at first and became tests, or showed
  dead code.
- **The breaks:** B1, the reads forgotten: every bundle still validates, so the schema cannot prove
  a bundle complete. B2, the rules read the agent's words: the agent that says "emergency" is paid
  without the CFO; it took three changes, and the test that compares decisions did not catch it,
  the structural tests did. B3, the words in the fingerprint: a retry hears `IDEMPOTENCY_CONFLICT`
  and every release is invalidated. B4, the bundle in its own transaction: a bundle with no record.
  B5, the approvals forgotten: step 32's gap comes back.
- **The reviews:** the README's reviewer, 43 findings, all fixed: the largest, the clerk analogy
  turned around from start-here's. The code's reviewer broke the code 94 times: one high finding, a
  bundle checked only at line ⑪, after the work had committed, so a vendor named "VENDOR 44" or a
  rule named constructor left a drafted payment with no record and no bundle. Fixed with D16, a Map,
  and D17, the bundle checked before the work. Four medium findings fixed (a release's booking
  conversion, a person's release, a replay of a release, and the counted approvals' Map), and a test
  for each break that survived.
- **Counts:** unit 2379, database 515, at 77a766c.
- **Lessons for the next builds:**
  - A demonstration must differ between the broken and the unbroken code. S4 said "0 bundles" on
    both, because the caller had no slip and stopped at line ③.
  - A test that matches with `toMatchObject` lets extra keys through. Where a field must hold
    exactly what is named, use `toStrictEqual`: F2 hid behind that for a step.
  - A break of a guarantee may need more than one change to show its danger: B2 needed the rule's
    own tests to be fooled too. Run the danger to its end before writing what a break does.
  - Evidence that is checked after the work is evidence that can be lost after the work. Check
    what will be kept before the work runs, from the same facts.
  - A plain object keyed by the company's text, such as a rule's id, meets Object's own names. Use
    a Map.
  - A new test file can overwrite one the copy carried: check the name before writing.

### Step 34, connectors, built first by the learner's choice (2026-10-17)

Copied from step 33. Before it, the learner asked to rework the teaching (fast and slow, their own
world, more pictures, and Claude Code runs the code), heard steps 02 to 04 and 27 to 30 that way,
then asked for step 33 as one story and the whole journey without jargon, and moved to step 34.

- **The question that shaped the step:** "won't most banks make their own MCP as well, so why
  redefine?" Answer: MCP is how a call travels, a connector is DSoR's contract with one system. A
  bank's MCP server may sit under a connector, never beside the agent (open question 145).
- **Production first:** six choices were checked against how real systems run before any code.
  Two changed: a company's own connector refuses at line ④ instead of stopping start-up, and the
  password test is an alarm, not the lock. The learner then chose to build first.
- **Changed during the build (F1):** the connector keeps DSoR's login, because a login of its own
  would break step 33's one transaction. Separate keys wait for step 36.
- **The review:** `proposal.approve` was not routed; a refusal repeated a declaration's text, so a
  URL could reach the agent; three fields could carry a key; fifteen breaks survived. Each fixed red
  first, with a test.
- **On a throwaway PostgreSQL** (port 55474): two database tests fail on it, for step 33 as well,
  because it accepts any password and its owner belongs to no other role.
- **Left open:** routing by name only; the shared-transaction flag is the connector's own word;
  a replay during an outage (147); fallback semantics (146); a warning nobody is sent.

### Step 35, a fake bank, decided by the learner, built while away (2026-10-18)

Copied from step 34. The learner decided four choices one at a time (the bank inside the program;
it refuses repeats and answers lookups; the bank's key from the proposal; each company names its
bank), then said "assume all and build, see you later" for the last two (a silent bank is unknown;
the CFO's rule stays on the draft).

- **Code before tests**, against the rule. Each test was then shown to fail against a break of the
  line it guards.
- **Found while building:** `expected_version` is the invoice's, as for every command that binds
  an invoice since step 21; and the send must come before the mark, so memory and the database
  behave the same.
- **The review found three ways to pay twice:** a failure after the send undid the attempt and its
  key (F1); two drafts of one invoice were both sent (F2); a refusal the bank made up was retried
  (F3). Fixed, each with its test, and each fix undone once to see the test fail.
- **Left open:** nothing written before the call (36); nothing held, nobody asks the bank (37); no
  rule runs again at the sending.

### Step 36, write it down before you act, decided by the learner (2026-10-18)

Copied from step 35. The learner decided four choices one at a time (a table of its own; only
commands that reach a bank; a start-up sweep and every read; kill a real process) and split the step:
36 is the note before a bank, 36b the decision record committed with records-only work.

- **Memory red first; the database half before its tests.** Nine breaks in copies, each caught.
  Two of them, a note never committed and a note committed after the bank, change nothing in
  memory: only the database and a real crash show them.
- **Found while building:** the checkpoint's COMMIT lets go of the payment's lock, so a cancel
  slipped into a send; a release's note must name the release's own claim.
- **Claude Code's choice to watch:** after the note, "the bank sent nothing" is kept, so the same
  key gives it back and only a new key pays (open question 149).
- **The review found no way to pay twice.** It found an accident after the checkpoint answered
  `INTERNAL_ERROR` (H1), and an unknown outcome gave its booking back, a step 35 bug (H2). Fixed.
- **Left open:** the sweep and a second server (150); records-only commands (36b); nobody asks the
  bank (37).

### Step 36b, the record and the work together, decided by the learner (2026-10-18)

Split from 36 at the learner's request; four choices one at a time (every command that runs;
whatever the claim keeps commits with its record; no record, no change; both attacks).

- **Red first, for real.** Seven tests red on step 36's code; the crash test showed the orphan: a
  proposal that outlived its record.
- **Found while building:** a proposal's moves write into `dsor.audit` too, so the first trigger
  and watcher made tests pass for the wrong reason; a release read through the pool inside the
  claim and deadlocked a two-connection pool.
- **A break that passed:** a log writing in its own transaction (B2) passed until the crash test
  killed the claim's own COMMIT.
- **The review:** what the seal noted for the record leaked when its work was not kept (F2), and
  "kept nothing" could be said after the bank sent (F1). Fixed with a copy put back.
- **Left open:** the outbox (40); a COMMIT whose answer is lost (F4).

### Understanding step 37, outcome unknown, from zero (2026-10-19)

A new style at the learner's request: start as if they know nothing of DSoR or any earlier step,
every word defined, a story and pictures first, every case a real run. Five parts: the silent bank;
what people can still do while nobody knows; the hold; what the hold covers and what each person
hears; who lifts it, and the real-world names (pending, suspense account, processing).

- **Their own questions were the best moments.** "If DSoR retries with the key it can know": a real
  run showed the fake bank answering the same key with its first receipt (the spec's MAY re-drive),
  and a new key paying again. "When and how will reconciliation happen": §25.3 and §44's clocks.
- **Habit 1 (substitution) again:** "DSoR refuses the cancel", because it had said "unknown". The
  run showed the cancel COMMITTED: no rule links "unknown" to "do not change".
- **Found while teaching:** `payment.cancel` binds nothing and `payment.execute` binds no payment,
  so a hold on the slip could not be matched today.
- **The learner declined gut calls after part 3.** Explain and run; keep decisions in the ask tool.
- **Design questions for step 37:** where a hold lives (a table, or worked out from unknown
  proposals); binding the slip in payment.execute and payment.cancel; CONFLICT or RESOURCE_HELD when
  both apply; older waiting drafts of a held bill (approve, release); whether reads show the hold;
  holds for proposals the start-up sweep made unknown; and, for step 38, re-drive or look up.

### Step 37, outcome unknown, decided by the learner (2026-10-19)

Copied from step 36b, after the understanding session from zero. The learner decided seven choices
one at a time (a table of holds; contracts name what a command touches; the hold speaks first;
held at the release, not the approval; reads unchanged; every way into unknown places holds; a hold
ends with its payment), and refined D6 and D7 before the build: holds are placed with step 36's
note and count while EXECUTING too, so a lost connection leaves no gap.

- **Red first:** 17 unit tests, 10 red on an empty store; then 5, later 8, database tests.
- **Found while building:** RESOURCE_HELD must keep nothing (it says "not now"); memory did not undo
  a proposal created inside line ⑧; on the database a cancel during a send waits for the payment's
  lock; a killed run left the scratch database half-changed, and many tests failed for that reason.
- **The review:** a running send lost its CONFLICT (F1); a hold_on_unknown with no address passed
  start-up (F2); a draft could slip in before the holds commit (F3); a dry run waited for the bank
  (F4). Fixed; each tested fix undone once.
- **Left open:** reconciliation (38); the payment read is not in the bundle; hold rows never
  removed; open question 151.

### Understanding step 38, reconciliation, from zero (2026-10-19)

The same style as step 37, and no gut calls (the learner declined them). Five parts, each with a
real run on step 37's code: a stuck payment the bank knows about and nobody asks; look up or
re-send with the same key (the bank's three cases); settling as several changes in one
transaction (settled by hand, the books stayed "draft" and a cancel of a paid payment went through);
the two clocks; never an agent.

- **The learner proposed a rule** in part 2: look up first; re-send with the same key only if the
  bank says "never received it", and not if the payment was cancelled; never a new key.
- **Found while teaching:** nothing in DSoR can settle an unknown payment today; the bank's lookup
  is built and never called; a decision record is the only trace of an unknown, and nobody is told.
- **Design questions for step 38:** how DSoR asks the bank (the learner's rule); re-check before a
  late re-send; what an alert is and who receives it; who the human is, and whether the sender may
  settle alone; what runs the clocks; what a same-key retry says after settlement; whether a
  human's settlement may overrule the bank's lookup.

### Step 38, reconciliation, decided by the learner (2026-10-19)

Copied from step 37. The learner decided six choices one at a time: split the alert and the human
into 38b; look up only, so "never received it" settles FAILED and a person pays again with a new
payment; an operation, `payment.reconcile`, run by `dsor-scheduler`; the job and AP supervisors,
never an agent; a same-key retry answers the settled outcome; the evidence in the records DSoR
already keeps. Their own rule (re-send with the same key on "never received") was weighed at D1.

- **Red first:** 12 unit tests, all red; then 5 database tests, with a real `SIGKILL`.
- **Found while building:** a bank that only refuses a repeat no longer serves as the default bank;
  reconcile names the proposal, because binding the payment meets the payment's own hold; two breaks
  passed every test (a mismatched receipt, a dry run of a settled proposal), and each got a test.
- **The review:** a payment already paid made every reconcile fail (F1); a mismatched receipt left
  no record of why (F4); a FAILED replay was "retry with the same key" for ever (F6); a draft could
  answer COMMITTED on replay (F8). Fixed; each fix undone once, and its test failed. F3 asked for
  booking tests, and the test showed the booking is the draft's: the claims had said it moved.
- **Left open:** the alert and the human (38b); no timer; "never received it" believed at once;
  open questions 152 and 153.

### Step 38b, alert at once, escalate before the hour, decided by the learner (2026-10-19)

Copied from step 38. The learner asked to build straight after step 38: the problem was shown with
a real run (two hours unknown, nobody told), then seven choices one at a time, all recommended (a
row written with the move; a receiving role per company; a sweep for dsor-scheduler; a named person
checked at start-up; every way in raises it; it closes with the settlement; the bounds declared).
A list of alerts needs DSoR's first query over its own store, a second idea: split into step 38c.

- **Red first:** 15 unit tests and the start-up check's, all red; then 4 database tests, later 7.
- **Found while building:** a list in an answer must hold records of a named kind; a column the
  database fills may not also be one DSoR moves; the system-only guard was a second wall, so a
  break passed every test until a role table gave a person the permission.
- **The review:** a send whose record failed after the bank sent stayed EXECUTING with no alert
  (H1); unknowns before the migration had none (H2); the database did not tie an alert to its
  proposal (M1); PT1H plus a sweep passed the hour (M2); cfo_100 could not settle (M3); memory
  escalated three times at once (M4). The learner decided D8 to D11; each fix undone once.
- **Left open:** the list (38c); delivery (40); the restart's clock (open question 154); one person
  per company, and in org_789 it is the receiver too.

### Step 38c, the list of alerts, decided by the learner (2026-10-19)

Copied from step 38b. The problem was shown with a real run (cfo_100 holds an escalated alert and
hears UNSUPPORTED_CAPABILITY); the learner decided four choices, all recommended (whom alerts.json
names; no agent; only unsettled alerts; each alert with its payment and invoice). The page size
and the freshness label were not choices: DSOR-QRY-01 and DSOR-FRS-01a settle them.

- **Red first:** 11 unit tests and 1 database test, all red.
- **Found while building:** DSoR refused own work for a query, so a read is a new kind; a row is
  named by its kind; the cross-company suite counts an empty list as a finding, so it now plants
  an alert in each company, and a look reading org_456 for everyone failed it 44 times.
- **The review:** a role table without alert:read started cleanly (H1); a refusal was recorded
  ALLOW (H2); the row's company was stamped, not read (M1); an escalation was pinned to a person
  (M2, the learner chose that the current person sees every escalated alert). Fixed; each fix
  undone once, M1 a second wall.
- **Left open:** nothing tells a person who does not ask; no acknowledgement; no history screen;
  a look that mixes companies' roles cannot be caught yet.

### Step 39, a log nobody can quietly edit, decided by the learner (2026-10-20)

Copied from step 38c. The problem was shown with a real run (the owner turned a denied reconcile
into a settled payment; nothing in the log could show it). The learner decided five choices, all
recommended: chain only, checkpoints in 39b; one chain per company; the database writes the
fingerprints; the migration chains the old records; a script run as the owner.

- **Red first:** 13 unit tests and 7 database tests, all red.
- **Found while building:** the chain's lock taken at the insert was held to the end of every call,
  so a company's calls waited for each other and two rule drafts locked each other: chaining moved
  to a trigger deferred to the commit. The store map refused a trigger on an append-only table,
  so the log got its own kind. The map's exercise, and the careful editor who rewrites the chain,
  were both run for real.
- **The review:** an owner without BYPASSRLS kept records unchained and the checker said the log was
  empty (H1, fixed to fail closed); any login could take the chain's lock (L1; the learner chose a
  table of heads only the owner holds); migration 035 failed on records older than 003b (M1); no
  test tied the recipe to every column, the predecessor, or the migration's chaining (M2, M3, M7).
  Fixed; each fix undone once, but M1.
- **Left open:** checkpoints (39b); a new record the owner adds; the checker's read not recorded
  (DSOR-AUD-05b); the owner's own login for the checker; open question 155.

### Step 39b, a checkpoint kept elsewhere, decided by the learner (2026-10-20)

Copied from step 39. The problem was shown with a real run (the careful editor rewrote org_456 from
place 4 on, head and all, and step 39's checker said whole). The learner decided nine choices, all
recommended: a signed file; an Ed25519 key pair; a script run by hand; a mismatch is broken, exit 1;
a chain newer than every checkpoint is reported; no fresh checkpoint is exit 2; every checkpoint is
checked; the public key committed; a bad signature is broken, exit 1. The learner predicted four
stories before any code, and all four were right.

- **Red first:** 23 unit tests against stubs, and the database tests.
- **Found while building:** two breaks first passed every test (the order of the files; no
  `no_company` record on a fresh database); a note that read as false beside a forged file.
- **The review:** got the checker to exit 0 three ways: a routine checkpoint signed a rewrite, then
  the older checkpoint was deleted (H1); the database's clock was the owner's (H2); a view showed
  the checker old rows (H3). Also planted files, another database's checkpoint, the key inside the
  repository, and sixteen surviving changes. The learner chose: each checkpoint follows the one
  before, and the signer keeps a note of its last; the checker's own clock; say plainly that one
  person signs here; and name the database in each checkpoint. Fixed, and every fix broken once.
- **Left open:** the database server itself can lie; one person holds the login and the key; a new
  record the owner adds; the checkers' reads not recorded (DSOR-AUD-05b); open question 156.

### Step 40, events with an outbox, built while the learner was away (2026-10-20)

Copied from step 39b. The learner asked for step 40 to be built while away, so the twelve decisions
D0 to D11, and D12 from the review, are Claude Code's, each with its downside, marked for the
learner to review. The problem was shown with a real run of the two ways to send without an outbox:
PAY-902 paid and nobody heard, and PAY-904 announced and never paid. Four predictions, P1 to P4, are
written down to ask the learner, each already run for real and folded away in the README.

- **Red first:** 44 unit tests against stubs, and the database tests.
- **Found while building:** no test said that DSoR reads the payment again (break B8); the
  database's sender had no test of its own for a failure in the middle of a run (break B3).
- **The review:** two high findings. The event's payment came from the company code's answer, so
  code that paid PAY-902 and answered with PAY-901 announced PAY-901 paid twice (H1); and `pnpm
  guard` was red (H2). Five medium: memory sealed the record before the event (M1), three missing or
  empty tests (M2, M3, M5), and two channel names that are one file on macOS and Windows (M4).
  Seven low. Now DSoR's store notes each change the company's code makes, the event is of that
  change, written with the work, and each channel is named after its company. Each fix has its test
  written first and its own commit, and the fixes were broken on purpose in a copy.
- **Left open:** no `invoice.issued`; no `trace_id`, `session_id`, or trusted `task_id`, and not the
  human behind an agent's slip (open question 157); sent events never cleared; a slow receiver
  holds the sender's transaction; the database does not refuse a change without its event.

### Step 40, understanding after the build (2026-10-20)

The learner came back to a step built while away and said they knew nothing of it. They asked for a
break, and then for the step from the ground up. Six parts, each settled with a real run in a
scratch copy outside the repository: the problem (two writes), the outbox (one transaction), what
an event holds, where DSoR writes one and where it stays silent, the sender, and what is left open.

- **Check-in questions only,** by the learner's choice. No predictions were asked.
- **The review's H1 attack, run before and after the fix.** Before: code that paid PAY-902 and
  answered with PAY-901 gave PAY-901 a second `payment.executed`, under a new event id, and PAY-902
  none. After: PAY-902 gets its `payment.executed` once. Code asked to pay PAY-902 that pays PAY-903
  gets `OUTCOME_UNKNOWN`, and neither payment gets an event.
- **A real SIGKILL of the fixed sender.** The channel held PAY-903's first event, and the database
  still said both of its events were unsent. The rerun delivered that event again with the same
  `event_id`, and the receiver dropped the copy. A second sender at the same moment got `busy`.
- **Way of working:** a step built while the learner is away needs a session like this one after
  it, from the problem up, before the learner reviews the decisions.
- **Decisions for the learner to review,** each Claude Code's:
  1. D1: who writes the event. DSoR's code, which can forget; a trigger, which cannot see the call's
     ids; or both, with a trigger that refuses a payment change that has no event in its
     transaction.
  2. D7: a bad event stops its payment, or the payment goes on and the event is lost with an alert.
  3. D8: a failed delivery stops the whole company, only its resource, or moves the event aside
     after a number of tries.
  4. D8: the tick in the delivery's transaction, or events taken for a time limit and ticked later.
  5. D2: how long a sent event is kept.
  6. D12: a channel named after its company, or any name with a check that ignores capitals.

### Step 40b, no change without its event, decided by the learner (2026-10-20)

Copied from step 40. Claude Code showed the problem first: step 40 with the one line removed that
writes `payment.executed` in `payment.reconcile` paid PAY-968 and committed with no event. Then the
learner decided, one question at a time: the check stands on `app.payments` (D1), both directions
(D2), the database only (D3), "once each, in the right state" for the second direction (D4), and the
owner's writes bound too (D5). The whole step is migrations; no file in `src/` changed.

- **Found while checking the design:** `xmin` names the savepoint the company's code runs in, not
  the transaction, so events carry a column of their own, `written_xact` (D6).
- **Predictions, run for real:** the learner expected the forgetful reconcile to commit, "the check
  does not see DSoR's own work"; it heard `INTERNAL_ERROR`, kept nothing, and left INV-9001 held.
  The learner expected a cancel to commit with no event, and it did.
- **The review:** one high finding. A payment marked paid with its event could be set back to draft,
  so the accounts system heard "paid" for money that never left (H1). The learner chose "paid is
  final" (D8). And the owner can switch a check off, so the claims say so, with cheap guards: the
  database stamps each event's transaction, and no event is removed (D9). Eleven clauses had no test
  that needed them; each has one now, and one clause can no longer be reached by any test.
- **Found along the way:** a database where step 40's tests ran cannot take migration 038, because
  step 40's L2 test wrote two `payment.created` events about one made-up payment. `bank.db`'s D7
  failed once in a full run; step 40's own code fails it the same way, so it is open question 158.
- **Left open:** memory has no such check; `proposal.approved` is not checked; payments from before
  the step are not checked; the owner can switch a check off, or replace its function, which start-up
  does not compare.

### Step 40c, one bad event does not block the rest, decided by the learner (2026-10-20)

Copied from step 40b. Claude Code showed the problem first: step 40b's sender, with a receiver that
refused every event about VENDOR-31, held back PAY-902's and PAY-903's events too, run after run, and
nobody was told. Then the learner decided, one question at a time: only the failed payment's events
stop (D1); keep trying, and alert, never move the event aside (D2); an alert after three failed tries
(D3); the alerts in a table of their own, `dsor.event_alerts` (D4); a log of failed tries,
`dsor.outbox_tries` (D5); memory stops per payment too, and the tries and the alerts are the
database's (D6).

- **Found while checking the design:** the map allows no trigger on an `append-only` table, so the
  log of tries is a new kind, `append-only-watched` (D7). A try is written in the run's transaction,
  as step 40's D8 has it (D8).
- **Predictions, run for real:** the learner expected run 1 to deliver nothing yet; PAY-902's and
  PAY-903's three events arrived, and only PAY-901 waited. The learner expected PAY-901's
  `payment.executed` to be delivered anyway; it was not tried. One alert after run 3, and the
  database closes it when the event is sent: both as expected.
- **A habit named:** the two misses went in opposite directions. The first held back the whole
  company, as step 40b does; the second held back only the one event. Ask what a rule holds back:
  the company, the payment, or the event. Here it is the payment, because the ordering key numbers
  one resource's events (DSOR-EVT-01b).
- **The review:** one high finding. A refusal whose reason the database could not keep, with no
  words, a NUL byte, or more than 200 bytes, aborted every run, and no try or alert was ever kept
  (H1); every reason is now cleaned first. Events held back used up a run's tries (M1); the learner
  chose to count only the events tried (D9). Three groups of clauses had no test that needed them
  (M2 to M4). The database now raises the alert at three tries or more, once (L1), locks the event
  for a try (L2), and takes a try only for its payment's oldest unsent event (L3). From step 40, an
  event's number did not have to follow the order it was written; the learner chose to fix it now
  (L4, D10).
- **The breaks, after the fixes:** 33 were run for real. All are caught but two: S3, which the
  learner's D9 made harmless, and G10, which no writer can reach. Four of the review's breaks were
  still green after the fixes, so each got a test of its own, and is caught now.
- **Found along the way:** with D1 a thrown error no longer stops a run, so step 40's memory test
  of a killed sender, and the story's scene of a sender that loses its answers, were rewritten.
  Emptying `dsor.outbox` now meets the foreign keys of the tries first, so step 40b's owner program
  uses `CASCADE`.
- **Left open:** `alert.list` does not show these alerts, and nothing escalates them; 100 stuck
  payments would use every try of a run; the log of tries only grows; memory keeps no tries; the
  owner can switch a trigger off; `dsor_runtime` can raise an alert with three tries of its own.

### Step 41, a payment run, decided by the learner (2026-10-20 to 2026-10-22)

Copied from step 40c. Claude Code showed the problem first: on step 40c's code, the agent drafted
a week of 37 bills, 430,845.50 USD, one call each; the day's limit stopped it at bill 16, the order
of the calls decided who was paid, and cfo_100 approved three single drafts without seeing the
week. Then the learner decided, one question at a time: a run drafts and does not send (D1); all or
nothing (D2); at most 50 lines (D3); the approval carries the fingerprint and the totals (D4); each
line its own proposal (D5); a line's key derived from the run's key and its invoice (D6); a run
waits for the CFO when any line would (D7). A run that replaces a waiting one (D8) is a second idea,
DSOR-APR-12, so the learner moved it to step 41b.

- **Found while checking the design:** every approval carries `payload_hash` (DSOR-APR-09), so a
  run's carries it beside the fingerprint. The schema has no field for totals per vendor (open
  question 159).
- **Predictions, run for real:** all four right. A week over the day's limit is refused whole; a
  wrong total is `APPROVAL_MISMATCH` and the run still waits; a bill of a waiting run cannot be
  drafted alone; a vendor suspended before the release voids the whole run.
- **The review:** three high findings. A dry run checked no line (H1); a dry release was an
  accident (H2); the sum lost a six-place fraction (H3). A stale rate sheet voided an approved run
  (M1); two runs of the same bills in opposite orders deadlocked (M2); a run's approval kept no
  version (M3); seven breaks were green (M4). After L2 the learner scoped a line's key by company
  and caller (D11); after L3 the learner had the database move a line only with its run (D12,
  migration 045).
- **Found along the way:** starting the lines inside the work put their moves inside the code's
  savepoint, so a refusal rolled them back and the close failed; the lines now start after the
  run, at line ⑧. "Fingerprint" meant two hashes; it now means only the run's.
- **Left open:** a waiting run cannot be replaced (step 41b); no run lets some lines through;
  memory keeps the drafts a refused run's work wrote; no operation lets the approver read a run.

### Step 41b, replace a waiting proposal, decided by the learner (2026-10-22 to 2026-10-23)

The learner's own extra step, split off from step 41's D8 because DSOR-APR-12 holds for every
proposal. On step 41's code, one wrong line held a waiting run of 12 for a week, and nobody could say
"stop". The learner decided: replace only, no `proposal.cancel` (D1); any proposal, a draft or a run
(D2); until it executes (D3); a field on the new command (D4) that travels in the request envelope
(D9); the old proposal's own requester, an agent under the same slip (D5, D10); one transaction (D6);
the old booking given back first (D7); the record and the refusal tell (D8); a line cancelled only
with its run, on the database (D11).

- **Found while checking the design:** another company's address answers `TENANT_MISMATCH`, as
  `proposal.approve` does; only the company's code is replaced, and only by it; the lock is the
  company's ending lock; "rolls it back" needs a savepoint, with a run's lines made before it; D11
  changes the tear-up's order; a dry run of a replacement answers as the real one would.
- **Predictions, run for real:** all three right.
- **The review:** one high finding. In `execute` mode a new command that needs no one ran the
  company's code at once, and a refusal there left the old proposal cancelled while the caller heard
  "refused" (H1). The learner answered Q1 with (c): a replacement never runs at once (D12). Also a
  deadlock on the database between a replacement and a plain draft of one bill (M1), untested
  guards (M2, M5), tests that did not need the lock or the freed booking (M3, M4), and smaller gaps.
- **Breaks:** 25, each run in a copy on a new database; all caught. B19 first left every test green
  but the typecheck: the race test never landed between the look and the move, so a unit test gives
  the cancel a store that moved on.
- **Found along the way:** this Mac has no `pg_ctlcluster` and nothing on port 5434, so the build ran
  on a scratch PostgreSQL 17 of its own; there the owner is a superuser, and `DSOR-AUD-04a` fails
  for every step. Two sweeps that migrated at once collided on `dsor_runtime`'s password.
- **Left open:** no `proposal.cancel`, though a run can be withdrawn in two calls; no event tells the
  CFO; memory's undo of a booking is not locked. Open questions 160 and 161.

### Understanding step 42, a REST API, decided by the learner (2026-10-23)

The first step of Part 6. Before any code, a real run on step 41b's code showed the problem: `call()`
is a function, so nothing outside the program reaches DSoR (`ECONNREFUSED`), and the quick way to
add a door, a handler that reads the store itself, gave another company's caller INV-1008's
31,400.00 USD with no record. Five parts: the missing door; one checklist behind every door
(DSOR-OPR-04a); a door with no rules of its own (DSOR-OPR-04b); the envelope on the wire; DSoR's
answer as an HTTP status. Each prediction ran at once, through sketch doors in the scratchpad, two
of them real HTTP servers.

- **The habit found:** "DSoR sees every request". Three misses on one root (a side door, a door's
  own approval check, a door's own 401): DSoR's guarantees hold only for the calls that reach
  `call()`, and every line a door runs first is a place where DSoR is blind. Asked which idea led
  there, the learner picked all four offered. One picture (three doors, the blind zone marked)
  came after the third miss, at the learner's choice. A fourth miss was Habit 2: the company in the
  path was in view, the address in the body was not (step 10's check refused it).
- **What helped:** running the learner's answer as one door and the right answer as another, side
  by side, with the log's count beside each.
- **The decisions, all recommended:** D1 the 18 operations for people get routes; D2 resource
  routes, checked at start-up against the contracts; D3 the envelope in headers, the body is the
  input; D4 statuses by retry class, so `OUTCOME_UNKNOWN` never gets a status a library retries;
  D5 the door hands over everything it can (only 413 and 404 its own); D6 `node:http`; D7 only
  `127.0.0.1` while the fake logins exist.
- **Design questions for Phase A:** the 18 routes and how a path's id becomes an address; the size
  cap and the envelope of a 404 or 413 that `call()` never saw; the status of each §28 code; how a
  test proves the door holds no check of its own.

### Step 42, a REST API, built first at the learner's word (2026-10-23)

After the understanding session, the learner said "go" and Phase A started: A1 (an id in the path
only when there is no body) and A2 (the door has no answer of its own, revising D5) are the
learner's. Then the learner said "build first and we discuss later", so A3 (`INTERNAL_ERROR` as 500)
and A4 (how DSOR-OPR-04b is proved) are Claude Code's. Built in six pieces, red first: the routes,
the translation, the statuses, the `node:http` server, the proof, and `pnpm serve` over the database.
A real `curl` run on a scratch PostgreSQL: eight requests, eight decisions in `dsor.audit`.

- **Breaks:** ten, run in a copy. B8 (the door answers broken JSON with 400) first left every test
  green: the translation was tested, and no test sent broken JSON through the real server.
- **The review:** one high finding, H1: one request (a target that is no URL, or a body cut off
  mid-upload) stopped the whole program. M1: the first proof of DSOR-OPR-04b missed four door checks,
  because its cases were one company, no mode, and few callers who may; the door now gets only a
  function that asks `call()`, and a spy proves the request and the answer pass unchanged, 756 cases.
  M2, M3, L1 to L10 fixed or recorded.
- **For the learner:** Q1, the review's M4: the door did not check `Host`, so DNS rebinding let a web
  page call it with the public `tok_d4e8`. The learner chose a 421 for a foreign `Host` (D8), built
  red first. Still open: the review of A3 and A4.
- **Found along the way:** `fetch` will not send an `Expect` header; cfo_100 may not draft a
  payment, so line ⑤ refused her before line ⑥ saw the JSON. Open questions 162 and 163.

### Steps 42 and 43, completed with every assumption Claude Code's (2026-10-23)

The learner said "for now make all assumptions and complete 42 and 43 as well, then we discuss the
details". So step 42's A3 and A4 stand, and every decision of step 43 is Claude Code's, D1 to D10,
for the learner to review.

- **Step 43 in one line:** a person's signed token, checked against the keys its issuer publishes,
  then DSoR's own link from the login to a principal, who keeps only the companies that trust that
  issuer. Agents keep fake tokens until step 44.
- **The run:** on step 42's code, a stranger approved INV-1008 with `tok_d4e8` from the public file,
  and the log blamed cfo_100; on step 43's, that token, a token forged with another key, and a token
  of an unknown issuer are each refused at line ①, and cfo_100 approves with her own.
- **Breaks:** eight; B2 (any algorithm) first passed every test, because jose refuses `none` and
  HS256 against an Ed25519 key by itself.
- **The review:** one high finding, H1: the shipped stand-in gave anyone on this computer, the agent
  too, cfo_100's token. Now a code per person, and `DSOR_STAND_IN=on`. M1: C7 overclaimed the key
  cache. L3: a token could live until the year 3000.
- **Found along the way:** a test shortcut (a flag that skipped the issuer check) nearly became a
  feature of `pnpm link-login`; two runs on one scratch database spoiled each other.
- **Then made real (2026-10-24):** the learner asked "have we done similar mistakes before?" Yes: the
  database left Neon at step 20 (all ten branches in use) and never came back, and step 43 was called
  done on a stand-in. With the Neon connector, Claude Code made the project `dsor-baby-steps`,
  switched on Neon Auth with Better Auth, and pointed `issuers.json` at it; the learner signed
  cfo_100 up and in (Neon wants an `Origin` header from a script), and her real token read INV-1008.
  The first real call failed because the door ran where it could not reach Neon's keys: an outage
  looked like a forgery (L7). Lesson: a step whose map names a real product is not done on a
  stand-in; say "built against a stand-in" until the real run passes. Open questions 164 and 165.
- **Then revised by the learner (2026-10-24):** "I see really bad business and prod decisions on
  this step." The learner chose R1 to R7, one question at a time: invitations instead of hand-made
  links, tenant administrators who invite and unlink, `pnpm invite` for the owner, any provider's
  algorithms, an outage that says so, a sign-in service stated as DSoR's own, and unlinking as the
  off-switch. All built red first, fifteen breaks each caught. The hostile review then found that
  an admin could invite a person who already had a login and become them with a second sign-up;
  now each person has one live login. Then run for real on Neon: cfo_100 joined again by an
  invitation from `pnpm invite`, and her first call with the code linked her Neon login. Lesson: a decision made "for now,
  with every assumption" is a decision the learner has not made yet; the review of it is where the
  step is decided. Open questions 166 and 167.

### Step 43b, people and roles in DSoR's table (2026-10-24)

- **The question first:** "is it prebuilt in Managed Neon Auth?" Partly: its organizations have three
  fixed roles, no CFO. So the learner chose DSoR's own table now, and a company's own source, with a
  real single sign-on server, as step 43c. The choice of source is per company, as `issuers.json` is.
- **Two of the learner's first answers met walls in earlier steps,** and were asked again: reusing
  payment approvals needed step 31's unbuilt release of DSoR's own work, so a small `role.confirm`;
  and the owner is no person, so `pnpm grant` makes only the first administrators.
- **Found while building:** on PostgreSQL, the cross-company suite's own same-company call removed
  cfo_100, because the example of `person.remove` named her; every later file failed. Examples now
  name a person no company has.
- **Breaks:** ten, each caught.
- **The hostile review found a critical hole:** org_789's administrator could add an id called
  cfo_100, unlink and invite it, and sign in as org_456's CFO, because a person's id and login are
  one for all of DSoR. Fixed red first, with a removed CFO's approval that still released a payment,
  and nine smaller findings. Lesson: a design that is per company in the table but global in the
  logins must be attacked across the seam.

### Understanding step 43c, a company's own role source (2026-10-25)

Not built. Six parts, each settled by a real run on step 43b's code from the scratchpad, or by a
sketch labelled so: whose truth `role-sources.json` names; the three kinds of role source (ask each
time, a pushed copy, DSoR's own) and `max_staleness`; the role map; whose id DSoR asks a directory
about; roles inside a token, a photo from sign-in; leavers, whose power outlives the leaving by the
push delay, the copy's age, or a token's age.

- **The habit found:** "DSoR knows what the story knows". Four misses on one root (a group name read
  as a role, a directory asked in DSoR's name, a token's roles after HR removed them, a SCIM copy
  before its push). The story tells the learner what is true; DSoR knows only what reaches it.
  Asked which idea led there, the learner picked all four offered, including "when unsure, let it
  through", which is the opposite of DSoR's rule: a lock that stays locked when the power fails.
- **What helped:** each run showed the learner's case beside the right one, and the fourth miss got
  a before-and-after run of one push.
- **Design questions for Phase A:** the learner's SSO server; which kind or kinds of role source; the
  role map (names or ids, many to one, where it lives); whose id (the directory's as the principal's,
  or a mapping), and whether a directory member still needs an invitation; the numbers (lookup
  staleness, copy age, full re-read period, a bound for a person on the call, open question 168);
  leavers (`active: false` or a delete, at once or at next use, a missed push); and whether a powerful
  role granted in the company's directory still needs DSoR's second administrator.

### Step 43c's design, the learner's answers (2026-10-26)

Not built. Asked one decision at a time, each with its trade-off and a recommendation. The learner
took the recommendation each time. Claude Code first checked authentik's documentation: it pushes
each change at once and every object again once an hour, a SCIM mapping can send a group's uuid as
`externalId` and a user's `active`, and `sub_mode` sets which id a token carries.

- **L1. The SSO server is authentik,** run locally, so all three kinds of source could run on one
  machine and authentik reaches DSoR without a public tunnel.
- **L2. A SCIM copy only.** authentik pushes users and groups to DSoR, and the copy lands in step
  43b's tables, which line ① and the role source already read. No lookup, and no roles from the
  token: the token says who is calling, never what they may do.
- **L3. The role map names a group by its uuid,** never its name. A group the map does not name
  gives no role.
- **L4. The map is a file per company,** `role-maps.json`, changed by a pull request and a restart.
- **L5. A person's DSoR id is their authentik username at the first push.** After that the row is
  keyed by the uuid, so a rename changes nothing. Step 43b's rule holds: an id another company has
  or had is taken, and the push is refused.
- **L6. A login links by the uuid, with no invitation.** authentik is the issuer for its company
  only, and a token whose `sub` is a pushed person's uuid in that company is that person.
- **L7. `max_staleness` is PT2H.** One hourly sync and an hour of slack. It meets L2 (24 hours), not
  L3 (one hour), and the README must say so.
- **L8. `active: false` suspends; a DELETE deprovisions.** Either way the next call is refused, and
  the slips are suspended at their next use, through step 43b's path (DSOR-IDN-07).
- **L9. A mapped group's role counts at once.** The second person's check moves to the map's pull
  request; the spec trusts the role source (§10, out of scope: a compromised role source).
- **L10. Step 43b's five commands are refused for a company on a directory.** One truth per
  company, chosen in `role-sources.json`.
- **Still to check in a real run first:** whether authentik's hourly sync sends a request when
  nothing changed. DSoR measures a copy's age as the time since that company's authentik last spoke,
  so a quiet company must still be heard from, or L7 refuses it.
- **Still to design (Claude Code's, in Phase A):** the SCIM endpoint's own credential per company,
  and that it binds the company, never the URL alone; that the endpoint is a back door for
  authentik only, never on the agent's doors; and how a test stands in for authentik while the real
  run uses it.

### Step 43c, built (2026-10-26)

- **L7 was asked again** after the real check found authentik's full sync runs every four hours by
  default; the learner kept PT2H and set authentik hourly.
- **Built in seven pieces, each red first**, then run for real: authentik 2026.8.5 pushing to `pnpm
  serve`'s SCIM door, cfo_100 signing in through authentik with no invitation, user_123's
  deactivation refusing the agent's payment within seconds, and a stopped directory refusing calls
  after `max_staleness`.
- **The real run found three gaps the tests had not:** a provider that had pushed elsewhere kept that
  server's ids, so every push failed and the empty copy still counted as current; the SCIM door left
  no record of a dead token; an old copy was reported as a table outage. Each fixed red first.
  Lesson: a claim about freshness must be checked with a directory that fails, not only one that
  goes quiet.
- **Earlier steps' rules decided three shapes:** no argument named `user` (step 05), lists of
  records in answers (step 14), no `SECURITY DEFINER` and no tenant column without row-level security
  (step 16).
- **Breaks:** nine, each caught. The learner predicted B1, B3, and B6. B1's question named the person
  who signed the slip, so separation of duties decided it: a badly asked question, now said so in
  the README.
- **Fixed in step 43 and its copies:** `test/invitations.db.test.ts` read `DSOR_MIGRATION_URL` from
  the shell, not `.env`; it loads it from the step's `.env` now.

### Step 43d, paused: where identity ends and authority begins (2026-10-26)

Not built. The understanding session taught parts 1 to 4: three ways to know a role; the door and
the key; one person, two names; slow, down, or strange. Then the learner asked that every step be
questioned from two stories, the finance one and Panaversity ops. The ops story questioned the
steps' identity design, and the session paused on four design questions. **None is decided.**

- **How it came up.** In ops, two or three operators hold DSoR roles. The students are data that
  the commands act on, not principals. Seen from there, steps 43 to 43c keep a second copy of what a
  sign-in server keeps already: Better Auth has its own `account`, `invitation`, and `member`
  tables. The split into `logins`, `invitations`, `people`, and `role_grants` is Claude Code's
  design in steps 43 and 43b. The specification states only the goals: DSOR-IDN-01, DSOR-IDN-03a,
  DSOR-IDN-04a, DSOR-IDN-04b, and DSOR-IDN-05. An independent review by a read-only architect agent
  kept three of the four tables and called `invitations` a duplicate.
- **From the lesson, settled later:** part 4's prediction about Ali was asked again after these
  questions. See the session's close below.

**Q1. The identity boundary: which side owns each thing?**

| Thing | Today | The open question |
| --- | --- | --- |
| A person's account, password, second factor, and email | The sign-in server | None: [§12](../../specs/dsor/02-security.md#12-identity-and-principals) delegates authentication |
| Invitations and their emails | `dsor.invitations`, beside the SSO's own `invitation` | Keep DSoR's, or leave invitations to the sign-in server? |
| Company membership | `dsor.people` | DSoR's table, which keeps who left (DSOR-IDN-07 acts on that), or the SSO's `member`, whose rows go with no history? |
| The link from (issuer, `sub`) to a person | `dsor.logins` | A link to DSoR's own ids, or the issuer and `sub` as the id? |
| An agent's identity | Fake tokens in `src/principals.ts` | An OAuth client of the sign-in server, with its own key (DSOR-RP-10)? |
| Money roles, such as "may approve 31,400 USD" | `dsor.role_grants` | DSoR, the sign-in server's org roles, or each company's choice? |
| Slips, approvals, rules, and audit | DSoR | None: §37 says authentication "never replaces" them |

Facts found on the way:

- **`logins` is the wrong name.** The table holds links, not sign-ins. A second sign-in adds no row:
  in the live 43c database, user_700 made three calls and has one row.
- **In the Panaversity SSO, owner, admin, manager, and supervisor all hold the admin permissions.**
  If money roles lived there, a teacher or a coordinator could change them.
- **`tenant_admin` holds `role:grant` and also `payment:approve` and `proposal:approve`**
  (`roles.json`). One role carries admin power and money power.
- **In ops, an email change through DSoR could take over an operator's login,** because a password
  reset goes to the new address.
- **Considered and set aside:** DSoR ships its own sign-in server, and every company signs in
  through it. The learner: adding an auth server to DSoR "can be messy", and it makes DSoR own
  identity.

**Q2. A checklist for any sign-in server that DSoR trusts.** The learner's idea: state DSoR's
requirements as RFCs, as MCP does, and accept any sign-in server that meets them. MCP 2026-07-28
makes an MCP server an OAuth 2.1 resource server and puts the sign-in server's details "beyond the
scope". [§37](../../specs/dsor/05-bindings.md#37-identity-binding) already lists most items. No step
built them: `rules-met.md` names DSOR-RP-01a to DSOR-RP-01d only. Step 43 made its own issuer
settings instead, because Neon Auth cannot make a token for DSoR's audience (step 43's review,
finding M2).

| Item | Source | Panaversity SSO, local, checked 2026-10-26 | Neon Auth, from Neon's docs, read 2026-10-26, not tested |
| --- | --- | --- | --- |
| 1. A token names DSoR as its audience (RFC 8707) | MCP, MUST; DSOR-RP-02b | Yes: `validAudiences`, and 43c's run refused an everyday-audience token | Session token: no (finding M2). OAuth Provider plugin: yes, a `resource` "becomes the token's `aud` claim" |
| 2. Server metadata (RFC 8414 or OpenID Connect Discovery) | MCP, MUST | Yes | Yes, `openid-configuration` |
| 3. PKCE with S256, and `iss` in the answer (RFC 9207) | MCP; DSOR-RP-02e, DSOR-RP-02c | Yes, and yes | PKCE yes; `iss` not stated |
| 4. Client ids by metadata document, with dynamic registration off | MCP, SHOULD; DSOR-RP-02d | Yes, and off | Yes, on by default; dynamic registration off by default |
| 5. An agent with nobody present signs with its own key: `client_credentials` with `private_key_jwt` (RFC 7523) | MCP extension "OAuth Client Credentials"; DSOR-RP-10 | Not turned on. Grants: `authorization_code`, `refresh_token`. Client methods: a secret or none. Better Auth 1.6.23 has code for both, not checked | No: "No `client_credentials` grant" |
| 6. An agent for a person who is present: token exchange with `act` (RFC 8693) | DSOR-RP-03 | Not advertised | Not stated |
| 7. Tokens bound to their sender (DPoP, RFC 9449), and step-up by `acr` (RFC 9470) | §37, SHOULD | Not advertised | Not stated; no two-factor plugin in Neon's list of supported plugins |
| 8. A short token life | §37, SHOULD for unattended tokens | 14 days, so DSoR would cap a token's age itself | 15 minutes (session token); 1 hour (OAuth Provider), not configurable |
| 9. The company's own identity provider decides which agents reach DSoR | MCP extension "Enterprise-Managed Authorization" (RFC 8693, then RFC 7523) | Not advertised | Not stated |

Open: which items DSoR makes MUST, and at which level; whether Neon Auth stays in the steps (see
the findings below); whether the Panaversity Better Auth server is published as a separate sign-in
server that meets the list, with items 5, 6, 7, and 9 as its gap list. SCIM is not on this list: it
is a role source (DSOR-IDN-05) that each company may choose, and §41's reference profile names it.

**Q2, Claude Code's recommendation, not a decision.** The list is right in content and wrong in
shape. One list for every server mixes jobs. Split it by door, and by kind of agent:

| Door | Required | Optional |
| --- | --- | --- |
| A. The agent door (MCP), for an agent that acts for a person who connected it | Items 1 to 4 (MCP's own rules, so MCP clients can connect at all); a token no older than one hour by `iat`, checked by DSoR itself; Q3's rule that `client_id` names the actor | Items 6, 7, 9 |
| B. The agent door, for an agent with nobody present | Door A, and item 5. Item 5 is required for the reference profile; for other deployments it waits on the spec question [Is an MCP token for a person, held by an agent, the agent's own credential?](#is-an-mcp-token-for-a-person-held-by-an-agent-the-agents-own-credential) | Item 7 |
| C. The approval door, for people | Item 1 for the approval door itself; the one-hour cap; DSoR's own approval app as `client_id`; a second factor within five minutes when owner-approval mode is on (DSOR-SOD-06) | None |

**Neon Auth findings,** from Neon's docs, read 2026-10-26, not tested:

- Neon's OAuth Provider plugin is "available to all Managed Better Auth projects". It serves MCP's
  protected resource metadata, takes clients by metadata document by default, uses PKCE, puts a
  `resource` into the token's `aud`, and issues one-hour access tokens and 30-day refresh tokens
  that rotate. Its options are not configurable.
- It has "No `client_credentials` grant". Neon's list of supported plugins has no two-factor plugin.
- Step 43's finding M2 holds for Neon's session token, whose `aud` is Neon's own address. It does
  not hold for the OAuth path. On that path, `dedicated_to_dsor` is not needed.
- By door: A, yes; B, no; C, yes for sign-in and no for owner-approval step-up.
- So the finance story can run on Neon: the CFO is not the requester, so no owner step-up is
  needed. Ops cannot: one operator means owner-approval mode, which needs a second factor. Ops
  needs the Panaversity SSO, which has two-factor sign-in. Whether its tokens carry `amr` or
  `auth_time` is not checked.
- A managed sign-in server takes no new routes, so no lookup route can be added to Neon. DSoR-held
  roles (step 43b) fit it. Neon keeps its auth tables in the customer's own database. Whether DSoR
  may read a ban there is not checked, and a table is not a promise.
- **The rule this suggests:** the right role source depends on whether the company controls its
  sign-in server. A server it can extend holds the roles, and DSoR asks it. A managed one cannot,
  so DSoR holds the roles.

**Agent Auth, Claude Code's recommendation: watch it, and leave it open.** Better Auth's Agent Auth
Protocol is "v1.0-draft", and its plugin is "not yet stable". It gives agents their own identity
and grants capabilities with constraints, so it overlaps DSoR's slips.

- For now, DSoR builds only on what MCP has made stable: OAuth 2.1, and the extensions "OAuth Client
  Credentials" and "Enterprise-Managed Authorization" (MCP 2026-07-28). Agent sign-in is the
  sign-in server's job. DSoR checks tokens against the list above.
- The slip stays in DSoR's own store (DSOR-DEL-01a). An outside grant can only narrow it, never
  widen it (DSOR-DEL-01b).
- A trial of Agent Auth belongs in the Panaversity SSO, never inside DSoR. DSoR accepts its tokens
  only when they meet the list.
- Revisit when MCP adds an agent-identity extension, or when an IETF agent draft becomes a working
  group document with two independent implementations. Today none is adopted:
  `draft-klrc-aiagent-auth` (Okta, OpenAI, Ping, Zscaler) is informational; the "On-Behalf-Of User
  Authorization for AI Agents" draft and `draft-ni-wimse-ai-agent-identity` are individual drafts.
  `draft-ietf-wimse-aims` is a working group document, but a model, not a protocol.

**Q3. How does DSoR tell an agent's token from a person's own login?** In MCP's normal flow, an
agent's client holds a token for its user. This is also a question for the specification:
[How does DSoR tell an agent's token from a person's own login?](#how-does-dsor-tell-an-agents-token-from-a-persons-own-login)

**Q4. What to do with steps 43 to 43c.** The learner asked whether to archive them and rebuild.

| Option | How | Cost |
| --- | --- | --- |
| A. Branch from 42 | A new step copies step 42. Steps 43 to 43c stay, marked as replaced in the map and in `docs/status.md` | Nothing goes and CI stays the same; the chain of steps forks |
| B. Archive and rebuild | Move steps 43 to 43c to an archive folder, and rebuild 43 from 42 | A straight chain; CI, `pnpm guard`, `rules-met.md`, and `docs/status.md` all change |
| C. A step that removes | A new step copies 43c, takes the invitations out, and adopts §37 | A straight chain, but it carries 43c's weight, and a removal is hard to teach |

Any option can keep: step 43's token checks (signature by JWKS, issuer, audience, expiry, the list
of algorithms, the age cap), which are the resource server's half of DSOR-RP-02b; step 43b's
`role_grants` as the kind "DSoR-held role assignments"; step 43c's SCIM copy as one role source,
with its real-check findings F1 to F9; every README and review. Any option can drop: `invitations`,
`dedicated_to_dsor`, and step 43's own shape for `issuers.json`. Open: whether to settle the target
(Q1 to Q3) before the way back.

### Understanding step 43d, closed (2026-10-26)

Not built. Six parts, each settled by a real run on step 43c's code from the scratchpad, and each
told from two stories: the finance story and Panaversity ops. The session paused after part 3 for
the identity questions above, and closed after part 6.

| Part | The idea in one line |
| --- | --- |
| 1. Three ways to know a role | A token is a photo from sign-in, absent at 2 a.m.; a pushed copy is as late as its last push; asking is fresh at each call |
| 2. The door and the key | DSoR asks a route made for programs, with its own key, and uses only an answer that names the company and the person it asked about. The Panaversity SSO has no such route |
| 3. Same person, two names | The person, the company, and the role each need a translation. In ops, students are data, not principals |
| 4. Slow, down, or strange | No answer: the kept answer counts until the company's bound. Nonsense: a fault, and the kept answer goes. With DSoR's own table nothing is asked, so a leaver's slips live on until an administrator removes the leaver |
| 5. Work in flight | A tear-up cancels waiting work at once; a move invalidates it at its release; a leave leaves approved work `APPROVED` and booked until it expires or someone tears up the slip |
| 6. The cost of asking | Each agent call asks once: load, time, and dependence on the server. A rate limit is absorbed by the kept answer within the bound, when the caller code reads an error as no answer |

- **The habits found:** "when unsure, let it through" (parts 1, 2, and 5: a token, a strong role,
  or an approval read as enough); "DSoR knows what the story knows" again (parts 1 and 4: a token in
  the story, Ali's sessions that ended); substitution (part 2: "a powerful, active person" in place
  of "an answer about user_123"); and a new one in part 6, "fresh means asked just now". In DSoR,
  fresh means younger than the company's bound.
- **What helped:** each run put the learner's answer beside the right one. The ops story, whose
  domain the learner owns, questioned the design itself and paused the session for Q1 to Q4. An
  independent architect review, and the MCP specification and vendors' documents read live, not
  from memory, settled facts that the lesson alone could not.
- **Found on the way:** an approved proposal outlives its signer's leaving (a question for the
  specification, above); `escalate_to` in `alerts.json` is checked at start-up only; Better Auth's
  ban deletes browser sessions only, and its OAuth provider never reads `banned`. The last two are
  from reading the code, not from a run.
- **Design questions for Phase A,** besides Q1 to Q4 above. None is decided:
  - **Q5.** Ask at every call, as step 19 does, or reuse an answer younger than a short time? The
    specification bounds only an answer's age (§44).
  - **Q6.** What the lookup answers, and how DSoR's caller code reads a failure: a `429`, a `5xx`,
    or a timeout as no answer, and a body that DSoR cannot read as a fault (part 6's third run).
  - **Q7.** Whether a person's own call asks too. Step 19 asks only about an agent's absent signer.
    If the roles move to the sign-in server (Q1), a person's own roles come from the lookup or from
    the token.
  - **Q8.** `max_staleness` for each story with a lookup, and the alert when
    `FRESHNESS_UNSATISFIABLE` starts.
  - **Q9.** A leaver's waiting work: leave it until it expires, cancel it at the suspension (the
    question for the specification), or ask an administrator to tear up the slip.
  - **Q10.** Who gets an escalation when the person named in `escalate_to` leaves: a check at each
    sweep, or a role in place of a person.

### Step 43d's design, the learner's answers (2026-10-26)

Not built. Asked one decision at a time through the ask tool, each with its trade-off and Claude
Code's recommendation first. The problem: with people and roles in DSoR's own table, a leaver's
slips keep working until someone removes the leaver in DSoR too (part 4's run), and DSoR's copy
drifts from the sign-in server, which already knows who holds which role.

- **Q1. The sign-in server holds the roles** (the recommendation). It owns people, membership,
  invitations, leavers, and who holds which role in which org. DSoR owns what a role may do
  (`roles.json`, with approval limits), slips, rules, approvals, and evidence. A person's id is the
  issuer and `sub`; an agent is an OAuth client of the server. DSoR asks the server (a lookup) or is
  told (SCIM). DSoR's own table stays only as the fallback for a server that nobody can extend.
  *Downside:* DSoR depends on that server at each call, and whoever runs the org there can grant
  money roles.
- **Q1b. Admin power and money power split** (the recommendation). `tenant_admin` keeps the
  administration: rules, brakes, slips, and people where DSoR still holds them. Approving money
  stays only with approver roles such as CFO. A one-person company approves under owner-approval
  mode (§16.2). *Downside:* one more role to assign, and the shipped `roles.json` and its tests
  change.
- **Q1c. Ops: an email change is refused for anyone who holds a DSoR role** (the recommendation),
  and no DSoR command ever writes the SSO's member or role tables. Without this, the agent could
  take over the login of the person whose authority it uses (DSOR-SRC-01a). *Downside:* an
  operator's own email changes by hand, outside DSoR.
- **Q2. The sign-in server checklist is split by door** (the recommendation). Door A, an agent for
  a person who connected it: items 1 to 4, tokens no older than one hour by `iat`, and `client_id`
  names the actor. Door B, an agent with nobody present: door A and item 5, required for the
  reference profile, and otherwise waiting on the question for the specification about MCP's
  person tokens. Door C, the approval door: a token made for that door, DSoR's own approval app as
  the client, and a second factor within five minutes in owner-approval mode. Items 6, 7, and 9 are
  optional. *Downside:* three profiles to explain and to test.
- **Q2b. The Panaversity SSO is the main sign-in server for both stories** (the recommendation),
  run locally. It can take the lookup route, roles per org, two-factor sign-in, and
  `client_credentials`. Neon Auth stays in step 43 as history. *Downside:* we run and fix our own
  server (its fix list), and the steps depend on a second repository.
- **Q2c. Agent Auth: watch it, and leave it open** (the recommendation). DSoR builds only on what
  MCP has made stable. The slip stays in DSoR; an outside grant can only narrow it. Revisit when MCP
  adds an agent-identity extension, or when an IETF agent draft is adopted with two independent
  implementations. *Downside:* DSoR may adopt late if Agent Auth wins.
- **Q2d. The Panaversity Better Auth server is published later, as its own product**
  (the recommendation). First its fix list closes: the lookup route, roles per org, grants by the
  org's owner only, history that survives a deletion, `client_credentials` with `private_key_jwt`,
  and short tokens for DSoR. Then it is published as one server that meets the checklist, never as
  part of DSoR. *Downside:* a second product to maintain.
- **Q3. `client_id` and an approval door** (the recommendation). Every token must carry
  `client_id`. DSoR treats every client as an agent except its own approval app. Approvals count
  only at the approval door, from that app, with a token made for that door, so an agent's token
  for the MCP door cannot approve (DSOR-APR-05b). *Downside:* DSoR needs its own approval app, with
  its own client id.
- **Q4. The new steps branch from step 42** (the recommendation). Steps 43 to 43c stay as an
  explored path, marked so in the map and in `docs/status.md`. With Q1 to Q3 the work holds several
  ideas, so it becomes several steps: tokens made for DSoR, then asking the sign-in server, then the
  approval door. The new chain brings over step 43's token checks and, later, step 43c's SCIM copy
  and step 43b's table as the fallback kind. Their names and numbers are still to choose.
  *Downside:* the chain of steps forks, and the numbering needs care.
- **Q5. DSoR asks at every call** (the recommendation), as step 19 does. The kept answer counts only
  when no answer comes, so a leaver is caught at the very next call. *Downside:* one lookup per
  agent call, in load and in time. Fine for ops; in finance's month-end the kept answer absorbs a
  rate limit.
- **Q6. The answer names whom it is about, and an error is no answer** (the recommendation). The
  SSO's route answers the company, the person, whether the person is listed, their status, and
  their roles, and DSoR calls it with its own narrowly scoped key. DSoR uses an answer only when it
  names the company and the person that DSoR asked about. A `429`, a `5xx`, a timeout, or no
  connection is no answer, so the kept answer counts until the bound. Any other body is a fault:
  `INTERNAL_ERROR`, and the kept answer is dropped. *Downside:* a server bug that returns a wrong
  body stops the agent at once (it fails closed).
- **Q7. A person's own call asks too** (the recommendation). A person's call, such as cfo_100's
  approval at the approval door, also takes the roles from the lookup. The token says only who is
  calling. One rule for every caller. *Downside:* one lookup per person call too, and an outage
  longer than the bound stops approvals as well as agents.
- **Q8. `max_staleness` is PT1H for both stories, with an alert at once** (the recommendation).
  One hour meets L3's limit. At the first `FRESHNESS_UNSATISFIABLE`, the company's alert receivers
  hear (`alerts.json`). *Downside:* an outage of the sign-in server longer than an hour stops
  agents and approvals until it ends.
- **Q9. A suspended slip with waiting work alerts the administrators** (the recommendation). One
  tear-up then cancels the work and frees its bookings. No change to the specification; its
  question stays raised. *Downside:* the work waits until an administrator acts.
- **Q10. `escalate_to` names a role, not a person** (the recommendation). Each sweep asks the role
  source who holds that role now. When nobody holds it, the sweep says so to the receivers.
  *Downside:* `alerts.json` changes shape, and its tests change.
- **The new chain, confirmed** (the recommended order, and numbers that continue at 44). Each step
  copies the one before it, and step 44 copies step 42. Steps 43 to 43c stay as the explored path.
  "Again" marks a rule an earlier step met, now met the new way; "new" marks a rule no step has
  met.

| Step | Its one idea | Rule ids | Takes |
| --- | --- | --- | --- |
| 44 · Tokens made for DSoR | A person is who a token made for DSoR says: signature, issuer, audience, expiry, at most one hour old. The person's id is the issuer and `sub`; no link table, no invitations. Agents keep step 42's keys | New: DSOR-RP-02b. Again: DSOR-IDN-01, DSOR-IDN-04a, DSOR-IDN-04b | Applies Q1, Q2, Q2b |
| 45 · Ask the sign-in server | At every call, DSoR asks the SSO who this person is in this company now. A leaver's next call is refused, and the leaver's slips are suspended | Again, against a real server: DSOR-IDN-05, DSOR-IDN-06, DSOR-IDN-07, DSOR-IDN-03a, DSOR-DEL-02, DSOR-BND-02 | Applies Q5, Q6, Q7, and Q8's bound |
| 46 · Who may approve, and up to how much | Approving money belongs to approver roles, each with an approval limit; `tenant_admin` cannot approve. "CFO" is resolved to people at approval time | New: DSOR-SOD-04a, DSOR-SOD-04b | Q1b |
| 47 · The approval door | Approvals count only at the approval door, from DSoR's own approval app, with a token made for that door. The app is a client with PKCE and an issuer check | Again: DSOR-APR-05a, DSOR-APR-05b, DSOR-SOD-01a. New: DSOR-RP-02c, DSOR-RP-02e | Applies Q3 |
| 48 · The agent door (MCP) | Agents reach DSoR through MCP, one tool per command and never a general tool. Every client but the approval app is an agent, and audit names it as the actor | New: DSOR-RP-02a, DSOR-RP-02d, DSOR-OPR-03a, DSOR-IDN-02b | None |
| 49 · An agent with nobody present | The agent signs with its own key, and its token names only the agent; the person comes from the slip | New: DSOR-RP-10, DSOR-RP-11, DSOR-IDN-02a, DSOR-DEL-09. Again: DSOR-DEL-07, DSOR-DEL-08 | None |
| 50 · The right people hear | `escalate_to` names a role; the first freshness refusal raises an alert; a suspended slip with waiting work alerts the administrators | Again: DSOR-UNK-04c. Q8's and Q9's alerts are this tutorial's decisions | Q9, Q10, and Q8's alert |
| Later | A directory that pushes (step 43c's SCIM copy); a sign-in server nobody can extend (step 43b's table as the fallback kind); owner-approval mode for a one-operator company | Again: DSOR-IDN-05 for each kind. New: DSOR-SOD-05 to DSOR-SOD-13 | None |

- **Why this order:** step 44 lets people sign in while agents keep their old keys; step 45 closes
  the leaver gap early; step 46 needs step 45's roles; step 47 comes before step 48, so an agent
  that holds a person's token can never approve; step 49 needs the SSO's grant for agents; step 50
  needs the role source to name a role.
- **Q1c lands in none of these.** The finance chain has no command that writes the sign-in server.
  The first step that adds an ops command touching the SSO takes it, as a rule on that command's
  contract (DSOR-SRC-01a).
- **Outside the steps:** the Panaversity SSO's fix list comes before step 45 (the lookup route,
  roles per org, grants by the org's owner only, history) and before step 49 (`client_credentials`
  with `private_key_jwt`). That work is in the SSO's repository. The map's later rows (OpenViking,
  Graphiti, KSoR) move after step 50; the map, `docs/status.md`, and `rules-met.md` are the
  human's to update. The working names stay open until each step's own design.

### Step 44's design, the learner's answers (2026-10-26)

Not built: no code until the learner says go. Step 44, tokens made for DSoR, copies step 42. The
problem: in step 42 a caller proves who they are with a fixed key that never expires, so
`tok_d4e8` in a log file makes its reader cfo_100 for good; and step 43 took any token from the
sign-in service, whatever app it was made for (its review's finding M2). The idea: a person is who
a token made for DSoR says, from the one trusted sign-in server. Already decided for this step: the
Panaversity SSO (Q2b), at most one hour by `iat` (Q2), no link table and no invitations (Q1).

- **44-1. Step 43's token checks come over** (the recommendation): `jose` 6.2.12; the rule for a
  token (an allowed algorithm, `iss` exactly the trusted issuer, a key from its JWKS, `sub` and
  `iat` present, not expired, five seconds of clock slack); start-up that refuses `none`,
  shared-secret algorithms, and ages over 24 hours; `CONNECTOR_UNAVAILABLE` when the keys cannot be
  fetched; one answer, `AUTHENTICATION_REQUIRED`, for every bad token. Dropped: `dedicated_to_dsor`
  (the audience check replaces it), the link table, and invitations. *Downside:* step 43's choices
  come along without a fresh look.
- **44-2. One trusted issuer for every company** (the recommendation), in one small settings file:
  the issuer, its JWKS address, the allowed algorithms, and the one-hour age. Companies are told
  apart by the request's company and, from step 45, by the server's orgs. *Downside:* a company that
  brings its own Okta later needs the file to grow into a list.
- **44-3. The audience is DSoR's own address** (the recommendation): `http://127.0.0.1:8042`, where
  `pnpm serve` listens, the same string the SSO lists in its `validAudiences`, as 43c's run used.
  MCP calls it the server's canonical URI. Step 47's approval door gets an address of its own.
  *Downside:* when DSoR moves to another address, both ends change together.
- **44-4. A person's id is the token's `sub`, with the story's ids seeded** (the recommendation).
  The id is the `sub` under the one trusted issuer. For the real run, the story's people are created
  in the local SSO's database with their story ids as user ids (user_123, cfo_100, admin_100,
  user_700), so slips and audit keep the story's names, as the spec's own example token does
  (`"sub": "user_123"`). *Downside:* a seed in the local SSO's database, done outside DSoR, and only
  one issuer per deployment.
- **44-5. Until step 45, a person's companies and roles come from step 42's table, by id**
  (the recommendation). user_123 is ap_supervisor in org_456 and cfo_100 is CFO, as in step 42, but
  the table is read by the person's id from the token, not by a fake key. Step 45 replaces it with
  the lookup. *Downside:* a table in the code for one step, which step 45 removes.
- **44-6. People's step-42 keys are gone from `pnpm serve`** (the recommendation). There, a person's
  only credential is a token made for DSoR, and `tok_2c91` and `tok_d4e8` are refused. `pnpm start`
  and the earlier tests keep the fake table as their world's choice, as step 43's D8 did.
  *Downside:* the old tests still prove things with fake people.
- **44-7. DSoR tells a token from an agent's key by its form** (the recommendation). Three
  dot-separated parts is a token, and it goes to the token check; a known agent key goes to step
  42's agent table; anything else is refused with `AUTHENTICATION_REQUIRED`. The request's shape
  does not change. *Downside:* two kinds of credential share one header until steps 48 and 49 give
  agents tokens.
- **44-8. Tests sign tokens with a test-only key; the real run uses the local SSO**
  (the recommendation). Unit tests sign tokens in the test itself, shaped like the Panaversity
  SSO's: RS256, `aud` DSoR, `sub` a story id. The test key exists only inside the tests, and
  `pnpm serve` trusts only the configured issuer's JWKS. No stand-in server, because the SSO is
  local and free, unlike Neon. *Downside:* the real run needs the SSO repository running on this
  computer.
- **44-9. A token's audiences are DSoR and, at most, the SSO's own userinfo address**
  (the recommendation). The SSO lists both when the `openid` scope is asked for (43c's run). A token
  that also names another app, such as the class app, is refused, because that app received the
  same token and could hand it on. *Downside:* a rule shaped by how Better Auth fills `aud`.
- **44-10. A good token for nobody in DSoR's table hears `AUTHENTICATION_REQUIRED`**
  (the recommendation), the same as any bad token, so DSoR tells a stranger, such as a student who
  signed in, nothing about who is a DSoR person. The log records the reason. *Downside:* a real
  person missing from the table sees "log in first" and must ask an administrator why.
- **Still to do before code:** the step's claims, its tests by claim, and its breaks with the
  learner's predictions; and, outside DSoR, the seed of the story's people into the local SSO with
  their story ids (44-4).

### What the SSO fix list changed in the design (2026-10-27)

The Panaversity SSO's fix list is built on branch `feat/sso-dsor-fix-list` of the SSO repository
(11 commits, worktree `tutorsgpt/ag2-sso-dsor`, server on `127.0.0.1:3011`), not pushed and not
deployed. Its hand-over note and the branch's `apps/sso/docs/dsor.md` found six things that change
answers above. Each reopened answer needs a fresh decision before its step; none is decided here.

| Finding | Reopens | What still stands |
| --- | --- | --- |
| **`azp`, not `client_id`.** Better Auth 1.6.23 names a token's client in `azp` and writes no `client_id` claim. An agent's `client_credentials` token has no `sub` either | Q3 ("every token must carry `client_id`") and Q2's door A ("`client_id` names the actor"): DSoR would read `azp` instead. DSOR-RP-11's `sub` for an agent cannot be met on 1.6.23 | The rule itself: every client but DSoR's own approval app is an agent |
| **The `dsor` scope.** Token life is set per scope, not per audience: a token with the `dsor` scope lives one hour, and only a client registered with `dsor` can get it. A DSoR-audience token without it still lives 14 days, and a refresh token lives 30 days | 44-1 and 44-9, what a token must carry: add the `dsor` scope, and an `azp` on DSoR's own list of clients | Q2's cap of one hour by `iat`, checked by DSoR itself |
| **`status: "no_account"`.** The lookup's `status` has a third value beside `active` and `banned`: an id with no user at all, always with `listed: false` | Q6, what the lookup answers: DSoR's reading must accept `no_account`, or the SSO changes it | The answer still names the company and the person it is about |
| **Static DSoR roles.** `ap_clerk`, `ap_supervisor`, `CFO`, `tenant_admin`, `ops_operator`, and `ops_admin` exist in every org, and only an org's owner may grant them. Not `dynamicAccessControl`, because Better Auth lowercases a dynamic role's name (`CFO` would become `cfo`) | Q1's "roles per org", in its detail: one list of roles for every org, held per org | Q1's boundary: the sign-in server holds who has which role |
| **The 429 flood.** DSoR's key allows 100 lookups a minute, counted across every company and caller on that key. An agent that floods DSoR pushes its lookups into 429s; under Q6 a 429 is no answer, so DSoR falls back on kept answers, and a role removed meanwhile works until the bound | Q6 (a 429 as no answer) and Q8 (the bound). Options found: one key per company (the SSO's admin route cannot set a key's limit yet); no authority granted from a kept answer after a 429; a limit per agent inside DSoR | Q5: DSoR still asks at every call |
| **No `private_key_jwt` until Better Auth 1.7.** The 1.6.23 token endpoint never reads `client_assertion`, and `client_credentials` works only with a shared secret, which DSOR-RP-10 forbids for an unattended agent. The unmerged upgrade branch `feat/sso-ba-172` adds keys for clients | Q2b's claim that the SSO can serve `client_credentials` for step 49, and step 49's place in the chain: it waits on that upgrade | Steps 44 to 48, which do not need it |

- **Not reopened, but moved forward:** 44-4's seed is partly done. On the branch's own database,
  `sso_dsor`, org_456 holds user_123 (ap_supervisor), cfo_100 (CFO), a banned user_900, and a
  non-member user_700.
- **A practical note for 44's real run:** the branch serves on `127.0.0.1:3011`. The run must name
  that issuer, or the main checkout's server on `127.0.0.1:3001` stops first and the branch serves
  there.

### The reopened answers, decided (2026-10-27)

Asked one at a time through the ask tool, each with its trade-off and Claude Code's recommendation
first.

- **R1. The client is `client_id` or `azp`, and the two must agree** (the recommendation). Reopened
  Q3 and Q2's door A. DSoR reads `client_id` (RFC 9068, the spec's own example) or `azp` (OpenID
  Connect's authorized party). When both are present they must be the same; when neither is, the
  token is refused. It works with Better Auth today and with servers that follow RFC 9068.
  *Downside:* two claim names to explain and to test.
- **R2. A token carries the `dsor` scope and comes from a client DSoR knows** (the
  recommendation). Reopened 44-1 and 44-9. The SSO lets any of its clients ask for DSoR's audience,
  so `aud` alone does not prove a token was meant for DSoR's own clients. The scope must include
  `dsor`: only a client registered with `dsor` can get it, and its tokens live one hour. The client
  (R1) must be on DSoR's own short list of clients in its settings. So the class app, holding a
  token with DSoR's audience, is refused. *Downside:* one more list in DSoR's settings, kept in
  step with the SSO's registrations.
- **R3. DSoR translates the SSO's words** (the recommendation). Reopened Q6. DSoR's code for this
  server turns `banned` into `suspended`, so the signer's slips are suspended (DSOR-IDN-07).
  `no_account` always comes with `listed: false`, which step 42 already reads as "not a person
  here", and that suspends the slips too. Any other word stays a fault. DSoR's own rules do not
  change. *Downside:* a small table of words to keep in step with the SSO.
- **R4. DSoR's roles are one static list in every org, granted by the org's owner only** (the
  recommendation). Reopened Q1's detail. The names are exactly as `roles.json` spells them, so
  `CFO` stays `CFO`. *Downside:* a new DSoR role means a change to the SSO's code and a deploy.
- **R5. DSoR stays under the SSO's limit itself** (the recommendation). Reopened Q6 and Q8. Each
  company has its own SSO key, and DSoR counts its own lookups for each company. At the key's
  budget, DSoR refuses further calls itself, as `RATE_LIMITED`, and uses nothing it kept, instead
  of meeting a 429. A real 429, from trouble on the SSO's side, still counts as no answer. So a
  flood cannot keep a removed role alive on a kept answer. *Downside:* during a flood, the other
  agents of that company are refused until the minute passes.
- **R6. Step 49 waits for Better Auth 1.7** (the recommendation). Reopened Q2b and step 49. Steps
  44 to 48 are built now. Step 49 waits until the SSO moves to Better Auth 1.7.x (branch
  `feat/sso-ba-172`); then a real test checks that `private_key_jwt` works and whether an agent's
  token carries `sub` (DSOR-RP-10, DSOR-RP-11). *Downside:* the 2 a.m. agent has no real token until
  then; it keeps step 42's key.
- **Where each answer lands:** R1 and R2 in step 44's token checks; R3 and R5 in step 45's lookup;
  R4 in the SSO, already built; R6 in step 49.

### Step 44's claims, tests, and breaks (2026-10-27)

Not built: the design before any code. It becomes the step's README section "The design, before
any code" when the folder is made. Rules: DSOR-RP-02b is new; DSOR-IDN-01, DSOR-IDN-04a,
DSOR-IDN-04b, and DSOR-EXE-02 are met again, the new way. The rest are this tutorial's decisions,
named by their answer (44-1 to 44-10, Q2, R1, R2).

**The claims:**

- **C1. A person's call counts only with a token made for DSoR** (DSOR-IDN-01, DSOR-RP-02b). All
  of these hold at once: signed with an allowed algorithm (RS256 for the Panaversity SSO) by a key
  that the trusted issuer publishes; `iss` exactly the trusted issuer; `aud` names DSoR's address,
  and any other audience is the SSO's own userinfo address (44-9); `scope` includes `dsor` (R2);
  the client, from `client_id` or `azp` and the same in both when both are present, is on DSoR's
  list (R1, R2); `sub` and `iat` present; not expired; `iat` at most one hour ago (Q2); five seconds
  of clock slack (44-1).
- **C2. Every refused token hears one answer** (DSOR-IDN-01, DSOR-EXE-02):
  `AUTHENTICATION_REQUIRED` at line ①, before any company's code runs, with the decision and its
  reason recorded before the answer (44-1, 44-10).
- **C3. A person's companies and roles come only from step 42's table, read by the token's `sub`**
  (DSOR-IDN-04a, DSOR-IDN-04b; 44-4, 44-5). A role or company claim in the token is never read. A
  good token whose `sub` is nobody in the table hears `AUTHENTICATION_REQUIRED` (44-10).
- **C4. In `pnpm serve`, a person's step-42 key is refused, and an agent's key still works** (44-6,
  44-7). The two are told apart by form. `pnpm start` and the earlier tests keep the fake table.
- **C5. Start-up refuses settings that trust too much** (44-1, 44-2, Q2): `none` or a shared-secret
  algorithm, an age over one hour, no audience, no `dsor` scope, an empty client list, or an issuer
  that is not an absolute address.
- **C6. Keys that cannot be fetched are an outage, not a bad token** (44-1):
  `CONNECTOR_UNAVAILABLE`, retry `safe_same_key`, recorded with the cause, never "log in first". A
  token whose key the issuer does not publish is still a bad token.

**The tests, by claim** (titles start with the rule id or the answer; the tests sign tokens with a
test-only key, 44-8):

| Claim | Tests |
| --- | --- |
| C1 | `DSOR-IDN-01`: cfo_100's token from the trusted SSO, made for DSoR, with `dsor` and a listed client, makes cfo_100 the caller, a person, who reads INV-1008 whole. `DSOR-RP-02b`: a token made for DSoR's test copy at `http://127.0.0.1:8043`, every other check passing, is refused; one whose `aud` lists DSoR and the class app is refused; one whose `aud` lists DSoR and the SSO's userinfo address counts. `R2`: no `dsor` scope, every other check passing, is refused; a client not on DSoR's list is refused. `R1`: `azp` alone counts; `client_id` alone counts; both and equal count; both and different are refused; neither is refused. `Q2`: 59 minutes after `iat` counts; 61 minutes is refused, though `exp` is days away. Carried from step 43: another key, another issuer (a trailing slash), HS256 signed with the public key, `none`, ES256 when only RS256 is allowed, no `sub`, no `iat` or one in the future, expired 10 seconds (refused) and 3 seconds (counts), and a key that stops being published |
| C2 | `DSOR-IDN-01`: a refused token never reaches the company's code, and line ① refuses it. `DSOR-EXE-02`: the refusal is recorded, with its reason, before the answer. `DSOR-IDN-01`: every kind of bad token hears the same `AUTHENTICATION_REQUIRED` |
| C3 | `DSOR-IDN-04b`: user_700's token claims `tenant_id` org_456 and `org_role` CFO; DSoR reads neither, and user_700 is refused in org_456. `DSOR-IDN-04a`: user_123's roles come from the table by `sub`: ap_supervisor in org_456. `44-10`: a good token for user_555, a student nobody listed, hears `AUTHENTICATION_REQUIRED`, and the log says why |
| C4 | `44-6`: in `pnpm serve`'s world, `tok_d4e8` is refused at line ①, and the agent's `tok_7f3a` still works. `44-6`: `pnpm start`'s world keeps step 42's table, where `tok_d4e8` is cfo_100. `44-7`: a three-part string that is not a valid token is refused and never looked up as a key; a key no agent holds is refused |
| C5 | `44-2`: the shipped settings pass and name the local SSO. Start-up refuses `none`, HS256, an age over one hour, a missing audience, a missing `dsor` scope, an empty client list, and an issuer that is not an absolute address |
| C6 | `44-1`: the issuer's keys cannot be fetched: `CONNECTOR_UNAVAILABLE`, retry `safe_same_key`, recorded with the cause. `44-1`: a token whose key the issuer does not publish is still a bad token, not an outage |

The real run: `pnpm serve` against the SSO branch on `127.0.0.1:3011`, with the story's ids seeded.
cfo_100's token from DSoR's listed client counts; another client's token for DSoR's audience is
refused; `tok_d4e8` is refused.

**The breaks** (each made for real at build time, in a copy, and its output put in the README; the
learner's prediction is recorded first):

- **B1. The audience check is deleted.** DSoR's test copy at `http://127.0.0.1:8043` trusts the
  same SSO, with the same client and the `dsor` scope. A token made for the test copy reaches the
  real DSoR at `8042`. *The learner's prediction:* accepted as cfo_100, with an ALLOW recorded.
- **B2. The `dsor` scope check is deleted.** DSoR's own sign-in app forgets to ask for `dsor`, so
  the SSO gives cfo_100 a token that lives 14 days. It reaches DSoR 90 minutes after its `iat`.
  *The learner's prediction:* accepted.
- **B3. The client-list check is deleted.** An SSO administrator registers a new "reports" client
  with the `dsor` scope, without DSoR's say. cfo_100 signs in to it, and its token for DSoR's
  audience asks DSoR to approve PAY-901. *The learner's prediction:* the approval counts, and the
  record names cfo_100 as approver.
- **B4. Roles are read from the token.** user_700, ap_supervisor in org_789, holds a token whose
  claims say `tenant_id` org_456 and `org_role` CFO. It asks DSoR to approve PAY-901 in org_456.
  *The learner's prediction:* the approval counts, as a CFO's.
- **B5. People's step-42 keys work again in `pnpm serve`.** `tok_d4e8` is found in a log file, and
  someone sends it to `pnpm serve` to approve PAY-901. *The learner's prediction:* the approval
  counts as cfo_100's.
- **B6. The one-hour age check is deleted,** and the SSO's setting has changed so `dsor` tokens live
  14 days. A token stolen three hours ago reaches DSoR. *The learner's prediction:* accepted as its
  owner.
- **B7. An outage of the keys is reported as a bad token.** DSoR restarts at 09:00 while the SSO is
  down, so no keys are cached. cfo_100's good token arrives. *The learner's prediction:* cfo_100
  hears "log in first".
- **B8 (R1). The client is read only from `client_id`.** The Panaversity SSO writes only `azp`.
  cfo_100's good token arrives on Monday morning. *The learner's prediction:* refused for everyone,
  a lock that stays locked.
- **Settled at build time,** each by a real run of the broken copy beside the whole one. No
  prediction is judged before then.

### Step 44's review: two answers (2026-10-27)

Two reviewers who had not seen the conversation found one latent hole (a token whose `act` names
an agent counted as the person's own login), guarantees no test protected, and README sentences
the code contradicted. Those were fixed red first. Two findings changed the design, so they were
put to the learner, each with Claude Code's recommendation, and the learner took it:

- **44-11. The record keeps a token's login and a refusal's cause.** Every refused token recorded
  one sentence, so the reports app replaying cfo_100's token looked like an old token. Now, once a
  token's signature checks, its record names the issuer, the person, and the app, whether the call
  is allowed or refused, and a refusal names its cause. The caller still hears one answer.
  *Downside:* a list of causes to keep, and at most 200 bytes for each name a record keeps.
- **44-12. `pnpm serve` starts only when the audience is its own address,** `http://127.0.0.1` at
  the port it listens on. A copy on 8043 with the shipped file had taken tokens made for 8042.
  *Downside:* behind a proxy with a public https address, the check has to learn that address.
- **The breaks came out in the step's README, under "Break it".** The habit behind the misses:
  "one check gone, the token gets in". A token must pass every check, and the others still run.

### Why the chain diverged from the map (2026-10-27)

The learner asked why the chain left the map's Part 6, whose steps look sensible. The map's goals
stay: real logins, agents with tokens of their own, an MCP door, and safe approvals. What changed
is who holds identity.

- **The map has two sign-in systems, because of one platform limit.** People sign in through
  Managed Better Auth (Neon Auth). It gives agents no tokens (no `client_credentials`), so the map
  adds a second Better Auth server, run by us, for agents and MCP (its "why two").
- **Two systems mean two logins per person.** So DSoR keeps a table that links each login to a
  person: the map's step 43, which gains a second row for user_123 in its step 45. Steps 43b and
  43c went further: people and roles in DSoR's own tables, then a SCIM copy from authentik.
- **43d's understanding session questioned where that leads.** In the learner's words: "we are
  just adding more and more tables illogically", "A role gets updated in sso and all will fail",
  "too complex for anyone to setup and use dsor", and "we are reinventing the role of sso".
- **The spec does not ask DSoR to own identity.** §37 asks that a token was made for DSoR and that
  DSoR checked it. §12.1 lets the sign-in server be the role source. MCP leaves the sign-in server
  "beyond the scope".
- **One server removes the need for two.** The Panaversity SSO is a Better Auth server we run, and
  the ops story already uses it. It can sign in people and agents, answer lookups, hold roles per
  company, and ask for two-factor sign-in (Q2b). With one server, a person has one login, whose id
  is the issuer and `sub`. No link table, and no invitations (Q1).
- **The boundary (Q1).** The sign-in server says who someone is and which roles they hold. DSoR
  decides what a role may do, and keeps slips, rules, approvals, and evidence. From step 45, DSoR
  asks at every call, so no copy goes stale (Q5, Q7).
- **Doors by purpose (Q2, Q3).** An agent door (MCP), and an approval door reached only from DSoR's
  own approval app. An agent's token then cannot approve at all. The map's step 47 treats the same
  danger as a trap to refuse.
- **The cost.** The map and `docs/status.md` are out of date. The chain depends on our own SSO's fix
  list. And some of the map's rules had no step until the decisions in the next section.

### The extended chain, with three decisions (2026-10-27)

Compared rule by rule with the map's steps 43 to 51, the chain left some rules with no step: acting
for a person (DSOR-DEL-03a, DSOR-DEL-03b, DSOR-RP-03), five MCP binding rules (DSOR-RP-04,
DSOR-RP-05a, DSOR-RP-06a, DSOR-RP-07a, DSOR-RP-07b), the MCP traps (DSOR-RP-08, DSOR-RP-09a,
DSOR-RP-09b), a real agent and prompt injection (DSOR-SRC-01a and DSOR-SRC-01b, both L1), and Part
7. The learner decided their places, each time taking Claude Code's recommendation:

- **Placement: extend where the idea is new.** The five binding rules join step 48, because they
  are the agent door itself. A small step for the traps, and one for a real agent, come right after
  48. Part 7 comes after step 50. *Downside:* the chain grows, and step 48 gets bigger.
- **Numbering: letters after 48,** 48b and 48c, so steps 45 and 49 keep the numbers that the SSO's
  pull request, its hand-over note, and these notes use. *Downside:* letters can read as optional
  extras, though these are spec rules.
- **Acting for a person: in step 48, as door A.** Door A is an agent acting for a person who
  connected it. Step 48's design settles whether the agent shows as the token's app (`client_id`,
  as Q3 chose) or as `act` (RFC 8693, as DSOR-RP-03 requires), and meets DSOR-DEL-03a and
  DSOR-DEL-03b. If DSOR-RP-03 must change, it changes in the open, through the `change-the-spec`
  skill. Until then step 44 refuses `act`. *Downside:* step 48 holds the MCP door, its rules, and
  the actor rule, and may need a change to the spec.

| Step | Idea | Rules |
|---|---|---|
| 44 · Tokens made for DSoR | Built | New: DSOR-RP-02b. Again: DSOR-IDN-01, DSOR-IDN-04a, DSOR-IDN-04b |
| 45 · Ask the sign-in server | DSoR asks the SSO at every call | Again, against a real server: DSOR-IDN-05, DSOR-IDN-06, DSOR-IDN-07, DSOR-IDN-03a, DSOR-DEL-02, DSOR-BND-02 |
| 46 · Who may approve, and up to how much | Approver roles, each with a limit | New: DSOR-SOD-04a, DSOR-SOD-04b |
| 47 · The approval door | Approvals only from DSoR's own approval app | Again: DSOR-APR-05a, DSOR-APR-05b, DSOR-SOD-01a. New: DSOR-RP-02c, DSOR-RP-02e |
| 48 · The agent door (MCP), door A | An agent acting for a person who connected it | New: DSOR-RP-02a, DSOR-RP-02d, DSOR-OPR-03a, DSOR-IDN-02b; now also DSOR-RP-04, DSOR-RP-05a, DSOR-RP-06a, DSOR-RP-07a, DSOR-RP-07b, DSOR-DEL-03a, DSOR-DEL-03b, DSOR-RP-03, and the rest of DSOR-DEL-10 |
| 48b · Two MCP traps | An answer sent in the middle of a call is no approval; routing headers that disagree with the body are refused | New: DSOR-RP-08, DSOR-RP-09a, DSOR-RP-09b |
| 48c · A real agent | An injection test suite, then a real agent through door A | New: DSOR-SRC-01a, DSOR-SRC-01b |
| 49 · An agent with nobody present, door B | The agent's own signed token | New: DSOR-RP-10, DSOR-RP-11, DSOR-IDN-02a, DSOR-DEL-09. Again: DSOR-DEL-07, DSOR-DEL-08. Waits on Better Auth 1.7 |
| 50 · The right people hear | Alerts to a role, not a fixed name | Again: DSOR-UNK-04c |
| 51 to 53 · Skills, memory, the whole digital employee | Part 7, in the map's order | The CTX rules |

Two notes. 48c's injection suite (DSOR-SRC-01b) needs no MCP, so its design may build the suite
first and add the real agent after. Part 7 needs 48c's real agent.

### Questions for step 45's design (2026-10-27)

Raised while explaining step 44's architecture. No decision: Phase A of step 45 starts from them.

- **Whose contract is the lookup?** The Panaversity SSO's branch has `GET /api/dsor/lookup`, made
  for DSoR, called with an API key that lists DSoR's companies. No standard defines it, and a
  managed server such as Neon Auth cannot add a route. A public DSoR should not depend on one
  server's API. Options found:
  - (a) DSoR documents the request and the answer of the `idp_lookup` kind as its own contract. The
    Panaversity route is one implementation, and another sign-in server serves it through a small
    adapter.
  - (b) DSoR uses the SSO's route as it is.
  - (c) A standard instead: SCIM (RFC 7643, RFC 7644), which Q1 allows ("DSoR asks the server, or
    is told").
- **Which key does DSoR hold for each company?** (Added 2026-10-27.) Today the SSO's administrator
  makes one key that lists every company DSoR may ask about. Options found:
  - (a) Keep the one key with its list.
  - (b) One key for each company, owned by that company's organization (`references:
    "organization"` in the api-key plugin). The company's owner makes the key and can take it
    back. A leaked key shows only one company's people. *Cost:* the SSO's `apikey` table changes,
    and DSoR keeps one secret for each company. Claude Code recommends (b).
  - (c) A token from the SSO instead of a key (client credentials), as agents get in step 49. The
    SSO would then need its own way to say which companies the token may ask about.
- **How do the system logins sign in?** dsor-scheduler and dsor-rates are DSoR's own timer jobs,
  with keys in `src/principals.ts`. No step in the chain plans their credential. Options found:
  - (a) Run them inside DSoR, never through the door.
  - (b) Make them apps of the sign-in server, with tokens of their own, as agents get in step 49.
  - (c) Keep their keys, and record why.
- **Do the people's rows stay in `src/principals.ts`?** `pnpm start` and the older tests still use
  them (44-6), while `pnpm serve` refuses their keys. Step 44's README leaves this to step 45.
  Options found: keep them for that world, or move the older tests to a world shaped like the SSO.

The next section changes two of these options. Option (c) of the first question needs a sign-in
server other than ours, and option (b) of the second becomes possible.

### Better Auth 1.7 against the chain (2026-10-27)

The learner asked whether Better Auth has a standard or a plugin that serves the spec after an
upgrade, and asked to drop what no longer matters. Checked in Better Auth's current documentation,
and in 1.7.2's own code from the local pnpm store. The SSO runs 1.6.23. Its upgrade branch,
`feat/sso-ba-172`, is at 1.7.2 (draft pull request panaversity/agentfactory#1288). npm is at 1.7.14.

- **The upgrade serves every token rule left in the chain.**
  - DSOR-RP-10 (step 49): `private_key_jwt` (RFC 7523), with the agent's keys given by `jwks` or
    `jwks_uri`, and a replay guard.
  - DSOR-RP-11 (step 49): a machine token's `sub` is the agent's client id, beside `client_id` and
    `azp`. 1.7.2's `createJwtAccessToken` sets `sub = user?.id ?? client.clientId`. In 1.6.23 only
    `azp` names the agent.
  - The spec's SHOULD for unattended tokens (DPoP, RFC 9449, in §37): DPoP-bound tokens. DSoR would
    check each proof itself.
  - DSOR-RP-02e and DSOR-RP-02c (step 47): S256 PKCE always, and `iss` in every authorization
    response (RFC 9207).
  - DSOR-RP-02d (step 48): registration stays off unless turned on, and `@better-auth/cimd` fetches
    and checks each client metadata document. Today the SSO pins ChatGPT's and Claude's CIMD
    addresses as fixed clients, and fetches no document.
- **No standard serves the lookup.** The organization plugin answers a signed-in member, not a
  service. The SCIM plugin, `@better-auth/scim`, lists back only the people that one directory
  connection sent. It lists them only to the holder of that connection's token, and the same token
  can also create and delete people. Introspection (RFC 7662) tells the current state of a token,
  but only to a caller who holds the token, and a slip's signer sends none. So step 45 keeps the
  SSO's lookup route.
- **No standard serves `act`.** Better Auth has no token exchange (RFC 8693), in 1.7.2 or 1.7.14.
  The SSO could add one through the provider's extension point, `extendOAuthProvider`, as its own
  code. Step 48's design still chooses between that and a change to DSOR-RP-03.
- **Not adopted.**
  - `@better-auth/mcp` becomes the OAuth provider of the whole SSO, and its helpers serve a resource
    server that runs inside Better Auth. DSoR is a separate resource server, and publishes its own
    RFC 9728 document (DSOR-RP-02a).
  - Agent Auth, `@better-auth/agent-auth` 0.6.2, is its own protocol, not an RFC, and still 0.x. Its
    capability grants would be a second copy of DSoR's slips: the reason steps 43 to 43c were set
    aside.
  - Roles inside the token, through `customAccessTokenClaims`. DSOR-IDN-04a allows them from an
    authoritative issuer, but they stay as issued for up to an hour, and Q5 asks at every call.
- **A company's own directory goes to the SSO.** Okta, Entra, or authentik can send people to the
  SSO through `@better-auth/scim`, with groups mapped to roles. DSoR keeps one role source, so the
  chain needs no SCIM copy in DSoR, as step 43c had.
- **Decision: the SSO moves to 1.7 before step 45.** The learner took Claude Code's recommendation.
  The fix-list branch goes on top of the upgrade branch, locally, on a 1.7 release at least 48 hours
  old, and the SSO's DSoR tests run again. Nothing reaches production. Steps 45 to 49 then use one
  version, and the lookup is tested once. *Downside:* SSO work comes before step 45 starts.
- **Done the same day, on 1.7.2.** The SSO's branch `feat/sso-dsor-on-ba17` passes its tests and
  the 1.7 probes, and step 44's real call gives the same answers as on 1.6.23. One change for
  DSoR's apps: on 1.7 an app asks for DSoR's audience at `/oauth2/authorize`, or `/oauth2/token`
  answers `400 invalid_target`.
- **Better Auth 1.7.3 and later removed `account.issuer`,** a required column that the 1.7.2
  upgrade adds, so 1.7.12 refused to start on that branch. A rework for 1.7.12, without the
  column, is on `feat/sso-dsor-on-ba1712` and passes the same proofs.
- **Decision: step 45 builds on 1.7.2 for now.** Claude Code recommended 1.7.12, the version more
  likely to ship. The learner kept 1.7.2 on port 3011, and the 1.7.12 branch waits for the decision
  on the SSO's upgrade pull request, panaversity/agentfactory#1288. *Downside:* if 1.7.12 ships,
  step 45's runs against the SSO are made again on it.
- **Pushed the same day, at the learner's request.** `feat/sso-dsor-on-ba17` is now draft pull
  request panaversity/agentfactory#1332, against `main`. It holds the fix list (#1331) and the
  1.7.2 upgrade (#1288) together, and both of those stay open. `feat/sso-dsor-on-ba1712` is pushed
  as a branch, without a pull request. Nothing is merged or deployed: the SSO deploys only from
  `main`.
- **Checked again on 1.7.14, the latest version (2026-10-27).** The learner asked whether the
  SSO's DSoR work uses Better Auth's own way before its own code. It does. The token lifetime is
  `scopeExpirations`. The roles use the organization plugin's access control and its hooks. The key
  check is the api-key plugin. The history is written from Better Auth's hooks. Our own code is the
  lookup's answer, the owner-only rule, and the history table. Three facts were new:
  - **Keys owned by a company.** The api-key plugin can give a key to an organization instead of a
    user (`references: "organization"`, in 1.7.2 too). Today DSoR's one key lists its companies
    in `metadata.dsorOrganizations`. With the native option, each company gives DSoR its own key
    and can take it back. The SSO's `apikey.user_id` has a foreign key to users, so the change
    needs a schema change. It is a question for step 45's design.
  - **Better Auth's own audit logs are a hosted service.** They come with Better Auth
    Infrastructure (`dash()` from `@better-auth/infra`, with an API key from that service). The
    SSO keeps its history in its own database.
  - **No changes in the two newest versions.** 1.7.13 and 1.7.14 change nothing that the SSO's
    DSoR work uses.

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
