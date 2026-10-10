# Step 17 · Vendors and payments

**New in this step:** every command says whether its effect can be undone, and the first one that
can be, `payment.create`, makes a draft payment that `payment.cancel` takes back.

## In plain words

Some mistakes can be put right and some cannot. A draft payment can be cancelled. A payment the bank
has already sent cannot. An agent that works at night, and the person who supervises it, need to
know which kind of command they are about to run *before* they run it. So every command now carries
a label that answers one question: can this be undone?

The label is called the command's *execution semantics*, and it has five possible values. This step
uses two of them:

- **`atomic`**: the command commits in one transaction, or not at all. `invoice.issue` and
  `payment.cancel` are atomic.
- **`compensatable`**: the command can be undone by another operation, which its contract names.
  `payment.create` is compensatable, and `payment.cancel` is what undoes it.

The others are `saga` (several steps, each with its own undo), `best_effort` (no promise, only a
report of what happened) and `non_compensatable` (cannot be undone at all). They arrive with the
commands that need them: the first `non_compensatable` command, `payment.execute`, sends money.

Three things make the label mean something:

- **The contract declares it.** Each command's contract, its machine-readable spec sheet, has an
  `execution` section. The specification's schema refuses a command without one, and refuses a
  `compensatable` one that does not name what undoes it.
- **The door writes it on every receipt, from the contract.** Whatever the code that ran the command
  wrote, the receipt the caller gets says what the contract says. A careless handler that began as
  a copy of another command cannot repeat that command's promise. And a command must answer with a
  receipt: one that answers like a query, with a row and no semantics, is refused.
- **What undoes a command is a real command.** The program refuses to start if a contract names an
  undo it does not have, names a query, names nothing, names the same undo twice, or names itself. And the undo runs through the same door as everything
  else: its own permission, its own decision in the log.

To have something to undo, this step adds two record types, the vendors a company pays and the
payments it makes. They live beside the invoices, under the same two locks: every key starts with
the company, and the second lock hides another company's rows from a statement that forgot to say
which company it is about.

- **A payment pays an invoice, to that invoice's own vendor.** `payment.create` takes an invoice and
  an amount, and copies the vendor from the invoice in the same statement, so a payment cannot name
  one vendor and pay another's invoice. The database refuses it too: a payment's key points at the
  invoice and its vendor together, and an invoice must name a vendor its company has.
- **The database numbers a payment.** The running example's PAY-901 is there from the start, as
  INV-1008 is, so a new payment is PAY-902, then PAY-903. The caller never picks the number.
- **An amount is checked before anything is written:** above zero, at most two decimal places, at
  most sixteen digits before the point, and in the invoice's own currency. The column holds two
  decimals, and PostgreSQL would round a third away without a word. Converting between currencies is
  step 26's.
- **The application may make a draft and change a payment's status, and nothing else.** Start-up
  refuses to run if it may change a vendor, more of a payment than its status, or the sequence that
  numbers payments, itself or through a role it can become.

## Why it matters

At 2 a.m. the agent makes a payment for INV-1008, 31,400.00 USD to VENDOR-44. INV-1008 already has
one, PAY-901. Is the second one a disaster? Before this step nothing could say. There was no payment
to make, and the one command's receipt said `atomic` because its code copied the word from the
contract, with `atomic` ready as a fallback for a contract that said nothing: a guess that would
have looked like a fact.

Now the receipt says `compensatable`, and the contract says `payment.cancel` undoes it. The duplicate
is a draft, and the agent, or the person who reviews its night's work, takes it back. Step 20 stops
the duplicate from being made at all; this step makes sure that, until then, the mistake can be put
right, and that everyone can see it can.

## What changed since step 16

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_16_the_control_plane_store ../my_17_vendors_and_payments
```

| File | What |
| --- | --- |
| `migrations/009_vendors_and_payments.sql` | new — the two tables, each key starting with the company, a payment pointing at its company's vendor and invoice; a sequence for payment numbers, from 902; and what the application may do: read the vendors, make a draft payment, change a payment's status |
| `migrations/010_payments_running_example.sql` | new — VENDOR-44 in both companies, and PAY-901 in both: org_456's draft for 31,400.00 USD paying INV-1008, and org_789's own, for the cross-tenant suite |
| `migrations/011_the_lock_on_vendors_and_payments.sql` | new — the second lock on both tables, word for word as 005 wrote it |
| `src/payment.ts` | new — a payment, making one in one statement with its vendor read from the invoice, taking one back, and the amount a payment may carry |
| `src/contracts/payment.create.json`, `payment.cancel.json` | new — `compensatable`, undone by `payment.cancel`; and `atomic` |
| `src/operations.ts` | the two handlers; the address reader takes the entity it needs, because `payment.create` takes an invoice's address; and the door writes each receipt's semantics from the contract. `?? "atomic"` is gone |
| `src/registry.ts` | the two contracts; a program whose contract names an undo it does not have, or a query, refuses to start; `semanticsOf`, with no default |
| `src/boundary.ts` | `withTheContractsSemantics`; and a comment that promised step 17 a `PENDING_APPROVAL` receipt names step 27 |
| `src/database.ts` | the tenant tables in one list, four now, and every start-up question about them built from it; a refusal for an application that may change a vendor, or more of a payment than its status; and a grant of every invoice column, which slipped past since step 10, caught |
| `src/permissions.ts`, `src/classification.ts` | the supervisor and the agent may make and cancel payments; a payment's amount is confidential, like an invoice's |
| `src/main.ts` | each receipt line says its semantics; a section that lists what each command's contract says, makes a duplicate payment and takes it back, and shows the payments as they end |
| `test/vendors-and-payments.test.ts` | new — the tables: the running example, the company in every key, the second lock, what the application may and may not do |
| `test/payments.test.ts` | new — the two commands, the semantics on each receipt, a careless handler that says `atomic`, and the registry's refusals |
| `test/support/story.ts` | new — the one list of statements that put the story's rows back, for both tiers |
| `test/support/cross-tenant-suite.ts` | rows of both kinds, a new canary, and the same-state question asked only of a command that changes a row |
| the tests that put the story back | `resetInvoices` is `resetTheStory`, because it puts the payments back too |

608 tests, from 548; the database tier, 51, from 39, because the cross-tenant suite asks its six
questions of each new operation by itself.

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes near the end:

```text
Can it be undone? Every command says so in its contract:

  invoice.issue   atomic
  payment.cancel  atomic
  payment.create  compensatable, undone by payment.cancel

And on every receipt:

accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-902  draft      compensatable
                        withheld: amount (clearance)
accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-902  cancelled  atomic
                        withheld: amount (clearance)
accounts-payable-fte  CONFLICT                 retry: never                PAY-902 is cancelled, and only a draft payment can be cancelled

org_456's payments, as the database holds them now:

  PAY-901  draft      31400.00 USD   pays dsor://org_456/invoice/INV-1008 to dsor://org_456/vendor/VENDOR-44
  PAY-902  cancelled  31400.00 USD   pays dsor://org_456/invoice/INV-1008 to dsor://org_456/vendor/VENDOR-44
```

The first lines come from the contracts, so a contract that changes changes them. Then the agent
makes a second payment for INV-1008, though INV-1008 has PAY-901 already: a duplicate, the mistake
step 20 stops from happening. Its receipt says `compensatable`, and leaves out the amount the agent
itself sent, because a payment's amount is confidential, like an invoice's. The cancel's receipt
says `atomic`. Asking a second time is refused: a cancelled payment stays cancelled. The last two
lines are the step's "done when": PAY-901 is a draft for 31,400.00 USD.

Earlier in the demo, the agent's `invoice.issue` line now ends in `atomic`, and the list of every
operation called with another company's address has two more lines, one for each payment
operation, both refused.

### The database tier

`pnpm check` needs no server. The fifty-one tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_16_the_control_plane_store/.env .env     # then dsor_step16 -> dsor_step17 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step17` through the owner
login. `pnpm migrate` applies the eleven migrations; on a server that already had step 16's eight,
it applies 009, 010 and 011, and the vendors, the payments and their lock arrive together.

## Break it

Ten, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `608` with `1 skipped`; in the repository it is `608 passed`.

### Break 1 · payment.create says it cannot be undone

In `src/contracts/payment.create.json`, make the semantics `atomic` and delete `compensated_by`.

```text
 Tests  7 failed | 600 passed | 1 skipped (608)
```

The schema accepts it: an atomic command names no undo. The tests do not. The contract's own tests,
its receipts, the careless handler's, and the demo's list all say what `payment.create` promises.
A promise in a contract is a fact a test can check, which is the point of writing it there.

### Break 2 · the door passes on the handler's semantics

In `src/operations.ts`, hand `leaveTheDoor` the handler's answer as it came, instead of
`withTheContractsSemantics(answer, semantics)`.

```text
 Tests  1 failed | 606 passed | 1 skipped (608)
```

Only the test with a careless handler that writes `atomic` on a payment. Every handler of this step
writes the right word, so nothing else notices: the door is for the handler that does not.

### Break 3 · a cancelled payment can be cancelled again

In `src/payment.ts`, delete `AND status = 'draft'` from `cancelPayment`'s UPDATE.

```text
 Tests  2 failed | 605 passed | 1 skipped (608)
```

The test that cancels twice, and the demo's last receipt: the second cancel now "succeeds", and says
`atomic` about a change that changed nothing.

### Break 4 · an amount with three decimals gets through

In `src/payment.ts`, let the amount's pattern take three decimal places instead of two.

```text
 Tests  1 failed | 606 passed | 1 skipped (608)
```

`31400.005` reaches PostgreSQL, which stores `31400.01` without a word. One test sends it, and the
payment is made, for an amount nobody asked for.

### Break 5 · the payment forgets which company its invoice is in

In `src/payment.ts`, change `WHERE i.tenant_id = $1 AND i.id = $2` to
`WHERE i.id = $2 AND $1::text IS NOT NULL`, keeping the rest of the line.

```text
 Tests  0 failed | 607 passed | 1 skipped (608)
```

Nothing fails, and that is the lesson. The statement no longer says which company's invoice it means,
and the second lock, which reads the company the statement was run for, still hides org_789's
INV-1008. Two locks, so that forgetting one is not a leak. Keep `$1` in the statement: delete it
outright and PostgreSQL cannot tell what type it is, and every payment fails for that instead.

### Break 6 · the application may delete payments

In `migrations/009_vendors_and_payments.sql`, add `GRANT DELETE ON public.payments TO dsor_runtime;`.

```text
 Tests  29 failed | 578 passed | 1 skipped (608)
```

The program refuses to start: the application "may change a vendor, more of a payment than its
status, or a payment's number". Every test that starts it fails, and so does the test that tries the
DELETE as the application. A payment the application could delete is evidence it could lose.

### Break 7 · start-up's list of tenant tables forgets the payments

In `src/database.ts`, delete `["public.payments", "tenant_id"]` from `TENANT_TABLES`.

```text
 Tests  33 failed | 574 passed | 1 skipped (608)
```

The program refuses to start, because the application may read a table that is not on the list.
One list is why: a table the start-up questions do not know about is refused, not trusted.

### Break 8 · payment.create's example names INV-1008 again

In `src/contracts/payment.create.json`, make the example `INV-1008` for `31400.00`.

```text
 Tests  1 failed | 606 passed | 1 skipped (608)
```

The cross-tenant suite refuses it: org_456's INV-1008 is issued and org_789's is a draft, so a
careless `payment.create` would meet a different invoice in each company, and the suite's
"untouched" question could pass for that reason instead of the right one. INV-1009 is a draft in
both.

### Break 9 · a payment's key forgets the vendor

In the same migration, point the payment's key at `(tenant_id, invoice)` alone.

```text
 Tests  1 failed | 606 passed | 1 skipped (608)
```

The test that writes VENDOR-77 against INV-1008 as the application: the database takes it. The
program copies the right vendor every time; the key is for the day something else writes a payment.

### Break 10 · the registry takes an empty list of undos

In `src/registry.ts`, let a `compensatable` contract name nothing that undoes it.

```text
 Tests  1 failed | 606 passed | 1 skipped (608)
```

The schema takes `compensated_by: []`, so only the registry stands between a promised undo and none.

Restore each break and confirm `pnpm check` prints `608 passed` again.

## Build it yourself with Claude Code

Copy `my_16_the_control_plane_store` to a new folder and ask:

> Start step 17, vendors and payments. Before any code: show me a command's receipt today and what
> it says about whether the command can be undone, and where that answer comes from. Then ask me the
> step's decisions one at a time. Then build it a piece at a time, red first, and break each piece
> on purpose.

## Check yourself

1. What does a command's execution semantics answer, and who needs the answer before the command
   runs?
2. `payment.create` is `compensatable`. What does that promise, and where is the promise kept?
3. Who writes the semantics on a receipt, and why not the code that ran the command?
4. Why does the database number a payment, instead of the caller?
5. Why is an amount with three decimal places refused, when PostgreSQL would accept it?

<details>
<summary>Answers</summary>

1. Whether the command's effect can be undone. The agent and the person who supervises it need it
   before acting: a mistake that can be undone can be put right.
2. That another operation, which the contract names, undoes it: `payment.cancel`. The program
   refuses to start if the named operation is missing or is a query, and the undo runs through the
   same door as any command, with its own permission and its own decision in the log.
3. The door, from the contract, on every receipt. The contract is where the promise is made; a
   handler copied from another command would otherwise repeat that command's promise. The tests
   prove it with a handler that writes `atomic` on a payment: the receipt still says
   `compensatable`.
4. A caller that names the number can pick one that exists. A sequence hands each request the next
   number, and two requests at once get two different ones. That is also why a retried request makes
   a second payment today, which step 20's idempotency key fixes.
5. The column holds two decimals, and PostgreSQL rounds a third away without a word: 31400.005 would
   be stored as 31400.01. A payment for an amount nobody asked for is worse than a refusal.

</details>

## The rules this step meets

- **[DSOR-EXE-05a · L2]** Every command MUST declare one of these execution semantics in its
  contract. `invoice.issue`, `payment.cancel` and `payment.create` each declare theirs, and the
  registry refuses a command contract without.
  ([§24](../../../specs/dsor/03-execution.md#24-execution-semantics))
- **[DSOR-EXE-05b · L2]** Every command result MUST state the execution semantics that applied. The
  door writes them on every receipt, from the contract.
- **[DSOR-EXE-05c · L2]** A `COMPENSATABLE` or `SAGA` operation MUST name its compensating
  operations, which run under the full pipeline. `payment.create` names `payment.cancel`; the
  registry refuses a name that is not a command it has; and `payment.cancel` is an ordinary
  operation through the door.

**What this step leaves, said plainly.** A retried `payment.create` makes a second payment, until
step 20's idempotency key. A cancelled payment stays cancelled because `payment.cancel` changes only
a draft: the application's right to change a payment's status could set one back, and the database
does not stop it, until the states of step 22. A handler that throws leaves the door as a thrown
error, not an envelope, as it has since step 03; for a command the honest answer is
`OUTCOME_UNKNOWN`, which step 37 builds. Nothing checks that a payment's amount fits what the invoice still owes,
or that the invoice is issued and the vendor approved: those are preconditions, in step 32. A
payment's vendor is the invoice's at the moment the payment is made; a vendor suspended later is
step 31's. There is no `payment.get` yet: the demo reads the payments for its report through the
same store as every statement, as the program's own report, not as an operation a caller can ask.

Everything earlier steps claimed still holds.

**Next:** step 18, `delegations` — the permission slip: a person lets the agent create payments, up
to a limit, until a date, and the agent never holds more than the person who signed.
