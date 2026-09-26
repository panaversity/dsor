# Rules met by the baby steps

This page lists every rule of the specification that a baby step's tests prove, and
where those tests are. It grows by one or more rows each time a step lands.

A rule is listed only when a test titled with its id passes in that step. `pnpm guard`
checks that each linked test file has such a title, and CI runs every step's own
`pnpm check`. A rule named in a step's README but not tested there does not belong here.

Until an official step exists, its row may point at a learner build, marked
"(learner build)". When the official step lands, its row replaces the learner row.

| Rule | Step | Proved by |
| --- | --- | --- |
| DSOR-MON-01 | [01 · One invoice in memory](mj_01_one_invoice_in_memory/README.md) (learner build) | [`test/money.test.ts`](mj_01_one_invoice_in_memory/test/money.test.ts), [`test/invoice.test.ts`](mj_01_one_invoice_in_memory/test/invoice.test.ts) |
| DSOR-RID-01a | [02 · Canonical URIs](mj_02_canonical_uris/README.md) (learner build) | [`test/uri.test.ts`](mj_02_canonical_uris/test/uri.test.ts) |
| DSOR-RID-01b | [02 · Canonical URIs](mj_02_canonical_uris/README.md) (learner build), tenant part only | [`test/uri.test.ts`](mj_02_canonical_uris/test/uri.test.ts) |
| DSOR-OPR-01 | [03 · Operations and contracts](mj_03_operations_and_contracts/README.md) (learner build) | [`test/registry.test.ts`](mj_03_operations_and_contracts/test/registry.test.ts), [`test/contract.test.ts`](mj_03_operations_and_contracts/test/contract.test.ts) |
| DSOR-OPR-02a | [03 · Operations and contracts](mj_03_operations_and_contracts/README.md) (learner build) | [`test/contract.test.ts`](mj_03_operations_and_contracts/test/contract.test.ts), [`test/registry.test.ts`](mj_03_operations_and_contracts/test/registry.test.ts) |
| DSOR-OPR-02b | [03 · Operations and contracts](mj_03_operations_and_contracts/README.md) (learner build) | [`test/contract.test.ts`](mj_03_operations_and_contracts/test/contract.test.ts), [`test/registry.test.ts`](mj_03_operations_and_contracts/test/registry.test.ts) |
| DSOR-ERR-01a | [04 · Result and error envelopes](mj_04_result_and_error_envelopes/README.md) (learner build) | [`test/envelope.test.ts`](mj_04_result_and_error_envelopes/test/envelope.test.ts) |
| DSOR-COR-01b | [04 · Result and error envelopes](mj_04_result_and_error_envelopes/README.md) (learner build) | [`test/call.test.ts`](mj_04_result_and_error_envelopes/test/call.test.ts) |
| DSOR-SCH-01 | [04 · Result and error envelopes](mj_04_result_and_error_envelopes/README.md) (learner build), error envelopes only; a query's answer breaks it | [`test/envelope.test.ts`](mj_04_result_and_error_envelopes/test/envelope.test.ts) |
| DSOR-IDN-01 | [05 · Who is calling](mj_05_who_is_calling/README.md) (learner build) | [`test/who-is-calling.test.ts`](mj_05_who_is_calling/test/who-is-calling.test.ts) |
| DSOR-SRC-02a | [05 · Who is calling](mj_05_who_is_calling/README.md) (learner build), who is calling only; the rest of the security context is not built yet | [`test/who-is-calling.test.ts`](mj_05_who_is_calling/test/who-is-calling.test.ts) |
| DSOR-SRC-02b | [05 · Who is calling](mj_05_who_is_calling/README.md) (learner build), a principal only; tenant and delegation ids come in steps 10 and 18 | [`test/who-is-calling.test.ts`](mj_05_who_is_calling/test/who-is-calling.test.ts) |
| DSOR-AUT-01a | [06 · Permissions, denied by default](mj_06_permissions_deny_by_default/README.md) (learner build) | [`test/permissions.test.ts`](mj_06_permissions_deny_by_default/test/permissions.test.ts) |
| DSOR-AUT-01b | [06 · Permissions, denied by default](mj_06_permissions_deny_by_default/README.md) (learner build) | [`test/permissions.test.ts`](mj_06_permissions_deny_by_default/test/permissions.test.ts) |
