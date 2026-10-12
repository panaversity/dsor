# Step 20 · Idempotency keys

**New in this step:** every command carries a key, a name for one logical request. DSoR claims the
key with one INSERT, keeps the request's fingerprint and its answer beside it, and a request sent
twice runs once.

## In plain words

Networks fail and clients retry. The agent sends `payment.create` for INV-1009, 2,500.00 USD. DSoR
makes the payment, and the answer is lost on the way back. The agent does what every careful client
does: it sends the request again. Before this step, DSoR made a second payment.

Now every command carries an *idempotency key*: a name the caller chooses for one logical request,
new for each new request, the same for a retry of the same one. DSoR claims the key the first time
it sees it, in DSoR's own store, `dsor.idempotency_keys`, with the request's fingerprint, its payload
hash, beside it:

- **The same key and the same request:** DSoR gives the answer it gave the first time, word for
  word. Nothing runs again, and no second decision is recorded, because none is made.
- **The same key and a different request:** refused, `IDEMPOTENCY_CONFLICT`. A new request needs a
  new key.
- **The same request still being carried out:** DSoR waits for it, up to two seconds, and then gives
  its answer. If it has none by then, the caller is told `OUTCOME_UNKNOWN`: nobody knows yet.
- **A command with no key:** refused, `VALIDATION_FAILED`. Queries change nothing and need none.

The key is claimed by **one** INSERT, protected by a primary key on the company, the caller who
logged in, the operation and the key. Two requests with the same key that arrive at the same moment
both reach that INSERT, and the database lets exactly one in. Checking "does this key exist?" and
then inserting it, as two steps, is the mistake §22 names: both checks pass, and both requests run.

The key travels beside the arguments, never inside them. A door now takes a fourth thing, the
request's options:

```ts
await callOperation(agent, "payment.create", { invoice, amount }, { idempotencyKey: "pay-1009" });
```

So the payload hash stays the fingerprint of what was asked, and the same request sent twice has the
same fingerprint whatever its key. The claim is the new stage at §21.7, after the input is validated,
because the claim keeps that fingerprint, and before anything is decided that a retry must not decide
twice. Every answer to a claimed request, a receipt or a refusal, is written on the claim, as the text
it was written, so the same request is given it again word for word.

One answer is not kept: a refusal before anything ran that invites the same key again, such as
`EVIDENCE_STORE_UNAVAILABLE`. It releases the claim, and the next request with the same key and the
same request takes it back, in one UPDATE, so that of fifty retries only one does. Only a refusal
from the checks: an answer given after a payment was made is kept whatever it says, or a careless
handler's "safe to send again" would make a second payment.

A release is written once and never tried again. Its write can succeed and its reply can be lost,
and by then the next request may have taken the claim back. A second try would release that
request's claim while it runs. Its receipt would be kept nowhere, and a third request with the key
would make a second payment. A kept answer is tried once more, because only a released claim is
ever taken back: a second try can only meet its own claim.

An answer once kept is never rewritten. The application may write a claim's answer, which would let
it rewrite one too, so a second policy on the table, restrictive, lets an UPDATE touch only a claim
with no answer or a released one, and start-up refuses the table without it. And a replayed answer
must be an answer to the same caller, or it is refused as the program's own error.

## Why it matters

The agent pays VENDOR-44 for INV-1009: `payment.create`, 2,500.00 USD. DSoR makes the payment, a
draft, and the network drops the answer. The agent cannot know whether the payment was made, so it
does what it was built to do and sends the request again. Before this step DSoR made a second draft,
and the company owed VENDOR-44 one payment and held two for it. Once payments execute, in a later
step, that is money sent twice.

Now the retry carries the same key, and DSoR answers with the first payment's receipt and makes
nothing. And if the agent sends fifty at once, because a loop went wrong, the database lets exactly
one claim the key: the other forty-nine wait for its answer and are given it.

## What changed since step 19

```bash
# in Git Bash on Windows
diff -r --exclude=node_modules --exclude=.env --exclude=.local-database ../my_19_unattended_mode_and_the_role_source ../my_20_idempotency_keys
```

| File | What |
| --- | --- |
| `migrations/018_idempotency_keys.sql` | new — `dsor.idempotency_keys`: the company, the caller, the operation and the key as one primary key, the request's fingerprint, and its answer as text; the application claims and answers, and deletes and rewrites nothing; the second lock, and a second policy that keeps an answer once written |
| `src/idempotency.ts` | new — the claim, in one INSERT, and what a request finds when it is not the first; the answer written on the claim, or the claim released |
| `src/operations.ts` | the stage at §21.7; the door takes the request's options, and writes the answer on the claim whichever way it ends; §21.11 refuses a command with no claim |
| `src/pipeline.ts` | a walk may end with an answer given before, `replayed`; the context carries the key and the claim |
| `src/registry.ts`, `src/contracts/*.json` | every command's contract says it needs a key, and the registry refuses one that says not |
| `src/database.ts` | start-up knows six tenant tables, refuses an application that may delete or rewrite a claim, and refuses the claims' table without the policy that keeps an answer |
| `src/main.ts` | every command with a key; a payment sent twice, a different one under the same key, and fifty at once |
| `test/support/door.ts` | new — the door the tests knock on, which gives each request a fresh key unless the test gives one |
| `test/idempotency.test.ts` | new — the table, the key, the replay, the conflict, the release, a store that fails while a claim or an answer is written, and fifty at once |
| `test/idempotency.db.test.ts` | new — fifty at once on a real server, over a pool of twenty connections |
| the tests that pin the pipeline | nine stages now, and the claim among the command-only ones |

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step comes after the directory's:

```text
The answer is lost, and the agent sends the same request again, with the same key:

accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-903  draft      compensatable
                        withheld: amount (clearance)
accounts-payable-fte  COMMITTED                dsor://org_456/payment/PAY-903  draft      compensatable
                        withheld: amount (clearance)
  the same answer, word for word: true

The same key, with a different amount:

accounts-payable-fte  IDEMPOTENCY_CONFLICT     retry: never                the key 3cb123a6-pay-1009 was used for a different payment.create request; a new request needs a new key

Fifty requests at once, with one key:

  50 answers, 1 different, 1 payment made
```

The first receipt is the payment made. The second is the same request sent again with the same key:
the same receipt, PAY-903 again, and no second payment. The key in the conflict line starts with
the run's own prefix, so it differs every time the demo runs. Fifty requests at once with one key:
one claims it, the other forty-nine wait for its answer and are given it.

Every command in the demo now passes a key as its fourth argument. In the printed log further down,
this section adds three decisions: the payment, the conflict, and the fifty's one payment. The
replays add none.

### The database tier

`pnpm check` needs no server. The fifty-two tests in `pnpm test:db` need two real logins and a
database of this step's own:

```bash
cp ../my_19_unattended_mode_and_the_role_source/.env .env     # then dsor_step19 -> dsor_step20 in both lines
pnpm migrate && pnpm test:db
```

The database has to exist first, made with one `CREATE DATABASE dsor_step20` through the owner
login. `pnpm migrate` applies the eighteen migrations; on a server that already had step 19's
seventeen, it applies 018. One of the fifty-two is the step's "done when" where it can truly fail:
fifty requests with one key, sent at once over a pool of twenty connections, make one payment.

## Break it

Five, each measured on the full suite with the files one at a time, twice, and the two runs agreed.
The counts are from a copy outside the repository, where one test skips because the specification
is not beside it, so the total reads `702` with `1 skipped`; in the repository it is `702 passed`.

### Break 1 · check for the key, then insert it, as two steps

The map's "break it". In `src/idempotency.ts`, replace the claim's one INSERT with a SELECT that
asks whether the key exists, and, when it does not, an INSERT whose result is not looked at.

```text
 Tests  2 failed | 699 passed | 1 skipped (702)
```

The fifty requests at once, in the tests and in the demo: several of them each find no key before
any of them inserts one, and each makes a payment. Every test that sends one request at a time still
passes, which is why the mistake is so easy to make: it is wrong only when two requests arrive
together.

### Break 2 · the fingerprint is not compared

In `src/idempotency.ts`, change `if (found.payload_hash !== payloadHash) {` to
`if (found.payload_hash !== payloadHash && false) {`.

```text
 Tests  6 failed | 695 passed | 1 skipped (702)
```

The same key with another amount is given the first payment's receipt, and the caller believes a
payment of 2,600.00 was made when one of 2,500.00 was. The conflict tests, and four of the demo's,
whose conflict line and log both change.

### Break 3 · one key for every caller

In `src/idempotency.ts`, put `"anyone"` where the claim names its caller.

```text
 Tests  15 failed | 686 passed | 1 skipped (702)
```

More than predicted, and honestly so: this break changed two things. Keys are shared between
callers, which two tests are about; and the door writes each answer under the real caller, so no
answer is ever found again, and every replay waits out its two seconds. A break should change one
thing; this one shows how much rests on the claim and its answer naming the same caller.

### Break 4 · the answer is not kept

In `src/operations.ts`, replace the line that writes the answer on the claim with `void settleKey;`.

```text
 Tests  13 failed | 688 passed | 1 skipped (702)
```

Nothing runs twice: the claim still holds the key. But every retry waits two seconds and is told
nobody knows, where it should have been given its answer. Nine tests of the key, and four of the
demo's.

### Break 5 · a refusal from the walk is kept

In `src/operations.ts`, change `answer.envelope.retry === "safe_same_key";` to `false;`.

```text
 Tests  3 failed | 698 passed | 1 skipped (702)
```

A request refused because the decision could not be written down is answered "safe to send again",
and the retry is given that same refusal for ever. The three tests that send it again.

## Build it yourself with Claude Code

Copy `my_19_unattended_mode_and_the_role_source` to a new folder and ask:

> Start step 20, idempotency keys. Before any code: show me a payment made twice because its answer
> was lost, and fifty requests with one key racing each other. Then ask me the step's decisions one
> at a time. Then build it a piece at a time, red first, and break each piece on purpose.

## Check yourself

1. The agent's payment request times out, and it sends the same request again with the same key.
   What does it get, and how many payments exist?
2. It sends the same key with a different amount. What happens, and why not just make the new
   payment?
3. Why is the key claimed with one INSERT, and not by checking for it first and inserting it after?
4. Fifty requests with one key arrive together. Forty-nine are not first. What do they get?
5. The first request was refused `EVIDENCE_STORE_UNAVAILABLE`. Why is that answer not kept on the
   claim, when a refusal for being over the limit is?

<details>
<summary>Answers</summary>

1. The first request's receipt, word for word, and one payment. Nothing runs again, and no second
   decision is recorded.
2. `IDEMPOTENCY_CONFLICT`. A key names one request; the same key with another amount is either a
   mistake or a second request, and DSoR cannot tell which. A new request needs a new key.
3. Two requests that arrive together both check, both find no key, and both run. One INSERT under a
   primary key lets the database pick exactly one winner.
4. They wait for the first one's answer, up to two seconds, and are given it. If no answer is
   recorded by then, they are told `OUTCOME_UNKNOWN`: the first request may still be running, or it
   may have ended without recording one.
5. That answer says nothing ran and the same request may be sent again. Kept, it would be given to
   the retry, and "send it again" would be a lie. Over the limit is a decision, and the retry is
   given the same decision.

</details>

## The rules this step meets

- **[DSOR-IDM-01a · L2]** Every state-changing command in `execute` or `propose_only` mode MUST
  carry an idempotency key. ([§22](../../../specs/dsor/03-execution.md#22-idempotency))
- **[DSOR-IDM-01b · L2]** The key MUST be claimed by an atomic insert scoped to (tenant, calling
  principal, operation, key) that stores the payload hash.
- **[DSOR-IDM-01c · L2]** A request whose key is already claimed with the same payload hash MUST
  return the recorded status or result without re-execution.
- **[DSOR-IDM-01d · L2]** A request whose key is already claimed with a different payload hash MUST
  be refused with `IDEMPOTENCY_CONFLICT`.

**What this step leaves, said plainly.** Claims are never deleted, so they are kept longer than the
24 hours `DSOR-IDM-02` asks, for ever, and the table only grows; clearing old ones is a later step's.
A claim whose answer could not be written, because the store failed after the request ran, because
a handler threw, because its release could not be written, or because the claim's own reply was
lost, keeps no answer: a retry with its key waits and is told `OUTCOME_UNKNOWN` until someone
reconciles it, which is step 37's. A replay records nothing, and the fingerprint depends on the
order of the request's fields until canonical JSON, step 29. There is one mode, execute;
`propose_only` and the proposal whose id is the key of its execution (`DSOR-IDM-04`) are steps 22
and 23. Passing a key on to the bank's system (`DSOR-IDM-03`) waits for a connector that takes one.
And the key's characters are this tutorial's choice: the specification takes any text.

Everything earlier steps claimed still holds.

**Next:** step 21, `optimistic_concurrency` — "I decided based on version 18. If the record has moved
on, refuse."
