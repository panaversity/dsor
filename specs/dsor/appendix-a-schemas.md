---
status: draft
version: 1.4.0
date: 2026-09-20
part: appendix-a-schemas
---

# Appendix A — Normative schemas

JSON Schema draft 2020-12, identified by URN. `common` holds shared definitions: `money`, `resourceUri`, `hash`, `duration`, `operationRef`, `permission`, `authorityReference`, `approvalRequirement`, `correlation`, and the enumerations. Each schema closes its top level with `additionalProperties: false` and admits extensions only under `extensions` (DSOR-SCH-02). The package ships one validated example per schema and a negative test for each constraint in the last column.

| Schema (`urn:dsor:schema:1.3:…`) | Artifact | Constraints the schema itself enforces |
|---|---|---|
| `security-context` | Per-request security context | `unattended` requires a delegation and role-source authority; `direct` has an empty actor chain |
| `operation-contract` | Operation contract | No contract without risk, effect, audit; commands require idempotency, concurrency, semantics, preconditions, controls; `non_compensatable` requires `in_flight` rules and an `approve_permission`; compensatable operations name their compensation |
| `control` | Control record | Human owner required; an active control has a reviewer and an effective date; a non-local authority has URI, version, and content hash; at least one test vector; exactly one effect |
| `delegation` | Delegation | At least one identity mode; limits are `money`; subdelegation that is allowed declares a maximum depth |
| `proposal` | Proposal | Payload with hash; requester security context; idempotency key; transition log with actor and cause |
| `approval` | Approval | Binds proposal, operation version, resources, hash, state, satisfied requirements, approvers with basis and authentication time; `critical` requires `strict_version` |
| `result-envelope` | Command and query results | `PENDING_APPROVAL` carries the proposal, hash, requirements, and expiry; `VALIDATED` carries the decision; redactions are itemized |
| `error-envelope` | Errors | Closed code list plus `X_` extensions; `OUTCOME_UNKNOWN` and `RESOURCE_HELD` cannot carry a retry-safe class; `BATCH_PARTIAL` itemizes |
| `decision-bundle` | Decision evidence | Identity mode and authority source; control evaluations with versions and authority; conversions; state observations with freshness; `agent_asserted` kept apart |
| `audit-record` | Audit record | Chain, sequence, previous and record hashes; identity; correlation |
| `event` | Domain event | Event id, ordering key, origin, classification |
| `connector` | Connector declaration | Every capability stated; region; `shared` requires change detection |
| `tenant-policy` | Money, role source, SoD, egress, residency | `on_unconvertible` is fixed to `restrictive`; enabling owner-approval requires who enabled it, a ceiling, a cooling-off period, and a notification channel |
