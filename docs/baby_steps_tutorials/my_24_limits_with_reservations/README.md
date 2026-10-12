# Step 24 · Limits with reservations

**New in this step:** del_100 may spend 200,000.00 USD a day as well as 50,000.00 a payment. A
daily limit is a running total, and a running total has a race; each payment *reserves* its amount
against the day in one database statement, like booking the last hotel room.

## In plain words

Until now del_100 limited each payment to 50,000.00, and nothing else. The agent could make a
hundred payments of 49,999.00 in a day. Now the slip also says how much it may spend in a day, and
DSoR keeps a running total for each slip and each day.

The obvious way to keep a running total is wrong. "Read the total, check that the new payment fits,
then write the new total" has a gap between the read and the write, and fifty payments arriving at
once each read the same total, each find room, and together spend far past the limit. So the total
is never read and then written. Each payment *books* its amount in one statement that adds it only if
the total stays within the limit:

```sql
INSERT INTO dsor.day_totals ... SELECT ..., amount, ... WHERE amount <= limit
ON CONFLICT (tenant, delegation, day) DO UPDATE SET used_value = used_value + amount
 WHERE used_value + amount <= limit
```

The day's first payment starts the total, and only if its amount alone is within the limit. Every
later payment adds to the total, and only if the sum stays within the limit. Both conditions are
needed: without the first, a single payment of 250,000.00 on an empty day would be booked.

Of two payments that arrive together, PostgreSQL makes the second wait for the first, then checks
again on the total the first left. Only one can have the last room.

The booking is a *reservation*, keyed by the payment's proposal from step 22, so the same proposal
never books twice. It follows its proposal:

- **held** while the proposal may still run: READY, EXECUTING, or OUTCOME_UNKNOWN, when nobody knows
  whether it ran;
- **committed** when the proposal is COMMITTED: the amount stays on the day;
- **released** when it is FAILED or DENIED: the amount is given back to the day.

A reservation is settled only when the proposal's history holds the move that says so. One that
cannot be settled stays held, and counts against the day: the limit errs toward refusing, never
toward paying more.

Only a payment books. An `amount` written into another command, an `invoice.issue` for example,
books nothing: that command spends nothing.

A dry run, `validate_only`, books nothing: it reads the room left and answers from it. A prepared
command, `propose_only`, books and holds, because it may still run. An amount in another currency
than the limit's is over it, until step 26 brings exchange rates: an amount that cannot be compared
is refused, never let through.

A day is a calendar day in UTC, on the database's clock, so every server agrees which day a payment
is booked on.

## Why it matters

A limit per payment says nothing about how many payments there are. The specification's slip has a
daily limit beside it for exactly that reason, and the daily limit is the one with the race: a check
that is right when payments arrive one at a time and wrong when fifty arrive at once is a check that
passes every test you write one at a time.

## What changed since step 23

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_23_three_ways_to_call ../my_24_limits_with_reservations
```

| File | What |
| --- | --- |
| `migrations/022_daily_limits_and_reservations.sql` | new — a slip's daily limit, one running total per slip per day, reservations keyed by proposal, and a second policy that keeps a settled reservation |
| `migrations/023_del_100_has_a_daily_limit.sql` | new — del_100 may spend 200,000.00 USD a day |
| `src/reservation.ts` | new — reserve in one statement, settle in one statement when the proposal's history says so, and how much the day has used |
| `src/delegation.ts` | the slip says its daily limit |
| `src/operations.ts` | §21.10 books each payment against the day after its limit per payment, and a dry run only reads the room; the door settles the reservation as the proposal ends |
| `src/database.ts` | start-up knows ten tenant tables, asks for the second policy, and refuses an application that may delete a total or a reservation |
| `src/main.ts` | ten payments of 25,000.00 against the day, one after another |
| `test/limits.test.ts` | new — the limit, booking, the race of fifty reservations, settling with the history, the door's payments and their reservations, and a booking the store refuses |
| `test/limits.db.test.ts` | new — fifty reservations at once on a real server, and fifty payments through the door racing for room for one |
| `test/main.test.ts` | ten more decisions in the demo's log, and what a second run the same day changes |
| `test/database.test.ts` | start-up refuses an application that may delete a total or a reservation, or write one settled, and the reservations without the policy that keeps a settled one |
| `test/control-plane-store.test.ts` | the day totals and the reservations are in DSoR's own schema |
| `test/support/story.ts` | putting the story back empties the day totals and the reservations, and gives del_100 its daily limit again |
| `test/support/one-day.ts` | new — a test that counts one day's bookings is skipped, not failed, when midnight UTC falls while it runs |

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes after the three ways to call:

```text
del_100's day: 200000.00 USD. Ten payments of 25,000.00, one after another:

  the day had used 34500.00 USD before them
  made 6, refused 4
accounts-payable-fte  LIMIT_EXCEEDED           retry: after_delay          25000.00 USD would take del_100 past its limit of 200000.00 USD a day
  the day has used 184500.00 USD of 200000.00
```

34,500.00 before them: the agent's five payments in the sections above, 34,100.00, two of them
since cancelled, and the 400.00 prepared in step 23's section, whose reservation is held while it
waits at READY. Cancelling a payment does not give its amount back to the day. Six of the ten fit,
and the seventh would pass 200,000.00.

They go one after another on purpose. Sent at once, almost all of them would be refused for a
reason that is not the limit: decisions in one company at one moment race for the next place in its
log, and the log refuses the loser, `EVIDENCE_STORE_UNAVAILABLE`, safe to send again. The race on
the limit itself is the database tier's.

The day's total is kept between runs. Run the demo a second time on the same day, and the day is
nearly full from the first run, 184,500.00: the second run's 31,400.00 payment is refused
`LIMIT_EXCEEDED`, so the two cancels of it never happen; the smaller payments still fit, and all ten
of 25,000.00 are refused. Tomorrow, in UTC, the day starts again.

### The database tier

`pnpm check` needs no server. The fifty-seven tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_23_three_ways_to_call/.env .env     # then dsor_step23 -> dsor_step24 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step24` through the owner
login. `pnpm migrate` applies the twenty-three migrations; on a server that already had step 23's
twenty-one, it applies 022 and 023. The two new tests are the step's "done when", where it can fail:
fifty reservations of 5,000.00 at once over a pool of twenty connections book exactly forty, and the
day stops at 200,000.00; and with 195,000.00 booked first, fifty payments at once through the door
race for room for one, and at most one is made. Broken on purpose, reading the total and then
writing it, the first booked all fifty and the second made three.

## Break it

Three, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `806` with `1 skipped`; in the repository it is `806 passed`.

### Break 1 · read the total, check it, then write it

The map's "break it", the mistake §13.4 names. In `src/reservation.ts`, replace the one booking
statement with two: a SELECT of the day's total, a check in TypeScript that the amount fits, and
then the INSERT that adds it, with no condition.

```text
 Tests  1 failed | 804 passed | 1 skipped (806)
```

One: the fifty reservations at once. Every other test books one payment at a time, and every one of
them still passes, which is exactly why the mistake is so easy to make. On a real server, in the
database tier, the same break booked all fifty, 250,000.00, and through the door made three payments
where there was room for one.

### Break 2 · a release keeps its amount on the day

In `src/reservation.ts`, change `WHERE $3 = 'released' AND` to `WHERE $3 = 'never' AND`.

```text
 Tests  4 failed | 801 passed | 1 skipped (806)
```

A refused payment is marked released, and its amount still counts against the day: each refusal
takes room from the day for nothing. The tests of a release, of a handler's refusal, of a decision
that could not be recorded, and of a settled reservation.

### Break 3 · a dry run books

In `src/operations.ts`, in the daily limit's part of `checkTheSlipsLimit`, change
`if (context.mode === "validate_only") {` to `if (context.mode === ("never" as string)) {`.

```text
 Tests  4 failed | 801 passed | 1 skipped (806)
```

A dry run has no proposal to book for, so it is refused for that: the agent can no longer ask "would
this payment be allowed?". The tests of a dry run in this step and in step 23, and the demo's three
ways, whose dry run is now refused.

## Build it yourself with Claude Code

Copy `my_23_three_ways_to_call` to a new folder and ask:

> Start step 24, limits with reservations. Before any code: show me five payments of 50,000.00
> arriving at the same moment against a daily limit of 200,000.00, and how all five get through. Then
> ask me the step's decisions one at a time. Then build it a piece at a time, red first, and break
> each piece on purpose.

## Check yourself

1. del_100 may spend 50,000.00 a payment. Why is that not enough?
2. Why is the day's total never read before it is written?
3. The agent's payment is refused because its handler finds no such invoice. What happens to its
   reservation? And a payment whose handler crashed half way?
4. A prepared payment, `propose_only`, waits at READY. Does its amount count against the day?
5. Fifty payments sent at once: why are most of them refused, and is it the limit that refuses them?

<details>
<summary>Answers</summary>

1. A limit per payment says nothing about how many payments there are: a hundred payments of
   49,999.00 are each within it.
2. Between the read and the write, another payment reads the same total and finds the same room.
   One statement that adds the amount only if the total stays within the limit leaves no gap.
3. It is released, and its amount given back: FAILED says nothing was done. A crashed one is
   OUTCOME_UNKNOWN, and its reservation stays held, because nobody knows whether it ran.
4. Yes. It may still run, so it holds its reservation.
5. Most lose the race for the company's log and are refused `EVIDENCE_STORE_UNAVAILABLE`, safe to
   send again. The limit refuses only what would pass it; with room for one, at most one is made.

</details>

## The rules this step meets

- **[DSOR-DEL-06a · L2]** Cumulative limits MUST be enforced with atomic reserve, commit, and release
  operations in the control-plane store.
  ([§13.4](../../../specs/dsor/02-security.md#134-cumulative-limits))
- **[DSOR-DEL-06b · L2]** A reservation MUST be keyed by proposal id, so that re-evaluating the same
  proposal never reserves twice.
- **[DSOR-DEL-06c · L2]** A reservation MUST stay held while its proposal is `PENDING_APPROVAL`,
  `APPROVED`, `EXECUTING`, or `OUTCOME_UNKNOWN`.
- **[DSOR-DEL-06d · L2]** A reservation MUST be released when its proposal reaches `FAILED`,
  `REJECTED`, `EXPIRED`, `CANCELLED`, `REVOKED`, or `INVALIDATED`.
- **[DSOR-DEL-06e · L2]** A command that would exceed a limit MUST be refused with `LIMIT_EXCEEDED`.

**What this step leaves, said plainly.** The application's own code could still make room on a full
day: it may change a day's total and insert reservations, and a reservation inserted for a proposal
that booked nothing, then released, gives back what it never took. It could as well write a payment
past the limit, because a payment is not tied to its reservation; that tie, which would make the
limit the database's and not only the pipeline's, is a later step's. What the database keeps is the
race and the settled reservation. Cancelling a payment does not give its amount back to the day.
Requests at once in one company mostly lose the race for its log, and a request that books and then
loses it holds its amount for a moment, so another can be refused `LIMIT_EXCEEDED` with room that is
given back a moment later: the limit errs toward refusing. One window, a day in UTC; the schema's
other windows, and the company's own time zone, are not built. An amount in another currency is
refused until step 26. The states of approval, and their holds and releases, come with step 29.

Everything earlier steps claimed still holds.

**Next:** step 25, `revocation_and_the_emergency_brake` — tear up the permission slip and its waiting
work is cancelled; suspend one agent, or freeze every agent in the company, without the agent's
cooperation.
