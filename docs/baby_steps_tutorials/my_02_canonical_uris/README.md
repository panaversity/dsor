# Step 01 · One invoice in memory

**New in this step:** the first business record, and the first rule of the
specification — money is an amount *and* a currency, and the amount is written as text.

## In plain words

An invoice is the first thing DSoR knows about. This step adds a type that says what an
invoice is, two invoices held in a plain array, and one function that finds an invoice
by its id. "In memory" means the array lives in the running program and disappears when
the program stops. There is no database until step 09.

The amount is the part to look at. It is not the number `31400`. It is
`{ value: "31400.00", currency: "USD" }`: a decimal written as text, together with a
three-letter currency code. That shape is rule `DSOR-MON-01`, one of the shortest rules
in the specification, and one of the easiest to get wrong.

## Why it matters

INV-1008 is 31,400.00 USD owed to VENDOR-44. Suppose the amount were an ordinary
number, and three late fees of ten cents each were added to it:

```text
31400 + 0.1 + 0.1 + 0.1  =  31400.299999999996
```

Not 31,400.30. Computers store decimals in binary, and 0.1 has no exact binary form, so
the sum lands just beside the right answer. The books are now wrong by a fraction of a
cent. Nobody can say where it went, and an auditor who finds a difference nobody can
explain does not stop looking. Text does not drift. `"31400.00"` holds exactly what was
written, for as long as it is kept.

The currency half matters for a different reason. `31400` on its own does not say
31,400 of *what*. In step 27 you will write a rule that says "payments above 25,000 USD
need the CFO's approval". A rule like that cannot be applied honestly to an amount that
carries no currency. The specification records the real version of this bug: a rule
written as `amount > 25000 && currency == "USD"` let a payment of 50,000,000 PKR
straight through, because the currency was not USD, so the condition was false. Keeping
the currency beside the amount from the first line is what makes that fixable later.

## What changed since step 00

```text
my_01_one_invoice_in_memory/
  src/money.ts          NEW  the Money type, and money() which refuses bad amounts
  src/invoice.ts        NEW  the Invoice type, two invoices, and getInvoice
  test/money.test.ts    NEW  five tests: one "yes", three refusals, one recorded gap
  test/invoice.test.ts  NEW  six tests: reading, searching, refusing, the float bug, immutability
  src/main.ts        CHANGED now reads INV-1008 and prints it
  package.json       CHANGED name and description only
```

Everything else is step 00, byte for byte. To see that for yourself:

```bash
cd docs/baby_steps_tutorials
diff -rq --exclude=node_modules --exclude=pnpm-lock.yaml \
  00_foundation my_01_one_invoice_in_memory
```

```text
Files 00_foundation/README.md and my_01_one_invoice_in_memory/README.md differ
Files 00_foundation/package.json and my_01_one_invoice_in_memory/package.json differ
Only in my_01_one_invoice_in_memory/src: invoice.ts
Files 00_foundation/src/main.ts and my_01_one_invoice_in_memory/src/main.ts differ
Only in my_01_one_invoice_in_memory/src: money.ts
Only in my_01_one_invoice_in_memory/test: invoice.test.ts
Only in my_01_one_invoice_in_memory/test: money.test.ts
```

Seven lines, and six of them are this step. To read one of those changes in full, name
the two files:

```bash
git diff --no-index 00_foundation/src/main.ts my_01_one_invoice_in_memory/src/main.ts
```

Give `git diff --no-index` the two folders instead and it will also walk
`node_modules`, which both folders have after `pnpm install`. That is why the folder
comparison above uses `diff` with an exclude.

Search the folder for `NEW IN STEP 01` and you will find this step's lesson and nothing
else. Each step removes the previous step's markers, so the marker always points at the
one new idea.

## Run it

```bash
cd docs/baby_steps_tutorials/my_01_one_invoice_in_memory
pnpm install
pnpm start
```

```text
Hello, accounts-payable-fte.
INV-1008: 31400.00 USD to VENDOR-44 (issued)
INV-9999: not found.
```

The last line matters as much as the one above it. `getInvoice` returns `undefined` when
there is no such invoice. A missing record is an ordinary answer, not a crash. Proper
error shapes arrive in step 04.

`(issued)` is the invoice's **status**: where it has got to in its life. An invoice is
`draft` before it is sent, `issued` once it is, then `paid` or `cancelled`. In this step
the status is only a label on the record. Nothing reads it before acting. Turning "a
payment needs an issued invoice" into a rule the system checks is step 32.

```bash
pnpm check                 # typecheck, then test. 13 tests pass
```

### Why some tests are titled with a rule id

A test that proves a rule begins with that rule's id, then says in plain words what it
proves:

```ts
it("DSOR-MON-01: INV-1008 is 31400.00 USD, an amount and a currency", () => { … });
```

The convention is not decoration. In `packages/` — the repository's own implementation,
not this tutorial — `pnpm coverage:req` reads test titles to count which of the 268
rules a test names. That command walks `packages/` only, so it never sees this folder,
and neither does the repository's `pnpm test:unit`. CI does check this folder's links
and its formatting; it does not run its tests. Your step is run by you. You use the
convention here so the habit is already yours when you write a test that does get
counted.

Three of the eleven new tests carry no rule id. Two of them test `getInvoice` — that it
searches the list, and that it returns `undefined` for a missing invoice — and no rule
in §9 governs either. The third is the float test. It does not touch this step's code at
all, so it would still pass if `src/` were deleted: it shows the fact about computers
that the rule exists to guard against. That is motivation, not proof, and a title
claiming otherwise would misdescribe what the test checks.

### Why `getInvoice` makes the compiler complain

`getInvoice` returns `Invoice | undefined`. TypeScript will not let you reach
`invoice.amount` until you have ruled out `undefined`. The test answers that with a
check the compiler can follow:

```ts
if (invoice === undefined) {
  throw new Error("INV-1008 is missing from the list of invoices");
}
```

You could write `invoice!.amount` instead. The `!` tells the compiler to stop asking
without answering the question, and in a system that moves money that habit is how a
crash reaches production. Answer the compiler; do not silence it.

## Break it

This step has four locks on the amount, and they are not the same lock. Break each one
and watch which tool complains. Change the code back after each break.

**1. Break the text, and a test catches it.** In `src/invoice.ts`, change INV-1008's
amount from `money("31400.00", "USD")` to `money("31400", "USD")`. It is still a valid
decimal string, so the guard is happy and the compiler is happy. Run `pnpm test`:

```text
AssertionError: expected '31400' to be '31400.00' // Object.is equality
Expected: "31400.00"
Received: "31400"
 Test Files  1 failed | 2 passed (3)
      Tests  3 failed | 10 passed (13)
```

Only a test knows what the string is supposed to *say*.

**2. Break the type, and the compiler catches it.** Change it to `money(31400, "USD")`
— the number. Run `pnpm typecheck`:

```text
src/invoice.ts(42,19): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
```

You never ran the code, and no test had to fail.

**3. Break the content, and `money()` catches it.** Change it to
`money("2,500 dollars-ish", "USD")`. This is a perfectly good `string`, so the compiler
has nothing to say. Run `pnpm test`:

```text
TypeError: not a decimal amount: "2,500 dollars-ish"
 Test Files  1 failed | 2 passed (3)
      Tests  7 passed (7)
```

Read that test count carefully. Seven tests passed, not thirteen. The six tests in
`invoice.test.ts` did not fail — they never ran. `money()` threw while the file was
being loaded, before any test in it started. A bad amount stops at the moment it is
made, which is the whole point of checking there.

This is the break that matters most. Without `money()`, that line compiles and the
`Money` type has nothing to say, because `"2,500 dollars-ish"` is a string. Here it
would still be caught, because a test pins INV-1008's amount. Nothing would catch it in
a record that no test happens to pin — a payment in step 17, say. A guard at the point
the money is made covers every record; a test covers the ones you remembered to write.

**4. Break the lock on changing a stored amount — twice, because there are two.**

First delete the word `readonly` from `value` in `src/money.ts`. Run `pnpm typecheck`:

```text
test/invoice.test.ts(99,7): error TS2578: Unused '@ts-expect-error' directive.
```

That error *is* the test. The line said "what comes next must not compile"; with
`readonly` gone it compiles, so the directive is unused and the build fails.

Now put `readonly` back and delete `Object.freeze` from the `return` instead. Run
`pnpm test`:

```text
AssertionError: expected function to throw an error, but it didn't
AssertionError: expected false to be true // Object.is equality
 Test Files  1 failed | 2 passed (3)
      Tests  2 failed | 11 passed (13)
```

The compiler was satisfied and the amount changed anyway. `readonly` is a promise the
compiler checks and then **erases**: Node deletes every type before it runs the file, so
at run time there is nothing left to stop an assignment. `Object.freeze` is the run-time
half. You need both, and the two breaks above prove neither one covers for the other.

Change everything back and run `pnpm check` to confirm 13 tests pass again.

## Build it yourself with Claude Code

This folder **is** a learner copy. Its name starts with `my_`, which is the convention
for a copy you build yourself, kept beside the official steps. The official
`01_one_invoice_in_memory` is still listed as planned in the [map](../readme.md), so
there is nothing to compare against yet. When it is published, compare then.

To build your own copy of a step, you copy the step before it and start Claude Code
inside the copy. The human does the copying, not the agent:

```bash
cd docs/baby_steps_tutorials
cp -r 00_foundation my_01_one_invoice_in_memory
cd my_01_one_invoice_in_memory
rm -rf node_modules && pnpm install
claude
```

Then paste one line, because `CLAUDE.md` and the `build-baby-step` skill travelled with
the copy and already know the rest:

```text
Use the build-baby-step skill in learner mode. We are building step 01,
one_invoice_in_memory.
```

Ask for a plan before any code, and ask to see the new tests fail before they pass. The
general directions are in the
[tutorial overview](../readme.md#build-the-steps-with-claude-code).

## Check yourself

1. Why is the amount stored as `"31400.00"` and not as `31400.00`?
2. `31400 + 0.1 + 0.1 + 0.1` is not `31400.3`. Would writing the result as
   `.toFixed(2)` fix the problem?
3. Why does the amount carry a currency code, when every invoice in this step is in
   USD anyway?
4. `getInvoice("INV-9999")` returns `undefined` rather than throwing an error. Why is
   that a reasonable choice here?
5. `Money.value` is `readonly`, and the code *also* calls `Object.freeze`. Why is one
   of them not enough?
6. A test passed and `pnpm typecheck` failed. Is the step done?

<details>
<summary>Answers</summary>

1. Because a decimal number is stored in binary, and most decimals have no exact binary
   form. `0.1 + 0.2` is `0.30000000000000004`. Text keeps exactly the digits that were
   written, so nothing drifts.
2. No. `.toFixed(2)` rounds the *display*. The number underneath is still wrong, and the
   next calculation uses the wrong number. Rounding hides the error instead of removing
   it, which is worse, because now nobody can see it.
3. Because a rule about money is a rule about an amount in a currency. A later rule will
   say "above 25,000 USD, get the CFO's approval". Applied to a bare `50000000` with no
   currency, that rule cannot give an honest answer.
4. Because the invoice being absent is a normal thing to find out, not a failure of the
   system. The caller asked a question and got an answer. Errors that a caller can see
   get a proper shape in step 04.
5. They work at different times. `readonly` is checked by the compiler and then erased,
   because Node deletes all types before running the file, so it stops *your* code from
   being written wrongly and stops nothing at run time. `Object.freeze` is a real lock
   on the object while the program runs. Break 4 shows each one failing on its own.
6. No. A step is done when `pnpm check` passes, and `pnpm check` runs the typecheck
   first and the tests second.

</details>

## The rules this step meets

- **[DSOR-MON-01 · L1]** A monetary amount MUST be represented as a `money` object with
  a decimal-string value and an ISO 4217 currency code.
  ([§9](../../../specs/dsor/01-model.md#9-money-and-currency))

Three things together meet it, and no one of them is enough:

| What | Catches |
| --- | --- |
| the `Money` type | an amount that is a number, or has no currency at all |
| `money()` | text that is not a decimal, and a currency that is not three upper-case letters |
| the tests in `test/money.test.ts` | that `money()` really does refuse, and says why |

The two *patterns* inside `money()` are copied from the specification's own JSON Schema,
`packages/spec/schemas/common.schema.json`. Be exact about what that buys, because two
gaps are easy to read past:

- **The currency check is a shape check.** `^[A-Z]{3}$` accepts `ZZZ` and `QQQ`, which
  are not assigned currencies. Checking a code against the real ISO 4217 list needs the
  list, and this step does not have one. `test/money.test.ts` records the gap in a test
  so that nobody has to rediscover it.
- **`money()` is a convention, not a gate.** TypeScript matches types by their shape, so
  a plain `{ value: "oops", currency: "lol" }` is a valid `Money` as far as the compiler
  is concerned, and nothing forces a future step to call `money()`. The schema also sets
  `additionalProperties: false`, which an interface cannot express — an extra field
  rides along unnoticed.

So this step meets `DSOR-MON-01` for every amount built through `money()`, which is
every amount in it. Making the guard the only door needs more of the type system than
belongs in step 01. Validating at a boundary, where it cannot be skipped, is what
operation contracts do in step 03.

`DSOR-MON-02` says that monetary arithmetic and comparison MUST use decimal arithmetic.
This step does no arithmetic on money, so there is nothing yet to meet it with. Adding
and comparing amounts safely is step 26.

**Next:** step 02, canonical URIs — giving every record one permanent address,
`dsor://org_456/invoice/INV-1008`.
