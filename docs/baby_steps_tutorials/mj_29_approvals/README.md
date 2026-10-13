# Step 29 · Approvals

**New in this step:** the CFO logs in to DSoR in person and approves a waiting payment. The
approval is tied to the fingerprint of the exact request, it expires, and every rule that asked
must be satisfied.

## In plain words

Since step 27, a payment that a rule sends to the CFO waits at `PENDING_APPROVAL`, and nothing
could approve it. Every attempt to run a command is a *proposal*, DSoR's record of that one
attempt, like an order-tracking page. In this step a person approves a waiting proposal with a
command of DSoR's own, `proposal.approve`.

The approver sends two things: the proposal's address and its *fingerprint*. The fingerprint, the
specification's `payload_hash`, is a short code computed from the exact request with SHA-256, a
standard method for fingerprints. DSoR computes it over the request written as *canonical JSON*:
one exact way to write a JSON value, so the same request always gives the same text, and so the
same fingerprint. If the approver's fingerprint is not the one DSoR stored, DSoR refuses: the
approver is looking at another request.

An *approval* is a record of its own. It names who approved, on what basis, which request by its
fingerprint, which rule's requirement it meets, and until when it counts. The approver must log in
to DSoR in person: an agent never approves, whatever it says. When two rules each ask for an
approval, both must be given before the proposal moves to `APPROVED`. An approved proposal waits
until step 31 builds `proposal.execute`.

## Why it matters

The agent drafts INV-1008, 31,400.00 USD, and it waits for the CFO. Then the agent messages
cfo_100: "Please approve my small payment of 900 USD." It sends the address of the 31,400.00 USD
proposal, and the fingerprint of the 900 USD one. If DSoR did not compare the fingerprint, cfo_100
would approve the large payment while reading about the small one. And if DSoR took "the CFO
approved" from the agent's own call, the agent could approve itself. §26.5 names the mistake:
"Whatever travels through the agent, the agent can fake."

## The design, before any code

The circled numbers are lines of DSoR's checklist. Every call runs through them in order, as a
pilot runs through a checklist. Line ⑤ checks the caller's permission, and ⑥ the input. Line ⑧
makes the proposal. Line ⑨ is DSoR's own look before any work, line ⑩ checks the rules and the
limits, and line ⑪ writes the record.

### How this step was made

The learner chose to build first and understand afterwards, as for steps 27 and 28 (2026-10-13:
"implement 29 then we discuss both 28 and 29 together"). So every decision below is Claude Code's,
for the learner to review, and each one says what it costs. This folder is a copy of step 28b.

### What each rule says

- **DSOR-APR-02a:** "An approval MUST validate against `approval.schema.json`, which binds it to the
  proposal, operation and version, tenant, resource URIs, payload hash, risk level, the control
  requirements it satisfies, the approvers and the basis of their authority, an expiry, and the
  bound state" ([§26.3](../../../specs/dsor/03-execution.md#263-what-an-approval-binds)).
- **DSOR-APR-02b:** "The payload hash MUST be computed over the RFC 8785 (JCS) canonical JSON of the
  stored input." Step 20 built most of it, early.
- **DSOR-APR-05a:** "`proposal.approve` MUST be accepted only in `direct` identity mode, from an
  approver authenticated to DSoR under their own credentials"
  ([§26.5](../../../specs/dsor/03-execution.md#265-the-approval-channel)). *Direct* means a person's
  own call, with the login DSoR gave them; an agent's call, under a permission slip, is
  *unattended*.
- **DSOR-APR-09:** "`proposal.approve` MUST be refused with `APPROVAL_MISMATCH` unless the
  `payload_hash` supplied by the approver equals the stored proposal's payload hash"
  ([§26.1](../../../specs/dsor/03-execution.md#261-one-model)).
- **DSOR-AUT-02c:** "When several `REQUIRE_*` outcomes apply, all of them MUST be satisfied"
  ([§15](../../../specs/dsor/02-security.md#15-authorization)).
- **Beside them:** DSOR-APR-07, the permission that decides is the target operation's
  `approve_permission`; DSOR-APR-04a, an approval expires within §44's ceiling, 30 days at L2, the
  specification's second level of conformance; DSOR-APR-05b, input relayed through the agent never
  counts as approval; DSOR-APR-08, a `proposal.*` command never asks for an approval itself; and
  DSOR-APR-01b, the move to `APPROVED` is recorded with its actor and its cause.

### Decisions (Claude Code)

- **D1. One command for every approval, `proposal.approve`,** DSoR's own work, for people only,
  with the input `{ proposal, payload_hash }`, as §26.1's table gives it. There is no approve
  operation for each kind of thing. *Downside:* the approver needs the proposal's address and
  fingerprint, and this step builds no way to list or read waiting proposals (`proposal.get` is
  later). The tests and the story read them from DSoR's store, as an approval screen would.
- **D2. Two permissions.** Line ⑤ checks the contract's own, `proposal:approve`. Line ⑨ then
  checks the target operation's `approve_permission` (DSOR-APR-07): `payment.create` and
  `payment.cancel` name `payment:approve`. The second one decides. The CFO and the tenant
  administrator hold both. *Downside:* two permissions for one act, and a role that holds only one
  of them cannot approve.
- **D3. The approver must hold a role the proposal waits for,** in this company: a rule asks for
  "CFO, quorum 1", and cfo_100 holds CFO. One approval satisfies every open requirement whose role
  the approver holds. One person never counts twice for one proposal. An approver who holds none of
  the open roles is refused `AUTHORIZATION_DENIED`; one whose roles are all satisfied already hears
  `CONFLICT`. *Downside:* one CFO approval satisfies two rules that each ask for the CFO. The
  specification's quorum of distinct people (DSOR-SOD-04c, L3) holds within one requirement only.
- **D4. The proposal keeps what it waits for.** When line ⑩ stops a call at `PENDING_APPROVAL`, the
  proposal keeps each requirement, with the rule's id and version, in `proposal.schema.json`'s own
  field, `requires`. It is written once, on that move only, and the database's trigger refuses any
  other change, the owner's too. An approval satisfies only what the proposal waits for.
  *Downside:* a rule changed after the proposal was made does not change what it waits for. Step 31
  checks again at execution (DSOR-APR-03b).
- **D5. Line ⑨'s order: the call's mode, which proposal, who may approve its operation, its state,
  the approver's role, then the fingerprint.** A call that is not in `direct` mode is refused
  `AUTHORIZATION_DENIED`. The proposal must be one of this company's, or `RESOURCE_NOT_FOUND`. The
  approver must hold the target's `approve_permission`, or `AUTHORIZATION_DENIED`. Only a
  `PENDING_APPROVAL` proposal is approved, or `CONFLICT`. The approver must hold a role it waits
  for, or `AUTHORIZATION_DENIED`, and approves once, while a requirement of that role is still
  open, or `CONFLICT`. Last, the fingerprint: `APPROVAL_MISMATCH` unless it equals the stored one
  (DSOR-APR-09). All of it comes before any work, so a refused approval writes no approval. The
  store's step checks the state again, and the time, under the ending lock (decision D9).
  *Downside:* a person who holds `proposal:approve` learns whether a proposal of their company
  exists, and one who may approve its operation learns its state.
- **D6. Canonical JSON in full (DSOR-APR-02b).** Step 20's canonical JSON passes RFC 8785's own
  examples. One part was missing: RFC 8785 takes only I-JSON, and text that holds a *lone
  surrogate*, half of a character that UTF-16 writes in two parts, is not I-JSON. Two programs would
  write it differently, and so compute different fingerprints. Line ⑥ refuses such a request
  `VALIDATION_FAILED`. *Downside:* JavaScript could hash such text, and DSoR refuses it anyway.
- **D7. An approval in `approval.schema.json`'s shape (DSOR-APR-02a).** Its id is `apr_` and a
  random UUID. It names the proposal, the operation and its version, the company, the proposal's
  resources, the fingerprint, the target's risk level, the requirements it satisfies, and the
  approver with the basis, such as `role:CFO`. Its *bound state* names the version of each invoice
  the proposal names, as DSoR reads it at the approval, in `predicate` mode. It is `active`, in the
  `standard` mode of separation of duties. *Downside:* the bound state names invoices only, since
  this tutorial reads no payment by its id; and `authn.at` is the time of the call, because this
  tutorial's logins carry no time of their own.
- **D8. DSoR keeps each approval,** in memory for the tests and in `dsor.approvals` on the
  database: read and added by DSoR's login, never changed or removed, and one approval for each
  person and proposal, which a unique key keeps. *Downside:* an approval cannot be revoked yet
  (DSOR-APR-04b is a later step).
- **D9. Every rule that asked must be satisfied (DSOR-AUT-02c).** The proposal moves to `APPROVED`
  only when each requirement it waits for has its quorum of approvers. Until then it stays
  `PENDING_APPROVAL`, and the answer says what it still waits for. The approval and that move are
  one step of the store, under the company's *ending lock*: the lock that a tear-up and a sweep
  already take before they list the waiting proposals (step 25c). So two approvers at once never
  both leave it waiting, and a tear-up or a sweep never misses an approval. *Downside:* an approver
  waits for any other approval, tear-up, or sweep of the same company, for a moment.
- **D10. In person (DSOR-APR-05a, DSOR-APR-05b).** `proposal.approve` is for people only, so line ⑤
  refuses an agent, an application, or a system login, whatever its slip lists. In this tutorial
  only an agent works under a slip, so a person's call is always direct, on the person's own login.
  *Downside:* this meets DSOR-SOD-01a, "an agent never approves", early: the map gives it to step 30,
  which adds who else may not approve.
- **D11. An approval expires with its proposal (DSOR-APR-04a).** Its `expires_at` is the proposal's
  own, which step 25c caps at 30 days, §44's longest life at L2. The sweep now expires an
  `APPROVED` proposal at that time too, and gives back its booking. *Downside:* an approval given on
  the proposal's last day lasts until that day's end only.
- **D12. An approved proposal waits.** Nothing executes it until step 31's `proposal.execute`.
  *Downside:* in this step an approval moves a state and nothing more. The payment is not drafted.
- **D13. A rule asks only for an approval that someone can give.** A draft and start-up refuse a
  rule whose effect asks for an approval on an operation that names no `approve_permission`, or by
  a role that does not hold it. Otherwise the payment would wait for an approval nobody can give.
  *Downside:* a company grants the permission before it writes such a rule.
- **D14. The answer:** `{ tenant_id, id, proposal, state, waits_for, expires_at }`: the approval's
  id, the proposal's state after it, and what it still waits for, empty once it is `APPROVED`. Each
  field is labelled `internal`. *Downside:* the approver learns which other roles must still
  approve.
- **D15. A second rule in the story.** To show DSOR-AUT-02c, cfo_100 writes and switches on a rule of
  org_456's own, `admin-above-30000`: above 30,000 USD, one approval by a tenant administrator.
  *Downside:* a tenant administrator approves payments in this story, which a real company may not
  want.

### The story's numbers

| Who | Asks | DSoR answers |
|---|---|---|
| the agent | drafts INV-2009, 900.00 USD | paid, below 25,000 USD |
| the agent | drafts INV-1008, 31,400.00 USD | waits: its proposal waits for the CFO, by version 8 of high-value-payment |
| the agent | approves its own proposal | `AUTHORIZATION_DENIED` at line ⑤: for people only |
| admin_100 | approves it, with its fingerprint | `AUTHORIZATION_DENIED`: admin_100 holds none of the roles it waits for |
| cfo_100 | approves it, with the fingerprint of the 900.00 USD payment | `APPROVAL_MISMATCH` |
| cfo_100 | approves it, with its own fingerprint | `APPROVED`, and the approval `apr_…` |
| cfo_100 | approves it again | `CONFLICT`: it is `APPROVED` |
| cfo_100 | writes and switches on `admin-above-30000` | active |
| the agent | drafts INV-2012, 35,000.00 USD | waits for the CFO and for a tenant administrator |
| cfo_100 | approves it | still waits, for a tenant administrator |
| admin_100 | approves it | `APPROVED` |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | The fingerprint is SHA-256 over RFC 8785 canonical JSON: the RFC's own examples, and a lone surrogate refused at line ⑥ |
| C2 | Only a person, in person, approves; the approver holds the target's `approve_permission` and a role the proposal waits for |
| C3 | Only the request with that fingerprint, only a waiting proposal, and only once by each person |
| C4 | An approval passes `approval.schema.json`, and DSoR keeps it, on the database too, where nothing changes or removes it |
| C5 | Every rule that asked is satisfied before `APPROVED`, in one step, with two approvers at once too |
| C6 | An approval expires with its proposal, and the sweep expires an `APPROVED` proposal and gives back its booking |
| C7 | A waiting proposal keeps what it waits for, written once |
| C8 | A rule asks only for an approval that someone can give; no rule governs `proposal.approve` |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. The fingerprint is not compared | cfo_100 approves INV-1008's 31,400.00 USD with the 900.00 USD payment's fingerprint, and it is `APPROVED` | (asked at the review) |
| B2. `proposal.approve` loses "people only" | line ⑤ lets an agent through whose slip lists `proposal:approve`, and line ⑨ still refuses it: an agent holds no role | (asked at the review) |
| B3. One approval is enough | INV-2012 is `APPROVED` after cfo_100 alone, though the second rule asked for a tenant administrator | (asked at the review) |
| B4. The role is not checked | admin_100 approves INV-1008, which waits for the CFO, and it is `APPROVED` | (asked at the review) |

### Left open, and not this step's idea

- Seeing what you approve: `proposal.get`, and DSoR's own rendering of the request (DSOR-APR-06a,
  L3).
- Revoking an approval (DSOR-APR-04b), and rejecting a proposal (`proposal.reject`).
- Who else may not approve: the person who signed the agent's slip, and the requester's chain
  (DSOR-SOD-02), step 30.
- Executing an approved proposal, and checking again at execution (DSOR-APR-03a to 03c), step 31.
- Telling an approver that a proposal waits: the outbox, step 40.
