# Step 04 · Result and error envelopes

**New in this step:** every answer has one outer shape, and every refusal says whether
it is safe to try again (DSOR-ERR-01a, DSOR-SCH-01).

## In plain words

Until now, a refusal was a thrown JavaScript error with a sentence in it. A caller had
to read the sentence and guess. From this step, every answer from `call` is an
**envelope**: an object with a fixed outer shape, like the envelope a letter comes in.

A refusal is an **error envelope**. It carries a **code**, such as `RESOURCE_NOT_FOUND`,
a message for people, a **retry class**, and **correlation identifiers**. The retry
class answers the one question every error raises: may I try again, and when? For
`RESOURCE_NOT_FOUND` the answer is `never`. A correlation identifier is an id that ties
this answer to one request, so the same request can be found later in every log.

The specification's table in
[§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) gives every
code its retry class. Its JSON Schema, `error-envelope.schema.json`, checks the shape of
every error envelope.

A success has a shape too. The specification names the shape a *command* returns, a
**result envelope**. It does not name one for a *query*. So this step uses a small shape
of its own for a query's answer, `{ data, correlation }`, and says so.

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
the plan wrong, the plan changes here first.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-ERR-01a | **C1.** Every refusal is an error envelope that passes the real `error-envelope.schema.json` | Each refusal `call` can give is checked against the schema |
| DSOR-ERR-01a | **C2.** Its code is one from the §28 table, or a documented extension code starting `X_` | An unknown code is refused by the schema |
| DSOR-ERR-01a | **C3.** It carries the retry class the table gives its code | One test for each of the table's codes |
| DSOR-ERR-01a | **C4.** It carries correlation identifiers, and DSoR makes the `request_id` itself | A `request_id` sent by the caller is never used |
| DSOR-SCH-01 | **C5.** An error envelope is checked against the schema before it leaves `call` | An envelope that fails the schema is never returned |
| (our decision) | **C6.** A query's success is `{ data, correlation }` | `invoice.get` for INV-1008 returns it |
| (our decision) | **C7.** Nothing a caller can cause makes `call` throw | Every refusal comes back as a value |

DSOR-SCH-01 covers the documents listed in
[Appendix A](../../../specs/dsor/appendix-a-schemas.md). A query's answer is not one of
them, so C6's tests carry no rule id.

### What the real schemas said

Two findings, checked with ajv on 2026-09-25 against the specification's own schemas:

1. **The schema is looser than the table.** It ties a retry class to a code for only
   three codes: `OUTCOME_UNKNOWN` and `RESOURCE_HELD` must be `after_reconciliation`,
   and `BATCH_PARTIAL` must be `per_item`. For the other codes it accepts any retry
   class. `AUTHORIZATION_DENIED` with `safe_same_key`, "denied, try again at once",
   passes the schema. The §28 table says `never`.
2. **No success can be a result envelope yet.** Every result envelope outcome needs a
   proposal (step 22) and a payload hash (step 29), and neither exists yet. A query's
   answer fails the schema whatever its outcome. So the map's "every response in the
   tests validates against its schema" cannot be met honestly in this step. Only
   refusals can.

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
   specification's own definition. *Price:* once commands succeed, there are two shapes
   of success. If the specification later names a query's shape, this one is replaced.
4. **DSoR makes the `request_id` for every call, and never takes one from the caller.**
   DSoR never takes the agent's word for anything, and that includes which request
   this is. *Price:* a caller cannot choose its own id to match its own logs.
5. **Refusals are turned into envelopes in one place, `call`.** `money()` and
   `parseUri()` keep throwing a `TypeError`, and stay pure. *Price:* one function must
   know every kind of refusal.
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

### The tests, by claim

- **C1, C5:** every row of the table in decision 7 returns an envelope that passes the
  schema.
- **C2:** an envelope with a made-up code is refused by the schema.
- **C3:** one test for each code in the §28 table. Each checks the retry class.
- **C4:** every envelope has a `request_id`. Two calls get two different ids. A
  `request_id` in the caller's input is never used.
- **C6:** `invoice.get` for INV-1008 returns `{ data, correlation }`, and `data` is the
  invoice.
- **C7:** each refusal in decision 7 comes back as a value. None is thrown.

### Breaks we will try, and what we expect

Run against the finished step. The learner's prediction is recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| N1 | Every code gets `safe_same_key` | C3, one test per code | caught by many tests |
| N2 | A `request_id` sent by the caller is used | C4 | to predict |
| N3 | The schema check before `call` returns is removed | C5 | to predict |
| N4 | A `TypeError` from the input check escapes as a throw | C7 | to predict |
| N5 | `INV-9999` returns `{ data: undefined }` as a success | C1, `RESOURCE_NOT_FOUND` | to predict |

### Left open, and not this step's idea

- **Should an operation's input name a record by its canonical URI?** `invoice.get`
  takes `{ id: "INV-1008" }`, not `dsor://org_456/invoice/INV-1008`. DSOR-RID-03 says
  the same URI identifies a resource across every interface.
- **Where does "this invoice is already issued" go?** With `invoice.issue`, once
  proposals exist.

## What changed since step 03

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

## Check yourself

1. The payment to VENDOR-44 times out at the bank. Why must the retry class not be
   `safe_same_key`?
2. Why is `PENDING_APPROVAL` a result and not an error? What would an agent be tempted
   to do if it were an error?
3. The schema accepts `AUTHORIZATION_DENIED` with `safe_same_key`. Why does this step
   refuse it?
4. Why does DSoR make the `request_id` itself?
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
4. DSoR never takes the agent's word for anything. An id chosen by the caller could
   collide with another request's, or point the logs at the wrong one.
5. DSOR-SCH-01 covers the documents listed in Appendix A. A query's answer is not one
   of them. The shape is this tutorial's decision, and a test titled with a rule id
   would claim a rule the test does not prove.

</details>

## Think it through

_To be written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-ERR-01a | Every error validates against `error-envelope.schema.json`, with a code from the §28 table or a documented extension code, a retry class, and correlation identifiers | [§28 Result and error envelopes](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes), and [`error-envelope.schema.json`](../../../packages/spec/schemas/error-envelope.schema.json) | _to be counted_ |
| DSOR-SCH-01 | Every artifact named in Appendix A validates against its JSON Schema wherever it crosses an interface or is stored as evidence | [§0.5 Normative artifacts](../../../specs/dsor/00-conventions.md#05-normative-artifacts), and [Appendix A](../../../specs/dsor/appendix-a-schemas.md) | _to be counted_, for error envelopes only |

**Next:** step 05, who is calling.
