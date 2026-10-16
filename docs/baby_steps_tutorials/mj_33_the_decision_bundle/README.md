# Step 33 · The decision bundle

**New in this step:** for each decision about a command, DSoR seals one file of facts, the
*decision bundle*: who asked, under which slip, which rules ran at which version, which records it
read at which version, which rate it used, who approved, and how the call ended. What the agent
says about itself is kept apart, under `agent_asserted`, and no rule reads it.

## In plain words

A new clerk who pays a bill keeps one folder for it. The folder holds the request, the boss's
signature, the rate sheet the clerk used, and a note of each ledger page the clerk read, with the
page's number. The customer's own story, "I need this paid today", goes in a separate envelope,
marked "the customer says". The clerk never decides on what is in that envelope.

DSoR keeps that folder too. Since step 08 it writes one *record* for every call: a line in its
log. A record says what happened to one call. The *decision bundle* says why: it is the complete
file for one decision. It names the slip the agent ran under and the person who signed it. It
names each rule DSoR evaluated, with its version, its answer, and the policy it came from. It names
each record DSoR read, with the record's version, the time of the read, and how fresh the read was.
It names each conversion of money, with its rate, the rate's source, and its time. It names the
approvals DSoR counted, and how the call ended. Each of these is a fact that DSoR established
itself.

The agent may now say something about itself: the skill it used, its purpose, its reasons, and its
task. DSoR keeps those words in their own box, `agent_asserted`. It does not check them, and no
rule, limit, or permission ever reads them.

In this tutorial, a payment is a draft. PAY-901 is DSoR's record that VENDOR-44 is to be paid. No
step sends money yet, so "paid", in this README, means that a payment was drafted.

## Why it matters

Two weeks after Friday's payment, an auditor asks about PAY-901, 31,400.00 USD to VENDOR-44 for
INV-1008. Who allowed it? Under which rule? Who approved it? Was VENDOR-44 still approved when DSoR
paid? This was run on step 32's code before this step began. The agent drafted INV-1008, cfo_100
approved it, and the agent released it. The release's record says this, shortened:

```text
proposal.execute@1  ALLOW  ok
  delegation del_100, subject user_123, actor accounts-payable-fte
  controls: high-value-payment version 8, REQUIRE_APPROVAL, from ksor://org_456/finance/payment-approval-policy version 4
  resources: dsor://org_456/payment/PAY-901
```

The rule asked for an approval, and the call was allowed. The record does not say which approval
met the rule, or who gave it. It names no version of INV-1008 or of VENDOR-44: DSoR read both at the
release, and kept neither. So the auditor must join three records, the proposal's moves, and a row
of `dsor.approvals`, and still cannot prove what the release read.

The second danger is the agent's own words. The agent's runtime wants to send "weekly payment run"
and the skill it used. An investigator would want them. Step 32 refuses them:

```text
VALIDATION_FAILED: the request envelope may carry only token, tenant, request_id, idempotency_key, and mode, not "agent_asserted"
```

So the evidence loses them. The easy fix is the dangerous one: put the agent's words beside the
facts, where a rule or a reader can take them as true. Then an agent that writes "the CFO agreed by
phone" has written its own approval.

## The design, before any code

The circled numbers are lines of DSoR's checklist, §21 of the specification. Line ① finds who is
calling, line ③ the slip an agent runs under, line ⑤ checks the permission, line ⑦ claims the
idempotency key, line ⑧ makes the proposal, or, for a release, loads it. Line ⑨ reads the records
the contract binds, line ⑩ checks the rules and the limits, and line ⑪ writes the record.

Words this step uses:

- **A decision bundle, or a bundle.** One file of facts about one decision, in the shape of the
  specification's `decision-bundle.schema.json`.
- **To seal.** To write a bundle once, so that nothing can change it afterwards.
- **`agent_asserted`.** The box for what the agent says about itself. *Asserted* means "said to be
  true, without proof".
- **A record.** One line of DSoR's log, about one call (step 08). Its fields are those of the
  specification's `audit-record.schema.json`.
- **The envelope.** What travels beside a call's arguments: the login token, the company, the
  request id, the idempotency key, and the mode (step 05).
- **A replay.** A call that carries a key already claimed, with the same request. It gets the first
  call's answer, and nothing runs again (step 20).
- **A conversion.** An amount turned into another currency, with a sheet of rates (step 26). A
  sheet says how much of each currency one unit of its *base* buys. Tuesday's sheet has the base
  EUR: 1 EUR buys 1.0800 USD.
- **A freshness label.** What each read says about how fresh it is, such as `current` (step 15).
- **An approval.** One person's yes to one waiting request, in `dsor.approvals` (step 29).
- **The notebook of evidence.** What one call writes down as it goes through the checklist. Line
  ⑪ seals it into the bundle.

### How this step was made

The learner chose to build first and understand afterwards, as for steps 27 to 32: "maybe do 33 so
part 4 is done, then we do the full story in a better way". So every decision below is Claude
Code's, and each one says what it costs. The learner reviews them after the build. This folder is a
copy of step 32.

### What each rule says

- **DSOR-AUD-03a:** "For each consequential command DSoR MUST produce a decision bundle that
  validates against `decision-bundle.schema.json`"
  ([§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence)).
- **DSOR-AUD-03b:** "Audit and compliance evidence MUST NOT depend on private model reasoning
  traces" ([§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence)).
- **DSOR-AUD-06:** "Information supplied by the agent about itself — skill, rationale, purpose,
  task id — MUST be recorded under `agent_asserted`"
  ([§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence)).
- **DSOR-AUD-07:** "Agent-asserted information MUST NOT be an input to authorization or control
  evaluation" ([§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence)).
- **DSOR-MON-05:** "Every decision that used a conversion MUST record the rate, the rate source,
  and the rate timestamp in the decision bundle"
  ([§9](../../../specs/dsor/01-model.md#9-money-and-currency)).
- **Beside them:** DSOR-APR-03d from step 31, "record both versions in the decision bundle" when a
  rule has a new version at a release. DSOR-VER-01c, "Audit records and decision bundles MUST
  record the versions that applied". DSOR-EXE-03b from step 08: no evidence, no answer. And
  DSOR-AUD-04a from step 09: DSoR's own login cannot change or delete its evidence.

### Decisions (Claude Code's)

- **D1. Every decision about a command, from line ④ on, gets a bundle.** The specification says
  "each consequential command" and does not define the word. This tutorial reads it as every
  command, in every mode, with every outcome: a refusal, a dry run, a wait for the CFO, a prepared
  proposal, a replay, and a payment drafted. DSoR's own commands get one too: an approval, a
  release, a brake, a rule change, a sheet of rates. A query gets none. Nor does a call refused at
  lines ① to ③: until line ③ passes, DSoR does not know under whose authority the call asks, and a
  bundle must say it. Its record stands alone, as before. *Downside:* many bundles say little. A dry
  run's holds no booking, and a refusal at line ⑥ holds no rule and no read. And an agent refused
  at line ③, because its slip was torn up, leaves a record and no bundle.
- **D2. A bundle and its record are kept together, or neither is.** Line ⑪ writes both, in one
  transaction, before the answer leaves. The record names its bundle in the audit record's own
  field, `decision_bundle`. A bundle that does not validate against the schema is a bundle the
  store cannot take. In each case the caller hears `EVIDENCE_STORE_UNAVAILABLE`, as for a record
  since step 08 (DSOR-EXE-03b). *Downside:* §21 seals the bundle at line ⑰, after the work. In this
  tutorial the work runs inside line ⑨'s claim, before line ⑪, so the bundle sees how the work
  ended. Step 36 moves the work after the intent record, and the bundle may have to move with it.
- **D3. A bundle never changes.** A new table, `dsor.decision_bundles`, is append-only, like
  `dsor.audit`. DSoR's own login, `dsor_runtime`, may add a bundle and read one, in its own company
  only. It cannot update or delete one (DSOR-AUD-04a, which this tutorial reads as covering a
  bundle; DSOR-TEN-02a). The database gives each bundle its time, `sealed_at`, as it gives a record
  its time (step 09). In memory, the list is frozen. *Downside:* a bundle with a mistake stays
  wrong for ever. A correction would be a new record, which no step builds.
- **D4. Facts only, each from DSoR's own work.** Every field except `agent_asserted` comes from
  what DSoR did itself: who line ① found, the slip and the signer line ③ found, each rule line ⑩
  evaluated, each record line ⑨ read, each conversion line ⑩ made, the approvals the release
  counted, and how the call ended. The bundle holds no word from the model, and nothing from the
  call's arguments: the records they name appear as DSoR read them. *Downside:* the bundle does not
  repeat the request itself. The proposal keeps it, with its fingerprint.
- **D5. What line ⑨ read goes in `state`.** Each record line ⑨ read for the decision is listed as
  DSoR read it: its address, its version, the time of the read, and its freshness, in capitals, as
  the bundle's schema writes it. A vendor that the accounts system does not list is still named:
  DSoR looked, at a time, and found nothing, so the entry has no version. At a release, the reads
  are the release's own. *Downside:* only line ⑨'s reads are listed. A read that the company's code
  makes afterwards is not, because no decision was made on it.
- **D6. Each conversion the decision used is named once.** `money.conversions` names each amount
  that line ⑩ converted into another currency: `from`, the amount; `to`, the amount in the other
  currency, rounded up at the sixth decimal place, as a booking is (step 26); `rate`, how much of
  `to`'s currency one unit of `from`'s buys; `source`; and `as_of`, the time the source published
  the sheet (DSOR-MON-05). A comparison converts as Appendix B's comments in `src/cel.ts` say:
  `dsor_exceeds(a, b)` converts `a` into `b`'s currency, and `dsor_covers(a, b)` converts `b` into
  `a`'s. A limit converts the amount into the limit's currency. A decision that converted nothing
  has an empty list. So does one refused because no rate was usable: it converted nothing, and its
  record still names the currency and why (step 26). *Downside:* when neither currency is the
  sheet's base, the rate is a quotient of two lines of the sheet, and it may not end: GBP to USD on
  Tuesday's sheet is 1.0800 ÷ 0.8532 = 1.2658227848… The bundle writes it to at most twelve places,
  rounded half up, and keeps the sheet's own lines in this tutorial's extensions, so the exact
  answer can be worked out again.
- **D7. The approvals a release counted go in `satisfied_by` and `approval`.** At a release, each
  rule that asked for an approval names, in `satisfied_by`, the approvals that met it. `approval`
  names the first of them, the fingerprint they all bind, and every approver counted. A decision
  that counted no approval has no `approval`. *Downside:* the bundle's schema has room for one
  approval id, and this tutorial keeps one approval for each person (step 29, D7). With two
  approvers, `approval.id` names the first, and `satisfied_by` names both. And cfo_100's own call,
  `proposal.approve`, names no approval in its bundle. The approval it kept is in `dsor.approvals`,
  and in the release's bundle.
- **D8. A release's bundle names the request it decided.** At a release, once line ⑧ has loaded the
  proposal, the bundle's `operation` is the stored request's, such as `payment.create@1`, and so is
  `execution.semantics`. §26.4 decides a release "for the target command". The record still names
  the operation called, `proposal.execute@1`. *Downside:* a release's bundle and its record name two
  operations. The record's `decision_bundle` ties them together.
- **D9. `execution` says how the call ended, and no more than this step knows.** `result` is
  `committed` when the work ran and its proposal ended `COMMITTED`, `failed` when the work ran and
  refused, and `not_executed` for everything else: a refusal before the work, a wait for the CFO, a
  prepared proposal, a dry run, a replay, and an accident that the claim undid. `semantics` comes
  from the contract. `idempotency_key` is the proposal's id, the key of its execution
  (DSOR-IDM-04). The caller's own key goes in this tutorial's extensions. `connector`, `intent_at`,
  and `finalized_at` are left out: connectors are step 34's, and the intent record is step 36's.
  *Downside:* the bundle does not say when the work ran. The proposal's move records do.
- **D10. The agent's words have one field of the envelope.** The envelope may now carry
  `agent_asserted`, with at most the four fields §29 names: `skill`, with its `uri`, `version`, and
  `hash`, as §34.4 asks the agent's runtime to report them; `rationale`; `purpose`; and `task_id`.
  Each text has a bound: 2,000 characters for a rationale, 200 for a purpose, 128 for a task id, and
  512 for a skill's address. Line ① checks the shape and nothing else: DSoR does not verify one
  word. Any other field is refused with `VALIDATION_FAILED`, so the model's reasoning has no place
  to go (DSOR-AUD-03b). Only an agent's call may carry it. A person's call is refused the same way.
  *Downside:* the bounds are this tutorial's. A rationale of 2,001 characters is refused, and so is
  a rationale on two lines: a text may hold no control character, as a request id may not (step 09,
  decision 16).
- **D11. The agent's words are kept under `agent_asserted`, and nowhere else.** As sent, after line
  ①'s check: in the bundle's `agent_asserted`, and in the record's extensions under the same name,
  so a call with no bundle keeps them too (DSOR-AUD-06). No other field of either holds them: not
  the reason, not the identity. *Downside:* the agent may write a secret into its rationale, such
  as a bank account, and DSoR cannot tell. DSOR-AUD-05a's rule against raw `RESTRICTED` values
  cannot be kept for free text.
- **D12. No check reads the agent's words.** Line ① writes them into the notebook of evidence and
  hands them to nothing else: not line ③'s slip, line ⑤'s permission, line ⑦'s fingerprint, line
  ⑨'s preconditions, line ⑩'s rules and limits, or the masking of the answer (DSOR-AUD-07). A
  condition that names `agent_asserted` is refused when it is drafted and at start-up: it is not
  one of Appendix B's eight variables, and Appendix B says the box "is never part of the
  environment". *Downside:* a retry with the same key and new words is a replay. Its words are kept
  with its own record and bundle, and change nothing.
- **D13. The specification's schema, and this tutorial's extensions.** The schema, copied byte for
  byte into `schemas/`, checks every bundle before it is kept. What the schema has no field for
  goes under `extensions["org.panaversity.steps"]`, as in the record since step 10 (DSOR-SCH-02):
  the call's request id, the answer the caller heard, the mode, the caller's key and the call a
  replay repeats, the sheet's own lines, each refusing rule's reason, each stale rule's policy in
  force, and, at a release, the rule versions the request was decided under, `approved_under`
  (DSOR-APR-03d). Since step 28b, `superseded_version` names the policy version a stale rule
  cites, so the versions a request was decided under stay in `approved_under`, as in the record.
  *Downside:* a reader needs this tutorial's README to read the extensions.
- **D14. No operation reads a bundle yet.** The people who read evidence use SQL, as since step
  19b, and the tests read the stores. Reading audit must itself be authorized and audited
  (DSOR-AUD-05b), and no step builds that yet. *Downside:* an auditor needs access to the database.

### The story's numbers

| When | Who | Asks | DSoR answers | The bundle says |
|---|---|---|---|---|
| Tuesday | the agent, "weekly payment run" | drafts INV-1008, 31,400.00 USD | `PENDING_APPROVAL`, for the CFO | `not_executed`; `high-value-payment` version 8, `REQUIRE_APPROVAL`; INV-1008 and VENDOR-44, each at its version, `CURRENT`; the purpose under `agent_asserted` |
| Wednesday | cfo_100 | approves INV-1008 | `APPROVED` | `proposal.approve@1`, `committed`, in direct mode |
| Friday | the agent | releases INV-1008 | `COMMITTED`: PAY-901 | `payment.create@1`, `committed`; the rule `satisfied_by` cfo_100's approval; `approval` names it, its fingerprint, and cfo_100; INV-1008 and VENDOR-44 as the release read them |
| Tuesday | the agent | drafts INV-2002, 9,000.00 EUR | drafted | one conversion: 9,000.00 EUR to 9,720.00 USD at 1.08, from `ecb-daily`, as of Tuesday 14:00 |
| Tuesday | the agent, "the CFO agreed by phone" | drafts INV-1008 | `PENDING_APPROVAL`, as without the words | the words under `agent_asserted`, and every other field as without them |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | Every decision about a command from line ④ on has one bundle, named by its record, valid against the schema: every mode and outcome, DSoR's own commands too. A query and a refusal at lines ① to ③ have none (DSOR-AUD-03a) |
| C2 | A bundle names the facts: who asked and under which slip, each rule with its version, answer, and policy, each record line ⑨ read with its version, time, and freshness, how the call ended, and at a release the stored operation, the approvals counted, and the versions decided under (DSOR-AUD-03a, DSOR-APR-03d, DSOR-VER-01c) |
| C3 | A decision that converted names each conversion once, with its rate, source, and time; one that converted nothing, or found no usable rate, names none (DSOR-MON-05) |
| C4 | `agent_asserted`: its shape is checked at line ①; it is kept as sent, in the bundle and the record, and in no other field; a person's call and any other field are refused; a bundle without it is complete (DSOR-AUD-06, DSOR-AUD-03b) |
| C5 | The agent's words change no decision: the same answers, rules, limits, and fingerprint with any words; a condition that names them is refused when drafted and at start-up (DSOR-AUD-07) |
| C6 | On the database: a bundle and its record are kept in one transaction or not at all; `dsor_runtime` cannot change or delete a bundle, nor read another company's (DSOR-EXE-03b, DSOR-AUD-04a, DSOR-TEN-02a) |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. The bundle forgets what line ⑨ read | every bundle still validates, since the schema allows an empty `state`; the tests of C2 fail. The schema alone cannot prove a bundle complete | none: built first |
| B2. The rules read the agent's words | a rule that skips the CFO when the purpose says so can be drafted, and the agent that says so is paid without the CFO | none: built first |
| B3. The fingerprint includes the agent's words | a retry with the same key and new words hears `IDEMPOTENCY_CONFLICT` instead of the first call's answer | none: built first |
| B4. On the database, the bundle is written outside the record's transaction | when the bundle cannot be written, the record names a bundle that does not exist, and the caller hears success | none: built first |
| B5. The release forgets the approvals it counted | the release's bundle says the rule asked for an approval and names none: step 32's gap comes back | none: built first |

### Left open, and not this step's idea

- Owner-approval mode, and `sod_mode: owner_approval` (DSOR-SOD-11): owner approval is not built,
  so every bundle says `standard`.
- The connector of the work, the intent record, and the time the work was finalized: steps 34
  and 36.
- An operation that reads a bundle, authorized and audited (DSOR-AUD-05b).
- A chain of fingerprints across the log, so that nobody can quietly edit it: step 39.
- An outcome that is unknown, `outcome_unknown`: step 37.
