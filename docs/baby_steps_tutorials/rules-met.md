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
| DSOR-EXE-01a | [07 · The pipeline skeleton](mj_07_the_pipeline_skeleton/README.md) (learner build), lines ①, ⑤, ⑥, and ⑨; the other lines are not built yet | [`test/pipeline.test.ts`](mj_07_the_pipeline_skeleton/test/pipeline.test.ts) |
| DSOR-OPR-04a | [07 · The pipeline skeleton](mj_07_the_pipeline_skeleton/README.md) (learner build), one interface only, `call`; a second arrives in step 42 | [`test/pipeline.test.ts`](mj_07_the_pipeline_skeleton/test/pipeline.test.ts) |
| DSOR-EXE-02 | [08 · Write the decision first](mj_08_write_the_decision_first/README.md) (learner build), before the response only; the log is in memory, and durable arrives in step 09 | [`test/decision-log.test.ts`](mj_08_write_the_decision_first/test/decision-log.test.ts), [`test/startup.test.ts`](mj_08_write_the_decision_first/test/startup.test.ts) |
| DSOR-EXE-03b | [08 · Write the decision first](mj_08_write_the_decision_first/README.md) (learner build), an L2 rule built early; the caller's half only, since no command runs yet | [`test/decision-log.test.ts`](mj_08_write_the_decision_first/test/decision-log.test.ts) |
| DSOR-AUD-04a | [09 · Postgres on Neon](mj_09_postgres_on_neon/README.md) (learner build), an L2 rule built early; proved by the database tier, `pnpm test:db`, which CI does not run | [`test/audit.db.test.ts`](mj_09_postgres_on_neon/test/audit.db.test.ts), [`test/runtime-role.test.ts`](mj_09_postgres_on_neon/test/runtime-role.test.ts) |
| DSOR-AUD-02a | [09 · Postgres on Neon](mj_09_postgres_on_neon/README.md) (learner build); proved by the database tier, `pnpm test:db` | [`test/audit.db.test.ts`](mj_09_postgres_on_neon/test/audit.db.test.ts) |
| DSOR-TEN-01a | [10 · Tenants](mj_10_tenants/README.md) (learner build); invoice rows and audit records carry their company | [`test/tenants.test.ts`](mj_10_tenants/test/tenants.test.ts), [`test/tenants.db.test.ts`](mj_10_tenants/test/tenants.db.test.ts) |
| DSOR-IDN-03a | [10 · Tenants](mj_10_tenants/README.md) (learner build); the company is always named in the request envelope and checked against the caller's memberships. Until step 18, the subject is the caller | [`test/tenants.test.ts`](mj_10_tenants/test/tenants.test.ts) |
| DSOR-IDN-03b | [10 · Tenants](mj_10_tenants/README.md) (learner build), reading only: no operation writes yet | [`test/tenants.test.ts`](mj_10_tenants/test/tenants.test.ts), [`test/tenants.db.test.ts`](mj_10_tenants/test/tenants.db.test.ts) |
| DSOR-SRC-02b | [10 · Tenants](mj_10_tenants/README.md) (learner build), the tenant half: four field spellings and every `dsor://` URI in the input. The principal half is step 05's | [`test/tenants.test.ts`](mj_10_tenants/test/tenants.test.ts) |
| DSOR-ERR-01b | [10 · Tenants](mj_10_tenants/README.md) (learner build), for other companies and their invoices | [`test/tenants.test.ts`](mj_10_tenants/test/tenants.test.ts) |
