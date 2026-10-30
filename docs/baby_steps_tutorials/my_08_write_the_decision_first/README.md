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
The chain itself is pulled forward from step 39, where the map puts "a log nobody can quietly edit"
and its verifier script: this step needs it now, in its smallest form, because *written first* is
only checkable if a record edited afterwards can be told from one that was not.

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

## What changed since step 07

```bash
git diff --no-index ../my_07_the_pipeline_skeleton ../my_08_write_the_decision_first
```

20 paths change, counted with `git diff --no-index --name-status` and ignoring `node_modules`.
The ones that matter:

| File | What |
| --- | --- |
| `src/audit.ts` | new — the record, the chain, the clock, the log, the counter |
| `src/schemas/audit-record.schema.json` | new — copied byte for byte from `packages/spec/schemas/` |
| `src/pipeline.ts` | `Stage.evenAfterARefusal`, `Context.refusal` and `Context.requestId`, a walker that carries a refusal, two new list rules |
| `src/operations.ts` | the `recordTheDecision` stage, `alsoAfterARefusal`, and one request id threaded everywhere |
| `src/envelopes.ts` | no behaviour change: `correlationFor` moved up the file, and the comment on the message cap now tells the story of the fuzz run that found it |
| `src/login.ts`, `src/invoice.ts` | the request id reaches `principalFrom`; `resetInvoices` is a new test seam |
| `src/main.ts` | prints the log |
| `test/audit.test.ts`, `test/decision-first.test.ts`, `test/request-id.test.ts` | new |
| `test/main.test.ts` | step 07 compared the program's output byte for byte; the log's hash column changes on every run, so this checks the lines that cannot move and masks the one column that can |
| `test/pipeline.test.ts`, `test/login.test.ts` | the fifth stage, and the new signature |
| `test/deny-by-default.test.ts`, `test/who-is-calling.test.ts` | one refusal test each: a principal with no role at all, and a principal planted in the arguments with nobody logged in |
| `test/operations.test.ts`, `test/registry.test.ts` | comments only |

179 tests became 234, of which 36 came after the step first looked finished — it was green at 198
then; see the review section at the bottom.

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

## Run it

```bash
pnpm install
pnpm start
```

The old output is unchanged. What is new is at the bottom — everything above it already happened, and
this is what was written down while it did:

```text
The audit log:

 0  ALLOW  invoice.get@1        user_123               ALLOWED                 sha256:b9b124b...
 1  ALLOW  invoice.get@1        accounts-payable-fte   ALLOWED                 sha256:7488230...
 2  ALLOW  invoice.get@1        user_123               ALLOWED                 sha256:33e5244...
 3  ALLOW  invoice.get@1        cfo_100                ALLOWED                 sha256:e89a3f0...
 4  DENY   invoice.issue@1      cfo_100                AUTHORIZATION_DENIED    sha256:61339ac...
 5  ALLOW  invoice.issue@1      accounts-payable-fte   ALLOWED                 sha256:98bff79...
 6  ALLOW  invoice.get@1        user_123               ALLOWED                 sha256:e59b7f4...
 7  DENY   (no such operation)  user_123               UNSUPPORTED_CAPABILITY  sha256:3501ce7...
 8  DENY   invoice.issue@1      cfo_100                AUTHORIZATION_DENIED    sha256:8a9e5a8...
 9  DENY   invoice.issue@1      cfo_100                AUTHORIZATION_DENIED    sha256:8ee22b6...

10 records, chain verifies against the head: true
drop the last record and the chain alone still says: true — but against the head: false
2 refusals counted without a record, because nobody was logged in
```

**Your hashes will not match these.** The time each decision was made is part of what is hashed, so
every run produces a different set — which is the right behaviour, and worth seeing rather than hiding
behind a fixed clock. Everything else in the table is the same every time.

Read the second column. **The four `DENY` lines are the ones a program that logged only its successes
would have lost**, and they are the most interesting lines in the table. Line 4 is the CFO being
refused; lines 8 and 9 are the same refusal for an invoice that exists and one that does not, word for
word, which is step 06's guarantee still holding.

Three things in that output are worth stopping on.

**`against the head`.** `verifyChain` is passed a *checkpoint* — a count and the last hash, kept apart
from the records. Without one it can only judge the records it is handed, and a review used exactly
that: it dropped the last record, the one holding a denial, and got `true`. Then dropped two. Then
handed over an empty log: `true`. Hash chaining is evidence a record was not **edited**; it is no
evidence at all that one was not **deleted from the end**. §30 names checkpoints beside hash chaining
for this reason.

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

§21 keeps those apart on purpose. §21.11 records the decision; §21.15, `FINALIZE`, records the
outcome as `COMMITTED`, `FAILED` or `OUTCOME_UNKNOWN`. This step has §21.11 and no §21.15. So a call
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

## The gap a query leaves, written down

Two comments in the code send a reader here, so here it is.

A query that succeeds comes back as `{ kind: "data" }` with the invoice in it and **no envelope** —
because `result-envelope.schema.json` has no outcome value meaning "here is the data you asked for".
An envelope is where the correlation block lives. So for a successful read:

- a record **is** written, and it carries a `request_id`
- the caller never learns that id

Measured on the demo above: twelve calls, ten records, and **four** of the answers come back as
`{ kind: "data" }` with no envelope. So four of those ten records carry a `request_id` that the person
who caused them cannot cite. For a correlation id that is the whole job, and this
is the one place it is not done.

It is not a bug in this step; it is the shape of the result envelope. Step 14, where the
specification's §19 (classification and read-side governance) arrives, is where a read's answer gets
governed in its own right. It is written here because `src/operations.ts` and
`test/request-id.test.ts` both promise that it is.

## Break it

Predict each answer before you read it.

### Break 1 · let the recording stage skip refusals

In `src/operations.ts`, change one word:

```ts
stage(11, "record the decision", "both", recordTheDecision),   // was alsoAfterARefusal
```

If this were allowed to run, every allowed call would still be recorded, every test about an answer
would still pass, and nothing about the program's output would change — while denials silently
stopped being written down. It is not allowed to run:

```text
$ pnpm start
TypeError: record the decision must run even after a refusal, or denials go unrecorded
```

`pnpm check` stops one step earlier, because `alsoAfterARefusal` is now a helper nothing uses and
this project's compiler treats an unused local as an error:

```text
src/operations.ts(564,7): error TS6133: 'alsoAfterARefusal' is declared but its value is never read.
```

So run the tests on their own to see what the start-up check does to them:

```text
$ pnpm test
 Test Files  8 failed | 9 passed (17)
      Tests  5 failed | 122 passed (127)

TypeError: record the decision must run even after a refusal, or denials go unrecorded
```

**Read the total, not the failures: 234 tests were collected before, and 107 of them never ran**,
because eight files import a module that throws while loading.

Only five failures show, and all five are in `main.test.ts` — the one file that runs the program as a
subprocess, so it reports a failure where the others simply never start. Set `main.test.ts` aside for
a moment and run this break again:

```text
 Test Files  7 failed | 9 passed (16)
      Tests  122 passed (122)
```

**Nothing** failing at all. That is the strongest result a break can get, the program refusing to
exist, and it looks exactly like a break nothing caught. A test that runs the real program is what
turns it into something you can see.

### Break 2 · record after the response, the way a `finally` block would

This one cannot be done any more without disabling a guard first, and that is worth noticing. Taking
`record the decision` out of the list is refused when the program loads — and the guard that fires is
step 07's `REQUIRED` check, which sees the name missing before any of this step's three new checks
get a turn:

```text
$ pnpm start
TypeError: the pipeline is missing record the decision, which every call needs
```

So to perform §21's actual mistake you now have to take the name out of `REQUIRED` in
`src/pipeline.ts`, make the `records === undefined` check under it return instead of throw, take the
stage out of `PIPELINE`, **and then** call the recording from the door after the answer is built,
with an ordinary bug in between:

```ts
if (walked.kind === "refused") {
  const answer = walked.answer;

  if (answer.kind === "error" && answer.envelope.code === "AUTHORIZATION_DENIED") {
    throw new Error("something went wrong on the way out");   // any bug on the way out
  }

  recordTheDecision((walked as unknown as { context: Context }).context);
  return answer;
}
```

The cast is part of the lesson: a refused walk no longer *carries* a context, because nothing after
it is supposed to need one, and the compiler will not let you reach for it without saying so.

Then ask for the refusal — `callOperation(CFO, "invoice.issue", { invoice: INV_1009 })` inside a
`try`, and count `theLog()` afterwards:

```text
THREW: something went wrong on the way out
records written: 0
```

The refusal vanished. This is §21's "common mistake" performed on purpose: the record was written
*after* the thing that could fail, so the one case you most needed evidence for is the one case that
left none. The tests agree, loudly. `pnpm check` stops at the compiler again (`alsoAfterARefusal` is
unused), and `pnpm test` on its own prints:

```text
 Test Files  8 failed | 9 passed (17)
      Tests  83 failed | 151 passed (234)
```

### Break 3 · move the recording above the checks

Swap `authorize` and `record the decision` in the list.

```text
 Test Files  8 failed | 9 passed (17)
      Tests  5 failed | 122 passed (127)

TypeError: the pipeline is out of order: §21.6 (validate the input) comes after §21.11
```

Refused at start-up by the §21 numbers, which step 07 put there. A decision cannot be recorded before
it has been made. The totals are break 1's exactly, and for the same reason: eight files cannot load
the module, 107 tests never run, and the five that fail are `main.test.ts` watching the program die.

### Break 4 · break the chain

In `src/audit.ts`, make every record point at the beginning:

```ts
const previous = GENESIS;   // was log[sequence - 1]?.record_hash ?? GENESIS
```

```text
 Test Files  3 failed | 14 passed (17)
      Tests  9 failed | 225 passed (234)
```

Nine tests in three files: the chain tests in `audit.test.ts`, the one in `decision-first.test.ts`
that walks a run of allows and denials, and `main.test.ts`, which reads `chain verifies against the
head: false` off the real program where it expects `true`.

### Break 5 · take away the checkpoint

In `src/audit.ts`, let `verifyChain` ignore the head it was given:

```ts
export function verifyChain(records: readonly AuditRecord[], head?: Head): boolean {
  // if (head !== undefined && lastHashOf(records) !== head.lastHash) { return false; }
```

The compiler objects first, because `head` and `lastHashOf` are now never read:

```text
src/audit.ts(512,62): error TS6133: 'head' is declared but its value is never read.
src/audit.ts(552,10): error TS6133: 'lastHashOf' is declared but its value is never read.
```

`pnpm test` on its own:

```text
 Test Files  2 failed | 15 passed (17)
      Tests  3 failed | 231 passed (234)
```

Three tests. The one that drops the record holding a denial and checks that somebody notices; the one
that hands an empty log a head saying one record exists; and `main.test.ts`, which reads `but against
the head: false` off the real program and now finds `true`.

Restore each break and confirm `pnpm check` prints `234 passed` again — or
`233 passed | 1 skipped` if you are running the folder from outside the dsor repository, where the
byte-for-byte schema comparison has nothing to compare against.

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
5. `verifyChain` once had a check on each record's `sequence` and on its `chain`. Both were deleted.
   What made them pointless?
6. In break 1, `pnpm test` says `5 failed | 122 passed (127)`. Where did the other 107 tests go, and
   why are the five failures all in one file?
7. Could someone who can reach the log still rewrite history?
8. A successful read leaves a record carrying a `request_id`, and the caller never learns it. Why?
9. `verifyChain` said `true` for a log with its last record deleted. What was missing, and why is
   hash chaining alone not enough?

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
   anything. Both were removed after mutating them away left every test passing. What `verifyChain`
   checks now is each record against the schema, its own hash, its link to the record before, and that
   its time does not run backwards — plus the checkpoint, before the loop starts.
6. Eight test files failed to *load*, because the list check throws while the module is being
   imported, so 107 of the 234 tests never ran. The five failures are all in `main.test.ts`, the one
   file that runs the program as a subprocess and so reports the crash instead of being part of it.
   Set that file aside and the same break prints `122 passed (122)` with nothing failing. Always read
   the total.
7. Yes. The log is an array in memory, so anyone holding it can edit a record — and a chain that is
   fully recomputed from the beginning **together with its checkpoint** verifies cleanly. What the chain
   buys is that a *quiet* edit is impossible. Making it impossible outright needs a store that refuses
   an `UPDATE`: step 09 gives the application's database user no `UPDATE` and no `DELETE` on the log.
8. Because a query's success comes back as `{ kind: "data" }` with no envelope, and the correlation
   block lives on the envelope. `result-envelope.schema.json` has no outcome value meaning "here is the
   data you asked for", so a read has nowhere to carry it. See the section above, and step 14.
9. A **checkpoint** — the count and last hash that `theHead()` holds apart from the records. Chaining
   proves each record still matches its neighbours, and a shortened chain still does: every link holds,
   every hash matches, there is simply less of it. Chaining catches an *edit*; only something outside
   the records catches a *deletion from the end*. §30 names checkpoints beside hash chaining for
   exactly that.

</details>

## The rules this step meets

- **[DSOR-EXE-02 · L1]** The decision — outcome, controls evaluated, and the reason for any `DENY` —
  MUST be durably recorded before the response is returned.
  ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline))
- **[DSOR-AUD-01 · L1]** Every command decision, every proposal transition, and every read covered by
  `DSOR-CLS-05` MUST produce a durable audit record that validates against `audit-record.schema.json`.
  ([§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence))
- **[DSOR-AUD-04b · L2]** Audit records MUST be tamper-evident through hash chaining, signed
  checkpoints, or an equivalent mechanism.
  ([§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention))
- **[DSOR-EXE-03b · L2]** If the control-plane store cannot accept the decision or intent record, DSoR
  MUST NOT execute; the caller receives `EVIDENCE_STORE_UNAVAILABLE`.
  ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline))
- **[DSOR-MOD-04 · L1]** DSoR MUST NOT accept a caller-supplied assertion of current state, policy, or
  approval as evidence. ([§4](../../../specs/dsor/01-model.md#4-authority-boundaries-and-precedence))
- **[DSOR-COR-01a · L1]** DSoR MUST propagate `task_id`, `trace_id`, `session_id`, `tenant_id`,
  `agent_id`, `principal_id`, and `request_id` through connectors, audit, and events. ([§32](../../../specs/dsor/03-execution.md#32-correlation))

`DSOR-EXE-02` is met for the decision itself: every call that reaches a principal is recorded before
its answer is returned, refusals included, with the refusal's code and message as the reason. Two
halves of the sentence are **not** met. "Controls evaluated" needs controls, which are step 27 —
nothing evaluates a control here, so the field is absent rather than empty. And "durably" is doing a
lot of work for an array in memory; step 09 puts the log in PostgreSQL, where the application's
database user may insert a row and not change or delete one, and step 39 adds the chain's verifier.

`DSOR-AUD-01` is met for the one command, `invoice.issue`: its decisions produce records that validate
against the specification's own schema — and the test for that runs over the records the **pipeline**
writes, not only over records a test built itself, which is a distinction a review had to point out. A
second test compares the schema byte for byte with `packages/spec/schemas/` so it cannot have been
quietly edited to fit the code; that one is skipped, and reported as skipped, when the folder is sitting
outside the dsor repository, because there is then nothing to compare against. The rule covers two
other things this step does not have — proposal transitions (step 22) and reads covered by
`DSOR-CLS-05`, which are reads returning `CONFIDENTIAL` or `RESTRICTED` data. Neither contract here
carries a classification, so no read needs a record. Queries are recorded anyway, which is more than
the rule asks for, not less.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-EXE-03a` | A durable intent record before any side effect, holding the proposal id, operation and version, payload hash, idempotency key, connector and security context. There are no proposals, no idempotency keys and no connectors, so four of six fields do not exist. §21.13, step 36. |
| `DSOR-EXE-04a`, `04b` | Atomic commit of state, outcome and outbox; an intent record with no outcome is `OUTCOME_UNKNOWN`. Step 36, with `DSOR-EXE-03a`. |
| `DSOR-AUD-02a` | Operational audit must not be stored only as agent memory. There is no agent memory to store it in, so there is nothing to get wrong. Step 09, where the map puts it beside `DSOR-AUD-04a`. |
| `DSOR-AUD-03a` | A decision bundle per consequential command, validating against `decision-bundle.schema.json`. §21.17, and a different artifact. Step 33. |
| `DSOR-AUD-04a` | The audit store's own immutability: the runtime identity MUST NOT be able to update or delete audit records. Here the runtime identity is this process, and `forgetTheLog()` erases everything — a test seam guarded by nothing but a comment saying so. Step 09 gives the application's database user no `UPDATE` and no `DELETE`; step 39 hardens it. |
| `DSOR-CLS-05` | Reads of `CONFIDENTIAL` or `RESTRICTED` data must be audited with principal, actor chain, operation, resource scope and row count. Nothing is classified yet, and `resources` and `row_count` are not written. Step 14. |

`DSOR-AUD-04b` is met as **detection**, and only against a checkpoint: `verifyChain(theLog(),
theHead())` catches an edit, a removal, a reordering, a record spliced in from another history, a
record that lies about its own contents, and a time that runs backwards. Without the head it cannot
catch a dropped tail, and nothing here catches a chain recomputed from the beginning along with its
checkpoint. That needs the checkpoint somewhere the application cannot reach.

`DSOR-EXE-03b` is met for the **decision** record: if it cannot be written, nothing is carried out and
the caller gets `EVIDENCE_STORE_UNAVAILABLE` with retry `safe_same_key`. The requirement's sentence is
a disjunction — "the decision **or** intent record" — so this is one complete branch of it rather than
a stub. The intent branch is step 36's, along with `DSOR-EXE-03a`.

`DSOR-MOD-04` is met for the record: every field comes from what DSoR established, and a test plants
twenty field names in the arguments at once to prove it. It was the step's biggest hole — the
claim was in a comment and nothing tested it, so a version of the stage that read
`context.args["subject"]` passed all 198 tests.

`DSOR-COR-01a` is met between the record and the answer, which share one id. Not through connectors or
events — there are none.

Everything earlier steps claimed still holds: step 07's `DSOR-EXE-01a` and `01b`, step 06's
`DSOR-AUT-01a` and `01b`, step 05's `DSOR-IDN-01`, step 04's `DSOR-ERR-01a`, step 03's `DSOR-OPR-01`
and `DSOR-SCH-01`.

## What a review found after this looked finished

`pnpm check` was green at 198 tests. Every guard had been mutated. `pnpm start` printed a clean chain.
Four hostile reviewers then found **fourteen broken guarantees**, and the step gained 21 tests.

The first one arrived before any reviewer did, from making their copies: the step no longer ran by
itself. The byte-for-byte schema comparison read `../../../../packages/spec/schemas/` unconditionally
and died with `ENOENT` outside the repository — a test that made the step depend on its surroundings,
in a tutorial whose own instructions say to copy a step somewhere else and run it there.

### The three worst

| Finding | Why it mattered |
| --- | --- |
| **Nothing tested "never from the arguments."** The recording stage's comment called itself "`DSOR-MOD-03` in one sentence". A reviewer made it read `context.args["subject"]` first and **all 198 tests passed** | Every test used a well-behaved caller, which is critical rule 2: if a test only passes because the caller behaved, the test proves nothing. The forged record was schema-valid and its chain verified, because the forgery is *inside* the hash |
| **Dropping records off the end was undetectable.** `verifyChain` walks forward from the genesis hash, so it can only judge the records it is handed. Drop the record holding a denial: `true`. Drop two: `true`. Hand it an empty log: `true` | Hash chaining is evidence a record was not **edited**. It is no evidence at all that one was not **deleted**, which is the cheapest attack there is. §30 names checkpoints beside chaining for this reason, and `theHead()` is the smallest checkpoint there is |
| **`at: null` was a wildcard, and the flag rule was positional.** One unnumbered stage was accepted in all six positions of the five-stage list. A flagged stage *after* the recording was accepted too — and with a side effect in it, a command the pipeline had **denied** was carried out, with `DENY` sitting in the log beside the invoice it had just issued | Both were lists `assertPipeline` said were fine. The order is the guarantee, and two different escape hatches let a stage out from under it |

### The ones that were about honesty

Six tests claiming `DSOR-AUD-01` were proving `DSOR-AUD-04b`; three claiming `DSOR-ERR-01a` were about
request ids and never validated an envelope; two were crediting `DSOR-EXE-02` with
`DSOR-EXE-03b`'s behaviour. A title is how this project counts coverage, so a wrong title is a wrong
number. `operations.ts` claimed the stage was "the whole of `DSOR-EXE-02`" when neither *durably* nor
*controls evaluated* is met. `package.json` still advertised the intent record. `audit.ts` paraphrased
`DSOR-AUD-01` in a way that widened it and folded in `04b`'s "append-only". Two code comments pointed
at a README section explaining the query gap, and no such section existed — it does now.

### Two lessons, both about how to read a surviving mutation

**A guard written twice can be half-broken** ([lesson 17](../my_notes/lessons.md)). The real clock
existed as two copies of `new Date().toISOString()`. Breaking the first left `resetClock` handing the
real one straight back, so the test passed and I nearly wrote the survivor down as unkillable.

**Overlapping checks cannot be tested together** ([lesson 18](../my_notes/lessons.md)). `verifyChain`
had four checks and three could be removed one at a time with every test still passing — not because
the tests were weak but because no test ever fed a check a case only that check could catch. Four
checks were deleted across the step for that reason, including two added during this very review.
Three new tests reach exactly one check each.

### And one thing I had given up on

A door built with a **no-op** `record the decision` passes every check `assertPipeline` can make — the
name is there, in the right place, with the flag on, applying to both kinds. It then **issued
INV-1009, answered `COMMITTED`, and wrote nothing.** A side effect with no evidence, which is the
worst shape `DSOR-EXE-02` has.

I wrote that up as a limit of list checking and added a test saying so. A list check genuinely cannot
see what a function does — but that is not a reason to let a command run with no audit trail. So the
stage now leaves a **receipt**: the id of the record it wrote, in the context, which the door checks
before it calls any handler.

```text
invoice.issue finished the pipeline without a record of the decision
```

The invoice stays `draft`. The guarantee no longer rests on the stage being the right stage — it rests
on a record existing. Two mutations made that honest: removing the receipt fails 37 tests, and
replacing it with the literal `"pretend"` passed every test at the time, because the door was checking that
*something* was there rather than that the something was real. A test now reads the receipt and
asserts it is the id of the record in the log.

### Also fixed

- `${context.id}` on a `Symbol` threw, so an evidence failure reached the caller as a stack trace
  rather than an envelope. `resolveTheOperation` already guarded that; the one stage that runs *after*
  it did not — [lesson 13](../my_notes/lessons.md), a fix belongs everywhere its shape lives.
- `audit()` read `decision.subject` **three times**, so a getter could make the gate see one person and
  the record blame another — [lesson 16](../my_notes/lessons.md), for the third time.
- `JSON.stringify` calls `toJSON` before a replacer runs, and `verifyChain` never validated: two objects
  reading differently in every field, both carrying the original `record_hash`, both verified.
- A backdated record verified forever, because the hash is computed *from* the lie.
- One authenticated call produced a schema-valid record whose `reason` was 2,000,057 characters.
  Decision 53 guarded the *unauthenticated* flood; the authenticated one is faster.
- `makeDoor` checked the array it was handed and then walked the caller's live reference.
- The `INTERNAL_ERROR` branch answered with no record at all, or over a record saying `ALLOWED`.
- `record_id` was `chain:sequence`, and the test seam rewinds the sequence, so two decisions could
  share an id.
- `AUDIT_SCHEMA_CHECKED = true` — a reviewer deleted the compile guard under it and every test passed.
  [Lesson 12](../my_notes/lessons.md), in the one file that had not learned it.

A systematic sweep of every `===`, `!==`, `&&`, `||`, `<`, `>`, `??`, `return true/false` and `+= 1`
in `src/` generates **253 mutants: 217 fail a test and 36 survive.** Most survivors cannot behave differently at all — `a ?? b` and `a || b` are the same when
`a` can never be `""` or `0`, and the door's five narrowing clauses sit on a branch nothing reaches.
Two are equivalent on purpose and say so in the code: `applies` in its positive form, and the order of
the walker's two `continue`s. The survivors that are **not** equivalent are listed in
[the step's notes](../my_notes/step-08-write-the-decision-first.md) rather than hidden here.

**Next:** step 09, `postgres_on_neon` — the invoices and this log move into a real database, and the
application's database user is allowed to insert log rows and not to change or delete them. Three
things this step left as comments become the database's job there: the log survives a restart, the
clock is the one that stamps the row, and the read-then-write that claims a sequence becomes one atomic
statement with a unique constraint — proven by a real parallel test, never against a mock.
