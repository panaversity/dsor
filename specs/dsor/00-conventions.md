---
status: draft
version: 1.3.1
date: 2026-09-19
part: 00-conventions
---

# Part 0 — Conventions

## 0.1 Requirement language

**In plain words.** A specification has to say which statements are hard rules and which are advice. Three capitalised words do that. `MUST` is a hard rule and a test will check it. `SHOULD` is strong advice: follow it unless you have a reason you could defend. `MAY` is permission. Only `MUST` rules get an identifier, and each identifier holds exactly one `MUST`, so one rule maps to one test.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all capitals.

A conformance requirement has an identifier, a level, and exactly one MUST or MUST NOT:

```text
[DSOR-<AREA>-<NN><letter> · <LEVEL>]
```

SHOULD and MAY statements are normative recommendations and permissions. They carry no identifier and are not part of a conformance claim. Sections marked *(informative)* contain no requirements. YAML in this document is a rendering of JSON for readability; the JSON Schemas in [Appendix A](appendix-a-schemas.md) define the wire format.

## 0.2 Conformance levels

**In plain words.** You do not have to build everything at once. The levels say how much freedom you give the agent. L1 is a supervised trainee. L2 works alone within limits. L3 is trusted with actions that cannot be undone. Each level includes the ones below it. RP and STACK are separate labels: RP means "I used the recommended tools", and STACK marks rules for the software *around* DSoR.

| Level | Claim | Applies when |
|---|---|---|
| **L1 Core** | Governed operational interface | Any system claiming DSoR conformance |
| **L2 Autonomous** | L1 + safe autonomous state change | AI workers change state without a human initiating each command |
| **L3 Financial/Critical** | L2 + irreversible-action safety | Any operation is `NON_COMPENSATABLE`, or rated `HIGH` or `CRITICAL` |
| **RP** | Reference Profile | The implementation claims the default stack bindings |
| **STACK** | Digital FTE stack | Requirements on the agent runtime and context store around DSoR; verified at stack level |

Levels are cumulative: L3 implies L2 implies L1. RP and STACK are independent of the L-levels.

## 0.3 Glossary

**In plain words.** These are the precise meanings used in the rules. If a word here is new to you, read "Words you need first" in the [Start here](../../docs/learn/start-here.md) chapter before this table.

| Term | Meaning |
|---|---|
| **Principal** | An authenticated human, agent, application, or system identity |
| **Tenant** | The organization that owns a set of resources, identified by an immutable `tenant_id` |
| **Subject** | The principal on whose behalf a request is made |
| **Actor chain** | The ordered principals acting for the subject (human → agent → sub-agent) |
| **Identity mode** | `on_behalf_of` (a present subject's token is exchanged) or `unattended` (the agent authenticates as itself and the subject comes from the delegation record) |
| **Delegation** | A DSoR-held record granting an agent bounded authority from a delegating principal |
| **Role source** | The tenant-configured authority for a principal's roles when that principal is not present in the request |
| **Operation** | A named, versioned query or command with a machine-readable contract |
| **Invocation mode** | `execute`, `propose_only`, or `validate_only` |
| **Control** | A versioned CEL-evaluable rule yielding `ALLOW`, `DENY`, or a `REQUIRE_*` outcome |
| **Authority reference** | A pointer (system, URI, version, content hash) to the governed source of a control. KSoR is the default system |
| **Proposal** | The record of one command invocation, moving through the lifecycle in [§26.2](03-execution.md#262-lifecycle) |
| **Intent record** | The durable record written before a side effect is attempted |
| **Decision bundle** | Structured evidence of the inputs and control outcomes for one decision. Never model chain-of-thought |
| **Control-plane store** | Persistence DSoR itself owns: delegations, controls, proposals, approvals, idempotency records, intent records, counters, holds, audit |
| **Connector** | The adapter between canonical operations and an underlying system of record |
| **Money** | `{ value: decimal string, currency: ISO 4217 code }` |
| **Consequential command** | A command rated `MEDIUM` or above, or one that is not `ATOMIC` within DSoR's own transaction |

## 0.4 Running example *(informative)*

**In plain words.** One company, one supervisor, one agent, one CFO, one invoice, one payment. Every example in the document uses these names and numbers, so once you know them you can read any example.

```text
Tenant            org_456            (display alias "acme" — never used in identifiers)
                                     control currency USD · rate source ecb-daily
Human             user_123           Accounts Payable supervisor
Agent             accounts-payable-fte
Delegation        del_100            user_123 → accounts-payable-fte · modes: on_behalf_of, unattended
                                     per-transaction 50,000 USD · daily 200,000 USD
Approver          cfo_100
KSoR policy       ksor://org_456/finance/payment-approval-policy   version 4
                  "Payments above 25,000 USD or equivalent require CFO approval."
Resources         dsor://org_456/vendor/VENDOR-44
                  dsor://org_456/invoice/INV-1008
                  dsor://org_456/payment/PAY-901      draft payment, 31,400.00 USD
```

## 0.5 Normative artifacts

**In plain words.** The shapes of the important JSON documents are not only described in English. They ship as JSON Schema files, so a program can check your output. If your JSON does not validate, you do not conform. The package includes a test you can run on day one.

**Why it matters.** Two teams who read the same English paragraph will build two slightly different JSON formats, and their systems will not talk to each other. A schema removes the guesswork.

**The rules**

- **[DSOR-SCH-01 · L1]** Every artifact named in [Appendix A](appendix-a-schemas.md) MUST validate against its JSON Schema (draft 2020-12) wherever it crosses an interface or is stored as evidence.
- **[DSOR-SCH-02 · L1]** An implementation that adds fields MUST place them under an `extensions` object keyed by a reverse-DNS namespace.
