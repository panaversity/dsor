# Step 04 · Result and error envelopes

**New in this step:** every refusal comes back with a code and says whether trying again
could ever help, instead of being a thrown error with a sentence in it.

## In plain words

Until now, when something was refused your code threw an error:

```text
TypeError: INV-1009 is issued, and only a draft invoice can be issued
```

A person can read that. A program cannot *act* on it. Should it try again in a minute?
Never try again? Fix its input and retry? The sentence does not say, so the caller has to
guess — and a caller that guesses wrong about money sends a second payment.

An **envelope** is a standard outer wrapper around every answer, so a caller always knows
where to look. This step adds two, both from the specification:

An **error envelope** carries four things:

| Field | What it holds |
|---|---|
| `code` | one of 32 fixed names, such as `CONFLICT` or `RESOURCE_NOT_FOUND` |
| `message` | the sentence, for a human reading a log |
| `retry` | **whether trying again could ever help** |
| `correlation.request_id` | a name for this one request, so it can be followed |

A **result envelope** is the same idea for success. `invoice.issue` — the command step 03
declared but did not carry out — is carried out here and answers with one.

The `retry` field is the new idea. There are six possible values, and they are advice a
program can follow without understanding the situation:

| Retry class | Means |
|---|---|
| `never` | asking again cannot help. Something must change first |
| `after_delay` | it may work later. Wait, then try |
| `after_state_refresh` | re-read the data, decide again, then try |
| `after_reconciliation` | nobody knows what happened. Find out first |
| `safe_same_key` | it is safe to send the identical request again |
| `per_item` | a **batch** — one request carrying many items. Each item has its own answer |

## Why it matters

Look at what `pnpm start` prints now. Six refusals, five different codes, and **every one
says `never`** (the full output is under "Run it" below):

```text
CONFLICT                 retry: never                INV-1009 is issued, and only a draft invoice can be issued
RESOURCE_NOT_FOUND       retry: never                INV-9999 is not an invoice we hold
TENANT_MISMATCH          retry: never                dsor://org_999/invoice/INV-1008 is for org_999, and this program serves org_456
VALIDATION_FAILED        retry: never                invoice.get is named for invoice, and dsor://org_456/vendor/VENDOR-44 names vendor
VALIDATION_FAILED        retry: never                not a canonical URI: "INV-1008"
UNSUPPORTED_CAPABILITY   retry: never                execute_sql is not an operation: this program has no contract for it
```

They are all the same, and that is the point. Not one of them is worth retrying, and a
caller now knows that without reading English. An agent that retries a `never` is an agent
in a loop.

The dangerous one is not here yet. In step 37 a bank stops answering, and DSoR does not
know whether the money moved. That answer is `OUTCOME_UNKNOWN`, retry
`after_reconciliation` — *find out what happened, do not send it again*. The rule
`DSOR-UNK-01b` exists because reporting that as a retry-safe error is how a payment goes
out twice. The retry class you are building today is the machinery that rule needs.

## The schema checks the shape. It does not check the meaning.

This is the part worth slowing down for.

`error-envelope.schema.json` is the specification's own file, and it checks that `retry`
holds one of the six allowed words. It does **not** check that it holds the *right* one:

```text
CONFLICT + never          schema says: true   table says: never
CONFLICT + safe_same_key  schema says: true   table says: never
```

Both validate. A `CONFLICT` marked `safe_same_key` would make an agent retry the same
request for ever, and the schema has nothing to say about it.

There are three exceptions, and they are the three worth pinning:

```text
OUTCOME_UNKNOWN + safe_same_key  schema says: false
RESOURCE_HELD   + safe_same_key  schema says: false
BATCH_PARTIAL   + never          schema says: false
CONFLICT        + safe_same_key  schema says: true
RATE_LIMITED    + never          schema says: true
```

The schema fixes `OUTCOME_UNKNOWN` and `RESOURCE_HELD` to `after_reconciliation`, and
`BATCH_PARTIAL` to `per_item`. The other twenty-nine it leaves alone. Somebody decided
those three were too dangerous to leave to an implementation — the first two are both
"nobody knows what happened yet", which is the one situation where retrying sends money
twice.

So the code→retry table lives in `src/envelopes.ts`, transcribed from
[§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes), and
`refusal(code, message)` looks the class up rather than accepting one from its caller.

Two tests hold the table to the specification. One reads the schema's own list of 32 codes
and fails if the table is missing any. The other pins every row's value, because only ten
of the thirty-two are reached by a refusal a test happens to build — the other twenty-two
could have said anything, and a wrong row is a wrong instruction.

This is the same lesson as `money()` in step 01 and `parseUri` in step 02, one level up:
**a shape check and a meaning check are different jobs.** By now you should expect it.

## What changed since step 03

```text
my_04_result_and_error_envelopes/
  src/envelopes.ts          NEW  the two builders, the §28 table, request ids
  test/envelopes.test.ts    NEW  twenty-two tests: the table, the shapes, the refusals
  src/schemas/*.json        NEW  result-envelope and error-envelope, copied byte for byte
  src/invoice.ts        CHANGED  a new issueInvoice, which reports an outcome instead of throwing
  src/operations.ts     CHANGED  every refusal is an envelope; invoice.issue has a handler
  src/main.ts           CHANGED  reads every answer in one place, printing its code and retry class
  test/operations.test.ts CHANGED every refusal test asserts a code and a retry class; seven new
  src/registry.ts       CHANGED  step 03's NEW IN STEP markers removed
  test/registry.test.ts CHANGED  step 03's NEW IN STEP markers removed
  package.json          CHANGED  name, description, and ajv-formats
```

```bash
cd docs/baby_steps_tutorials
diff -rq --exclude=node_modules --exclude=pnpm-lock.yaml \
  my_03_operations_and_contracts my_04_result_and_error_envelopes
```

### One new dependency, and a warning it silences

This step adds one package, `ajv-formats@3.0.1`. The version is pinned exactly, and like
ajv it is a real dependency rather than a `devDependency`.

The result envelope has a field, `expires_at`, whose schema says `"format": "date-time"`.
Without `ajv-formats`, ajv does not know that format: it prints `unknown format
"date-time" ignored` and then accepts `"tomorrow"` as a date. A step that teaches schema
validation should not ship a validator that quietly skips a check.

It comes with one oddity you will meet again. `ajv-formats` is published in CommonJS,
Node's older module format, so the function you call sits on the import's `.default`
rather than being the import itself. `tsc` reports *"This expression is not callable"*
without the cast in `src/envelopes.ts`. Node runs the plain import fine — only the
typecheck complains.

## Run it

```bash
cd docs/baby_steps_tutorials/my_04_result_and_error_envelopes
pnpm install
pnpm start
```

```text
Hello, accounts-payable-fte.
operations: invoice.get, invoice.issue

(no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued
(no envelope)            dsor://org_456/invoice/INV-1009  2500.00 USD  draft

COMMITTED                dsor://org_456/invoice/INV-1009  issued
                         proposal dsor://org_456/proposal/prop_0001
                         payload  sha256:e2f80b67d9a15698…
CONFLICT                 retry: never                INV-1009 is issued, and only a draft invoice can be issued

RESOURCE_NOT_FOUND       retry: never                INV-9999 is not an invoice we hold
TENANT_MISMATCH          retry: never                dsor://org_999/invoice/INV-1008 is for org_999, and this program serves org_456
VALIDATION_FAILED        retry: never                invoice.get is named for invoice, and dsor://org_456/vendor/VENDOR-44 names vendor
VALIDATION_FAILED        retry: never                not a canonical URI: "INV-1008"
UNSUPPORTED_CAPABILITY   retry: never                execute_sql is not an operation: this program has no contract for it
```

```bash
pnpm check                 # typecheck, then test. 79 tests pass
```

### Why two lines say "(no envelope)"

Because the specification has no way to put a read's answer in one, and this step will
not pretend otherwise.

`result-envelope.schema.json` has an `outcome` field with four allowed values, and none
of them means "here is the data you asked for":

| Value | What it demands |
|---|---|
| `COMMITTED`, `READY`, `PENDING_APPROVAL` | a proposal address, a payload fingerprint, and execution semantics — how the command runs, named in its contract |
| `VALIDATED` | a `decision` of `ALLOW` / `DENY` / … — the spec means this as a **dry run**: run the checks, decide, change nothing |

A read did not commit anything, did not create a proposal, and was not a dry run. Appendix
A says this schema covers "command and query results", and it cannot express a query
result. That is a gap in the specification, not something this step can fix quietly, so
`invoice.get` keeps handing back the invoice and this paragraph says why.

Refusals are different: `invoice.get`'s refusals *are* enveloped, because the error
envelope fits any operation.

### What `COMMITTED` cost, honestly

`invoice.issue` succeeded, so `outcome: "COMMITTED"` is the truthful value — and the
schema then demands three companions. Two of them are placeholders, and it matters that
you know which:

| Field | What it is here | What it becomes |
|---|---|---|
| `proposal` | an address from a counter | step 22, where a proposal is a *record* with states and approvals |
| `payload_hash` | a hash (sha256) of `JSON.stringify(args)` — a short fixed-length fingerprint of the arguments | step 29, where *canonical* JSON settles key order so the fingerprint is stable |
| `semantics` | **not** a placeholder — copied from the operation's contract | already real |

The hash is only as stable as `JSON.stringify` key order today. That is a real limit, and
writing a false fingerprint into what later becomes evidence is worse than writing none —
so it is stated here rather than discovered in step 29.

### Where the code is chosen

`issueInvoice` in `src/invoice.ts` reports a *fact*: `issued`, `not_found`, or `not_draft`.
It does not choose an error code. `src/operations.ts` does that, because a code is part of
the answer to a caller rather than part of the store.

The obvious alternative is for the store to throw, and `operations.ts` to catch and
translate. Reporting a fact instead means there is nothing to catch: the outcome is a
value, and the layer that answers callers reads it. That separation is what made the codes
possible.

### The request id you cannot avoid

Both envelopes require `correlation.request_id`, so nothing can be returned until one
exists. That is the schema's own minimum, not extra work this step chose to take on.

It comes from a counter (`req_1`, `req_2`, …) so a test can say exactly which one it
expects. A real deployment would use something unguessable, because a counter tells anyone
who sees one id how many requests came before it and what the next one will be.

`correlation` holds seven ids in all, and nothing else in it is filled in — a test asserts
exactly that. `tenant_id` waits for step 10, `agent_id` and `principal_id` for step 05, and
carrying all seven through connectors, audit and events for step 40.

## Break it

Five breaks. Change the code back after each.

**1. Let the caller choose the retry class.** In `src/envelopes.ts`, replace
`const retry = CODE_RETRY[code];` with `const retry = "safe_same_key" as Retry;`. Run
`pnpm test`:

```text
      Tests  9 failed | 70 passed (79)
```

Every refusal in the step is now wrong, and note *what is not wrong*: every envelope
still validates against the schema. For twenty-nine of the thirty-two codes, the schema
never had an opinion.

**2. Change one row of the table.** Set `CONFLICT: "safe_same_key"`. Run `pnpm test`:

```text
     × DSOR-ERR-01a: a refusal carries a retry class and a request id
     × DSOR-ERR-01a: the retry class comes from the code, not from the caller
     × the schema pins three codes' retry classes, and only three
     × DSOR-ERR-01a: the table cannot be edited at run time
     × DSOR-SCH-01: issuing a draft returns COMMITTED, and the second attempt is CONFLICT
      Tests  6 failed | 73 passed (79)
```

This is the break worth sitting with. You have just told every caller that re-issuing an
already-issued invoice is safe to retry. The schema validates it. Six tests are the only
thing standing between that and a caller in a loop.

**3. Drop a code from the table.** Delete the `RATE_LIMITED` line. Run `pnpm test`:

```text
      Tests  4 failed | 75 passed (79)
```

One of those four is the test that reads the schema's own list of 32 codes; another is the
one that pins all thirty-two rows to §28. The table
cannot fall behind the specification without something going red.

**4. Remove the self-check.** In `refusal`, delete the `if (!validateEnvelope(...))` block
that runs before the envelope is returned. Run `pnpm test`:

```text
      Tests  1 failed | 78 passed (79)
```

That check is why a `BATCH_PARTIAL` cannot be built in this step: the schema requires an
`items` array listing each item's own answer, and there are no batches until step 41.
Without the check, a half-built envelope would be handed to the caller.

**5. Use the wrong code for the right situation.** In `src/operations.ts`, change the
re-issue refusal from `CONFLICT` to `RESOURCE_NOT_FOUND`. Run `pnpm test`:

```text
      Tests  2 failed | 77 passed (79)
```

The envelope is perfectly valid. The retry class is correct for the code. And the answer
is a lie: the invoice exists. Nothing but a test knows the difference.

Change everything back and run `pnpm check` to see 79 tests pass.

## Build it yourself with Claude Code

This folder is a learner copy — the `my_` prefix. The official
`04_result_and_error_envelopes` is still listed as planned in the [map](../readme.md), so
there is nothing to compare against yet.

```bash
cd docs/baby_steps_tutorials
cp -r my_03_operations_and_contracts my_04_result_and_error_envelopes
cd my_04_result_and_error_envelopes
rm -rf node_modules && pnpm install
claude
```

Then paste one line:

```text
Use the build-baby-step skill in learner mode. We are building step 04,
result_and_error_envelopes.
```

Ask for a plan before any code, and ask to see the new tests fail before they pass. The
general directions are in the
[tutorial overview](../readme.md#build-the-steps-with-claude-code).

## Check yourself

1. Why is a thrown `TypeError` not good enough for a caller?
2. `CONFLICT` with `retry: "safe_same_key"` passes the specification's own schema. So what
   stops it happening?
3. The schema *does* pin one code's retry class. Which, and why that one?
4. `invoice.get` succeeds and gets no envelope. Is that a bug in this step?
5. `payload_hash` is a sha256 of the arguments. Why is the README careful to call it a
   placeholder?
6. `issueInvoice` reports `not_draft` instead of choosing `CONFLICT` itself. Why?

<details>
<summary>Answers</summary>

1. Because a caller cannot act on a sentence. It cannot tell "wait and retry" from "never
   retry" without reading English, and guessing wrong about a command that moves money
   means sending it twice.
2. Nothing in the schema. The table in `src/envelopes.ts` and the tests over it are the
   only thing. That is the step's lesson: the schema proves the shape of an answer, and
   only code can prove its meaning.
3. `OUTCOME_UNKNOWN`, which must be `after_reconciliation`. It is the one case where
   nobody knows whether the side effect happened, so a retry-safe class would invite a
   duplicate payment — the failure `DSOR-UNK-01b` exists to prevent. It arrives properly
   in step 37.
4. No, it is a gap in the specification, stated plainly. `result-envelope.schema.json` has
   no `outcome` value meaning "here is your data": three demand proposal machinery and the
   fourth means a dry run. Borrowing one would put something untrue in every read.
5. Because the hash depends on `JSON.stringify` key order, so the same payload written
   with keys in a different order fingerprints differently. Canonical JSON arrives in step
   29. A fingerprint that looks authoritative and is not is worse than none, because this
   field later becomes evidence.
6. Because choosing an error code is part of answering a caller, not part of storing data.
   The store reports what happened; `operations.ts` decides how to say it. Splitting those
   two is what let the thrown sentence become a code.

</details>

## The rules this step meets

- **[DSOR-ERR-01a · L1]** Every error MUST validate against `error-envelope.schema.json`,
  carrying a code from this table or a documented extension code, a retry class, and
  correlation identifiers.
  ([§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes))
- **[DSOR-SCH-01 · L1]** Every artifact named in Appendix A MUST validate against its JSON
  Schema (draft 2020-12) wherever it crosses an interface or is stored as evidence.
  ([§0.5](../../../specs/dsor/00-conventions.md#05-normative-artifacts))
- **[DSOR-COR-01b · L1]** DSoR MUST generate a `request_id` when the caller supplies none.
  ([§32](../../../specs/dsor/03-execution.md#32-correlation)) — met wherever an envelope is
  built. A successful read carries no correlation at all, for the same reason it carries no
  envelope.

`DSOR-ERR-01a` is met for every refusal this step can produce, and each one is checked
against the schema before it leaves `refusal()`. The rule's phrase "a documented extension
code" is worth noting: the schema also allows any code matching `^X_[A-Z0-9_]+$`, which is
how an implementation could escape the closed list entirely. This step never does, and
nothing in the schema would stop it.

`DSOR-SCH-01` is met for every artifact this step actually puts in an envelope: both
envelope kinds, plus the operation contracts step 03 already validated. The one Appendix A
artifact it leaves unvalidated is a query result — see "Why two lines say (no envelope)"
above, which is the same gap seen from the other side.

Nearby rules this step does **not** claim. Three are §28 and §32; the others live in §19,
§25 and §27, and are here because a reader meeting envelopes will wonder about them:

| Rule | Why not |
| --- | --- |
| `DSOR-ERR-01b` | An error must not reveal a resource **the caller is not authorized to read**. That condition is the whole rule, and this step has no caller and no permissions — so `RESOURCE_NOT_FOUND` naming the id is safe here and stops being safe in step 06. The schema could not see it either way. |
| `DSOR-ERR-02` | A command's connector error must not be retry-safe unless the side effect provably did not occur. There is no connector until step 34, and "provably" cannot be expressed in a table. |
| `DSOR-UNK-01b` | Nothing in this step can produce an unknown outcome, because nothing can fail halfway. A test shows the schema pins that code's retry class, and carries no rule id, because showing what the schema does is not meeting the rule. Step 37. |
| `DSOR-COR-01a` | All seven correlation ids propagated through connectors, audit and events. Only `request_id` exists here. Step 40. |
| `DSOR-FRS-01a` | A query result must carry when it was read, the resource version, the connector, and the freshness mode — how recent the data had to be. `result-envelope.schema.json` has no field for any of them, and this step puts no read in an envelope at all. Step 15. |
| `DSOR-CLS-03` | A read result must carry its classification — how sensitive the data is. The schema has a `classification` field, but it is optional and no branch of the schema ever requires it, so it could not enforce this even if a read were enveloped. Step 14. |

**Next:** step 05, who is calling — every request starts carrying a caller, and the
handler signature stops being `(args)`.
