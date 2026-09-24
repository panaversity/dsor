# Step 03 · Operations and contracts

**New in this step:** every action a caller can take has a name and a spec sheet, and a
bad spec sheet stops the program before it answers anything.

## In plain words

Until now, code called `getInvoice("INV-1008")` directly. This step stops that.

Every action becomes a named **operation**. `invoice.get` reads one invoice.
`invoice.issue` turns a draft into an issued invoice. And every operation has a
**contract**: a document that describes it. Does it read, or change something? Which
permission does it need? How risky is it? Can it be undone?

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

And the reason a broken contract must stop the program, rather than fail a request, is
that nobody would notice. A contract with no risk level is a contract no control can
ever fire on. If that only broke on the one request per month that needed approval, it
would sit there for the other thirty days looking fine.

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

The version is exact, with no `^`. This folder's `pnpm-workspace.yaml` also sets
`minimumReleaseAge: 2880`, a 48-hour quarantine, so a freshly published version would be
refused at install anyway.

## Checking against the real schema, not one of our own

`src/schemas/` holds two files copied **byte for byte** from `packages/spec/schemas/`:

```text
operation-contract.schema.json   363 lines
common.schema.json               228 lines
```

Neither is trimmed, and that is deliberate. `DSOR-OPR-01` says a contract "MUST validate
against `operation-contract.schema.json`" — it names that exact file. Checking against a
smaller schema of our own would be checking against something else, and a hand-trimmed
copy of a normative schema is worse than either: it silently stops enforcing whatever
you removed, and nothing tells you.

The step keeps its own copies because a step has to run outside this repository.

`operation-contract.schema.json` refers to `common.schema.json` **eleven times**, to
seven of its definitions — `operationId`, `permission`, `risk`, `semantics`, `freshness`,
`cel` and `extensions`. That is why both are registered:

```ts
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(read("./schemas/common.schema.json"));
ajv.addSchema(read("./schemas/operation-contract.schema.json"));
```

Two details worth knowing. `Ajv2020` comes from `ajv/dist/2020.js`, because plain `Ajv`
is draft-07 and these schemas are draft 2020-12. And `strict: false` is not laziness —
under `strict: true`, thirteen of the specification's fourteen schemas refuse to compile
at all. Nine of them trip on `strictRequired`, because an `if`/`then` block names a
property in `required` that is not listed in the `properties` beside it; the rest trip on
an unknown `format`, a union type, and a `properties` block with no `type`. It has a
cost, and Break 4 shows you exactly what it is.

## What changed since step 02

```text
my_03_operations_and_contracts/
  src/schemas/*.json       NEW  two schema files, copied byte for byte
  src/contracts/*.json     NEW  invoice.get and invoice.issue, as documents
  src/registry.ts          NEW  validateContract, loadRegistry, contractsFromDisk
  src/operations.ts        NEW  callOperation, assertPaired, and the two handlers
  test/registry.test.ts    NEW  thirteen tests: what the registry refuses, and what it keeps
  test/operations.test.ts  NEW  thirteen tests: calling by name, and the refusals
  src/invoice.ts       CHANGED  issueInvoice, and the list is no longer frozen
  src/main.ts          CHANGED  calls through the registry; imports getInvoice no more
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

invoice.issue  dsor://org_456/invoice/INV-1009  2500.00 USD  issued

refused  already issued: INV-1008 is issued, and only a draft invoice can be issued
refused  wrong entity: invoice.get is named for invoice, and dsor://org_456/vendor/VENDOR-44 names vendor
refused  no contract: execute_sql is not an operation this program has a contract for
```

```bash
pnpm check                 # typecheck, then test. 50 tests pass
```

### The first thing that changes state, and what it cost

`invoice.issue` has to change the stored invoices, and that forced the only awkward
change in this step: **the invoices array is no longer frozen.** Step 01 froze it; step
03 gives that up, because a command must be able to change state.

Be clear about the price, because no test caught it. Step 01's tests check
`Object.isFrozen(invoice)` and `Object.isFrozen(invoice.amount)` — never the list. The
guarantee could be dropped without one red line.

What is kept: every `Invoice` is still frozen, so a caller holding one cannot edit it;
the array stays private to the module; and `issueInvoice` is the only way to change
anything. An invoice is *replaced*, not edited. A real store with a real transaction
arrives in step 09.

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
callOperation("invoice.issue", { invoice: "dsor://org_999/invoice/INV-1009" })
  → issues org_456's INV-1009
```

The caller asked about one company and quietly got another's records changed. Reading a
part of the address and then ignoring it is how one tenant reaches into another's data —
the specification calls that shape a *confused deputy*, and §14 is where real
multi-tenancy arrives in step 10. This step is not that. It is the smaller promise that a
part of the address we read is a part we honour.

### Why the second `invoice.issue` is refused

It is refused because INV-1009's status moved from `draft` to `issued`. That is a plain
`if` on the status.

It is **not** idempotency, which is step 20, and **not** in-flight exclusivity, which is
step 32. Those answer "you already asked me this" and "something else is already acting
on this". This one answers "that is not a draft any more". They look alike from outside
and they are different rules.

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

The same is true of `input.schema: "InvoiceIssueRequest"`. No such schema exists
anywhere in this repository, and nothing validates arguments against it until step 04.

So the schema proves a contract **has the fields**. It never proves the fields **say
anything true**. That is the third time this tutorial has met the same lesson, and it is
the reason every "the rules this step meets" section here comes with limits attached.

## Break it

Four breaks. Change the code back after each.

**1. Delete `risk` from `src/contracts/invoice.issue.json`.** This is the step's goal.
Run `pnpm start`:

```text
TypeError: src/contracts/invoice.issue.json is not a valid operation contract: (root) must have required property 'risk'
```

The program printed nothing at all — not the greeting, not the operation list. Now run
`pnpm test`:

```text
 Test Files  2 failed | 4 passed (6)
      Tests  4 failed | 32 passed (36)
```

Read the totals. **36 collected, not 50.** Fourteen tests did not fail — they never ran,
because `operations.test.ts` imports a module that throws while it is loading. That is
what "refused at start-up" looks like from the outside.

**2. Remove the `common.schema.json` line from `src/registry.ts`,** keeping the other
`addSchema`. Run `pnpm start`:

```text
MissingRefError: can't resolve reference urn:dsor:schema:1.3:common#/$defs/operationId from id urn:dsor:schema:1.3:operation-contract
```

The contract schema cannot stand alone. Notice ajv did not complain at `addSchema` —
references are resolved when the schema is *fetched*, so the failure lands later than the
mistake.

**3. Add `"description": "Issues an invoice"` to `invoice.issue.json`.** A helpful thing
to want. Run `pnpm start`:

```text
src/contracts/invoice.issue.json is not a valid operation contract: (root) must NOT have additional properties
```

The schema closes its top level, so a field it does not know about is refused. The way in
is `extensions`, keyed by a **reverse-DNS namespace** — your domain name backwards, so
`example.com` becomes `com.example`, which keeps two companies' extra fields from
colliding:

```json
"extensions": { "com.example.notes": { "description": "Issues an invoice" } }
```

That is rule `DSOR-SCH-02`, and `test/registry.test.ts` tests both halves: the bare field
refused, the namespaced one accepted. Note the message never says *which* field is extra
— ajv keeps the field name in a separate `params` object, not in the human-readable
`message`.

**4. Misspell a keyword in the copied schema, and see what `strict: false` costs.**
In `src/schemas/operation-contract.schema.json`, rename the top-level `"required"` to
`"requird"`. Then delete `risk` from `invoice.issue.json` as in Break 1. Run
`pnpm start`:

```text
Hello, accounts-payable-fte.
operations: invoice.get, invoice.issue

invoice.get    dsor://org_456/invoice/INV-1008  31400.00 USD  issued
invoice.get    dsor://org_456/invoice/INV-1009  2500.00 USD  draft

invoice.issue  dsor://org_456/invoice/INV-1009  2500.00 USD  issued

refused  already issued: INV-1008 is issued, and only a draft invoice can be issued
refused  wrong entity: invoice.get is named for invoice, and dsor://org_456/vendor/VENDOR-44 names vendor
refused  no contract: execute_sql is not an operation this program has a contract for
```

It ran. Happily. Every line exactly as before, with a contract that has **no risk level
at all**. Now `pnpm test`:

```text
 Test Files  1 failed | 5 passed (6)
      Tests  3 failed | 47 passed (50)
```

All 50 collected this time, because nothing threw while loading. Only the three tests
that expect a refusal failed.

Compare that with Break 1. Same broken contract; the difference is one letter in the
schema. Under `strict: false`, ajv ignores a keyword it does not recognise — so the rule
you thought you wrote is simply absent, and nothing warns you. Under `strict: true` the
same typo raises `strict mode: unknown keyword: "requird"`, but then thirteen of the
specification's own schemas will not compile.

There is no free option here. `strict: false` is the right choice for these schemas and
it costs you spelling. The tests are what stand in for it.

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
2. `invoice.issue` declares `predicates: ["state.invoice.status == \"draft\""]`, and
   there is also a plain `if` in `issueInvoice` checking the same thing. Why both?
3. The second `invoice.issue` on INV-1009 is refused. Is that idempotency?
4. Why are the two schema files copied unchanged, instead of a smaller schema written
   for this step?
5. `strict: false` let a misspelled `required` through. Why not use `strict: true`?
6. Step 01 froze the invoices list. Step 03 unfroze it. What is still guaranteed?
7. `invoice.get` reads the tenant out of the address and then refuses anything that is
   not `org_456`. Why is that better than not reading the tenant at all?

<details>
<summary>Answers</summary>

1. Because nobody would notice. A contract with no risk level is a contract no control
   can fire on, and if that only broke on the rare request that needed approval, it
   would look fine the rest of the time. Refusing at start-up turns a quiet gap into a
   loud one.
2. The `predicates` line is a *declaration* — data in the contract, which nothing reads
   until CEL arrives in step 27. The `if` is what actually refuses today. They agree by
   hand right now, and that is a gap, not a design: the README says so and step 27 is
   where the declaration starts doing the work.
3. No. It is refused because the status is no longer `draft`. Idempotency, in step 20,
   answers a different question — "you already asked me this, with this key" — and would
   return the first answer again rather than refuse.
4. Because `DSOR-OPR-01` names `operation-contract.schema.json` specifically. Checking
   against a schema of our own would be checking against something else. And trimming a
   normative schema silently drops whatever you removed, with nothing to tell you —
   which is the same class of mistake as claiming `money()` checks ISO 4217.
5. Because under `strict: true` thirteen of the specification's fourteen schemas refuse
   to compile, since their if/then blocks declare `required` without repeating `type`.
   The trade is real and unavoidable here; Break 4 shows the cost and the tests are what
   cover for it.
6. Every `Invoice` is still frozen, so a caller cannot edit one it is holding. The array
   is still private to the module, and `issueInvoice` is still the only way to change
   anything. What was given up is the list itself being immutable — and no test caught
   that, which is why it is written down here.
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
`assertPaired` runs at module load, beside the registry, and refuses a contract with no
handler or a handler with no contract — and two tests hand it mismatched pairs directly,
because asserting on `operationIds()` would pass whether the check existed or not.

What is *not* covered: nothing stops a future file writing `import { getInvoice }` and
going round the side. There is no door to close until step 42 gives this an interface.

**`DSOR-OPR-02b` cannot be proved by a schema at all.** A `required` list shows a field
was missing from the document; it can never show the registry did not quietly supply the
value itself. So the tests do it behaviourally, and they go after the *values*, not just
the objects holding them: `risk.level` is deleted as well as `risk`, because a registry
that filled in the level while leaving `risk` in place would break the rule and sail past
a test that only deleted the parent. A second test asserts the whole loaded contract
equals the file, so any key added at any depth turns red.

ajv can be told to rewrite the document it is checking, and both such options are off.
`coerceTypes` would turn a `version` of `"1"` into `1` instead of refusing it, and there
is a test for exactly that. `useDefaults` would fill in any `default` the schema
declared; no DSoR schema declares one today, so the option currently has nothing to act
on — which is why the whole-document comparison, rather than a test of the flag, is what
guards it.

Rules in §7 this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-OPR-03a` | Forbids a generic execution tool on an *agent interface*. There is no agent interface until step 42. `execute_sql` being unreachable is the right shape, not the rule. |
| `DSOR-OPR-04a`, `04b` | Say every interface invokes the same pipeline and none does its own authorization. There is no pipeline until step 07 and no interface until 42. |
| `DSOR-OPR-05`, `06` | The three invocation modes, `execute` / `propose_only` / `validate_only`. Step 23. |
| `DSOR-QRY-01` | A server-side page limit on every query. There is no query returning a list until step 13. |

And what the contracts *declare* but nothing yet enforces — `tenancy` (steps 10, 11),
`delegation` (18, 19), `idempotency` (20), `concurrency` (21), `execution.semantics`
(17), `preconditions` (15, 27, 32), `controls` (27, 28), `audit.level` (08, 33). Each is
declared honestly: anything unenforced says `false` rather than making a promise DSoR
cannot keep today.

**Next:** step 04, result and error envelopes — the thrown `TypeError`s above become
structured errors with a code and a retry class, and "this needs approval" becomes a
result rather than a failure.
