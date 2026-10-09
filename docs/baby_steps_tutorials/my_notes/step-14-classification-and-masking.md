# Step 14 · Classification and masking

Folder: [`my_14_classification_and_masking`](../my_14_classification_and_masking/README.md) · 504
tests, plus 39 in the database tier
Spec: [§19](../../../specs/dsor/02-security.md#19-classification-and-read-side-governance) ·
`DSOR-CLS-01`, `DSOR-CLS-02a`, `DSOR-CLS-02b`, `DSOR-CLS-03`, `DSOR-CLS-05`
Both tiers have run: 504 under `pnpm check`, and 39 under `pnpm test:db` against Neon, the step's
own database `dsor_step14`, six migrations applied, one new. Decisions [105 to 108](decisions.md).

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
   written the rows do not leave. Three tests on Neon.
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
