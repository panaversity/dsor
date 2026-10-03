# Step 17 · Vendors and payments

**New in this step:** DSoR's first commands. `payment.create` makes a draft payment for
INV-1008, and `payment.cancel` undoes it. Every command declares the answer to one question:
can this be undone? (DSOR-EXE-05a, DSOR-EXE-05b, DSOR-EXE-05c). Vendors wait for the first
step that reads a vendor's state (decision 11).

## In plain words

Until now, DSoR only answered questions. Each operation was a **query**: it reads, and
changes nothing. This step adds the first **commands**: operations that change something in
the company's data.

Before anyone runs a command, they need one answer: can this be undone? The agent needs it
to choose what to do. The person who supervises the agent needs it to know how careful to
be. So every command's contract declares its **execution semantics**, one of five labels:

| Label | Meaning | Example |
| --- | --- | --- |
| `atomic` | Commits completely, or not at all, in one transaction | `payment.cancel` (this step) |
| `compensatable` | A declared operation can reverse it | `payment.create`, reversed by `payment.cancel` |
| `saga` | Several steps, each with its own reversal | a purchase order that is fulfilled in parts |
| `best_effort` | No guarantee; the outcome is reported as seen | a notification |
| `non_compensatable` | Cannot be undone once it runs | `payment.execute`, which sends money |

A **compensating operation** is the declared undo. It is a normal operation, and DSoR runs it
through the same checklist as every other call.

Think of the new clerk from *Start here*. The clerk writes a payment slip for VENDOR-44 and
leaves it on the desk. The office can tear the slip up: that is `payment.cancel`, and the slip
was `compensatable`. A cheque already posted to the vendor cannot be torn up. That will be
`payment.execute`, and it will be `non_compensatable`. The picture stops there. In DSoR, the
label is not the clerk's opinion: the contract declares it, and the program checks at
start-up that the declared undo exists.

## Why it matters

**Without the label, "make a draft" and "send money" look the same.** An agent that cannot
tell them apart is equally bold with both. A person who supervises the agent learns the risk
only after the action.

**A label that promises an undo that does not exist is worse than no label.** The contract
schema accepts `"compensated_by": []`, and it accepts a misspelled name. Then the label says
"can be undone", and nothing can undo it. The understanding session found a second form of
the same mistake: "`payment.execute` is undone by `payment.refund`". A refund needs the vendor
to send the money back. DSoR cannot run it to the end by itself, so it is not an undo.

**A command changes the company's data, and the agent is the caller to distrust.** The
specification lets an agent run a state-changing command only under a permission slip from a
person, a **delegation** (DSOR-DEL-01a). Delegations arrive in step 18. Until then, the agent
must not run any command at all.

**Common mistake:** choosing the label by how the operation feels. "Cancel is the opposite of
create, so create is compensatable" is right only because DSoR can run `payment.cancel` to the
end by itself. Ask: can DSoR run the undo alone, through the full checklist, and finish it?
If not, the operation is not compensatable.

## The design, before any code

This section was written by the learner with Claude Code, before any code existed. It
starts from the understanding session of 2026-10-04 ("Understanding sessions" in
`../mj_notes.md`) and its seven design questions. Every sentence of the specification it
relies on was read on 2026-10-04:

- §24: its "In plain words", its table, and DSOR-EXE-05a, DSOR-EXE-05b, and DSOR-EXE-05c.
- §13: DSOR-DEL-01a. §21: DSOR-EXE-03b and DSOR-EXE-04a. §0: DSOR-SCH-01.
- §28: the codes `DELEGATION_REQUIRED`, `CONFLICT`, and `EVIDENCE_STORE_UNAVAILABLE`.
- `operation-contract.schema.json`: a command must declare `execution.semantics`. A
  `compensatable` or `saga` command must list `compensated_by`. A `non_compensatable` command
  must declare `in_flight` and an `approve_permission`.
- `result-envelope.schema.json`: the outcome `COMMITTED` requires a `proposal`, a
  `payload_hash`, and `semantics`.

If the code finds the plan wrong, the plan changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** DSoR runs its first commands. Each one gives an honest answer to "can this be
undone?", and a declared undo is a real operation that DSoR can run alone, through the full
checklist. The agent runs no command until a person's delegation exists.

**Outcome.** What is true when this step is done:

1. Migration `009` adds `app.payments`, the company's table of payments: its company, a
   number that the database gives (from 901, so the first id is `PAY-901`), the invoice, the
   vendor, the amount, and a status, `draft` or `cancelled`. It has row-level security,
   enabled and forced, and its key to the invoice starts with its company (decision 16). It
   is on `store.json` with a new kind (decision 3).
2. `payment.create` is a command, `compensatable`, undone by `payment.cancel`. Its input is
   the invoice's URI, and nothing else. Its code reads the invoice through the bound company
   store, refuses an invoice that is not `issued` with `CONFLICT` (decision 13), and writes a
   draft for the invoice's open amount and vendor.
3. `payment.cancel` is a command, `atomic`. Its input is the payment's URI. It changes a
   draft to `cancelled`. It refuses a payment that is not a draft with `CONFLICT`, and a
   payment that does not exist with `RESOURCE_NOT_FOUND` (decision 9).
4. Every command's answer holds the draft as data, its label, and `semantics`, taken from
   the contract, never from the code (DSOR-EXE-05b). It carries no freshness (decision 2).
5. At line ③, a caller that step 14's rule treats as an agent gets `DELEGATION_REQUIRED`
   for any command, and the refusal is recorded (DSOR-DEL-01a, decision 5).
6. Start-up refuses a `compensated_by` list that is empty, or that names anything but a
   built command other than the operation itself.
7. `ap_supervisor` (user_123) holds `payment:create` and `payment:cancel`. `ap_agent` holds
   `payment:create`. `CFO` holds neither.
8. Commands are no longer refused as "not built yet": step 04's decision 1 ends here. The
   lines for idempotency (step 20), the proposal (step 22), and preconditions (step 32) stay
   comments that name their steps.

**Not the outcome of this step:**

- Vendors, as records of their own (decision 11).
- Proposals and payload hashes (steps 22 and 29), so an answer has no outcome word yet.
- The draft and its record in one transaction (step 36, decision 1).
- Idempotency keys (step 20), concurrency checks (step 21), preconditions in the contract
  (step 32), controls (step 27), approvals (step 29), and `payment.execute` (step 35).

**The success signals.** Each one fails if this step's code is deleted:

- user_123 creates PAY-901 for 31,400.00 USD. It is a draft, the answer says
  `compensatable`, and the call has its record.
- user_123 cancels PAY-901. The answer says `atomic`. A second cancel gets `CONFLICT`.
- The agent gets `DELEGATION_REQUIRED` for both commands, although its role holds
  `payment:create`.
- A contract whose `compensated_by` is `[]` stops start-up, named.

### What the specification asks, and what this step can honestly give

Checked on 2026-10-04:

1. **DSOR-EXE-05a asks every command to declare its semantics.** The schema has required
   `execution.semantics` for commands since step 03, and start-up checks every contract
   against the schema. This step's tests show it for a command contract without it.
2. **DSOR-EXE-05b asks every command result to state the semantics that applied.** The
   answer carries `semantics`, copied from the contract after line ⑨.
3. **DSOR-EXE-05c asks a `compensatable` operation to name its compensating operations,
   "which run under the full pipeline".** `payment.cancel` is an ordinary operation. Every
   line of the checklist applies to it, and the tests show it for each kind of refusal.
4. **DSOR-DEL-01a asks a state-changing command from an agent to run under an active
   delegation.** No delegation exists yet, so every such command is refused. The rule is met
   only in that narrow sense until step 18.
5. **DSOR-SCH-01 asks every artifact to validate against its schema.** A command's answer
   has no outcome, proposal, or payload hash, so it does not validate as a result envelope.
   A query's answer does not either (open question 19). Recorded, not claimed.
6. **DSOR-EXE-03b asks DSoR not to execute when the store cannot accept the record.** A
   command writes its draft at line ⑨ and its record at line ⑪, so a failed record can
   leave a draft behind. Step 36 closes this. Until then, this tutorial claims DSOR-EXE-03b
   for queries only, and break B1 shows the gap for real.
7. **DSOR-MOD-03 and DSOR-MOD-04 ask DSoR to read state itself.** The amount and the vendor
   come from the invoice that DSoR reads. The request names only the invoice.
8. **DSOR-FRS-01a and DSOR-CLS-03 name query results only.** A command's answer carries
   its label anyway, because masking runs for every answer (DSOR-CLS-02a). It carries no
   freshness: the result envelope has no field for one, and `payment.cancel` reads nothing
   to label (decision 2).
9. **A command contract must have six more fields** than a query's: `delegation`,
   `idempotency`, `concurrency`, `execution`, `preconditions`, and `controls`. This step
   checks only `execution`, and the agent's delegation by refusing every agent. The other
   fields name the steps that check them (decision 14).

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-EXE-05a | **C1.** Every command declares its semantics | A command contract without `execution.semantics` stops start-up, named. Both new contracts declare one |
| DSOR-EXE-05b | **C2.** Every command's answer states the semantics that applied, from the contract | `payment.create` answers `compensatable`, `payment.cancel` answers `atomic`. Planted code that answers with semantics of its own is overruled. A contract changed to another label changes the answer |
| DSOR-EXE-05c | **C3.** A compensatable command names a real undo, and the undo runs under the full checklist | Start-up refuses an empty list, an unknown name, a query, an operation with no code, and an operation that names itself. `payment.cancel` refuses cfo_100, another company's payment, and the agent, and every call is recorded |
| DSOR-DEL-01a | **C4.** An agent's command never runs without an active delegation | The agent gets `DELEGATION_REQUIRED` for both commands, before line ⑤, with `payment:create` in its role. So does an agent whose type DSoR does not know. A planted application runs the command. The refusal is recorded |
| (our decision) | **C5.** A draft is made only for an issued invoice, with the amount and vendor DSoR read | PAY-901 holds 31,400.00 USD and VENDOR-44 from INV-1008. A request that adds an amount gets `VALIDATION_FAILED`. INV-1001 (paid) and INV-1005 (a draft) get `CONFLICT`. Another company's invoice gets `TENANT_MISMATCH`, and an unknown one `RESOURCE_NOT_FOUND`. None of them leaves a draft |
| (our decision) | **C6.** A cancel changes only a draft | A second cancel gets `CONFLICT`, and the payment stays `cancelled`. PAY-999 gets `RESOURCE_NOT_FOUND` |
| (our decision) | **C7.** `app.payments` is on the map with its own kind, and the program holds exactly that | Today's database matches `store.json`. Planted catalogs with `UPDATE` on the amount, or `DELETE`, are named. A payment cannot point at another company's invoice |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside. Decisions 1
to 11 were made by the learner on 2026-10-04. Decisions 4 and 10 changed the same day, before
any code: decision 4 when the specification's own examples showed its reasons were false,
and decision 10 after a real run. The build checked this design against the specification
and the schemas before the first test, on 2026-10-04, and found five gaps. The learner
changed decisions 2, 5, and 9, and added 13 and 14. Decisions 15 and 16 are the build's:
names, and step 11's decision 9 carried out.

1. **The draft commits before its record, and the gap is shown.** A command's code writes at
   line ⑨, and the record is written at line ⑪. One idea per step: step 36 makes them commit
   together, as the map plans. Break B1 fails the record after the draft, for real.
   *Downside:* until step 36, a failed record can leave a draft behind.
2. **The answer is the draft, its label, and its semantics.** `{ data, classification,
   redactions?, semantics, correlation }`. Masking and the label run for every answer,
   because step 18 lets agents call commands. Freshness does not: DSOR-FRS-01a names query
   results, the result envelope has no field for it, and a write is not a read. Changed at
   the design check: the first version said "a query's answer plus the label", and a
   query's answer carries freshness. *Downside:* no outcome word, such as `COMMITTED`, until
   a proposal and a payload hash exist (steps 22 and 29). The two kinds of answer differ by
   one field, and the record of a command names no connector.
3. **A new kind on the map: a company table that DSoR writes.** Company side, company key
   required, and `SELECT`, with `INSERT` and `UPDATE` on named columns only. `app.payments`
   lists `INSERT` on its company, invoice, vendor, amount, and status, and `UPDATE` on the
   status alone. The build names the kind. In production, this is the shape for one
   database: one login with exact grants per table, which is what lets step 36 commit the
   change and its record in one transaction. *Downside:* `dsor_runtime` can now change one
   company table, through named columns.
4. **The input is the invoice's URI, and nothing else.** DSoR reads the invoice's open
   amount and vendor, and the draft stores them. The input schema refuses any other field.
   In the specification's examples, the CFO control reads `state.payment.amount`, and an
   approval binds the payment's version (§26.3), so nothing reads an amount in this request.
   The first version also took an amount, for two reasons that those examples showed were
   false. *Downside:* full payment only, until a later step adds partial payments.
5. **The agent gets `DELEGATION_REQUIRED` at line ③.** For any command, from any caller that
   step 14's rule treats as an agent (`actsAsAgent`): `agent`, and any type DSoR does not
   know, such as `Agent`. A person, an application, and the system run commands in their
   own name, as user_123 does. One rule decides who is an agent, for masking, for the
   answer's `agent_id`, and for delegations, so they can never disagree. Changed at the
   design check: the first version said both "not a person" and "as step 14 treats it",
   and step 14 does not treat an application as an agent. *Downside:* the agent runs no
   command for one step. A planted application runs commands with no delegation, which the
   specification does not ask for.
6. **Roles.** `ap_supervisor`: `payment:create` and `payment:cancel`. `ap_agent`:
   `payment:create`, so that a test shows the permission alone is not enough. `CFO`: neither.
   *Downside:* the agent holds a permission that it cannot use yet.
7. **`payment.create` is `compensatable`, undone by `payment.cancel`. `payment.cancel` is
   `atomic`.** The specification's own example. DSoR can run a cancel to the end by itself.
   *Downside:* nothing undoes a cancel.
8. **Start-up checks every undo list.** Not empty, every name a contract, a command, built,
   and not the operation itself. *Downside:* more start-up rules. Whether an empty list is
   allowed is still a question for the specification ("Can a list of undo operations be
   empty?" in `../mj_notes.md`).
9. **A cancel is one statement, and a second look when it changes nothing.** `UPDATE … SET
   status = 'cancelled' WHERE … AND status = 'draft'`. The database decides, so two cancels
   at the same moment cannot both succeed. When no row changes, one `SELECT` in the same
   transaction looks again: a payment that exists gets `CONFLICT`, and one that does not
   gets `RESOURCE_NOT_FOUND`, as `invoice.get` answers. Changed at the design check: a real
   run on PostgreSQL 17 gave `UPDATE 0` for a cancelled PAY-901 and for a PAY-999 that never
   existed, so "no row means `CONFLICT`" told a caller that a missing payment exists.
   *Downside:* the rule lives in the code's SQL until step 32 moves it to the contract, and
   a cancel that changes nothing takes two statements.
10. **Two drafts for one invoice are allowed, until step 20.** A retry, or a second
    request, makes a second draft. A real run on 2026-10-04 sent 20 creates for INV-1008 at
    the same moment: 20 drafts. With a one-draft-per-invoice index: 1 draft and 19
    refusals. The index was chosen first, then dropped before any code. With it, step 20's
    break would count one draft whatever the code does, and a retry would get `CONFLICT`
    instead of its first answer. *Downside:* until step 20's keys, and a later rule against
    paying one invoice twice, two drafts for one invoice can exist. Drafts move no money.
11. **Vendors wait.** The draft copies the invoice's `vendor_id`. A vendors table arrives with
    the first step that reads a vendor's state: a blocked vendor (step 32), or a bank account
    (step 35). *Downside:* this folder's name promises vendors. Recorded as a proposal for the
    map.
12. **The status has no default.** The program writes `draft` itself. Step 16's inspector
    refuses any privilege on a column that the database fills in, and `payment.cancel` needs
    `UPDATE` on the status. *Downside:* every insert must name the status.
13. **`payment.create` refuses an invoice that is not `issued`, with `CONFLICT`.** Added at
    the design check. A real run read INV-1001, paid with 0.00 USD open, and INV-1005, a
    draft invoice that nobody issued. Without the rule, each would get a draft: one for
    0.00 USD, one for an invoice that is not owed yet. The specification's own
    `payment.execute` has the precondition `state.invoice.status == "issued"`, and §28
    keeps `CONFLICT` for business-rule conflicts. Like decision 9, the rule lives in the
    code until step 32. *Downside:* a second rule in the code that step 32 must move, and
    one more refusal to test.
14. **The contracts write the specification's values for the fields this step does not
    check.** Added at the design check. `"idempotency": { "required": true }` (checked from
    step 20, DSOR-IDM-01a), `"concurrency": { "strategy": "optimistic" }` (step 21),
    `"delegation": { "required": true }`, `"controls": []`, and preconditions with
    `"freshness": "current"` and `"predicates": []` (step 32). The predicates are empty
    because the `issued` and `draft` rules live in the code (decisions 9 and 13), and a
    predicate that nothing reads would claim a check that does not happen. `invoice.issue`'s
    contract has written the same values since step 03. Line ⑦'s comment and this list name
    the step that checks each field. *Downside:* until step 20, the contract says a key is
    required, and DSoR accepts a call without one.
15. **Names.** The draft's fields are `tenant_id`, `id`, `invoice_id`, `vendor_id`,
    `amount`, and `status`, after §6's pattern, where a link to a vendor is `vendor_id`.
    The database gives each payment a `number` from 901, and `id` is `'PAY-' || number`,
    which the database writes too. A real run on PostgreSQL 17 showed that `dsor_runtime`
    inserts such a row with no privilege on the counter, so step 16's rule "no kind allows
    a privilege on a sequence" still holds. The new kind is named `business-written`.
    *Downside:* §7's example contract reads `state.payment.invoice`, not
    `state.payment.invoice_id`. A question for the specification.
16. **Step 11's decision 9, carried out.** That rule waited for a second business table:
    every foreign key between company tables starts with the row's own `tenant_id`. So
    `app.payments` has `FOREIGN KEY (tenant_id, invoice_id) REFERENCES app.invoices
    (tenant_id, id)`, and a database test shows that a payment of `org_456` cannot point at
    `org_789`'s INV-2001. *Downside:* a test for a rule from step 11, in step 17.

### The tests, by claim

- **C1:** start-up with a command contract that has no `execution.semantics` exits with
  code 1, named, before `operations:`.
- **C2:** both answers' `semantics`. Planted code that returns `{ semantics: "atomic" }` for
  `payment.create` still answers `compensatable`. A copy of `payment.create`'s contract
  that says `atomic` answers `atomic`. A query's answer has no `semantics`.
- **C3:** start-up refuses `"compensated_by": []`, a name with no contract, a query, an
  operation with no code, and `payment.create` naming itself. `payment.cancel` by cfo_100:
  `AUTHORIZATION_DENIED`. With org_789's payment URI: `TENANT_MISMATCH`. By the agent:
  `DELEGATION_REQUIRED`. Each call has its record.
- **C4:** the agent calls `payment.create` and `payment.cancel`: `DELEGATION_REQUIRED`, and the
  record says so. The same with an agent of an unknown type. A planted application, and
  user_123, succeed. Line ③ runs before line ⑤.
- **C5:** PAY-901 holds INV-1008's open amount, 31,400.00 USD, and VENDOR-44. A request with
  an `amount` field gets `VALIDATION_FAILED`. INV-1001 and INV-1005 get `CONFLICT`. Another
  company's invoice, and an unknown one, are refused. None of these leaves a draft.
- **C6:** cancel, then cancel again: `CONFLICT`, and the status stays `cancelled`. PAY-999:
  `RESOURCE_NOT_FOUND`.
- **C7:** the database test that today's catalog matches `store.json`, with `app.payments`.
  Planted catalogs with `UPDATE` on `amount_value` and with `DELETE` are named. As
  `dsor_runtime` in `org_456`, a row that names `org_789`'s INV-2001 is refused by the key.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions are recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| B1 | The record fails after the draft commits (fault injection on the log) | Nothing: it is the known gap. The caller hears `EVIDENCE_STORE_UNAVAILABLE`, and PAY-901 exists with no record | `EVIDENCE_STORE_UNAVAILABLE`, and "no draft" |
| B2 | Line ③'s new check is removed. The agent calls `payment.create` | C4 | `AUTHORIZATION_DENIED` |
| B3 | Two creates for INV-1008 at the same moment. Since decision 10 changed, the design allows it until step 20 | Nothing: it is a known gap. Two drafts exist | "One" draft, predicted while the design still had the index |
| B4 | Start-up's undo-list check is removed. A contract says `"compensated_by": []` | C3 | "It starts" |

The review also attacks the step with the threats that are its reason: an undo that does not
exist, and an agent that acts without a person's permission.

### Left open, and not this step's idea

- **Vendors** as records of their own (decision 11).
- **Outcome words, proposals, and payload hashes** (steps 22 and 29), and so DSOR-SCH-01 for
  command answers.
- **The draft and its record in one transaction** (step 36).
- **A second draft for one invoice** (decision 10). Step 20's keys stop retries of one
  request, and a later rule stops two payments for one invoice.
- **Partial payments.** The request carries no amount (decision 4).
- **The invoice can change between its read and the draft.** The code reads INV-1008, then
  writes the draft, in two transactions. Nothing in this step changes an invoice, so the
  gap cannot be shown yet. Step 21's version checks close it.
- **An undo's own label is not checked.** Start-up checks that the undo is a built command.
  It does not check that the undo is itself `atomic` or `compensatable`, so a `best_effort`
  undo would pass.
- **The contracts promise checks that come later** (decision 14): an idempotency key from
  step 20, a version check from step 21.
- **One counter numbers every company's payments.** If `org_456` makes PAY-901 to PAY-940,
  the next payment of `org_789` is PAY-941. So a company can count how often other
  companies pay. Open question 39 in
  [`research/open-questions.md`](../../../research/open-questions.md) asks the same of the
  log's numbers. Numbering per company would be a second idea in this step.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup itself,
this way:

1. Create a branch `step-17` **from `step-16`**, with `neonctl branches create`. Neon's MCP
   server did not connect in the design session.
2. Write `.env` with `neonctl connection-string`, sending its output into the file and never
   printing it:
   - `DSOR_MIGRATION_URL`: the owner's string.
   - `DSOR_DB_URL`: the same string, with the user `dsor_runtime` and a new random password
     (letters and digits).

   Give both `sslmode=verify-full`.
3. Run `pnpm migrate`. Only `009` runs. It also sets `dsor_runtime`'s password from
   `DSOR_DB_URL`.
4. **Neon allows ten branches.** `main` and `step-09` to `step-16` hold nine, so `step-17`
   takes the last one. A break that must change the database runs on a throwaway local
   PostgreSQL in the scratchpad, as the `understand-baby-step` skill describes, or on a Neon
   branch freed first, at the learner's yes.
5. Check without looking: `pnpm test:db` passes, and the transcript holds no
   `postgresql://` with a password in it.

## What changed since step 16

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

## Check yourself

1. What question does an execution-semantics label answer, and who needs the answer?
2. Why is `payment.create` compensatable, while a refund would not undo `payment.execute`?
3. The agent's role holds `payment:create`. Why is it still refused?
4. Why does `payment.create` take only the invoice's URI, and no amount?
5. What can go wrong between line ⑨ and line ⑪ for a command, and which step closes it?

<details>
<summary>Answers</summary>

1. "Can this be undone?" The agent needs it to choose what to do, and the person who
   supervises the agent needs it to know how careful to be, before the action.
2. DSoR can run `payment.cancel` to the end by itself, through the full checklist. A refund
   needs the vendor to send money back, so DSoR cannot finish it alone.
3. A state-changing command from an agent needs a person's delegation (DSOR-DEL-01a), and
   line ③ checks that before line ⑤ checks the permission. No delegation exists until
   step 18.
4. DSoR reads the amount and the vendor from the invoice itself. In the specification's
   examples, the CFO rule reads the payment's amount from state, and an approval binds the
   payment's version, so nothing needs an amount in the request.
5. The draft commits at line ⑨, and the record is written at line ⑪. If the record fails, a
   draft exists with no record. Step 36 makes them commit together.

</details>

## Think it through

_To be written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-EXE-05a | Every command declares one of the five execution semantics in its contract | [§24 Execution semantics](../../../specs/dsor/03-execution.md#24-execution-semantics) | _To be counted._ |
| DSOR-EXE-05b | Every command result states the execution semantics that applied | [§24 Execution semantics](../../../specs/dsor/03-execution.md#24-execution-semantics) | _To be counted._ |
| DSOR-EXE-05c | A compensatable or saga operation names its compensating operations, which run under the full pipeline | [§24 Execution semantics](../../../specs/dsor/03-execution.md#24-execution-semantics) | _To be counted._ |
| DSOR-DEL-01a | A state-changing command from an agent runs only under an active delegation | [§13 Delegation](../../../specs/dsor/02-security.md#13-delegation) | _To be counted._ Partly: every such command is refused, because no delegation exists until step 18 |

## Next

Step 18 · Delegations: the permission slip. user_123 allows `accounts-payable-fte` to create
payments, up to a limit, until a date. The agent never has more power than the person who
signed.
