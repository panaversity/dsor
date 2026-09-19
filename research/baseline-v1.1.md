> **Historical document.** This is the v1.1 Architecture Baseline the specification grew from, kept for provenance. It is superseded by [`specs/dsor/`](../specs/dsor/README.md). Nothing here is normative.

# DSoR Specification v1.1

## Architecture Baseline

## Governed Operational Data and Action Infrastructure for AI Workers

**Status:** Architecture baseline — stable draft
**Companion system:** KSoR — Knowledge System of Record
**Default context implementation:** OpenViking
**Primary agent protocol:** MCP
**Reference MCP profile:** 2026-07-28
**Reference operational store:** PostgreSQL
**Reference authentication profile:** OAuth 2.1/OIDC; Better Auth MCP profile in the reference stack

---

# 1. Definition

DSoR — Data System of Record — is the governed operational data and action layer for AI workers, Digital FTEs, applications, and humans.

DSoR provides a standardized interface for:

- authoritative operational state;
- business entities;
- queries;
- commands;
- authorization;
- delegation;
- transactions;
- approvals;
- operational controls;
- audit;
- events;
- connectors to underlying systems of record.

DSoR does not require ownership of physical persistence.

Existing systems such as PostgreSQL, Salesforce, SAP, QuickBooks, Xero, Workday, Odoo, or custom enterprise applications MAY remain the physical systems of record.

DSoR provides the **authoritative governed operational interface** over those systems.

---

# 2. Normative Architecture vs Reference Profile

DSoR SHALL distinguish the portable architecture from the opinionated reference implementation.

## Normative architecture

The normative architecture defines contracts and invariants that MUST remain independent of a specific vendor or implementation:

```text
Principal
Tenant
Delegation
Resource identity
Entity
Operation
Authorization
Control decision
Approval
Execution semantics
Connector
Audit evidence
Context-store abstraction
KSoR authority reference
Versioning
```

A conforming DSoR implementation MAY replace the reference technologies while preserving these contracts.

## Default reference profile

The default Digital FTE reference stack is opinionated:

```text
Knowledge authority      → KSoR
Context implementation   → OpenViking
Agent protocol           → MCP 2026-07-28
Authentication           → OAuth 2.1/OIDC
Reference auth binding   → Better Auth MCP profile
Operational connector    → PostgreSQL
Database isolation       → PostgreSQL RLS
```

Reference technologies are defaults for interoperability, documentation, examples, and the first implementation. They SHALL NOT become hidden architectural dependencies.

This distinction follows the same vendor-neutral design principle used by KSoR: the durable authority model is normative; named technologies are replaceable bindings.

---

# 3. Digital FTE Architecture

The standard Digital FTE architecture consists of four independent layers:

```text
┌─────────────────────────────────────────────────────┐
│                    DIGITAL FTE                      │
│                                                     │
│                   AGENT RUNTIME                     │
│                                                     │
│ Reasoning • Planning • Orchestration • Execution    │
└───────────────┬──────────────┬──────────────┬────────┘
                │              │              │
                ▼              ▼              ▼
          ┌──────────┐   ┌───────────┐   ┌──────────┐
          │   KSoR   │   │  Context  │   │   DSoR   │
          │          │   │   Store   │   │          │
          │ KNOW     │   │ REMEMBER  │   │ STATE    │
          │ GOVERN   │   │ LEARN     │   │ ACT      │
          │ PROVE    │   │ CONTEXT   │   │ TRANSACT │
          └──────────┘   └───────────┘   └─────┬────┘
                                               │
                                      Systems of Record

```

The architectural mnemonic is:

```text
KSoR        = KNOW

Context     = REMEMBER

Agent       = REASON

DSoR        = STATE + ACT

```

Therefore:

```text
KNOW
+
REMEMBER
+
REASON
+
STATE
+
ACT
=
DIGITAL FTE

```

---

# 4. Authority Boundaries

The architecture SHALL distinguish authority from context.

## KSoR

KSoR is authoritative for governed organizational knowledge.

Examples:

```text
Policies
Procedures
Standards
Definitions
Controls
Methods
Decision criteria
Institutional knowledge
Approved guidance

```

KSoR answers:

> What does the organization officially know, require, prescribe, or consider authoritative?

---

## DSoR

DSoR is authoritative for governed operational state and action.

Examples:

```text
Customers
Employees
Vendors
Invoices
Payments
Orders
Inventory
Balances
Workflow state
Transactions
Approvals

```

DSoR answers:

> What is operationally true now, and what actions may safely be performed?

---

## Agent Context Store

The Context Store maintains non-authoritative context useful to the agent.

Examples:

```text
Previous tasks
Session history
User preferences
Task trajectories
Experience
Successful patterns
Failure lessons
Skills
Working resources

```

It answers:

> What previous context or experience could help with this task?

---

## Agent Runtime

The Agent Runtime is responsible for:

```text
Reasoning
Planning
Task decomposition
Model invocation
Tool selection
Orchestration
Execution loops
Working context

```

It SHALL NOT become the authoritative source for business state or organizational knowledge.

---

# 5. Authority Precedence

Context SHALL NOT override authoritative systems.

For governed organizational knowledge:

```text
KSoR > Agent Context

```

For current operational state:

```text
DSoR > Agent Context

```

Example:

```text
Context:
"Payments over $50,000 require CFO approval."

KSoR:
"Payments over $25,000 require CFO approval."

Result:
Use KSoR.

```

Example:

```text
Context:
"Vendor ABC is approved."

DSoR:
Vendor ABC = suspended

Result:
Use DSoR.

```

Memory MAY help determine where to look.

Memory SHALL NOT determine authoritative truth.

---

# 6. Source Trust and Instruction Boundary

Authority and instruction-following are separate concerns.

Retrieved content from KSoR, OpenViking, DSoR fields, external APIs, files, email, web pages, or connector payloads SHALL be treated as data unless the runtime has explicitly classified that content as an approved executable instruction or skill.

The following rule applies:

```text
Content can inform reasoning.
Content cannot grant authority.
Content cannot expand permissions.
Content cannot bypass DSoR controls.
```

A malicious or accidental instruction embedded in a customer record, invoice description, document, memory, or external API response SHALL NOT be able to:

```text
change the active principal
change the tenant
expand delegation
grant a permission
approve an operation
alter an approval payload
expose connector credentials
disable audit
bypass KSoR or DSoR authority
```

KSoR governance establishes whether organizational knowledge is authoritative. DSoR establishes whether an operational action is permitted. The Agent Context Store remains contextual even when it contains text that looks like a policy or instruction.

---

# 7. Default Context Store

The normative abstraction is:

```text
AgentContextStore

```

The default implementation for the Digital FTE reference stack SHALL be:

```text
OpenViking

```

The architecture SHALL NOT require OpenViking for conformance.

Conceptually:

```text
Agent Runtime
      │
      ▼
AgentContextStore
      │
      ├── OpenViking ← DEFAULT
      │
      └── Alternative implementation

```

OpenViking-specific capabilities MAY be used by the reference implementation, but DSoR and KSoR SHALL remain independently deployable.

The reference OpenViking binding SHOULD map its native context model as follows:

```text
OpenViking Resource → contextual reference material
OpenViking Memory   → persistent non-authoritative experience
OpenViking Skill    → reusable agent capability/instruction package
```

OpenViking Resources MAY contain documents, rules, manuals, repositories, and other reference material. Within this architecture, such material does not become organizationally authoritative merely because it is stored in OpenViking. Material that must govern organizational behavior SHOULD be promoted into or referenced from KSoR.

The reference adapter SHOULD preserve OpenViking's native `viking://` identifiers and scope boundaries instead of inventing a parallel addressing system.

Typical mappings include:

```text
viking://resources/...            shared reference resources
viking://user/{user_id}/...       user-scoped context
viking://~/memories/...           authenticated user's memory alias
viking://~/skills/...             authenticated user's skills alias
viking://agent/skills/...         shared agent capabilities when enabled
```

The adapter MAY use OpenViking's progressive context loading and hierarchical retrieval. Context retrieved at an abstract or overview level SHALL remain subject to the same authority and revalidation rules as full-detail context.

---

# 8. Context Types

The default Context Store SHALL support three logical categories.

## Memory

Dynamic experience retained across tasks.

Examples:

```text
Preferences
Previous decisions
Cases
Events
Task outcomes
Failure lessons
Agent experience

```

## Resources

Non-authoritative contextual material.

Examples:

```text
Attachments
Temporary documents
Working files
Cached references
Task-specific resources

```

## Skills

Reusable instructions for performing tasks.

Examples:

```text
Perform vendor reconciliation

Investigate duplicate invoice

Prepare month-end close

Prepare cash-position report

```

A skill describes **how** work may be performed.

It SHALL NOT determine whether the agent is authorized to perform it.

---

# 9. Context Scope

Every persistent context item SHOULD declare a scope.

Supported scopes SHOULD include:

```text
session
user
agent
team
organization

```

Implementations MAY add additional scopes.

Example:

```yaml
memory:
  scope: agent

  agent_id: accounts-payable-fte

  organization_id: acme

  type: experience

```

Cross-tenant context retrieval SHALL NOT be allowed.

---

# 10. Context Lifecycle

Context implementations SHOULD support:

```text
Creation
Retrieval
Update
Expiration
Retention
Deletion
Tenant isolation
Provenance
Classification

```

Operational audit SHALL NOT be stored exclusively as agent memory.

Agent memory MAY reference audit events but SHALL NOT replace them.

---

# 11. Context Governance

Every persistent context item SHOULD carry enough metadata to support governance and revalidation.

Recommended metadata includes:

```text
context_id
context_type
scope
organization_id
user_id where applicable
agent_id where applicable
source
source_uri
source_version
observed_at
created_at
expires_at
classification
confidence where applicable
authoritative_now
```

## Retention and deletion

Context retention SHALL be policy-controlled.

A context implementation SHOULD support:

```text
TTL / expiration
explicit deletion
user-scoped deletion
organization-scoped deletion
legal or compliance retention holds
classification-aware retention
backup and restore
```

Deleting agent memory SHALL NOT delete the authoritative KSoR record, DSoR operational state, or required DSoR audit evidence.

## Skill governance

Skills SHOULD be versioned and provenance-aware.

For MEDIUM, HIGH, or CRITICAL operations, the runtime SHOULD be able to identify the exact skill version that influenced the task. A skill SHALL NOT grant authorization and SHALL NOT contain usable long-lived connector credentials.

---

# 12. Identity Model

Authentication SHOULD be delegated to an external identity provider.

Examples include:

```text
Better Auth
Microsoft Entra ID
Keycloak
Auth0
Other OAuth/OIDC providers

```

DSoR SHALL consume a normalized principal.

```typescript
interface EnterprisePrincipal {
  id: string;

  type:
    | "human"
    | "agent"
    | "application"
    | "system";

  organizationId: string;

  roles: string[];
  scopes: string[];

  claims?: Record<string, unknown>;
}

```

---

# 13. AI Workers as Principals

AI workers SHALL be first-class principals.

Human identity and agent identity SHALL remain distinct.

Example:

```text
Human:
user_123

Agent:
accounts-payable-fte

Organization:
org_456

```

Audit records SHALL preserve both identities where applicable.

---

# 14. Delegation

An AI worker SHALL operate under explicit authority.

A delegation SHOULD define:

```text
Delegating principal
Agent
Organization
Allowed operations
Allowed resources
Financial limits
Cumulative limits
Counterparty constraints
Time restrictions
Expiration
Approval requirements
Subdelegation policy

```

Example:

```yaml
delegation:
  id: del_100

  principal: user_123
  delegate: accounts-payable-fte
  organization: org_456

  permissions:
    - invoice:read
    - vendor:read
    - payment:propose

  constraints:
    per_transaction_limit: 50000
    daily_limit: 200000
    approved_vendors_only: true

  expires_at: 2026-12-31T23:59:59Z

```

An agent SHALL NOT acquire more authority than the delegating principal possesses.

---

# 15. Multi-Tenancy

Tenant isolation SHALL be fundamental.

The standard security path is:

```text
Identity
   ↓
Tenant Resolution
   ↓
Delegation
   ↓
Authorization
   ↓
Connector Enforcement
   ↓
Database Enforcement

```

Every tenant-owned DSoR resource SHALL have a tenant identity.

Cross-tenant disclosure SHALL be treated as a critical security failure.

---

# 16. Resource Identity

DSoR resources SHOULD have stable canonical identifiers.

Recommended format:

```text
dsor://{organization}/{entity}/{id}

```

Examples:

```text
dsor://acme/invoice/INV-1008

dsor://acme/vendor/VENDOR-44

dsor://acme/payment/PAY-901

```

KSoR SHOULD use similarly stable authoritative identifiers.

Example:

```text
ksor://acme/finance/payment-approval-policy

```

Stable resource identities SHOULD be usable across:

```text
MCP
REST
Audit
Events
KSoR references
Context references
Approvals

```

---

# 17. Business Entities

DSoR SHALL expose business entities rather than raw database tables.

Examples:

```text
Customer
Vendor
Employee
Invoice
Payment
Account
PurchaseOrder
SupportTicket
Opportunity

```

Example entity:

```yaml
entity:
  name: invoice
  version: 1
  tenant_scoped: true

  fields:

    id:
      type: uuid

    customer_id:
      type: uuid

    amount:
      type: decimal

    currency:
      type: string

    status:
      type: enum
      values:
        - draft
        - issued
        - paid
        - cancelled

```

---

# 18. Canonical Business Model

DSoR SHOULD normalize equivalent concepts across systems.

```text
                  DSoR Invoice
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
        Xero       QuickBooks      Odoo

```

The agent interacts with:

```text
invoice.get
invoice.list
invoice.issue

```

rather than application-specific APIs where a canonical operation exists.

---

# 19. Operations

Every agent-accessible DSoR action SHALL map to an explicit operation.

Operations are either:

```text
QUERY
COMMAND

```

Queries read operational state.

Commands attempt to modify operational state.

DSoR SHALL prefer domain operations over unrestricted CRUD where meaningful.

For example:

```text
invoice.issue

payment.propose

payment.execute

period.close

```

rather than:

```text
invoice.update(status="issued")

```

---

# 20. Normative Operation Contract

Every DSoR operation SHALL have a machine-readable contract.

Example:

```yaml
operation:
  id: payment.execute
  version: 1

  kind: command

  input:
    schema: PaymentExecutionRequest

  output:
    schema: PaymentExecutionResult

  authorization:
    permission: payment:execute

  tenancy:
    required: true

  delegation:
    required: true

  idempotency:
    required: true

  concurrency:
    strategy: optimistic

  execution:
    semantics: non_compensatable

  risk:
    level: high

  approval:
    policy: payment-high-value

  audit:
    level: full

  governing_knowledge:
    - ksor://acme/finance/payment-policy

  connector_requirements:
    idempotency: true

```

This operation contract is a central DSoR interoperability primitive.

---

# 21. Queries

Queries SHALL be bounded operations.

Examples:

```text
customer.get
customer.search

invoice.get
invoice.list

vendor.balance

inventory.availability

```

Queries SHOULD support appropriate:

```text
Filtering
Pagination
Sorting
Field selection
Aggregation

```

All SHALL remain subject to authorization and information classification.

---

# 22. Arbitrary SQL

General AI workers SHALL NOT receive unrestricted database execution capability.

This SHALL NOT be a standard DSoR operation:

```text
execute_sql(sql)

```

Agent interfaces SHOULD expose governed business operations instead.

Privileged analytical SQL MAY exist through a separately secured administrative interface.

---

# 23. Commands

Commands change operational state.

Examples:

```text
invoice.issue

invoice.cancel

payment.propose

payment.execute

purchase_order.approve

journal.post

employee.terminate

```

Every command SHALL define:

```text
Input
Output
Authorization
Delegation requirements
Validation
Concurrency semantics
Idempotency semantics
Execution semantics
Risk
Approval requirements
Audit requirements

```

---

# 24. Authorization

Initial DSoR implementations SHALL support RBAC.

Permission format:

```text
<resource>:<action>

```

Examples:

```text
invoice:read

invoice:create

payment:propose

payment:approve

payment:execute

journal:post

```

Implementations SHOULD support attribute-based authorization where required.

---

# 25. Authorization Outcomes

Authorization and operational control evaluation SHALL support at least:

```text
ALLOW

DENY

REQUIRE_APPROVAL

```

Implementations MAY additionally support:

```text
REQUIRE_STEP_UP_AUTHENTICATION

REQUIRE_VERIFICATION

```

---

# 26. KSoR Policy Relationship

KSoR SHALL remain authoritative for organizational policy.

DSoR SHALL be responsible for operational enforcement.

```text
KSoR
=
Policy Authority

DSoR
=
Policy Enforcement

```

Example:

```text
KSoR:

Payments > $100,000 require CFO approval.

                 ↓

DSoR:

amount > 100000
→ REQUIRE_APPROVAL(CFO)

```

---

# 27. Control Traceability

DSoR controls SHOULD identify the KSoR knowledge from which they originate.

```yaml
control:
  id: high-value-payment

  operation:
    payment.execute

  effect:
    require_approval: CFO

  authority:
    uri: ksor://acme/finance/payment-policy
    rule: high-value-payment
    version: 4

```

This creates:

```text
Action
  ↓
DSoR Control
  ↓
KSoR Rule
  ↓
Governed Source

```

---

# 28. Idempotency

State-changing agent operations SHOULD be idempotent wherever meaningful.

Every protected command SHOULD carry:

```text
request_id
idempotency_key

```

The standard logical guarantee is:

```text
same tenant
+
same operation
+
same idempotency key
=
same logical execution

```

A retry SHALL NOT unintentionally create a second business transaction.

This is especially important for:

```text
Payments
Invoices
Orders
Journal entries
External API calls

```

---

# 29. Concurrency

DSoR SHALL define concurrency behavior for state-changing operations.

Recommended strategies:

```text
optimistic
pessimistic
connector_managed

```

Optimistic operations SHOULD support a resource version or equivalent.

Example:

```yaml
command:
  operation: payment.execute

  expected_version: 18

```

If the resource changed, DSoR SHOULD return:

```text
STALE_STATE

```

or:

```text
CONFLICT

```

rather than silently operating on stale information.

---

# 30. Execution Semantics

DSoR SHALL NOT imply that every external operation is ACID.

Operations SHOULD declare one of:

```text
ATOMIC

COMPENSATABLE

SAGA

BEST_EFFORT

NON_COMPENSATABLE

```

Example:

```text
invoice.create
→ COMPENSATABLE

```

Example:

```text
payment.execute
→ NON_COMPENSATABLE

```

The agent and orchestration system MUST be able to distinguish these cases.

---

# 31. Transactions

Where the connector supports transactions, DSoR SHOULD use them.

Canonical command path:

```text
Resolve Identity
      ↓
Resolve Tenant
      ↓
Resolve Delegation
      ↓
Authorize
      ↓
Evaluate Controls
      ↓
Validate
      ↓
Concurrency Check
      ↓
Execute
      ↓
Commit / Finalize
      ↓
Audit

```

---

# 32. Approvals

Sensitive operations SHALL support explicit approval.

Lifecycle:

```text
PROPOSED
    ↓
PENDING_APPROVAL
    ↓
APPROVED
    ↓
EXECUTING
    ↓
COMMITTED

```

or:

```text
PROPOSED
    ↓
REJECTED

```

---

# 33. Approval Binding

Approval SHALL bind to the exact proposed operation.

An approval SHOULD reference:

```text
Proposal ID
Operation
Tenant
Resource
Canonical input
Payload hash
Risk classification
Approver
Expiration

```

Example:

```yaml
approval:
  proposal_id: proposal_123

  operation: payment.execute

  payload_hash: "sha256:..."

  approved_by: cfo_100

  expires_at: ...

```

Execution SHALL verify that the approved payload matches the payload being executed.

Changing a material field SHALL invalidate the previous approval.

---

# 34. Risk Classification

Operations SHOULD support:

```text
LOW

MEDIUM

HIGH

CRITICAL

```

Risk does not grant or deny permission by itself.

It informs operational controls such as:

```text
Approval requirements
Authentication requirements
Monitoring
Audit detail
Execution restrictions

```

---

# 35. Data Classification

DSoR SHOULD support:

```text
PUBLIC

INTERNAL

CONFIDENTIAL

RESTRICTED

```

Classification MAY apply at:

```text
Entity
Field
Operation

```

Example:

```yaml
salary:
  type: decimal
  classification: restricted

```

---

# 36. Standard Error Model

DSoR interfaces SHALL expose normalized machine-readable errors.

Core error codes SHOULD include:

```text
AUTHENTICATION_REQUIRED

AUTHORIZATION_DENIED

DELEGATION_REQUIRED

DELEGATION_EXPIRED

TENANT_MISMATCH

RESOURCE_NOT_FOUND

VALIDATION_FAILED

POLICY_DENIED

APPROVAL_REQUIRED

APPROVAL_EXPIRED

APPROVAL_MISMATCH

CONFLICT

STALE_STATE

IDEMPOTENCY_CONFLICT

RATE_LIMITED

CONNECTOR_UNAVAILABLE

DEPENDENCY_TIMEOUT

TRANSACTION_FAILED

UNSUPPORTED_CAPABILITY

INTERNAL_ERROR

```

Connector-specific errors SHOULD be mapped into this model where possible.

---

# 37. Connector Architecture

DSoR Connectors bridge canonical operations with underlying systems.

```text
DSoR
 │
 ▼
Connector Contract
 │
 ├── PostgreSQL
 ├── QuickBooks
 ├── Xero
 ├── Odoo
 ├── Salesforce
 ├── SAP
 ├── Workday
 └── Custom API

```

---

# 38. Connector Capability Declaration

Every connector SHALL describe its capabilities.

Example:

```yaml
connector:
  id: postgres

  version: 1

  capabilities:
    transactions: true
    optimistic_concurrency: true
    idempotency: true
    events: true
    row_level_security: true
    batch: true

```

An operation SHALL NOT be routed to a connector that cannot satisfy its mandatory requirements unless the operation explicitly defines fallback semantics.

---

# 39. PostgreSQL Reference Connector

PostgreSQL is the default reference operational connector.

Recommended roles:

```text
dsor_runtime

dsor_migration

dsor_admin

```

`dsor_runtime` SHALL NOT be a PostgreSQL superuser.

Recommended controls include:

```text
Least privilege

Parameterized queries

RLS

Constraints

Transactions

Controlled views

```

---

# 40. PostgreSQL RLS

Tenant-scoped relational data SHOULD use Row-Level Security.

Example:

```sql
CREATE POLICY tenant_isolation
ON invoices
USING (
    organization_id =
    current_setting('dsor.organization_id')::uuid
);

```

Request context SHOULD establish at least:

```text
dsor.organization_id
dsor.principal_id

```

RLS provides defense in depth.

It SHALL NOT replace DSoR authorization.

---

# 41. MCP Interface

MCP is the default AI-worker interface for the reference implementation.

```text
DSoR Operation
      ↓
MCP Tool

```

Example:

```text
invoice.get
      ↓
invoice_get

```

MCP SHALL NOT implement a separate business authorization model.

All authorization SHALL resolve through DSoR Core.

---

# 42. MCP 2026-07-28 Reference Binding

The reference implementation SHOULD target the MCP `2026-07-28` profile.

The reference binding SHALL assume the current stateless MCP core:

```text
each request is self-describing
no server-side MCP session is required for routing
server/discover is optional discovery
requests may be routed across stateless server instances
```

Gateways MAY use MCP method and tool-name request headers for routing, authorization prechecks, rate limiting, and observability, but final business authorization SHALL remain in DSoR Core.

## Authorization profile

Remote MCP deployments SHOULD use OAuth 2.1-compatible protected-resource authorization.

The reference profile SHOULD support:

```text
Protected Resource Metadata
issuer validation
resource-bound access tokens
PKCE where applicable
Client ID Metadata Documents (CIMD)
```

Dynamic Client Registration SHOULD NOT be treated as the preferred long-term client onboarding mechanism.

For the Better Auth reference implementation, the MCP binding SHOULD use the Better Auth MCP provider/protected-resource integration and the CIMD companion profile appropriate to MCP `2026-07-28`.

MCP authentication proves the caller's identity and token authority. It SHALL NOT replace DSoR tenant resolution, delegation evaluation, business authorization, approvals, or operation controls.

---

# 43. KSoR MCP and DSoR MCP

The two interfaces SHALL remain semantically distinct.

```text
KSoR
-------------------
search_knowledge
get_policy
get_procedure
get_concept
get_source

DSoR
-------------------
get_invoice
search_vendor
get_balance
propose_payment
execute_payment

```

MCP is the common protocol.

It does not collapse authority boundaries.

---

# 44. REST and SDK Interfaces

Additional interfaces MAY expose the same operations.

Example:

```text
DSoR operation:
invoice.get

MCP:
invoice_get

REST:
GET /invoices/{id}

SDK:
dsor.invoice.get(id)

```

All MUST invoke the same DSoR authorization and execution pipeline.

---

# 45. Events

DSoR SHOULD publish domain events.

Examples:

```text
invoice.created

invoice.issued

payment.proposed

payment.approved

payment.executed

```

Events SHOULD contain stable resource and correlation identifiers.

Event delivery MAY use:

```text
Webhooks
Kafka
NATS
Cloud event systems
Redis Streams

```

Transport is outside the normative domain model.

---

# 46. Audit

Every significant operation SHALL produce durable operational evidence.

Audit SHOULD capture:

```text
Timestamp

Tenant

Human principal

Agent principal

Delegation

Operation

Resource

Input metadata

Authorization decision

Control decision

KSoR authority reference

Approval

Connector

Execution result

Correlation identifiers

```

Example:

```yaml
audit_event:

  organization_id: org_123

  requester:
    id: user_456

  executor:
    id: accounts-payable-fte

  operation:
    payment.execute

  resource:
    uri: dsor://org_123/payment/PAY-789

  delegation:
    id: delegation_321

  approval:
    id: approval_555

  governing_rule:
    uri: ksor://org_123/finance/payment-policy

  result:
    status: success

```

---

# 47. Decision Bundle and Evidence Record

For consequential state-changing operations, DSoR SHOULD produce a structured decision bundle.

A decision bundle is not model chain-of-thought. It is a machine-readable record of the authoritative inputs and control outcomes used to permit or refuse an operation.

Recommended fields include:

```text
decision_id
timestamp
tenant
human_principal
agent_principal
delegation_id
operation_id
operation_version
resource_uris
resource_versions
freshness_evidence
authorization_result
control_results
KSoR authority references
approval_id
approval_payload_hash
idempotency_key
connector
execution_semantics
execution_result
correlation identifiers
```

Example:

```yaml
decision_bundle:
  decision_id: dec_123
  operation: payment.execute@1
  tenant: org_123

  authority:
    delegation: del_100
    ksor:
      - uri: ksor://org_123/finance/payment-policy
        version: 4

  state:
    invoice:
      uri: dsor://org_123/invoice/INV-1008
      version: 18
      observed_at: 2026-09-19T10:30:00Z

  approval:
    id: approval_555
    payload_hash: "sha256:..."

  execution:
    idempotency_key: idem_789
    connector: postgres
    semantics: non_compensatable
    result: committed
```

Audit and compliance systems SHOULD preserve structured decisions and evidence rather than requiring private model reasoning traces.

---

# 48. Intent → Decision → Execution → Evidence

Every consequential Digital FTE action SHOULD be understandable through four stages.

```text
INTENT
   │
   ▼
DECISION
   │
   ▼
EXECUTION
   │
   ▼
EVIDENCE

```

## Intent

What does the AI worker want to do?

## Decision

Is the action allowed under:

```text
Identity
Delegation
Tenant
Permissions
KSoR-governed rules
DSoR controls
Current state
Approvals

```

## Execution

What actual operation occurred?

## Evidence

What durable proof exists explaining:

```text
Who requested it
Who authorized it
Who approved it
What was executed
Why it was allowed
What happened

```

This is the core operational-control model for DSoR.

---

# 49. Shared Correlation Model

The complete Digital FTE stack SHOULD propagate:

```text
task_id

trace_id

session_id

organization_id

agent_id

principal_id

request_id

```

This enables reconstruction across:

```text
Agent Runtime
Context Store
KSoR
DSoR
Underlying systems

```

---

# 50. Context Provenance

Context derived from authoritative systems SHOULD retain provenance.

Example:

```yaml
context:
  value: "High value payments require approval."

  provenance:
    system: ksor
    uri: ksor://acme/finance/payment-policy
    version: 4
    retrieved_at: ...

```

Operational observation:

```yaml
context:
  value: "INV-1008 was unpaid."

  provenance:
    system: dsor
    uri: dsor://acme/invoice/INV-1008
    observed_at: ...

  authoritative_now: false

```

---

# 51. Revalidation

Material memory-derived facts SHALL be revalidated where current authoritative state matters.

```text
Memory:
"Invoice was unpaid yesterday."

        ↓

Agent needs current status

        ↓

DSoR:
invoice.get(...)

        ↓

status = PAID

```

---

# 52. Knowledge Promotion

Agent context SHALL NOT silently become organizational knowledge.

Promotion SHOULD follow:

```text
Agent observation
      ↓
Knowledge proposal
      ↓
Governance / Human review
      ↓
KSoR
      ↓
Authoritative knowledge

```

---

# 53. Operational Mutation

Agent memory SHALL NOT directly mutate authoritative business state.

Changes SHALL follow:

```text
Agent Intent
      ↓
DSoR Command
      ↓
Authorization
      ↓
Controls
      ↓
Approval if needed
      ↓
Connector
      ↓
System of Record

```

---

# 54. Experience Loop

Completed tasks MAY produce agent experience.

```text
Task
  ↓
Execution
  ↓
Outcome
  ↓
Experience Extraction
  ↓
Agent Context Store
  ↓
Future Retrieval

```

This provides persistent learning without requiring model-weight updates.

---

# 55. Freshness and Consistency Semantics

DSoR SHALL distinguish current authoritative reads from cached or observational context.

A query or command precondition SHOULD be able to declare a freshness requirement.

Recommended modes:

```text
CURRENT
BOUNDED_STALENESS
OBSERVATIONAL
CONNECTOR_DEFINED
```

Example:

```yaml
freshness:
  mode: bounded_staleness
  max_age_seconds: 30
```

For decisions involving money movement, access changes, legal status, approval state, inventory commitment, or other high-risk state, the operation SHOULD require CURRENT state unless the domain explicitly permits bounded staleness.

OpenViking observations of DSoR state SHALL be treated as observational context and revalidated when current state is material.

DSoR SHOULD expose the observation time and source version when available:

```text
observed_at
source_version
resource_version
connector
```

---

# 56. Versioning

DSoR SHALL version externally meaningful contracts.

At minimum:

```text
DSoR protocol version

Entity schema version

Operation version

Connector contract version

```

Example:

```text
payment.execute@1

payment.execute@2

```

Breaking changes SHALL require a new major operation or protocol version.

---

# 57. Reference Technology Profile

DSoR v1.1 defines architecture independently of vendors.

The recommended reference profile is:

```text
Language
→ TypeScript

Authentication
→ Better Auth / OAuth 2.1

Knowledge
→ KSoR

Context
→ OpenViking

Agent Interface
→ MCP 2026-07-28

MCP Authorization
→ OAuth 2.1 protected-resource profile + CIMD

Reference OAuth implementation
→ Better Auth MCP + CIMD binding

Operational Store
→ PostgreSQL

Database Isolation
→ PostgreSQL RLS

Application Authorization
→ DSoR

Audit
→ Durable append-oriented audit store

```

These technologies are defaults, not normative requirements.

---

# 58. Reference Vertical

The first implementation SHOULD be:

```text
Accounting DSoR

```

Initial entities:

```text
Organization

Customer

Vendor

PurchaseOrder

GoodsReceipt

Invoice

Payment

```

Initial operations:

```text
customer.get
customer.search

vendor.get
vendor.search

invoice.get
invoice.list
invoice.create
invoice.issue

payment.get
payment.propose
payment.approve
payment.execute

```

---

# 59. Reference Digital FTE

The primary example SHALL be:

```text
Accounts Payable FTE

```

Architecture:

```text
Accounts Payable FTE
│
├── Agent Runtime
│
├── KSoR
│    ├── payment policies
│    ├── procurement procedures
│    └── approval rules
│
├── OpenViking
│    ├── memories
│    ├── task experience
│    ├── resources
│    └── skills
│
└── DSoR
     ├── vendors
     ├── purchase orders
     ├── receipts
     ├── invoices
     └── payments

```

---

# 60. Complete Reference Workflow

A reference payment-run workflow is:

```text
Human
  │
  │ delegates authority
  ▼
Accounts Payable FTE
  │
  ├── OpenViking
  │      retrieve previous task experience
  │
  ├── KSoR
  │      retrieve current policies/procedures
  │
  ├── DSoR
  │      retrieve current operational state
  │
  ▼
Agent Reasoning
  │
  ▼
INTENT:
Propose vendor payment
  │
  ▼
DSoR DECISION:
  identity
  tenant
  delegation
  authorization
  controls
  current state
  │
  ▼
Approval Required?
  │
 ┌┴─────────────┐
 │              │
NO             YES
 │              │
 │          Human Approval
 │              │
 └──────┬───────┘
        │
        ▼
DSoR EXECUTION
        │
        ▼
Connector
        │
        ▼
System of Record
        │
        ▼
DSoR EVIDENCE
        │
        ▼
OpenViking
capture useful experience

```

---

# 61. Security Invariants

The following are mandatory architectural principles.

### The model is not a security boundary.

Prompts SHALL NOT substitute for authorization.

### Memory is not authoritative.

OpenViking or another context system SHALL NOT override KSoR or DSoR.

### Skills do not grant permissions.

Knowing how to perform an action SHALL NOT authorize it.

### MCP does not own authorization.

MCP SHALL invoke DSoR authorization.

### Connectors do not bypass DSoR.

Agent-accessible connectors SHALL operate through the governed DSoR execution path.

### External credentials SHALL NOT be exposed to the model.

Connector credentials, refresh tokens, private keys, database passwords, and similar secrets SHALL remain within trusted runtime or connector boundaries. The model SHOULD receive opaque capability references or operation results, not reusable infrastructure credentials.

### Retrieved content SHALL NOT grant authority.

Instructions embedded in retrieved knowledge, memory, resources, emails, database fields, or external API payloads SHALL NOT be able to expand permissions or bypass the active security context.

### Audit SHALL NOT require private model chain-of-thought.

DSoR SHOULD record structured decision evidence, policy/control outcomes, source references, and execution facts instead.

### High-risk operations SHOULD use approval binding.

### State-changing operations SHOULD be idempotent.

### Tenant isolation SHALL be enforced independently of agent behavior.

---

# 62. Conformance

A system claiming DSoR v1.1 conformance MUST implement:

```text
Principal model

Tenant model

Resource identity

Explicit operation contracts

Queries and commands

Authorization

Normalized errors

Audit

Connector abstraction

Freshness semantics for material state

Structured decision evidence for consequential commands

Versioning

```

A system supporting autonomous state-changing agents MUST additionally implement:

```text
Delegation

Idempotency

Concurrency handling

Execution semantics

Approval mechanisms where required

```

OpenViking, PostgreSQL, Better Auth, MCP, and KSoR are part of the reference profile and are not mandatory for basic protocol conformance.

---

# 63. Reference Stack

The recommended default Digital FTE stack is:

```text
┌────────────────────────────────────────────┐
│              DIGITAL FTE                   │
│                                            │
│           Agent Runtime / Harness          │
└───────────────┬────────────────────────────┘
                │
       ┌────────┼───────────┐
       │        │           │
       ▼        ▼           ▼
     KSoR   OpenViking     DSoR
       │        │           │
       │        │        Connectors
       │        │           │
       │        │    ┌──────┼─────────┐
       │        │    ▼      ▼         ▼
       │        │ Postgres  ERP      SaaS
       │        │
 KNOWLEDGE   CONTEXT     OPERATION
 AUTHORITY   MEMORY      AUTHORITY

```

Default responsibilities:

```text
KSoR
=
KNOW

OpenViking
=
REMEMBER

Agent Runtime
=
REASON

DSoR
=
STATE + ACT

```

---

# 64. Upstream Compatibility Baseline

This architecture baseline is aligned to the following upstream reference points as of **2026-09-19**:

```text
KSoR
→ one authoritative record
→ one governance boundary
→ many open projections
→ MCP as an agent projection
→ OAuth/OIDC for identity
→ provenance and observability as architectural concerns

OpenViking
→ context database for AI agents
→ Resource + Memory + Skill context model
→ viking:// addressing
→ hierarchical retrieval
→ progressive L0/L1/L2 context loading
→ session-derived persistent memory

MCP
→ 2026-07-28 reference profile
→ stateless protocol core
→ optional server/discover
→ method/name headers for infrastructure routing
→ authorization hardening
→ movement from DCR toward CIMD

Better Auth
→ MCP OAuth provider/protected-resource integration
→ resource-bound access tokens
→ protected-resource metadata
→ CIMD companion support for the MCP 2026-07-28 profile
```

These are reference bindings, not the durable authority model. DSoR SHALL remain evolvable as these upstream implementations and protocols change.

---

# 65. Final Architectural Principle

A governed Digital FTE SHALL distinguish:

> **what the organization knows,**

> **what the worker remembers,**

> **what the worker reasons,**

> **what is operationally true,**

> **and what the worker is authorized to change.**

KSoR governs organizational knowledge.

OpenViking is the default persistent context and experience system.

The Agent Runtime performs reasoning and orchestration.

DSoR governs operational state, authority, transactions, approvals, and evidence.

Together they form the foundational runtime architecture for governed enterprise AI workers.
