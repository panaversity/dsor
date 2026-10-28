# How the specification got here

**v1.1 → v1.2.** v1.1 established the architecture: four layers, authority precedence, the instruction boundary, the operation contract, approval binding, decision bundles, and the normative/reference split. v1.2 kept all of it and added what an implementer needs: a pipeline that writes evidence before side effects and records denials; `OUTCOME_UNKNOWN` in place of an ambiguous timeout; an approval lifecycle with re-evaluation and segregation of duties; BCP 14 language with identified requirements; policy compilation with drift detection; delegation on the wire; read-side governance; an honest canonical model; an MCP binding for the 2026-07-28 revision; and a threat model.

**v1.3.1 → v1.4.0 (2026-09-20).** The reference context store was one product, OpenViking, for memories, resources, and skills. It is now two: Graphiti for memory, OpenViking for skills and resources, behind a composite `AgentContextStore` (§33, §40). The reasoning: the specification already asks every memory to carry when it was observed and where it came from, and Graphiti's facts carry a valid time, a learned-at time, and their source episodes natively, so provenance and the taint flag fall out of the data model; a skill is a versioned folder, which suits OpenViking's filesystem and its account-shared and per-user skill scopes.

Looking hard at the split exposed two risks that were present before it and that nothing in the specification covered. A memory system that extracts facts by itself will, by default, rebuild the company's operational state as a graph, with dates that make stale facts look current. And the model it uses for extraction is a second place data is sent, outside the masking DSoR applied for the agent's own model. v1.4.0 adds one STACK requirement for each: DSOR-CTX-07 and DSOR-CTX-08 (§34.6), with threat T19, an invariant row, and verification cases. A third point, that the tenant partition must come from the security context and never from the agent, is already required in outcome by DSOR-CTX-01, so it is binding guidance in §40.1 and not a new requirement.

No L1, L2, L3, or RP requirement changed, and no schema changed, so the schema URNs stay at `1.3`. Nothing was integrated or run; see `docs/status.md`.

**v1.3 → v1.3.1.** Editorial only. Added the [Start here](../docs/learn/start-here.md) chapter, a plain-language opening for every section, [Appendix D](../docs/learn/learning-path.md) (a staged build path), and [Appendix E](../docs/learn/questions.md) (questions and answers); removed paragraphs those openings made redundant. Every requirement sentence is unchanged, which the build verifies against v1.3's `requirements.json`.

**Summary of v1.2 → v1.3.**

| # | Change | Where |
|---|---|---|
| 1 | One approval model. Per-entity `propose` / `approve` / `execute` operations are removed. Every command has invocation modes; approval and execution of a pending command go through generic `proposal.*` commands that run the full pipeline | [§7.3](../specs/dsor/01-model.md#73-invocation-modes), [§26.1](../specs/dsor/03-execution.md#261-one-model) |
| 2 | Execution re-run specified: atomic idempotency claim, reservations keyed by proposal, the rule by which an existing approval satisfies a re-evaluated control, and the effect of a control version change | [§21](../specs/dsor/03-execution.md#21-command-pipeline), [§22](../specs/dsor/03-execution.md#22-idempotency), [§26.4](../specs/dsor/03-execution.md#264-re-evaluation-at-execution) |
| 3 | Money type and currency rules. A threshold can no longer be bypassed by paying in another currency | [§9](../specs/dsor/01-model.md#9-money-and-currency) |
| 4 | In-flight exclusivity and wider holds, so an unknown outcome on one payment blocks a second payment of the same invoice | [§25](../specs/dsor/03-execution.md#25-in-flight-exclusivity-unknown-outcomes-and-reconciliation) |
| 5 | Two identity modes, `on_behalf_of` and `unattended`, and an authoritative role source for principals who are not present | [§12.1](../specs/dsor/02-security.md#121-role-source), [§13.2](../specs/dsor/02-security.md#132-identity-modes-on-the-wire), [§37](../specs/dsor/05-bindings.md#37-identity-binding) |
| 6 | Wire format: normative JSON Schemas for thirteen artifacts, and CEL as the single expression language for control conditions and predicates | [§0.5](../specs/dsor/00-conventions.md#05-normative-artifacts), [§17.3](../specs/dsor/02-security.md#173-expression-language), App. A, App. B |
| 7 | Ceilings on every "declared bound" at L2 and L3 | [§44](../specs/dsor/06-conformance.md#44-operational-bounds) |
| 8 | Owner-approval mode for tenants with one human, with mandatory compensating controls | [§16.2](../specs/dsor/02-security.md#162-owner-approval-mode) |
| 9 | Requirements are atomic: one MUST per identifier. v1.2 identifiers are kept and split with letter suffixes (`DEL-04` becomes `DEL-04a`, `DEL-04b`, `DEL-04c`). The registry ships as `requirements.json` | whole document, [§46](../specs/dsor/06-conformance.md#46-requirement-index) |
| 10 | Row budgets no longer key on caller-supplied task ids; all four MCP tool hints set explicitly; agent-asserted evidence labelled; partitioned audit chains; data residency and erasure; commentary on earlier versions moved to Appendix C | [§19](../specs/dsor/02-security.md#19-classification-and-read-side-governance), [§38.2](../specs/dsor/05-bindings.md#382-annotations), [§29](../specs/dsor/03-execution.md#29-audit-and-decision-evidence), [§30](../specs/dsor/03-execution.md#30-audit-integrity-and-retention), [§20](../specs/dsor/02-security.md#20-data-residency-and-erasure) |

**v1.2 → v1.3.** Review of v1.2 found that:

1. Two approval models coexisted — a proposal lifecycle for every command, and per-entity propose/approve/execute operations — with no statement of how they related or what the hashed input of an execute call was. v1.3 keeps only the lifecycle and makes approval and execution generic commands over a stored, immutable payload.
2. Re-running the pipeline at execution would have reserved a limit twice, never said that an existing approval satisfies the re-evaluated control, used an idempotency lookup where a claim was needed, and left a control version change undefined.
3. The example control compared an amount only when the currency was USD, so any other currency passed.
4. Holding the payment did not stop a second payment of the same invoice.
5. The token example assumed a logged-in user, which the nightly, unattended case never has; and the delegator's current authority could not be known without a role source.
6. The "central interoperability primitive" had no wire format and no expression language.
7. Every "declared bound" was unbounded.
8. The segregation rule made a single-human tenant unusable. The first instinct — prohibit owner approval at L3 — would have excluded sole proprietors from paying bills at all, since payments are L3. v1.3 allows it at L3 with a ceiling, a cooling-off period, step-up authentication, a DSoR-rendered payload, and a second-channel notification, and requires the conformance statement to disclose it.
9. Requirements bundled several MUSTs under one identifier.
10. Row budgets keyed on a caller-minted id; MCP hints left to pessimistic defaults; agent-reported skill versions sat among verified evidence; a single audit chain serialized all writes; residency and erasure were absent; and commentary on earlier versions sat inside normative text.

**Choices open to challenge.** The [§44](../specs/dsor/06-conformance.md#44-operational-bounds) ceilings are the editor's proposals and should be tested against real deployments before they are fixed. CEL was chosen over Rego because a control condition is an expression inside a DSoR record, not a policy program, and CEL's termination guarantee and small surface suit that; an implementation may compile to another engine ([§17.3](../specs/dsor/02-security.md#173-expression-language)). Identifiers keep their v1.2 numbers with letter suffixes so that review comments on v1.2 remain traceable.
