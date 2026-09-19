---
status: draft
version: 1.3.1
date: 2026-09-19
claim: a governed operational data and action layer that stays safe when the AI worker using it is wrong, tricked, or hostile
evidence: research/history.md · research/open-questions.md · packages/spec (schemas, examples, tests)
---

# DSoR Specification v1.3.1

**Data System of Record — governed operational data and action infrastructure for AI workers.**

Draft for review. Written for students and junior developers: every section explains
itself in plain words before it states its rules. v1.3.1 is an editorial revision of
v1.3; no requirement, identifier, or schema changed.

| | |
| --- | --- |
| **Companion system** | [KSoR](https://github.com/panaversity/ksor) — Knowledge System of Record |
| **Reference profile** | MCP `2026-07-28` · OAuth 2.1/OIDC (Better Auth binding) · PostgreSQL + RLS · OpenViking · TypeScript |
| **Conformance levels** | L1 Core · L2 Autonomous · L3 Financial/Critical · RP Reference Profile · STACK Digital FTE stack |
| **Machine-readable half** | [`packages/spec/`](../../packages/spec/): JSON Schemas, examples, [`requirements.json`](../../packages/spec/requirements.json), tests |

## Read this first

New here? Read [Start here](../../docs/learn/start-here.md) before any part below. It
explains the problem, the four parts of a Digital FTE, one payment from start to
finish, the words you need, and how to read a rule. Then choose a reading path from
its last table.

## The parts

| File | Contents |
| --- | --- |
| [Part 0 — Conventions](00-conventions.md) | How to read a rule, the levels, the glossary, the running example, the normative artifacts |
| [Part I — Model](01-model.md) | What DSoR is, who is authoritative for what, identifiers, entities, operations, batches, money |
| [Part II — Security](02-security.md) | Threats, the instruction boundary, identity, delegation, tenants, authorization, segregation of duties, controls, the emergency brake, data classification |
| [Part III — Execution](03-execution.md) | The command pipeline, idempotency, unknown outcomes, proposals and approvals, freshness, errors, audit, events |
| [Part IV — Context](04-context.md) | Rules for the agent's memory and skills (STACK level) |
| [Part V — Connectors and bindings](05-bindings.md) | Connectors, PostgreSQL, OAuth, MCP, REST, OpenViking, the reference workflow |
| [Part VI — Conformance](06-conformance.md) | Versioning, operational bounds, the security invariants, the requirement index, how to verify |
| [Appendix A — Normative schemas](appendix-a-schemas.md) | What each JSON Schema enforces |
| [Appendix B — CEL environment](appendix-b-cel.md) | Variables and `dsor_*` functions available to conditions |

Learning material lives in [`docs/learn/`](../../docs/learn/): the
[five-stage build path](../../docs/learn/learning-path.md) and
[questions with answers](../../docs/learn/questions.md). The history of the
specification and its open questions live in [`research/`](../../research/).

## Every section, and where it lives

Section numbers are global and stable, so "§21" means the same thing in every file.

| § | Section | File |
| --- | --- | --- |
| 0.1 | [Requirement language](00-conventions.md#01-requirement-language) | `00-conventions.md` |
| 0.2 | [Conformance levels](00-conventions.md#02-conformance-levels) | `00-conventions.md` |
| 0.3 | [Glossary](00-conventions.md#03-glossary) | `00-conventions.md` |
| 0.4 | [Running example](00-conventions.md#04-running-example-informative) | `00-conventions.md` |
| 0.5 | [Normative artifacts](00-conventions.md#05-normative-artifacts) | `00-conventions.md` |
| 1 | [Definition](01-model.md#1-definition) | `01-model.md` |
| 2 | [Normative architecture and reference profile](01-model.md#2-normative-architecture-and-reference-profile) | `01-model.md` |
| 3 | [Digital FTE architecture](01-model.md#3-digital-fte-architecture) | `01-model.md` |
| 4 | [Authority boundaries and precedence](01-model.md#4-authority-boundaries-and-precedence) | `01-model.md` |
| 5 | [Resource identity](01-model.md#5-resource-identity) | `01-model.md` |
| 6 | [Business entities and the canonical model](01-model.md#6-business-entities-and-the-canonical-model) | `01-model.md` |
| 7 | [Operations and the operation contract](01-model.md#7-operations-and-the-operation-contract) | `01-model.md` |
| 8 | [Batch operations](01-model.md#8-batch-operations) | `01-model.md` |
| 9 | [Money and currency](01-model.md#9-money-and-currency) | `01-model.md` |
| 10 | [Threat model](02-security.md#10-threat-model) | `02-security.md` |
| 11 | [Source trust and the instruction boundary](02-security.md#11-source-trust-and-the-instruction-boundary) | `02-security.md` |
| 12 | [Identity and principals](02-security.md#12-identity-and-principals) | `02-security.md` |
| 13 | [Delegation](02-security.md#13-delegation) | `02-security.md` |
| 14 | [Multi-tenancy](02-security.md#14-multi-tenancy) | `02-security.md` |
| 15 | [Authorization](02-security.md#15-authorization) | `02-security.md` |
| 16 | [Segregation of duties](02-security.md#16-segregation-of-duties) | `02-security.md` |
| 17 | [Policy compilation: from authority to control](02-security.md#17-policy-compilation-from-authority-to-control) | `02-security.md` |
| 18 | [Operational controls](02-security.md#18-operational-controls) | `02-security.md` |
| 19 | [Classification and read-side governance](02-security.md#19-classification-and-read-side-governance) | `02-security.md` |
| 20 | [Data residency and erasure](02-security.md#20-data-residency-and-erasure) | `02-security.md` |
| 21 | [Command pipeline](03-execution.md#21-command-pipeline) | `03-execution.md` |
| 22 | [Idempotency](03-execution.md#22-idempotency) | `03-execution.md` |
| 23 | [Concurrency](03-execution.md#23-concurrency) | `03-execution.md` |
| 24 | [Execution semantics](03-execution.md#24-execution-semantics) | `03-execution.md` |
| 25 | [In-flight exclusivity, unknown outcomes, and reconciliation](03-execution.md#25-in-flight-exclusivity-unknown-outcomes-and-reconciliation) | `03-execution.md` |
| 26 | [Proposals and approvals](03-execution.md#26-proposals-and-approvals) | `03-execution.md` |
| 27 | [Freshness and consistency](03-execution.md#27-freshness-and-consistency) | `03-execution.md` |
| 28 | [Result and error envelopes](03-execution.md#28-result-and-error-envelopes) | `03-execution.md` |
| 29 | [Audit and decision evidence](03-execution.md#29-audit-and-decision-evidence) | `03-execution.md` |
| 30 | [Audit integrity and retention](03-execution.md#30-audit-integrity-and-retention) | `03-execution.md` |
| 31 | [Events](03-execution.md#31-events) | `03-execution.md` |
| 32 | [Correlation](03-execution.md#32-correlation) | `03-execution.md` |
| 33 | [The context store](04-context.md#33-the-context-store) | `04-context.md` |
| 34 | [Context governance](04-context.md#34-context-governance) | `04-context.md` |
| 35 | [Connector contract](05-bindings.md#35-connector-contract) | `05-bindings.md` |
| 36 | [PostgreSQL reference connector](05-bindings.md#36-postgresql-reference-connector) | `05-bindings.md` |
| 37 | [Identity binding](05-bindings.md#37-identity-binding) | `05-bindings.md` |
| 38 | [MCP binding](05-bindings.md#38-mcp-binding) | `05-bindings.md` |
| 39 | [REST and SDK interfaces](05-bindings.md#39-rest-and-sdk-interfaces) | `05-bindings.md` |
| 40 | [OpenViking binding](05-bindings.md#40-openviking-binding) | `05-bindings.md` |
| 41 | [Reference profile, vertical, and workflow](05-bindings.md#41-reference-profile-vertical-and-workflow-informative) | `05-bindings.md` |
| 42 | [Upstream compatibility baseline](05-bindings.md#42-upstream-compatibility-baseline-informative) | `05-bindings.md` |
| 43 | [Versioning and deprecation](06-conformance.md#43-versioning-and-deprecation) | `06-conformance.md` |
| 44 | [Operational bounds](06-conformance.md#44-operational-bounds) | `06-conformance.md` |
| 45 | [Security invariants](06-conformance.md#45-security-invariants) | `06-conformance.md` |
| 46 | [Requirement index](06-conformance.md#46-requirement-index) | `06-conformance.md` |
| 47 | [Verification approach](06-conformance.md#47-verification-approach) | `06-conformance.md` |
| 48 | [Final architectural principle](06-conformance.md#48-final-architectural-principle) | `06-conformance.md` |

## Changing this specification

Requirement ids are never reused or renumbered, and each holds exactly one MUST.
`pnpm guard` enforces both and keeps the registry in step with the prose. Before you
edit anything here, read
[`.claude/skills/change-the-spec/SKILL.md`](../../.claude/skills/change-the-spec/SKILL.md).
