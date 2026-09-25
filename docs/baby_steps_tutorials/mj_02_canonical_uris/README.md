# Step 02 · Canonical URIs

**New in this step:** every record has one permanent address,
`dsor://org_456/invoice/INV-1008`, and a company's name never appears in it
(DSOR-RID-01a, DSOR-RID-01b).

## In plain words

In step 01, `INV-1008` was an id in one list inside one program. That is not enough.
An approval, the audit log, and later a payment must all name the same invoice. And
DSoR serves more than one company. So every record gets one permanent address, called
its **canonical URI**. "Canonical" means "the one official form". A **URI** is an
address written as text, like a web link.

```text
dsor://org_456/invoice/INV-1008
       ───┬───  ──┬───  ──┬────
       tenant   entity    id
```

- `dsor://` is the **scheme**. It says "this is a DSoR address".
- The **tenant** is the company the record belongs to. DSoR calls each customer
  company a tenant. Here it is `org_456`.
- The **entity** is the kind of record: `invoice`, `vendor`, `payment`.
- The **id** says which record: `INV-1008`.

This step writes two functions. `formatUri` builds an address from its three parts.
`parseUri` does the reverse: it takes text, splits it into the three parts, or refuses
it. Text from outside the program enters through `parseUri`, so it must refuse a wrong
scheme, a missing part, an extra part, and an empty part.

It must also refuse a company's *name*. The company `org_456` has the display name
`acme`, which people see on screen. The name is for people. It never goes into an
address. The tenant part holds only an **opaque identifier**: an id that means nothing
by itself and never changes.

## Why it matters

**A name changes.** Suppose addresses used the name. In March, `cfo_100` approves
payment `PAY-901` for `dsor://acme/invoice/INV-1008`, and 31,400.00 USD is paid. The
audit log records both under that address. In June, Acme renames itself to Globex. In
July, an auditor looks up `dsor://globex/invoice/INV-1008` and finds no approval and
no payment. The records still exist, but they are filed under a name that no longer
belongs to anyone. Nobody can prove that the invoice the CFO approved is the invoice
that was paid.

**A name comes back.** A year later, a new customer signs up and calls itself `acme`.
Now `dsor://acme/invoice/INV-1008` could be the old company's invoice or the new
one's. An approval for one could be read as an approval for the other. The id
`org_456` is never changed and never given to another company, so neither story can
happen.

**Common mistake:** using the company's name as the tenant, as in
`dsor://acme/invoice/INV-1008`. It is short and easy to read, and it breaks the day
the name changes. Put the id `org_456` in the address. Keep the name somewhere else,
for people to read.

## What changed since step 01

```text
src/uri.ts            NEW: the ResourceParts type, parseUri(), and formatUri()
test/uri.test.ts      NEW: 16 tests for DSOR-RID-01a, 19 for DSOR-RID-01b
src/main.ts           changed: also prints INV-1008's canonical URI and reads it back
src/invoice.ts        changed: step 01's NEW IN STEP marker is now a plain comment
src/money.ts          changed: the same
test/invoice.test.ts  changed: the same
test/money.test.ts    changed: the same
package.json          changed: the step's name and description
```

Every new region is marked `NEW IN STEP 02`. To see the whole diff, run this from
`docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_01_one_invoice_in_memory/src mj_02_canonical_uris/src
git diff --no-index mj_01_one_invoice_in_memory/test mj_02_canonical_uris/test
```

Three design choices are worth a look:

- **The URI pattern is the schema's own, unchanged.** `pnpm guard` checks that the copy
  in `src/uri.ts` still matches `resourceUri` in `common.schema.json`. `parseUri`
  matches the whole text against it first, and only then splits on `/`. Splitting
  first would accept `dsor://org_456//INV-1008`: three pieces, one of them empty.
- **The tenant has a stricter pattern of our own: `org_` and digits.** The schema's
  pattern accepts `acme`, because a name and an id are both letters. No pattern can
  know what a string *means*. But DSoR makes every tenant id itself, so it can give
  every id one fixed form, and a name never has that form. Everything we accept, the
  schema accepts too. We refuse more, never less, as step 01 did with currencies.
- **`formatUri` reads what it built back through `parseUri`.** So `formatUri` can
  never build an address that `parseUri` refuses. An id `INV/1008` would add a fourth
  part. A tenant `acme` would pass the shape. Both are refused in one place.

## Run it

```bash
cd docs/baby_steps_tutorials/mj_02_canonical_uris
pnpm install
pnpm start
```

```text
{
  id: 'INV-1008',
  vendor_id: 'VENDOR-44',
  amount: { value: '31400.00', currency: 'USD' },
  open_amount: { value: '31400.00', currency: 'USD' },
  status: 'issued'
}
dsor://org_456/invoice/INV-1008
{ tenant_id: 'org_456', entity: 'invoice', id: 'INV-1008' }
```

`pnpm check` runs the type check, then 63 tests:

```text
 Test Files  3 passed (3)
      Tests  63 passed (63)
```

## Break it

Do both. Before each one, predict which command catches it: `pnpm typecheck` or
`pnpm test`.

**1. Delete the name check.** In `src/uri.ts`, delete the three lines in `parseUri`
that start with `if (!TENANT_ID.test(tenant_id))`. Run `pnpm check`:

```text
$ pnpm typecheck && pnpm test
$ tsc --noEmit
src/uri.ts(22,7): error TS6133: 'TENANT_ID' is declared but its value is never read.
[ELIFECYCLE] Command failed with exit code 1.
```

The compiler notices first: the pattern is still there, but nothing uses it. Run
`pnpm test` on its own and 15 tests fail, every test for DSOR-RID-01b. Put the lines
back.

**2. Make the well-meaning mistake.** The schema already has a pattern for a tenant
id, `^[A-Za-z0-9_\-]+$`. Using it looks tidy. In `src/uri.ts`, change the line
`const TENANT_ID = /^org_[0-9]+$/;` to
`const TENANT_ID = /^[A-Za-z0-9_\-]+$/;` and run `pnpm check` (output shortened):

```text
$ tsc --noEmit
 ❯ test/uri.test.ts (35 tests | 15 failed) 13ms
AssertionError: expected function to throw an error, but it didn't
 ❯ test/uri.test.ts:81:65
 Test Files  1 failed | 2 passed (3)
      Tests  15 failed | 48 passed (63)
```

This time the compiler prints nothing. The code is correct TypeScript, and the
pattern is still used. It only accepts the wrong things: `acme`, `org_acme`,
`ORG_456`. The tests are the only thing between this change and an audit trail that
breaks the day Acme renames itself. Put the line back, and run `pnpm check` until it is
green.

## Build it yourself with Claude Code

Build your own step 02 from a copy of your step 01. From `docs/baby_steps_tutorials`:

```bash
cp -R my_01_one_invoice_in_memory my_02_canonical_uris
cd my_02_canonical_uris
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 02. Two questions to settle
with me on the way: org_456 and acme are both strings the schema's URI pattern
accepts, so how can the code tell an id from a name? And should parseUri check that
the tenant exists, or only its form?
```

When `pnpm check` is green in your folder:

```text
Now compare this folder with ../02_canonical_uris. Explain every difference, and tell
me which ones matter and why.
```

## Check yourself

1. Why is the tenant part `org_456` and not `acme`? Tell what goes wrong, with a date.
2. Which of these does `parseUri` accept, and why?
   (a) `dsor://org_456/invoice/INV-1008`
   (b) `dsor://org_456//INV-1008`
   (c) `dsor://org_456/Invoice/INV-1008`
   (d) `dsor://acme/invoice/INV-1008`
   (e) `dsor://org_999/invoice/INV-1008`
3. The schema accepts `dsor://acme/invoice/INV-1008`, and our code refuses it. Is that
   a problem?
4. Before the real code existed, a stub `parseUri` that always threw passed 12 of the
   16 tests for DSOR-RID-01a. Which tests failed, and what does that teach?
5. In "Break it" 2, the compiler printed nothing. Why could it not catch that mistake?

<details>
<summary>Answers</summary>

1. A name changes. In March, `cfo_100` approves paying INV-1008 under
   `dsor://acme/invoice/INV-1008`. In June, Acme renames itself to Globex. In July, an
   auditor looks up the invoice under the new name and finds no approval and no
   payment. With `org_456`, the address never changes, so the trail holds.
2. (a) and (e). (b) has an empty entity. (c) has an entity that starts with a capital
   letter, which the schema's pattern refuses. (d) has a name as the tenant. (e) is
   accepted because its form is right. Whether company `org_999` exists is a
   different question, for step 10.
3. No. Everything we accept, the schema also accepts, so we never let through
   something the specification forbids. We refuse a little more, and refusing is the
   safe direction.
4. The three "yes" tests (build, read back, round trip) and the test that checks the
   refusal's message. A function that refuses everything passes every "no" test. Only
   the "yes" tests can tell a careful function from a broken one. Test both.
5. The compiler checks types, not meaning. `/^[A-Za-z0-9_\-]+$/` and `/^org_[0-9]+$/`
   are both regular expressions, so both are correct TypeScript. Only a test that tries
   `acme` finds the difference.

</details>

## Think it through

**Found and fixed while building:**

1. **The "no" tests passed with no code.** A stub that always threw a `TypeError`
   passed all 12 refusal tests for DSOR-RID-01a. Only the "yes" tests and the message
   test failed. So every rule here has both.
2. **An empty part.** Splitting `dsor://org_456//INV-1008` on `/` gives three pieces,
   and one is `""`. `parseUri` now matches the whole text against the pattern before
   it splits.
3. **`formatUri` and `parseUri` could disagree.** `formatUri` could build
   `dsor://org_456/invoice/INV/1008`, which has four parts. Now `formatUri` reads its
   own result back through `parseUri`.
4. **The compiler cannot read a regex.** After the pattern matched, TypeScript still
   thought each part might be missing. We check for that, instead of telling the
   compiler "trust me" with `!`.
5. **A refusal test could prove the wrong rule.** If a refused tenant also had the
   wrong shape, its test would pass because of DSOR-RID-01a, not DSOR-RID-01b. One test
   checks that every refused tenant has the shape the schema accepts.

**Removed from step 01:** nothing. Its `NEW IN STEP 01` markers are now plain comments,
so a search for "NEW IN STEP" finds only this step's lesson.

**Left open, on purpose.** Each of these needs a new idea, so it waits:

- **Only the tenant part is checked for a name.** DSOR-RID-01b forbids a display name
  anywhere in the URI. `dsor://org_456/vendor/acme-supplies` is still accepted,
  because the id part has only the schema's shape. Telling a vendor's id from its name
  needs a fixed form for every kind of id, or a list of known ids.
- **Nothing makes sure ids have the form.** The rule "a tenant id is `org_` and
  digits" holds only while whatever creates tenants follows it. No step creates
  tenants yet.
- **`org_999` is accepted.** It has the right form. Whether that company exists is a
  different question. Step 10 answers it.
- **`org_0456` and `org_456` are two different ids.** Nothing here reads the digits as
  a number. Something that does would mix the two companies up.
- **The id `..` is accepted.** The schema's id pattern allows dots, so `..` is a valid
  id. It means nothing yet, but it looks like "the folder above" to anything that
  treats the URI as a file path.
- **There is no length limit.** A tenant with 100,000 digits is accepted.
- **The refusal is a plain `TypeError`.** When a caller outside the program can see
  it, it must become an error envelope (step 04).
- **The other rules of §5 wait:** the lookup from each id to each system's own id
  (DSOR-RID-02a), never reusing an id (DSOR-RID-02b), and the same URI everywhere
  (DSOR-RID-03).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-RID-01a | Every resource has a canonical URI of the form `dsor://{tenant_id}/{entity}/{id}` | [§5 Resource identity](../../../specs/dsor/01-model.md#5-resource-identity), and `resourceUri` in [`common.schema.json`](../../../packages/spec/schemas/common.schema.json) | 16 tests in `test/uri.test.ts` |
| DSOR-RID-01b | No display name, slug, or alias appears in a canonical URI; the tenant id is an opaque id | [§5 Resource identity](../../../specs/dsor/01-model.md#5-resource-identity) | 19 tests in `test/uri.test.ts`, for the tenant part only (see "Left open") |

The URI pattern in `src/uri.ts` is copied from that schema. Inside the dsor
repository, `pnpm guard` checks every rule id and every link on this page. If the spec
renames the section or removes the rule, the guard fails.

**Next:** step 03, operations and contracts.
