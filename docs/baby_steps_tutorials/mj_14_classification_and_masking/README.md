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

Think of a document released with some lines blacked out. The clerk takes a marker to the
copy, before it leaves the building, and the black bars stay on the page, so a reader
knows something was there. The analogy stops at the bars: DSoR leaves the field out
entirely, and the list of what was left out plays the part of the bars.

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
and §29's DSOR-AUD-05a. If the code finds the plan wrong, the plan changes here first.
The same day, before the first test, it was checked against the specification's schemas,
and five things changed. Two more cases came up while the tests were written. "Think it
through" lists them all.

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
   `CONFIDENTIAL`.
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
| DSOR-CLS-01 | **C1.** A field with no label is `CONFIDENTIAL` | A field added to the answer, with no label, is left out for an `INTERNAL` agent, and makes a human's answer `CONFIDENTIAL` |
| DSOR-CLS-02a | **C2.** For an agent, every field above its clearance is left out before the answer leaves | `invoice.get` and `invoice.list` as `accounts-payable-fte` and as `firm-ap-fte` have no `amount` and no `open_amount`, on memory and on the database. The page keeps its `next_cursor` |
| DSOR-CLS-02b | **C3.** An answer from which fields were left out lists them | `redactions` holds one entry for each field, `{ field, reason: "clearance", treatment: "omitted" }`, with the field as a path: `amount` for `invoice.get`, `items[].amount` for `invoice.list` |
| DSOR-CLS-03 | **C4.** Every query's answer carries the highest label among the fields it contains | The agent's answer: `"internal"`. A human's: `"confidential"`. An empty page: `"public"` |
| DSOR-CLS-05 | **C5.** A read that returns `CONFIDENTIAL` or `RESTRICTED` data is recorded with who, what, and how many | The human's read of `INV-1008` leaves a record with its principal, the operation, `resources` holding the invoice's URI, `row_count: 1`, and the label `"confidential"` |
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
2. **Every agent has a clearance, in DSoR's table of principals:** `accounts-payable-fte`
   and `firm-ap-fte` have `INTERNAL`. An agent with no clearance written down has
   `PUBLIC`, the lowest, never a default that shows more. Humans have none, because
   masking is not applied to them (decision 5). *Downside:* §19.2's example gives the
   agent `confidential`. This step chose `INTERNAL` so that the map's masked `amount` can
   be seen.
3. **A withheld field is left out, never replaced.** The answer has no `amount` key at
   all. `{ value: "***" }` would break step 01's rule that a money value is a decimal
   string, and code that trusted it would read a wrong value. What is not a record of its
   kind, such as text, a number, nothing, or a list where one invoice was due, has no
   fields to leave out. So an agent gets none of it: the call is refused with
   `INTERNAL_ERROR`. A person gets it, labelled `confidential`, because nothing in it has
   a label. *Downside:* the invoice an agent gets no longer has the shape of an invoice,
   and the output schema must allow the fields to be missing. And step 13's size tests,
   whose fake code returns text and pages of made-up rows, now ask as a person.
4. **The answer grows two fields beside `data`, with the names and shapes of the
   result envelope:** `classification`, always, and `redactions`, only when something
   was left out. Each redaction is `{ field, reason: "clearance", treatment: "omitted" }`,
   in order of `field`. A field is written as a path: its name, with `items[].` in front
   for a page's items. *Downside:* the query answer's shape, step 04's decision, changes
   again, and is still not a result envelope, because it has no `outcome`.
5. **Masking is for agent principals, and is applied right after line ⑨,** before the
   64 KiB check of step 13 and before line ⑪ records the decision, so the size measured
   and the answer given are what leaves. Humans are not masked. *Downside:* a human who
   pastes an answer into an AI assistant of their own carries it across a model boundary
   DSoR cannot see.
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

### The tests, by claim

- **C1:** a planted field, `vendor_bank_account`, with no label, in the answer of a fake
  `invoice.get` that returns only `id`, `status`, and the planted field: left out for the
  agent and listed, and it makes the human's answer `"confidential"`. The fake answer has
  no `amount`, so only the planted field can make it `confidential`. *Changed by the
  design check:* with `amount` in it, the human's answer is `confidential` with or
  without DSOR-CLS-01's code.
- **C2:** as each agent, on memory and on the database: `invoice.get` for `INV-1008` has
  no `amount` and no `open_amount`, and every other field is as before. `invoice.list`:
  no item has either, and the page keeps its `next_cursor`. A planted agent with no
  clearance written down is treated as `public`: every field of an invoice is withheld
  and listed. *Added before any code, 2026-10-01:* the learner's prediction for break Y6
  showed that without it, nothing would catch a missing clearance treated as a high one.
  An answer that is not a record, and a page whose items are not, are refused for an
  agent (decision 3). Masking comes before the 64 KiB check: a large field the agent
  may not see does not refuse its answer, and does refuse a person's (decision 5).
- **C3:** the agent's `invoice.get`: `redactions` names `amount`, then `open_amount`, each
  with `reason: "clearance"` and `treatment: "omitted"`. `invoice.list`:
  `items[].amount` and `items[].open_amount`, each once. Both pass the result envelope's
  schema for `redactions`. The human's answers: no `redactions` key.
- **C4:** the agent's `INV-1008`: `"internal"`. The human's: `"confidential"`. An empty
  page: `"public"`. Each passes the result envelope's schema for `classification`.
- **C5:** on the database: the human's `invoice.get` leaves a record with
  `resources: ["dsor://org_456/invoice/INV-1008"]`, `row_count: 1`, and
  `"confidential"` under `extensions`. A page's record names each invoice it returned. A
  refused read's record names none. An answer whose invoice has no `id` is refused, for
  a person too (decision 7).
- **C6:** `cfo_100` and `user_123` get `amount` and `open_amount` with the values of step
  13.
- **Start-up:** `classifications.json` with the label `secret`, the label `INTERNAL` in
  capitals, a list of a kind the file does not have, or a key written twice, stops the
  program and names the problem.

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
   migration `007`.
4. Check without looking: `pnpm test:db` passes, and the transcript holds no
   `postgresql://` with a password in it.

## What changed since step 13

| File | What changed |
| --- | --- |
| `classifications.json` | **New.** Each kind of answer, `Invoice` and `InvoicePage`, with a label for each field (decision 1) |
| `src/labels.ts` | **New.** The four labels, lowest first, reading and checking `classifications.json`, and `labelOf`, which gives `confidential` to a field with no line (decision 1, C1) |
| `src/masking.ts` | **New.** `clearanceOf`, and `show`, which walks an answer by its kind: it leaves out what is above the clearance, lists it, labels the answer, and names each row by its URI (C2 to C5) |
| `migrations/007_read_records.sql` | **New.** The columns `resources` and `row_count` in `dsor.audit`, and two more `INSERT` columns for `dsor_runtime` (decision 7) |
| `schemas/result-envelope.schema.json` | **New.** The specification's own, copied byte for byte. The tests check `classification` and `redactions` against it (decision 4) |
| `src/principals.ts` | Both agents have the clearance `internal` (decision 2) |
| `src/pipeline.ts` | Right after line ⑨, `show`, before step 13's 64 KiB check. The answer gains `classification` and, when something was left out, `redactions`. What the read returned goes to line ⑪'s record |
| `src/envelope.ts`, `src/log.ts`, `src/postgres.ts` | A query's answer gains the two fields. A decision gains `resources`, `row_count`, and the label under `extensions`, and the database log writes and reads them |
| `src/registry.ts`, `src/main.ts` | Start-up checks `classifications.json` with the contracts. A file of your own can be named as the fifth argument. `pnpm start` shows `cfo_100` reading `INV-1008` whole, after the agent |
| `test/classifications-file.test.ts` | **New.** Decision 1: the shipped labels, and every way the file can be wrong |
| `test/unlabelled.test.ts` | **New.** C1 |
| `test/masking.test.ts`, `test/masking.db.test.ts` | **New.** C2, on memory and on the database |
| `test/redactions.test.ts`, `test/answer-label.test.ts` | **New.** C3 and C4 |
| `test/read-record.test.ts`, `test/read-record.db.test.ts` | **New.** C5 |
| `test/humans-unmasked.test.ts` | **New.** C6, the guard |
| `test/helpers.ts` | `runAs`, a fake operation called by anyone, with an output kind of its choice. The agent's `INV-1008` typed out without amounts, and its redactions |
| every other test | C2 broke 30 older unit tests and 4 database tests, C3 broke 4, C4 broke 8, and C5 broke 9 unit tests and 1 database test. A test about money now asks as a person, such as `cfo_100`. A test about which company or which caller keeps the agent, and expects the invoice without amounts, with its redactions and its label. A planted list names `InvoicePage` as its output. Step 13's size tests ask as `user_123`, and their made-up rows carry a company. The principal table has clearances. The program's log test counts 11 records of 14 calls |

Every other file is step 13's, without its `NEW IN STEP` markers. No new dependency.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_13_bounded_queries/src mj_14_classification_and_masking/src
git diff --no-index mj_13_bounded_queries/test mj_14_classification_and_masking/test
```

## Run it

Set up Neon first ("Before you build" above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # runs migration 007, and sets dsor_runtime's password again
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

## Break it

Every break of the design's table, performed on 2026-10-01, one at a time, in a copy of
this folder outside the repository, then put back and compared byte for byte. They ran on
the unit tests, which run on memory: each break changes what DSoR does with an answer,
not how it reads the database.

| # | The break | Learner's prediction | Real, before the review |
| --- | --- | --- | --- |
| Y1 | People are masked too: a person's clearance is `internal` | not asked. The design expected only C6 | **26 tests**: C6's four, the person's side of C3, C4, and C5, and the older tests that now read money as a person |
| Y2 | A field with no label is `public` | only the planted field test | 7, and each one plants a field or a kind the file does not have |
| Y3 | `redactions` is left out of the answer | not asked | 7: C3's four, and three older tests that expect the agent's invoice with its redactions |
| Y4 | Only the top level is masked, not a page's items | the `invoice.list` tests | 8, every one a page test: C2, C3, C4, and C5 for a page, a page whose item is not a record, and a planted list |
| Y5 | The label is taken from the whole record, before masking | C4 | 8: C4's three, C5's agent record, and four older tests that compare the agent's whole answer |
| Y6 | An agent with no clearance gets `confidential` | only a planted agent | **1**: the planted agent, as predicted |

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

**Y6, one test alone.** In `src/masking.ts`, make `clearanceOf` give an agent with no
clearance `confidential`:

```text
 FAIL  test/masking.test.ts > C2: each agent's clearance > DSOR-CLS-02a: an agent with no clearance written down is treated as public, the lowest

Expected: "public"
Received: "confidential"
```

Both agents in the table have a clearance written down, so no call through the pipeline
can see this break. The learner's prediction for Y6, "only a planted agent", is why that
test exists: it was added to the design before any code.

**Y1 was expected to be caught only by C6.** It is caught by 26 tests. C2 moved every
older test that reads money to a person, because an agent no longer gets money. So each
of those tests now guards the person's side too.

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
  `pipeline.ts` (215), `postgres.ts` (298), `main.ts` (232), `registry.ts` (163), and
  `envelope.ts` (165). Splitting them is not this step's idea.

_The review's findings are written here when the reviewers report._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-CLS-01 | A field with no declared classification is `CONFIDENTIAL` | [§19.1 Risk and data classification](../../../specs/dsor/02-security.md#191-risk-and-data-classification) | `test/unlabelled.test.ts`: a field or a kind the file does not name (C1). The planted field: left out of the agent's answer (`test/masking.test.ts`), listed (`test/redactions.test.ts`), and a person's answer made `confidential` (`test/answer-label.test.ts`) |
| DSOR-CLS-02a | For agents, fields above their clearance are withheld before the response leaves | [§19.2 The model boundary](../../../specs/dsor/02-security.md#192-the-model-boundary) | `test/masking.test.ts` and `test/masking.db.test.ts`: both agents' `invoice.get` and `invoice.list`, each clearance, the agent with none, masking before the 64 KiB check, and what is not a record (C2). The clearance half only: the egress policy is not built (decision 6) |
| DSOR-CLS-02b | A response with withheld fields lists the redactions | [§19.2 The model boundary](../../../specs/dsor/02-security.md#192-the-model-boundary) | `test/redactions.test.ts`: each field once, as a path, in the result envelope's shape, and no list when nothing was left out (C3) |
| DSOR-CLS-03 | Every query response carries the highest classification among its fields | [§19.2 The model boundary](../../../specs/dsor/02-security.md#192-the-model-boundary) | `test/answer-label.test.ts`: `internal` for the agent, `confidential` for a person, `public` for an empty page, `restricted` when one field is (C4) |
| DSOR-CLS-05 | Reads of `CONFIDENTIAL` or `RESTRICTED` data are audited with who, what, and how many | [§19.2 The model boundary](../../../specs/dsor/02-security.md#192-the-model-boundary) | `test/read-record.test.ts` and `test/read-record.db.test.ts`: the URIs, the row count, and the label of every read that returns data, nothing for a refusal, and no value read (C5). The actor chain is the caller alone until step 18 |

Also advanced, first met in earlier steps: DSOR-AUD-05a, a record holds URIs, a count,
and a label, never a value read (`test/read-record.test.ts`). DSOR-EXE-02, the record of a
read, written before the answer, as every record since step 08. DSOR-TEN-02b, a planted
list whose items have no company is now refused by DSoR itself
(`test/cross-tenant-lists.test.ts`).

## Next

Step 15 · Freshness labels: every answer says how old the data behind it is.
