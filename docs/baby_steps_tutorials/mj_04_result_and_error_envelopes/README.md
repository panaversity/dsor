# Step 04 · Result and error envelopes

**New in this step:** every answer has one outer shape, and every refusal says whether
it is safe to try again (DSOR-ERR-01a, DSOR-SCH-01, DSOR-COR-01b).

## In plain words

Until now, a refusal was a thrown JavaScript error with a sentence in it. A caller had
to read the sentence and guess. From this step, every answer from `call` is an
**envelope**: an object with a fixed outer shape, like the envelope a letter comes in.

A refusal is an **error envelope**. It carries a **code**, such as `RESOURCE_NOT_FOUND`,
a message for people, a **retry class**, and **correlation identifiers**. The retry
class answers the one question every error raises: may I try again, and when? For
`RESOURCE_NOT_FOUND` the answer is `never`. A correlation identifier is an id that ties
this answer to one request, so the same request can be found later in every log. The
main one is the `request_id`. When the caller sends none, DSoR makes one.

The specification's table in
[§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) gives every
code its retry class. Its JSON Schema, `error-envelope.schema.json`, checks the shape of
every error envelope.

A success has a shape too, the **result envelope**. The specification uses it for the
answer to a *command* and to a *query*. Every result envelope names an **outcome**, a
word such as `COMMITTED` that says what happened. None of the four outcomes fits a query
that reads an invoice. So this step answers a query with a small shape of its own,
`{ data, correlation }`, and says so.

`call` never throws for anything a caller can cause. It returns an envelope.

## Why it matters

**An agent that cannot read an error guesses, and its guess is to try again.** From
step 35, `payment.execute` sends money through a bank. Suppose the bank does not answer
in time. The agent gets back a sentence it cannot interpret, and does what agents do:
it sends the payment again. VENDOR-44 is paid 31,400.00 USD twice. The retry class is
how DSoR says "do not try again until someone finds out what happened". For that case
it is `after_reconciliation`.

The retry class is honest advice, not the lock. An agent can ignore advice. Later
steps make DSoR refuse a second attempt anyway: step 20 with idempotency keys, and
step 37 by holding the payment. The envelope tells a careful agent the truth. The
checks stop a careless one.

**"Needs approval" is a result, not an error.** An error invites "fix it". The obvious
fix for a 25,000 USD threshold is to split PAY-901 into two payments of 15,700.00 USD,
each below it. A result that says `PENDING_APPROVAL` means: your part is done, the work
is waiting, and `cfo_100` decides. That result needs proposals (step 22) and a rule
that asks for approval (step 27). This step only makes room for it.

**Common mistake:** returning `{ error: "something went wrong" }` and leaving the agent
to guess whether to try again. Every refusal carries a code and the retry class the
table gives that code.

## The design, before any code

This section was written before the first test, in a learner session. If the code finds
the plan wrong, the plan changes here first. It changed once already, before the first
test. "Think it through" says what changed and why.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-ERR-01a | **C1.** Every refusal is an error envelope that passes the real `error-envelope.schema.json` | Each refusal `call` can give is checked against the schema |
| DSOR-ERR-01a | **C2.** Its code is one from the §28 table, or a documented extension code starting `X_` | An unknown code is refused by the schema |
| DSOR-ERR-01a | **C3.** It carries the retry class the table gives its code | One test for each of the table's codes |
| DSOR-ERR-01a, DSOR-COR-01b | **C4.** It carries correlation identifiers. The caller sent no `request_id`, so DSoR makes one | Every answer has a `request_id`. Two calls get two different ones. A `request_id` inside the operation's input is not used |
| DSOR-SCH-01 | **C5.** An error envelope is checked against the schema before it leaves `call` | An envelope that fails the schema is never returned. `INTERNAL_ERROR` goes out in its place |
| (our decision) | **C6.** A query's success is `{ data, correlation }` | `invoice.get` for INV-1008 returns it |
| (our decision) | **C7.** Nothing a caller can cause makes `call` throw | Every refusal comes back as a value. A bug comes back as `INTERNAL_ERROR` |

DSOR-SCH-01 covers the documents listed in
[Appendix A](../../../specs/dsor/appendix-a-schemas.md), and Appendix A lists the result
envelope for "command and query results". So the rule covers a query's answer too. C6's
shape does not meet it (finding 2 below), so C6's tests carry no rule id. A test titled
DSOR-SCH-01 would claim a rule that the answer breaks.

### What the real schemas said

Two findings, checked with ajv on 2026-09-25 against the specification's own schemas:

1. **The schema is looser than the table.** It ties a retry class to a code for only
   three codes: `OUTCOME_UNKNOWN` and `RESOURCE_HELD` must be `after_reconciliation`,
   and `BATCH_PARTIAL` must be `per_item`. For the other codes it accepts any retry
   class. `AUTHORIZATION_DENIED` with `safe_same_key`, "denied, try again at once",
   passes the schema. The §28 table says `never`.
2. **No outcome fits a query's answer.** A result envelope must name one of four
   outcomes. `COMMITTED`, `READY`, and `PENDING_APPROVAL` each need a proposal (step 22)
   and a payload hash (step 29). `VALIDATED` needs only a `decision`, and
   `{ outcome: "VALIDATED", decision: "ALLOW", data, correlation }` passes. But
   `VALIDATED` answers a dry run, a call that asks "would this be allowed?" and does
   nothing. And `ALLOW` would claim a permission check that arrives in step 06. Our
   `{ data, correlation }` fails, because it has no outcome. So the map's "every
   response in the tests validates against its schema" cannot be met honestly in this
   step. Only refusals can. This is a gap in the specification (see "Left open").

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a price.

1. **This step is error envelopes, plus a small shape for a query's success.**
   `invoice.issue` stays unbuilt. *Price:* `invoice.issue` moves again. Its success
   needs a proposal, and proposals are step 22.
2. **Every code carries exactly the retry class the §28 table gives it.** This is
   stricter than the schema, never looser. The table is copied from the prose into
   code, with one test for each code. *Price:* the guard cannot watch a table copied
   from prose. The tests do.
3. **A query's success is `{ data, correlation }`.** Both names are the ones
   `result-envelope.schema.json` already uses, and `correlation` follows the
   specification's own definition. There is no `outcome`, because none fits (finding
   2). *Price:* a query's answer does not meet DSOR-SCH-01, and this README says so.
   Once commands succeed, there are two shapes of success. When the specification gives
   a query an outcome, this shape becomes a result envelope.
4. **DSoR makes the `request_id` for every call, because no caller can send one yet.**
   [§32](../../../specs/dsor/03-execution.md#32-correlation) says a caller passes its
   correlation identifiers along, and DSoR makes a `request_id` when the caller sends
   none (DSOR-COR-01b). In this step, `call` takes an operation's name and its input,
   and nothing else. A `request_id` written inside the input is not a correlation
   identifier, because the input holds the operation's arguments. The form is this
   tutorial's decision: `req_` and a random UUID, a 36-character id made from random
   numbers. *Price:* until DSoR has a real front door (the REST API is step 42), a
   caller cannot send its own ids to match its own logs. It can record the `request_id`
   that comes back in every answer.
5. **A refusal names its code, and `call` does the rest.** The code behind an operation,
   its *handler*, refuses by throwing a `Refusal`: an error that carries a code from the
   §28 table and a message. `call` turns it into an envelope. It adds the retry class
   from the table and the correlation, then checks the schema. A `Refusal` has no retry
   class of its own, so a handler cannot choose one. Anything else that is thrown is a
   bug, and becomes `INTERNAL_ERROR`. `call` cannot sort errors by JavaScript's own
   classes: JavaScript throws a `TypeError` for bad input, and also for a bug such as
   reading `.id` of `undefined`. `money()` and `parseUri()` keep throwing a
   `TypeError`, and stay pure. *Price:* a handler that gives a caller's input to
   `money()` or `parseUri()` must catch the `TypeError` and throw a `Refusal` itself.
6. **`error-envelope.schema.json` is copied in, as step 03 copied its schemas.** The
   guard fails if the copy differs from the original.
7. **Which code each refusal gets.** From the §28 table:

   | Refusal | Code | Retry |
   | --- | --- | --- |
   | An operation name with no contract, such as `invoice.delete` | `UNSUPPORTED_CAPABILITY` | never |
   | `invoice.issue`: a contract, and no code yet | `UNSUPPORTED_CAPABILITY` | never |
   | `invoice.get` without a text `id` | `VALIDATION_FAILED` | never |
   | `invoice.get` for `INV-9999`, which does not exist | `RESOURCE_NOT_FOUND` | never |
   | Anything unexpected: a bug | `INTERNAL_ERROR` | never |

   The first two share a code and differ in their message. The learner chose
   `UNSUPPORTED_CAPABILITY` for an unknown name: DSoR cannot do that thing, so the
   caller learns it is a missing capability, not a typo in its input. A broken contract
   at start-up gets no envelope: the program never starts, so there is no caller to
   answer.
8. **When something goes wrong inside `call`.** Four choices the specification leaves
   open:
   - An envelope that fails the schema never leaves `call`. A fixed `INTERNAL_ERROR`
     envelope goes out in its place, and `call` does not throw (C7).
   - `INTERNAL_ERROR` carries a fixed message. A bug's own message can name internal
     details, so it never reaches the caller.
   - `INTERNAL_ERROR` is `never` for a query too. The §28 table says "never for
     commands" and says nothing about queries.
   - This step documents no extension codes, so it sends none. The schema accepts
     `X_MY_CODE` with any retry class. Our table gives it no retry class, so its
     envelope fails the check.

### The tests, by claim

The tests check every envelope with their own ajv, built from the schema file. So a
broken check in `src` cannot pass its own work.

- **C1:** every row of the table in decision 7 returns an envelope that passes the
  schema.
- **C2:** an envelope with a made-up code is refused by the schema. The table in `src`
  lists exactly the schema's 32 codes.
- **C3:** one test for each code in the §28 table. A `Refusal` with that code goes
  through `call`, and the test checks the retry class. The test types the table out
  again from §28, so a mistake in `src` is not copied into it. `BATCH_PARTIAL` is the
  exception. The schema also requires its `items`, which this step cannot build. So its
  retry class is checked in the table, and its envelope is C5's test.
- **C4:** every answer has a `request_id`. Two calls get two different ones. A
  `request_id` inside the input is not used.
- **C5:** an envelope that would fail the schema comes back as `INTERNAL_ERROR`. Three
  cases: `BATCH_PARTIAL` without its `items`, a code the table does not list, and an
  extension code this step has not documented.
- **C6:** `invoice.get` for INV-1008 returns `{ data, correlation }`, and `data` is the
  invoice.
- **C7:** each refusal in decision 7 comes back as a value. None is thrown. A bug that
  throws a `TypeError` comes back as `INTERNAL_ERROR`, not `VALIDATION_FAILED`, and its
  own message is not in the envelope.

### Breaks we will try, and what we expect

Run against the finished step. N1 was predicted before any code. N2, N4, N5, and N6 were
predicted after the code, before the breaks ran. N3 was seen while building: before the
schema check existed, its three tests failed.

| # | The break | Expected to be caught by | Learner's prediction | Result |
| --- | --- | --- | --- | --- |
| N1 | Every code gets `safe_same_key` | C3, one test per code | caught by many tests | Caught by 43: C3 28, C7 7, C1 5, C5 3 |
| N2 | A `request_id` inside the input is used | C4 | caught by exactly one | Caught by 1, C4's test for it |
| N3 | The schema check before `call` returns is removed | C5 | seen while building | Caught by 3, C5's |
| N4 | A `Refusal` from the input check escapes `call` as a throw | C7 | survives | Caught by 9: every test with a bad input, and C3's `VALIDATION_FAILED` row |
| N5 | `INV-9999` returns `{ data: undefined }` as a success | C1, `RESOURCE_NOT_FOUND` | survives | Caught by 4, in three files |
| N6 | `call` reports every thrown error as `VALIDATION_FAILED`, bugs too | C7 | survives | Caught by 3, the bug tests in C1 and C7 |

### Left open, and not this step's idea

- **Should an operation's input name a record by its canonical URI?** `invoice.get`
  takes `{ id: "INV-1008" }`, not `dsor://org_456/invoice/INV-1008`. DSOR-RID-03 says
  the same URI identifies a resource across every interface.
- **Where does "this invoice is already issued" go?** With `invoice.issue`, once
  proposals exist.
- **Where does a query's answer get its outcome?** Appendix A says the result envelope
  carries query results. DSOR-FRS-01a says every query result states `observed_at` and
  its freshness. The schema has no outcome for a query, and no field for either. This
  is a question for the specification, raised outside this step.

## What changed since step 03

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

**Make a timed-out payment look safe to retry.** In `src/envelope.ts`, change one row of
the table:

```ts
  OUTCOME_UNKNOWN: "safe_same_key",
```

That row now says: nobody knows whether the money left, and it is safe to send it again.
Run `pnpm test`. These are the lines that matter:

```text
 FAIL  test/envelope.test.ts > C3: every code carries the retry class the §28 table gives it > DSOR-ERR-01a: OUTCOME_UNKNOWN is refused with retry class after_reconciliation
AssertionError: expected { code: 'INTERNAL_ERROR', …(3) } to match object { code: 'OUTCOME_UNKNOWN', …(1) }
  {
-   "code": "OUTCOME_UNKNOWN",
-   "retry": "after_reconciliation",
+   "code": "INTERNAL_ERROR",
+   "retry": "never",
  }
      Tests  1 failed | 186 passed (187)
```

Two things stopped it. The schema ties `OUTCOME_UNKNOWN` to `after_reconciliation`, so
the envelope failed the check, and `call` sent `INTERNAL_ERROR` with `never` in its
place. The agent was told not to try again. And the test, which holds its own copy of
the table, saw the wrong answer.

**Now a lie the schema allows.** Put that row back, and change another:

```ts
  AUTHORIZATION_DENIED: "safe_same_key",
```

```text
 FAIL  test/envelope.test.ts > C3: every code carries the retry class the §28 table gives it > DSOR-ERR-01a: AUTHORIZATION_DENIED is refused with retry class never
AssertionError: expected { code: 'AUTHORIZATION_DENIED', …(3) } to match object { code: 'AUTHORIZATION_DENIED', …(1) }
  {
    "code": "AUTHORIZATION_DENIED",
-   "retry": "never",
+   "retry": "safe_same_key",
  }
      Tests  1 failed | 186 passed (187)
```

This envelope passed the schema and left `call`. It told the agent "denied, try again
at once". Only the test saw it. This is finding 1: the schema checks the retry class of
three codes, and the table gives one to all 32. Put the row back, and `pnpm check` is
green again.

## Build it yourself with Claude Code

_To be written when the code exists._

## Check yourself

1. The payment to VENDOR-44 times out at the bank. Why must the retry class not be
   `safe_same_key`?
2. Why is `PENDING_APPROVAL` a result and not an error? What would an agent be tempted
   to do if it were an error?
3. The schema accepts `AUTHORIZATION_DENIED` with `safe_same_key`. Why does this step
   refuse it?
4. In this step, why does DSoR make every `request_id`? And why is a `request_id` inside
   the input not used?
5. A query's success here is `{ data, correlation }`. Why does no test for it carry the
   id DSOR-SCH-01?

<details>
<summary>Answers</summary>

1. Nobody knows whether the money left. `safe_same_key` tells the agent a second try is
   safe, and it may pay VENDOR-44 twice. The right class is `after_reconciliation`: do
   not try again until someone finds out what happened.
2. Nothing went wrong. The work is waiting for `cfo_100`. An error invites a fix, and
   the obvious fix for a threshold is to split the payment into smaller ones that each
   pass below it.
3. The §28 table says `AUTHORIZATION_DENIED` is `never`. The schema checks the retry
   class for only three codes. This step refuses more than the schema, never less.
4. §32 says DSoR makes a `request_id` whenever the caller sends none (DSOR-COR-01b).
   In this step no caller has a way to send one. The input holds the operation's
   arguments, so a `request_id` written there is an argument, not a correlation
   identifier.
5. DSOR-SCH-01 does cover a query's answer: Appendix A lists the result envelope for
   command and query results. But `{ data, correlation }` fails that schema, because it
   has no outcome, and no outcome fits a query yet. A test titled DSOR-SCH-01 would
   claim a rule the answer breaks. The README says so instead.

</details>

## Think it through

### Found before the first test

A second check of the design against the specification, before any code, changed three
things:

- **DSOR-SCH-01 covers a query's answer.** The design first said a query's answer was
  not an Appendix A document. But Appendix A lists the result envelope for "command and
  query results". The code did not change. The reason C6's tests carry no rule id did,
  and finding 2 now names `VALIDATED`.
- **§32 says who makes the `request_id`.** The design first said DSoR never takes one
  from the caller. §32 says the caller passes it along, and DSoR makes one only when the
  caller sends none. The code did not change, because no caller can send one yet. The
  step now claims DSOR-COR-01b.
- **A refusal carries its code.** The design first had `call` recognize every kind of
  refusal. Sorting by JavaScript's `TypeError` would report a bug as the caller's
  mistake. And with every code chosen inside `call`, no test could reach the schema
  check, so N3 would survive. Handlers now throw a `Refusal` that names its code.

_The rest is written after the review, with the result of every break in the table
above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-ERR-01a | Every error validates against `error-envelope.schema.json`, with a code from the §28 table or a documented extension code, a retry class, and correlation identifiers | [§28 Result and error envelopes](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes), and [`error-envelope.schema.json`](../../../packages/spec/schemas/error-envelope.schema.json) | _to be counted_ |
| DSOR-SCH-01 | Every artifact named in Appendix A validates against its JSON Schema wherever it crosses an interface or is stored as evidence | [§0.5 Normative artifacts](../../../specs/dsor/00-conventions.md#05-normative-artifacts), and [Appendix A](../../../specs/dsor/appendix-a-schemas.md) | _to be counted_. Met for error envelopes only. A query's answer does not meet it (finding 2) |
| DSOR-COR-01b | DSoR generates a `request_id` when the caller supplies none | [§32 Correlation](../../../specs/dsor/03-execution.md#32-correlation) | _to be counted_ |

**Next:** step 05, who is calling.
