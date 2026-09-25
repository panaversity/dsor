# Step 03 · Operations and contracts

Folder: [`my_03_operations_and_contracts`](../my_03_operations_and_contracts/README.md) · 53 tests
Spec: [§7](../../../specs/dsor/01-model.md#7-operations-and-the-operation-contract) · `DSOR-OPR-01`, `DSOR-OPR-02a`, `DSOR-OPR-02b`
Commits: `0d3774d` → `8ae1a94` (12, including two outside the step folder)

## What it does

Nothing calls `getInvoice` directly any more. Every action has a name — `invoice.get`,
`invoice.issue` — and a **contract**: a JSON document saying whether it reads or changes,
which permission it needs, how risky it is. A registry loads all the contracts when the
program starts and **refuses to start** if one is broken.

New tool: `ajv`, pinned at 8.20.0, a real dependency because `src/` imports it at run time.

## Why a broken contract must stop the program

A contract with no risk level is a contract no control can ever fire on. If that only
surfaced on the one payment a month large enough to need approval, it would look fine for
the other thirty days. Refusing at start-up turns a quiet gap into a loud one.

## Decisions taken here

- **[9](decisions.md#9--steps-copy-normative-schemas-byte-for-byte-and-the-formatter-is-told-to-leave-them-alone-2026-09-24)**
  — the formatter is told to leave copied schemas alone, so byte identity holds.
- **[10](decisions.md#10--step-03-validates-against-the-real-schema-not-a-smaller-one-2026-09-24)**
  — validate against the specification's actual 591 lines, not a friendlier summary.
- **[11](decisions.md#11--step-03-became-one-idea-the-command-moved-to-step-04-2026-09-24-supersedes-part-of-10)**
  — the command was removed from this step after review judged it two ideas. `427fdbb`
  added `invoice.issue`'s handler, `414ba68` is the last commit here that still has it, and
  `79e0521` removed it. Step 04 brings it back at `146ad76`.

## The break worth keeping

Two breaks, one letter apart.

Delete `risk` from a contract: the program refuses to start, and `pnpm test` collects **37,
not 53** — a whole file's tests never ran, because the module throws while loading. That is
what "refused at start-up" looks like from outside.

Now misspell `required` as `requird` inside the copied schema and delete `risk` again: the
program runs happily, all 53 collected, only four tests fail. Under `strict: false` ajv
ignores a keyword it does not recognise, so the rule you thought you wrote is absent and
nothing warns you. And `strict: false` is not optional — under `strict: true`, thirteen of
the specification's fourteen schemas will not load.

## The contract with no handler

After [decision 11](decisions.md#11--step-03-became-one-idea-the-command-moved-to-step-04-2026-09-24-supersedes-part-of-10),
`invoice.issue` ships a contract and no code. Asking for it says
`has a contract, and no handler until step 04`.

The contract stayed because a **command's** contract is the interesting one: a query needs
ten fields, a command needs six more, and the schema only demands them when `kind` is
`command`. Without one, that whole branch of the schema is never exercised and
`DSOR-OPR-02a` is a much thinner claim.

The waiting is recorded in code, not left as a gap. `NOT_YET_IMPLEMENTED` lists the ids and
`assertPaired` checks the list both ways — an id on it must still have a contract, and must
*not* already have a handler. That is what forced step 04 to cross it off.

## Limits written down

- `DSOR-OPR-02b` **cannot be proved by a schema at all**. A `required` list shows a field
  was missing from the document; it can never show the registry did not supply the value
  itself. The tests do it behaviourally, and they delete the *leaf* (`risk.level`) as well
  as the parent, because a registry filling in the level while leaving `risk` in place
  would pass a test that only deleted the parent.
- `DSOR-OPR-01` holds for everything through the registry, which is not everything. Nothing
  stops a later file importing `getInvoice` and going round the side; there is no door until
  step 42, and no agent-facing one until 46.
- `DSOR-OPR-03a` is **not** claimed. `execute_sql` being unreachable is the right shape, not
  the rule — the rule is about an agent interface, which does not exist yet.
- The contract's `predicates` are never read. Nothing parses CEL until step 27, so
  `predicates: []` and a line of nonsense both validate.
