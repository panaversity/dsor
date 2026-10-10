# Step 14 · Classification and masking

**New in this step:** every field has a label that says how sensitive it is, the agent has a
clearance, and a field above it is taken out of the answer before the answer leaves — and listed,
so the agent knows it exists.

## In plain words

Writes get the attention, but most real incidents are reads: data ends up somewhere it should
not. Whatever this program hands the agent is, in practice, sent to a model provider's servers,
outside the company. So the question "may this field leave?" has to be asked before the answer
leaves, for every field, every time — and nothing in step 13 asked it.

Four things make it asked here:

- **Every field has a label**, one of `public`, `internal`, `confidential`, `restricted`, in one
  file: `src/classification.ts`. The amount is `confidential` and the id, the vendor and the
  status are `internal`, as in the specification's own example
  ([§6](../../../specs/dsor/01-model.md#6-business-entities-and-the-canonical-model)); the two
  fields that name the row are `internal` too, which is this tutorial's label; and a bank account
  is `restricted` before any column holds one, because the label comes with the design. A field
  that is not in the table is `confidential` (`DSOR-CLS-01`). That is the rule and not a
  convenience: the day someone adds a `notes` field to an invoice and forgets to label it, the
  agent does not see it.
- **The agent has a clearance**, `internal`, written beside it in `src/people.ts`. An agent nobody
  cleared reads `public` fields only — the lock stays locked when the paperwork is missing. The
  two people have no clearance and are not filtered: a human reads on a screen, and the role
  already decides what a human may do (`DSOR-CLS-02a` is written for agent principals). The
  specification's example clears this agent for `confidential` and withholds the amount through
  the tenant's egress policy instead; this step has no egress policy, so it sets the clearance
  one step lower and the same field stays in.
- **The door takes out what is above the clearance, and says so.** After any handler runs, and
  before the answer leaves, `src/boundary.ts` walks every field of every row. A field above the
  agent's clearance is left out — not masked with a placeholder, left out; the map says "masked"
  for the family, and omission is one of the rule's three treatments — and listed in the
  answer's `redactions`: `amount`, because of `clearance`, `omitted` (`DSOR-CLS-02b`). Every answer
  then carries a `classification`: the highest label among the fields it still holds
  (`DSOR-CLS-03`). The supervisor's invoice is `confidential`; the agent's, without its amount, is
  `internal`. A page lists each withheld field once. A command's receipt is filtered the same way.
- **A read that handed out confidential data is written down.** A second audit record,
  `classified_read`, right after the decision that allowed it: who, the operation, every address
  returned, and how many (`DSOR-CLS-05`). A second record, because the decision was recorded
  before the handler ran (step 08) and the log can never be amended (step 09). It is written
  before the answer leaves, and if it cannot be written the rows do not leave: a read nobody wrote
  down did not happen.

The entity a row belongs to is read from the row's own address: `dsor://org_456/invoice/INV-1008`
is an invoice, so its fields are looked up under `invoice`. A row with no address belongs to no
entity in the table, and every field of it is confidential: the agent gets an empty invoice and a
list of everything. The label of an answer with nothing left in it is `public` — the label says
what is there, and the list is the only sign of what is not. A page's `next` cursor is a row's
address too, and goes with the rows' addresses.

## Why it matters

Step 13's demo, its first two lines. The supervisor reads INV-1008; then the agent reads it:

```text
user_123              (no envelope)   dsor://org_456/invoice/INV-1008  31400.00 USD  issued
accounts-payable-fte  (no envelope)   dsor://org_456/invoice/INV-1008  31400.00 USD  issued
```

The same line. The agent's copy of that line goes to a model provider, and so does the amount —
and with step 13's `invoice.list`, a hundred amounts a page. No attack was needed. Nothing in the
program knew which field was sensitive, because no field carried a label; and by `DSOR-CLS-01`
every unlabelled field is confidential, so all of it left.

## What changed since step 13

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_13_bounded_queries ../my_14_classification_and_masking
```

| File | What |
| --- | --- |
| `src/classification.ts` | new — the four labels in order, the table of every entity's labels, `labelOf` (no label means confidential, and a name the table only inherits has no label: decision 111), the fields declared to hold money and `holdsMoney` (decision 110), `isAbove`, `highestOf`, `clearanceOf` |
| `src/boundary.ts` | new — the model boundary: `leaveTheDoor` filters a row by the caller's clearance, labels the answer, and lists what it took out, for one invoice, a page, and a command's receipt. Money is one value only in a field declared to hold money (decision 110) |
| `src/people.ts` | a principal may carry a `clearance`; the agent's is `internal` |
| `src/operations.ts` | `HandlerAnswer` (what a handler hands the door, the whole row) and `OperationAnswer` (what leaves, labelled); the door calls `leaveTheDoor` before the ceiling; `recordTheRead` writes the record of a confidential read, before the answer leaves |
| `src/audit.ts` | a record may carry `resources` and `row_count`, hashed, inserted, read back |
| `src/envelopes.ts` | a result envelope may carry `classification` and `redactions` — the schema always had the two fields |
| `migrations/006_classified_reads.sql` | new — two columns, `resources` and `extensions`, and a `GRANT INSERT` on exactly those two. Since decision 109 nothing writes `extensions` |
| `migrations/007_read_row_count.sql` | new — `row_count`, the field the schema has for a read's row count, and a `GRANT INSERT` on it (decision 109) |
| `src/main.ts` | the two lines that are no longer the same; a page says its label; the printed log shows a read as `read` with its row count |
| `test/classification.test.ts` | new — seven tests: the table and the one field declared to hold money, the default (inherited names included), the order, the clearance, the restricted label |
| `test/model-boundary.test.ts` | new — twenty-one tests: one invoice, a page, a receipt, a field nobody labelled, a field named like something every object inherits, a row with no address, a restricted field, a page of rows that do not look alike, an empty page, the cursor, the ceiling measured on what leaves, a receipt that does not validate, a value with parts inside, an amount that is one value, money in a field that is not a money field, and an answer the door cannot filter |
| `test/classified-reads.test.ts` | new — eight tests: the record after the decision, a page's record, a restricted read's record, the agent's read and an empty page leaving none, a row with no address refused, and two connections that drop the record's INSERT |
| `test/classified-reads.db.test.ts` | new — three tests on a real server: the record in the real table, and the three new columns writable and not changeable |
| `test/main.test.ts` | the two lines pinned whole; a `read` line pinned; every record count moves — five reads in a run |
| ten older tests | `decision-first`, `audit-lost-reply`, `pipeline`, `invoices-in-postgres`, `cross-tenant-suite-itself`, `bounded-queries`: one record per request became two for a supervisor's read; three tenancy tests that read the agent's amount now read what the agent may see |
| everything else | a `NEW IN STEP 13` marker becoming `STEP 13` |

468 tests became 506, and the database tier's 36 became 39.

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step is the first two lines:

```text
user_123              (confidential)           dsor://org_456/invoice/INV-1008  31400.00 USD  issued
accounts-payable-fte  (internal)               dsor://org_456/invoice/INV-1008  (amount withheld)  issued  withheld: amount (clearance)
```

The supervisor sees the value and the label `confidential`. The agent sees the invoice without its
amount, the label `internal` — the highest label among what is left — and what was withheld and
why. Further down, the agent's receipt for issuing INV-1009 says `withheld: amount (clearance)`
too, and each page says its label.

And the log at the end has a new kind of line. Where step 13 printed `ALLOW` for the supervisor's
read and nothing more, there is now a record of the read itself, with its row count:

```text
 0  ALLOW  invoice.get@1        user_123               ALLOWED                 sha256:...
 1  read   invoice.get@1        user_123               READ, 1 row             sha256:...
 2  ALLOW  invoice.get@1        accounts-payable-fte   ALLOWED                 sha256:...
```

The agent's read on line 2 has no `read` after it: what left was `internal`, and the rule is about
reads that return confidential data. Five reads in a run are written down — the supervisor's and
the CFO's reads of one invoice, and the three pages — so `org_456: 21 records` became `26` on a
fresh run and `52` on the second. `org_789` stays at `2` and `4`.

### The database tier

`pnpm check` needs no server. The thirty-nine tests in `pnpm test:db` — step 13's thirty-six and
three for the record of a read — need two real logins and a database of this step's own. Copy
step 13's `.env` and change the database name in both URLs:

```bash
cp ../my_13_bounded_queries/.env .env     # then dsor_step13 -> dsor_step14 in both lines
pnpm migrate && pnpm test:db
```

`pnpm migrate` applies `006_classified_reads.sql` and `007_read_row_count.sql`. 006 is two
`ADD COLUMN`s and one `GRANT`, and the grant is the lesson: step 09's `GRANT INSERT` on the log
names its columns one by one, so that the application can never write `recorded_at`, and a
column-level grant does not grow with the table. The first version of the migration stopped at the
`ALTER`, and every INSERT — decisions included — was refused with `permission denied for table
audit`. 007 adds `row_count`, the field `audit-record.schema.json` has for a read's row count. 006
missed it and put the count under `extensions` (decision 109). 007 needs its own `GRANT`, for the
same reason. The three real-server tests pin both: `has_column_privilege` says INSERT yes and UPDATE
no for the three new columns, and `recorded_at` is still unreachable. This folder's own run was on
Neon: `36 passed` before the step, `39 passed` after it, and `39 passed` again after 007.

## Break it

Fifteen, each measured on the full suite with the files one at a time. Decisions 110 and 111 added
two tests and changed what Break 13 breaks, so all fifteen were measured again, twice, after both,
and the two runs agreed. The counts are from a copy outside the repository, where one test
skips because the specification is not beside it, so the total reads `506` with `1 skipped`; in
the repository it is `506 passed`.

### Break 1 · the agent is not filtered

In `src/boundary.ts`, in `filterRow`, make `filtered` always `false`.

```text
 Tests  28 failed | 477 passed | 1 skipped (506)
```

Every test that reads as the agent, and the demo's two lines: the amount is back.

### Break 2 · nothing is listed

In `redactionsFor`, map over an empty slice.

```text
 Tests  15 failed | 490 passed | 1 skipped (506)
```

The field is still gone — the agent would conclude the invoice has no amount, which is exactly
what the list exists to prevent.

### Break 3 · the label counts the fields that were taken out

In `filterRow`, push the label of a withheld field too.

```text
 Tests  18 failed | 487 passed | 1 skipped (506)
```

The agent's answer says `confidential` while holding nothing confidential: a label that lies high.

### Break 4 · no label means public

In `src/classification.ts`, make `labelOf` fall back to `"public"`.

```text
 Tests  5 failed | 500 passed | 1 skipped (506)
```

The one rule the table cannot enforce by itself. The careless handler's `notes` walks out, and so
do fields named `toString` and `valueOf`. So does every field of a row with no address, except its
amount: money outside a field declared to hold money is confidential anyway (decision 110).

### Break 5 · the agent loses its clearance

In `src/people.ts`, set the agent's `clearance` to `undefined`.

```text
 Tests  22 failed | 483 passed | 1 skipped (506)
```

The lock stays locked: an agent nobody cleared reads public fields only, and the invoice has none,
so the agent gets an empty invoice and a long list. Caught, because the tests say what the agent
may see, not only what it may not.

### Break 6 · the amount is labelled internal

In the table, make `amount` `"internal"`.

```text
 Tests  33 failed | 472 passed | 1 skipped (506)
```

Thirty-three, the third most of any break here: the amount leaves for the agent, and nothing is
confidential any more, so no read is written down either — the labels are what both halves of the
step hang on. It failed two until money became the one compound value a label describes, which is
what measuring twice is for.

### Break 7 · a human is filtered too

Make `filtered` always `true`.

```text
 Tests  44 failed | 461 passed | 1 skipped (506)
```

Forty-four: a human with no clearance reads public fields only, so every test that reads as a
person loses the row.

### Break 8 · the read is never written down

In `src/operations.ts`, in `recordTheRead`, return early for every answer.

```text
 Tests  17 failed | 488 passed | 1 skipped (506)
```

The eight tests of the record, and the older ones that now say a supervisor's read is two
records.

### Break 9 · the record names no rows

Replace `rows.map((row) => row.uri)` with `[]`.

```text
 Tests  2 failed | 503 passed | 1 skipped (506)
```

The record exists, verifies, and names nothing: the two tests that read `resources` see it.

### Break 10 · every read is written down, confidential or not

Delete the check on `leaving.classification`.

```text
 Tests  9 failed | 496 passed | 1 skipped (506)
```

The agent's reads are written down too, and every count in the demo's log moves.

### Break 11 · the store's failure is swallowed and the data leaves

In the `catch` of `recordTheRead`, return `undefined`.

```text
 Tests  2 failed | 503 passed | 1 skipped (506)
```

Two tests, the two with a connection that drops the record's INSERT: the rows left without a
record. Everything else is green, because everything else has a store that works.

### Break 12 · migration 006 forgets the GRANT

Delete the `GRANT INSERT (resources, extensions)` line.

```text
 Tests  187 failed | 318 passed | 1 skipped (506)
```

A hundred and eighty-seven, more than a third of the suite: a column-level grant does not grow
with the table, so every INSERT into the log is refused, and a decision that cannot be written
down is a request that is not carried out.

Migration 007's `GRANT INSERT (row_count)` teaches the same thing a second time. Delete that line
instead, and the count is the same 187, measured twice, though only the record of a read ever
holds a number in `row_count`. Every INSERT names the column, and sends a NULL when there is no
count. PostgreSQL wants the privilege for every column a statement names, whatever the value.

### Break 13 · the label can see inside a nested value

In `src/boundary.ts`, make `isPlain` return `true` for everything.

```text
 Tests  4 failed | 501 passed | 1 skipped (506)
```

Four tests, and in each one the amount hides in `vendor`: inside an object, behind its own
`toJSON`, in something that is nearly money, and as money itself in a field not declared to hold
money. `vendor` is `internal`, so each value takes that label and leaves for the agent with the
amount inside.

Before decision 110 this break failed sixty-five tests, and only three of them were about the
label. The door used the same function to tell a row from a value, so with it broken the door
refused every row it was handed. The door has its own question now, `isValue`, and this break
reaches the label alone.

### Break 14 · the door filters whatever it is handed

Make `unfilterable` always `undefined`.

```text
 Tests  1 failed | 504 passed | 1 skipped (506)
```

The crash comes back: a handler that answers with no row throws out of the door instead of being
refused, after the decision was recorded.

### Break 15 · a receipt with no data is filtered anyway

Delete the early return for a receipt whose `data` is absent.

```text
 Tests  1 failed | 504 passed | 1 skipped (506)
```

One test, and it is the shape step 17 will bring: filtering a receipt that has no data throws
instead of answering.

Restore each break and confirm `pnpm check` prints `506 passed` again.

## Build it yourself with Claude Code

Copy `my_13_bounded_queries` to a new folder and ask:

> Start step 14, classification and masking. Before any code: run step 13's demo and show me the
> supervisor's and the agent's reads of INV-1008 side by side, and say where the agent's line
> goes. Then ask me, one at a time, where the labels live, what the agent gets in place of a
> field above its clearance, and who is filtered. Then build it a piece at a time, red first —
> the labels, the filter at the door, the record of a read, the demo — and break each piece on
> purpose, including a connection that drops the record's INSERT.

## Check yourself

1. The agent asks for INV-1008. What does it get, and what does the answer say about what it did
   not get?
2. Why is a field with no label confidential, and which test would go green if it were public?
3. Why is the record of a read a second record, and not a row count added to the decision?
4. The supervisor's read of INV-1008 is written down. The agent's read of the same invoice is
   not. Why?
5. Migration 006 adds two columns. Why does it also need a `GRANT`, when step 09 already granted
   `INSERT` on the log?
6. A handler returns an invoice whose `vendor` is an object with an amount inside it. What does the
   agent get, and why is an amount — also an object — treated differently?

<details>
<summary>Answers</summary>

1. The invoice without its amount, labelled `internal`, and `redactions: [{ field: "amount",
   reason: "clearance", treatment: "omitted" }]`. The field is gone, not masked; the list is what
   tells the agent the amount exists and was withheld.
2. Because the rule says so (`DSOR-CLS-01`), and because the alternative fails the wrong way: a
   field someone forgot to label would leave. `DSOR-CLS-01: the agent does not see it, and it is
   listed` — a careless handler returns an invoice with a `bank_account` nobody labelled.
3. The decision record is written before the handler runs (`DSOR-EXE-02`), so it cannot know what
   the handler returned; and the log can never be amended (`DSOR-AUD-04a`), so it cannot be told
   afterwards. What the read returned has to be a record of its own.
4. The rule is about reads that *return* confidential or restricted data. The agent's answer left
   as `internal` — the confidential field was taken out before it left — so there is a decision
   and nothing more.
5. Step 09's grant names its columns one by one, so the application can never write
   `recorded_at`. A column-level grant does not grow with the table: without the new `GRANT`,
   every INSERT into the log was refused, decisions included.
6. Nothing of the vendor: a value with parts inside is confidential whatever its field is called,
   because a label cannot describe what it cannot see the whole of, and `vendor` is listed as
   withheld. An amount is the exception, and the only one: money is `{ value, currency }`, one
   value in this program's vocabulary and a declared type in the specification's entity schema. In
   a field declared to hold money, `amount`, its field's label governs it. Anywhere else, money is
   a value with parts too: a `vendor` that *is* `{ value: "31400.00", currency: "USD" }` is withheld
   as well (decision 110). Without the exception the table's `amount: confidential` would stop
   mattering, which is how the rule was measured — lowering it to `internal` changed nothing
   anywhere.

</details>

## The rules this step meets

- **[DSOR-CLS-01 · L1]** A field with no declared classification MUST be treated as
  `CONFIDENTIAL`. `labelOf` falls back to `confidential` for a field, or an entity, that is not in
  the table, and the door applies it to every field of every row a handler returns. "In the table"
  means among its own names: `toString`, which every JavaScript object inherits, is not in it
  (decision 111).
  ([§19.1](../../../specs/dsor/02-security.md#191-risk-and-data-classification))
- **[DSOR-CLS-02a · L1]** For agent principals, DSoR MUST omit, mask, or tokenize any field above
  the agent's clearance or barred by the tenant's model-egress policy before the response leaves
  DSoR. The clearance half: omitted, at the door, for one invoice, a page, and a receipt. The
  egress-policy half is not built — see below.
  ([§19.2](../../../specs/dsor/02-security.md#192-the-model-boundary))
- **[DSOR-CLS-02b · L1]** A response from which fields were withheld MUST list the redactions.
  `redactions` on every data answer, page, and receipt; empty for a human.
- **[DSOR-CLS-03 · L1]** Every query response MUST carry a classification label equal to the
  highest classification among the fields it contains. `classification` on every data answer and
  page, the highest among the fields that remain; a receipt carries one too.
- **[DSOR-CLS-05 · L1]** Reads that return `CONFIDENTIAL` or `RESTRICTED` data MUST be audited
  with principal, actor chain, operation, resource scope, and row count. A `classified_read`
  record after the decision: the principal, an actor chain that is empty because nobody acts on
  anyone's behalf until step 18, the operation, every address returned, and the row count.

**What this step leaves, said plainly.** The labels are the tutorial's own, taken from the
specification's example, and provisional; the specification puts them in the entity schema
(`DSOR-ENT-01b`), and this step puts them in a TypeScript table. The tenant's model-egress policy
is not built: a `restricted` field leaves for an agent cleared for `restricted`, with no policy
asking whether it may cross to an external provider. Tokens in place of masked values
(`DSOR-CLS-02c`) and row budgets (`DSOR-CLS-04b`) are later steps; the actor chain in the record
of a read is empty until step 18, and "resource scope" is read here as the list of addresses
returned. A human is not filtered at all, and a principal of type `application` or `system` is
treated like a human until a rule says otherwise. The labels live in a table in code, where the
specification puts them in the entity schema (`DSOR-ENT-01b`), so nothing ties a label to the type
it labels, except money: the fields that hold money are declared beside the labels (decision 110);
and an entity that is not in the table gives an agent nothing at all — an empty row,
labelled `public`, with every field listed — so the first payment row of a later step will arrive
blank rather than loudly. The record of a read lists every address returned, so a page of a hundred
is a record of a hundred addresses; it is written after the filter and before the answer leaves —
"before" being the order of two statements in `makeDoor`, held by the fault test and not by a
stage. An error answer is not filtered and carries no label: its message is free text, so a handler
must never put a field's value in one, which is a rule for handlers and not a filter. A label
describes a field, not the text in it: an amount a handler writes as text into an `internal` field,
`vendor: "31400.00 USD"`, leaves for the agent with nothing listed (open question 50). Two parts of
an answer are never looked at by the filter: `askedBy`, which says who asked, and a page's `next`,
its cursor, which is held back only when the rows' addresses are. A handler that put a row in
either would send it whole, with `amount` listed as withheld beside it. The review of decisions 110
and 111 found this, and it is not yet decided. And a bad
`limit` still leaves an ALLOW record, as it did in step 13, because the validate stage does not
read a contract's input schema yet.

**The one thing the log still cannot tell you.** Five different endings leave exactly one `ALLOW` /
`ALLOWED` record and nothing else: an agent's answered read, a bad `limit`, an answer over step 13's
ceiling, a row with no address, and the evidence store failing. Only a read that actually handed
out confidential data writes a second record. So "ALLOWED, and nothing after it" means either "the
caller got internal data" or "the caller got nothing and an error", and the log does not say which.
Measured against the rules, nothing is missing: `DSOR-AUD-01` asks for a record of every command
decision, every proposal transition, and every read covered by `DSOR-CLS-05`, and this step writes
all of those that exist today. What is missing is an answer to "and then what happened", and the
specification keeps that somewhere else — in a proposal's final outcome
(`DSOR-EXE-04a`), which arrives with the control-plane store and the outcome of a command, not in
another append to the log. One of the five endings is the evidence store failing, and a store that
cannot take the record of a read cannot take a record of the refusal either, so no fourth kind of
record would close all five. Decision 108 in the notes says this at length.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-CLS-02c` | A token in place of a masked value, usable only by the principal it was issued to. Nothing is tokenized; fields are omitted. L2. |
| `DSOR-CLS-04b` | Row budgets per agent over a time window. A later step. |
| `DSOR-ENT-01b` | Each entity schema declares the classification of every field. The labels are in a table in code, not in an entity schema; the entity schema arrives with the entity registry. |
| `DSOR-AUD-05a` | Classification-aware renderings in audit records, not raw copies of `RESTRICTED` values. The record of a read holds addresses and a count, never a value — true, and not claimed until a `RESTRICTED` field exists to test it with. |

Everything earlier steps claimed still holds. Step 12's suite asks its six questions of three
operations whose answers are now labelled, and `main.test.ts`'s record counts moved by five.

**Next:** step 15, `freshness_labels` — every answer says how old its data is, and a cached value
is never labelled `CURRENT`.
