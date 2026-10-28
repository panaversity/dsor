---
status: draft
version: 1.4.0
date: 2026-09-20
part: 01-model
---

# Part I — Model

## 1. Definition

**In plain words.** DSoR is a gatekeeper service. It does not replace the accounting system or the database. It stands in front of them. Agents, apps, and people go through DSoR, and DSoR talks to the real systems through connectors. DSoR also keeps a small database of its own, the *control-plane store*, for its paperwork: permission slips, pending approvals, locks, counters, and the logbook.

**Why it matters.** Without its own store DSoR would forget what it approved, what it already executed, and how much of today's limit is used. Every safety promise in this document depends on that memory.

DSoR — Data System of Record — is the governed operational data and action layer for AI workers, Digital FTEs, applications, and humans. It provides a standardized interface for authoritative operational state, business entities, queries, commands, authorization, delegation, transactions, approvals, operational controls, audit, events, and connectors to underlying systems of record.

DSoR does not require ownership of business persistence. PostgreSQL, Salesforce, SAP, QuickBooks, Xero, Workday, Odoo, or custom applications MAY remain the physical systems of record. DSoR is the **authoritative governed operational interface** over them.

DSoR does own a control-plane store. The guarantees in Parts II and III cannot be met from stateless logic alone.

**The rules**

- **[DSOR-MOD-01 · L1]** A DSoR implementation MUST durably own, in a control-plane store separate from agent context, its delegations, controls, proposals, approvals, idempotency records, intent records, cumulative-limit counters, holds, and audit evidence.

## 2. Normative architecture and reference profile

**In plain words.** There are two kinds of content here. The *normative architecture* is the set of rules every DSoR must follow. The *reference profile* is a recommended toolkit: PostgreSQL, MCP, Better Auth, Graphiti, OpenViking, KSoR. Think of a recipe that says "use a sharp knife" (the rule) and also "we used this brand" (the reference). You can swap the brand and still cook the dish.

**Why it matters.** Tools change every year. Rules about who may approve a payment should not change because a database went out of fashion.

The normative architecture is the set of contracts that stay fixed across vendors: principal, tenant, delegation, resource identity, entity, operation, authorization, control decision, approval, execution semantics, connector, audit evidence, context-store abstraction, authority reference, and versioning. The reference profile (Part V) names default technologies.

As a design rule for this specification, no L1, L2, or L3 requirement depends on a reference-profile technology. KSoR, Graphiti, OpenViking, MCP, Better Auth, and PostgreSQL each fill an abstract role that another component can fill.

**The rules**

- **[DSOR-MOD-02 · L1]** A conformance statement MUST name the component that fills each abstract role: authority system, context store, agent interface, identity provider, role source, operational store, control-plane store, and rate source.

## 3. Digital FTE architecture

**In plain words.** A Digital FTE is four parts working together, as in the [Start here](../../docs/learn/start-here.md) chapter: KSoR knows the rules, the context store remembers, the agent runtime thinks, and DSoR holds the facts and acts. The arrows in the picture all start at the agent: the agent asks, and the three systems answer.

```text
┌─────────────────────────────────────────────────────┐
│                    DIGITAL FTE                      │
│            Agent Runtime / Harness — REASON         │
│   Reasoning • Planning • Orchestration • Execution  │
└───────────────┬──────────────┬──────────────┬───────┘
                ▼              ▼              ▼
          ┌──────────┐   ┌───────────┐   ┌──────────┐
          │   KSoR   │   │  Context  │   │   DSoR   │
          │  KNOW    │   │ REMEMBER  │   │ STATE    │
          │  GOVERN  │   │ LEARN     │   │ ACT      │
          │  PROVE   │   │           │   │ TRANSACT │
          └──────────┘   └───────────┘   └────┬─────┘
                                              │ Connectors
                                   ┌──────────┼──────────┐
                                   ▼          ▼          ▼
                               PostgreSQL    ERP        SaaS
```

```text
KNOW (KSoR) + REMEMBER (Context) + REASON (Agent) + STATE and ACT (DSoR) = DIGITAL FTE
```

## 4. Authority boundaries and precedence

**In plain words.** The agent hears from three sources, and they will sometimes disagree. This section says who wins. For "what is our policy?", KSoR wins. For "what is true right now?", DSoR wins. The agent's memory never wins. Memory is only good for deciding *where to look*.

**Why it matters.** Last week the agent noted "VENDOR-44 is approved." Yesterday a human suspended that vendor. If memory could win, the agent would pay a suspended vendor. The two rules below stop that: DSoR looks everything up itself and ignores what the caller claims is true.

**Common mistake.** Letting the agent pass "facts" as arguments, such as `vendor_is_approved: true`, and trusting them. DSoR must read the vendor's status itself.

| Layer | Authoritative for | Answers | Examples |
|---|---|---|---|
| **KSoR** | Governed organizational knowledge | What does the organization officially know, require, or prescribe? | Policies, procedures, standards, definitions, decision criteria |
| **DSoR** | Governed operational state and action | What is operationally true now, and what may safely be done? | Customers, vendors, invoices, payments, balances, workflow state, approvals |
| **Context store** | Nothing | What earlier context or experience could help? | Session history, preferences, task trajectories, lessons, skills, working files |
| **Agent runtime** | Nothing | — | Reasoning, planning, tool selection, orchestration, working context |

Precedence: for organizational knowledge, KSoR > context. For current operational state, DSoR > context. Memory MAY help an agent decide where to look. It never decides what is true.

```text
Context: "Payments above 50,000 USD require CFO approval."
KSoR v4: "Payments above 25,000 USD or equivalent require CFO approval."   → use KSoR

Context: "VENDOR-44 is approved."
DSoR:    vendor.status = suspended                                         → use DSoR
```

**The rules**

- **[DSOR-MOD-03 · L1]** DSoR MUST evaluate authorization, controls, and preconditions only against state it reads through its connectors and its own control-plane store.
- **[DSOR-MOD-04 · L1]** DSoR MUST NOT accept a caller-supplied assertion of current state, policy, or approval as evidence.

These two requirements make the precedence rule enforceable: an agent that trusts stale memory still cannot act on it, because DSoR re-reads.

## 5. Resource identity

**In plain words.** Every business object gets one permanent address, like a URL: `dsor://org_456/invoice/INV-1008`. The same address is used in the API, the logs, the events, and the approvals, so you can follow one invoice everywhere.

**Why it matters.** Company names change, and database keys change when data is re-imported. If the address changes, the audit trail breaks: you can no longer prove that the invoice the CFO approved is the invoice that was paid.

**Common mistake.** Using the company's name (`acme`) or one system's internal row id as the identifier. Use an id that never changes and keep a lookup table to each system's own id.

```text
dsor://{tenant_id}/{entity}/{id}          dsor://org_456/invoice/INV-1008
```

**The rules**

- **[DSOR-RID-01a · L1]** Every DSoR resource MUST have a canonical URI of the form `dsor://{tenant_id}/{entity}/{id}`.
- **[DSOR-RID-01b · L1]** A display name, slug, or alias MUST NOT appear in a canonical URI; `tenant_id` is an immutable opaque identifier.
- **[DSOR-RID-02a · L1]** DSoR MUST maintain a durable mapping between each canonical `id` and its native reference (`connector_id`, `native_id`) that survives connector re-synchronization.
- **[DSOR-RID-02b · L1]** A canonical `id` MUST NOT be reassigned to a different business object.
- **[DSOR-RID-03 · L1]** The same canonical URI MUST identify the resource across every interface and in audit, events, approvals, authority references, and context provenance.

A canonical resource MAY map to more than one native reference. The mapping then records each, and the entity schema declares which connector is authoritative for which field. KSoR SHOULD use equally stable identifiers.

## 6. Business entities and the canonical model

**In plain words.** Agents work with business things such as *Invoice* and *Vendor*, not with raw tables such as `inv_hdr_2`. A *canonical model* means one shape for an invoice whether the data lives in Xero, QuickBooks, or Odoo. Fields that exist in only one system go in a clearly marked `extensions` area.

**Why it matters.** An agent that must learn five different accounting APIs will make five times the mistakes. One shape also means one set of safety rules.

**The rules**

- **[DSOR-ENT-01a · L1]** DSoR MUST expose versioned business entities, not raw tables or vendor payloads.
- **[DSOR-ENT-01b · L1]** Each entity schema MUST declare the type and classification of every field.

```yaml
entity:
  name: invoice
  version: 1
  tenant_scoped: true
  fields:
    id:           { type: string,      classification: internal }
    vendor_id:    { type: ref(vendor), classification: internal }
    amount:       { type: money,       classification: confidential }
    open_amount:  { type: money,       classification: confidential }   # excludes in-flight payments, see §25
    status:       { type: enum, values: [draft, issued, paid, cancelled], classification: internal }
  native_ref:     { connector: xero, native_id: "…", native_version: "…" }
  extensions:
    xero:         { branding_theme_id: "…" }
```

### 6.1 Canonical scope

**In plain words.** Making every system look the same is very hard, so this specification is honest about it. It defines a shared model for one business area at a time. When a connector cannot store a value without losing information, it must refuse the write and say so. It must never quietly drop or round the data.

**Common mistake.** "Best effort" mapping that silently truncates a field. The user discovers the loss months later. A loud error today is kinder.

Normalizing equivalent concepts across Xero, QuickBooks, Odoo, and SAP is the most expensive promise in this specification, so its scope is limited deliberately.

- A canonical model is defined **per vertical**, starting with the reference vertical ([§41](05-bindings.md#41-reference-profile-vertical-and-workflow-informative)). DSoR does not claim a universal enterprise schema.
- Where a canonical operation exists, agents use it and never the application API.
- Where none exists, a connector MAY publish namespaced operations, `x.{connector_id}.{operation}`. These carry a full contract and pass through the same pipeline. They are not portable, and the name says so.

**The rules**

- **[DSOR-ENT-02a · L1]** Each connector MUST declare the mapping fidelity of every canonical field as `exact`, `lossy`, `derived`, or `unsupported`.
- **[DSOR-ENT-02b · L1]** A write that would lose information through a `lossy` field, or that targets an `unsupported` field, MUST fail with `UNSUPPORTED_CAPABILITY`.
- **[DSOR-ENT-03a · L1]** Connector-specific data MUST appear only under `extensions.{connector_id}`.
- **[DSOR-ENT-03b · L1]** A canonical field MUST NOT change meaning by connector.

Out-of-band writes are handled in [§35](05-bindings.md#35-connector-contract).

## 7. Operations and the operation contract

**In plain words.** Everything an agent can do is a named function with a spec sheet. The function is an *operation*. The spec sheet is its *contract*. A *query* reads. A *command* changes something. The contract is like a function signature plus a safety label: what goes in, what comes out, which permission is needed, how risky it is, whether it can be undone, and which rules apply.

**Why it matters.** A generic `update(record, fields)` hides what the caller is trying to do, so you cannot attach the right rules to it. `invoice.issue` and `invoice.cancel` say what they mean, and each can carry its own checks.

**Common mistake.** Giving the agent a `run_sql` tool or a "call any API" tool "just for now". That one tool bypasses every protection in this document.

Every agent-accessible action is an explicit operation, either a `QUERY` or a `COMMAND`. DSoR prefers domain operations to generic CRUD: `invoice.issue`, `payment.execute`, `period.close`, not `invoice.update(status="issued")`.

**The rules**

- **[DSOR-OPR-01 · L1]** Every operation MUST have a contract that validates against `operation-contract.schema.json`.
- **[DSOR-OPR-02a · L1]** The operation registry MUST reject a contract that omits a mandatory field.
- **[DSOR-OPR-02b · L1]** The registry MUST NOT infer a default for risk level, execution semantics, effect, or idempotency.

```yaml
operation:
  id: payment.execute
  version: 1
  kind: command
  effect: destructive                  # additive | mutating | destructive
  input:  { schema: PaymentExecutionRequest }        # { payment: dsor://…/payment/… }
  output: { schema: PaymentExecutionResult }
  authorization:
    permission: payment:execute
    approve_permission: payment:approve
  tenancy:     { required: true }
  delegation:  { required: true }
  idempotency: { required: true }
  concurrency: { strategy: optimistic }
  execution:   { semantics: non_compensatable }
  risk:        { level: high }
  bind:                                 # aliases available to CEL as state.<alias>
    payment: input.payment
    invoice: state.payment.invoice
    vendor:  state.payment.vendor
  preconditions:
    freshness: current
    predicates:
      - 'state.vendor.status == "approved"'
      - 'state.invoice.status == "issued"'
      - 'state.payment.status == "draft"'
      - 'dsor_covers(state.invoice.open_amount, state.payment.amount)'
  in_flight:
    exclusive_over: [payment]
    hold_on_unknown: [payment, invoice]
  controls: [high-value-payment, approved-vendors-only]
  sod:  { incompatible_with: [proposal.approve] }
  audit: { level: full }
  connector_requirements: { downstream_idempotency_or_outcome_lookup: true }
```

- **[DSOR-OPR-03a · L1]** An agent interface MUST NOT expose unrestricted execution capability such as `execute_sql(sql)`, arbitrary API passthrough, or a generic connector call.
- **[DSOR-OPR-04a · L1]** Every interface MUST invoke the same DSoR pipeline ([§21](03-execution.md#21-command-pipeline)).
- **[DSOR-OPR-04b · L1]** An interface MUST NOT implement its own business authorization.

Privileged analytical SQL MAY exist on a separately secured administrative interface that agent principals cannot reach.

### 7.1 Queries

**In plain words.** A query must always have a maximum size that the server enforces, even if the caller does not ask for one. An agent in a loop should not be able to download the whole customer table.

**The rules**

- **[DSOR-QRY-01 · L1]** DSoR MUST enforce a server-side maximum page size and maximum result size on every query, whether or not the client asks for a limit.

### 7.2 Commands

**In plain words.** Commands are verbs from the business, not database verbs. Name them the way an accountant would: issue, cancel, execute, post, release.

Examples: `invoice.issue`, `invoice.cancel`, `payment.create`, `payment.execute`, `purchase_order.release`, `journal.post`, `employee.terminate`.

### 7.3 Invocation modes

**In plain words.** Every command can be called three ways. `execute` means "do it, if the rules allow". `propose_only` means "prepare it and wait for someone to release it". `validate_only` is a dry run: "would this be allowed?" with no side effects at all.

**Why it matters.** `validate_only` lets an agent plan without risk. `propose_only` lets you give an agent the power to prepare work while only a human can release it.

| Mode | Behavior |
|---|---|
| `execute` (default) | Run the pipeline. If the outcome is `ALLOW`, execute. If it is `REQUIRE_*`, create a proposal and return `PENDING_APPROVAL` |
| `propose_only` | Run the decision stage and create a proposal even when the outcome is `ALLOW`. Nothing executes until `proposal.execute` |
| `validate_only` | Run the decision stage and return the outcome. No proposal, no reservation, no side effect. The decision is still recorded |

**The rules**

- **[DSOR-OPR-05 · L2]** Every command MUST support the `execute`, `propose_only`, and `validate_only` invocation modes.
- **[DSOR-OPR-06 · L2]** A `validate_only` invocation MUST NOT create a proposal, take a reservation, place a hold, or cause a side effect.

A principal that holds `<resource>:<action>.propose` but not `<resource>:<action>` can invoke the command in `propose_only` mode only. This is how an agent is allowed to prepare work that a human releases.

## 8. Batch operations

**In plain words.** A payment run is a list of many payments handled as one unit. The approver approves the list and its totals, not thirty-seven separate pop-ups. Each item still gets its own checks and its own result. If the list changes after approval, even by one item, it is a new proposal and needs a new approval.

**Why it matters.** An attacker, or a bug, could swap one line in an approved list. Binding the approval to a fingerprint of the whole list makes that impossible to hide.

**The rules**

- **[DSOR-BAT-01a · L2]** A batch command MUST declare its atomicity (`all_or_nothing` or `per_item`) and a maximum item count.
- **[DSOR-BAT-01b · L2]** Each batch item MUST have its own derived idempotency key, control evaluation, and recorded outcome.
- **[DSOR-BAT-01c · L2]** A `per_item` batch that partly succeeds MUST return `BATCH_PARTIAL` with every item's outcome.
- **[DSOR-BAT-02a · L3]** Approval of a batch MUST bind to a manifest hash over the ordered canonical item payloads and to the batch totals per currency and per counterparty.
- **[DSOR-BAT-02b · L3]** Cumulative limits MUST be evaluated atomically against the batch total.
- **[DSOR-BAT-02c · L3]** An item denied by a control MUST be shown to the approver as an exception, not silently dropped.

A changed manifest is a new proposal ([§26.1](03-execution.md#261-one-model)), so an approval can never carry over to it.

## 9. Money and currency

**In plain words.** Money is always an amount *and* a currency, and the amount is stored as a decimal string, never a floating-point number. (In most languages `0.1 + 0.2` is not exactly `0.3`. That is unacceptable for money.) Whenever a rule compares amounts, both sides are first converted to the same currency using an official rate source. If conversion is impossible, the strict answer wins.

**Why it matters.** A rule written as "amount > 25000 and currency is USD" lets a payment of 50,000,000 PKR straight through, because the currency is not USD, so the condition is false. The package contains a test that shows this hole and shows it closed.

**Common mistake.** Comparing the numbers and forgetting the currency, or using `float`.

```yaml
money:   { value: "31400.00", currency: USD }        # value is a decimal string, never a float

tenant_money_policy:
  control_currency: USD
  rate_source: ecb-daily                              # named, auditable source
  max_rate_age: P3D
  on_unconvertible: restrictive
```

**The rules**

- **[DSOR-MON-01 · L1]** A monetary amount MUST be represented as a `money` object with a decimal-string value and an ISO 4217 currency code.
- **[DSOR-MON-02 · L1]** Monetary arithmetic and comparison MUST use decimal arithmetic.
- **[DSOR-MON-03 · L2]** A monetary threshold in a control or delegation MUST be compared only through the `dsor_*` money functions of [Appendix B](appendix-b-cel.md), which convert both operands to the threshold's currency using the tenant's rate source.
- **[DSOR-MON-04 · L2]** When an amount cannot be converted — unknown currency, no rate, or a rate older than `max_rate_age` — the comparison MUST resolve restrictively: a control's condition evaluates to true, and a delegation limit is treated as exceeded.
- **[DSOR-MON-05 · L2]** Every decision that used a conversion MUST record the rate, the rate source, and the rate timestamp in the decision bundle.
- **[DSOR-MON-06 · L2]** A cumulative limit MUST accumulate in the limit's own currency, converting each reservation at the rate in force when the reservation is taken.

A tenant MAY instead declare thresholds per currency. It then also declares a default for unlisted currencies, and DSOR-MON-04 applies when that default is missing.
