# Step 01 · One invoice in memory

Folder: [`my_01_one_invoice_in_memory`](../my_01_one_invoice_in_memory/README.md) · 13 tests
Spec: [§9](../../../specs/dsor/01-model.md#9-money-and-currency) · `DSOR-MON-01`
Commits: `4c69eca` → `3a3fe44` (6)

## What it does

Money is `{ value: "31400.00", currency: "USD" }` — a decimal written as text, plus a
currency code. Two invoices in a plain array, and `getInvoice(id)` to find one.

`money(value, currency)` refuses anything that is not a decimal string with a three-letter
code. Its two patterns are copied from `$defs/money` in
[`common.schema.json`](../../../packages/spec/schemas/common.schema.json), so the step
refuses what the normative schema refuses.

## Why the step exists

`0.1 + 0.2` is `0.30000000000000004`. Measured with the running example:
`31400 + 0.1 + 0.1 + 0.1` is `31400.299999999996`. The books are then wrong by a fraction
of a cent and nobody can say where it went.

The currency half matters differently: a rule saying "above 25,000 USD needs the CFO"
cannot be applied honestly to a bare number. The specification records the real bug —
`amount > 25000 && currency == "USD"` let 50,000,000 PKR through because the currency was
not USD.

## Decisions taken here

- **[5](decisions.md#5--step-01-enforces-dsor-mon-01-not-just-describes-it-2026-09-22)** —
  enforce the rule rather than describe it, after review proved
  `{ value: "2,500 dollars-ish", currency: "United States Dollars" }` compiled and passed.
- **[6](decisions.md#6--readonly-is-always-paired-with-objectfreeze-2026-09-22)** —
  `readonly` plus `Object.freeze`, discovered by a failing test rather than by reasoning.

## The lesson that stuck

After adding `readonly` to every field, the mutation test **still failed**:
`expected '1.00' to be '31400.00'`. `readonly` is checked by the compiler and then erased —
Node deletes every type before running the file — so it stopped nothing at run time.
`Object.freeze` is the run-time half.

Break 4 in the step's README proves each lock independently: drop `readonly` and the
compiler says `TS2578`; drop `Object.freeze` and a test says
`expected function to throw an error, but it didn't`. Neither covers for the other.

## Limits written down

- `^[A-Z]{3}$` checks the **shape** of a currency code, not membership of ISO 4217. `ZZZ`
  and `QQQ` are accepted, and a test records that on purpose.
- `money()` is a convention, not a gate. TypeScript matches types by shape, so a plain
  `{ value: "oops", currency: "lol" }` satisfies `Money` and nothing forces a later step to
  call `money()`.
- `DSOR-MON-02` (decimal arithmetic) is not claimed. The step does no arithmetic; that is
  step 26.

## Known gaps, still open

Found later, in step 04's sweep, and belonging here by
[decision 17](decisions.md#17--defects-from-an-earlier-step-are-reported-not-patched-forward-2026-09-25):

Six mutations survive, and the cause is narrower than it first looked. Trailing junk on the
*value* **is** tested — `"2,500 dollars-ish"` and `"31400."` both start with a valid decimal
and carry rubbish after it, which is what protects that pattern's anchors. What is untested
is different:

- the value's two **quantifiers**: `-?` (so `--12.5` passes) and the optional fraction group
  `(\.[0-9]+)?` (so `1.5.5` passes)
- the **currency** pattern, which is only ever given input wrong at the *start* — `usd`,
  `US`, `""`, `United States Dollars`. Nothing gives it trailing junk or a wrong length, so
  `fakeUSD`, `USDollars`, `EURO`, `US1` and `123` all pass with one character changed.

Fixing these belongs here, then repeating forward into steps 02, 03 and 04.
