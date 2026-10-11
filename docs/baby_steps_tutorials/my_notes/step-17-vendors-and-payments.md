# Step 17 · Vendors and payments

Folder: [`my_17_vendors_and_payments`](../my_17_vendors_and_payments/README.md) · 608 tests,
plus 51 in the database tier
Spec: [§24](../../../specs/dsor/03-execution.md#24-execution-semantics) · `DSOR-EXE-05a`,
`DSOR-EXE-05b`, `DSOR-EXE-05c`
The database tier, 51 tests, passes on a local PostgreSQL 17 set up like Neon, twelve migrations
applied, on the final code; on Neon, `dsor_step17` waits for this folder's `.env`. Decisions [125 and 126](decisions.md).

## What the step is

Every command says, in its contract and on every receipt, whether its effect can be undone. The
first command that can be, `payment.create`, makes a draft payment for one of the company's invoices,
to that invoice's vendor; `payment.cancel` takes it back, and is named in `payment.create`'s contract
as what undoes it. Vendors and payments are two new record types, beside the invoices, under the same
two locks.

## How it was built

Built on the learner's standing instruction while they slept: the problem stated first, and every
decision taken with the recommended option ([decision 125](decisions.md)), each open to reversal.

Then the copy, its markers made plain, and the pieces, each red first, committed alone, and broken
on purpose:

1. **The tables.** Migrations 009 to 011, split like 003 to 005; start-up's four tenant tables in
   one list; the story put back, for both tiers, from one list of statements.
2. **The rights.** Start-up refuses an application that may change a vendor, or more of a payment
   than its status.
3. **The commands.** `payment.create` and `payment.cancel`, the amount check, an address reader
   that takes the entity it needs, the cross-tenant suite reading payments, and the demo.
4. **The semantics at the door**, from the contract, on every receipt; and an undo that must exist.
5. **Two comments** that promised step 17 a `PENDING_APPROVAL` receipt name step 27.

Pieces 3 and 4 were written in one working tree and committed apart: the mixed files were derived
for piece 3 by removing exactly piece 4's lines, staged, tested in a copy, committed, and the final
files put back. Each commit was tested as staged, in a copy, on the whole suite.

## What the build found

**A foreign key changes the order of a reset.** `resetInvoices` deleted every invoice and ran 004
again. With PAY-901 pointing at INV-1008 that delete fails, so the payments go first and come back
after, and the next number starts again. Three places did the reset, and one list does it now.

**Step 16's own refusal, with three tables in one schema.** The schema-owner refusal named `public`
once for each tenant table in it, three times once the vendors and payments joined. It says each
schema once.

**A grant of every invoice column passed step 10's check.** It asked `has_table_privilege` for
INSERT, which is false for a grant that names columns. Found writing the same check for payments; it
asks `has_any_column_privilege` now, with a test of its own.

**The address reader guessed.** It read the entity an address must name from the operation's name:
right for every operation, until `payment.create` took an invoice's address.

**A question that meant nothing.** The cross-tenant suite asked, of every command, that the other
company's row be in the same state as yours. For `payment.create` that is INV-1008, issued in
org_456 and a draft in org_789, and a careless `payment.create` would not change the invoice at all:
it would add a payment, which the suite's "rows untouched" sees. The question is asked of commands
that change a row.

**A durability test that asked for too little to stay true.** It said a second run of the demo holds
no `COMMITTED` line at all, meaning the invoice was not issued twice. The agent's payment is
committed on every run, so it looks for the invoice's own line now.

**Three handlers guessed the semantics.** Each said `?? "atomic"`. They read the contract now, before
they change anything, and the door writes the contract's value on the receipt whatever they say.

**The guard read two new comments as schema markers**, because they said "copied from". Reworded.

## Limits, stated

- A retried `payment.create` makes a second payment, until step 20.
- No preconditions: a payment's amount is not compared with what the invoice owes, and the invoice
  need not be issued nor the vendor approved, until step 32.
- No `payment.get`: the demo's report of the payments is the program's own read, not an operation.
- A cancelled payment stays cancelled because `payment.cancel` changes only drafts; the
  application's UPDATE right on `status` could set one back, until step 22's states.
- A handler that throws leaves the door as a thrown error, as it has since step 03;
  `OUTCOME_UNKNOWN` is step 37's.
- A payment is in its invoice's currency; converting is step 26's.
- Migration 008 keeps its "NEW IN STEP 16" marker, because an applied migration is never edited.

## The hostile review

One reviewer, read-only, with probes in its own copy. It found company isolation holding in every
layer, the door writing the contract's semantics on every receipt, and `payment.cancel` ordinary in
every respect. It found eight problems, each reproduced, and all eight were fixed on the learner's
standing instruction, with the recommended option, as [decision 126](decisions.md), each red first
where there was a red to see and each in a commit of its own:

- **An undo promised and none named.** The schema takes `compensated_by: []`, and so did the
  registry; it also took a name listed twice and an operation named as its own undo.
- **A comment about a key that the key did not keep.** Migration 009 said the database refused a
  payment for one vendor against another's invoice. Its keys tied each to the company and not to
  each other, and VENDOR-77 was written against INV-1008. The key names the vendor now, and an
  invoice must name a vendor its company has.
- **The payment numbers were the application's to choose** with one stray grant on the sequence,
  and start-up said nothing; and rights one `SET ROLE` away on the business's tables passed, since
  step 10 for the invoices.
- **A command that answered like a query left without its semantics.**
- **A payment in EUR for a USD invoice**, and in `ZZZ`, which is no currency.
- **A nested amount read twice**, so a value that answered differently hashed one amount and paid
  another; and a comment that said nothing read the caller's object again.
- **My own exemption in the cross-tenant suite**, decision 125's ninth choice, which the review called
  step 12's hollow pass waiting for a precondition. It is reversed: the question is asked of every
  command, and `payment.create`'s example names INV-1009, a draft in both companies.
- **Tests that did not exist** for loosening the new tables' lock, and smaller untruths in a test
  header, a test title, a doc comment's place, and "stays cancelled".

One was written down instead: a handler that throws, which step 37's `OUTCOME_UNKNOWN` answers.

Seven of the fixes were broken once each, in a copy, on the whole suite, with the prediction written
first ([decision 126](decisions.md) has the table). Six failed exactly as predicted. The seventh, the
handler reading the caller's object again, failed three tests instead of one: the break also spread
the caller's arguments a second time, and two older tests count those reads. A break should change
one thing, and that one changed two. The README's ten breaks were measured twice, and the two runs
agreed.
