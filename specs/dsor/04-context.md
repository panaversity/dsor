---
status: draft
version: 1.3.1
date: 2026-09-19
part: 04-context
---

# Part IV — Context

DSoR cannot enforce what an agent runtime or a context store does internally. The requirements in this part are marked **STACK**: they apply to the Digital FTE stack around DSoR and are verified there. DSoR's own guarantees never rely on them. DSOR-MOD-03 and DSOR-MOD-04 hold even if every STACK requirement is violated.

## 33. The context store

**In plain words.** The context store is the agent's notebook: memories, working files, and skills (saved how-to recipes). Nothing in it is authoritative. Rules in this part are marked STACK because they bind the agent software, not DSoR. DSoR stays safe even if they are broken.

The normative abstraction is `AgentContextStore`. The default implementation is OpenViking ([§40](05-bindings.md#40-openviking-binding)). It is not required for conformance, and DSoR and KSoR remain independently deployable.

| Category | What it holds | Examples |
|---|---|---|
| **Memory** | Dynamic experience retained across tasks | Preferences, earlier decisions, cases, task outcomes, failure lessons |
| **Resources** | Non-authoritative working material | Attachments, temporary documents, working files, cached references |
| **Skills** | Reusable instructions for performing tasks | Vendor reconciliation, duplicate-invoice investigation, month-end close |

A skill describes *how* work may be done. It never decides whether the agent is authorized to do it.

Every persistent context item SHOULD declare a scope — `session`, `user`, `agent`, `team`, or `organization` — and SHOULD carry: `context_id`, `context_type`, `scope`, `tenant_id`, `user_id` and `agent_id` where applicable, `source`, `source_uri`, `source_version`, `observed_at`, `created_at`, `expires_at`, `classification`, `confidence` where applicable, `tainted`, and `authoritative_now` (always `false` for DSoR-derived observations).

Context implementations SHOULD support creation, retrieval, update, expiry, policy-controlled retention, explicit deletion at user and tenant scope, legal holds, classification-aware retention, and backup and restore.

**The rules**

- **[DSOR-CTX-01 · STACK]** Context MUST NOT be retrievable across tenants.

## 34. Context governance

**In plain words.** Rules for keeping the notebook honest and safe.

### 34.1 Provenance and revalidation

**In plain words.** Every note records where it came from and when. Before acting on a note that matters, the agent checks the real source again.

```yaml
context:
  value_ref: dsor://org_456/invoice/INV-1008       # a reference, not a copied value, where classification requires
  note: "INV-1008 was unpaid when checked."
  provenance: { system: dsor, uri: "dsor://org_456/invoice/INV-1008", version: 18, observed_at: "2026-09-18T14:02:00Z" }
  classification: confidential
  authoritative_now: false
```

**The rules**

- **[DSOR-CTX-02 · STACK]** Where current state or current policy is material to a consequential command, the runtime MUST revalidate memory-derived facts against DSoR or KSoR before invoking the command.

Context retrieved at a summary or overview level is subject to the same rule as full-detail context.

```text
Memory: "INV-1008 was unpaid yesterday."  →  invoice_get  →  status = paid  →  do not create a payment
```

### 34.2 Classification propagation

**In plain words.** A note made from confidential data is itself confidential. Truly restricted values are not copied into the notebook at all. The note keeps a link, and the agent reads the value again through DSoR, which applies masking again.

**The rules**

- **[DSOR-CTX-03a · STACK]** Context derived from DSoR or KSoR data MUST carry its provenance and a classification at least as high as the highest-classified source field.
- **[DSOR-CTX-03b · STACK]** `RESTRICTED` values MUST NOT be persisted to the context store; the store keeps the resource URI and re-reads through DSoR.

Without these rules the context store becomes a classification-free copy of the systems DSoR protects.

### 34.3 The experience loop

**In plain words.** Agents learn by saving lessons from finished tasks. That is useful and risky. Text planted in an invoice today can return next week as a trusted-looking "lesson learned". So lessons from tasks that touched outside content are flagged as *tainted*, are always shown to the model as data, and need a human before they can become a skill.

```text
Task → Execution → Outcome → Experience extraction → Context store → Future retrieval
```

**The rules**

- **[DSOR-CTX-04a · STACK]** An extracted memory MUST record whether untrusted external content was present in the task (`tainted: true`).
- **[DSOR-CTX-04b · STACK]** Memories MUST be presented to the model as data, never executed as instructions.
- **[DSOR-CTX-04c · STACK]** A tainted memory MUST NOT be promoted to a skill or to KSoR without human review.

### 34.4 Skill governance

**In plain words.** A skill is a saved recipe. Recipes are versioned, never contain passwords, and need a human owner's approval before they can drive risky operations.

**The rules**

- **[DSOR-CTX-05a · STACK]** Skills MUST be versioned and identified by content hash.
- **[DSOR-CTX-05b · STACK]** A skill MUST NOT contain usable connector credentials.
- **[DSOR-CTX-05c · STACK]** A skill used in a `HIGH` or `CRITICAL` operation MUST have been approved by a human owner at organization scope.
- **[DSOR-CTX-05d · STACK]** For operations rated `MEDIUM` and above, the runtime MUST report the skill URI, version, and hash with the command.

DSoR records what the runtime reports under `agent_asserted` (DSOR-AUD-06). It is useful for investigation. It is not verified, and no control depends on it.

### 34.5 Knowledge promotion

**In plain words.** An agent's observation does not become company policy on its own. It goes through human review into KSoR first.

**The rules**

- **[DSOR-CTX-06 · STACK]** Agent context MUST NOT become organizational knowledge except through: agent observation → knowledge proposal → governance and human review → KSoR.

Agent memory likewise never mutates business state directly. Change always follows: agent intent → DSoR command → the pipeline in [§21](03-execution.md#21-command-pipeline).
