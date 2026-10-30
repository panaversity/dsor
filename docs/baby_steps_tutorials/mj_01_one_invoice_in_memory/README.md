# Step 01 · One invoice in memory

**New in this step:** money is an amount *and* a currency, and the amount is a decimal
string, never a `number` (DSOR-MON-01).

## In plain words

This step holds one kind of business record, an **invoice**, in the computer's memory.
There is no database yet. An invoice is a plain object with the field names the
specification uses: `id`, `vendor_id`, `amount`, `open_amount`, and `status`. A
function, `getInvoice`, finds one invoice by its id. If no invoice has that id, it
returns `undefined`. That is a normal answer ("there is none"), not an error.

The real lesson is how the invoice holds money. An amount of money is always two
things: a **value** and a **currency**. The value is a **decimal string**, which means
digits written as text, like `"31400.00"`. So the amount of `INV-1008` is:

```ts
{ value: "31400.00", currency: "USD" }
```

The currency is an **ISO 4217 code**: the three capital letters the world agrees on
for each currency, such as `USD` or `PKR`. We check it against the list of currencies
that Node knows, `Intl.supportedValuesOf("currency")`.

## Why it matters

**A number without a currency.** Suppose `INV-1008` is stored as only `31400`. In step
27, a rule will ask: "Is this payment above 25,000 USD? Then `cfo_100` must approve
it." The rule cannot answer. 31,400 USD needs the CFO. 31,400 PKR, about 110 USD, does
not. Whatever the code assumes, it is right for one currency and wrong for the other.
A wrong "no" sends 31,400 USD out without the CFO ever seeing it.

Writing the currency down is only the first half. Section 9 of the specification tells
the second: a rule written as "amount > 25000 and currency is USD" lets 50,000,000 PKR
straight through, because the currency is not USD. Step 27 closes that hole, and it
needs this step first.

**A number that is not exact.** A `number` in JavaScript is a **floating-point
number**, or **float** for short. Money is never a float in this tutorial. Run this in
Node:

```text
> 0.1 + 0.2
0.30000000000000004
> 0.1 + 0.2 === 0.3
false
> 31400 + 0.1 + 0.1 + 0.1
31400.299999999996
```

The last line is `INV-1008` with three fees of 0.10 added. It should be 31400.30.

A computer stores a `number` in **binary**: numbers written with only the digits 0 and
1. One-tenth cannot be written exactly in binary. This is the same problem as writing
one-third in decimal: you get 0.3333… and must stop somewhere. So `0.1` is stored as a
value very close to 0.1, and the small errors show up when you add. For money, "very
close" is wrong. Money is counted in tenths and hundredths, and decimal digits write
those exactly. That is why the value keeps decimal digits.

**Why a string, then.** A string keeps exactly the digits someone wrote: `"31400.00"`
stays `"31400.00"`, but the number `31400.00` prints as `31400`. A string does not do
arithmetic at all. `+` only joins text: `"100" + "50"` is `"10050"`, which even looks
like valid money. So a string does not add money for you, correctly or wrongly. Adding
and comparing money correctly is DSOR-MON-02. Step 26 will do it with real decimal
arithmetic. This step only *stores* money correctly.

**Stricter than the schema, on purpose.** The specification's JSON Schema asks only
for three capital letters, so it would accept `"ABC"`. Our check accepts only the
codes Node lists as money. Everything we accept, the schema also accepts, and a test
checks this. So we never let through something the specification forbids. The cost: a
brand-new currency that Node does not know yet is refused. Refusing is the safe
direction, like a lock that stays locked when the power fails. Someone notices and
asks, and no wrong payment leaves.

**Common mistake:** writing `amount: 31400.00`. It breaks the rule twice: it is a
float, and it has no currency. TypeScript allows it wherever the type says `number`.
Here the type says `Money`, so the compiler refuses it ("Break it" shows this). But
data read from outside the program has no types, and there only `money()` refuses it.

## What changed since step 00

```text
src/greet.ts          removed. It was step 00's placeholder
test/greet.test.ts    removed, with it
src/money.ts          NEW: the Money type and money(), which refuses bad money
src/invoice.ts        NEW: the Invoice type, the list in memory, and getInvoice()
src/main.ts           changed: prints INV-1008 instead of a greeting
test/money.test.ts    NEW: 22 tests for DSOR-MON-01, 2 for the float bug, and 1 for
                      the length of a refusal
test/invoice.test.ts  NEW: 4 tests: read INV-1008, its amounts are money,
                      every amount passes money(), a missing id
package.json          changed: the step's name and description
```

Every changed region in `src/` is marked `NEW IN STEP 01`. To see the whole diff, run
this from `docs/baby_steps_tutorials`:

```bash
git diff --no-index 00_foundation/src mj_01_one_invoice_in_memory/src
git diff --no-index 00_foundation/test mj_01_one_invoice_in_memory/test
```

Compare `src` and `test`, not the whole folders. Each folder has its own
`node_modules`, and a whole-folder diff buries the lesson under hundreds of lines from
installed packages.

Three design choices are worth a look:

- **`getInvoice(list, id)` takes the list as an argument.** It does not read a list
  from outside itself, so it stays a pure function, the habit from step 00. In step 09
  the list will move into a database.
- **`money()` checks the type before the pattern.** `/^-?[0-9]+(\.[0-9]+)?$/.test(31400)`
  is `true`, because `.test()` turns the number into the text `"31400"` first. Without
  the `typeof` check, a number gets through. "Break it" below shows this.
- **The `Money` type is only a shape.** TypeScript accepts any object with a `value`
  string and a `currency` string, such as `{ value: "3.14e4", currency: "usd" }`, even
  if it never went through `money()`. So a test sends every amount in the invoice list
  back through `money()`. A type that only `money()` can create would be a stronger
  fix, but it is a second idea, so it waits.

## Run it

```bash
cd docs/baby_steps_tutorials/mj_01_one_invoice_in_memory
pnpm install
pnpm start
```

```text
{
  id: 'INV-1008',
  vendor_id: 'VENDOR-44',
  amount: { value: '31400.00', currency: 'USD' },
  open_amount: { value: '31400.00', currency: 'USD' },
  status: 'issued'
}
```

`pnpm check` runs the type check, then 30 tests:

```text
 Test Files  2 passed (2)
      Tests  30 passed (30)
```

## Break it

Do both. Before each one, predict which command catches it: `pnpm test` or
`pnpm typecheck`.

**1. Remove the type check.** In `src/money.ts`, delete `typeof value !== "string" || `
so that only the pattern check is left. Run both commands (output shortened):

```text
$ pnpm test
 FAIL  test/money.test.ts > money > DSOR-MON-01: a number is refused, even one that slipped past the types
AssertionError: expected function to throw an error, but it didn't
      Tests  1 failed | 29 passed (30)

$ pnpm typecheck
$ tsc --noEmit
```

The type check prints nothing, because `money` still says `value: string`. The
`typeof` line is the only guard against a `number`, and this one test is the only
thing that notices when the guard is gone. Data from outside the program has no types,
so this guard matters. Put the line back.

**2. Make the common mistake.** In `src/invoice.ts`, change the first
`amount: money("31400.00", "USD"),` to `amount: 31400.00,` (output shortened):

```text
$ pnpm typecheck
src/invoice.ts(20,5): error TS2322: Type 'number' is not assignable to type 'Money'.

$ pnpm test
 × DSOR-MON-01: INV-1008 holds its amounts as money, not as numbers
 × DSOR-MON-01: every amount in the invoice list passes money()
      Tests  2 failed | 28 passed (30)
```

Two separate checks catch this mistake. The compiler catches it before the code runs.
The tests catch it when the code runs, because vitest does not check types. Put the
line back, and run `pnpm check` until it is green.

## Build it yourself with Claude Code

Build your own step 01 from a copy of step 00. From `docs/baby_steps_tutorials`:

```bash
cp -R 00_foundation my_01_one_invoice_in_memory
cd my_01_one_invoice_in_memory
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 01. Two questions to settle
with me on the way: should a currency be checked against Node's list,
Intl.supportedValuesOf("currency")? And should an invoice be locked against changes in
this step, or later?
```

When `pnpm check` is green in your folder:

```text
Now compare this folder with ../01_one_invoice_in_memory. Explain every difference,
and tell me which ones matter and why.
```

## Check yourself

1. Node prints `0.30000000000000004` for `0.1 + 0.2`. Why?
2. An invoice arrives as `{ value: "31400.00" }`, with no currency. Which rule does it
   break, and what could go wrong with the 25,000 USD approval rule in step 27?
3. Which of these is valid money in this step, and why?
   (a) `{ value: "31400.00", currency: "USD" }`
   (b) `{ value: 31400, currency: "USD" }`
   (c) `{ value: "31400.00", currency: "usd" }`
   (d) `{ value: "31400.00", currency: "ABC" }`
   (e) `{ value: ".50", currency: "USD" }`
4. The JSON Schema accepts `"ABC"` as a currency, and our code refuses it. Is that a
   problem?
5. What does `getInvoice(invoices, "INV-9999")` return, and why is that not an error?

<details>
<summary>Answers</summary>

1. A computer stores a `number` in binary, with only the digits 0 and 1. One-tenth
   cannot be written exactly in binary, the way one-third cannot be written exactly in
   decimal. So `0.1` and `0.2` are each stored slightly off, and the sum shows the
   error.
2. It breaks DSOR-MON-01: an amount must have a currency. The rule cannot tell 31,400
   USD, which needs the CFO, from 31,400 PKR, about 110 USD, which does not. If the
   code assumes the wrong one, a real 31,400 USD payment is made without the CFO's
   approval.
3. Only (a). (b) is a `number`, not a string. (c) is lowercase, and currency codes are
   capital letters. (d) has the right shape but is not a currency. (e) needs a
   digit before the dot: write `"0.50"`.
4. No. Everything we accept, the schema also accepts, so we never let through
   something the specification forbids. We only refuse a little more, and refusing is
   the safe direction.
5. `undefined`. Asking for an invoice that does not exist is a normal question with a
   normal answer: there is none. An error means something broke, and nothing broke.

</details>

## Think it through

A green `pnpm check` means the tests you wrote pass. It does not mean you wrote the
right tests. So when this step was green, a reviewer who had not seen the conversation
attacked it. Read what it found before you start step 02. The open items below are
where later steps begin.

**Found and fixed in this step:**

1. **You could skip `money()`.** The `Money` type is only a shape. A hand-written
   `{ value: "3.14e4", currency: "usd" }` in the invoice list passed the type check
   and all the tests. Now a test sends every amount in the list back through
   `money()`.
2. **"A string fails loudly" was false.** An earlier draft of this page said so. But
   `"100" + "50"` is `"10050"`, which looks like valid money. A string protects you
   only because it does no arithmetic, and step 26 will add real decimal arithmetic.
3. **"TypeScript accepts `amount: 31400.00`" was half true.** It is accepted where the
   type says `number`, and refused where the type says `Money`. Data from outside the
   program has no type at all, and there only `money()` stands guard.
4. **No test said what must be accepted.** The only "yes" values were `"31400.00"`
   and `"50000000.00"`. A pattern that refused negative amounts, or demanded exactly
   two decimal places, passed every test, although the schema allows both. Now `"0"`,
   `"-12.50"`, and `"1.5"` must be accepted. Test the "yes" as carefully as the "no".

**Found later, by breaking the code on purpose:** `money()` promises to show only a short
piece of a bad input in its message. Deleting that limit left every test green, so a
refused 100,000-character input went whole into the message. A test now sends one and
checks the message stays short. A promise in a comment needs a test that keeps it.

**Removed from step 00, on purpose:** `src/greet.ts` and its test. `greet` was a check
that the tools work, not part of DSoR, so step 01 replaces it. Steps are cumulative, so
removing earlier code is the exception, and every removal gets a line here.

**Fixed after the step, on 2026-09-26:** a read could change the stored invoice.
`getInvoice` handed back the object in the list itself, so a caller that set its
`status` to `"paid"` changed INV-1008 for everyone after it. From step 04, `call` hands
that object to a caller, and the gap became a real hole. Now `getInvoice` returns a
copy, and a test changes a found invoice and reads the stored one again. The fix is
here, where the cause is, and every later step carries it.

**Left open, on purpose.** Each of these needs a new idea, so it waits:

- A type that only `money()` can create, so a hand-written `Money` does not compile.
- `"-0"`, `"031400.0"`, and `"31400.00"` are all valid decimal strings. When step 26
  compares money, the last two must count as equal.
- A value with 100,000 digits is accepted. A later step must set a length limit.
- `money()` throws a plain `TypeError`. When a caller outside the program can see an
  error, it must become an error envelope (step 04).
- Code inside the program can still change the stored invoices. A read returns a copy
  now, but locking the list itself is for a later step.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-MON-01 | A monetary amount is a `money` object with a decimal-string value and an ISO 4217 currency code | [§9 Money and currency](../../../specs/dsor/01-model.md#9-money-and-currency), and the `money` definition in [`common.schema.json`](../../../packages/spec/schemas/common.schema.json) | 22 tests in `test/money.test.ts`, 2 in `test/invoice.test.ts` |

The value pattern in `src/money.ts` is copied from that schema. This step has no
operation yet, so it has no operation *contract*. Contracts arrive in step 03. Inside
the dsor repository, `pnpm guard` checks every rule id and every link on this page. If
the spec renames the section or removes the rule, the guard fails.

**Next:** step 02, canonical URIs.
