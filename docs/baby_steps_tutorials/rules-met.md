# Rules met by the baby steps

This page lists every rule of the specification that a baby step proves, and the test
that proves it. It grows by one or more rows each time a step is built. Step 51 walks
the security invariants of
[§45](../../specs/dsor/06-conformance.md#45-security-invariants) and starts from this
page.

A rule is listed only when a test titled with its id passes in that step. A rule named
in a step's README but not tested there does not belong here.

| Rule | Step | Proved by |
| --- | --- | --- |
| DSOR-MON-01 | [01 · One invoice in memory](mj_01_one_invoice_in_memory/README.md) (learner build) | [`test/money.test.ts`](mj_01_one_invoice_in_memory/test/money.test.ts) (22 tests), [`test/invoice.test.ts`](mj_01_one_invoice_in_memory/test/invoice.test.ts) (2 tests) |
