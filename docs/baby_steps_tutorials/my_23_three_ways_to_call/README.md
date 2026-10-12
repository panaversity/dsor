# Step 23 · Three ways to call

**New in this step:** every command can be called three ways. `execute` does it. `propose_only`
prepares it for someone else to release. `validate_only` is a dry run with no side effects at all.

## In plain words

Until now, sending a command meant doing it. Now the caller says how, beside its arguments and its
key:

```ts
await callOperation(agent, "payment.create", payment, { mode: "validate_only" });
await callOperation(agent, "payment.create", payment, { idempotencyKey, mode: "propose_only" });
await callOperation(agent, "payment.create", payment, { idempotencyKey }); // execute
```

- **`validate_only`** asks "would this be allowed?". Every check runs and the decision is written
  in the log, as `VALIDATED`, so the log never shows a dry run as something that ran. Nothing else
  happens: no proposal, no claimed key, no payment, not even a payment number taken. The answer is
  `VALIDATED`, with the decision, `ALLOW`. A dry run the rules refuse gets the same refusal a real
  one would. A dry run needs no key, because there is nothing to send twice.
- **`propose_only`** prepares the command and stops. The key is claimed, the proposal is made, every
  check runs, and the proposal moves to READY, "waiting to be released", and stays there. The answer
  is `READY` with the proposal's address. Releasing it is `proposal.execute`, which checks
  everything again on live data; that is step 31.
- **`execute`**, the default, is what every command did before.

A query is only ever read, so it has one way to be called.

How it is called is part of the request. The idempotency claim keeps the mode beside the
fingerprint, so the same key sent in another mode is `IDEMPOTENCY_CONFLICT`. Without that, a key
used to prepare a payment, sent again to execute it, would be handed the prepared answer, and the
caller would believe it had executed.

The mode is read once, and only the request's own. One that cannot be read, a getter that throws or
a mode on the request's prototype, is refused with `VALIDATION_FAILED`, never taken as `execute`:
the caller who asked for a dry run must never get a payment.

## Why it matters

The agent is planning tomorrow's payment run and wants to know which payments the rules would
refuse. Without a dry run, the only way to ask is to send them, and every one that is allowed is
made at once. And there is no way for the agent to do the preparing, the part it is good at, while a
person does the releasing. `validate_only` lets the agent plan without risk; `propose_only` lets it
prepare work that waits.

## What changed since step 22

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_22_proposals_and_their_states ../my_23_three_ways_to_call
```

| File | What |
| --- | --- |
| `migrations/021_the_claim_keeps_its_mode.sql` | new — the claim keeps the mode it was made in, written with the claim and never changed |
| `src/operations.ts` | the door reads the mode beside the key; §21.6 checks it; the claim and the proposal step aside for a dry run; §21.11 records a dry run as `VALIDATED`; the door answers a dry run, prepares a `propose_only` command to READY, and reads a lost reply back before it says nothing was done |
| `src/pipeline.ts` | the three modes, and the mode in the context |
| `src/envelopes.ts` | the result envelope has room for `READY` and `VALIDATED`, which carry no data, and their builders |
| `src/idempotency.ts` | the claim compares the mode as it compares the fingerprint |
| `src/database.ts` | start-up refuses an application that may change a claim's mode |
| `src/main.ts` | one payment called three ways, and the payments each made |
| `test/modes.test.ts` | new — the modes, the dry run, the prepared command, a lost reply read back, and how the mode is read |
| `test/main.test.ts` | three more decisions in the demo's log |

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes after the proposals:

```text
Three ways to call one payment of 400.00 USD for INV-1009:

accounts-payable-fte  VALIDATED                the decision would be ALLOW; nothing was done
accounts-payable-fte  READY                    dsor://org_456/proposal/prop_11  waiting to be released  compensatable
accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-906  draft      compensatable
                        withheld: amount (clearance)
  payments made: 0 by the first two, 1 by the third
```

The same request three times. The dry run is decided and answered; the prepared one becomes
prop_11, waiting at READY; only the third makes a payment. All three are in the log printed below
them, and the dry run says so:

```text
42  ALLOW  payment.create@1     user_123               VALIDATED               sha256:a5b5f82...  unattended: by accounts-payable-fte under del_100
```

### The database tier

`pnpm check` needs no server. The fifty-five tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_22_proposals_and_their_states/.env .env     # then dsor_step22 -> dsor_step23 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step23` through the owner
login. `pnpm migrate` applies the twenty-one migrations; on a server that already had step 22's
twenty, it applies 021. This step adds no test of its own to this tier: nothing in it races.

## Break it

Three, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `779` with `1 skipped`; in the repository it is `779 passed`.

### Break 1 · a dry run claims its key

The map's "break it" in spirit: a dry run that leaves something behind. In `src/operations.ts`, in
`claimTheKey`, change `if (context.mode === "validate_only") {` to
`if (context.mode === ("never" as string)) {`.

```text
 Tests  8 failed | 770 passed | 1 skipped (779)
```

More than the five predicted, and for one reason: a dry run sent without a key, as most of them are,
is now refused for not having one, because the claim wants a key to claim. So every dry run in the
tests and the demo fails, the one with a key leaves a claim behind, and the log's count changes.

### Break 2 · a dry run is recorded as ALLOWED

In `src/operations.ts`, change `? "VALIDATED"` to `? "ALLOWED"`.

```text
 Tests  1 failed | 777 passed | 1 skipped (779)
```

The one test that reads the log after a dry run. Nothing else notices, which is the point of the
test: a log that says ALLOWED for a payment that was never made reads like a payment that went
missing, and only someone reading the log would find out.

### Break 3 · a prepared command is carried out

In `src/operations.ts`, change `? await prepare(walked.context, progress)` to
`? await carryOut(walked.context, startedAt, progress)`.

```text
 Tests  6 failed | 772 passed | 1 skipped (779)
```

The caller asked to prepare a payment, and it was made. The tests of a READY answer, of the payment
not made, of the replay, of the two moves to READY that fail, and the demo's count of payments.

## Build it yourself with Claude Code

Copy `my_22_proposals_and_their_states` to a new folder and ask:

> Start step 23, three ways to call. Before any code: show me the agent planning a payment run and
> what it costs it today to find out which payments would be refused. Then ask me the step's
> decisions one at a time. Then build it a piece at a time, red first, and break each piece on
> purpose.

## Check yourself

1. The agent sends `payment.create` with `mode: "validate_only"`. What is written down, and what is
   not?
2. Why is a dry run recorded as `VALIDATED` and not `ALLOWED`?
3. A prepared payment is READY. How does it get made?
4. The agent prepares a payment with the key `pay-77`, then sends the same request with the same key
   to execute it. What happens, and why?
5. A request's mode is set on its prototype, not on the request itself. Why is it refused, when a key
   set the same way is simply missing?

<details>
<summary>Answers</summary>

1. The decision, in the log, as VALIDATED. No proposal, no claimed key, no payment, and no payment
   number taken.
2. The log is evidence. A line saying ALLOWED for a payment that was never made reads like a payment
   that went missing.
3. Not yet: `proposal.execute`, which checks everything again on live data, is step 31. Until then
   it waits at READY.
4. `IDEMPOTENCY_CONFLICT`. The claim kept the mode, and another mode is another request. Otherwise
   the caller would be handed the READY answer and believe it had executed.
5. A missing key is refused, so treating an unreadable key as missing is safe. A missing mode is
   `execute`, so treating an unreadable mode as missing turns a dry run into a payment.

</details>

## The rules this step meets

- **[DSOR-OPR-05 · L2]** Every command MUST support the `execute`, `propose_only`, and
  `validate_only` invocation modes. ([§7.3](../../../specs/dsor/01-model.md#73-invocation-modes))
- **[DSOR-OPR-06 · L2]** A `validate_only` invocation MUST NOT create a proposal, take a
  reservation, place a hold, or cause a side effect.

**What this step leaves, said plainly.** A dry run, and a prepared command, are decided without the
preconditions the handlers check: whether the version is current, whether the invoice exists. Those
run inside the handlers, which a dry run never reaches, so `expected_version: 99` is `VALIDATED`, and
a payment for an invoice that does not exist is READY. §21.9's preconditions become a stage of their
own in step 32, and a test pins today's behaviour until then. A prepared proposal waits at READY
with nothing to release it until `proposal.execute`, step 31, and nothing to cancel it either. The
`.propose` permission of §7.3, an agent allowed to prepare and not to execute, is not built. There
are no reservations or holds yet for a dry run to leave alone; step 24 brings the first. When a
move's reply is lost and the proposal cannot be read back, the answer is `OUTCOME_UNKNOWN` and the
key stays taken until reconciliation, step 37.

Everything earlier steps claimed still holds.

**Next:** step 24, `limits_with_reservations` — a daily limit, and the race two payments run
against it, closed by reserving the amount in one database step.
