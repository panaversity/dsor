# Learning path: build DSoR in five stages

You learn this specification fastest by building a small DSoR. Each stage is a working system. Do not start a stage until the "you are done when" tests of the previous one pass. Use PostgreSQL and any backend language you know.

## Stage 1 — A gatekeeper for one entity (L1)

Build one entity (`invoice`), one query (`invoice.get`), and one command (`invoice.issue`) over a PostgreSQL table.

| Build | Rules to read |
|---|---|
| An operation registry that loads contracts and rejects one with a missing field | [§7](../../specs/dsor/01-model.md#7-operations-and-the-operation-contract), DSOR-OPR-01 to 04b |
| Canonical URIs | [§5](../../specs/dsor/01-model.md#5-resource-identity) |
| Permissions, denied by default | [§15](../../specs/dsor/02-security.md#15-authorization) |
| The first six pipeline steps and step 11 (record the decision) | [§21](../../specs/dsor/03-execution.md#21-command-pipeline), DSOR-EXE-01a, 02 |
| Result and error envelopes that validate against the schemas | [§28](../../specs/dsor/03-execution.md#28-result-and-error-envelopes), [Appendix A](../../specs/dsor/appendix-a-schemas.md) |
| An audit table the application's database role can insert into but not update or delete | [§29](../../specs/dsor/03-execution.md#29-audit-and-decision-evidence), [§30](../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) |

**You are done when:** a caller without `invoice:issue` is refused; the refusal appears in the audit table; every response validates against its schema; and `UPDATE audit …` fails with a permission error.

## Stage 2 — Many companies, sensitive data (L1)

| Build | Rules to read |
|---|---|
| A `tenant_id` on every row and row-level security, forced and transaction-local | [§14](../../specs/dsor/02-security.md#14-multi-tenancy), [§36](../../specs/dsor/05-bindings.md#36-postgresql-reference-connector) |
| A cross-tenant test that calls every operation with another tenant's URI | DSOR-TEN-02b |
| Field classification, masking for agent callers, and a list of redactions in the response | [§19](../../specs/dsor/02-security.md#19-classification-and-read-side-governance) |
| A server-side page-size limit | [§7.1](../../specs/dsor/01-model.md#71-queries) |

**You are done when:** the cross-tenant test suite passes; a query made with no tenant setting returns no rows; and an agent caller sees a masked `amount` while the response says it was masked.

## Stage 3 — An agent that acts alone (L2)

| Build | Rules to read |
|---|---|
| Delegations in your control-plane store, with `unattended` mode | [§13](../../specs/dsor/02-security.md#13-delegation) |
| Idempotency keys claimed by one atomic insert | [§22](../../specs/dsor/03-execution.md#22-idempotency) |
| Proposals and their state machine; `validate_only` and `propose_only` | [§7.3](../../specs/dsor/01-model.md#73-invocation-modes), [§26.1](../../specs/dsor/03-execution.md#261-one-model), [§26.2](../../specs/dsor/03-execution.md#262-lifecycle) |
| Daily limits with reserve, commit, and release, keyed by proposal | [§13.4](../../specs/dsor/02-security.md#134-cumulative-limits) |
| Agent suspension | [§18](../../specs/dsor/02-security.md#18-operational-controls) |

**You are done when:** fifty parallel requests with one idempotency key execute once; fifty parallel payments never exceed the daily limit; a revoked delegation cancels its pending proposals; and a suspended agent is refused without any change to the agent's code.

## Stage 4 — Rules and approvals (L2)

| Build | Rules to read |
|---|---|
| The `money` type and the `dsor_exceeds` function with a fixed rate table | [§9](../../specs/dsor/01-model.md#9-money-and-currency), [Appendix B](../../specs/dsor/appendix-b-cel.md) |
| Controls written in CEL, with test vectors that run on activation | [§17](../../specs/dsor/02-security.md#17-policy-compilation-from-authority-to-control) |
| `proposal.approve` in `direct` mode only, with the segregation-of-duties checks | [§16](../../specs/dsor/02-security.md#16-segregation-of-duties), [§26.5](../../specs/dsor/03-execution.md#265-the-approval-channel) |
| Re-evaluation at `proposal.execute` | [§26.4](../../specs/dsor/03-execution.md#264-re-evaluation-at-execution) |
| The decision bundle | [§29](../../specs/dsor/03-execution.md#29-audit-and-decision-evidence) |

**You are done when:** 25,000.01 USD and 50,000,000 PKR both require approval; the delegator and the agent are both refused as approvers; suspending the vendor after approval makes the proposal `INVALIDATED`; and a control whose condition throws still applies its effect.

## Stage 5 — Actions that cannot be undone (L3)

| Build | Rules to read |
|---|---|
| A fake bank connector that you can make slow, fail, or go silent | [§35](../../specs/dsor/05-bindings.md#35-connector-contract) |
| The intent record, written before the connector is called | [§21](../../specs/dsor/03-execution.md#21-command-pipeline), DSOR-EXE-03a |
| `OUTCOME_UNKNOWN`, holds on the payment and the invoice, and in-flight exclusivity | [§25](../../specs/dsor/03-execution.md#25-in-flight-exclusivity-unknown-outcomes-and-reconciliation) |
| A reconciliation job that asks the fake bank by idempotency key | [§25.3](../../specs/dsor/03-execution.md#253-reconciliation) |
| A hash chain over the audit table and a verifier script | [§30](../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) |

**You are done when:** you kill the server between "intent written" and "result recorded" and the restarted system shows `OUTCOME_UNKNOWN`; a retry and a brand-new payment for the same invoice are both refused; reconciliation settles the proposal; and editing one old audit row makes the verifier fail.

At the end of stage 5 you have met the most important rules of all three levels, and you understand why each one exists because you watched the failure it prevents.
