---
status: draft
version: 1.3.1
date: 2026-09-19
part: 05-bindings
---

# Part V — Connectors and bindings

## 35. Connector contract

**In plain words.** A connector is the adapter between DSoR and one outside system. It must state honestly what that system can do. Does it support transactions? Will it refuse a duplicate if given an idempotency key? Can it be asked later whether a payment went through? DSoR uses those answers to decide which operations it may safely route there.

**Why it matters.** Other people and integrations often write to the same accounting system directly. Then DSoR's cached copy can be wrong at any moment, so such a connector is marked `shared`, and DSoR stops trusting its cache for anything important.

**Common mistake.** Putting the accounting system's API key where the agent, or the model, can read it. Credentials stay inside the connector.

```text
DSoR core ─▶ Connector contract ─▶ PostgreSQL · QuickBooks · Xero · Odoo · Salesforce · SAP · Workday · Custom API
```

```yaml
connector:
  id: xero
  contract_version: 1
  region: eu
  capabilities:
    transactions: false
    optimistic_concurrency: true         # native version or ETag
    downstream_idempotency: true
    outcome_lookup: true                 # find a side effect by idempotency key or reference
    events: true
    batch: false
    row_level_security: false
    freshness: [current, bounded_staleness]
  write_exclusivity: shared              # exclusive | shared
  change_detection: { method: webhook, max_detection_lag_seconds: 120 }
  external: true                         # drives the MCP openWorldHint
```

**The rules**

- **[DSOR-CNR-01a · L1]** Every connector MUST publish a declaration that validates against `connector.schema.json`.
- **[DSOR-CNR-01b · L1]** An operation MUST NOT be routed to a connector that lacks a capability the contract requires, unless the contract defines fallback semantics.
- **[DSOR-CNR-02 · L1]** Connector credentials, refresh tokens, private keys, and database passwords MUST NOT be exposed to the model or the agent runtime.
- **[DSOR-CNR-03a · L1]** Every connector MUST declare its `write_exclusivity`.
- **[DSOR-CNR-03b · L1]** For a `shared` connector, `resource_version` MUST derive from the native version, ETag, or a content hash, not from a DSoR-side counter.
- **[DSOR-CNR-03c · L1]** A `shared` connector MUST declare its change-detection method and maximum detection lag.
- **[DSOR-CNR-03d · L1]** Events caused by writes that did not pass through DSoR MUST be marked `origin: external`.
- **[DSOR-CNR-04 · L1]** A connector reachable by agents MUST be reachable only through the DSoR pipeline.

Deployments SHOULD restrict native write credentials so that agent paths cannot go around DSoR. DSoR evidence covers DSoR-mediated actions. With a `shared` connector, the audit trail of a business object is the union of DSoR audit and the underlying system's own log, and deployments SHOULD say this plainly to their auditors.

## 36. PostgreSQL reference connector

**In plain words.** *Row-level security* (RLS) makes PostgreSQL itself filter rows by tenant, so even a buggy query cannot return another company's data. There are two traps. The table owner bypasses RLS unless you `FORCE` it. And with connection pooling, a tenant setting made per connection leaks into the next request that reuses the connection, so set it per transaction.

Roles: `dsor_runtime`, `dsor_migration`, `dsor_admin`. Controls: least privilege, parameterized queries, RLS, constraints, transactions, controlled views.

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE  ROW LEVEL SECURITY;      -- applies to the table owner too

CREATE POLICY tenant_isolation ON invoices
USING (tenant_id = current_setting('dsor.tenant_id', true));   -- unset → NULL → no rows

BEGIN;                                               -- per transaction, never per connection
SELECT set_config('dsor.tenant_id',    $1, true);    -- true = transaction-local
SELECT set_config('dsor.principal_id', $2, true);
-- … operation …
COMMIT;
```

**The rules**

- **[DSOR-RP-01a · RP]** `dsor_runtime` MUST NOT be a superuser, hold `BYPASSRLS`, or own tenant tables.
- **[DSOR-RP-01b · RP]** Tenant tables MUST use `FORCE ROW LEVEL SECURITY`.
- **[DSOR-RP-01c · RP]** The tenant setting MUST be transaction-local.
- **[DSOR-RP-01d · RP]** A query executed with no tenant setting MUST yield no rows.

RLS is defense in depth. It does not replace DSoR authorization.

## 37. Identity binding

**In plain words.** This is how the identity modes of [§13.2](02-security.md#132-identity-modes-on-the-wire) look in real OAuth tokens. In `on_behalf_of` the token says "this is `user_123`, and `accounts-payable-fte` is acting for them." In `unattended` the agent proves who it is with a private key, never a shared password, and the token names only the agent.

**The rules**

- **[DSOR-RP-02a · RP]** Remote deployments MUST publish Protected Resource Metadata (RFC 9728).
- **[DSOR-RP-02b · RP]** DSoR MUST reject an access token whose audience or resource (RFC 8707) is not this DSoR deployment.
- **[DSOR-RP-02c · RP]** Clients MUST validate the issuer per RFC 9207.
- **[DSOR-RP-02e · RP]** Public clients MUST use PKCE.
- **[DSOR-RP-02d · RP]** Dynamic Client Registration MUST be disabled by default; clients are identified with Client ID Metadata Documents (CIMD).

**`on_behalf_of` mode**

- **[DSOR-RP-03 · RP]** In `on_behalf_of` mode the subject and actor chain MUST be conveyed with OAuth 2.0 Token Exchange (RFC 8693): `sub` identifies the subject and nested `act` claims identify each actor.

```json
{ "iss": "https://auth.example.com", "aud": "https://dsor.example.com",
  "sub": "user_123", "act": { "sub": "accounts-payable-fte" },
  "tenant_id": "org_456", "delegation_id": "del_100",
  "scope": "invoice:read vendor:read payment:create payment:execute" }
```

**`unattended` mode**

- **[DSOR-RP-10 · RP]** In `unattended` mode the agent MUST authenticate with an asymmetric credential — `private_key_jwt` (RFC 7523) or mutual TLS (RFC 8705) — never a shared secret.
- **[DSOR-RP-11 · RP]** An `unattended` access token MUST identify the agent as `sub` and carry no subject claim for a human; DSoR takes the subject from the delegation record (DSOR-DEL-08).

```json
{ "iss": "https://auth.example.com", "aud": "https://dsor.example.com",
  "sub": "accounts-payable-fte", "client_id": "https://agents.example.com/ap-fte.json",
  "tenant_id": "org_456", "delegation_id": "del_100",
  "cnf": { "jkt": "…" },
  "scope": "invoice:read vendor:read payment:create payment:execute" }
```

Unattended tokens SHOULD be sender-constrained with DPoP (RFC 9449) or mutual TLS, and SHOULD be short-lived. The token MAY carry `delegation_id`; whether or not it does, DSoR resolves the delegation from its own store.

`REQUIRE_STEP_UP_AUTHENTICATION` SHOULD be signalled with the OAuth step-up challenge (RFC 9470), naming the required `acr` value. For the Better Auth reference implementation, the binding uses the Better Auth MCP protected-resource integration with the CIMD plugin and its `mcp-2026-07-28` metadata profile. Authentication proves identity and token authority. It never replaces tenant resolution, delegation evaluation, authorization, controls, or approvals.

## 38. MCP binding

**In plain words.** MCP (Model Context Protocol) is the standard way AI agents discover and call tools. Each DSoR operation becomes one MCP tool.

MCP is the default AI-worker interface. The reference binding targets MCP `2026-07-28`: each request is self-describing, there is no protocol session, `server/discover` is optional, and any request can land on any instance. This suits DSoR, which keeps all cross-request state in its control-plane store and hands the model explicit handles — proposal URIs — instead of hidden session state.

### 38.1 Tool naming and catalogs

**In plain words.** Tool names are produced mechanically from operation ids, so nobody has to invent or guess them. An agent is shown only the tools it is allowed to use.

**The rules**

- **[DSOR-RP-04 · RP]** An MCP tool name MUST be the operation id with `.` replaced by `_`: `invoice.get` → `invoice_get`, `proposal.execute` → `proposal_execute`.
- **[DSOR-RP-05a · RP]** `tools/list` MUST return only the operations inside the caller's effective authority.
- **[DSOR-RP-05b · RP]** The cache scope of a filtered catalog MUST prevent it from being shared across principals.

The invocation mode ([§7.3](01-model.md#73-invocation-modes)), the idempotency key, and `expected_version` are ordinary tool arguments. A full vertical has hundreds of operations, and a catalog that large degrades tool selection. Deployments SHOULD expose domain-scoped endpoints (`/mcp/ap`, `/mcp/ar`, `/mcp/gl`) and keep each catalog to a few dozen tools. A search tool that returns operation names MAY be offered; invocation still goes through the per-operation tool, so that header-based routing, annotations, and audit stay precise. A generic `dsor_invoke(operation, args)` tool SHOULD NOT be offered.

### 38.2 Annotations

**In plain words.** MCP tools carry hints such as "read-only" and "destructive". If you leave a hint out, MCP assumes the worst. So set all four on every tool. They are hints for the client's user interface. They are never a security control.

MCP hints default pessimistically: an unset `destructiveHint` means *true*, and an unset `readOnlyHint` means *false*. Every hint is therefore set explicitly, from the contract.

| Hint | Value |
|---|---|
| `readOnlyHint` | `true` for queries; `false` for commands |
| `destructiveHint` | `true` when `effect: destructive` or semantics are `NON_COMPENSATABLE` or `BEST_EFFORT`; otherwise `false` |
| `idempotentHint` | `true` when the contract requires an idempotency key |
| `openWorldHint` | `true` when the connector declares `external: true`; otherwise `false` |

**The rules**

- **[DSOR-RP-06a · RP]** Every tool MUST set all four hints explicitly, derived from the operation contract by the table above.
- **[DSOR-RP-06b · RP]** A DSoR control MUST NOT depend on a client honoring a hint.

Risk level and execution semantics SHOULD be published in tool `_meta`.

### 38.3 Approvals, long waits, and MRTR

**In plain words.** MCP has a feature that lets a tool ask a question in the middle of a call. It looks perfect for approvals, and it is a trap. The answer comes back through the agent's own connection, so the agent could write the answer itself. Use it for missing details. Never use it for approval.

**The rules**

- **[DSOR-RP-07a · RP]** A `PENDING_APPROVAL` outcome MUST be returned as a structured, non-error tool result carrying the proposal URI.
- **[DSOR-RP-07b · RP]** The `proposal_get` tool MUST be available to every principal that can invoke a command.

Where the client supports the `io.modelcontextprotocol/tasks` extension, DSoR MAY also return a task handle for polling through `tasks/get`. The proposal resource is authoritative; the task is a convenience over it.

- **[DSOR-RP-08 · RP]** MRTR input MUST NOT be accepted as approval evidence or as step-up authentication.

MRTR MAY be used to collect missing parameters and the requester's own confirmation. Approvers call `proposal_approve` in `direct` mode, from an approval UI or from their own MCP or REST client under their own token.

### 38.4 Routing headers

**In plain words.** MCP requests carry the tool name in an HTTP header so gateways can route quickly. DSoR makes its decision from the request body and rejects a request whose header and body disagree.

**The rules**

- **[DSOR-RP-09a · RP]** DSoR core MUST authorize on the parsed request body, not on the `Mcp-Method` or `Mcp-Name` headers.
- **[DSOR-RP-09b · RP]** A request whose routing headers and body disagree MUST be rejected.

Gateways MAY use the headers for routing, rate limiting, prechecks, and observability. A gateway precheck is never a final decision.

### 38.5 KSoR MCP and DSoR MCP

**In plain words.** KSoR and DSoR each expose their own MCP server. Sharing a protocol does not merge their jobs.

The two servers stay semantically distinct. MCP is a shared protocol; it does not merge authority boundaries.

```text
KSoR (defined by the KSoR specification)      DSoR (derived from operation ids)
search_knowledge · get_policy · get_source    invoice_get · vendor_search · payment_create · payment_execute ·
                                              proposal_get · proposal_approve · proposal_execute
```

The Enterprise-Managed Authorization extension MAY be used where the tenant's identity provider governs which MCP servers its users and agents may reach.

## 39. REST and SDK interfaces

**In plain words.** MCP is for agents. REST and SDKs are for applications and people. All of them enter the same checklist. There is no side door.

```text
Operation  invoice.get      MCP  invoice_get      REST  GET /invoices/{id}      SDK  dsor.invoice.get(id)
```

All of them invoke the same pipeline (DSOR-OPR-04a). The invocation mode, idempotency key, expected version, and correlation identifiers have one canonical representation per interface, documented by the implementation.

## 40. OpenViking binding

**In plain words.** How the default notebook, OpenViking, maps onto the three context categories of [§33](04-context.md#33-the-context-store).

```text
OpenViking Resource → contextual reference material
OpenViking Memory   → persistent non-authoritative experience
OpenViking Skill    → reusable agent capability

viking://resources/...            shared reference resources
viking://user/{user_id}/...       user-scoped context
viking://~/memories/...           the authenticated user's memory alias
viking://~/skills/...             the authenticated user's skills alias
viking://agent/skills/...         shared agent capabilities, when enabled
```

The adapter SHOULD keep OpenViking's native `viking://` identifiers and scope boundaries and SHOULD NOT invent a parallel addressing scheme. It MAY use progressive (L0/L1/L2) loading and hierarchical retrieval. Material stored in OpenViking does not become authoritative by being stored there; material that must govern behavior SHOULD be promoted into KSoR or referenced from it. Under DSOR-CTX-05c, skills under `viking://~/skills/` are user-scoped and cannot drive `HIGH` or `CRITICAL` operations.

## 41. Reference profile, vertical, and workflow *(informative)*

**In plain words.** The recommended toolkit on one page, the first business area to build, and the payment story from the [Start here](../../docs/learn/start-here.md) chapter, this time with every identifier filled in.

```text
Language               TypeScript
Authentication         OAuth 2.1 / OIDC — Better Auth (MCP protected resource + CIMD)
Identity modes         on_behalf_of: RFC 8693 token exchange · unattended: private_key_jwt + DPoP
Role source            SCIM directory synchronization
Knowledge authority    KSoR
Expression language    CEL
Context                OpenViking
Agent interface        MCP 2026-07-28 (stateless core; Tasks extension optional)
Operational store      PostgreSQL, RLS forced
Control-plane store    PostgreSQL — same cluster, so DSOR-EXE-04a atomic commit applies
Rate source            ECB daily reference rates
Audit                  Append-only, hash-chained per tenant shard, checkpoints anchored externally
Events                 Transactional outbox
```

**Reference vertical: Accounting DSoR.** Entities: Organization, Customer, Vendor, PurchaseOrder, GoodsReceipt, Invoice, Payment, PaymentRun, Proposal. Operations: `customer.get`, `customer.search`, `vendor.get`, `vendor.search`, `invoice.get`, `invoice.list`, `invoice.create`, `invoice.issue`, `payment.get`, `payment.create`, `payment.cancel`, `payment.execute`, `payment_run.create`, `payment_run.execute`, and the generic `proposal.*` set of [§26.1](03-execution.md#261-one-model).

**Reference Digital FTE: Accounts Payable FTE — the nightly run, unattended.**

```text
user_123 ── delegates (del_100, modes include unattended) ──▶ accounts-payable-fte

IDENTITY    agent authenticates as itself (private_key_jwt); DSoR takes subject user_123 from del_100
            role source confirms user_123 still holds AP-supervisor, as of 08:45                → authority current
CONTEXT     OpenViking: earlier run experience (data, never instruction) · KSoR: payment-approval-policy v4
STATE       invoice_get INV-1008, vendor_get VENDOR-44                  (CURRENT, masked per egress policy)

INTENT 1    payment_create  → PAY-901, 31,400.00 USD, INV-1008 → VENDOR-44      COMPENSATABLE · ALLOW · COMMITTED
INTENT 2    payment_execute { payment: PAY-901 }, mode: execute, key idem_789
DECISION    claim idem_789 · create prop_123 · preconditions hold · no other proposal in flight over PAY-901
            31,400 USD ≤ 50,000 USD per-transaction limit                       → within delegation
            daily reservation 31,400 of 200,000 USD, keyed prop_123             → reserved
            dsor_exceeds(31,400 USD, 25,000 USD) — high-value-payment v8        → REQUIRE_APPROVAL(CFO)
            decision recorded                                                   → PENDING_APPROVAL
APPROVAL    cfo_100, direct mode, calls proposal_approve { prop_123, payload_hash }
            sees the DSoR-rendered payload and bound state; hash matches
            cfo_100 is not in the chain [user_123 → accounts-payable-fte]       → APPROVED, apr_555
EXECUTION   agent calls proposal_execute { prop_123 }
            re-evaluation on CURRENT state: VENDOR-44 approved, INV-1008 issued, open amount covers it,
            control still v8, apr_555 satisfies CFO×1, reservation found by prop_123 (not taken twice)
            intent record → connector executes with downstream key → COMMITTED
            (on timeout: OUTCOME_UNKNOWN → PAY-901 and INV-1008 held → reconciliation → COMMITTED | FAILED)
EVIDENCE    reservation committed · payment.executed event via outbox · decision bundle dec_123 sealed
LEARNING    OpenViking records the experience; tainted flag set if untrusted content was in the task
```

## 42. Upstream compatibility baseline *(informative)*

**In plain words.** The versions of outside standards and tools this document was checked against, and the date.

Aligned to these upstream reference points as of **2026-09-19**:

```text
KSoR         one authoritative record · one governance boundary · many open projections ·
             MCP as an agent projection · OAuth/OIDC identity · provenance and observability
OpenViking   context database for agents · Resource + Memory + Skill · viking:// addressing ·
             hierarchical retrieval · progressive L0/L1/L2 loading · session-derived memory
MCP          2026-07-28 · stateless core, no initialize handshake, no Mcp-Session-Id ·
             optional server/discover · Mcp-Method and Mcp-Name routing headers ·
             Multi Round-Trip Requests · cacheable list results (ttlMs, cacheScope) ·
             tool annotations with pessimistic defaults · extensions framework
             (Tasks, MCP Apps, Enterprise-Managed Authorization) · RFC 9207 issuer validation ·
             DCR deprecated in favor of CIMD · twelve-month minimum deprecation window
Better Auth  MCP protected-resource integration · resource-bound tokens ·
             protected-resource metadata · CIMD plugin with an mcp-2026-07-28 metadata profile
CEL          Common Expression Language — non-Turing-complete, side-effect free, typed
```

These are bindings, not the authority model. DSoR stays evolvable as they change.
