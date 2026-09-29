# Step 08 · Write the decision first

**New in this step:** every decision is written down **before** the answer goes back, and that
includes every "no".

## In plain words

Until this step the program decided and answered, and kept nothing. Ask it a month later who let
`user_123` read `INV-1008`, and under whose authority, and the honest answer was: nobody knows. Worse,
an operation that was *refused* and an operation that was never attempted look identical afterwards —
because both left nothing behind.

So now, in the middle of the checklist, there is one more line: **write down what was decided.** It
runs before the answer leaves, and it runs for a refusal exactly as it does for a yes.

The record is not a log line. It is a structured record that has to validate against the
specification's own `audit-record.schema.json`, and each record carries the **hash** of the record
before it — so the records form a chain. Edit one record and every hash after it stops agreeing.

Two words for two ideas you will meet in the code:

- a **hash** is a short fingerprint of some text. The same text always gives the same fingerprint, and
  changing one character of the text gives a completely different one.
- a **chain** here means each record stores the fingerprint of the previous record. That is what turns
  "someone edited a record" from invisible into obvious.

## Why it matters

An agent with no permission to issue invoices calls `invoice.issue` two hundred times, one invoice id
at a time. Every single call is refused. If refusals are not recorded, that entire probe leaves no
trace at all — and the one thing you most wanted to know, that somebody was trying, is the one thing
you cannot find out.

§21 says it plainly:

> Denied and failed attempts are evidence, and they are often the most useful evidence.

And it names the mistake to avoid:

> **Common mistake.** Writing the audit record at the end, inside a `finally` block. It is too late,
> and it misses the crash case completely.

## What the checklist looks like now

Step 07 turned the order of the checks into a list. This step adds one line to it, at its real §21
number:

```ts
export const PIPELINE: readonly Stage[] = Object.freeze([
  stage(1, "authenticate", "both", authenticate),
  stage(null, "resolve the operation", "both", resolveTheOperation),
  stage(5, "authorize", "both", authorize),
  stage(6, "validate the input", "both", validateTheInput),
  // NEW IN STEP 08. §21.11, and the only stage in the list that runs after a refusal.
  alsoAfterARefusal(11, "record the decision", "both", recordTheDecision),
]);
```

`alsoAfterARefusal` instead of `stage` is the whole difficulty of this step in one word. Until now the
walk **stopped** at the first no and returned it. A stage at §21.11 would therefore never have seen a
refusal, and every denial would have gone unrecorded. §21's diagram is emphatic about that:

```text
11  RECORD DECISION — always, including DENY
```

So a refusal is now *carried* instead of returned. The remaining checks are skipped — there is no
point asking "may you" after "who are you" has already failed — and the stages marked to run anyway
still run. The first no is still the answer; it just no longer ends the walk.

## Run it

```bash
pnpm install
pnpm start
```

The old output is unchanged. What is new is at the bottom — everything above it already happened, and
this is what was written down while it did:

```text
The audit log:

 0  ALLOW  invoice.get@1        user_123               ALLOWED                 sha256:26aaccf...
 1  ALLOW  invoice.get@1        accounts-payable-fte   ALLOWED                 sha256:4368778...
 2  ALLOW  invoice.get@1        user_123               ALLOWED                 sha256:f5c878e...
 3  ALLOW  invoice.get@1        cfo_100                ALLOWED                 sha256:9a372b4...
 4  DENY   invoice.issue@1      cfo_100                AUTHORIZATION_DENIED    sha256:c34d121...
 5  ALLOW  invoice.issue@1      accounts-payable-fte   ALLOWED                 sha256:4e532be...
 6  ALLOW  invoice.get@1        user_123               ALLOWED                 sha256:2ade4be...
 7  DENY   (no such operation)  user_123               UNSUPPORTED_CAPABILITY  sha256:01e2148...
 8  DENY   invoice.issue@1      cfo_100                AUTHORIZATION_DENIED    sha256:32378df...
 9  DENY   invoice.issue@1      cfo_100                AUTHORIZATION_DENIED    sha256:f01f2fe...

10 records, chain verifies against the head: true
2 refusals counted without a record, because nobody was logged in
```

Read the second column. **The four `DENY` lines are the ones a program that logged only its successes
would have lost**, and they are the most interesting lines in the table. Line 4 is the CFO being
refused; lines 8 and 9 are the same refusal for an invoice that exists and one that does not, word for
word, which is step 06's guarantee still holding.

Three things in that output are worth stopping on.

**`10 records` for twelve calls.** Two calls arrived with nobody logged in. §29 allows those to be
counted rather than recorded, and the reason is an attack: a caller with no credentials at all can
send a million requests, and a log that writes one record each fills the evidence store with the
attacker's noise until the records that matter cannot be written. This is the first point in the
tutorial where **the log itself is a resource an attacker can exhaust.**

**Line 7 has no operation.** The caller asked for `execute_sql`, which this program has no contract
for, so there is no operation and no version to write down. The schema's `operation` field must look
like `invoice.get@1`, so putting the caller's string there would make the record *unwritable* — and an
unwritable record turns a misspelled request into `EVIDENCE_STORE_UNAVAILABLE`. The requested id goes
in `reason` instead, which is free text.

**Line 6 says `ALLOWED`, and that call was refused.** It is the `logged in, bad address` line further
up the output, answered `VALIDATION_FAILED`. This is not a bug, and it is the most important limit of
the step — see below.

## The limit worth understanding: decided, not happened

A record here says what was **decided**. It does not say what **happened**.

§21 keeps those apart on purpose. Step 11 records the decision; step 15, `FINALIZE`, records the
outcome as `COMMITTED`, `FAILED` or `OUTCOME_UNKNOWN`. This step has step 11 and no step 15. So a call
that is authorized and then fails while it is being carried out is on the record as `ALLOW`, and the
caller is told `VALIDATION_FAILED`. Both are true. The record is incomplete.

There is a test that asserts exactly this, including the disagreement:

```ts
expect(theLog()[0]!.authorization, where).toBe("ALLOW");
expect(theLog()[0]!.result, where).not.toBe(answer.envelope.code);
```

It is written that way because the first version asserted `DENY` and **failed**, which is how the gap
got found rather than shipped.

There is a second reason those refusals arrive late, and it belongs to step 04 rather than this one:
the `validate the input` stage only checks that the arguments *can be written down*. It does not check
them against the contract's input schema, so a missing `invoice` is not caught at §21.6 where it
belongs — it is caught inside the handler.

## What changed since step 07

```bash
git diff --no-index ../my_07_the_pipeline_skeleton ../my_08_write_the_decision_first
```

Eleven files, ignoring `node_modules`:

| File | What |
| --- | --- |
| `src/audit.ts` | new — the record, the chain, the clock, the log, the counter |
| `src/schemas/audit-record.schema.json` | new — copied byte for byte from `packages/spec/schemas/` |
| `src/pipeline.ts` | `Stage.evenAfterARefusal`, `Context.refusal` and `Context.requestId`, a walker that carries a refusal, two new list rules |
| `src/operations.ts` | the `recordTheDecision` stage, `alsoAfterARefusal`, and one request id threaded everywhere |
| `src/login.ts`, `src/invoice.ts` | the request id reaches `principalFrom`; `resetInvoices` is a new test seam |
| `src/main.ts` | prints the log |
| `test/audit.test.ts`, `test/decision-first.test.ts`, `test/request-id.test.ts` | new |
| `test/pipeline.test.ts`, `test/login.test.ts` | the fifth stage, and the new signature |

169 tests became 198.

## One repair came first

`correlation.request_id` is a **required** field of `audit-record.schema.json`, so this step had to put
something there. It turned out the request id was being minted lazily, inside whichever envelope
happened to be built first:

```ts
const request_id = requestId ?? nextRequestId();   // minted when the envelope is built
```

So it named *an answer*, not *a request*. A record minting its own id would carry a different id from
the answer it was about, and nothing could ever join the two — which is the only job a correlation id
has. The door now mints one id when the request arrives and hands the same one to every refusal, every
success, and the record. It landed as its own commit, before the record, so the repair and the feature
stay separable.

## Break it

Predict each answer before you read it.

### Break 1 · let the recording stage skip refusals

In `src/operations.ts`, change one word:

```ts
stage(11, "record the decision", "both", recordTheDecision),   // was alsoAfterARefusal
```

Every allowed call is still recorded. Every test about an answer still passes. Nothing about the
program's output changes at all — and denials have silently stopped being written down.

```text
 Test Files  7 failed | 9 passed (16)
      Tests  110 passed (110)

TypeError: record the decision must run even after a refusal, or denials go unrecorded
```

**`110 passed (110)`, and nothing failed.** Look at the total, not at the failures: 198 tests were
collected before, and 88 of them never ran, because seven files import a module that throws while
loading. `pnpm start` will not start either. This is the strongest result a break can get — the
program refuses to exist — and it looks exactly like a break nothing caught.

### Break 2 · record after the response, the way a `finally` block would

Take `record the decision` out of the list and call it from the door after the answer is built, with an
ordinary bug in between:

```ts
if (walked.kind === "refused") {
  const answer = walked.answer;

  if (answer.kind === "error" && answer.envelope.code === "AUTHORIZATION_DENIED") {
    throw new Error("something went wrong on the way out");   // any bug on the way out
  }

  recordTheDecision(walked.context);
  return answer;
}
```

Then ask for the refusal:

```text
THREW: something went wrong on the way out
records written: 0

 Test Files  7 failed | 9 passed (16)
      Tests  41 failed | 157 passed (198)
```

The refusal vanished. This is §21's "common mistake" performed on purpose: the record was written
*after* the thing that could fail, so the one case you most needed evidence for is the one case that
left none.

### Break 3 · move the recording above the checks

Swap `authorize` and `record the decision` in the list.

```text
 Test Files  7 failed | 9 passed (16)
      Tests  110 passed (110)

TypeError: the pipeline is out of order: §21.6 (validate the input) comes after §21.11
```

Refused at start-up by the §21 numbers, which step 07 put there. A decision cannot be recorded before
it has been made.

### Break 4 · break the chain

In `src/audit.ts`, make every record point at the beginning:

```ts
const previous = GENESIS;   // was log[sequence - 1]?.record_hash ?? GENESIS
```

```text
      Test Files  2 failed | 14 passed (16)
      Tests  5 failed | 193 passed (198)
```

Restore each break and confirm `pnpm check` prints `198 passed` again.

## Build it yourself with Claude Code

> Read §21 and §29 of the specification, and `audit-record.schema.json`. Then add one stage to my
> pipeline at §21.11 that writes an audit record for every decision, before the answer is returned,
> including every refusal.
>
> Copy the schema from `packages/spec/schemas/` byte for byte — do not write your own. Give each
> record the hash of the record before it, so the records form a chain, and give me a function that
> says whether a chain still agrees with itself.
>
> Tests first, titled with the rule ids. Before you write the stage, tell me what happens to a
> refusal in the walker I already have, and what you will have to change.
>
> Then break every guard you added, one at a time, and show me the test totals. If removing a check
> leaves every test passing, tell me — do not quietly keep the check.

## Check yourself

1. Why does recording a refusal need a change to the *walker*, and not just a new stage?
2. A caller asks for `execute_sql`. Why is the record's `operation` field left empty rather than
   holding `"execute_sql"`?
3. Line 6 of the log says `ALLOWED` for a call the caller saw refused. Why is that correct?
4. Two calls in the demo left no record at all. Which ones, and what protects the log by leaving them
   out?
5. `verifyChain` has two checks. It used to have four. What made the other two pointless?
6. In break 1 the output says `110 passed` and nothing failed. What actually happened?
7. Could someone who can reach the log still rewrite history?

<details>
<summary>Answers</summary>

1. Because the walk returned at the first refusal, so a stage at §21.11 would never have run for a
   denial — and §21 says the decision is recorded *always, including DENY*. The refusal is now
   carried: remaining checks are skipped, stages marked `evenAfterARefusal` still run.
2. Because `operation` in the schema is an `operationRef` — `invoice.get@1`, with a version — and
   there is no contract and no version for an operation that does not exist. A record the schema
   refuses cannot be written, and an unwritable record would turn a misspelled request into
   `EVIDENCE_STORE_UNAVAILABLE`. The requested id goes in `reason`, which is free text.
3. Because the record says what was **decided**, and the decision was to allow it. What happened
   afterwards is §21.15 `FINALIZE`, which this step does not have. A test asserts the disagreement so
   that it is a known gap rather than a surprise.
4. The two with nobody logged in. §29 allows rejections before a tenant is known to be counted
   instead, so that an unauthenticated flood cannot fill the audit store — the log is a resource an
   attacker can exhaust.
5. `sequence` and `chain` are *inside* the record, so they are inside the hash. Changing either one
   breaks `record_hash` first, so a separate check for them can never be the thing that catches
   anything. Both were removed after mutating them away left every test passing.
6. Seven test files failed to *load*, because the list check throws while the module is being
   imported, so 88 tests never ran. Nothing failed because almost nothing ran. Always read the total.
7. Yes. The log is an array in memory, so anyone holding it can edit a record — and a chain that is
   fully recomputed from the beginning verifies cleanly. What the chain buys is that a *quiet* edit is
   impossible. Making it impossible outright needs a store that refuses an `UPDATE`, which is step 39.

</details>

## The rules this step meets

- **[DSOR-EXE-02 · L1]** The decision — outcome, controls evaluated, and the reason for any `DENY` —
  MUST be durably recorded before the response is returned.
  ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline))
- **[DSOR-AUD-01 · L1]** Every command decision, every proposal transition, and every read covered by
  `DSOR-CLS-05` MUST produce a durable audit record that validates against `audit-record.schema.json`.
  ([§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence))

`DSOR-EXE-02` is met for the decision itself: every call that reaches a principal is recorded before
its answer is returned, refusals included, with the refusal's code and message as the reason. Two
halves of the sentence are **not** met. "Controls evaluated" needs controls, which are step 27 —
nothing evaluates a control here, so the field is absent rather than empty. And "durably" is doing a
lot of work for an array in memory; step 09 puts the log in PostgreSQL and step 39 makes it
append-only for real.

`DSOR-AUD-01` is met for the one command, `invoice.issue`: its decisions produce records that validate
against the specification's own schema, and a test compares that schema byte for byte with
`packages/spec/schemas/` so it cannot have been quietly edited to fit the code. The rule covers two
other things this step does not have — proposal transitions (step 21) and reads covered by
`DSOR-CLS-05`, which are reads returning `CONFIDENTIAL` or `RESTRICTED` data. Neither contract here
carries a classification, so no read needs a record. Queries are recorded anyway, which is more than
the rule asks for, not less.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-EXE-03a` | A durable intent record before any side effect, holding the proposal id, operation and version, payload hash, idempotency key, connector and security context. There are no proposals, no idempotency keys and no connectors, so four of six fields do not exist. §21.13, step 36. |
| `DSOR-EXE-03b` | If the store cannot accept the decision **or intent** record, do not execute; answer `EVIDENCE_STORE_UNAVAILABLE`. The decision half of that behaviour is here and tested — a record that cannot be written refuses the call and nothing is carried out. The intent half does not exist, so the rule is not claimed. Step 36. |
| `DSOR-EXE-04a`, `04b` | Atomic commit of state, outcome and outbox; an intent record with no outcome is `OUTCOME_UNKNOWN`. Steps 34 and 37. |
| `DSOR-AUD-02a` | Operational audit must not be stored only as agent memory. There is no agent memory to store it in, so there is nothing to get wrong. Step 40. |
| `DSOR-AUD-03a` | A decision bundle per consequential command, validating against `decision-bundle.schema.json`. §21.17, and a different artifact. Step 29. |
| `DSOR-AUD-04a`, `04b` | The audit store's own immutability — the role with no `UPDATE` privilege, and tamper evidence a database enforces. The chain here is *detection*, not prevention. Step 39. |
| `DSOR-CLS-05` | Reads of `CONFIDENTIAL` or `RESTRICTED` data must be audited with principal, actor chain, operation, resource scope and row count. Nothing is classified yet, and `resources` and `row_count` are not written. Step 19. |

Everything earlier steps claimed still holds: step 07's `DSOR-EXE-01a` and `01b`, step 06's
`DSOR-AUT-01a` and `01b`, step 05's `DSOR-IDN-01`, step 04's `DSOR-ERR-01a`, step 03's `DSOR-OPR-01`
and `DSOR-SCH-01`.

**Next:** step 09, `postgres_on_neon` — the invoices and this log move into a real database, and the
application's database user is allowed to insert log rows and not to change them.
