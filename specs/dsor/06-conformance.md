---
status: draft
version: 1.4.0
date: 2026-09-20
part: 06-conformance
---

# Part VI — Conformance

## 43. Versioning and deprecation

**In plain words.** Everything has a version number. A breaking change creates a new major version and the old one keeps working for a published period. An approval given for version 1 of an operation cannot be used to run version 2.

**The rules**

- **[DSOR-VER-01a · L1]** DSoR MUST version the protocol, entity schemas, operations, connector contracts, and controls.
- **[DSOR-VER-01b · L1]** A breaking change MUST produce a new major version (`payment.execute@1` → `payment.execute@2`).
- **[DSOR-VER-01c · L1]** Audit records and decision bundles MUST record the versions that applied.
- **[DSOR-VER-02a · L1]** A deprecated operation or schema version MUST keep working until its published deprecation window closes.
- **[DSOR-VER-02b · L2]** A proposal created for `operation@N` MUST NOT be executed as any other version.

## 44. Operational bounds

**In plain words.** Many rules say "within a declared time". This table caps those times, so nobody can claim a working emergency brake that takes a month to stop anything.

Wherever this specification says "within the bound of [§44](#44-operational-bounds)", the implementation declares a value, and the value has a ceiling. A kill switch that takes a month to work is not a kill switch.

| Parameter | Requirement | L2 | L3 |
|---|---|---|---|
| Delegation revocation takes effect | DSOR-DEL-04b | ≤ 60 s | next command; status read from the store, no cache |
| Suspension or freeze takes effect | DSOR-OPS-01b | ≤ 60 s | ≤ 5 s |
| Staleness of the delegator's authority from the role source | DSOR-IDN-06 | ≤ 24 h | ≤ 1 h |
| Superseded authority detected | DSOR-CTL-03a | ≤ 24 h | ≤ 1 h |
| `stale_grace` on `HIGH` and `CRITICAL` operations | DSOR-CTL-03c | ≤ 30 d | ≤ 7 d |
| Exchange-rate age (`max_rate_age`) | DSOR-MON-04 | ≤ 7 d | ≤ 3 d |
| Alert on `OUTCOME_UNKNOWN` | DSOR-UNK-04b | — | ≤ 1 min |
| Human escalation of an unresolved `OUTCOME_UNKNOWN` | DSOR-UNK-04c | — | ≤ 1 h |
| Approval validity | DSOR-APR-04a | ≤ 30 d | ≤ 72 h for `HIGH`; ≤ 24 h for `CRITICAL` |
| Idempotency record retention (a minimum) | DSOR-IDM-02 | ≥ 24 h | ≥ 30 d |
| Audit checkpoint interval | DSOR-AUD-04b | ≤ 24 h | ≤ 1 h |
| Deprecation window (a minimum) | DSOR-VER-02a | ≥ 6 months | ≥ 6 months |

**The rules**

- **[DSOR-BND-01 · L2]** A conformance statement MUST declare a value for every parameter in this table, within the limit for the claimed level.
- **[DSOR-BND-02 · L2]** A tenant-level setting MUST NOT loosen a parameter beyond the limit for the claimed level.

Tenants MAY set tighter values.

## 45. Security invariants

**In plain words.** If you read only one table in this document, read this one. It is the whole specification compressed into promises, each linked to the rules that make it testable.

Each invariant is mandatory, and each points to the requirements that make it testable.

| Invariant | Requirements |
|---|---|
| The model is not a security boundary. Prompts never substitute for authorization. | DSOR-MOD-03, DSOR-MOD-04, DSOR-SRC-01a, DSOR-TEN-01c |
| Memory is not authoritative. No context system overrides KSoR or DSoR. | DSOR-MOD-04, DSOR-CTX-02 |
| Skills do not grant permissions, and what an agent says about itself is never a control input. | DSOR-AUT-01b, DSOR-AUD-07 |
| No interface owns authorization. | DSOR-OPR-04a, DSOR-OPR-04b, DSOR-RP-09a |
| Connectors do not bypass DSoR. | DSOR-CNR-04 |
| External credentials are never exposed to the model. | DSOR-CNR-02 |
| Retrieved content never grants authority. | DSOR-SRC-01a, DSOR-SRC-02a |
| Audit never requires private model chain-of-thought. | DSOR-AUD-03b |
| Evidence is written before side effects, and denials are evidence. | DSOR-EXE-02, DSOR-EXE-03a, DSOR-EXE-03b |
| An unknown outcome is never reported as success or as failure, and never opens a path to a duplicate. | DSOR-UNK-01b, DSOR-ERR-02, DSOR-EXC-01, DSOR-EXC-02, DSOR-UNK-03b |
| Approvals bind to payload, state, and people. | DSOR-APR-02a, DSOR-APR-03a, DSOR-APR-12, DSOR-SOD-02 |
| Agents never approve, never activate controls, never lift suspensions, and never resolve unknown outcomes. | DSOR-SOD-01a, DSOR-CTL-02b, DSOR-OPS-01d, DSOR-UNK-04d |
| An unattended agent never holds more authority than its delegator holds now. | DSOR-DEL-02, DSOR-DEL-08, DSOR-IDN-06, DSOR-IDN-07 |
| A threshold cannot be evaded by currency. | DSOR-MON-03, DSOR-MON-04, DSOR-CTL-02d |
| State-changing operations are idempotent, and a proposal executes at most once. | DSOR-IDM-01b, DSOR-IDM-04 |
| Tenant isolation holds regardless of agent behavior. | DSOR-TEN-01b, DSOR-TEN-01c |
| A stale control is never silently dropped, and a broken condition never fails open. | DSOR-CTL-03b, DSOR-CTL-07 |
| Memory never becomes a second system of record, and every model that touches context is a model boundary. | DSOR-CTX-07, DSOR-CTX-08 |

## 46. Requirement index

**In plain words.** A list of every rule identifier by level. The full text of each rule is in `requirements.json`, which is what a test suite should load.

A system claims conformance at a level by satisfying every requirement at that level and below. `requirements.json` is the machine-readable registry: identifier, level, section, and the full normative sentence for each requirement. One conformance test or more exists per identifier.

**The rules**

- **[DSOR-CNF-01 · L1]** A conformance statement MUST give the level claimed, the specification version, and — for RP — the bindings implemented.

<!--REQ_INDEX-->

## 47. Verification approach

**In plain words.** How you would prove each group of rules. *Fault injection* means breaking things on purpose — killing the process, dropping the network — to check that the promises still hold. [Appendix D](../../docs/learn/learning-path.md) turns this table into a build plan.

| Area | How it is verified |
|---|---|
| SCH | Every artifact emitted in the test run validates against [Appendix A](appendix-a-schemas.md); the schema package's own negative tests pass |
| MOD, OPR, ENT, VER, CNF, BND, RES | Inspection of the conformance statement, registry, and schemas; the registry rejects malformed contracts; each declared bound is measured |
| MON | Same payment in the control currency, a foreign currency, and an unconvertible currency; stale rate; conversion recorded in the bundle |
| RID, CNR | Re-synchronization keeps canonical ids stable; an out-of-band write shows a version change, `origin: external`, and no cached `CURRENT` |
| SRC | Injection suite: hostile instructions planted in record fields, documents, memory, and connector payloads; none of the listed effects occurs |
| IDN, TEN | Cross-tenant suite over every operation; pooled-connection test for tenant bleed; delegator demoted or deprovisioned in the role source while an unattended agent runs |
| DEL | Widening-token test; unattended request under an `on_behalf_of`-only delegation; ambiguous delegation; revocation timing; concurrent-limit race (N parallel commands never exceed the limit); re-evaluation does not double-reserve |
| AUT, SOD | Deny by default; self-approval, delegator approval, and agent approval all refused; incompatible grant rejected; owner-approval mode refused above its ceiling, without step-up, and inside the cooling-off period |
| CTL | Agent activation refused; failing vector blocks activation; superseded authority marks the control stale and never disables it; a condition that throws applies its effect |
| OPS | Suspension takes effect within the declared bound under load; an approved proposal does not execute while suspended |
| CLS, QRY | Masking per egress policy; redaction list present; small-group aggregation refused; row budget survives a change of caller-supplied task id; unbounded query capped |
| EXE, IDM, CON | Fault injection: kill the process after intent and before finalize; concurrent same-key requests execute once; replay with the same and with a different payload |
| EXC, UNK | Drop the connector response: `OUTCOME_UNKNOWN`, holds on every `hold_on_unknown` resource, a second payment of the same invoice refused, reconciliation and escalation timed |
| APR, BAT | Approve with a wrong hash; supply a payload to `proposal.execute`; change bound state after approval; publish a stricter control version after approval; expire, revoke, and re-execute; alter a batch manifest; relay approval through the agent channel |
| FRS, ERR | A cached value is never labelled `CURRENT`; every error validates and carries a retry class; no existence leak |
| AUD, EVT, COR | Runtime identity cannot modify audit; chain verification detects tampering in every partition; denial present in audit; agent-asserted fields never reach a control; outbox event for every committed outcome; key destruction erases values and the chain still verifies |
| CTX (STACK) | Cross-tenant retrieval; revalidation before consequential commands; no `RESTRICTED` values at rest; tainted memory not promoted; user-scoped skill blocked from `HIGH` operations; after a run, memory holds no status, balance, amount, or approval state of any resource; a field masked for the agent never reaches the extraction model; an agent-supplied group id is ignored |
| RP | Tool names match operation ids; catalog differs by delegation; all four hints set; MRTR-supplied approval refused; header/body mismatch refused; foreign-audience token refused; shared-secret agent credential refused; RLS forced and transaction-local |

## 48. Final architectural principle

**In plain words.** The five distinctions that everything else protects.

A governed Digital FTE distinguishes:

> **what the organization knows,**
> **what the worker remembers,**
> **what the worker reasons,**
> **what is operationally true,**
> **and what the worker is authorized to change.**

KSoR governs organizational knowledge. The context store — Graphiti for memory and OpenViking for skills and resources, by default — holds persistent context and experience. The agent runtime reasons and orchestrates. DSoR governs operational state, authority, transactions, approvals, and evidence, and it holds those guarantees without trusting the other three.
