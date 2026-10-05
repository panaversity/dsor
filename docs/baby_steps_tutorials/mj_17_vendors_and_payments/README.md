# Step 17 · Vendors and payments

**New in this step:** DSoR's first commands. `payment.create` makes a draft payment for
INV-1008, and `payment.cancel` undoes it. Every command declares the answer to one question:
can this be undone? (DSOR-EXE-05a, DSOR-EXE-05b, DSOR-EXE-05c). Vendors wait for the first
step that reads a vendor's state (decision 11).

## In plain words

Until now, every operation was a **query**: it reads, and changes nothing. This step adds the
first **commands**, operations that change the company's data. Before anyone runs a command,
its contract must answer one question: can this be undone? The answer is one of five words,
the command's **execution semantics**. This README calls it the command's *label*:

| Label | Meaning | Example |
| --- | --- | --- |
| `atomic` | Commits completely, or not at all, in one transaction | `payment.cancel` (this step) |
| `compensatable` | A declared operation can reverse it | `payment.create`, reversed by `payment.cancel` |
| `saga` | Several steps, each with its own reversal | a purchase order that is fulfilled in parts |
| `best_effort` | No guarantee; the outcome is reported as seen | a notification |
| `non_compensatable` | Cannot be undone once it runs | `payment.execute`, which sends money |

A **compensating operation** is the declared undo. It is a normal operation, and DSoR runs it
through the same checklist as every other call.

Think of the new clerk from *Start here*. The clerk writes a payment slip for VENDOR-44. The
office can stamp the slip VOID, and the slip stays in the file: that is `payment.cancel`, so
writing the slip was `compensatable`. Money already sent by bank wire cannot be called back by
the office alone: that will be `payment.execute`, `non_compensatable`. The picture stops
there. In DSoR the contract declares the label, and start-up checks that the undo it names
can really run.

## Why it matters

The agent is told to deal with INV-1008. It has two tools: one drafts PAY-901 for 31,400.00
USD, and one sends 31,400.00 USD to VENDOR-44. **Without the label, the two look the same.**
The agent is as bold with the second as with the first, and its supervisor learns which one it
used only afterwards. The draft can be voided. The money cannot be called back.

**A label that promises an undo that does not exist is worse than no label.** The contract
schema accepts `"compensated_by": []`, and it accepts a misspelled name. Then the label says
"can be undone", and nothing can undo it. The understanding session found a second form of the
same mistake: "`payment.execute` is undone by `payment.refund`". A refund needs the vendor to
send the money back, so DSoR cannot finish it by itself.

**A command changes the company's data, and the agent is the caller to distrust.** The
specification lets an agent run a state-changing command only under a permission slip from a
person, a **delegation** (DSOR-DEL-01a). Delegations arrive in step 18. Until then, the agent
must not run any command at all.

**Common mistake:** choosing the label by how the operation feels. §24 says only that a
`compensatable` command "can be reversed by a declared compensating operation". This tutorial
reads that as: DSoR can run the undo alone, through the checklist, and finish it. "Cancel is the
opposite of create" is not the reason `payment.create` is `compensatable`. The reason is that
DSoR can run `payment.cancel` to the end by itself, and some role may run it.

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
4. Every command's answer holds the draft as data, its classification, and `semantics`, taken from
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
- Proposals and payload hashes (steps 22 and 29), so an answer has no outcome word yet. A
  **proposal** is the record of one command call and its state. A **payload hash** is a
  fingerprint of the request, so an approval can say exactly what it approved. An **outcome
  word**, such as `COMMITTED`, is what the result envelope uses to say how a command ended.
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
   "which run under the full pipeline".** `payment.cancel` is an ordinary operation, and it
   runs the same checklist as every call, as far as the checklist is built today. Lines ④, ⑦,
   ⑧, ⑩, and ⑫ to ⑰ are still comments, so the "full pipeline" does not exist yet. The rule is
   met in that sense only. The tests show the undo refused at lines ①, ③, ⑤, and ⑥, and by
   the company check.
4. **DSOR-DEL-01a asks a state-changing command from an agent to run under an active
   delegation.** No delegation exists yet, so every such command is refused. The rule is met
   only in that narrow sense until step 18.
5. **DSOR-SCH-01 asks every artifact to validate against its schema.** A command's answer
   has no outcome, proposal, or payload hash, so it does not validate as a result envelope.
   A query's answer does not either (open question 19). Recorded, not claimed.
6. **DSOR-EXE-03b asks DSoR not to execute when the store cannot accept the record.** A
   command writes its draft at line ⑨ and its record at line ⑪, so a failed record can
   leave a draft behind. Step 36 closes this. Until then, this tutorial claims DSOR-EXE-03b
   for queries, and for commands refused before their code. Break B1 shows the gap for real,
   and decision 17 keeps the answer honest about it.
7. **DSOR-MOD-03 and DSOR-MOD-04 ask DSoR to read state itself.** The amount and the vendor
   come from the invoice that DSoR reads. The request names only the invoice.
8. **DSOR-FRS-01a and DSOR-CLS-03 name query results only.** A command's answer carries
   its classification anyway, because masking runs for every answer (DSOR-CLS-02a). It carries no
   freshness: the result envelope has no field for one, and `payment.cancel` reads nothing
   for a freshness to describe (decision 2).
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
| (our decision) | **C7.** `app.payments` is on `store.json`, step 16's map of DSoR's store, with its own kind, and the program holds exactly that | Today's database matches `store.json`. Planted catalogs with `UPDATE` on the amount, or `DELETE`, are named. A payment cannot point at another company's invoice |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside. Decisions 1
to 11 were made by the learner on 2026-10-04. Decisions 4 and 10 changed the same day, before
any code: decision 4 when the specification's own examples showed its reasons were false,
and decision 10 after a real run. The build checked this design against the specification
and the schemas before the first test, on 2026-10-04, and found five gaps. The learner
changed decisions 2, 5, and 9, and added 13 and 14. Decisions 15 and 16 are the build's:
names, and step 11's decision 9 carried out. Decision 17 came from break B1, the learner's
choice. The review added decision 18 and one rule to decision 8.

1. **The draft commits before its record, and the gap is shown.** A command's code writes at
   line ⑨, and the record is written at line ⑪. One idea per step: step 36 makes them commit
   together, as the map of steps (`../readme.md`) plans. Break B1 makes the record fail after
   the draft is written, for real.
   *Downside:* until step 36, a failed record can leave a draft behind.
2. **The answer is the draft, its classification, and its semantics.** `{ data, classification,
   redactions?, semantics, correlation }`. Masking and the classification run for every answer,
   because step 18 lets agents call commands. Freshness does not: DSOR-FRS-01a names query
   results, the result envelope has no field for it, and a write is not a read. Changed at
   the design check: the first version said "a query's answer plus the label" (the semantics), and a
   query's answer carries freshness. *Downside:* no outcome word, such as `COMMITTED`, until
   a proposal and a payload hash exist (steps 22 and 29). The two kinds of answer differ by
   one field, and the record of a command names no connector.
3. **A new kind on `store.json`: a company table that DSoR writes.** Company side, company key
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
   and not the operation itself. The review added one more: some role must grant the undo's
   permission (finding B). *Downside:* more start-up rules. Whether an empty list is
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
    map of steps.
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
17. **A command whose code ran never hears that a retry is safe.** Added after break B1. The
    draft committed, the record failed, and the caller heard `EVIDENCE_STORE_UNAVAILABLE`,
    whose retry class is `safe_same_key`. With no idempotency key until step 20, a retry
    writes a second draft. DSOR-ERR-02 says: "For a command, a connector error MUST NOT be
    mapped to a code with retry class `safe_same_key` unless the side effect provably did not
    occur." A failed record is the evidence store's error, not a connector's, so the rule does
    not apply word for word. This tutorial follows its reason: once a command's code has run,
    DSoR cannot prove that nothing happened. So it answers `INTERNAL_ERROR`, which is never
    retried, in place of the `EVIDENCE_STORE_UNAVAILABLE` that DSOR-EXE-03b names. DSOR-EXE-03b
    expects the record to come before the side effect, and decision 1 already breaks that order.
    A query, and a command refused before its code, keep `EVIDENCE_STORE_UNAVAILABLE`, which is
    true for them. *Downside:* the caller is not told that the evidence store failed, and the draft
    still has no record until step 36. A command whose code refused gets `INTERNAL_ERROR`
    too, because DSoR cannot see whether the code wrote something first.
18. **A query's code is handed no payments.** Added by the review (finding A). Line ③ lets
    the agent's query through because a query changes nothing. But every operation's code was
    handed the company's payments, and planted `invoice.get` code wrote PAY-901 for the agent.
    Now a query's code gets the store that writes nothing, so a write fails the call with
    `INTERNAL_ERROR`. *Downside:* one more branch at line ⑨.

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
| B1 | The record fails after the draft commits: a log made to throw on purpose, which is called fault injection | Nothing: it is the known gap. The caller hears `EVIDENCE_STORE_UNAVAILABLE`, and PAY-901 exists with no record | `EVIDENCE_STORE_UNAVAILABLE`, and "no draft" |
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
- **An undo's own label is not checked.** Start-up checks that the undo is a built command
  that some role may run. It does not check that the undo is itself `atomic` or
  `compensatable`, so a `best_effort` undo would pass. Nor does it check that the undo's input
  can name the record it must undo.
- **The database lets a cancel be undone** (the review's finding C, recorded by the
  learner's choice). `dsor_runtime` may set the status to `draft` or `cancelled` at any time,
  and the CHECK refuses only other words. Only the program's SQL keeps "nothing undoes a
  cancel". A trigger could enforce the order, but step 16's inspector refuses every trigger.
  Step 32's preconditions are where the order of statuses moves.
- **No operation reads a payment back.** There is no `payment.get` yet. After decision 17's
  `INTERNAL_ERROR`, the draft exists, and its id is in no answer and no record.
- **What an agent would see of a command's answer** (a refusal's classification, the
  redactions) cannot be tested while line ③ refuses every agent. Step 18 needs those tests.
- **No code reads `delegation.required`, `idempotency.required`, or `effect` yet** (decision
  14), so changing them in a contract changes nothing that a test can see.
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

| File | What changed |
| --- | --- |
| `contracts/payment.create.json`, `contracts/payment.cancel.json` | **New.** The two commands: `compensatable`, undone by `payment.cancel`, and `atomic`. Every field a command needs, with the specification's values for the ones this step does not check (decision 14) |
| `inputs/PaymentCreateRequest.schema.json`, `inputs/PaymentCancelRequest.schema.json` | **New.** An invoice's URI, and a payment's URI. Nothing else, so an amount is refused at line ⑥ (decision 4) |
| `src/delegation.ts` | **New.** Line ③: an agent's command is refused with `DELEGATION_REQUIRED`, by step 14's `actsAsAgent` rule (decision 5) |
| `src/semantics.ts` | **New.** `semanticsOf` reads a command's label from its contract. `undoProblems` checks every undo list at start-up (decision 8) |
| `src/payment.ts` | **New.** The `Payment` record, the store's shape, and the payments in memory for the unit tests |
| `src/pipeline.ts` | Runs line ③. A command's code now runs at line ⑨: step 04's decision 1 ends. A command's answer carries `semantics` and no freshness (decision 2). A command whose code ran and whose record failed hears `INTERNAL_ERROR` (decision 17) |
| `src/operations.ts` | The code of `payment.create` and `payment.cancel` (decisions 9 and 13) |
| `src/company.ts` | The company the code is handed binds its payments too, and writes nothing after line ⑨ |
| `src/registry.ts` | Holds the store of payments, and names the undo-list problems with the others |
| `src/envelope.ts`, `src/log.ts` | A command's answer as a type of its own. A record with no freshness, for a command |
| `src/postgres.ts` | `createDbPayments`: one `INSERT … RETURNING`, and one `UPDATE` with a second look (decision 9) |
| `migrations/009_payments.sql` | **New.** `app.payments`: numbered by the database from 901, a key to the invoice that starts with `tenant_id`, row-level security, and `dsor_runtime`'s exact grants (decisions 3, 12, 15, and 16) |
| `store.json`, `src/store.ts` | A fourth kind, `business-written`, and `app.payments` on step 16's map (decision 3) |
| `roles.json`, `classifications.json`, `examples/` | The payment permissions (decision 6), the classification of each field of a payment, and an example request for each command |
| `src/main.ts` | user_123 drafts a payment and cancels it twice. The agent is refused |
| `test/semantics.test.ts`, `test/delegation.test.ts`, `test/payments.test.ts`, `test/payments.db.test.ts` | **New.** C1 to C7, and decision 17 |
| `test/cross-tenant.ts` | The suite picks its attackers with line ③'s own question too, so an agent attacks no command until step 18 ("Think it through") |

Many old tests changed with the step, because they typed out the old configuration or the
old order of lines. Each change has a one-line reason in the test, and "Think it through"
counts them.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_16_the_control_plane_store/src mj_17_vendors_and_payments/src
git diff --no-index mj_16_the_control_plane_store/test mj_17_vendors_and_payments/test
```

## Run it

```bash
pnpm install
pnpm migrate      # only 009 runs
pnpm start
pnpm check        # typecheck and the unit tests: 1140
pnpm test:db      # the database tests: 142, about 10 minutes on Neon
```

The new part of `pnpm start`, on a fresh branch. The database numbers each draft, so a later
run shows a higher number:

```text
{
  data: {
    tenant_id: 'org_456',
    id: 'PAY-901',
    invoice_id: 'INV-1008',
    vendor_id: 'VENDOR-44',
    amount: { value: '31400.00', currency: 'USD' },
    status: 'draft'
  },
  classification: 'confidential',
  semantics: 'compensatable',
  correlation: { request_id: 'ap-desk-7', principal_id: 'user_123' }
}
{
  data: { …the same draft…, status: 'cancelled' },
  classification: 'confidential',
  semantics: 'atomic',
  correlation: { request_id: 'ap-desk-7', principal_id: 'user_123' }
}
{
  code: 'CONFLICT',
  message: 'payment "PAY-901" is not a draft, so it cannot be cancelled',
  retry: 'never',
  correlation: { request_id: 'ap-desk-7', principal_id: 'user_123' }
}
{
  code: 'DELEGATION_REQUIRED',
  message: `"payment.create" is a command, and an agent runs a command only under a person's delegation`,
  retry: 'never',
  correlation: { request_id: 'req_…', agent_id: 'accounts-payable-fte' }
}
```

And their records, among the log's lines:

```text
4222 payment.create@1 ALLOW ok org_456
4223 payment.cancel@1 ALLOW ok org_456
4224 payment.cancel@1 ALLOW CONFLICT org_456
4225 payment.create@1 DENY DELEGATION_REQUIRED org_456
18 calls answered, so 18 records were written. dsor_runtime reads 15 of them, in org_456 and org_789, and cannot read the other 3
```

The second cancel says `ALLOW`, because its code ran and refused (step 08's decision 5).

## Break it

Each break was run for real on 2026-10-04, then restored, and `pnpm check` was green after
each one. The outputs come from the first runs. The counts of failing tests were taken again
on the finished step, after the review.

| # | The break | Caught by | The learner's prediction |
| --- | --- | --- | --- |
| B1 | The record fails after the draft commits | Nothing: the known gap. It also showed decision 17 was needed | "No draft". **Wrong**: the draft stays |
| B2 | Line ③'s check removed | 23 unit tests, 6 of them C4's | `AUTHORIZATION_DENIED`. **Wrong**: the draft is made |
| B3 | Two creates for INV-1008 at the same moment | Nothing: the known gap of decision 10 | "One". **Wrong**: two, as decision 10 now says |
| B4 | The undo-list check removed, with `"compensated_by": []` | 10 unit tests: C3's start-up, and the review's role check | "It starts". **Right** |

**B1.** A log that throws "disk full", on the real table. The call left no record, and the
draft is there:

```text
drafts before: { n: 12, last: 'PAY-913' }
{
  code: 'EVIDENCE_STORE_UNAVAILABLE',
  message: 'DSoR could not record its decision, so it refuses the call',
  retry: 'safe_same_key',
  correlation: { request_id: 'b1-32a69fd4-…', principal_id: 'user_123' }
}
drafts after:  { n: 13, last: 'PAY-916' }
records of the call: { n: 0 }
```

The draft is decision 1's known gap, until step 36. The answer was a second problem:
`safe_same_key` tells the caller that a retry is safe, and with no idempotency key until step
20, a retry writes a second draft. Decision 17 fixed it, red first. The same break, run
again after the fix:

```text
drafts before: { n: 16, last: 'PAY-919' }
{
  code: 'INTERNAL_ERROR',
  message: 'DSoR could not record its decision after the command ran, so a retry is not safe',
  retry: 'never',
  correlation: { request_id: 'b1-81ec33e4-…', principal_id: 'user_123' }
}
drafts after:  { n: 17, last: 'PAY-920' }
records of the call: { n: 0 }
```

(The numbers jump from 913 to 916 because an `INSERT` that rolls back still uses up a number.
The database tests roll back two such inserts on purpose.)

**B2.** With `return;` as the first line of `checkDelegation`, the agent asks for a draft:

```text
{
  data: {
    tenant_id: 'org_456',
    id: 'PAY-901',
    invoice_id: 'INV-1008',
    vendor_id: 'VENDOR-44',
    status: 'draft'
  },
  classification: 'internal',
  redactions: [ { field: 'amount', reason: 'clearance', treatment: 'omitted' } ],
  semantics: 'compensatable',
  correlation: { request_id: 'req_…', agent_id: 'accounts-payable-fte' }
}
drafts: 1
unit: failed 23 of 1140
```

Line ⑤ said yes, because `ap_agent` grants `payment:create` (decision 6). Masking still hid the
amount from the agent. The 23 failing tests: 6 of C4, 12 of the cross-company suite, and 5
more in four other files where the agent is refused a command.

**B3.** Two creates at the same moment, on Neon:

```text
drafts before: { n: 13, last: 'PAY-916' }
[ 'PAY-917 draft', 'PAY-918 draft' ]
drafts after:  { n: 15, last: 'PAY-918' }
```

**B4.** With the undo-list check commented out, the program starts with an undo list that
names nothing:

```text
operations: [
  'invoice.get',
  'invoice.issue',
  'invoice.list',
  'payment.cancel',
  'payment.create'
]
…
exit 0
```

With the check in place, the same contracts:

```text
the registry refused to start:
  payment.create: compensated_by is empty, so it names nothing that undoes it
exit 1
```

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Understand | A session with no code, one part per turn, each prediction settled by a real run ("Understanding sessions" in `../mj_notes.md`) |
| 2 | Design | "In plain words", "Why it matters", "The design, before any code", with the predictions for B1 to B4 |
| 3 | Neon | A branch `step-17` from `step-16`, the project's tenth and last. `.env` written by a command, never shown. `pnpm migrate` ("no migration to run"), then both suites green before any change: 1059 unit, 129 database |
| 4 | Check the design | Against the specification and the schemas, before the first test. Five gaps went to the learner, one at a time, each with a real run: decisions 2, 5, 9, 13, and 14 |
| 5 | Red | The configuration, and shells: code with the right shape that does nothing yet, so a new test fails on what it checks, not on a missing file. Then every new test. Predict how many fail |
| 6 | Green | One requirement per commit: line ③, commands run, the undo-list check, then the database. Predict how many old tests break at each |
| 7 | Break it | B1 and B3 on Neon, B2 and B4 in the folder, each restored from a backup copy. A break that changes the database would go to a local PostgreSQL |
| 8 | Review | Reviewers who have not seen the conversation, each in a copy outside the repository |

The prompt that started this session:

```text
Build step 17 in learner mode from the design in
docs/baby_steps_tutorials/mj_17_vendors_and_payments/README.md.
Neon: branch step-17 from step-16, as its setup says. It takes the last free branch,
so breaks that change the database run on a local PostgreSQL in the scratchpad.
```

The learner's predictions, and what happened:

| Moment | Prediction | Real |
| --- | --- | --- |
| The configuration alone (two contracts, two input schemas, classifications, roles, examples): how many of 1059 old tests fail? | 6 to 20 | **28**: 12 typed the configuration out, 16 belong to the cross-company suite, which walks every operation |
| The red run: how many of 63 new unit tests fail? | all 63 | **53**. Ten pass already: C1's five (the schema has asked every command for its semantics since step 03), three refusals that line ⑥ and step 10 already give, and two "yes" tests |
| The red run: how many of 10 new database tests fail? | all 10 | **right** |
| Line ③: how many old tests break? | 0 | **75 unit and 1 database**: 58 of the suite, whose agents now stop at line ③, 8 that pin the order of lines, and 10 that used the agent to reach line ⑤ |
| Commands run: how many old tests break? | 0 | **4**: step 04's "a command never runs", in two forms, the refusal it gave, and the company's pinned keys |
| The undo-list check: how many old tests break? | 0 | **1**: step 03's `compensatable` test, whose undo had no contract. Exactly what the check is for |
| B1 to B4 | as in "Break it" | 1 of 4 right |
| Where will the review find a real hole? | line ③, the undo check, the payments table, the tests | **right**: findings A, B, and C, and 15 holes in the tests |
| The review's red run: how many of 13 new unit tests fail? | all 13 | **2**: the holes in the code. The 11 for holes in the tests pass at once |

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
   draft exists with no record. Step 36 makes them commit together. Until then, the caller
   hears `INTERNAL_ERROR`, never "retry is safe", because a retry would write a second draft
   (decision 17).

</details>

## Think it through

**Before the first test,** the design was checked against the specification and the schemas.
Five gaps went to the learner, one at a time, each with a real run: decisions 2, 5, and 9
changed, and 13 and 14 were added.

**While building,** two more changes came up.
- **The cross-company suite of step 12 asks line ③ too.** It sends every caller who holds an
  operation's permission, and expects `TENANT_MISMATCH` from each. Line ③ now refuses an
  agent's command first, so 15 attacks reported `DELEGATION_REQUIRED`. The suite already asked
  line ⑤'s own question (`permissionsOf`) to pick its attackers. It now asks line ③'s too
  (`checkDelegation`). So until step 18, a command is attacked by people only: 36 attacks, no
  findings. In step 18 an agent with a delegation passes line ③, and attacks again with no
  change to the suite. Removing that question fails 62 suite tests. Removing line ③ fails 12.
- **Decision 17,** from break B1.

**The review.** Two reviewers who had not seen the conversation worked in copies outside the
repository, against a local PostgreSQL. One read and attacked: no high finding, 5 medium, 13
low. No attack through a request got an agent's command to run, reached another company, or
set the amount. One broke the code 132 times, one small change at a time: 101 breaks were
caught, and 31 left every test green. 16 of the 31 change nothing anyone can see today. 15
were real holes in the tests.

The learner's guess was "holes in all four places": line ③, the undo check, the payments
table, and the tests. Right this time. The review's red run: 13 new unit tests, and the learner
expected all 13 to fail. Two failed: the two holes in the code. Eleven passed at once, because
the code was right and only a test was missing. A hole in the code fails first. A hole in the
tests passes first.

| Finding | What was done |
| --- | --- |
| **A.** A query's code was handed the payments, so planted `invoice.get` code wrote a draft for the agent, through line ③ | **Fixed** (decision 18), red first |
| **B.** An undo that no role may run passed start-up. `payment.create` still said `compensatable`, and every cancel was refused | **Fixed:** start-up asks the role table (decision 8), red first |
| **C.** The database lets a cancel be undone | **Recorded** ("Left open"), by the learner's choice. A test pins the status CHECK |
| A partly paid invoice would be drafted in full: no fixture had a partly paid issued invoice | **Test added** with a planted store |
| `dsor://org_456/invoice/PAY-901` would cancel PAY-901 without the input schema's `/payment/`. An empty input gave `INTERNAL_ERROR` without the schema's `required` | **Tests added** for line ⑥ |
| DSoR's own `tenant_id` in the payments SQL was hidden by the database's lock | **Test added:** the owner, whom no policy stops, runs the store across companies |
| A registry with no payments store, the memory store's numbering and copies, `DELETE` under a map's columns, the status and currency checks | **Tests added** |
| DSOR-ERR-02 misquoted, DSOR-EXE-05c claimed in full, "label" and "map" used for two things, an analogy that did not fit, terms not defined, "In plain words" too long and "Why it matters" with no story, counts taken before the end | **README fixed** |
| A query's record no longer has to carry freshness: `freshness` became optional in the record's type for every read | **Recorded.** The tests of step 15 still pin a query's record. A query/command split of the type would be a change of its own |

**One idea, or more?** The map of steps gives this step DSOR-EXE-05a, 05b, and 05c only. To let
a command run at all, the step also had to decide three more things: what the agent may do
with a command before step 18 (refuse it: the smallest honest answer to DSOR-DEL-01a), which
map kind lets DSoR write a company table (`business-written`), and what a caller hears when a
command's record fails (decision 17). Each is the least that the first command needs. None
builds a second feature.

**Old tests that changed,** each with a one-line reason beside it:

| Moment | Old tests changed | Why |
| --- | --- | --- |
| The configuration | 28 | 12 typed the configuration out. 16 belong to the suite, which walks every operation |
| Line ③ | 76 (1 of them a database test) | 58 of the suite, 8 that pin the order of lines, 10 that used the agent to reach line ⑤ (1 of them the database test) |
| Commands run | 4 | Step 04's "a command never runs", in two forms, its refusal, and the company's pinned keys |
| The undo check | 1 | Step 03's `compensatable` test, whose undo had no contract |
| The database | 8 | The program's output (3), and five that typed out the database: privileges, policies, row security, the owner's counters, and a registry with no cancel code |

**Analogies.** The new clerk and the permission slip are on the house list, and so is the
checklist. Two are new, and flagged for review: a slip stamped VOID (it stays in the file, as
a cancelled payment stays in the table), and money sent by bank wire (the office cannot call
it back). "Label" for the execution semantics is §24's own word ("a label that answers one
question"), and this README uses it for nothing else.

**What step 18 starts from.**
- Line ③ refuses every agent's command. Delegations replace that refusal with a real check,
  and the suite's agents attack commands again.
- What an agent sees of a command's answer is untested, because no agent reaches one.
- The contracts say `"idempotency": { "required": true }`, and nothing reads it until step 20.
- A draft can still commit with no record (decision 1, step 36), and two drafts for one invoice
  can exist (decision 10, step 20).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-EXE-05a | Every command declares one of the five execution semantics in its contract | [§24 Execution semantics](../../../specs/dsor/03-execution.md#24-execution-semantics) | `test/semantics.test.ts`, 5 tests: a command with no `execution`, with no semantics, or with a label that is not one of the five stops start-up, named, the program too, and every shipped command declares one (C1). The schema has asked for it since step 03 |
| DSOR-EXE-05b | Every command result states the execution semantics that applied | [§24 Execution semantics](../../../specs/dsor/03-execution.md#24-execution-semantics) | `test/semantics.test.ts`, 4 tests: `payment.create` answers `compensatable` and `payment.cancel` `atomic`, code cannot choose its own, and a changed contract changes the answer (C2). `test/payments.test.ts` pins the whole answer. **Partly:** a command's answer is this tutorial's shape, not a result envelope (decision 2) |
| DSOR-EXE-05c | A compensatable or saga operation names its compensating operations, which run under the full pipeline | [§24 Execution semantics](../../../specs/dsor/03-execution.md#24-execution-semantics) | `test/semantics.test.ts`, 11 tests: an empty list, a name with no contract, a query, an operation with no code, the operation itself, and an undo no role may run stop start-up, for a saga too, and the program refuses (C3). `test/payments.test.ts`, 8 tests: `payment.cancel` is refused with no login, for the agent, for cfo_100, with another company's payment, and with three wrong inputs at line ⑥, each leaving the draft as it was, and user_123's cancel runs every line a command reaches. **Partly:** lines ④, ⑦, ⑧, ⑩, and ⑫ to ⑰ are not built yet, so the "full pipeline" is today's checklist |
| DSOR-DEL-01a | A state-changing command from an agent runs only under an active delegation | [§13 Delegation](../../../specs/dsor/02-security.md#13-delegation) | `test/delegation.test.ts`, 6 tests: the agent, the firm's agent in the company where it supervises, and a caller of a type DSoR does not know are refused at line ③, before line ⑤, with no code run, and recorded (C4). `test/payments.test.ts`, 1 test: a query's code cannot write for the agent (decision 18). **Partly:** every such command is refused, because no delegation exists until step 18 |

Also built, as this tutorial's decisions: a draft only for an issued invoice, with the amount
and vendor DSoR read (C5, decisions 4 and 13); a cancel that changes only a draft, decided by
the database (C6, decision 9); `app.payments` held exactly as `store.json` says, with a key that
stays inside its company (C7, decisions 3 and 16); and a command whose code ran is never told
that a retry is safe (decision 17). They are proved in `test/payments.test.ts`,
`test/payments.db.test.ts`, and the `store.json` and inspector tests.

## Next

Step 18 · Delegations: the permission slip. user_123 allows `accounts-payable-fte` to create
payments, up to a limit, until a date. The agent never has more power than the person who
signed.
