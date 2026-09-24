# Step 03 · Operations and contracts

**New in this step:** every action a caller can take has a name and a spec sheet, and a
bad spec sheet stops the program before it answers anything.

## In plain words

Until now, code called `getInvoice("INV-1008")` directly. This step stops that.

Every action becomes a named **operation**. `invoice.get` reads one invoice.
`invoice.issue` turns a draft into an issued invoice. And every operation has a
**contract**: a document that describes it. Does it read, or change something? Which
permission does it need? How risky is it? Can it be undone?

Two names for that first question, because the specification uses them. An operation that
only reads is a **query**. One that changes something is a **command**. `invoice.get` is a
query; `invoice.issue` is a command. And each operation needs a **handler**: the code that
actually carries it out.

Both contracts ship in this step. Only `invoice.get` is carried out. Actually changing an
invoice is a second idea, and a step is allowed one. "A contract without a handler, on
purpose", below, says where the change goes and why.

The contracts are JSON files in `src/contracts/`, because a spec sheet is *data*, not
code. A **registry** loads them all when the program starts. If one is broken, the
program refuses to start.

That last sentence is the whole step. Not "the request fails" — the program does not
start.

## Why it matters

A contract is where a rule finds its target.

Every later step asks a question of an operation. Step 06 asks "does this caller hold
`invoice:issue`?" Step 20 asks "does this need an idempotency key?" Step 27 asks "is
this risky enough to need the CFO?" Every one of those reads the contract. A single
generic `update(record, fields)` has nowhere to put those answers, which is why §7 says:

> DSoR prefers domain operations to generic CRUD: `invoice.issue`, `payment.execute`,
> `period.close`, not `invoice.update(status="issued")`.

Why stop the program, rather than fail the one request that uses the broken contract?
Because nobody would notice the failed request.

A contract with no risk level is a contract no **control** can ever fire on — a control
being a rule DSoR checks before it acts, which answers allow, deny, or needs approval. If
that gap only showed up on the one payment a month large enough to need the CFO, it would
look fine for the other thirty days.

§7's Common mistake names the extreme version:

> Giving the agent a `run_sql` tool or a "call any API" tool "just for now". That one
> tool bypasses every protection in this document.

`pnpm start` ends by asking for `execute_sql`. There is no contract for it, so there is
no such operation, so it cannot be called. That is the shape the rule is after.

## The new tool

**ajv**, at exactly version `8.20.0`, is the first dependency this tutorial has added
since step 00. It checks a JSON document against a **JSON Schema** — itself a JSON
document describing what a valid document looks like.

It is a real **dependency**, not a `devDependency`: `src/registry.ts` imports it at run
time, so `pnpm start` needs it. Putting it under `devDependencies` would let `pnpm test`
pass while `pnpm start` failed for anyone who installed this folder on its own.

The version is exact, with no `^`, so an install six months from now fetches the same ajv
this step was tested against rather than a newer one that behaves differently. This
folder's `pnpm-workspace.yaml` also sets `minimumReleaseAge: 2880`, a 48-hour quarantine:
a version published minutes ago is refused, which buys the world two days to notice if a
bad release slips out.

## Checking against the real schema, not one of our own

`src/schemas/` holds two files copied **byte for byte** from `packages/spec/schemas/`:

```text
operation-contract.schema.json   363 lines
common.schema.json               228 lines
```

Neither is trimmed, and that is deliberate. `DSOR-OPR-01` says a contract "MUST validate
against `operation-contract.schema.json`" — it names that exact file. Checking against a
smaller schema of our own would be checking against something else. And a hand-trimmed
copy is worse than either — *normative* means a conforming system has to obey the file as
written, so cutting it down silently stops enforcing whatever you removed, with nothing to
tell you.

The step keeps its own copies because a step has to run outside this repository.

`operation-contract.schema.json` refers to `common.schema.json` **eleven times**, to
seven of its definitions — `operationId`, `permission`, `risk`, `semantics`, `freshness`,
`cel` and `extensions`. That is why both are registered:

```ts
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(read("./schemas/common.schema.json"));
ajv.addSchema(read("./schemas/operation-contract.schema.json"));
```

Three details worth knowing.

`Ajv2020` comes from `ajv/dist/2020.js`. JSON Schema has versions, called drafts, and
plain `Ajv` reads draft-07 while these schemas are written to draft 2020-12.

`allErrors: true` makes ajv report every problem it finds in a contract, instead of
stopping at the first.

`strict: false` is not laziness. Strict mode makes ajv refuse a *schema* that contains
anything it does not recognise. Turn it on and thirteen of the specification's fourteen
schemas will not load at all: nine because an `if`/`then` block requires a property that
is not listed beside it, the rest over an unknown `format`, a union type, and a block with
no `type`. Those schemas are normative — a conforming system has to obey them — so they
are not ours to change. Turning strict mode off has a cost, and Break 4 shows you exactly
what it is.

## What changed since step 02

```text
my_03_operations_and_contracts/
  src/schemas/*.json       NEW  two schema files, copied byte for byte
  src/contracts/*.json     NEW  invoice.get and invoice.issue, as documents
  src/registry.ts          NEW  validateContract, loadRegistry, contractsFromDisk
  src/operations.ts        NEW  callOperation, assertPaired, and the invoice.get handler
  test/registry.test.ts    NEW  thirteen tests: what the registry refuses, and what it keeps
  test/operations.test.ts  NEW  sixteen tests: calling by name, and the refusals
  src/main.ts          CHANGED  calls through the registry, and no longer imports getInvoice
  src/invoice.ts       CHANGED  TENANT is exported for the tenant check; markers removed
  src/uri.ts           CHANGED  step 02's NEW IN STEP markers removed
  test/uri.test.ts     CHANGED  step 02's NEW IN STEP markers removed
  test/invoice.test.ts CHANGED  step 02's NEW IN STEP markers removed
  package.json         CHANGED  name, description, and ajv
```

```bash
cd docs/baby_steps_tutorials
diff -rq --exclude=node_modules --exclude=pnpm-lock.yaml \
  my_02_canonical_uris my_03_operations_and_contracts
```

## Run it

```bash
cd docs/baby_steps_tutorials/my_03_operations_and_contracts
pnpm install
pnpm start
```

```text
Hello, accounts-payable-fte.
operations: invoice.get, invoice.issue

invoice.get    dsor://org_456/invoice/INV-1008  31400.00 USD  issued
invoice.get    dsor://org_456/invoice/INV-1009  2500.00 USD  draft

refused  not built yet: invoice.issue has a contract, and no handler until step 04
refused  wrong company: dsor://org_999/invoice/INV-1008 is for org_999, and this program serves org_456
refused  wrong entity: invoice.get is named for invoice, and dsor://org_456/vendor/VENDOR-44 names vendor
refused  no contract: execute_sql is not an operation: this program has no contract for it
```

```bash
pnpm check                 # typecheck, then test. 53 tests pass
```

### A contract without a handler, on purpose

`invoice.issue` has a contract in `src/contracts/` and no code behind it. Ask for it and
you get told so:

```text
refused  not built yet: invoice.issue has a contract, and no handler until step 04
```

Two questions that deserve answers.

**Why ship the contract at all?** Because a command's contract is the interesting one. A
query needs ten fields. A command needs six more — `delegation`, `idempotency`,
`concurrency`, `execution`, `preconditions`, `controls` — and the schema only demands them
when `kind` is `command`. Without a command contract, that whole branch of the schema is
never exercised and `DSOR-OPR-02a` is a much thinner claim.

**Why not write the handler?** Because it is a different lesson. Changing stored state
brings its own problems: the store has to become writable, an invoice that is already
issued has to be refused, and that refusal needs a shape a caller can act on. That shape
is step 04's error envelope, which is exactly why the command waits for it — "this
invoice is already issued" needs a code, and a query's refusals are too thin to show why
envelopes matter.

The waiting is recorded in code, not left as a silent gap. `NOT_YET_IMPLEMENTED` lists the
ids, and `assertPaired` checks the list both ways: an id on it must still have a contract,
and must *not* already have a handler. So the note cannot outlive its reason.

### The address names a company, so the company is honoured

`invoice.get` takes an address, and an address has three parts. Step 02 built the parser;
this step is the first to *use* what it parsed:

```ts
const { tenant, entity, id } = parseUri(given);
```

All three are checked. The entity must match what the operation is named for —
`invoice.get` is for an `invoice`, so `dsor://org_456/vendor/VENDOR-44` is refused. And
the tenant must be the one company this program serves.

That second check is worth dwelling on, because leaving it out is worse than never
parsing the tenant at all. Without it:

```text
callOperation("invoice.get", { invoice: "dsor://org_999/invoice/INV-1009" })
  → reads org_456's INV-1009
```

The caller asked about one company and quietly got another's records. Reading a part of
the address and then ignoring it is how one tenant reaches into another's data. The
specification's threat table calls that cross-tenant disclosure or action, threat T4, and
real multi-tenancy is specified in §14 and arrives in step 10. This step is not that. It
is the smaller promise that a part of the address we read is a part we honour.

### The part that cannot be checked by looking

Step 01 found that `money()` accepts `ZZZ`. Step 02 found that the schema's tenant
pattern accepts `acme`. Step 03's version of the same discovery is bigger:

The contract `invoice.issue` declares `predicates: ["state.invoice.status == \"draft\""]`.
Nothing reads it.

That line is written in **CEL** — Common Expression Language, a small language for
writing a condition that a program can check safely. It cannot loop forever, it cannot
reach the network, and DSoR uses it for every rule in §17. **Nothing in this tutorial
parses CEL until step 27.**

So an empty `predicates: []` validates. So does `predicates: ["not CEL at all !!!"]`,
because the schema's `cel` definition is only "a string with at least one character".

The same is true of `input.schema: "InvoiceIssueRequest"`. No such schema exists anywhere
in this repository, and nothing checks an operation's arguments against it until step 07,
where "is the input valid" becomes a line of the pipeline's checklist.

So the schema proves a contract **has the fields**. It never proves the fields **say
anything true**. That is the third time this tutorial has met the same lesson, and it is
the reason every "the rules this step meets" section here comes with limits attached.

## Break it

Four breaks. Change the code back after each.

**1. Delete `risk` from `src/contracts/invoice.issue.json`.** This is the break the step
exists for. Run `pnpm start`:

```text
TypeError: src/contracts/invoice.issue.json is not a valid operation contract: (root) must have required property 'risk'
```

The program printed nothing at all — not the greeting, not the operation list. Now run
`pnpm test`:

```text
 Test Files  2 failed | 4 passed (6)
      Tests  4 failed | 33 passed (37)
```

Read the totals. **37 collected, not 53.** Sixteen tests did not fail — they never ran,
because `operations.test.ts` imports a module that throws while it is loading. That is
what "refused at start-up" looks like from the outside.

**2. Remove the `common.schema.json` line from `src/registry.ts`,** keeping the other
`addSchema`. Run `pnpm start`:

```text
MissingRefError: can't resolve reference urn:dsor:schema:1.3:common#/$defs/operationId from id urn:dsor:schema:1.3:operation-contract
```

The contract schema cannot stand alone. Notice ajv did not complain at `addSchema` —
ajv follows a reference only when the schema is first used to check a document, not when
it is added, so the failure lands later than the mistake.

**3. Add `"description": "Issues an invoice"` to `invoice.issue.json`.** A helpful thing
to want. Run `pnpm start`:

```text
TypeError: src/contracts/invoice.issue.json is not a valid operation contract: (root) must NOT have additional properties
```

The schema closes its top level, so a field it does not know about is refused. The way in
is `extensions`, keyed by a **reverse-DNS namespace** — your domain name backwards, so
`example.com` becomes `com.example`, which keeps two companies' extra fields from
colliding:

```json
"extensions": { "com.example.notes": { "description": "Issues an invoice" } }
```

That is rule `DSOR-SCH-02`, and `test/registry.test.ts` tests both halves: the bare field
refused, the namespaced one accepted.

Note the refusal never says *which* field is extra. ajv reports each problem as an object;
the offending field name sits in that object's `params`, and this step prints only its
`message`.

**4. Misspell one of the schema's own keywords — the field names JSON Schema itself
recognises, such as `required` or `properties` — and see what `strict: false` costs.**
In `src/schemas/operation-contract.schema.json`, rename the top-level `"required"` to
`"requird"`. Then delete `risk` from `invoice.issue.json` as in Break 1. Run
`pnpm start`:

```text
Hello, accounts-payable-fte.
operations: invoice.get, invoice.issue

invoice.get    dsor://org_456/invoice/INV-1008  31400.00 USD  issued
invoice.get    dsor://org_456/invoice/INV-1009  2500.00 USD  draft

refused  not built yet: invoice.issue has a contract, and no handler until step 04
refused  wrong company: dsor://org_999/invoice/INV-1008 is for org_999, and this program serves org_456
refused  wrong entity: invoice.get is named for invoice, and dsor://org_456/vendor/VENDOR-44 names vendor
refused  no contract: execute_sql is not an operation: this program has no contract for it
```

It ran. Happily. Every line exactly as before, with a contract that has **no risk level
at all**. Now `pnpm test`:

```text
 Test Files  1 failed | 5 passed (6)
      Tests  4 failed | 49 passed (53)
```

All 53 collected this time, because nothing threw while loading. Only the four tests
that expect a refusal failed.

Compare that with Break 1. Same broken contract; the difference is one letter in the
schema. Under `strict: false`, ajv ignores a keyword it does not recognise — so the rule
you thought you wrote is absent, and nothing warns you. Under `strict: true` the
same typo raises `strict mode: unknown keyword: "requird"`, but then thirteen of the
specification's own schemas will not compile.

There is no free option here. `strict: false` is the right choice for these schemas, and
the cost is that nobody checks your spelling: a keyword ajv does not recognise is ignored
rather than refused. The tests are what catch it instead.

## Build it yourself with Claude Code

This folder is a learner copy — the `my_` prefix. The official
`03_operations_and_contracts` is still listed as planned in the [map](../readme.md), so
there is nothing to compare against yet.

```bash
cd docs/baby_steps_tutorials
cp -r my_02_canonical_uris my_03_operations_and_contracts
cd my_03_operations_and_contracts
rm -rf node_modules && pnpm install
claude
```

Then paste one line:

```text
Use the build-baby-step skill in learner mode. We are building step 03,
operations_and_contracts.
```

Ask for a plan before any code, and ask to see the new tests fail before they pass. The
general directions are in the
[tutorial overview](../readme.md#build-the-steps-with-claude-code).

## Check yourself

1. Why must a broken contract stop the program, instead of failing the one request that
   uses it?
2. `invoice.issue` declares `predicates: ["state.invoice.status == \"draft\""]`. What
   reads that line today?
3. `invoice.issue` has a contract and no handler. Why ship a contract for something the
   step does not do?
4. Why are the two schema files copied unchanged, instead of a smaller schema written
   for this step?
5. `strict: false` let a misspelled `required` through. Why not use `strict: true`?
6. `NOT_YET_IMPLEMENTED` lists `invoice.issue`. What stops that list going stale?
7. `invoice.get` reads the tenant out of the address and then refuses anything that is
   not `org_456`. Why is that better than not reading the tenant at all?

<details>
<summary>Answers</summary>

1. Because nobody would notice. A contract with no risk level is a contract no control
   can fire on, and if that only broke on the rare request that needed approval, it
   would look fine the rest of the time. Refusing at start-up turns a quiet gap into a
   loud one.
2. Nothing. It is a *declaration* — data sitting in the contract. Nothing in this
   tutorial parses CEL until step 27, so an empty `predicates: []` would validate equally
   well, and so would a line of nonsense. That is the step's central limit: the schema
   proves a contract has the fields, never that they say anything true.
3. Because a command's contract is the interesting one. A query needs ten fields; a
   command needs six more, and the schema only demands them when `kind` is `command`. Drop
   the command contract and that whole branch of the schema is never tested. Carrying out
   the change is a separate lesson, and it needs step 04's error envelope to refuse
   properly.
4. Because `DSOR-OPR-01` names `operation-contract.schema.json` specifically. Checking
   against a schema of our own would be checking against something else. And trimming a
   normative schema silently drops whatever you removed, with nothing to tell you —
   which is the same class of mistake as claiming `money()` checks ISO 4217.
5. Because under `strict: true` thirteen of the specification's fourteen schemas refuse
   to compile, since their if/then blocks declare `required` without repeating `type`.
   The trade is real and unavoidable here; Break 4 shows the cost and the tests are what
   cover for it.
6. `assertPaired` checks it both ways. An id on the list must still have a contract, so
   the note cannot refer to nothing; and it must *not* already have a handler, so nobody
   can implement the operation and forget to cross it off. A test hands `assertPaired` a
   handler for `invoice.issue` and expects it to complain.
7. Because the alternative is not "no check", it is a silent wrong answer. Parse the
   address, ignore the tenant, and a caller asking about `org_999`'s invoice gets
   `org_456`'s changed instead — with nothing to say so. A part of an address you read is
   a part you have to honour, or not read at all.

</details>

## The rules this step meets

- **[DSOR-OPR-01 · L1]** Every operation MUST have a contract that validates against
  `operation-contract.schema.json`.
  ([§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract))
- **[DSOR-OPR-02a · L1]** The operation registry MUST reject a contract that omits a
  mandatory field.
  ([§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract))
- **[DSOR-OPR-02b · L1]** The registry MUST NOT infer a default for risk level,
  execution semantics, effect, or idempotency.
  ([§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract))

`DSOR-OPR-02a` is met squarely: the schema is the specification's own, and the registry
refuses while it is loading.

**`DSOR-OPR-01` is met for everything that goes through the registry, which is not the
same as everything.** `callOperation` cannot reach an operation with no contract.
`assertPaired` runs at module load, beside the registry. It refuses any handler with no
contract, and any contract with no handler unless the id is on the waiting list — today
that is `invoice.issue`, and nothing else. Two tests hand it a mismatched pair directly,
rather than checking the list of ids the registry loaded: that list is built from the
contract files, so it would look right whether the check existed or not.

What is *not* covered: nothing stops a future file writing `import { getInvoice }` and
going round the side. There is no door to close until step 42 puts an HTTP server in front
of the pipeline, and no agent-facing door until step 46.

**`DSOR-OPR-02b` cannot be proved by a schema at all.** A `required` list shows a field
was missing from the document; it can never show the registry did not quietly supply the
value itself. So the tests do it behaviourally, and they go after the *values*, not just
the objects holding them: `risk.level` is deleted as well as `risk`, because a registry
that filled in the level while leaving `risk` in place would break the rule and sail past
a test that only deleted the parent. A second test asserts the whole loaded contract
equals the file, so any key added at any depth turns red.

ajv can be told to rewrite the document it is checking, and all three such options are
off. `coerceTypes` would turn a `version` of `"1"` into `1` instead of refusing it, and
there is a test for exactly that. `useDefaults` would fill in any `default` the schema
declared; no DSoR schema declares one today, so it has nothing to act on — which is why
the whole-document comparison, rather than a test of the flag, is what guards it.
`removeAdditional` would quietly strip a field the schema does not know instead of
refusing the contract, which would turn Break 3 from a refusal into a silent edit.

Rules in §7 this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-OPR-03a` | Forbids a generic execution tool on an *agent interface*. There is no agent interface until step 46, when each operation becomes an MCP tool. `execute_sql` being unreachable here is the right shape, not the rule. |
| `DSOR-OPR-04a`, `04b` | Say every interface invokes the same pipeline and none does its own authorization. There is no pipeline until step 07 and no interface until 42. |
| `DSOR-OPR-05`, `06` | The three invocation modes, `execute` / `propose_only` / `validate_only`. Step 23. |
| `DSOR-QRY-01` | A server-side page limit on every query. There is no query returning a list until step 13. |

`invoice.issue` is declared and not carried out, so nothing about a state change is
claimed here at all. Its handler, and the error envelope its refusals need, are step 04.

Most fields in these contracts are declared and not yet read. Each arrives in a later
step:

| Field | Read from |
| --- | --- |
| `authorization.permission` | step 06 |
| `tenancy` | steps 10, 11 — the one-company check in `invoice.get` is hard-coded, not read from here |
| `delegation` | steps 18, 19 |
| `idempotency` | step 20 |
| `concurrency` | step 21 |
| `execution.semantics` | step 17 |
| `preconditions` | steps 15, 27, 32 |
| `controls`, `risk.level` | steps 27, 28 |
| `audit.level` | steps 08, 33 |
| `input.schema`, `output.schema` | step 07 |

Where a field can say nothing, it does: `delegation` and `idempotency` are `false`,
`concurrency` is `none`, `controls` is empty. The rest cannot — `tenancy` has to say
`true` or `false`, and `execution.semantics` has to name one of five values — so they
carry the value the operation will have once the step that reads them arrives.

**Next:** step 04, result and error envelopes — the thrown `TypeError`s above become
structured errors with a code and a retry class, and "this needs approval" becomes a
result rather than a failure.
