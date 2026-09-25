# Step 02 · Canonical URIs

Folder: [`my_02_canonical_uris`](../my_02_canonical_uris/README.md) · 24 tests
Spec: [§5](../../../specs/dsor/01-model.md#5-resource-identity) · `DSOR-RID-01a`, `DSOR-RID-01b`
Commits: `bf08e1c` → `454e711` (6)

## What it does

Every record gets one permanent address, `dsor://org_456/invoice/INV-1008`. `parseUri`
reads one into its three parts; `formatUri` writes one. Each invoice carries its own `uri`,
built from its id by a small factory so the two cannot drift apart.

## Why the step exists

The address is how one invoice is followed from the approval to the payment to the audit
log. If it changes, that trail breaks. §5 puts it in one line: company names change, and
database keys change when data is re-imported.

## The problem the step is really about

These two pieces of text are indistinguishable to a program:

```text
acme
org_456
```

Both are letters, digits and punctuation. Nothing in the text says "I am a name". So the
canonical-URI pattern copied from the normative schema — which is correct — accepts
`dsor://acme/invoice/INV-1008` exactly as readily as the right one.

The repository already knew this: its own `DSOR-RID-01a` test breaks an address with a
**space**, not with a name, because a bare name passes.

## Decisions taken here

- **[7](decisions.md#7--step-02-adds-a-tenant-id-pattern-the-specification-does-not-require-2026-09-23)**
  — a second pattern, `/^org_[0-9]+$/`, which is this deployment's convention and not the
  specification's. Stated as such in the README.
- **[8](decisions.md#8--formaturi-compares-the-parts-it-reads-back-2026-09-23)** —
  `formatUri` reads back what it wrote and compares, because parsing alone lets
  `dsor://org_456/invoice/undefined` through as a perfectly canonical address for a record
  that does not exist.

## The break worth keeping

Replace `TENANT_ID` with the schema's own tenant pattern — the *correct* pattern, straight
from the specification — and three tests go red. The schema's pattern is not wrong. It is
insufficient, and you can watch it be insufficient.

## Limits written down

- `DSOR-RID-01b` is checked on the **tenant segment only**. The rule covers the whole
  address, and §5's Common mistake names "one system's internal row id" as the other half.
  `dsor://org_456/invoice/row-4182` still parses.
- `TENANT_ID` is narrower than the rule: it would also refuse a valid opaque id of another
  shape, such as a UUID.
- `DSOR-RID-02a`, `DSOR-RID-02b` and `DSOR-RID-03` are not claimed. They need a connector,
  something that creates ids, and more than one interface.

## Known gaps, still open

`TENANT_ID` without its `^` and `$` anchors accepts `xorg_456`, and no test catches the
missing anchors. Found in step 04's sweep. A real `DSOR-RID-01b` hole, and by
[decision 17](decisions.md#17--defects-from-an-earlier-step-are-reported-not-patched-forward-2026-09-25)
it is fixed here and repeated forward, not patched in a later copy.
