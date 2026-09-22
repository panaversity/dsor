# Step 02 · Canonical URIs

**New in this step:** every record gets one permanent address, and a pair of functions
that write it and read it.

## In plain words

An invoice needs a name the whole system can use. Not "the Acme invoice", and not a
number that means something only inside one database, but one address written the same
way everywhere:

```text
dsor://org_456/invoice/INV-1008
^^^^   ^^^^^^^ ^^^^^^^ ^^^^^^^^
scheme tenant  entity  id
```

Read it left to right. `dsor://` says this is a DSoR address, the way `https://` says a
web address. `org_456` says **which company**. `invoice` says **what kind of thing**.
`INV-1008` says **which one**.

Two words for this, because the specification uses them. A **URI** is a Uniform
Resource Identifier, which is a long way of saying an address. **Canonical** means
there is one correct way to write it and everybody writes it that way, so two people
naming the same invoice always produce the same text.

This step adds two functions. `parseUri` reads an address and hands back its three
parts. `formatUri` does the reverse. Both refuse an address that is not allowed, and
the refusing is the half that matters.

## Why it matters

The address is how one invoice is followed from end to end. The approval says
`dsor://org_456/invoice/INV-1008`. The payment says it. The audit log says it. That is
what lets you prove, later, that the invoice the CFO approved is the invoice that was
paid.

So the address must never change. Rule `DSOR-RID-01b` says the company part must be an
**id** and never a **name**, and here is the failure it prevents.

Suppose the address used the name: `dsor://acme/invoice/INV-1008`. Next year Acme is
bought and renamed. Every record written before the rename now points at a company
under a name that no longer exists, and the trail between the approval and the payment
is broken. An id like `org_456` means nothing to anybody, so nobody ever renames it,
so the address written in 2026 still reads the same in 2036.

The specification puts it in one line: *company names change, and database keys change
when data is re-imported.*

## The part that cannot be checked by looking

Look at these two pieces of text:

```text
acme
org_456
```

You know one is a name and one is an id. **The program does not.** Both are letters,
digits and punctuation. Nothing in the text itself says "I am a name".

So the shape check cannot do this job on its own. The specification's own JSON Schema,
in `packages/spec/schemas/common.schema.json`, describes an address as:

```text
^dsor://[A-Za-z0-9_-]+/[a-z][a-z0-9_]*/[A-Za-z0-9_.-]+$
```

and `acme` matches `[A-Za-z0-9_-]+` exactly as well as `org_456` does. The repository
knows this: its own test for `DSOR-RID-01a` breaks an address with a **space**, not
with a name, because a bare name passes.

That is why `src/uri.ts` has a second pattern:

```ts
const TENANT_ID = /^org_[0-9]+$/;
```

**This pattern is this deployment's own convention, not a rule from §5.** Section 5
says a tenant id is "an immutable opaque identifier" — *opaque* meaning the id carries
no meaning you can read, it is a label rather than a description, and *immutable*
meaning it never changes. Section 5 never says what shape such an id takes. We are choosing, here, that our company ids are `org_` followed by digits — and
that choice is what lets the program tell `acme` from `org_456`. A company that
numbers its tenants differently changes that one line.

This is the same lesson as `money()` in step 01. Checking the **shape** of something
and checking its **meaning** are different jobs, and the second one always needs
knowledge from outside the text.

## What changed since step 01

```text
my_02_canonical_uris/
  src/uri.ts            NEW  parseUri, formatUri, and the two patterns
  test/uri.test.ts      NEW  nine tests: the shape, the refusals, the round trip
  src/invoice.ts     CHANGED an Invoice now carries its own uri
  test/invoice.test.ts CHANGED two tests for an invoice's address
  src/main.ts        CHANGED prints the address
  src/money.ts       CHANGED step 01's NEW IN STEP markers removed
  test/money.test.ts CHANGED step 01's NEW IN STEP markers removed
  package.json       CHANGED name and description only
```

```bash
cd docs/baby_steps_tutorials
diff -rq --exclude=node_modules --exclude=pnpm-lock.yaml \
  my_01_one_invoice_in_memory my_02_canonical_uris
```

Search the folder for `NEW IN STEP 02` and you find this step's lesson and nothing
else. Step 01's markers are gone, which is why `money.ts` and `money.test.ts` show up
in the diff without having changed in any way that matters.

## Run it

```bash
cd docs/baby_steps_tutorials/my_02_canonical_uris
pnpm install
pnpm start
```

```text
Hello, accounts-payable-fte.
dsor://org_456/invoice/INV-1008
  31400.00 USD to VENDOR-44 (issued)
INV-9999: not found.
```

```bash
pnpm check                 # typecheck, then test. 24 tests pass
```

### Why the address is built from the id

`makeInvoice` in `src/invoice.ts` builds the address out of the id it was given,
instead of the id being typed a second time:

```ts
uri: formatUri({ tenant: TENANT, entity: "invoice", id }),
```

Writing `"INV-1008"` twice is how a record ends up carrying an address that belongs to
a different record. An address that points at the wrong invoice is worse than no
address, because every log line and every approval that quotes it is now confidently
wrong. Break 3 below shows exactly that going wrong.

### Why `formatUri` reads back what it writes, and compares

```ts
const uri = `dsor://${parts.tenant}/${parts.entity}/${parts.id}`;
const back = parseUri(uri);

if (back.tenant !== parts.tenant || back.entity !== parts.entity || back.id !== parts.id) {
  throw new TypeError(`address does not read back the same: ${JSON.stringify(uri)}`);
}
```

Without this, `formatUri` would be a back door: you could not get a bad address *past*
`parseUri`, but you could *create* one.

Parsing alone is not enough, and this is the subtle part. Building text with
`${...}` turns whatever it is given into text first. So if the id is missing, the
address becomes:

```text
dsor://org_456/invoice/undefined
```

which parses perfectly. It is canonical, it is permanent, and it points at nothing. The
types do not save you: `readonly id: string` is erased before Node runs the file, so a
`null` from a database row in step 09 arrives here and quietly becomes the word
`"null"`. Comparing the parts catches it, because `"undefined"` is not `undefined`.

## Break it

Four breaks, each one showing a different guard. Change the code back after each.

**1. Loosen `TENANT_ID` to the schema's own pattern.** In `src/uri.ts`, change it to
`/^[A-Za-z0-9_-]+$/` — the exact pattern the normative schema uses for the tenant part.
Run `pnpm test`:

```text
 FAIL  test/uri.test.ts > parseUri > DSOR-RID-01b: a company name in place of a tenant id is refused
AssertionError: expected function to throw an error, but it didn't
 FAIL  test/uri.test.ts > parseUri > DSOR-RID-01b: the refusal says which half was wrong
 FAIL  test/uri.test.ts > formatUri > DSOR-RID-01b: refuses to write an address it would not read
 Test Files  1 failed | 3 passed (4)
      Tests  3 failed | 21 passed (24)
```

This is the break to sit with. The pattern you just pasted in is not wrong — it is what
the specification's schema actually says. It is simply not enough on its own, and three
tests say so. `dsor://acme/invoice/INV-1008` is now accepted.

**2. Remove the `^` and `$`.** These mean "the whole text must be the address, and
nothing else". Without them a match anywhere inside a longer string counts:

```text
AssertionError: expected function to throw an error, but it didn't
 Test Files  1 failed | 3 passed (4)
      Tests  2 failed | 22 passed (24)
```

`dsor://org_456/invoice/INV-1008 and more` now parses cleanly.

**3. Type the id twice.** In `makeInvoice`, change `id` inside `formatUri` to the
literal `"INV-1008"`. Run `pnpm test`:

```text
AssertionError: expected 'dsor://org_456/invoice/INV-1008' to be 'dsor://org_456/invoice/INV-1009' // Object.is equality
 Test Files  1 failed | 3 passed (4)
      Tests  2 failed | 22 passed (24)
```

INV-1009 now claims INV-1008's address. Nothing crashed, nothing looked broken, and two
different invoices answer to the same name.

**4. Misspell a part.** Change `id` to `invoiceId: id` in that same call. Run
`pnpm typecheck`:

```text
src/invoice.ts(50,57): error TS2353: Object literal may only specify known properties, and 'invoiceId' does not exist in type 'ResourceUri'.
```

No test had to run. Change everything back and run `pnpm check` to see 24 tests pass.

## Build it yourself with Claude Code

This folder is a learner copy — the `my_` prefix is the convention for a copy you build
yourself. The official `02_canonical_uris` is still listed as planned in the
[map](../readme.md), so there is nothing to compare against yet.

```bash
cd docs/baby_steps_tutorials
cp -r my_01_one_invoice_in_memory my_02_canonical_uris
cd my_02_canonical_uris
rm -rf node_modules && pnpm install
claude
```

Then paste one line:

```text
Use the build-baby-step skill in learner mode. We are building step 02,
canonical_uris.
```

Ask for a plan before any code, and ask to see the new tests fail before they pass. The
general directions are in the
[tutorial overview](../readme.md#build-the-steps-with-claude-code).

## Check yourself

1. Why is `dsor://acme/invoice/INV-1008` a bad address, when `acme` is a real company?
2. The specification's own schema pattern accepts `acme` as a tenant. Is the schema
   wrong?
3. `TENANT_ID` is `/^org_[0-9]+$/`. Which part of that is the specification's decision,
   and which part is ours?
4. Why does `formatUri` read the address back and compare the parts, instead of just
   parsing it?
5. `makeInvoice` builds the address from the `id` it was given. What goes wrong if you
   type the id a second time instead?

<details>
<summary>Answers</summary>

1. Because a name changes. If Acme is renamed, every record written before the rename
   points at a company under a name that no longer exists, and you can no longer prove
   the invoice the CFO approved is the invoice that was paid. `org_456` means nothing
   to anybody, so nobody renames it.
2. No. The schema checks the **shape** of an address, and it does that correctly.
   `DSOR-RID-01b` is about **meaning** — is this part an id or a name — and no pattern
   can see that in the text alone. Break 1 is exactly this: the schema's pattern is
   right and insufficient at the same time.
3. The specification decides that a tenant id is an immutable opaque identifier, and
   that no name or alias may appear in an address. It never says what an id looks like.
   `org_` followed by digits is our deployment's convention, which is why it lives in
   one line that another deployment would change.
4. Parsing alone only proves the text is a well-formed address. Building the text
   converts whatever it was given into text first, so a missing id becomes the word
   `"undefined"` and `dsor://org_456/invoice/undefined` parses perfectly — canonical,
   permanent, and pointing at nothing. Comparing the parts catches that, because
   `"undefined"` is not `undefined`.
5. The address and the record drift apart. Break 3 shows INV-1009 carrying INV-1008's
   address: nothing crashes, and two invoices answer to one name, so every log line and
   approval quoting that address is confidently wrong.

</details>

## The rules this step meets

- **[DSOR-RID-01a · L1]** Every DSoR resource MUST have a canonical URI of the form
  `dsor://{tenant_id}/{entity}/{id}`.
  ([§5](../../../specs/dsor/01-model.md#5-resource-identity))
- **[DSOR-RID-01b · L1]** A display name, slug, or alias MUST NOT appear in a canonical
  URI; `tenant_id` is an immutable opaque identifier.
  ([§5](../../../specs/dsor/01-model.md#5-resource-identity))

Both are met for the addresses this step creates, and both come with a limit worth
knowing.

**`DSOR-RID-01b` is checked on the tenant segment only.** Read the rule again: a name
"MUST NOT appear in a canonical URI" — the whole address, not just the company part.
§5's **Common mistake** names the other half too: *"using the company's name (`acme`)
or one system's internal row id as the identifier"*. `TENANT_ID` stops the first.
Nothing here stops the second, so `dsor://org_456/vendor/acme` and
`dsor://org_456/invoice/row-4182` both parse today. The entity and id segments are
still trusted text. They stop being trusted text in step 03, where an operation
contract says which entity names exist, and in step 34, where a connector owns the
mapping from a canonical id to a system's own id.

**`TENANT_ID` is narrower than the rule.** It refuses `acme`, and it would also refuse
a perfectly valid opaque id of another shape, such as a UUID. That is this deployment's
choice, written in one line so another deployment can change it.

Three rules in §5 are not met yet and are not claimed:

| Rule | Why not |
| --- | --- |
| `DSOR-RID-02a` | Needs a mapping from a canonical id to a system's own id. There is no connector until step 34. |
| `DSOR-RID-02b` | Nothing reassigns ids, because nothing creates them. Invoices are a fixed list. |
| `DSOR-RID-03` | Says the same address is used across every interface, in audit, events and approvals. There is one interface and no audit log yet. |

**Next:** step 03, operations and contracts — every action a caller can take becomes a
named operation with a spec sheet, and a registry that refuses a contract with a
missing field.
