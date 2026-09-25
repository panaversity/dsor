# Step 02 · Canonical URIs

**New in this step:** a record's permanent address, `dsor://org_456/invoice/INV-1008`,
and a tenant part that must be an id, never a company's name (DSOR-RID-01a,
DSOR-RID-01b).

## In plain words

In step 01, `INV-1008` was an id in one list inside one program. That is not enough.
An approval, the audit log, and later a payment must all name the same invoice. And
DSoR serves more than one company. So every record needs one permanent address, called
its **canonical URI**. "Canonical" means "the one official form". A **URI** is a name
for something, written as text in a fixed format. A web link is one kind of URI. A
DSoR URI opens nothing. It only names one record.

```text
dsor://org_456/invoice/INV-1008
       ───┬─── ───┬─── ───┬────
       tenant  entity    id
```

- `dsor://` is the **scheme**. It says "this is a DSoR URI".
- The **tenant** is the company the record belongs to. DSoR calls each customer
  company a tenant. Here it is `org_456`.
- The **entity** is the kind of record: `invoice`, `vendor`, `payment`.
- The **id** says which record: `INV-1008`.

This step writes two functions. `formatUri` builds a URI from its three parts.
`parseUri` does the reverse: it takes text, splits it into the three parts, or refuses
it. In later steps, text from outside the program will arrive as a URI and go through
`parseUri`. So it must refuse a wrong scheme, a missing part, an extra part, and an
empty part.

It must also refuse a company's *name* as the tenant. The company `org_456` has the
display name `acme`, which people see on screen. The name is for people. A name must
never go into a URI, and neither may a **slug** (a name rewritten for use in a web
link, like `acme-corp`) or an **alias** (a second name). The tenant part must be an
**opaque identifier**: an id that code never reads meaning out of, and that never
changes.

**The spec says what, not how.** The specification gives two rules: the URI has this
shape (DSOR-RID-01a), and no name appears in it (DSOR-RID-01b). It never says which
functions to write. `formatUri` and `parseUri` are this tutorial's own names, and
another team could meet the same rules with different code. One thing is copied from
the specification's files: the pattern a URI must match.

## Why it matters

**A name changes.** Suppose URIs used the name. In March, `cfo_100` approves payment
`PAY-901` for `dsor://acme/invoice/INV-1008`, and 31,400.00 USD is paid. The audit log
records both under that URI. In June, Acme changes its name, and new records use the
new name. In July, an auditor looks up INV-1008 under the new name and finds no
approval and no payment. The records still exist, but they are filed under a name the
company no longer uses. Nobody can prove that the invoice the CFO approved is the
invoice that was paid.

**A name comes back.** A year later, a new customer signs up and calls itself `acme`.
Now `dsor://acme/invoice/INV-1008` could be the old company's invoice or the new
one's. An approval for one could be read as an approval for the other. DSOR-RID-01b
says the tenant id is **immutable**: it must never change. And DSOR-RID-02b says an id
is never given to a different object. With `org_456` in the URI, neither story can
happen.

**Common mistake:** using the company's name as the tenant, as in
`dsor://acme/invoice/INV-1008`. It is short and easy to read, and it breaks the day
the name changes. Put the id `org_456` in the URI. Keep the name somewhere else, for
people to read.

## What changed since step 01

```text
src/uri.ts            NEW: the ResourceParts type, parseUri(), and formatUri()
test/uri.test.ts      NEW: 20 tests for DSOR-RID-01a, 21 for DSOR-RID-01b
src/main.ts           changed: also prints INV-1008's canonical URI and reads it back
src/invoice.ts        changed: invoiceUri() gives every invoice its canonical URI;
                      step 01's NEW IN STEP marker is now a plain comment
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

- **The URI pattern is the schema's own, unchanged.** A **pattern** here is a
  **regular expression**: a short rule that says which texts match. The schema is the
  specification written for machines, in `common.schema.json`. Inside the dsor
  repository, `pnpm guard` checks that the copy in `src/uri.ts` still matches its
  `resourceUri`. `parseUri` matches the whole text against the pattern first, and only
  then splits on `/`. Splitting first would accept `dsor://org_456//INV-1008`: three
  pieces, one of them empty.
- **The tenant has a stricter pattern of our own: `org_` and digits.** The schema's
  pattern accepts `acme`, because a name and an id are both letters. No pattern can
  know what a text *means*. So this step decides that every tenant id has one fixed
  form, and whatever creates tenants in a later step must follow it. The names people
  use, like `acme`, do not have that form. Everything we accept, the schema accepts
  too. We refuse more, never less, as step 01 did with currencies.
- **`formatUri` reads what it built back through `parseUri`.** So `formatUri` can
  never build a URI that `parseUri` refuses. An id `INV/1008` would add a fourth part.
  A tenant `acme` would pass the shape. Both are refused in one place.

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

`pnpm check` runs the type check, then 69 tests:

```text
 Test Files  3 passed (3)
      Tests  69 passed (69)
```

## Break it

Do both. Before each one, predict which command catches it: `pnpm typecheck` or
`pnpm test`.

**1. Delete the name check.** In `src/uri.ts`, delete the three lines in `parseUri`
that start with `if (!TENANT_ID.test(tenant_id))`. Run `pnpm check`:

```text
$ pnpm typecheck && pnpm test
$ tsc --noEmit
src/uri.ts(23,7): error TS6133: 'TENANT_ID' is declared but its value is never read.
[ELIFECYCLE] Command failed with exit code 1.
```

The compiler notices first: the pattern is still there, but nothing uses it. Run
`pnpm test` on its own, and 17 tests fail: every test that expects a name to be
refused. Put the lines back.

**2. Make the well-meaning mistake.** The schema already has a pattern for a tenant
id, `^[A-Za-z0-9_\-]+$`. Using it looks tidy. In `src/uri.ts`, change the line
`const TENANT_ID = /^org_[0-9]+$/;` to
`const TENANT_ID = /^[A-Za-z0-9_\-]+$/;` and run `pnpm check` (output shortened):

```text
$ tsc --noEmit
 ❯ test/uri.test.ts (41 tests | 17 failed) 15ms
AssertionError: expected function to throw an error, but it didn't
 ❯ test/uri.test.ts:123:65
 Test Files  1 failed | 2 passed (3)
      Tests  17 failed | 52 passed (69)
```

This time the compiler prints nothing. The code is correct TypeScript, and the
pattern is still used. It only accepts the wrong texts: `acme`, `org_acme`,
`ORG_456`. The compiler checks types, not meaning. Only the tests notice. Put the line
back, and run `pnpm check` until it is green.

## Build it yourself with Claude Code

This is how the step was built. Each row is one commit, and every commit passes
`pnpm check`:

| # | Move | What you do |
|---|---|---|
| 1 | Copy | Copy your step 01. Change the name in `package.json` |
| 2 | Teach first | Write "In plain words" and "Why it matters" before any code |
| 3 | Rule DSOR-RID-01a | Write the tests first, the refusals with them. Watch them fail. Write code until they pass |
| 4 | Rule DSOR-RID-01b | The same loop, for the second rule |
| 5 | Break it | Break the code on purpose, copy the real output here, finish this README |
| 6 | Review | A reviewer who has not seen your conversation attacks the step. Fix what it finds |

The refusals are not a last step. They are written in moves 3 and 4, before the code.

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
with me on the way: org_456 and acme are both texts the schema's URI pattern
accepts, so how can the code tell an id from a name? And should parseUri check that
the tenant exists, or only its form?
```

When `pnpm check` is green in your folder, and once the official step 02 exists:

```text
Now compare this folder with ../02_canonical_uris. Explain every difference, and tell
me which ones matter and why.
```

## Check yourself

1. Why is the tenant part `org_456` and not `acme`? Tell what goes wrong, with a date.
2. `org_456` and `acme` are both texts the schema's pattern accepts. How does this
   step tell them apart? What can it still not tell apart?
3. Which of these does `parseUri` accept, and why?
   (a) `dsor://org_456/invoice/INV-1008`
   (b) `dsor://org_456//INV-1008`
   (c) `dsor://org_456/Invoice/INV-1008`
   (d) `dsor://acme/invoice/INV-1008`
   (e) `dsor://org_999/invoice/INV-1008`
4. Does the specification ask for `formatUri` and `parseUri`? What in this step does
   come from the specification's files?
5. Before the real code existed, a **stub** (a stand-in function that does nothing
   yet) always threw an error. It passed 12 of the 16 tests that existed then. Which
   tests failed, and what does that teach?

<details>
<summary>Answers</summary>

1. A name changes. In March, `cfo_100` approves paying INV-1008 under
   `dsor://acme/invoice/INV-1008`. In June, Acme changes its name. In July, an auditor
   looks up the invoice under the new name and finds no approval and no payment. With
   `org_456`, the URI never changes, so the trail holds.
2. Every tenant id has one fixed form, `org_` and digits, and `acme` does not have it.
   The step cannot tell a name that was *made* to look like an id, such as a company
   called `org_457`. The pattern checks the form of a text, not where it came from.
3. (a) and (e). (b) has an empty entity. (c) has an entity that starts with a capital
   letter, which the schema's pattern refuses. (d) has a name as the tenant. (e) is
   accepted because its form is right. Whether company `org_999` exists is a
   different question, for step 10.
4. No. The specification says what must be true, not which functions to write. The
   URI pattern in `src/uri.ts` is copied from the schema. The tenant's `org_` pattern
   is this tutorial's own decision.
5. The tests that expect a "yes" failed: build a URI, read one back, build it again
   from what was read, and the test that checks the refusal's message. A function that
   refuses everything passes every "no" test. Only the "yes" tests can tell a careful
   function from a broken one. Test both.

</details>

## Think it through

A green `pnpm check` means the tests you wrote pass. It does not mean you wrote the
right tests. So when this step was green, a reviewer who had not seen the conversation
attacked it. Its method: break the code on purpose, one small change at a time, and
see whether any test notices.

**Found while building, and fixed:**

1. **The "no" tests passed with no code.** The stub passed all 12 refusal tests for
   DSOR-RID-01a. So every rule here has "yes" tests too.
2. **An empty part.** Splitting `dsor://org_456//INV-1008` on `/` gives three pieces,
   and one is `""`. `parseUri` now matches the whole text against the pattern before
   it splits.
3. **`formatUri` and `parseUri` could disagree.** `formatUri` could build
   `dsor://org_456/invoice/INV/1008`, which has four parts. Now `formatUri` reads its
   own result back through `parseUri`.
4. **The compiler cannot read a pattern.** After the pattern matched, TypeScript still
   thought each part might be missing. The code checks for that, instead of overruling
   the compiler with `!`.
5. **A refusal test could prove the wrong rule.** If a refused tenant also had the
   wrong shape, its test would pass because of DSOR-RID-01a, not DSOR-RID-01b. One test
   checks that every refused tenant has the shape the schema accepts.

**Found by the review, and fixed.** Each sabotage below left all tests green. Each now
has a test that fails:

1. **Remove the `^` from the tenant pattern.** `acme_org_456`, a name in front of an
   id, was accepted. It is now in the list of refused tenants.
2. **Remove the `^` from the URI pattern.** In
   `dsor://org_456/invoice/x/dsor://org_456/invoice/INV-1008`, the valid URI at the end
   matched, and `x` was read as the id. Only `pnpm guard` noticed, and a copy outside
   the repository has no guard. The text is now a refusal test.
3. **Remove the type check from `parseUri`.** The test sent the number `1008`, which
   never matches the pattern, so the test passed anyway. It now sends a `String`
   object holding a valid URI. That one does match, so only the type check refuses it.
4. **Remove the type check from `formatUri`.** No test covered it. Now one sends the
   number `1008` as the id.
5. **This README said more than the code does.** It said a name "never appears" in a
   URI. That is true only for the tenant part. It said we never let through what the
   *specification* forbids, where only the *schema* is checked. It counted 15 failing
   tests as "every test" for DSOR-RID-01b. And four sentences described things no code
   does yet, such as "DSoR makes every tenant id itself", as if they were true today.
   All are corrected above.
6. **Terms used before they were defined:** slug, alias, stub, regular expression, and
   the "round trip" in a test title. Each is now defined, or replaced with plain words.
   "Like a web link" was dropped: a web link opens something, and a DSoR URI opens
   nothing.

**Found by a second review, and fixed:**

1. **The test proved the tool, not the rule.** DSOR-RID-01a says every resource *has*
   a canonical URI. The test built each invoice's URI itself, with `org_456` written
   in the test. So it proved that `formatUri` works, and nothing more. Delete every
   trace of URIs from the invoice code, and that test stayed green. Now
   `invoiceUri()` in `src/invoice.ts` gives every invoice its URI, and the test reads
   it from there.
2. **One invoice cannot catch a copy.** The list holds only INV-1008. An `invoiceUri`
   that always returned INV-1008's URI passed every test. A second test now asks for
   the URI of INV-1009, an invoice that is not in the list.

**Removed from step 01:** nothing. Its `NEW IN STEP 01` markers are now plain comments,
so a search for "NEW IN STEP" finds only this step's lesson.

**Open questions.** Each needs a new idea, so it waits:

- **How would code tell a vendor's id from its name?** DSOR-RID-01b forbids a name
  anywhere in the URI, but only the tenant part is checked.
  `dsor://org_456/vendor/acme-supplies` and `dsor://org_456/tenant/acme` are both
  accepted. It needs a fixed form for every kind of id, or a list of known ids.
  Nobody answers this yet.
- **What if a name looks like an id?** A company could be given the display name
  `org_457`. The pattern checks the form of a text, not where it came from. A later
  step that stores names must refuse names of that form.
- **Who makes sure a new tenant gets an `org_` id?** Whatever creates tenants. No step
  creates tenants yet.
- **Should that id come from a database counter?** `org_` and digits invites it. But
  §5's Common mistake warns against one system's internal row id. Counter ids also
  show how many companies exist. Steps 09 and 10 must decide.
- **What stops a tenant id from changing?** DSOR-RID-01b says it is immutable. Nothing
  here enforces it, because nothing here stores tenants. It belongs with DSOR-RID-02b,
  "an id is never given to a different object".
- **Where does an invoice's tenant come from?** Today it is one constant,
  `TENANT = "org_456"`, because this step knows one company. From step 10, every record
  carries its own `tenant_id` (DSOR-TEN-01a).
- **Does `org_999` exist?** Its form is right, so it is accepted. Step 10 answers
  whether the company exists.
- **Are `org_0456` and `org_456` the same company?** Here, no. Nothing reads the
  digits as a number. Something that does would mix the two up.
- **Is `..` a safe id?** The schema's id pattern allows dots, so `..` is accepted. It
  means nothing yet, but it looks like "the folder above" to anything that treats a
  URI as a file path.
- **How long may a part be?** There is no limit. A tenant with 100,000 digits is
  accepted.
- **What does a caller outside the program see when a URI is refused?** Today, a
  plain `TypeError`. Step 04 turns it into an **error envelope**, the one fixed shape
  every error will have.
- **The other rules of §5.** The lookup from each id to each system's own id
  (DSOR-RID-02a), never reusing an id (DSOR-RID-02b), and the same URI everywhere
  (DSOR-RID-03).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-RID-01a | Every resource has a canonical URI of the form `dsor://{tenant_id}/{entity}/{id}` | [§5 Resource identity](../../../specs/dsor/01-model.md#5-resource-identity), and `resourceUri` in [`common.schema.json`](../../../packages/spec/schemas/common.schema.json) | 20 tests in `test/uri.test.ts` |
| DSOR-RID-01b | No display name, slug, or alias appears in a canonical URI; the tenant id is an immutable opaque id | [§5 Resource identity](../../../specs/dsor/01-model.md#5-resource-identity) | 21 tests in `test/uri.test.ts`: 20 for the tenant part, and 1 that checks every refused tenant has the schema's shape. Met for the tenant part only (see "Open questions") |

The URI pattern in `src/uri.ts` is copied from that schema. Inside the dsor
repository, `pnpm guard` checks every rule id and every link on this page. If the spec
renames the section or removes the rule, the guard fails.

**Next:** step 03, operations and contracts.
