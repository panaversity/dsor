# Step 26 · Money done right

**New in this step:** two amounts in two currencies are compared exactly, at rates DSoR looks up
itself, and an amount it cannot convert counts as over the limit.

## In plain words

Until this step, every amount DSoR compared was in dollars, like `del_100`'s limits: 50,000.00 USD a
payment and 200,000.00 USD a day. Now `VENDOR-44` sends two bills in other currencies: INV-1010 for
2,800,000.00 Pakistani rupees (PKR), and INV-1011 for 45,000.00 British pounds (GBP).

To compare a bill in rupees with a limit in dollars, DSoR needs an *exchange rate*: how many rupees
one dollar buys. Each company now has a **rate service** to ask. In this story it says that one US
dollar buys 280 PKR, or 0.80 GBP, and it says when it published that. DSoR asks it itself, at the
moment it decides. It never takes a rate from the request: an agent that says a dollar buys a
million rupees could make any bill look small.

Then DSoR compares **exactly**. "Is 2,800,000 PKR more than 50,000 USD?" becomes "is 2,800,000 more
than 50,000 × 280, which is 14,000,000?" It multiplies and never divides, so nothing is ever rounded.

```ts
const rates = ratesOf("org_456"); // org_456's rate service, asked only if a rate is needed
exceeds(money("2800000.00", "PKR"), money("50000.00", "USD"), rates); // false: 10,000.00 USD
exceeds(money("45000.00", "GBP"), money("50000.00", "USD"), rates); // true: 56,250.00 USD
```

So the bill in rupees is paid, and the bill in pounds is refused.

The day's limit counts in dollars. A payment in rupees is converted when it is booked against the
day, and rounded **up** to the cent: 1,000,000.00 PKR is 3,571.428571... USD, and the day counts
3,571.43. The day can count a fraction of a cent too much, never too little. The booking keeps that
number, so a payment that fails gives back exactly what it took, even if the rate has moved since.

When DSoR cannot convert, the strict answer wins: the limit counts as exceeded, and the refusal says
why. It cannot convert when the service has no rate for the currency, when its newest rates are more
than three days old, when it does not answer, or when the company has no service at all. Two amounts
in one currency need no rate, so a bill in dollars is paid even while the service is down.

## Why it matters

Step 25 refused every bill in another currency than the limit's: "cannot be compared". That is
safe, and it means the agent can never pay a foreign bill, not even one rupee. Someone will want a
quick fix, and each quick fix is a hole. These were measured in Node:

- **Compare the numbers, and forget the currency.** 45,000 is less than 50,000, so 45,000.00 GBP
  goes through a limit of 50,000.00 USD. At 0.80 pounds to the dollar it is 56,250.00 USD.
- **Check only the amounts in dollars.** Then 50,000,000.00 PKR, about 178,571 USD, goes through with
  no check at all. The specification names this hole in
  [§9](../../../specs/dsor/01-model.md#9-money-and-currency).
- **Convert with JavaScript numbers.** They are not exact for decimals: `0.1 + 0.2` is
  `0.30000000000000004`. At 281.15 rupees to the dollar, 14,057,500.00 PKR is exactly 50,000.00 USD,
  and dividing gives `50000.00000000001`, so a payment exactly at the limit is refused.

## What changed since step 25

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_25_revocation_and_the_emergency_brake ../my_26_money_done_right
```

| File | What |
| --- | --- |
| `src/exchange.ts` | new — `compare`, `exceeds` and `covers`, exact in any two currencies because they multiply and never divide; `CannotConvert` for a missing, zero, negative or unreadable rate; `convertUp`, rounded up to the cent; `plus` |
| `src/rates.ts` | new — the fake rate service, one per company, which a test or the demo can change, make old, or switch off; `ratesOf`, which asks it once, only when a rate is needed, copies the answer, and refuses rates more than three days old or dated in the future |
| `migrations/027_bills_in_rupees_and_pounds.sql` | new — VENDOR-44's INV-1010, 2,800,000.00 PKR, and INV-1011, 45,000.00 GBP |
| `src/operations.ts` | §21.10 compares the limit per payment through `exceeds`, books the day's amount converted and rounded up, and treats an amount it cannot convert as over, with the reason; it asks for the company first, because the rates are the company's |
| `src/money.ts`, `src/authority.ts` | export the decimal pattern and step 19's two time checks, for the new files |
| `src/payment.ts` | `centsOf` removed; a payment is still in its invoice's currency |
| `src/main.ts` | the bill in rupees paid, the one in pounds refused, and rupees refused at rates four days old |
| `src/database.ts` | two comments: the start-up gaps wait for step 26b |
| `test/exchange.test.ts`, `test/rates.test.ts`, `test/money-limits.test.ts` | new — exactness at the boundary, every reason a rate cannot be used, both limits in other currencies, the dry run, rates planted in a request, and a failed payment giving back what it booked |
| `test/main.test.ts` | the demo's money section, and the log's new totals |
| `test/bounded-queries.test.ts`, `test/classified-reads.test.ts`, `test/versions.test.ts` | four invoices in the story, not two |
| `test/delegations.test.ts`, `test/limits.test.ts`, `test/payments.test.ts` | titles and comments that said another currency cannot be compared |
| `test/support/story.ts` | the story's tests put the two bills back |

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes after the brake:

```text
VENDOR-44 bills in rupees and in pounds. One US dollar buys 280 PKR, or 0.80 GBP:

accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-914  draft      compensatable
                        withheld: amount (clearance)
accounts-payable-fte  LIMIT_EXCEEDED           retry: after_delay          45000.00 GBP is above del_100's limit of 50000.00 USD a payment
  the day had used 184600.00 USD, and has used 194600.00 USD of 200000.00

The rate service has published nothing for four days. A bill in rupees, and one in dollars:

accounts-payable-fte  LIMIT_EXCEEDED           retry: after_delay          28000.00 PKR cannot be compared with del_100's limit of 50000.00 USD a payment, so it is refused: org_456's newest rates are more than three days old
accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-915  draft      compensatable
                        withheld: amount (clearance)
```

The rupees are paid, and the day rises by exactly 10,000.00 USD. The pounds are refused before
anything is booked: 45,000.00 GBP is 56,250.00 USD, above the limit of one payment. Then the rate
service is made four days old for a moment. A bill in rupees cannot be compared, and is refused with
the reason. A bill in dollars needs no rate, and is paid. The agent's receipts withhold the amount,
as they have since step 14: the agent is not cleared to read amounts.

Run it a second time, without deleting `.local-database`, and the bill in rupees is refused by the
day instead: the first run's payments still count, and 10,000.00 USD would take the day past
200,000.00.

### The database tier

`pnpm check` needs no server. The seventy-five tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_25_revocation_and_the_emergency_brake/.env .env     # then dsor_step25 -> dsor_step26 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step26` through the owner
login. `pnpm migrate` applies the twenty-seven migrations; on a server that already had step 25's
twenty-six, it applies 027. This step adds no test to the tier. Money is compared in the program,
before the database is asked anything, and the statement that books a day is step 24's, unchanged:
it is handed an amount already in dollars. Run on a throwaway PostgreSQL 17 on this machine on 2026-10-16, with an owner shaped like Neon's: 75 passed. It has not yet run on Neon: `dsor_step26` does not exist yet.

## Break it

Three, each measured on the full suite in a copy outside the repository, where one test skips
because the specification is not beside it, so the total reads `1079` with `1 skipped`; in the
repository it is `1079 passed`.

### Break 1 · forget the currency

The first quick fix. In `src/exchange.ts`, in `compare`, change
`if (a.currency === b.currency) {` to `if (a.currency === a.currency) {`, so every pair of amounts is
compared as numbers.

```text
      Tests  33 failed | 1045 passed | 1 skipped (1079)
```

Every comparison across two currencies goes wrong at once. The bill in rupees is refused, because
2,800,000 is more than 50,000. The bill in pounds is paid, because 45,000 is less. An amount in a
currency with no rate is compared without one. The demo prints the opposite of what it should, and
the log's totals change with it.

### Break 2 · JavaScript numbers

The third quick fix. In `src/exchange.ts`, in `compare`, replace the last line,
`return order(times(exact(a.value), bRate), times(exact(b.value), aRate));`, with a division of
`Number(a.value)` by its rate and of `Number(b.value)` by its rate, compared with `<` and `>`.

```text
      Tests  2 failed | 1076 passed | 1 skipped (1079)
```

Only two, and that is the point: floats are wrong rarely, and exactly where it matters. 14,057,500.00
PKR at 281.15 is exactly the limit and comes out above it, and the largest amount a payment may
hold, converted to dollars, no longer comes out above an amount it is above by a fraction of a cent.

### Break 3 · what cannot be compared carries on

In `src/operations.ts`, in `checkTheSlipsLimit`, change
`if (against.kind === "cannot_compare") {` to `if (against.kind === ("never" as string)) {`.

```text
      Tests  5 failed | 1073 passed | 1 skipped (1079)
```

The service down, rates four days old, no service, a currency with no rate: each bill goes through
the limit per payment as if it were within it. The demo's rupees at old rates are paid.

## Build it yourself with Claude Code

Copy `my_25_revocation_and_the_emergency_brake` to a new folder, without its `.env`, and ask:

> Start step 26, money done right. Before any code: show me a bill in rupees against del_100's limit
> in dollars, what step 25 does with it, and every quick fix that would be a hole. Then ask me the
> step's decisions one at a time. Then build it a piece at a time, red first, and break each piece
> on purpose.

## Check yourself

1. Why is "45,000 is less than 50,000" the wrong question for a bill of 45,000.00 GBP and a limit of
   50,000.00 USD?
2. `exceeds` never divides. What would dividing get wrong, and how does it compare without it?
3. The rate service is down. Can the agent pay a bill in dollars? A bill in rupees? Why the
   difference?
4. A payment of 1,000,000.00 PKR is booked against the day. Why 3,571.43 USD, and not 3,571.42?
5. The agent sends `"rates": { "GBP": "100" }` with its payment. What does DSoR do with it?

<details>
<summary>Answers</summary>

1. Because the two numbers are in different units. At 0.80 pounds to the dollar the bill is
   56,250.00 USD, above the limit. Numbers can only be compared once both are in one currency.
2. Dividing can leave a number with no end, like 1,000,000 / 280, and JavaScript rounds it:
   14,057,500.00 PKR at 281.15 comes out a hair above 50,000.00 USD, though it is exactly that.
   `exceeds` asks "is a × (b's rate) above b × (a's rate)?" instead, which multiplies exact decimals
   and so stays exact.
3. The bill in dollars, yes: two amounts in one currency need no rate. The bill in rupees, no: it
   cannot be converted, so the limit counts as exceeded (`DSOR-MON-04`), and the refusal says the
   service did not answer.
4. 3,571.428571... is rounded up, so the day counts a fraction of a cent too much rather than too
   little. Rounded down, a payment of 0.01 PKR would count as nothing and fit into a full day.
5. Nothing. The rates come from `ratesOf(tenant)`, the company's own service, and the stage never
   reads them from the request. A test sends exactly that and is still refused.

</details>

## The rules this step meets

- **[DSOR-MON-02 · L1]** Monetary arithmetic and comparison MUST use decimal arithmetic.
  ([§9](../../../specs/dsor/01-model.md#9-money-and-currency))
- **[DSOR-MON-03 · L2]** A monetary threshold in a control or delegation MUST be compared only
  through the `dsor_*` money functions, which convert both operands to the threshold's currency
  using the tenant's rate source — claimed here for a slip's two limits. Controls arrive in step 27.
- **[DSOR-MON-04 · L2]** When an amount cannot be converted, the comparison MUST resolve
  restrictively — the delegation limit's half: treated as exceeded.
- **[DSOR-MON-06 · L2]** A cumulative limit MUST accumulate in the limit's own currency, converting
  each reservation at the rate in force when the reservation is taken.

**What this step leaves, said plainly.** The rate service is a fake with fixed rates. A real one may
not publish every currency, and a company whose service has no rupee rate has every rupee bill
refused, as it should. How old a rate may be is one setting for every company, three days, where
the specification gives each company its own `max_rate_age`. The day's booking compares in its own
statement, not through `exceeds`, because that statement is what keeps requests at once from booking
past the limit; it is handed an amount `convertUp` already converted. Every limit is counted in
hundredths, so a limit in a currency with three decimals would be rounded up to two. A refusal that
could not convert is `LIMIT_EXCEEDED`, whose retry class says to try again later, which is right for
old rates and pointless for a currency with no rate. The decision's record does not say which rate
was used: that is `DSOR-MON-05`, in the step that builds the decision bundle. A payment is still in
its invoice's currency. A dry run reads the day's total without checking its currency, which an
administrator who changes a slip's daily currency mid-day could make answer wrongly (decision 160).
The map's step 26 speaks of "a table of exchange rates"; this build asks a service instead
(decision 159). And the four start-up gaps that steps 18, 22 and 25 sent here wait for step 26b.

Everything earlier steps claimed still holds.

**Next:** step 26b, the start-up gaps that decision 145 had sent to step 26 and decision 159 gave a
step of their own. Then step 27, `controls_in_cel`: the policy "payments above 25,000 USD need the
CFO", written as a rule that calls `dsor_exceeds`, this step's `exceeds`.
