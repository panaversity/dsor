# Step 04 · Result and error envelopes

Folder: [`my_04_result_and_error_envelopes`](../my_04_result_and_error_envelopes/README.md) · 79 tests
Spec: [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) · `DSOR-ERR-01a`, `DSOR-SCH-01`, `DSOR-COR-01b`
Commits: `6cda512` → `16c177f` (7)

## What it does

Nothing throws at a caller any more. Every refusal is an **error envelope** carrying a
`code` from a closed list of 32, a `message`, a `retry` class, and a `request_id`.

`invoice.issue` — the command step 03 declared but did not carry out — is carried out here
and answers with a `COMMITTED` **result envelope**.

New tool: `ajv-formats`, pinned at 3.0.1.

## Why the step exists

A thrown sentence cannot be acted on. `retry` can: `never` means asking again cannot help,
`after_delay` means wait, `after_reconciliation` means find out what happened first.

Running the step shows six refusals, five distinct codes, and **every one says `never`**.
That sameness is the point — an agent that retries a `never` is an agent in a loop.

The dangerous case is step 37's: a bank stops answering, and DSoR does not know whether the
money moved. That is `OUTCOME_UNKNOWN`, retry `after_reconciliation`. `DSOR-UNK-01b` exists
because reporting it as retry-safe is how a payment goes out twice.

## Decisions taken here

- **[12](decisions.md#12--the-command-landed-in-step-04-not-a-new-step-2026-09-24)** — the
  command belongs with the envelopes, not in a step of its own.
- **[13](decisions.md#13--step-04-envelopes-refusals-and-the-commands-success-but-not-a-reads-2026-09-25)**
  — a read's success is not enveloped, because the specification has no outcome value for it.
- **[14](decisions.md#14--the-retry-class-comes-from-a-table-in-code-never-from-the-caller-2026-09-25)**
  — §28's table lives in code, because the schema will not enforce it.
- **[15](decisions.md#15--ajv-formats-added-as-a-real-dependency-2026-09-25)** —
  `ajv-formats`, and why it is not a `devDependency`.
- **[16](decisions.md#16--the-store-reports-a-fact-the-answering-layer-picks-the-code-2026-09-25)**
  — the store reports a fact; the answering layer names the code.

## The measurement the step is built on

```text
CONFLICT        + safe_same_key  schema says: true
OUTCOME_UNKNOWN + safe_same_key  schema says: false
RESOURCE_HELD   + safe_same_key  schema says: false
BATCH_PARTIAL   + never          schema says: false
```

The schema pins **three** codes and leaves twenty-nine alone, and not all for the same
reason. `OUTCOME_UNKNOWN` and `RESOURCE_HELD` are the unknown-outcome pair — nobody knows
yet whether the side effect happened, which is the one situation where retrying sends money
twice. `BATCH_PARTIAL` is the opposite: every item's outcome *is* known, and `DSOR-BAT-01c`
requires the envelope to list them, so `per_item` is the only class that can be true.

Everything else is the implementation's problem, which is why the table is in code and two
tests hold it to §28.

An earlier draft of the step's README said "exactly one". That was wrong, and the step's own
`BATCH_PARTIAL` test contradicted it — see [lessons 5](lessons.md#5--describing-a-file-instead-of-reading-it).

## What `COMMITTED` cost

The schema demands three companions, and two are placeholders:

| Field | Here | Becomes |
| --- | --- | --- |
| `proposal` | an address from a counter | step 22, a record with states and approvals |
| `payload_hash` | sha256 of `JSON.stringify(args)` | step 29, canonical JSON settling key order |
| `semantics` | **not** a placeholder — read from the contract | already real |

The hash is only as stable as `JSON.stringify` key order. Written down because a
fingerprint that looks authoritative and is not is worse than none — that field becomes
evidence later.

## The gap in the specification

`result-envelope.schema.json` has four `outcome` values and none means "here is your data".
Three demand proposal machinery; `VALIDATED` means a dry run and forces a control decision.
A read did neither. Appendix A says the schema covers "command and query results" and it
cannot express a query result.

So `invoice.get` keeps handing back the invoice, and the README says why rather than
borrowing a value that would state something untrue.

## Limits written down

- `DSOR-COR-01b` is met **wherever an envelope is built**. A successful read carries no
  correlation at all, for the same reason it carries no envelope.
- `DSOR-ERR-01b` is not claimed. The rule forbids revealing a resource **the caller is not
  authorized to read** — and there is no caller until step 05, no permission until 06.
- `DSOR-ERR-02`, `DSOR-UNK-01b`, `DSOR-COR-01a`, `DSOR-FRS-01a` and `DSOR-CLS-03` are all
  listed as not claimed, each with the step that brings it.
- One link in the start-up pairing check cannot be proved in this process: with the two
  lists matching, removing the call changes nothing observable. `assertPaired`'s own
  correctness is tested and `WIRING_CHECKED` exists only because the wrapper ran, but the
  middle link needs a child process.

## What the sweeps found

Two mutation sweeps, nine then eleven unprotected guards. The largest: **22 of the 32 rows**
of the retry table were reached by no test, and mutating all 22 at once left all 76 tests
green. One test now pins every row; verified by mutating all 32 individually — 32 killed, 0
survived.

Six further gaps belong to steps 01 and 02 and were reported rather than patched, by
[decision 17](decisions.md#17--defects-from-an-earlier-step-are-reported-not-patched-forward-2026-09-25).
