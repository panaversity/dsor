---
status: draft
version: 1.4.0
date: 2026-09-20
part: 04-context
---

# Part IV — Context

DSoR cannot enforce what an agent runtime or a context store does internally. The requirements in this part are marked **STACK**: they apply to the Digital FTE stack around DSoR and are verified there. DSoR's own guarantees never rely on them. DSOR-MOD-03 and DSOR-MOD-04 hold even if every STACK requirement is violated.

## 33. The context store

**In plain words.** The context store is the agent's notebook: memories, working files, and skills (saved how-to recipes). Nothing in it is authoritative. Rules in this part are marked STACK because they bind the agent software, not DSoR. DSoR stays safe even if they are broken.

The normative abstraction is `AgentContextStore`. It is **composite**: each of the three categories below has its own provider, and one product may fill one, two, or all three.

```typescript
interface AgentContextStore {
  memory: MemoryProvider;        // facts and experience, each with a time and a source
  resources: ResourceProvider;   // working documents and files
  skills: SkillProvider;         // versioned, hash-identified instruction packages
}
```

The reference profile fills `memory` with Graphiti and fills `resources` and `skills` with OpenViking ([§40](05-bindings.md#40-context-bindings-graphiti-and-openviking)). Neither is required for conformance, and DSoR and KSoR remain independently deployable. Where a conformance statement names its "context store" (DSOR-MOD-02), it names the provider of each category.

The two are chosen for what each is good at. A memory is a *fact with a time*: "INV-1008 was unpaid when checked on 18 September." A store that records when a fact was true, when it was learned, and which episode it came from fits [§34.1](#341-provenance-and-revalidation) and [§34.3](#343-the-experience-loop) directly. A skill is a *versioned folder of instructions*, which is a filesystem shape, not a graph shape.

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

### 34.6 Memory that builds itself

**In plain words.** Some memory systems do not wait to be told what to remember. They read every conversation and task log, use an AI model to pull out facts ("VENDOR-44 — status — approved"), and store those facts as a graph. That is powerful, and it creates two dangers that a plain notebook does not have. First, the memory can quietly turn into a second copy of the company's data. Second, the AI model doing the pulling-out is one more place your data is sent.

**Why it matters.** *The shadow copy.* The agent reads VENDOR-44 through DSoR. The memory system extracts "VENDOR-44 is approved" and stores it with a start date and no end date. Next week a human suspends the vendor. The memory still says "approved, valid from 12 September, still true", and it looks *more* trustworthy than a scribbled note, because it has dates on it. Now there are two systems that claim to know the vendor's status, and only one of them is right. *The second model.* DSoR masked the salary field before the agent's own model could see it ([§19.2](02-security.md#192-the-model-boundary)). But the raw task log went to the memory system, which sent it to a different AI model to extract facts. The field leaked through the side door.

**The rules**

- **[DSOR-CTX-07 · STACK]** A memory provider MUST NOT store an operational attribute of a DSoR resource — its status, balance, amount, or approval state — as a remembered fact; it refers to the resource by canonical URI, and the agent reads the attribute through DSoR.
- **[DSOR-CTX-08 · STACK]** Every model that a context provider uses to extract, summarize, or embed content MUST be treated as a model boundary under the tenant's model-egress policy, exactly as the agent's own model is.

What memory *should* hold is experience: lessons, preferences, how a counterparty tends to behave, how a task went, what failed and why. "VENDOR-44 often sends the same invoice twice" is experience. "VENDOR-44 is approved" is state, and state belongs to DSoR.

A provider that extracts facts automatically SHOULD be given a closed list of fact types it may create, SHOULD be told which attributes to ignore, and SHOULD receive content only after the masking of DSOR-CLS-02a has been applied for the extraction model's boundary. Every remembered fact shown to the agent SHOULD carry its valid-from time, its learned-at time, and the label `observational`.

**Common mistake.** Pointing a self-building memory at raw task transcripts with its default settings. It will happily build a private, unmasked, out-of-date copy of your accounting system.
