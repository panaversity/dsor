# Step 21 · Optimistic concurrency

**New in this step:** a command says which version of the record it decided on. If the record has
moved on since, DSoR refuses with `STALE_STATE`: read it again, and decide again.

## In plain words

Every invoice and payment now has a *version*: a whole number that starts at 1 and goes up by one
every time the record changes. A read says the version, beside everything else.

A command that changes a record is *optimistic*: it assumes nobody else changed the record since
the caller read it, and checks. The caller says the version it decided on:

```ts
await callOperation(agent, "payment.cancel", { payment, expected_version: 1 }, { idempotencyKey });
```

DSoR makes the change only if the record is still at that version, and raises the version in the
same database statement. If somebody else changed the record in between, the version has moved on,
and the command is refused with `STALE_STATE`, retry `after_state_refresh`: the caller's decision
was about a record that no longer exists. On the version it has now, the record's own rules answer:
an invoice already issued is `CONFLICT`, as before.

`invoice.issue` and `payment.cancel` are optimistic. `payment.create` makes a new record, so nothing
can have moved on, and its contract says `none`. Every command's contract says which it is.

Where does the caller get a version? From what it read. `invoice.get` and `invoice.list` return
it with each invoice. Payments have no read operation yet, so the agent takes a payment's version
from the receipt that made or changed it: a new payment starts at 1, and each change adds one.

The version the caller sends is one of the request's arguments, `expected_version`, so it is part of
the request's fingerprint from step 20. The same key with another version is another request, and
gets `IDEMPOTENCY_CONFLICT`. A version is a whole number from 1 to 2147483647, the largest number the
column holds. Anything else, or none, is refused `VALIDATION_FAILED` at §21.6, and that refusal is
recorded as a DENY like any other.

`STALE_STATE` does not say what the version is now. If it did, an agent could retry with that number
without reading the record again, and decide about a record it has never seen.

## Why it matters

The agent reads PAY-902, a draft, and decides to cancel it. Before its request arrives, `user_123`
cancels the same payment by hand. Without a version, the agent's command runs against a record that is
no longer the one it read. Often the status saves it, because a cancelled payment is no longer a
draft. But a record can change and still look the same: an invoice put back to draft looks like the
draft the agent read, and without a version the agent would act on something nobody had looked at.
With the version, the agent is told the record moved on, and reads it again.

## What changed since step 20

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_20_idempotency_keys ../my_21_optimistic_concurrency
```

| File | What |
| --- | --- |
| `migrations/019_versions.sql` | new — a `version` column on invoices and payments, a whole number from 1, and the application may change it |
| `src/invoice.ts`, `src/payment.ts` | every invoice and payment says its version; issuing and cancelling check the version in the same UPDATE that makes the change, raise it by one, and say `stale` when it has moved on |
| `src/operations.ts` | §21.6 asks every optimistic command for `expected_version`; a stale record is `STALE_STATE`, retry `after_state_refresh`, and the message holds no number |
| `src/registry.ts`, `src/contracts/*.json` | each command's contract says its strategy, `optimistic` or `none`, and the registry refuses one this program does not carry out |
| `src/classification.ts` | the version is `internal`, like the status |
| `src/database.ts` | start-up refuses an application that may set a new payment's version, or change an invoice's vendor or amount |
| `src/main.ts` | the agent issues INV-1009 on the version it read, cancels on the version from its receipt, and two decide on the same payment |
| `test/versions.test.ts` | new — the column, the strategies, the version checked and refused, and a change that raises it |
| `test/versions.db.test.ts` | new — twenty cancels of one payment on one version, at once, over a pool |
| the tests that send a command | each says the version it decided on |

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes after the fifty requests:

```text
Two decide on the same payment, on the same version:

user_123              COMMITTED                dsor://org_456/payment/PAY-905  cancelled  atomic
accounts-payable-fte  STALE_STATE              retry: after_state_refresh  PAY-905 has changed since the version the decision was made on; read it again and decide again
```

The agent makes PAY-905, a draft at version 1, and decides to cancel it. Before its request arrives,
`user_123` cancels it by hand, on version 1, and the payment moves to version 2. The agent's cancel
says version 1 and is refused. The retry says what to do: read again, then decide again.

Earlier in the demo, the agent issues INV-1009 on the version it read, and cancels a payment on
the version its receipt gave. In the printed log, the stale cancel is record 40, and it says
`ALLOW`: the log records the decision, and the decision was to let the agent try. The record had
moved on when the command ran.

### The database tier

`pnpm check` needs no server. The fifty-three tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_20_idempotency_keys/.env .env     # then dsor_step20 -> dsor_step21 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step21` through the owner
login. `pnpm migrate` applies the nineteen migrations; on a server that already had step 20's
eighteen, it applies 019. The new test sends twenty cancels of one payment, all on version 1, at
once over a pool of twenty connections: one is made, nineteen are told the payment is stale. That
proves one change and not two. It does not prove the version check on its own, because a cancel
also asks for a draft. The unit tier proves that, with a draft decided on as the wrong version.

## Break it

Three, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `718` with `1 skipped`; in the repository it is `718 passed`.

### Break 1 · the version is not in the UPDATE

The map's "break it". In `src/invoice.ts`, change `AND status = 'draft' AND version = $3` to
`AND status = 'draft' AND $3::int > 0`, which still uses the number and no longer compares it.

```text
 Tests  2 failed | 715 passed | 1 skipped (718)
```

Only two, and that is the lesson. In almost every stale case the record also left the draft state,
so the status refuses it with or without the version. The two that fail are the cases where only
the version can tell: a draft decided on as version 7, and a draft an owner put back to draft at
version 3, decided on as version 1. Both are issued without the version, by a caller who never saw
them as they are.

### Break 2 · an issue does not raise the version

In `src/invoice.ts`, change `SET status = 'issued', version = version + 1` to
`SET status = 'issued'`.

```text
 Tests  6 failed | 711 passed | 1 skipped (718)
```

The record changes and its version stays at 1, so a caller who decided on version 1 finds the
version it expects and is told `CONFLICT`, "already issued", instead of `STALE_STATE`, "you decided
on something that has changed". The tests of the version going up, of the stale invoice, of the
race, and two older tests that issue an invoice twice and expect the second attempt, on the old
version, to be stale.

### Break 3 · §21.6 does not ask for the version

In `src/operations.ts`, change `strategy === "optimistic") {` to `strategy === "pessimistic") {`.

```text
 Tests  1 failed | 716 passed | 1 skipped (718)
```

A command with no version is still refused, because the handler asks again. But it is refused after
§21.11 has recorded `ALLOW`, so the log says a request was allowed that was never valid. The one test
that reads the log after a missing version.

## Build it yourself with Claude Code

Copy `my_20_idempotency_keys` to a new folder and ask:

> Start step 21, optimistic concurrency. Before any code: show me two people deciding on the same
> payment at once, and what happens to the second. Then ask me the step's decisions one at a time.
> Then build it a piece at a time, red first, and break each piece on purpose.

## Check yourself

1. The agent read INV-1009 at version 1. Before it issues it, `user_123` issues it by hand. What
   does the agent's `invoice.issue` with `expected_version: 1` get, and what should it do next?
2. Why is the version checked in the UPDATE itself, and not by reading the record first and
   comparing?
3. Why does `STALE_STATE` not say what the version is now?
4. Why is `payment.create` `none` and not `optimistic`?
5. A cancel with the version taken out of its UPDATE still passed the race of twenty. Why, and what
   test catches it?

<details>
<summary>Answers</summary>

1. `STALE_STATE`, retry `after_state_refresh`. It reads the invoice again, sees it is issued, and
   decides again on what it sees now. Here there is nothing left to do.
2. A read and then a write are two steps, and another change can land between them. In one UPDATE,
   the check and the change happen together, and the database lets one of two changes through.
3. With the number, an agent could send it straight back without reading the record, and decide
   about a record it has never seen. Without it, the only way to a current version is a read.
4. It makes a new record, so there is no earlier version anyone could have decided on.
5. A cancel also asks for a draft, and only one of the twenty finds a draft. The status refuses the
   other nineteen, with or without the version. A draft decided on as version 7, which the status
   would let through, catches it.

</details>

## The rules this step meets

- **[DSOR-CON-01a · L2]** Every command MUST declare its concurrency strategy.
  ([§23](../../../specs/dsor/03-execution.md#23-concurrency))
- **[DSOR-CON-01b · L2]** An optimistic command MUST return `STALE_STATE` when the resource version
  differs from the version the decision was made on.

**What this step leaves, said plainly.** Only the application raises the version. An owner who edits
a row by hand leaves its version where it was, and a decision on the old version still matches. A
row deleted and written again starts at 1, so an old decision on version 1 matches a different
record. Every new record starts at 1, so `expected_version: 1` does not prove the caller read
anything. The read label still has no `resource_version` beside its time, so `DSOR-FRS-01a` is met
in part. Payments have no read operation, so the agent knows a payment's version only from a
receipt. The strategies `pessimistic` and `connector_managed` are refused at load rather than
carried out. The log records the decision and not what happened after, so a stale command shows as
`ALLOW`. Two decisions in one company at the same moment race for the next place in its log, and
the database tier races the change itself, not the log.

Everything earlier steps claimed still holds.

**Next:** step 22, `proposals_and_their_states` — every attempt to run a command becomes a record
with a state you can look up, like an order-tracking page.
