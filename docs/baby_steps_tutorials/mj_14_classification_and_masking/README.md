# Step 14 · Classification and masking

**New in this step:** every field carries a sensitivity label, and every agent a
clearance. What is above an agent's clearance is left out of the answer before it leaves
DSoR, and the answer lists what was left out (DSOR-CLS-01, DSOR-CLS-02a, DSOR-CLS-02b,
DSOR-CLS-03, DSOR-CLS-05).

## In plain words

Follow an answer one step further than before. DSoR answers the agent. The agent puts
that answer into its prompt, and the prompt goes to the **model provider**, the company
that runs the AI model, on its own servers. So everything DSoR returns to an agent leaves
the company. §19.2 calls this line the **model boundary**.

From this step, every field has a **classification**, a label for how sensitive it is:
`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, or `RESTRICTED`, from least to most. Every agent
has a **clearance**, the highest label it may see. Before an answer leaves DSoR for an
agent, every field above the agent's clearance is taken out, and the answer lists them:

```text
the agent reads INV-1008       { id, vendor_id, status, tenant_id }
                               redactions: amount, open_amount
cfo_100 reads INV-1008         { id, vendor_id, amount: 31,400.00 USD, open_amount, status, tenant_id }
```

Think of a document released with some lines blacked out. The records office blacks out
the lines on the copy before it hands the copy to the new clerk, and the black bars stay
on the page, so the clerk knows something was there. The analogy stops at the bars: DSoR
leaves the field out entirely, and the list of what was left out plays the part of the
bars.

## Why it matters

**Most real incidents are reads.** §19 opens with it: "Writes get the attention, but most
real incidents are reads: data ends up somewhere it should not be." Its example: "A
salary field reaches an external model provider because the agent asked for an employee
record. No attack was needed, just a missing filter."

**A field that silently disappears is a wrong answer that looks right.** An agent that
reads `INV-1008` with no `amount`, and no word about why, may report that the invoice has
no amount. The list of what was left out tells it that the data exists and was withheld.

**Common mistake:** labelling only the fields you remember are sensitive. A field added
next year with no label would then be shown to every agent. DSOR-CLS-01 turns that around:
a field with no label is `CONFIDENTIAL`.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of the specification it relies on was read on
2026-10-01: §19 and §19.1 (the four labels, DSOR-CLS-01), §19.2 (the model boundary, its
example of `agent_registration` and `tenant_egress_policy`, DSOR-CLS-02a to DSOR-CLS-05),
and §30's DSOR-AUD-05a. If the code finds the plan wrong, the plan changes here first.
The same day, before the first test, it was checked against the specification's schemas,
and five things changed. Two more cases came up while the tests were written. "Think it
through" lists them all.

*Changed by the Stage 2 review, 2026-10-01.* Six reviewers audited steps 10 to 14. In
this step they found five gaps in masking:

- A clearance that is not one of the four labels, such as `INTERNAL` in capitals, saw every
  field.
- A field with no label was `confidential` only at the top of an answer. Inside `status`,
  an agent got a vendor's bank account.
- A row meant a kind with no list in it, so an invoice with a list of lines was named
  nowhere in the record of its read.
- A redaction named a field by the data's own key, and a key can carry a value to the agent.
- Refusal masking was tested at one clearance only.

Decisions 1, 2, 3, 4, and 7 change where they are marked, and so do C1 to C5. The review's
fixes from steps 07 to 13 are carried here too ("Think it through").

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** Data above an agent's clearance never crosses the model boundary, a field
nobody labelled is treated as sensitive, and the agent is told what was withheld. The
analogy is the blacked-out copy.

**Outcome.** What is true when this step is done:

1. `accounts-payable-fte`, with clearance `INTERNAL`, reads `INV-1008` and gets it without
   `amount` and `open_amount`, and with `redactions` naming both.
2. `invoice.list` does the same for every item of the page, and names each field once.
3. A field with no label is left out for every agent whose clearance is below
   `CONFIDENTIAL`. *Changed by the Stage 2 review, 2026-10-01:* at any depth, and its
   redaction names its place, not its key.
4. Every query's answer carries `classification`, the highest label among the fields it
   still contains.
5. A human, `cfo_100` or `user_123`, gets every field, and the answer's label says
   `CONFIDENTIAL`.
6. A read that returns `CONFIDENTIAL` or `RESTRICTED` data leaves a record with the
   principal, the operation, what was read, and how many rows.

**Not the outcome of this step.** The tenant's egress policy, the second half of
DSOR-CLS-02a (decision 6). Tokens in place of masked values, which let an agent pass a
value it cannot see into a command (DSOR-CLS-02c, L2). Row budgets over time (DSOR-CLS-04b,
L2). Minimum group sizes for aggregations (DSOR-CLS-04a).

**The success signals**, each a test that fails if this step's code is deleted:

- The agent's `INV-1008` has no `amount`, and its `redactions` name `amount` and
  `open_amount`.
- A field added to an invoice with no label is left out of the agent's answer.
- The agent's answer carries `classification: "internal"`.

**A guard, not a signal.** `cfo_100` gets the amount. That test passes with or without
this step's code. It proves the masking does not reach too far: an approver in step 29
must see what they approve.

### What the specification asks, and what this step can honestly give

Checked on 2026-10-01:

1. **DSOR-CLS-02a has two triggers:** a field above the agent's clearance, or one the
   tenant's model-egress policy bars. This step builds the first. The second is recorded
   as not built (decision 6).
2. **DSOR-CLS-02a allows three ways to withhold:** omit, mask, or tokenize. This step omits
   (decision 3). Tokens are DSOR-CLS-02c, an L2 rule.
3. **§19.2's example gives `accounts-payable-fte` the clearance `confidential`,** which
   would let it see `amount`. The map's "done when" needs the agent to see a masked
   `amount`. This step gives the agent `INTERNAL` (decision 2), so the two differ.
4. **DSOR-CLS-03 says "the highest classification among the fields it contains".** This
   step reads that as the fields the answer still contains after masking. Someone could
   read it as the fields of the record the answer came from. Recorded as a question for
   the specification.
5. **DSOR-CLS-05 asks for the principal, actor chain, operation, resource scope, and row
   count.** The actor chain is the caller alone until step 18.
6. **The schemas say how these are written.** In JSON the four labels are lower case:
   `"public"`, `"internal"`, `"confidential"`, `"restricted"`
   (`common.schema.json#/$defs/classification`). The result envelope, the specification's
   shape for an answer, has `classification` and `redactions`, and each redaction is an
   object: `{ field, reason, treatment }`. The audit record has `resources`, a list of
   URIs, and `row_count`. It also has a kind of record, `classified_read`, that this step
   does not use (decision 7).
7. **A refusal carries no label.** The error envelope's schema allows no field besides
   its own, and `classification` is not one of them. This step reads DSOR-CLS-03's "every
   query response" as every answer that carries data. Recorded as a question for the
   specification.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-CLS-01 | **C1.** A field with no label is `CONFIDENTIAL` | A field added to the answer, with no label, is left out for an `INTERNAL` agent, and makes a human's answer `CONFIDENTIAL`. *Changed by the Stage 2 review, 2026-10-01:* at any depth. A key with no line inside `capped` is left out at `capped.<unlabelled>`. An object or a list where the file declares a plain value has keys nothing labels, so the answer is refused, for everyone |
| DSOR-CLS-02a | **C2.** For an agent, every field above its clearance is left out before the answer leaves | `invoice.get` and `invoice.list` as `accounts-payable-fte` and as `firm-ap-fte` have no `amount` and no `open_amount`, on memory and on the database. The page keeps its `next_cursor`. *Changed by the Stage 2 review, 2026-10-01:* a clearance that is not exactly one of the four labels is `public`, and a caller whose type DSoR does not know is masked as an agent. Start-up refuses both, naming the principal. `firm-ap-fte`'s `invoice.list` was not asked on the database before. It is now |
| DSOR-CLS-02b | **C3.** An answer from which fields were left out lists them | `redactions` holds one entry for each field, `{ field, reason: "clearance", treatment: "omitted" }`, with the field as a path: `amount` for `invoice.get`, `items[].amount` for `invoice.list`. *Changed by the Stage 2 review, 2026-10-01:* a path names only fields the file declares. A key it does not declare is `<unlabelled>`, at its place, once however many there are, so a key never carries data to the agent |
| DSOR-CLS-03 | **C4.** Every query's answer carries the highest label among the fields it contains | The agent's answer: `"internal"`. A human's: `"confidential"`. An empty page: `"public"`. *Changed by the Stage 2 review, 2026-10-01:* the fields inside a record count too, at every depth. The answers above are unchanged |
| DSOR-CLS-05 | **C5.** A read that returns `CONFIDENTIAL` or `RESTRICTED` data is recorded with who, what, and how many | The human's read of `INV-1008` leaves a record with its principal, the operation, `resources` holding the invoice's URI, `row_count: 1`, and the label `"confidential"`. *Changed by the Stage 2 review, 2026-10-01:* a row is a kind that labels both `tenant_id` and `id`. An invoice with a list of lines is still named |
| (our decision) | **C6.** Masking is for agents only | `cfo_100` gets every field, with the same values as before this step |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **The labels live in a file, `classifications.json`,** one entry for each kind of
   answer, and one label for each field, written in lower case as the schema writes them:

   ```json
   { "Invoice": { "id": "internal", "tenant_id": "internal", "vendor_id": "internal",
                  "status": "internal", "amount": "confidential", "open_amount": "confidential" },
     "InvoicePage": { "items": "Invoice[]", "next_cursor": "internal", "capped": "public" } }
   ```

   Each contract's output already names its kind: `invoice.get` returns an `Invoice`, and
   `invoice.list` an `InvoicePage`. `"Invoice[]"` means a list whose every item is an
   `Invoice`. The page's own fields have labels too. `next_cursor` is an invoice's id, so
   it is `internal`, like `id`. `capped` holds the caller's own number and DSoR's
   maximum, so it is `public`. Start-up checks the file as it checks `roles.json`: a value
   that is neither one of the four labels nor a list of a kind the file has, or a key
   written twice, stops the program. *Downside:* the labels sit apart from the input and
   output schemas, so a new field needs a line in two places. Missing the second is safe:
   the field is `confidential`. And a value in the file is either a label or a list, so
   start-up checks two kinds of value.

   *Changed by the Stage 2 review, 2026-10-01:* every key at every depth has a line. A
   field that holds an object names the kind of that object after its own label, and that
   kind has lines of its own:

   ```json
   { "Invoice": { "id": "internal", "tenant_id": "internal", "vendor_id": "internal",
                  "status": "internal", "amount": "confidential Money",
                  "open_amount": "confidential Money" },
     "Money": { "value": "confidential", "currency": "confidential" },
     "InvoicePage": { "items": "Invoice[]", "next_cursor": "internal", "capped": "public Capped" },
     "Capped": { "asked": "public", "max": "public" },
     "InvoiceIssueResult": {} }
   ```

   So a line is one of three. A label alone is for a plain value: text, a number, true,
   false, or null. A label and a kind is for an object, which keeps its own label for the
   whole. And `"Kind[]"` is for a list. `amount` keeps the label `confidential` it had, so
   the agent's answer does not change, and `Money`'s two fields carry the label `amount`
   carries. Start-up also refuses a contract whose output kind has no entry in the file.
   That is why `InvoiceIssueResult`, the result of `invoice.issue`, is there with no lines:
   its code is not built yet (step 22), and every field it ever has is `confidential` until
   someone labels it. *Downside:* the file is longer, and start-up checks three kinds of
   line. A list has no label of its own: only its items do.
2. **Every agent has a clearance, in DSoR's table of principals:** `accounts-payable-fte`
   and `firm-ap-fte` have `INTERNAL`. An agent with no clearance written down has
   `PUBLIC`, the lowest, never a default that shows more. Humans have none, because
   masking is not applied to them (decision 5). *Downside:* §19.2's example gives the
   agent `confidential`. This step chose `INTERNAL` so that the map's masked `amount` can
   be seen.

   *Changed by the Stage 2 review, 2026-10-01:* a clearance that is not exactly one of the
   four labels, in lower case, is `public` too. `rank()` puts a label it does not know
   above `restricted`. That is safe for a field and wrong for a clearance: an agent whose
   clearance was written `INTERNAL` saw every field. And start-up checks every clearance in
   DSoR's table, beside the role check, and stops the program, naming the principal.
   *Downside:* a misspelled clearance stops the program. That is the point: the table is
   fixed, not quietly read as `public`.
3. **A withheld field is left out, never replaced, and the answer is DSoR's own copy.**
   The answer has no `amount` key at all. `{ value: "***" }` would break step 01's rule
   that a money value is a decimal string, and code that trusted it would read a wrong
   value. DSoR first takes a deep copy of what the operation's code returned, and walks
   only the copy. So no value can change after DSoR has looked at it, and the record and
   the answer come from the same copy. A value that cannot be copied, such as a function,
   is refused. What is not a record of its kind, such as text, a number, nothing, or a
   list where one invoice was due, has no fields to leave out and no rows to name. So
   nobody gets it: the call is refused with `INTERNAL_ERROR`, for a person too.
   *Downside:* the invoice an agent gets no longer has the shape of an invoice, and the
   output schema must allow the fields to be missing. A label says what a field holds,
   and DSoR does not check the value: code that puts an amount inside `status` would send
   it (left open below). And step 13's size tests, whose fake code returned text and pages
   of made-up rows, now return invoices and ask as a person.

   *Changed by the Stage 2 review, 2026-10-01:* two changes.
   - **Every key at every depth.** Masking walked the top of an answer and a page's items.
     Now it walks every field by its line (decision 1). A key with no line is
     `confidential`, at any depth. An object or a list where the line says a plain value, or
     under a key with no line, holds keys that nothing labels. So the answer is refused, for
     everyone, with `INTERNAL_ERROR`. A record the caller may not see is still walked, to
     check its shape, so a wrong shape is refused whoever asks.
   - **One copy.** Step 10's decision 14 makes DSoR's own copy of the answer, to check that
     every row is the active company's. Masking now walks that copy and makes none of its
     own, so the answer, its record, and the company check read one copy. The copy is made
     through JSON text. JSON calls a `toJSON` function by itself, so the copy refuses one,
     as it refuses a function, a Proxy, an object made by a class, such as a `Date`, a list
     with a prototype of its own, and a boxed string, number, or true or false.
     `structuredClone`, this step's first copy, refused them too, but it stops at about
     2,000 levels of nesting, and the company check must reach any depth JSON can carry.

   *Downside:* code that returns a `Date`, or any object made by a class, is refused, and
   must return plain data. And an object in a field labelled as a plain value, which a
   person once got, is now refused for the person too.
4. **The answer grows two fields beside `data`, with the names and shapes of the
   result envelope:** `classification`, always, and `redactions`, only when something
   was left out. Each redaction is `{ field, reason: "clearance", treatment: "omitted" }`,
   in order of `field`. A field is written as a path: its name, with `items[].` in front
   for a page's items. *Downside:* the query answer's shape, step 04's decision, changes
   again, and is still not a result envelope, because it has no `outcome`.

   *Changed by the Stage 2 review, 2026-10-01:* a path names only fields the file declares.
   A field inside a record comes after a dot, such as `capped.asked`. A key the file does
   not declare is written `<unlabelled>`, at its place: `<unlabelled>` at the top, or
   `items[].<unlabelled>` in a page's items. However many such keys sit in one place, the
   list names that place once. A key is text the operation's code chose, so it could carry
   a value or a URI, and the list must never repeat it. *Downside:* the agent learns that
   something was withheld at that place, not what and not how many. A developer reading the
   list cannot tell which key it was, and must look at the code.
5. **Masking is for agent principals, and is applied right after line ⑨,** before the
   64 KiB check of step 13 and before line ⑪ records the decision. The 64 KiB counts the
   data and the list of what was withheld, because that list holds field names taken from
   the data. The label is one word that DSoR writes itself. Humans are not masked.
   *Downside:* a human who pastes an answer into an AI assistant of their own carries it
   across a model boundary DSoR cannot see. And a page is cut to 64 KiB inside the
   operation's code, before masking, so the fields an agent cannot see still decide where
   its page ends. The agent learns roughly how large they are, never their values (left
   open below).

   *Changed by the Stage 2 review, 2026-10-01:* masking is for every caller but a person,
   an application, or the system. A caller whose type DSoR does not know, such as `Agent`
   in capitals, was not masked, the same hole as a misspelled clearance (decision 2). Now
   it is masked as an agent, and its answer names it in `agent_id`, by the same rule.
   Start-up refuses any type that is not one of §12's four kinds of caller, naming the
   principal. And masking now comes after the company check (step 10's decision 14), so the
   64 KiB check measures what masking produced from the company check's copy. *Downside:*
   an application or a system caller is still not masked. None exists yet.
6. **The tenant's egress policy is not built.** DSOR-CLS-02a also withholds a field that
   the tenant's policy bars from a kind of model provider. It needs each agent's model
   boundary and a policy per company. *Downside:* a `RESTRICTED` field goes to an agent
   whose clearance is `RESTRICTED`, whatever the company's policy would say.
7. **The record of a read uses the audit record's own fields:** `resources`, the
   canonical URIs of the records the answer returned, and `row_count`, how many. A row is
   one record of a kind with no list in it, here one `Invoice`. Its URI is its
   `tenant_id`, its kind in lower case, and its `id`: `dsor://org_456/invoice/INV-1008`.
   A record with no `tenant_id` or no `id` has no URI, so DSoR could not say what was
   read. The answer is refused with `INTERNAL_ERROR`, for a person too: no evidence, no
   answer, as with DSOR-EXE-03b. The
   answer's label goes under `extensions`, as `"org.panaversity.steps": { classification }`,
   because the audit record has no field for it. Step 10 kept a claimed company there the
   same way. All three are written for every read that returns data, and DSOR-CLS-05
   needs them for `confidential` and above. They hold URIs, a count, and a label, never
   the values read, as DSOR-AUD-05a asks. The read stays part of the one decision record
   each call leaves (step 08), so the schema's kind `classified_read` is not used.
   *Downside:* two more columns, `resources` and `row_count`, in `dsor.audit`, by
   migration `007`, and `dsor_runtime`'s list of `INSERT` columns grows by two words. A
   reader who looks for classified reads looks inside `extensions`. A kind whose name in
   lower case is not its URI's entity needs a rule of its own. And step 13's page tests
   give their made-up rows a `tenant_id`.

   *Changed by the Stage 2 review, 2026-10-01:* a row is a record of a kind that labels
   both `tenant_id` and `id`, with lists in it or not. The old rule, a kind with no list in
   it, named nothing once an invoice had a list of lines: a person's read was recorded as
   `resources: []` and `row_count: 0`. A line that labels its own `tenant_id` and `id` is a
   row too, named after its invoice. *Downside:* a kind that labels both fields for another
   reason is counted as a row, and named in the record.
8. **A refusal from the operation's code is masked too.** *Added after the review.* A
   refusal's message is text, and the operation's code can put company data in it. So a
   refusal thrown at line ⑨ carries a label, `confidential` unless the code gives one. An
   agent whose clearance is below it gets the same code with a fixed message: "the
   operation refused the call, and its reason is above the caller's clearance". A message
   labelled `restricted` is replaced for everyone, so no record ever holds one
   (DSOR-AUD-05a). `invoice.get`'s `no invoice "INV-9999"` is labelled `internal`: it
   repeats only the id the caller sent. Refusals from lines ① to ⑥ are DSoR's own
   sentences about the caller's own input, and are not masked. *Downside:* every refusal
   an operation writes needs a label, or an agent gets the fixed message. The record keeps
   what the caller heard, as it has since step 08.

### The tests, by claim

- **C1:** a planted field, `vendor_bank_account`, with no label, in the answer of a fake
  `invoice.get` that returns only `id`, `status`, and the planted field: left out for the
  agent and listed, and it makes the human's answer `"confidential"`. The fake answer has
  no `amount`, so only the planted field can make it `confidential`. *Changed by the
  design check:* with `amount` in it, the human's answer is `confidential` with or
  without DSOR-CLS-01's code. *From the Stage 2 review:* inside `capped`, a key with no line
  is left out at `capped.<unlabelled>`. An object or a list where the file declares a plain
  value, or under a key with no line, is refused for the agent and for `user_123`. So is
  text or a list in `capped`, and a wrong shape inside `amount`, where the agent may not
  look.
- **C2:** as each agent, on memory and on the database: `invoice.get` for `INV-1008` has
  no `amount` and no `open_amount`, and every other field is as before. `invoice.list`:
  no item has either, and the page keeps its `next_cursor`. A planted agent with no
  clearance written down is treated as `public`: every field of an invoice is withheld
  and listed. *Added before any code, 2026-10-01:* the learner's prediction for break Y6
  showed that without it, nothing would catch a missing clearance treated as a high one.
  An answer that is not a record, and a page whose items are not, are refused, for a
  person too (decision 3). Masking comes before the 64 KiB check: a large field the agent
  may not see does not refuse its answer, and does refuse a person's (decision 5).
  *From the review:* a planted agent with no clearance, sent through the real pipeline,
  gets every field withheld. An agent's own answer over 64 KiB is refused. A value that
  cannot be copied is refused, and a value changed after the code returned does not
  change the answer (decision 3). *From the Stage 2 review:* a clearance written
  `INTERNAL`, `Internal`, ` internal`, `secret`, empty, or as a number is `public`. A planted
  agent whose clearance is spelled `INTERNAL` gets no amount through the real pipeline, and
  start-up refuses such a clearance, naming the principal. A caller whose type is written
  `Agent`, `AGENT`, or `ai_agent` is masked as an agent, and start-up refuses that type
  too. And `firm-ap-fte`'s page, on the database.
- **C3:** the agent's `invoice.get`: `redactions` names `amount`, then `open_amount`, each
  with `reason: "clearance"` and `treatment: "omitted"`. `invoice.list`:
  `items[].amount` and `items[].open_amount`, each once. Both pass the result envelope's
  schema for `redactions`. The human's answers: no `redactions` key. *From the review:*
  a list of what was withheld counts toward the 64 KiB, so 2,000 unlabelled fields are
  refused (decision 5). A list inside a page's items keeps its whole path. *From the Stage 2
  review:* a key the file does not declare, a bank account, is listed as `<unlabelled>`, and
  appears nowhere in the answer. Two such keys at one place, or 2,000, are listed once. So
  the list-counts tests now declare their 2,000 fields.
- **C4:** the agent's `INV-1008`: `"internal"`. The human's: `"confidential"`. An empty
  page: `"public"`. Each passes the result envelope's schema for `classification`.
- **C5:** on the database: the human's `invoice.get` leaves a record with
  `resources: ["dsor://org_456/invoice/INV-1008"]`, `row_count: 1`, and
  `"confidential"` under `extensions`. A page's record names each invoice it returned. A
  refused read's record names none. An answer whose invoice has no `id` is refused, for
  a person too (decision 7). *From the review:* the record names the id the answer
  carries, even when the code's object gives a different id each time it is read. A page
  that holds one invoice twice counts two rows. An answer refused for its size records no
  rows. An answer of a kind the file does not have is still named. The database log's
  own reader gives `resources` and `row_count` back. *From the Stage 2 review:* with
  `lines: "Line[]"` added to `Invoice`, a person's read of `INV-1008` is still named, with
  lines in it or without. A line that labels `tenant_id` and `id` is named too, and one that
  labels `id` alone is not. The record names only the rows the caller was given. And
  start-up refuses a contract whose output kind the file does not have.
- **Decision 8, from the review:** the operation's refusal with the amount in its
  message: the agent hears the fixed message, and neither its answer nor the record holds
  the amount (DSOR-AUD-05a). `no invoice "INV-9999"` still reaches the agent. A person
  hears a `confidential` message whole. A `restricted` message is replaced for a person
  too, and in the record. *From the Stage 2 review:* an agent with no clearance written
  down, so `public`, hears a refusal labelled `internal` as the fixed message, and one
  labelled `public` whole. An agent whose clearance is `confidential` hears a
  `confidential` refusal whole, and a `restricted` one as the fixed message.
- **C6:** `cfo_100` and `user_123` get `amount` and `open_amount` with the values of step
  13.
- **Start-up:** `classifications.json` with the label `secret`, the label `INTERNAL` in
  capitals, a list of a kind the file does not have, or a key written twice, stops the
  program and names the problem. *From the Stage 2 review:* so does a label and a kind the
  file does not have, a label that is not one of the four before a kind, a kind with no
  label, three words, or a list with a label.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| Y1 | Humans are masked too | only C6, the guard | not asked; the expectation stands |
| Y2 | A field with no label is `PUBLIC` | only C1's planted field | only the planted field test |
| Y3 | `redactions` is left out | C3, and the map's "done when" | not asked; the expectation stands |
| Y4 | Only the top level is masked, not a page's items | C2's and C3's `invoice.list` tests | the `invoice.list` tests |
| Y5 | The label is taken from the whole record, before masking | C4: the agent's answer says `"confidential"` | C4 |
| Y6 | An agent with no clearance gets `CONFIDENTIAL` | only C2's planted agent with no clearance | only a planted agent (and there was none: C2 gained one) |

The review also attacks the step with the threat that is its reason: data that crosses
the model boundary through an allowed read, by a field, a list, an error message, or a
record.

### Left open, and not this step's idea

- **The tenant's egress policy** (decision 6), the other half of DSOR-CLS-02a.
- **Tokens for masked values** (DSOR-CLS-02c, L2), so an agent can pay an amount it
  cannot see.
- **Row budgets over time** (DSOR-CLS-04b, L2), which the map places in no step yet.
- **A `purpose` on each query,** which §19.2 recommends.
- **Wrong data in a correctly labelled field** (decision 3). DSoR does not check that a
  value fits its field. Checking a result against its output schema would, and that is
  not this step's idea.
- **The page cut before masking** (decision 5) tells an agent roughly how large the
  fields it cannot see are.
- **The actor chain** in the record of a read (DSOR-CLS-05). It is the caller alone until
  step 18, so DSOR-CLS-05 is met only in part.

## Before you build: set up Neon

The rule is: **a secret never passes through a chat.** Claude Code may do this setup
itself, this way:

1. Create a branch `step-14` **from `step-13`**, with the Neon MCP server or with
   `neonctl branches create`.
2. Write `.env` with `neonctl connection-string`, its output redirected into the file,
   never printed: the owner's string as `DSOR_MIGRATION_URL`, and the same string with
   the user `dsor_runtime` and a new random password (letters and digits) as
   `DSOR_DB_URL`. Both with `sslmode=verify-full`.
3. Run `pnpm migrate`. It sets `dsor_runtime`'s password from `DSOR_DB_URL`, and runs
   migration `007`. *Changed by the Stage 2 review, 2026-10-01:* and migration `003b`, if
   the branch it was made from has not run it.
4. Check without looking: `pnpm test:db` passes, and the transcript holds no
   `postgresql://` with a password in it.

## What changed since step 13

| File | What changed |
| --- | --- |
| `classifications.json` | **New.** Each kind of answer, `Invoice` and `InvoicePage`, with a label for each field (decision 1). Since the Stage 2 review, also `Money`, `Capped`, and `InvoiceIssueResult`, and a field that holds an object names its kind after its label |
| `src/labels.ts` | **New.** The four labels, lowest first, reading and checking `classifications.json`, and `labelOf`, which gives `confidential` to a field with no line (decision 1, C1). Since the Stage 2 review, `readLine`, which reads a line as a plain value, an object of a kind, or a list |
| `src/masking.ts` | **New.** `clearanceOf`, and `show`, which walks an answer by its kind: it leaves out what is above the clearance, lists it, labels the answer, and names each row by its URI (C2 to C5). Since the Stage 2 review, `clearanceProblems` for start-up, the walk reaches every depth, and `<unlabelled>` |
| `migrations/007_read_records.sql` | **New.** The columns `resources` and `row_count` in `dsor.audit`, and two more `INSERT` columns for `dsor_runtime` (decision 7) |
| `schemas/result-envelope.schema.json` | **New.** The specification's own, copied byte for byte. The tests check `classification` and `redactions` against it (decision 4) |
| `src/principals.ts` | Both agents have the clearance `internal` (decision 2). Since the Stage 2 review, `PRINCIPAL_TYPES`, and `actsAsAgent`, one rule for who is masked and who is named in `agent_id` (decision 5) |
| `src/pipeline.ts` | Right after line ⑨, `show`, before step 13's 64 KiB check. The answer gains `classification` and, when something was left out, `redactions`. What the read returned goes to line ⑪'s record. Since the Stage 2 review, the company check comes first, and masking walks its copy (decision 3) |
| `src/envelope.ts`, `src/log.ts`, `src/postgres.ts` | A refusal carries a label (decision 8). A query's answer gains the two fields. A decision gains `resources`, `row_count`, and the label under `extensions`, and the database log writes and reads them |
| `src/registry.ts`, `src/main.ts` | Start-up checks `classifications.json` with the contracts. A file of your own can be named as the fifth argument. `pnpm start` shows `cfo_100` reading `INV-1008` whole, after the agent. Since the Stage 2 review, start-up also refuses a clearance or a type it does not know, and an output kind the file does not have |
| `test/classifications-file.test.ts` | **New.** Decision 1: the shipped labels, and every way the file can be wrong |
| `test/unlabelled.test.ts` | **New.** C1 |
| `test/masking.test.ts`, `test/masking.db.test.ts` | **New.** C2, on memory and on the database |
| `test/redactions.test.ts`, `test/answer-label.test.ts` | **New.** C3 and C4 |
| `test/read-record.test.ts`, `test/read-record.db.test.ts` | **New.** C5 |
| `test/humans-unmasked.test.ts` | **New.** C6, the guard |
| `test/not-a-record.test.ts`, `test/copy-first.test.ts`, `test/size-after-masking.test.ts`, `test/refusal-labels.test.ts` | **New, from the review.** Decisions 3, 5, and 8 |
| `test/sweep-gaps.test.ts` | **New, from the sweep.** One test for each break that survived and was real |
| `src/pages.ts`, `src/operations.ts` | From the review: the 64 KiB counts the list of what was withheld, and `invoice.get`'s not-found is labelled `internal` |
| `test/helpers.ts` | `runAs`, a fake operation called by anyone, with an output kind of its choice. The agent's `INV-1008` typed out without amounts, and its redactions |
| every other test | C2 broke 30 older unit tests and 4 database tests, C3 broke 4, C4 broke 8, and C5 broke 9 unit tests and 1 database test. A test about money now asks as a person, such as `cfo_100`. A test about which company or which caller keeps the agent, and expects the invoice without amounts, with its redactions and its label. A planted list names `InvoicePage` as its output. Step 13's size tests ask as `user_123`, and their made-up rows carry a company. The principal table has clearances. The program's log test counts 11 records of 14 calls |

Every other file is step 13's, without its `NEW IN STEP` markers. No new dependency.

*Changed by the Stage 2 review, 2026-10-01:* that review fixed eight findings that began in
earlier steps, and this folder carries them too. Line ① makes the one copy of the input
(step 07's decision 9). A company id has 1 to 18 digits, and migration
`003b_bounded_claims.sql` makes the log refuse a large claim (step 10's decision 12). The
operation's code gets only the active company's invoices, from `src/company.ts`, and its
answer must hold no other company's row (step 10's decisions 13 and 14). `inCompany` checks
that its `COMMIT` really committed (step 11's decision 10). The program started as the owner
must name every fact the start-up check reads from the database (step 09's decision 17, and
step 11's decision 7). The catalog guard looks at every schema, view, and function (step
11's decision 1). The suite searches whole answers for canaries, sends the in-company pair,
and tests its judge through fake DSoRs (step 12's decisions 4 and 8, and its C2). And it
follows a list's cursor for up to 10 pages (step 13's decision 6). One began here: masking at
every depth (decisions 1 to 4 and 7). New files: `src/company.ts`, `test/company.test.ts`,
`test/every-key.test.ts`, and `migrations/003b_bounded_claims.sql`. Step 13's folder holds
the carried fixes too, so the commands below show them only where this step changed the
same lines.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_13_bounded_queries/src mj_14_classification_and_masking/src
git diff --no-index mj_13_bounded_queries/test mj_14_classification_and_masking/test
```

## Run it

Set up Neon first ("Before you build" above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # runs 003b and 007 if your branch has not, and sets dsor_runtime's password again
pnpm check        # typecheck and the unit tests
pnpm test:db      # the database tests
pnpm start        # the program, against the database
```

The program's first two answers, on 2026-10-01. First the agent reads `INV-1008`, then
`cfo_100` reads the same invoice:

```text
{
  data: {
    tenant_id: 'org_456',
    id: 'INV-1008',
    vendor_id: 'VENDOR-44',
    status: 'issued'
  },
  classification: 'internal',
  redactions: [
    { field: 'amount', reason: 'clearance', treatment: 'omitted' },
    { field: 'open_amount', reason: 'clearance', treatment: 'omitted' }
  ],
  correlation: {
    request_id: 'req_70f8701e-52d7-4f3d-8620-40ee8e9ad9eb',
    agent_id: 'accounts-payable-fte'
  }
}
{
  tenant_id: 'org_456',
  id: 'INV-1008',
  vendor_id: 'VENDOR-44',
  amount: { value: '31400.00', currency: 'USD' },
  open_amount: { value: '31400.00', currency: 'USD' },
  status: 'issued'
}
```

The agent's answer has no `amount` key at all, says why, and is labelled `internal`,
because nothing higher is left in it. `cfo_100` sees the 31,400.00 USD. Further down, the
record of the agent's read:

```text
{
  …
  operation: 'invoice.get@1',
  authorization: 'ALLOW',
  result: 'ok',
  …
  extensions: { 'org.panaversity.steps': { classification: 'internal' } },
  resources: [ 'dsor://org_456/invoice/INV-1008' ],
  row_count: 1
}
…
14 calls answered, so 14 records were written. dsor_runtime reads 11 of them, in org_456 and org_789, and cannot read the other 3
```

The record names the invoice by its URI, and holds no value that was read.

*Changed by the Stage 2 review, 2026-10-01:* on this folder's branch `step-14`, `pnpm
migrate` also ran `003b`, which that review added in step 10:

```text
dsor_runtime: password set again from DSOR_DB_URL
migration 003b_bounded_claims: done
```

On the code after that review, `pnpm check` prints `924 passed`, and `pnpm test:db` prints
`100 passed`. Before it, they printed `761 passed` and `82 passed`. The program's output
above is the same, run again on 2026-10-01.

## Break it

Every break of the design's table, performed on 2026-10-01, one at a time, in a copy of
this folder outside the repository, then put back and compared byte for byte. They ran on
the unit tests, which run on memory: each break changes what DSoR does with an answer,
not how it reads the database.

*Changed by the Stage 2 review, 2026-10-01:* every break ran again on the code after that
review, in a copy without `.env`, so the 4 tests that read it were skipped and 920 of the
924 unit tests ran. The walk at every depth meant each break was written again: Y1,
`clearanceOf` gives a person `internal`; Y2, `labelOf` ends with `?? "public"`; Y3, the
pipeline never lists the redactions; Y4, a list's items are kept as they are, not walked;
Y5, a withheld field's label still counts, a plain value's or a record's; Y6, an agent with
no clearance, or one that is not one of the four, gets `confidential`. The last column holds
those runs.

| # | The break | Learner's prediction | Before the review | On the final code | After the Stage 2 review |
| --- | --- | --- | --- | --- | --- |
| Y1 | People are masked too: a person's clearance is `internal` | not asked. The design expected only C6 | **26 tests**: C6's four, the person's side of C3, C4, and C5, and the older tests that now read money as a person | 29 | 36: the same, and tests that review added that ask as a person, such as the suite's planted leaks the people see, a key named `__proto__`, and step 13's one-row page at the 64 KiB edge |
| Y2 | A field with no label is `public` | only the planted field test | 7, and each one plants a field or a kind the file does not have | 11, each one planted: the review's size tests plant unlabelled fields too | 16, each one planted: the keys listed as `<unlabelled>`, the key inside `capped`, and the suite's planted key and `tenantId`, which then reach the agents |
| Y3 | `redactions` is left out of the answer | not asked | 7: C3's four, and three older tests that expect the agent's invoice with its redactions | 8 | 16: the same, and the review's tests of `<unlabelled>` and of whole answers an agent gets |
| Y4 | Only the top level is masked, not a page's items | the `invoice.list` tests | 8, every one a page test: C2, C3, C4, and C5 for a page, a page whose item is not a record, and a planted list | 12, every one a page test | 14: the same, a line that labels `tenant_id` and `id`, a list inside an invoice, and a wrong item in a list inside `amount` |
| Y5 | The label is taken from the whole record, before masking | C4 | 8: C4's three, C5's agent record, and four older tests that compare the agent's whole answer | 9 | 19: C4, and every test that compares an agent's whole answer, its label included |
| Y6 | An agent with no clearance gets `confidential` | only a planted agent | **1**: the planted agent, as predicted | **2**: the planted agent, and the same agent sent through the real pipeline, which the review added | 10: the two, and the review's clearances not of the four, through `clearanceOf` and through the pipeline, and a refusal heard at `public` |

**Y2, the common mistake.** In `src/labels.ts`, make `labelOf` end with `?? "public"`.
The planted field, a vendor's bank account that nobody wrote in `classifications.json`,
goes to the agent:

```text
 FAIL  test/masking.test.ts > C2: for an agent, every field above its clearance is left out > DSOR-CLS-01: a field with no label is left out of the agent's answer
AssertionError: expected { tenant_id: 'org_456', …(3) } to strictly equal { tenant_id: 'org_456', …(2) }

- Expected
+ Received

  {
    "id": "INV-1008",
    "status": "issued",
    "tenant_id": "org_456",
+   "vendor_bank_account": "PK36SCBL0000001123456702",
  }
```

No shipped invoice has such a field, so every test that reads real invoices stays green.
Only a planted field shows the break. That is why C1's tests plant one.

**Y6, caught by a planted agent only.** In `src/masking.ts`, make `clearanceOf` give an
agent with no clearance `confidential`. Before the review, one test failed:

```text
 FAIL  test/masking.test.ts > C2: each agent's clearance > DSOR-CLS-02a: an agent with no clearance written down is treated as public, the lowest

Expected: "public"
Received: "confidential"
```

Both agents in the table have a clearance written down, so no call with a real token can
see this break. The learner's prediction for Y6, "only a planted agent", is why that test
exists: it was added to the design before any code. The review found the same gap one
level up: a pipeline that read `caller.clearance` itself, skipping `clearanceOf`, gave
an agent with none every field. So a second test plants the agent in DSoR's table for
one call, and takes it out again.

**Y1 was expected to be caught only by C6.** It is caught by 26 tests. C2 moved every
older test that reads money to a person, because an agent no longer gets money. So each
of those tests now guards the person's side too.

**The Stage 2 review's breaks, run on 2026-10-01.** Five gaps in masking were each shown
first on the code before the fix, red, then fixed (decisions 1 to 4 and 7):

- **A clearance spelled `INTERNAL`.** A planted agent with it got `amount`:
  `expected '{"data":{"tenant_id":"org_456","id":"…' not to contain '31400.00'`.
- **A key with no line, inside `status`.** The agent got the bank account:
  `"status": { "bank": "PK36SCBL0000001123456702", "code": "issued" }` in its data.
- **A list of lines on `Invoice`.** With only the labels changed, a person's read of
  `INV-1008` was recorded as `"resources": []` and `"row_count": 0`.
- **A key that carries data.** `expected '{"data":{"tenant_id":"org_456","id":"…' not to
  contain 'PK36SCBL0000001123456702'`: the redaction named the key.

In all, 38 tests failed before the code changed. Then two small breaks of the refusal
masking, which the review found surviving. M11 hands the refusal check
`caller.clearance` instead of `clearanceOf(caller)`. M1 compares a refusal's label with
`internal` instead of the caller's clearance. With step 14's own refusal tests, each left
all 898 tests then green. With the new tests at `public` and `confidential`, on the final
code, in the copy without `.env`:

```text
== M11: maskRefusal(thrown, caller.clearance)
× DSOR-CLS-02a: an agent with no clearance written down, so public, hears a refusal labelled internal as the fixed message
      Tests  1 failed | 919 passed | 4 skipped (924)
== M1: rank(clearance) -> rank("internal") in maskRefusal
× DSOR-CLS-02a: an agent with no clearance written down, so public, hears a refusal labelled internal as the fixed message
× decision 8: an agent whose clearance is confidential hears a refusal labelled confidential whole
      Tests  2 failed | 918 passed | 4 skipped (924)
```

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Design first | "In plain words", "Why it matters", "The design, before any code", in a session before this one |
| 2 | Neon | A branch `step-14` from `step-13`, and `.env` written by a command, never shown ("Before you build"). `pnpm test:db` green before any change |
| 3 | Check the design | Against every rule sentence and against the schemas: the result envelope, the audit record, and `common.schema.json`. Five changes, listed in "Think it through". The learner chose, and the design changed before any test |
| 4 | Red | Every new test, written before any code. Two cases the design had not named came up here, and the learner chose. Predict the red run |
| 5 | Green | One claim at a time: decision 1, C1, C2, C3, C4, C5, C6. Predict how many older tests each claim breaks |
| 6 | Break it | Y1 to Y6, for real, in a copy |
| 7 | Review | Two reviewers who have not seen your conversation. One reads and attacks. One breaks the code a line at a time, in a copy with a Neon branch of its own |
| 8 | Fix the review | Decide each finding: fix it or record it. The design first, then the red tests, then the code, one finding per commit. Predict each |
| 9 | Break it again | Y1 to Y6 on the final code, and each review finding's own break, so every new test is seen failing once |

The prompt that started this session:

```text
Set up, then build step 14 in learner mode.

Setup: follow README "Before you build": branch step-14 from step-13 in project
<your Neon project>; write .env only through commands whose output goes into the file,
never print, fetch, or read a connection string or password; then pnpm migrate and
pnpm test:db.

Build: README's design is agreed. If the code proves it wrong, change the design section
first and tell me. Red tests first, one commit per claim.
```

The learner's predictions, and what happened:

| Moment | Prediction | Real |
| --- | --- | --- |
| The red run: 63 new unit tests, before any code | 0 pass | **10 pass**: C6's four guards, three "no redactions" tests, "a refusal carries no label", and two record tests that expect something to be absent |
| C2 lands: how many of the 687 passing tests break | 0 | **30**: tests that compare the agent's invoice whole, step 13's size tests, which ran as the agent, planted lists whose contract named an `Invoice`, and the principal table |
| C4 lands: how many of the 715 passing tests break | 0 | **8**, and two fake answers that no longer typechecked: every test that compares a whole success answer |
| Y2, Y4, Y5, Y6 | as in "Break it" | right, all four |
| The review's red run: 26 new tests | not asked: the run came first, by mistake | 15 failed. The 11 that passed were 7 tests for surviving breaks, and 4 "yes" tests |
| The size fix lands: older tests broken | 0 | **right**: 0 |
| The refusal fix lands: older tests broken | 0 | **right**: 0 |

## Check yourself

1. Why does everything DSoR returns to an agent count as leaving the company?
2. Why is a field with no label treated as `CONFIDENTIAL`, and not `PUBLIC`?
3. Why does the answer list what was left out?
4. Why is `cfo_100` not masked?
5. The accounts-payable agent cannot see amounts. How could it still pay an invoice, in a
   later step?

<details>
<summary>Answers</summary>

1. The agent puts the answer into its prompt, and the prompt goes to the model provider's
   servers, outside the company.
2. A field added later and forgotten would otherwise go to every agent. With
   `CONFIDENTIAL`, forgetting a label hides the field, never shows it.
3. Without the list, a missing field looks like missing data, and the agent may act on a
   wrong belief, such as "this invoice has no amount".
4. Masking guards the model boundary, which an agent's answer crosses and a human's does
   not. And an approver must see what they approve.
5. With a token (DSOR-CLS-02c): DSoR gives a stand-in for the value, the agent passes the
   token into a command, and DSoR puts the real value back on its own side.

</details>

## Think it through

**Changed by the design check, before the first test (2026-10-01).** The design was
checked against the specification's schemas, not only its sentences:

- **The labels are lower case in JSON** (decision 1). The copied `common.schema.json`
  writes them `"public"` to `"restricted"`, and §19.2's example writes
  `clearance: confidential`. The design had `"INTERNAL"`, which the schema refuses.
- **A redaction is an object, not a path** (decision 4). The result envelope's schema
  requires `field`, `reason`, and `treatment` in each one. The design had a list of
  paths, a shape of its own for a field the specification already shapes.
- **The page's own fields needed labels** (decision 1). With none, `next_cursor` would be
  `confidential` under DSOR-CLS-01, and an agent could never read page 2 of
  `invoice.list`. The learner chose an `InvoicePage` entry in the same file, over labels
  written in code.
- **The record of a read uses the audit record's names** (decision 7). The design had
  `read: { classification, rows, scope }`. The audit record's schema already has
  `resources` and `row_count`, and step 08's decision 5 uses the record's own names where
  the step can fill them honestly. The learner chose these, over a second record of the
  kind `classified_read`.
- **C1's human half could not fail.** `amount` alone makes a human's `INV-1008`
  `confidential`, so a planted field beside it proved nothing. The fake answer now holds
  no `amount`.
- **Two cases the design had not named,** found while writing the tests. An answer that
  is not a record of its kind has no fields to mask (decision 3), and a record with no
  `id` has no URI to record (decision 7). The learner chose to refuse both: the first for
  an agent, the second for everyone.

**Found while building.**

- **The contract's output kind is read, for the first time.** Step 13 left open that
  `output.schema` was read by nothing. Now it chooses the labels. So an operation whose
  contract names the wrong kind is masked by the wrong labels. Three planted operations
  in older tests named `Invoice` and answered a page. They now name `InvoicePage`.
- **An agent no longer reads money, so older tests that read money ask as a person.** A
  test about which company or which caller keeps the agent, and expects the invoice
  without amounts. That choice is also why break Y1 is caught by 26 tests, not only by
  C6.
- **A planted list with no `tenant_id` is now refused by DSoR itself,** before step 12's
  suite looks at it. Its step 13 test was split in two: one shows the refusal, and one
  hands the suite a fake DSoR that answers anyway, so the suite's own check keeps a test.
- **`src/classification.ts` reached 202 lines,** so it became `labels.ts` and
  `masking.ts`, one idea each. Older files grew past 150 lines by a few lines each:
  `pipeline.ts` (221), `postgres.ts` (298), `main.ts` (232), `registry.ts` (163), and
  `envelope.ts` (171). Splitting them is not this step's idea. *Changed by the Stage 2
  review, 2026-10-01:* two of those counts were wrong. This sentence said 215 for
  `pipeline.ts` and 165 for `envelope.ts`. After that review, `pipeline.ts` has 257 lines,
  `postgres.ts` 303, `main.ts` 239, `registry.ts` 190, `masking.ts` 212, and `labels.ts`
  138. `envelope.ts` is unchanged.

**Found by the hostile review, and fixed.** Each fix changed the design first, then a
test, then the code. The learner chose each one.

- **A refusal's message was never masked.** An operation's code that refused with
  "INV-1008 still has 31400.00 USD open" sent the amount to the agent and into the
  record. Now a refusal from the code carries a label, `confidential` unless the code
  gives one, and an agent below it hears a fixed message. A `restricted` message is
  replaced for everyone, so no record holds one (decision 8, DSOR-AUD-05a).
- **The 64 KiB missed the list of what was withheld.** 2,000 unlabelled fields gave the
  agent 241,105 bytes. The list counts now (decision 5).
- **A person's read of text was recorded as reading nothing:** `row_count: 0` for an
  answer that held an amount. What is not a record is now refused for everyone
  (decision 3).
- **No size test asked as an agent any more,** and **no test sent a planted agent with
  no clearance through the real pipeline.** Each break left every test green. Both have
  tests now.
- **Seven tests passed with step 14's code deleted** but were titled by a rule, so they
  read as proof of it. They are guards, and their titles now name the decision they keep.
- **The analogy gave the marker to the wrong person.** In the established analogy the new
  clerk is the agent. Now the records office blacks out the copy before it hands it to
  the clerk. The blacked-out copy itself is a new analogy, not on the established list,
  and the review checked it only where it is used.
- **DSOR-CLS-05 is met only in part.** The record has no actor chain until step 18. The
  rules table says so now.

**Found by the mutation sweep, and fixed.** The sweep made 88 small breaks on the code
before the review: 74 were caught, 5 of them only by the database tests, and 14 survived.
These were real:

- **A field the agent may see was passed by reference.** A getter gave the record
  `INV-1008` and the agent `INV-1009`. A live object could change after DSoR had looked,
  and a `toJSON` function ran again when the answer was printed. Masking now walks a deep
  copy, and refuses what cannot be copied (decision 3).
- **The database log's own reader could drop `resources` and `row_count`,** and all 81
  database tests stayed green: they read `dsor.audit` with their own SQL. A test now
  reads them back through the log.
- **Also:** a size refusal recorded with rows, an answer of an unknown kind not named,
  one invoice twice counted once, an unknown label shown, and a list inside a list that
  lost its path. Each has a test that fails on it.

**Found by the Stage 2 review (2026-10-01), and fixed.** Six reviewers audited steps 10
to 14 and the seams between them (`../mj_notes.md`). They found no live leak. Eight of
their findings began in earlier steps, and this folder carries the fixes. One began here,
in masking.

- **A check and the code could see two different inputs.** Fixed from step 07 on. Lines
  ① and ② read the input itself, to check the principals and the companies it names.
  Line ⑥ then made its own copy, for the schema check and for the code. A getter, a
  field that runs code each time it is read, can answer the second read differently. In
  the red run here, the code was handed `principal: "cfo_100"` after line ① saw the
  caller, and `tenant_id: "org_789"` after line ② saw `org_456`.
  - **Fixed:** line ① makes the one copy, right after it finds who is calling. Every
    check and the code read that copy (step 07's decision 9). An input that JSON cannot
    copy is still refused with `VALIDATION_FAILED`, at the end of line ②, once the
    principals and the companies it names are checked.
  - **Caught by** step 07's and step 10's tests, carried here, in `test/pipeline.test.ts`
    and `test/who-is-calling.test.ts`. Eight of them failed in the red run. In this step,
    the code of the two that reach it answers with an invoice the agent may see whole,
    because text is not a record (decision 3).
- **A company id had no length, and the log kept a claim of any size.** Fixed from step
  10 on. In this step, an envelope naming `org_` and a million digits got a refusal of 212
  bytes, and left a record of 1,000,433 bytes that `dsor_runtime` can never remove. In
  the red run here, four unit tests failed: 19 digits and a million digits passed the
  form check, the record kept the claim, and `parseUri` took a company of 19 digits.
  - **Fixed:** a tenant id has 1 to 18 digits, and migration `003b` makes the log refuse
    an `extensions` over 1,024 bytes (step 10's decision 12). It ran on the branch
    `step-14` on 2026-10-01. Before it ran, its two database tests failed: as
    `dsor_runtime`, an `extensions` of 2 KB went in, and so did one of 1,025 bytes, each
    in a transaction that was rolled back.
  - **Caught by** the 19-digit and million-digit cases, and the tests titled `step 10's
    decision 12: …`, in `test/tenants.test.ts`, `test/uri.test.ts`, and
    `test/tenants.db.test.ts`.
- **The code could name another company, and both locks trusted it.** Fixed from step 10
  on. The high finding. The operation's code named the company at each read, and the
  store set that company for the database's policy too. In this step, the review's
  one-line fallback in `invoice.get`, `?? await invoices.get("org_456", id)`, let
  `user_700`, in `org_789`, read `org_456`'s `INV-1001`, and all 761 tests passed.
  - **Fixed, in two layers:** the code gets `companyOf(store, tenant)`, the active
    company's invoices only, to read by id or by page (step 10's decision 13). Every
    `tenant_id` in the code's answer must be the active company's, or the call fails with
    `INTERNAL_ERROR` (step 10's decision 14). Its record says `ALLOW`, and names no
    resource and no row.
  - **Where it meets masking:** after line ⑨, the code's answer goes to the company check,
    which makes DSoR's one copy of it. Masking walks that copy, the 64 KiB check measures
    what masking produced, and line ⑪ records it. Masking makes no copy of its own any
    more (decision 3). The company check stays a walk of its own, not merged into
    masking's: one walk asks whose rows these are, the other what this caller may see.
  - **Caught by** step 10's C8, in `test/company.test.ts`, `test/tenants.test.ts`, and
    `test/tenants.db.test.ts`. In the red run here, the code was handed a bare company id,
    a row of `org_789` reached the agent, and a store of the code's own read `org_789`.
    The fallback no longer passes `pnpm typecheck`, "Expected 1 arguments, but got 2", and
    at run time `user_700` hears `RESOURCE_NOT_FOUND`. With the code handed a bare company
    id again, 136 unit tests failed. With the answer check taken out, 19 failed.
  - **What it changed here:** three of step 12's planted leaks answer with a row of
    another company, and the pipeline now refuses them as bugs. `invoice.theirs`'s
    in-company pair names nothing any more: `NOPE` makes its code answer with nothing,
    which this step refuses as not a record, so both answers are the same refusal. And
    two planted lists that mix the companies get no page.
- **A transaction counted as kept when it was not.** Fixed from step 11 on. In the red
  run here, work that swallowed its own failed statement looked kept: "promise resolved
  'done' instead of rejecting". With the `COMMIT` not awaited at all, both tests failed,
  and the log's caller got the invoice.
  - **Fixed:** `inCompany` reads the answer to its `COMMIT`. Anything but `COMMIT` is the
    error "the transaction was rolled back" (step 11's decision 10).
  - **Caught by** `step 11's decision 10: …` in `test/rls.db.test.ts`, and `DSOR-EXE-03b:
    a log whose COMMIT fails gives no invoice, and no record`, in `test/audit.db.test.ts`.
    That second test uses **fault injection**, an error planted on purpose (§47): it
    wraps the real client, so every statement reaches the real database except the first
    `COMMIT`, which fails.
- **The start-up check's database facts were proven only with hand-made facts.** Fixed
  from step 09 on, with the membership of roles from step 11 on. Here, with
  `rolbypassrls` read as `false` and the count of roles as `0`, the owner's test still
  passed. With its new lines, each of four changes to the SQL in `runtimeRoleProblems`
  turned it red: `rolbypassrls` and the membership of `pg_write_all_data` read as
  `false`, and the counts of tables owned and of roles read as `0`.
  - **Fixed:** the test that starts the program as the owner requires `holds BYPASSRLS`,
    `is a member of pg_write_all_data`, `owns … tables`, and `belongs to … other role…,
    which SET ROLE can switch to`.
  - **Caught by** `DSOR-AUD-04a: refuses to run as the owner, names why, and makes no
    call`, in `test/program.db.test.ts`.
- **The catalog guard missed a kind of schema name, and every view and function.** Fixed
  from step 11 on. The catalog guard is step 11's test that reads PostgreSQL's own list of
  tables, its **catalog**, to find every table with a company column. It skipped any
  schema whose name starts with `pg`, and it looked at tables only. In the red run here,
  the old filter, `NOT LIKE 'pg_%'`, dropped `pgcrm` from all three planted lists.
  - **Fixed:** step 11's decision 1 widens to the other ways around a policy: a view, a
    saved query that reads with its owner's rights; a materialized view, a stored copy of
    rows; a foreign table, read from another server; and a `SECURITY DEFINER` function,
    which runs with its owner's rights. Three guards check that none exists.
  - **Caught by** the C1 tests in `test/rls.db.test.ts`, each filter shown on planted
    rows.
- **The mystery shopper missed leaks that do not label themselves.** Fixed from step 12
  on. In this step, an operation answered `cfo_100`, in `org_456`, with `org_789`'s
  invoice, its `tenant_id` rewritten to `org_456`. `cfo_100` got `VENDOR-77` and
  `99000.00`, and step 12's suite reported no finding. In the red run here, 30 tests
  failed against the old suite.
  - **Fixed, as in step 12:** the whole answer is searched for canaries, tenant keys, and
    URIs of another company, its redactions too. Fake DSoRs test the judge through the
    suite. The in-company pair compares a query's own "not found" for an id only the
    other company holds with its answer for `NOPE`, from both companies. Empty data is no
    data. And a planted `test.free` proves through a call that the checklist searches the
    whole input.
  - **Where it meets masking:** an agent's answer has no amounts, so the search finds
    vendors, ids, and statuses there, and finds amounts too in the people's answers. The
    suite counts both: each planted leak expects a finding from each caller who got the
    leak, and none from a caller that masking kept it from. Three leaks are planted as
    whole invoices of the caller's company, with one sign of the other company added,
    because DSoR itself now refuses an answer with no `tenant_id` or `id` (decision 7).
    The projection with no `tenant_id` is pinned as that refusal. A key with no label, and
    `tenantId`, reach only the people. A query that answers with empty data is refused by
    DSoR, so a fake DSoR answers with it, to prove the suite's own check. And
    `invoice.hint`'s "not found" is labelled `internal`, as `invoice.get`'s is: left
    `confidential`, masking would hide it from the agents.
  - **Caught by** C2, C4, C7, and C8 in `test/cross-tenant.test.ts`, the database suite's
    check of the canaries' rows, and the `test.free` tests in `test/tenants.test.ts`.
  - **Broken on purpose:** the fakes and `test.free` guard code that is right, so they
    cannot be red before a break. With the suite's judge replaced by a check that flags
    only data, only the four fakes failed. With the checklist handing its URI search only
    the input's top-level texts, only the two `test.free` tests failed.
- **The mystery shopper read only page 1 of a list, and the 64 KiB limit was never tested
  at its edge.** Fixed from step 13 on. In the red run here, seven tests failed against
  the suite as it was.
  - **Fixed:** the suite follows `next_cursor` from both of a list's calls, and checks
    every page as it checks the first, for up to 10 pages (step 13's decision 6). And a
    page of one row, 65,536 bytes as `{ items }` and 65,595 with its cursor and `capped`,
    is refused (step 13's C2).
  - **Where it meets masking:** DSoR now refuses a row with no `tenant_id` itself, so the
    page-2 row with none is slipped in by a fake DSoR, after the pipeline. And the size
    check measures what masking produced: the whole page.
  - **Caught by** C5's tests in `test/cross-tenant-lists.test.ts`, and the one-row page
    in `test/result-size.test.ts`. With the walk deleted, its five tests failed. With the
    walk stopping after page 2, the leak on page 10 and the cursor that never ends failed.
    With the pipeline measuring a page's `items` alone, the one-row page failed.
- **Masking held at the top of an answer only.** Found here. Five gaps, each shown red
  before the fix ("Break it"):
  - **A clearance that is not one of the four labels saw every field.** It is `public`
    now, and start-up refuses it, naming the principal (decision 2).
  - **A key with no line was `confidential` only at the top.** Every key at every depth
    has a line now, and an object where a plain value is declared is refused, for
    everyone (decisions 1 and 3).
  - **A row was a kind with no list in it.** A row is a kind that labels both `tenant_id`
    and `id` (decision 7).
  - **A redaction named a field by its own key.** It names only declared fields, and
    `<unlabelled>` for any other key (decision 4).
  - **Refusal masking was tested at `internal` only.** It is tested at `public` and
    `confidential` too, and M11 and M1 now fail.
  - **A hostile pass on this fix** found one more hole and five gaps, each closed red
    first. A caller whose type DSoR does not know, such as `Agent`, was not masked: it
    got both amounts (decision 5). A key named `__proto__` vanished from a person's answer
    but still raised its label. And six breaks left every test green: a record line such
    as `capped` holding text, a part the caller may not see left unchecked, the company
    check moved after masking, the copy's check for a class or a Proxy deleted, the record
    naming rows the caller never saw, and a kind that labels `id` alone counted as a row.
    Each has a test now. A second pass on those fixes found the copy still let code run
    in three ways: a hidden `toJSON` that hands back its own object, a boxed string given
    a plain prototype, and a list with a prototype of its own. Each is refused now. And a
    caller of a type DSoR does not know was masked as an agent but named as a person: one
    rule, `actsAsAgent`, now decides both. A getter, and what it hands back, still runs
    once while the copy is made (left open below).
  - **Caught by** `test/every-key.test.ts`, the clearance tests in
    `test/masking.test.ts`, the row tests in `test/read-record.test.ts`, the start-up tests
    in `test/classifications-file.test.ts`, and the refusal tests in
    `test/refusal-labels.test.ts`. 38 failed before the code changed.
  - **What it changed here:** the planted unlabelled field is listed as `<unlabelled>`. The
    size tests that make the list long declare their 2,000 fields. The sweep's test of
    another kind, and the permission test's `vendor.get`, declare their kinds, because
    start-up refuses an output kind the file does not have. The suite's planted key no
    longer reaches the agents. And a list that answers `org_789` with one invoice, not a
    page, is refused for everyone: an `InvoicePage` has no line for `amount`.
- **Sentences that said more than the code.** The design read DSOR-AUD-05a in §29: it is
  §30's. "The rules this step meets" said DSOR-AUD-05a was first met in earlier steps. No
  earlier step claims it, and its one test here is now titled by decision 8. "Left open"
  listed an unknown label ranked `restricted` as an equivalent break. It is not, and
  `a label DSoR does not know is never shown` fails on it. It also left open a planted row
  of `org_789`, which the company check now refuses. Two line counts were wrong. The rules
  table claimed both agents' `invoice.list` on the database, and the database asked one;
  it asks both now. It cited `test/copy-first.test.ts` for DSOR-CLS-02a, where no test
  carries that id. And the header of `src/main.ts` described step 13's program. Each is
  corrected where it stands.

- **The owner-store test needed records that other tests had left.** Found by step 15's
  build, on a branch made fresh from `main`: the log was empty, so `DSOR-TEN-01b: with every
  policy skipped, DSoR's own store still finds only org_456's rows` failed, or passed only
  after another file had written records. With no `org_789` record in the log it had no
  teeth. Fixed from step 11 on: the test writes a record of each company first, and may take
  60 s, as long as the owner's program it starts.

**Found by step 16's review (2026-10-03), and fixed from step 09 on.**

- **The log trusted an `INSERT` that kept nothing.** A table's owner can attach a rule or
  a trigger to it, which changes what an `INSERT` does. A rule `DO INSTEAD NOTHING` on
  `dsor.audit`, or a trigger that returns `NULL`, makes the database accept the `INSERT`
  and keep no row. `add` never asked how many rows were kept. In step 16's review, the
  program answered every call and kept no record of any of them.
  - **Fixed:** `add` throws unless its `INSERT` kept exactly one row. The check sits
    inside `inCompany`'s work, so `inCompany` rolls the transaction back, and the caller
    hears `EVIDENCE_STORE_UNAVAILABLE` (DSOR-EXE-03b).
  - **Caught by** `DSOR-EXE-03b: a log whose INSERT keeps no row gives no invoice, and no
    record`, in `test/audit.db.test.ts`. It wraps the real client, as the `COMMIT` test
    beside it does, and changes only the log's `INSERT`: the same eleven values go in an
    `INSERT … SELECT … WHERE false`. That is a real statement, and it keeps no row. The
    test also checks that the database ran that statement and kept 0 rows, so it cannot
    pass on a statement the database refused.
- **The start-up check read PostgreSQL's names through the search path.** The **search
  path** is the list of schemas PostgreSQL looks in to find a name such as
  `has_table_privilege`. The owner can put `public` first, and make functions there with
  PostgreSQL's names that answer "no". Then a login that can change the log passes the
  check.
  - **Fixed:** the check first runs `SET LOCAL search_path TO pg_catalog, pg_temp`:
    PostgreSQL's own schema first, and the schema of temporary tables last. `SET LOCAL`
    lasts only until the transaction ends. So on a pool, the check opens a read-only
    transaction of its own. Given one connection, it uses the transaction already open
    there. Its SQL, with step 11's count of roles, is unchanged.
  - **Caught by** two tests in `test/audit.db.test.ts`. `DSOR-AUD-04a: the start-up check
    reads PostgreSQL's own names, whatever the search path finds first` runs a new owner
    program, `test/owner-login-check.ts`, through `ownerLoginCheck` in `test/db.ts`. As
    the owner, inside a transaction that is rolled back, it makes look-alikes of
    `has_table_privilege`, `has_any_column_privilege`, and `pg_has_role`, puts `public`
    first, and runs the check. `DSOR-AUD-04a: the start-up check pins the search path
    inside a transaction of its own` guards the pool's path, the one the program uses.
    Outside a transaction, PostgreSQL ignores `SET LOCAL` and warns, so the test expects
    no warning.
- **Red first, and broken on purpose.** Before the fixes, two of the three tests failed.
  The agent got `INV-1008`, though the `INSERT` kept no row. And the owner's check named 4
  problems, without "is a member of pg_write_all_data" or "can change or remove records
  in dsor.audit". The pool's test passed, as expected: it guards a path the fix adds.
  Then three breaks, each put back and compared byte for byte: `add` without its row
  check, the check without `SET LOCAL`, and the pool's path without its `BEGIN READ
  ONLY`. Each turned its own test red, and only that one, over all 924 unit tests and all
  103 database tests. The last got two warnings: "SET LOCAL can only be used in
  transaction blocks" and "there is no transaction in progress". The first also fails
  `pnpm typecheck`: `rowCount` is then never read. Twice, a test timed out after 30 s
  while the link to Neon was slow, once before any change, and each passed when run
  again. The database tests went from 100 to 103.

**Left open on purpose**, with the reason:

- **Wrong data in a correctly labelled field.** Code that puts an amount inside `status`,
  `next_cursor`, or `capped` sends it to the agent. The sweep did all three. A label says
  what a field should hold. Checking that a value fits its field is the output schema's
  job (DSOR-SCH-01, for results), and that is a step of its own.
- **The page cut before masking** tells an agent roughly how large the fields it cannot
  see are, never their values (decision 5).
- **Refusals from lines ① to ⑥ are not masked.** They are DSoR's own sentences about the
  caller's own input.
- **A planted `org_789` row in an `org_456` answer** was masked, sent, and recorded by its
  `org_789` URI, and finding it was left to step 12's suite. *Changed by the Stage 2
  review, 2026-10-01:* closed. The company check refuses such an answer with
  `INTERNAL_ERROR`, before masking reads it (step 10's decision 14).
- **A refusal's label is the code's own word** (decision 8). A refusal labelled `public`
  that holds an amount reaches every agent. Found by a hostile pass on the Stage 2
  review's fix.
- **The code runs in DSoR's own process.** Code that changes built-in functions, or
  DSoR's table of logins, could defeat every check. A lock inside one program cannot stop
  code that runs inside that same program. Found by a hostile pass on the Stage 2 review's
  fix.
- **A getter runs once, while DSoR copies.** The company check copies the answer, and a
  getter in it runs then, and so does a `toJSON` that a getter hands back. Neither can
  change the copy afterwards. Refusing every getter would refuse answers DSoR reads well
  today. Found by the Stage 2 review.
- **A list has no label of its own** (decision 1). Its items carry theirs. How many items
  it holds shows to whoever gets the list.
- **The walk reaches two calls, and 10 pages of each** (step 13's decision 6, carried
  here). A list that leaks only for some other `limit` is not reached, and an honest list
  longer than 10 pages is named, a false finding.
- **"Canary" is step 12's word, carried here:** a value whose appearance shows that
  something leaked. It is not on the house list of analogies, and step 12 flags it for
  review.
- **Files far above 150 lines,** after the Stage 2 review: `src/masking.ts` (212),
  `test/cross-tenant.ts` (401), `test/companies.ts` (260), and `test/cross-tenant.test.ts`
  (1,116). Splitting them is a change of its own, so it waits.
- **Equivalent breaks,** which change nothing a caller can see: masking every caller that
  is not a person (no application or system caller exists yet), and `>=` for `>` where the
  label climbs. *Changed by the Stage 2 review, 2026-10-01:* this list also named an
  unknown label ranked `restricted` instead of above it. That break is not equivalent: an
  agent whose clearance is `restricted` then sees the field, and `a label DSoR does not
  know is never shown, and makes the answer restricted` fails on it.

**What the predictions showed.** Twice the learner predicted that adding or removing a
field breaks no older test, and 30, then 8, broke. A test that compares a whole answer
exactly is a test of its shape too. For the review's two code fixes, the learner
predicted 0 broken, and was right both times: neither fix changes an answer that an older
test compares.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-CLS-01 | A field with no declared classification is `CONFIDENTIAL` | [§19.1 Risk and data classification](../../../specs/dsor/02-security.md#191-risk-and-data-classification) | `test/unlabelled.test.ts`: a field or a kind the file does not name (C1). The planted field: left out of the agent's answer (`test/masking.test.ts`), listed (`test/redactions.test.ts`), and a person's answer made `confidential` (`test/answer-label.test.ts`). *Since the Stage 2 review:* at every depth, a key with no line inside `capped`, and an object where a plain value is declared, refused for everyone (`test/every-key.test.ts`) |
| DSOR-CLS-02a | For agents, fields above their clearance are withheld before the response leaves | [§19.2 The model boundary](../../../specs/dsor/02-security.md#192-the-model-boundary) | `test/masking.test.ts` and `test/masking.db.test.ts`: both agents' `invoice.get` and `invoice.list`, each clearance, the agent with none, masking before the 64 KiB check, and what is not a record (C2). `test/refusal-labels.test.ts`: a refusal from the code (decision 8). `test/sweep-gaps.test.ts`: the agent with none through the real pipeline. The clearance half only: the egress policy is not built (decision 6). *Since the Stage 2 review:* a clearance that is not one of the four, through `clearanceOf`, the pipeline, and start-up (`test/masking.test.ts`); a refusal at `public` and at `confidential` (`test/refusal-labels.test.ts`); and `firm-ap-fte`'s page on the database. `test/copy-first.test.ts` was cited here, and keeps decision 3 and DSOR-CLS-05, not this rule |
| DSOR-CLS-02b | A response with withheld fields lists the redactions | [§19.2 The model boundary](../../../specs/dsor/02-security.md#192-the-model-boundary) | `test/redactions.test.ts`: each field once, as a path, in the result envelope's shape, and no list when nothing was left out (C3). *Since the Stage 2 review:* a key the file does not declare listed as `<unlabelled>`, once at its place, and never by its own text (`test/every-key.test.ts`, `test/size-after-masking.test.ts`) |
| DSOR-CLS-03 | Every query response carries the highest classification among its fields | [§19.2 The model boundary](../../../specs/dsor/02-security.md#192-the-model-boundary) | `test/answer-label.test.ts`: `internal` for the agent, `confidential` for a person, `public` for an empty page, `restricted` when one field is (C4) |
| DSOR-CLS-05 | Reads of `CONFIDENTIAL` or `RESTRICTED` data are audited with who, what, and how many | [§19.2 The model boundary](../../../specs/dsor/02-security.md#192-the-model-boundary) | `test/read-record.test.ts` and `test/read-record.db.test.ts`: the URIs, the row count, and the label of every read that returns data, and the log's own reader (C5). `test/not-a-record.test.ts`, `test/copy-first.test.ts`, and `test/sweep-gaps.test.ts`: what cannot be named is refused, the record names what left. **Partly:** the actor chain is the caller alone until step 18. *Since the Stage 2 review:* an invoice with a list of lines is still a row, a line that labels `tenant_id` and `id` is one too, one that labels `id` alone is not, and only the rows the caller was given are named (`test/read-record.test.ts`) |

Also advanced, first met in earlier steps: DSOR-QRY-01, the 64 KiB counts what leaves
for an agent, its redactions too (`test/size-after-masking.test.ts`). DSOR-EXE-02, the
record of a read, written before the answer, as every record since step 08. DSOR-TEN-02b,
a planted list whose items have no company is now refused by DSoR itself
(`test/cross-tenant-lists.test.ts`).

Touched, and not met: DSOR-AUD-05a, in §30. A record holds URIs, a count, and a label,
never a value read (decision 7), and never a `restricted` refusal message (decision 8).
That is one part of the rule. Its payload hashes are not built (step 29). *Changed by the
Stage 2 review, 2026-10-01:* this paragraph said DSOR-AUD-05a was first met in earlier
steps. No earlier step claims it. Its one test here is titled by decision 8 now, because
it shows one path, not the rule. The fixes this folder carries from steps 07 to 13 keep
their rows in those steps' READMEs.

## Next

Step 15 · Freshness labels: every answer says how old the data behind it is.
