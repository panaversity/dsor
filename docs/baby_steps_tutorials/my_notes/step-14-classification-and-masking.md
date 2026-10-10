# Step 14 · Classification and masking

Folder: [`my_14_classification_and_masking`](../my_14_classification_and_masking/README.md) · 512
tests, plus 39 in the database tier
Spec: [§19](../../../specs/dsor/02-security.md#19-classification-and-read-side-governance) ·
`DSOR-CLS-01`, `DSOR-CLS-02a`, `DSOR-CLS-02b`, `DSOR-CLS-03`, `DSOR-CLS-05`
Both tiers have run: 512 under `pnpm check`, and 39 under `pnpm test:db` against Neon, the step's
own database `dsor_step14`, seven migrations applied, two new. Decisions [105 to 119](decisions.md).

## What the step is

Every field has a label — the invoice's are the specification's own example, the amount
`confidential` and the rest `internal` — and a field with no label is confidential. The agent is
cleared for `internal`. After any handler runs and before the answer leaves, the door takes out
every field above the agent's clearance, lists what it took, and labels the answer with the highest
label among what is left. A read that handed out confidential data is written down as a second
audit record, after the decision that allowed it, with every address returned and the row count,
before the answer leaves.

## How it was built

The problem first, on step 13's running demo: the supervisor's and the agent's reads of INV-1008
print the same line, `31400.00 USD`, and the agent's line goes to a model provider. Three
decisions, one at a time ([decision 105](decisions.md)): one file for all labels; a field above the
clearance is left out and listed; agents only are filtered.

Four pieces, each red first, committed, broken on purpose:

1. **The labels and the clearance** — `classification.ts`: the four labels in order, the table,
   `labelOf` with its confidential default, `isAbove`, `highestOf`, `clearanceOf`; the agent's
   clearance in `people.ts`.
2. **The filter at the door** — `boundary.ts`: `leaveTheDoor` for one invoice, a page, and a
   command's receipt; `HandlerAnswer` (the whole row) split from `OperationAnswer` (what leaves);
   the door filters before it measures the ceiling.
3. **The record of a read** — `recordTheRead` in `operations.ts`, `resources` and `extensions`
   through `audit.ts`'s hash, INSERT and read-back, migration 006, and if the record cannot be
   written the rows do not leave. Three tests on Neon. The count went under `extensions`, and
   decision 109 moved it to the schema's own `row_count`, with migration 007 (below).
4. **The demo** — the two lines that are no longer the same, and `read` lines in the printed log.

## What the build found

**A column-level grant does not grow with the table.** Step 09's `GRANT INSERT` on the log names
its columns one by one, so that the application can never write `recorded_at`. Migration 006's
first version added the two columns and stopped; every INSERT into the log — decisions included —
was then refused with `permission denied for table audit`, and the symptom was a program that
could not carry out any request. The `GRANT INSERT (resources, extensions)` is the lesson, and the
three real-server tests pin INSERT yes, UPDATE no, `recorded_at` still unreachable.

**The record of a read has to be a second record**, which step 13's critic had already said: the
decision is written before the handler runs and the log is never amended, so what the read
returned cannot be added to the decision. The trigger is what *left*: the agent's read of INV-1008
leaves as `internal` and is not written down twice; the supervisor's leaves as `confidential` and
is.

**Ten older tests counted one record per request.** A supervisor's allowed read is two now, and
each test says so — the decision is still first, and it is the one those tests are about. Three
tenancy tests that told the two companies' INV-1008 apart by the amount, as the agent, now tell
them apart by what the agent may see: `org_789`'s is a draft.

**The entity is read from the row's address.** `dsor://org_456/invoice/INV-1008` is an invoice,
so a row with no address belongs to no entity in the table and every field of it is confidential.
A fourth entity gets its labels by having an address, which every tenant-owned row has.

**A commit message with apostrophes hung the shell** for a minute and a half, waiting for a quote
that never closed; the message now travels in a file (`git commit -F`).

## Limits, stated

- The egress policy half of `DSOR-CLS-02a` is not built: a `restricted` field leaves for an agent
  cleared for `restricted`, with no policy asking about the provider.
- Tokens (`DSOR-CLS-02c`) and row budgets (`DSOR-CLS-04b`) are later steps; the actor chain in
  the record of a read is empty until step 18.
- A label is per field; a field whose value is an object is withheld whole or shown whole.
- Humans are not filtered. The labels are the tutorial's own, in a table in code, where the
  specification puts them in the entity schema (`DSOR-ENT-01b`).
- The record of a read lists every address returned: a page of a hundred is a record of a hundred
  addresses. When the store fails, the log holds an ALLOW for a request whose rows never left.

## The hostile review

Five passes ran: four reviewers from different angles and a mutation sweep of forty-five one-line
changes. All five graded B, none found a false claim, and the sweep killed forty of its
forty-five mutants. The sixth agent, the critic that reads the five reports and looks where none
of them looked, did not run — the month's spend limit stopped it — so this step has no critic
pass, where steps 11 to 13 had one. What the five found was enough for twelve commits' worth of
fixes.

What the first build could not see, each now pinned by a test shown failing under the review's own
mutant:

- **A page was filtered row by row only by accident.** The one page test had two rows of the same
  shape, so a mutant that filtered the first row and applied its result to all the others passed.
  There are now three rows of three different shapes, and each is filtered on its own.
- **A row with no address, and a row whose address does not parse.** Both fall back to "no entity
  in the table", which makes every field confidential — the guarantee that the lock stays locked
  when the paperwork is missing. No test knew: a mutant that labelled every row an invoice stayed
  green. Now the agent gets an empty invoice and a list of every field.
- **The human's answer was never pinned whole.** A mutant that made humans silently lose `vendor`
  failed only three byte-size tests in another file. The supervisor's invoice is now asserted
  field for field, and every row of the supervisor's page by its field count.
- **The fourth label never reached the door.** `restricted` existed only in the unit tests of the
  ordering functions, so a mutant that stopped auditing restricted reads passed. `bank_account` is
  labelled `restricted` in the table now, before any column holds one, and a read that hands one
  out is written down.
- **The ceiling is measured on what leaves.** Step 13's byte ceiling runs after this step's
  filter, which a comment claimed and no test knew: a page of three rows that is ninety kilobytes
  only because of its amounts leaves for the agent and is refused for the supervisor.
- **The receipt the door rebuilds is validated again.** Turning that check off stayed green; an
  envelope carrying a field the schema has no room for now throws.
- **The cursor of a page whose rows lost their addresses.** `uri` was listed as withheld while
  `next` carried the same address beside it. The cursor goes with the addresses now, and is
  listed.
- **A confidential row with no address** left as the store's failure, `EVIDENCE_STORE_UNAVAILABLE`
  with a retry class that said "safe to send again", because `resources: [undefined]` is what
  failed to be written. It is the program's own error now, never to retry.
- **A store that is down for the look-back too.** The first fault test drops one INSERT and lets
  the lost-reply recovery find nothing; a second one drops the recovery's SELECT as well.
- **An empty page** is labelled `public` and written down nowhere, which was true and undecided.
  Both are pinned, and the README says why.

Then the critic ran — the agent the spend limit had stopped — and three verifiers confirmed its
top three findings on a clean copy. It found what the five had not, and four more fixes followed.
**A label describes a value it can see the whole of**: a `vendor` whose value was an object walked
out of the agent's answer with an amount inside it, and so did a value with its own `toJSON`. A
value with parts inside is confidential now, whatever its field is called, which is `DSOR-CLS-01`
one level down and closes the hole rather than documenting it. **An answer the door cannot filter**
— no row, or a row that is not a row — threw a raw `TypeError` after the decision was recorded and,
for a command, after the side effect; it is the program's own error now, retry never. **A receipt
that carries no data** made the door throw: the field is optional in the schema and step 17's first
`PENDING_APPROVAL` receipt will have none, so such a receipt leaves as it came, with no label and
no list. And **the citation was wrong**: the entity schema with a classification on every field is
§6 of the model, not §4, and the labels are modelled on it rather than copied from it. The critic
also measured the demo's withheld note at 135 columns, wrapping away from its row on a default
Windows console; it is a line of its own now.

The critic's one finding that is recorded rather than fixed: five different endings leave exactly
one `ALLOW` record and nothing else — an agent's answered read, a bad `limit`, an answer over the
ceiling, a row with no address, and the evidence store failing — so the log cannot tell a read that
was answered from one refused after the decision. A verifier reproduced all five. Decided in
[decision 108](decisions.md) and deliberately not built here: `DSOR-AUD-01` asks for a record of
every command decision, every proposal transition and every `DSOR-CLS-05` read, and this step
writes all of those that exist, so nothing is missing against the rules; "and then what happened"
lives in a proposal's final outcome, two stages away; and the ending where the evidence store
fails cannot be recorded by anything, so no fourth kind of record would close all five.

What was left, and written into the README as what the step does not do: an error answer is neither filtered nor labelled,
so an error message must never carry a field's value; `before the answer leaves` is the order of
two statements in `makeDoor`, held by the fault test and not by a stage; a principal of type
`application` or `system` is treated like a human; the step 12 suite's canaries only work because
its caller is a human, which its header now says; and the specification's own example clears this
agent for `confidential` and withholds the amount through an egress policy this step does not
build, so the step lowers the clearance instead and says so.

## After the step: the row count (decision 109, 2026-10-09)

A read of the whole repository found that the record of a read kept its count under `extensions`,
while `audit-record.schema.json` has a field for it, `row_count`. A comment in `audit.ts` had said
the schema had none. The learner chose to move it, and it moved in three commits: the decision;
migration 007, which adds the column and its `GRANT`; and the move itself, red first.

- The tests changed and did not grow: 504 under `pnpm check`, and 39 under `pnpm test:db` on
  Neon, with 007 applied.
- Broken on purpose: no count written, 3 failed; `theLog` not reading `row_count` back, 7,
  because the count is inside the hash; 007 without its `GRANT`, 185, because every INSERT names
  the column.
- The README's fifteen breaks, measured again: all fifteen the same. A first pass on a slow machine
  gave five wrong numbers, with tests skipped, and was thrown away.

## After the step: money, and names the table only inherits (decisions 110 and 111, 2026-10-10)

Two ways a value still reached the agent, both found while finishing the row count, and both shown
with a run before anything was fixed. The learner chose to close both, each in commits of its own.

- **Money was trusted by its shape** (decision 110). Decision 107 let money, `{ value, currency }`,
  keep its field's label wherever it was. A handler that put the amount in `vendor` sent it to the
  agent, labelled `internal`, and the list of what was withheld was empty. Now money keeps its
  field's label only in a field declared to hold money, which today is `invoice.amount`. Anywhere
  else it is a value with parts inside, so it is at least confidential.
- **The label table answered names it only inherits** (decision 111). The table is a JavaScript
  object, and every object inherits `toString`. `labelOf("invoice", "toString")` returned a
  function, which is no label, so it was never above a clearance: fields named `toString` and
  `valueOf` left for the agent with the amount in them. `labelOf` asks for the table's own names
  now, as `permissionsOf` has since decision 36.
- Two new tests: 506 under `pnpm check`, and 39 under `pnpm test:db` on Neon, unchanged.
- Break 13 had been measuring another guard. The function it breaks also told the door what a row
  is, so all 65 of its failures were the door refusing every row, the three tests about the label
  among them. Those are two functions now, and Break 13 fails 4, all about the label.
- The README's fifteen breaks, measured twice after both decisions, the two runs agreeing.
- A hostile review of the two found no new way past the filter through a row. It found two parts
  of an answer the filter never looks at, `askedBy` and a page's `next`, a gap from the step's
  first build; two guards no test pins; and sentences in the comments, the notes and the README
  that said more than was measured. The sentences are corrected, and the rest is decisions 112 to
  114, below.

## After the step: the parts of an answer that are not rows (decisions 112 to 119, 2026-10-10)

The door filtered every field of every row, and took the rest of the answer from the handler as it
was. The learner chose to close that where it can be closed, to give the guards no test pinned a
test each, and to write down what is left. Two hostile reviews ran, one after each round of fixes.

- **Who asked, and a page's cursor** (decision 112). A handler that put the row in `askedBy`, or in
  a page's `next`, sent the amount to the agent, with `amount` listed as withheld beside it. Now
  the door writes who asked itself, on every way out. A page whose cursor is not its last row's
  address is refused as the program's own error.
- **Read once** (decision 116). The second review found the cursor checked on one read and copied
  on another: a getter got the row out. And the record of a read took the rows from the handler a
  second time: handed INV-1008, it wrote down INV-1009. Now `copyOnce` reads a handler's answer
  once, and the check, the filter, the ceiling and the record all work from that copy.
- **Receipts from their closed parts** (decision 117). A receipt's envelope was copied whole, with
  two parts that take anything, and one with no data was not checked at all. Now it is built from
  the parts its schema closes and always checked. Unlike an error, a receipt has no part that takes
  anything, so this closes the way a row got out. Its free text is in `correlation`, the open
  question 50 channel. A receipt that waits for an approval cannot leave until step 17 brings
  `requires` back through the filter.
- **Two guards no test pinned** (decision 113). The money rule is `labelOfValue` now, tested with a
  money field labelled `internal`. Deleting the rule used to fail nothing. The door's row check is
  tested with money, as the agent too. Asked only as the supervisor, the test stayed green with the
  row check broken, because a second guard refuses that read anyway. Three more cases came from
  the second review (decision 118): a cursor that only looks like the address, a cursor on an empty
  page, and a page whose rows are not rows.
- **Written down, not fixed.** Two checks that fail open in cases nothing here can reach (decision
  114). And an error's envelope, which the door passes on unread: a row under `items` or
  `extensions`, both open in the error schema, reaches the agent, and the message is free text
  anyway, so the rule for handlers stays (decision 115).
- **Where the hunt stopped** (decision 119). The third review found four more ways past the door,
  and every one needs code written on purpose to trick it: a list that lies about its own methods,
  a part that changes its answer between reads, a hidden function in a receipt, a function dressed
  as a row. Code like that could write the amount as text into a field anyway, which no filter can
  see. So the door is built against careless handlers, and the four are written down. The reviews
  had been told to assume the handler was trying to get the amount out, a stronger threat than
  this step is about, and that is why each round found more.
- Six new tests: 512.
