---
status: draft
version: 1.4.0
date: 2026-09-20
part: 03-execution
---

# Part III — Execution

## 21. Command pipeline

**In plain words.** DSoR runs the same checklist for every command, in the same order, like a pilot before take-off. Two ideas matter most. First, write the decision down *before* answering, even when the answer is "no". Second, write "I am about to do X" *before* doing X. If the server dies halfway, the note proves that something may have happened, and [§25](#25-in-flight-exclusivity-unknown-outcomes-and-reconciliation) takes over.

**Why it matters.** If the log is written only after the action, a crash in between leaves money moved and no record. If refusals are not logged, you never see an agent probing for a weakness.

**Common mistake.** Writing the audit record at the end, inside a `finally` block. It is too late, and it misses the crash case completely.

Every consequential action is understood in four stages: **Intent** (what the worker wants to do), **Decision** (whether it is allowed), **Execution** (what actually occurred), and **Evidence** (durable proof of who requested, authorized, and approved it, what ran, why it was allowed, and what happened). Evidence is written around the side effect, never only after it.

```text
 1  Authenticate; build the request security context (identity mode)     ┐
 2  Resolve tenant                                                       │
 3  Resolve delegation; verify the actor chain; establish the            │
    subject's current authority (token or role source)                   │
 4  Check operational status (suspension, freeze, breaker)               │
 5  Authorize (permission, deny by default)                              │  DECISION
 6  Validate and canonicalize input; compute payload hash                │
 7  IDEMPOTENCY CLAIM — atomic; a replay returns the recorded status     │
 8  Create the proposal, or load it (proposal.execute)                   │
 9  Read bound state at the required freshness; evaluate                 │
    preconditions and in-flight exclusivity                              │
10  Evaluate controls, SoD, limits (reserve, keyed by proposal)          │
11  RECORD DECISION — always, including DENY                             ┘
12  Return here if a REQUIRE_* outcome is unsatisfied, or the mode is
    propose_only or validate_only
13  WRITE INTENT RECORD — durable, before any side effect                ┐
14  Concurrency check; execute through the connector                     │  EXECUTION
15  FINALIZE: COMMITTED | FAILED | OUTCOME_UNKNOWN                       ┘
16  Commit or release reservations and holds; enqueue events (outbox)    ┐  EVIDENCE
17  Seal the decision bundle                                             ┘
```

A `validate_only` invocation skips steps 7 and 8 and takes no reservation in step 10. Queries pass through steps 1–6 and 9, apply [§19](02-security.md#19-classification-and-read-side-governance), and reach step 11 where DSOR-CLS-05 applies.

**The rules**

- **[DSOR-EXE-01a · L1]** Commands MUST pass through the pipeline steps in the order given.
- **[DSOR-EXE-01b · L1]** An interface, connector, or operation MUST NOT skip a pipeline step that applies to it.
- **[DSOR-EXE-02 · L1]** The decision — outcome, controls evaluated, and the reason for any `DENY` — MUST be durably recorded before the response is returned.
- **[DSOR-EXE-03a · L2]** A durable intent record containing the proposal id, operation and version, payload hash, idempotency key, connector, and security context MUST be written before any side effect is attempted.
- **[DSOR-EXE-03b · L2]** If the control-plane store cannot accept the decision or intent record, DSoR MUST NOT execute; the caller receives `EVIDENCE_STORE_UNAVAILABLE`.
- **[DSOR-EXE-04a · L2]** Where the connector's store and the control-plane store share a transaction, the state change, the final outcome, and the outbox entry MUST commit atomically.
- **[DSOR-EXE-04b · L2]** An intent record with no final outcome MUST be treated as `OUTCOME_UNKNOWN`.

Denied and failed attempts are evidence, and they are often the most useful evidence.

## 22. Idempotency

**In plain words.** Networks fail and clients retry. Without protection, a retry of "pay 31,400" is a second payment. The caller attaches a unique *idempotency key*. DSoR saves the key together with a fingerprint of the request. Same key and same request: DSoR returns the earlier result and does nothing. Same key and a different request: DSoR refuses.

**Common mistake.** Checking "does this key exist?" and then inserting it, as two steps. Two identical requests arriving together both pass the check. Use a single insert protected by a unique constraint, and let the database pick the winner.

```text
same tenant + same caller + same operation + same idempotency key  =  same logical execution
```

**The rules**

- **[DSOR-IDM-01a · L2]** Every state-changing command in `execute` or `propose_only` mode MUST carry an idempotency key.
- **[DSOR-IDM-01b · L2]** The key MUST be claimed by an atomic insert scoped to (tenant, calling principal, operation, key) that stores the payload hash.
- **[DSOR-IDM-01c · L2]** A request whose key is already claimed with the same payload hash MUST return the recorded status or result without re-execution.
- **[DSOR-IDM-01d · L2]** A request whose key is already claimed with a different payload hash MUST be refused with `IDEMPOTENCY_CONFLICT`.
- **[DSOR-IDM-02 · L2]** Idempotency records MUST be retained for at least the minimum of [§44](06-conformance.md#44-operational-bounds).
- **[DSOR-IDM-03 · L3]** Where the connector declares downstream idempotency, DSoR MUST pass a key derived from its own idempotency key to the underlying system.
- **[DSOR-IDM-04 · L2]** A proposal MUST be executed at most once; the proposal id is the idempotency key of its execution.

A recorded `DENY` is replayed like any other result. After a human changes the permission or the control, the caller retries with a new key. A replay that now fails steps 3–5 because authority changed after the original execution returns that error; the recorded outcome stays readable through `proposal.get` by any principal authorized to read it.

## 23. Concurrency

**In plain words.** Two people edit the same record at the same time. With *optimistic concurrency* the caller says "I decided based on version 18." If the record has moved on, DSoR refuses with `STALE_STATE`, and the caller reads again and decides again.

Strategies: `optimistic`, `pessimistic`, `connector_managed`.

**The rules**

- **[DSOR-CON-01a · L2]** Every command MUST declare its concurrency strategy.
- **[DSOR-CON-01b · L2]** An optimistic command MUST return `STALE_STATE` when the resource version differs from the version the decision was made on.

`CONFLICT` is reserved for business-rule conflicts. `STALE_STATE` means "re-read and decide again".

## 24. Execution semantics

**In plain words.** Every command carries a label that answers one question: can this be undone? The agent and the people supervising it need that answer before acting, not after.

| Semantics | Meaning | Example |
|---|---|---|
| `ATOMIC` | Commits or does not, in one transaction | `journal.post` on the PostgreSQL connector; every `proposal.*` command |
| `COMPENSATABLE` | Can be reversed by a declared compensating operation | `payment.create` → `payment.cancel` |
| `SAGA` | Multi-step with declared compensations per step | `purchase_order.fulfil` |
| `BEST_EFFORT` | No guarantee; outcome reported as observed | `notification.send` |
| `NON_COMPENSATABLE` | Cannot be undone once executed | `payment.execute` |

**The rules**

- **[DSOR-EXE-05a · L2]** Every command MUST declare one of these execution semantics in its contract.
- **[DSOR-EXE-05b · L2]** Every command result MUST state the execution semantics that applied.
- **[DSOR-EXE-05c · L2]** A `COMPENSATABLE` or `SAGA` operation MUST name its compensating operations, which run under the full pipeline.

## 25. In-flight exclusivity, unknown outcomes, and reconciliation

**In plain words.** This is the hardest real-world problem in the document. You send "pay" to the bank and the connection drops. Did the payment happen? You do not know. Three rules: say "unknown" honestly; lock everything involved; let a lookup or a human find out. An agent never gets to guess.

### 25.1 In-flight exclusivity

**In plain words.** Only one attempt may be open on the same payment at a time. And when DSoR works out how much of an invoice is still unpaid, it counts payments that are waiting or in progress as already spent.

**Why it matters.** An agent is told "PAY-901 is locked." A helpful agent drafts PAY-902 for the same invoice. Without this rule the vendor is paid twice through a perfectly legal path.

A proposal is *in flight* while it is `READY`, `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`, or `OUTCOME_UNKNOWN`.

**The rules**

- **[DSOR-EXC-01 · L2]** While a proposal is in flight, a second proposal for the same operation over the same `exclusive_over` resource MUST be refused with `CONFLICT`, naming the existing proposal.
- **[DSOR-EXC-02 · L3]** A precondition over an available amount — an open balance, a credit limit, stock on hand — MUST count amounts committed to in-flight proposals as unavailable.

Under DSOR-EXC-02 the `open_amount` of INV-1008 already excludes PAY-901 while PAY-901 is in flight, so `dsor_covers(open_amount, amount)` fails for PAY-902.

### 25.2 Unknown outcomes

**In plain words.** If DSoR cannot tell whether the action happened, it reports exactly that. It must not report success, must not report failure, and must not return an error that invites a retry.

**Common mistake.** Mapping a timeout to a generic "temporary error, please retry". For a read that is fine. For sending money it is how double payments happen.

**The rules**

- **[DSOR-UNK-01a · L2]** If DSoR cannot establish whether a side effect occurred, the proposal MUST enter `OUTCOME_UNKNOWN`.
- **[DSOR-UNK-01b · L2]** DSoR MUST NOT report an unknown outcome as success, as failure, or with an error code whose retry class allows a new attempt.
- **[DSOR-UNK-02 · L2]** While a proposal is `OUTCOME_UNKNOWN`, a replay MUST return the current status without re-execution, unless the connector declares downstream idempotency.
- **[DSOR-UNK-03a · L3]** A `NON_COMPENSATABLE` operation MUST be routed only to a connector that declares downstream idempotency or outcome lookup.
- **[DSOR-UNK-03b · L3]** While a proposal is `OUTCOME_UNKNOWN`, DSoR MUST hold every resource named in the contract's `hold_on_unknown`; any other command that binds a held resource returns `RESOURCE_HELD`.

Where the connector declares downstream idempotency, DSoR MAY re-drive the same request with the same downstream key.

### 25.3 Reconciliation

**In plain words.** *Reconciliation* means finding out what really happened, by asking the bank's system using the idempotency key or by a human checking. Someone is alerted at once, and it escalates if nobody resolves it in time.

**The rules**

- **[DSOR-UNK-04a · L3]** A reconciliation process MUST resolve every `OUTCOME_UNKNOWN` proposal to `COMMITTED` or `FAILED` and record the evidence used.
- **[DSOR-UNK-04b · L3]** Each `OUTCOME_UNKNOWN` occurrence MUST raise an alert within the bound of [§44](06-conformance.md#44-operational-bounds).
- **[DSOR-UNK-04c · L3]** An occurrence unresolved after the bound of [§44](06-conformance.md#44-operational-bounds) MUST escalate to a human.
- **[DSOR-UNK-04d · L3]** An agent principal MUST NOT resolve an unknown outcome.

```text
EXECUTING ──timeout──▶ OUTCOME_UNKNOWN ──reconcile──▶ COMMITTED   (reservation committed, holds released)
                                       └────────────▶ FAILED      (reservation released, holds released)
```

## 26. Proposals and approvals

**In plain words.** Every attempt to run a command becomes a record called a *proposal*, with a state you can look up, like an order-tracking page. Approvals attach to the proposal.

### 26.1 One model

**In plain words.** There is one way to approve and one way to release, for every kind of command: `proposal.approve` and `proposal.execute`. These are ordinary commands, so they go through the full checklist too. The payload is stored once and can never be edited. To change it, you create a new proposal.

**Why it matters.** If the caller could send the payload again at execution time, it could send a different one than was approved. Since the stored payload is the only payload, that attack has nowhere to happen.

Every command invocation in `execute` or `propose_only` mode creates a proposal. There are no per-entity propose, approve, or execute operations. A pending command is moved forward by generic commands, which themselves run the full pipeline with their own caller, idempotency key, decision record, and audit.

| Operation | Kind | Caller | Input |
|---|---|---|---|
| `proposal.get`, `proposal.list` | query | anyone authorized to read the target | proposal URI or filter |
| `proposal.approve` | command | an approver, in `direct` mode | `{ proposal, payload_hash }` |
| `proposal.reject` | command | an approver | `{ proposal, reason }` |
| `proposal.revoke_approval` | command | the approver who approved | `{ proposal, reason }` |
| `proposal.cancel` | command | the requester or a tenant administrator | `{ proposal, reason }` |
| `proposal.execute` | command | the requester, or a human holding the target permission | `{ proposal }` |

**The rules**

- **[DSOR-APR-07 · L2]** The permission checked for `proposal.approve` MUST be the `approve_permission` of the target operation's contract.
- **[DSOR-APR-08 · L2]** A `proposal.*` command MUST NOT itself yield `REQUIRE_APPROVAL`.
- **[DSOR-APR-09 · L2]** `proposal.approve` MUST be refused with `APPROVAL_MISMATCH` unless the `payload_hash` supplied by the approver equals the stored proposal's payload hash.
- **[DSOR-APR-10 · L2]** `proposal.execute` MUST execute the stored canonical payload of the proposal.
- **[DSOR-APR-13 · L2]** `proposal.execute` MUST NOT accept a payload from its caller.
- **[DSOR-APR-11 · L2]** An agent principal MUST NOT execute a proposal that was created under a delegation other than its own.
- **[DSOR-APR-12 · L2]** A proposal's payload MUST NOT be modified after creation; a change is a new proposal that names the one it supersedes, and the superseded proposal moves to `CANCELLED`.

Because the payload cannot change and cannot be supplied at execution, "the approved payload differs from the executed payload" is prevented by construction and checked by hash only as an integrity control. A `proposal.*` command MAY yield `REQUIRE_STEP_UP_AUTHENTICATION`.

### 26.2 Lifecycle

**In plain words.** The picture shows every state a proposal can be in and every move between them. States on the right-hand edge are final. Once a proposal is `COMMITTED`, `FAILED`, `REJECTED`, and so on, it never moves again.

```text
PROPOSED ─▶ DENIED
PROPOSED ─▶ READY ─────────────────────────────┐
PROPOSED ─▶ PENDING_APPROVAL ─▶ APPROVED ──────┤
                │                  │           ▼
                │                  │       EXECUTING ─▶ COMMITTED
                │                  │           ├──────▶ FAILED
                │                  │           └──────▶ OUTCOME_UNKNOWN ─▶ COMMITTED | FAILED
                │                  └─▶ EXPIRED | REVOKED | INVALIDATED | CANCELLED
                └─▶ REJECTED | EXPIRED | CANCELLED

COMPENSATABLE and SAGA only:   COMMITTED | FAILED ─▶ COMPENSATING ─▶ COMPENSATED | COMPENSATION_FAILED
```

| State | Meaning |
|---|---|
| `READY` | Allowed without approval. In `execute` mode it proceeds at once; in `propose_only` mode it waits for `proposal.execute` |
| `REJECTED` | An approver declined |
| `EXPIRED` | The approval window, or the approval itself, lapsed |
| `CANCELLED` | Withdrawn, superseded, or its delegation was revoked or expired |
| `REVOKED` | An approver withdrew approval before `EXECUTING` |
| `INVALIDATED` | Re-evaluation at execution no longer supports the approval ([§26.4](#264-re-evaluation-at-execution)) |

**The rules**

- **[DSOR-APR-01a · L2]** Proposals MUST follow this state machine.
- **[DSOR-APR-01c · L2]** A proposal MUST NOT leave a terminal state.
- **[DSOR-APR-01b · L2]** Every proposal transition MUST be recorded with its actor and its cause.

### 26.3 What an approval binds

**In plain words.** An approval is tied to three things: the *exact* request (by its fingerprint), the *state of the world* when it was approved (by version numbers), and the *people* who approved. It also expires.

```yaml
approval:
  id: apr_555
  proposal: dsor://org_456/proposal/prop_123
  operation: payment.execute@1
  tenant: org_456
  resources: [dsor://org_456/payment/PAY-901, dsor://org_456/invoice/INV-1008, dsor://org_456/vendor/VENDOR-44]
  payload_hash: "sha256:…"               # over the RFC 8785 canonical JSON of the stored input
  risk: high
  bound_state:
    mode: predicate                      # predicate | strict_version
    versions: { "dsor://org_456/payment/PAY-901": 2, "dsor://org_456/invoice/INV-1008": 18, "dsor://org_456/vendor/VENDOR-44": 6 }
  satisfies: [ { control: high-value-payment, version: 8, requirement: { role: CFO, quorum: 1 } } ]
  approvers: [ { principal: cfo_100, basis: "role:CFO", authn: { acr: mfa, at: "2026-09-19T10:41:00Z" } } ]
  expires_at: 2026-09-20T10:41:00Z
```

**The rules**

- **[DSOR-APR-02a · L2]** An approval MUST validate against `approval.schema.json`, which binds it to the proposal, operation and version, tenant, resource URIs, payload hash, risk level, the control requirements it satisfies, the approvers and the basis of their authority, an expiry, and the bound state.
- **[DSOR-APR-02b · L2]** The payload hash MUST be computed over the RFC 8785 (JCS) canonical JSON of the stored input.
- **[DSOR-APR-04a · L2]** An approval MUST expire no later than the ceiling of [§44](06-conformance.md#44-operational-bounds).
- **[DSOR-APR-04b · L2]** An approval MUST be revocable by its approver until the proposal enters `EXECUTING`.

### 26.4 Re-evaluation at execution

**In plain words.** Hours can pass between approval and execution. At execution DSoR runs the checks again against live data. If the vendor has been suspended, or a stricter rule has appeared, the approval no longer counts and the proposal becomes `INVALIDATED`.

**Why it matters.** This class of bug has a name: *time of check to time of use*. What was true when you checked is not guaranteed to be true when you act.

`proposal.execute` runs steps 1–7 for its own caller, loads the proposal at step 8, and then runs steps 9 and 10 **for the target command** against `CURRENT` state. The reservation taken when the proposal was created is found again by proposal id.

**The rules**

- **[DSOR-APR-03a · L2]** Executing a proposal MUST re-evaluate the target command's preconditions, controls, segregation of duties, limits, delegation, and operational controls against `CURRENT` state.
- **[DSOR-APR-03b · L2]** Each `REQUIRE_APPROVAL` outcome of the re-evaluation MUST be satisfied by unexpired, unrevoked approvals on this proposal that meet the role and quorum the current evaluation demands.
- **[DSOR-APR-03c · L2]** A proposal MUST move to `INVALIDATED` without executing when a precondition fails, a re-evaluated requirement is unsatisfied, a new `REQUIRE_*` or `DENY` outcome appears, or the stored payload hash does not verify.
- **[DSOR-APR-03d · L2]** When a bound control has a new active version at execution, DSoR MUST evaluate the new version and record both versions in the decision bundle.
- **[DSOR-APR-03e · L3]** A `CRITICAL` operation MUST use `strict_version` binding, under which any change to a bound resource version or a bound control version invalidates the approval.

The caller of an invalidated proposal receives `APPROVAL_INVALIDATED` with the cause, and proposes again.

### 26.5 The approval channel

**In plain words.** An approval counts only if the approver logged in to DSoR themselves. "The CFO said yes", arriving through the agent, counts for nothing, however official it looks. The approver sees the payment as DSoR rendered it, not the agent's description of it.

**Common mistake.** Building approval as a chat message or a pop-up that travels through the agent's own connection. Whatever travels through the agent, the agent can fake.

**The rules**

- **[DSOR-APR-05a · L2]** `proposal.approve` MUST be accepted only in `direct` identity mode, from an approver authenticated to DSoR under their own credentials.
- **[DSOR-APR-05b · L2]** Input relayed through the requesting agent, its runtime, or its client MUST NOT count as approval evidence.
- **[DSOR-APR-06a · L3]** The approver MUST be shown a rendering of the stored payload and bound state that DSoR generates.
- **[DSOR-APR-06b · L3]** Agent-written summary or rationale shown to an approver MUST be labelled as unverified agent content.

The approver approves what DSoR will execute, not what the agent says it will execute.

## 27. Freshness and consistency

**In plain words.** Every answer says how old its data is. `CURRENT` means read from the real system just now. A cached value must never be labelled `CURRENT`. For money and access decisions DSoR insists on live data, and if it cannot get live data it refuses. It does not fall back to a cache.

| Mode | Meaning |
|---|---|
| `CURRENT` | Read from the system of record within this request |
| `BOUNDED_STALENESS` | No older than `max_age_seconds` |
| `OBSERVATIONAL` | Whatever is cached or remembered; carries no guarantee |
| `CONNECTOR_DEFINED` | The connector documents the guarantee |

**The rules**

- **[DSOR-FRS-01a · L1]** Every query result MUST state `observed_at`, the `resource_version` where one exists, the connector, and the freshness mode actually delivered.
- **[DSOR-FRS-01b · L1]** DSoR MUST NOT label a cached value `CURRENT`.
- **[DSOR-FRS-02a · L2]** Preconditions of `HIGH` and `CRITICAL` commands MUST be evaluated on `CURRENT` reads unless the contract explicitly permits bounded staleness.
- **[DSOR-FRS-02b · L2]** When the connector cannot deliver the required freshness, DSoR MUST return `FRESHNESS_UNSATISFIABLE` and not fall back to a cache.

Context-store observations of DSoR state are always `OBSERVATIONAL`.

## 28. Result and error envelopes

**In plain words.** Every answer from DSoR has the same outer shape. Every error also says whether a retry is safe, so the agent never has to guess. Notice that "this needs approval" is a normal *result*, not an error: nothing went wrong.

A command returns a result envelope (`result-envelope.schema.json`) or an error envelope (`error-envelope.schema.json`). Needing approval is a result, not an error.

```yaml
result:
  outcome: PENDING_APPROVAL            # COMMITTED | READY | PENDING_APPROVAL | VALIDATED
  proposal: dsor://org_456/proposal/prop_123
  payload_hash: "sha256:…"
  requires: [ { approval: { role: CFO, quorum: 1 }, control: high-value-payment } ]
  semantics: non_compensatable
  expires_at: 2026-09-20T10:41:00Z
  correlation: { request_id: req_1, trace_id: tr_9 }

error:
  code: OUTCOME_UNKNOWN
  message: "Payment submission timed out; outcome is being reconciled."
  retry: after_reconciliation          # safe_same_key | after_delay | after_state_refresh | after_reconciliation | never
  proposal: dsor://org_456/proposal/prop_123
  correlation: { request_id: req_2, trace_id: tr_9 }
```

| Code | Retry class |
|---|---|
| `AUTHENTICATION_REQUIRED` | never (re-authenticate) |
| `AUTHORIZATION_DENIED` | never |
| `DELEGATION_REQUIRED` · `DELEGATION_EXPIRED` · `DELEGATION_REVOKED` | never |
| `TENANT_MISMATCH` · `RESOURCE_NOT_FOUND` · `VALIDATION_FAILED` | never |
| `POLICY_DENIED` · `SOD_VIOLATION` | never |
| `LIMIT_EXCEEDED` | after_delay |
| `AGENT_SUSPENDED` · `OPERATION_FROZEN` | never (a human must lift) |
| `APPROVAL_REQUIRED` | never (obtain approval) |
| `APPROVAL_EXPIRED` · `APPROVAL_MISMATCH` | never (propose again) |
| `APPROVAL_INVALIDATED` | after_state_refresh (propose again) |
| `COOLING_OFF_ACTIVE` | after_delay |
| `CONFLICT` | never |
| `STALE_STATE` | after_state_refresh |
| `IDEMPOTENCY_CONFLICT` | never |
| `RESOURCE_HELD` · `OUTCOME_UNKNOWN` | after_reconciliation |
| `FRESHNESS_UNSATISFIABLE` · `RATE_LIMITED` | after_delay |
| `BATCH_PARTIAL` | per item |
| `CONNECTOR_UNAVAILABLE` · `TRANSACTION_FAILED` · `EVIDENCE_STORE_UNAVAILABLE` | safe_same_key |
| `DEPENDENCY_TIMEOUT` | safe_same_key — queries, and commands provably not executed, only |
| `UNSUPPORTED_CAPABILITY` | never |
| `INTERNAL_ERROR` | never for commands |

`APPROVAL_REQUIRED` is returned when `proposal.execute` is called on a proposal that is still `PENDING_APPROVAL`.

**The rules**

- **[DSOR-ERR-01a · L1]** Every error MUST validate against `error-envelope.schema.json`, carrying a code from this table or a documented extension code, a retry class, and correlation identifiers.
- **[DSOR-ERR-01b · L1]** An error MUST NOT reveal the existence or attributes of a resource the caller is not authorized to read.
- **[DSOR-ERR-02 · L1]** For a command, a connector error MUST NOT be mapped to a code with retry class `safe_same_key` unless the side effect provably did not occur.

## 29. Audit and decision evidence

**In plain words.** There are two kinds of record. The *audit log* is one line per event. The *decision bundle* is the complete file for one decision: which rules ran, which data versions were read, who approved, what happened. It records facts, not the AI's private reasoning. Anything the agent says about itself is kept in a separate box, `agent_asserted`, and is never trusted by a rule.

**Why it matters.** "The AI thought it was fine" is not evidence. "Control `high-value-payment` version 8 required the CFO, and `cfo_100` approved at 07:41" is.

**The rules**

- **[DSOR-AUD-01 · L1]** Every command decision, every proposal transition, and every read covered by DSOR-CLS-05 MUST produce a durable audit record that validates against `audit-record.schema.json`.
- **[DSOR-AUD-02a · L1]** Operational audit MUST NOT be stored only as agent memory.
- **[DSOR-AUD-02b · L1]** Deleting context MUST NOT delete audit, authoritative state, or KSoR records.
- **[DSOR-AUD-03a · L2]** For each consequential command DSoR MUST produce a decision bundle that validates against `decision-bundle.schema.json`.
- **[DSOR-AUD-03b · L2]** Audit and compliance evidence MUST NOT depend on private model reasoning traces.
- **[DSOR-AUD-06 · L2]** Information supplied by the agent about itself — skill, rationale, purpose, task id — MUST be recorded under `agent_asserted`.
- **[DSOR-AUD-07 · L2]** Agent-asserted information MUST NOT be an input to authorization or control evaluation.

Rejections at steps 1 and 2, before a tenant is known, MAY be recorded as aggregated counts, so that an unauthenticated flood cannot fill the audit store. Every decision from step 3 onward is recorded individually.

```yaml
decision_bundle:
  decision_id: dec_123
  operation: payment.execute@1
  proposal: dsor://org_456/proposal/prop_123
  tenant: org_456
  identity: { mode: unattended, subject: user_123, actor_chain: [accounts-payable-fte],
              subject_authority: { source: role_source, as_of: "2026-09-20T08:45:00Z" } }
  authority:
    delegation: del_100
    controls:
      - { id: high-value-payment, version: 8, outcome: REQUIRE_APPROVAL, satisfied_by: [apr_555],
          authority: { uri: "ksor://org_456/finance/payment-approval-policy", version: 4 } }
  money: { conversions: [] }             # payment already in the control currency
  state:
    - { uri: "dsor://org_456/payment/PAY-901", version: 2,  observed_at: "2026-09-20T09:00:00Z", freshness: CURRENT }
    - { uri: "dsor://org_456/invoice/INV-1008", version: 18, observed_at: "2026-09-20T09:00:00Z", freshness: CURRENT }
    - { uri: "dsor://org_456/vendor/VENDOR-44", version: 6,  observed_at: "2026-09-20T09:00:00Z", freshness: CURRENT }
  approval: { id: apr_555, payload_hash: "sha256:…", approvers: [cfo_100] }
  sod_mode: standard
  agent_asserted: { skill: { uri: "viking://agent/skills/vendor-payment", version: 3, hash: "sha256:…" }, purpose: "weekly payment run" }
  execution:
    idempotency_key: prop_123
    connector: postgres
    semantics: non_compensatable
    intent_at: "2026-09-20T09:00:00.120Z"
    result: committed
    finalized_at: "2026-09-20T09:00:00.480Z"
```

## 30. Audit integrity and retention

**In plain words.** The log is append-only. Each record includes the fingerprint of the record before it, forming a chain. Change or remove one old record and every fingerprint after it stops matching, so tampering is detectable. The account DSoR itself runs under has no permission to edit or delete log rows.

**The rules**

- **[DSOR-AUD-04a · L2]** The DSoR runtime identity MUST NOT be able to update or delete audit records.
- **[DSOR-AUD-04b · L2]** Audit records MUST be tamper-evident through hash chaining, signed checkpoints, or an equivalent mechanism.
- **[DSOR-AUD-04c · L2]** Where audit is partitioned into several chains, every record MUST belong to exactly one chain.
- **[DSOR-AUD-04d · L2]** Every audit chain MUST be covered by each checkpoint.
- **[DSOR-AUD-05a · L1]** Audit records MUST hold payload hashes and classification-aware renderings, not raw copies of `RESTRICTED` values.
- **[DSOR-AUD-05b · L1]** Reading audit MUST itself be authorized and audited.
- **[DSOR-AUD-05c · L1]** Audit retention MUST be policy-controlled and support legal and compliance holds.

Chains MAY be partitioned by tenant and shard so that audit is not a global serialization point. Implementations SHOULD anchor checkpoints outside the control-plane store.

## 31. Events

**In plain words.** Events are notifications for other systems, such as "payment executed". The *outbox pattern*: write the event into a table in the same database transaction as the change itself, and let a separate sender deliver it afterwards. That way you never have a change with no event, or an event with no change. Events may arrive twice, so receivers ignore an `event_id` they have already seen.

DSoR SHOULD publish domain events: `invoice.issued`, `payment.created`, `proposal.approved`, `payment.executed`. Transport is outside the normative model.

**The rules**

- **[DSOR-EVT-01a · L2]** Where events are published, they MUST be produced through a transactional outbox or an equivalent that ties the event to the recorded outcome.
- **[DSOR-EVT-01b · L2]** Every event MUST validate against `event.schema.json`, carrying a unique `event_id`, the resource URI, a per-resource ordering key, correlation identifiers, and `origin`.
- **[DSOR-EVT-01c · L2]** An event MUST NOT contain `RESTRICTED` field values.
- **[DSOR-EVT-01d · L2]** Event channels MUST be tenant-scoped.

Delivery is at-least-once; consumers deduplicate on `event_id`.

## 32. Correlation

**In plain words.** These are the ids that let you follow one action through five systems' logs. Pass them along on every call. If the caller sends none, DSoR creates a `request_id`.

**The rules**

- **[DSOR-COR-01a · L1]** DSoR MUST propagate `task_id`, `trace_id`, `session_id`, `tenant_id`, `agent_id`, `principal_id`, and `request_id` through connectors, audit, and events.
- **[DSOR-COR-01b · L1]** DSoR MUST generate a `request_id` when the caller supplies none.
