# Step 33 · The decision bundle

**New in this step:** for each decision about a command, DSoR seals one case file of facts, the
*decision bundle*. What the agent says about itself goes in a box of its own, `agent_asserted`,
and no rule reads it.

## In plain words

In start-here's story, the agent is a new clerk, and DSoR is the company's desk that checks each
request and keeps the logbook. Now the desk keeps one folder for each decision too. The folder holds
the boss's signature, the rate sheet the desk used, and a note of each ledger page the desk read,
with the page's version number. What the clerk says about the job, "this is the weekly payment
run", goes in a separate box, marked "the clerk says". The desk never decides on what is in that
box.

Since step 08, DSoR writes one *record* for every call: a line in its log, which says what happened
to the call. The *decision bundle* is the folder: one case file for one decision, kept as one JSON
document. It names who asked, under which slip, and each rule DSoR evaluated, with its version. It
names each invoice and vendor DSoR read to decide, with its version, the time of the read, and how
fresh the read was. It also names each conversion of money, the approvals DSoR counted, and how the
call ended. DSoR established each of these facts itself.

The agent may now say something about itself: the skill it used, its purpose, its reasons, and its
task. DSoR keeps those words in their own box, `agent_asserted`. It checks only their shape, never
whether they are true. No rule, limit, or permission ever reads them.

In this tutorial, a payment is a draft. PAY-901 is DSoR's record that VENDOR-44 is to be paid. No
step sends money yet, so "paid", in this README, means that a payment was drafted.

## Why it matters

Two weeks after Friday's payment, an auditor asks about PAY-901, 31,400.00 USD to VENDOR-44 for
INV-1008. Who allowed it? Under which rule? Who approved it? Was VENDOR-44 still approved when DSoR
paid? Claude Code ran this on step 32's code before this step began. The agent drafted INV-1008,
cfo_100 approved it, and the agent released it with `proposal.execute` (step 31). The release's
record says this, shortened:

```text
proposal.execute@1  ALLOW  ok
  delegation del_100, subject user_123, actor accounts-payable-fte
  controls: high-value-payment version 8, REQUIRE_APPROVAL, from ksor://org_456/finance/payment-approval-policy version 4
  resources: dsor://org_456/payment/PAY-901
```

The rule asked for an approval, and the call was allowed. The record does not say which approval
met the rule, or who gave it. It names no version of INV-1008 or of VENDOR-44: DSoR read both at the
release, and kept neither. So the auditor must put together the three calls' records, the
proposal's move records (step 22), and cfo_100's row in `dsor.approvals`. Even then, nothing proves
which versions the release read.

Money has the same gap. On Tuesday the agent drafts INV-2002, 9,000.00 EUR, and the CFO is not
asked. Step 32's record names Tuesday's sheet of rates. It does not say that DSoR turned 9,000.00
EUR into 9,720.00 USD, below the CFO's 25,000 USD. To see why the CFO was not asked, the auditor
must do the sum again.

The second danger is the agent's own words. The program that runs the agent, its *runtime*
(start-here's "clerk's brain"), wants to send "weekly payment run" and the skill it used. Step 32
refuses them:

```text
VALIDATION_FAILED: the request envelope may carry only token, tenant, request_id, idempotency_key, and mode, not "agent_asserted"
```

So if PAY-901 turns out to be wrong, nobody can tell which skill, at which version, the agent ran,
and nobody can find the other payments that skill made. The easy fix is the dangerous one: put the
agent's words beside the facts, where a rule or a reader can take them as true. Then an agent that
writes "the CFO agreed by phone" has written its own approval.

## The design, before any code

The circled numbers are lines of DSoR's checklist, §21 of the specification:

- Line ① finds who is calling, line ② the company, and line ③ the slip an agent runs under.
- Line ④ checks the emergency brakes (step 25b), line ⑤ the permission, and line ⑥ the input,
  and works out the request's fingerprint.
- Line ⑦ claims the idempotency key (step 20), and line ⑧ makes the proposal, or, for a release,
  loads it.
- Line ⑨ reads the records the contract binds, line ⑩ checks the rules and the limits, and line
  ⑪ writes the record.
- §21 has six more lines, for the work and its evidence. Its line ⑰ seals the bundle.

Words this step uses:

- **A decision bundle, or a bundle.** One case file of facts about one decision: one JSON document,
  in the shape of the specification's `decision-bundle.schema.json`, kept in
  `dsor.decision_bundles`.
- **To seal.** To write a bundle once. DSoR's own login can add a bundle, and never change or delete
  one (D3).
- **`agent_asserted`.** The box for what the agent says about itself. *Asserted* means "said to be
  true, without proof".
- **A record.** One line of DSoR's log, about one call (step 08). Its fields are those of the
  specification's `audit-record.schema.json`.
- **Extensions.** Where a record, and now a bundle, keeps what its schema has no field for, under
  `extensions["org.panaversity.steps"]` (step 10).
- **The envelope.** What travels beside a call's arguments: the login token, the company, the
  request id, the idempotency key, and the mode (step 05).
- **A fingerprint.** A short code that line ⑥ works out from a request's input, its
  `payload_hash` (step 20). The same input always gives the same fingerprint.
- **A replay.** A call that carries a key already claimed, with the same request. It gets the first
  call's answer, and nothing runs again (step 20).
- **A conversion.** An amount turned into another currency, with a sheet of rates (step 26). A
  sheet says how much of each currency one unit of its *base* buys. Tuesday's sheet has the base
  EUR: 1 EUR buys 1.0800 USD, or 0.8532 GBP.
- **A freshness label.** What each read says about how fresh it is, such as `current` (step 15).
- **An approval.** One person's yes to one waiting request, in `dsor.approvals` (step 29).
- **The notebook of evidence.** What DSoR writes down about one call as the call goes through the
  checklist. Line ⑪ seals it into the bundle. It is DSoR's own notebook, filled by DSoR's own
  checks. It is not the clerk's notebook in start-here, which is the agent's memory.

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
  record the versions that applied". DSOR-EXE-03b from step 08: no evidence, no answer.
  DSOR-AUD-04a from step 09: DSoR's own login cannot change or delete its evidence. DSOR-TEN-02a
  from step 11: evidence is kept in its company's partition. And DSOR-APR-02a from step 29, which
  this step found broken (F2).

### Decisions (Claude Code's)

- **D1. Every decision about a command, from line ④ on, gets a bundle.** The specification says
  "each consequential command" and does not define the word. This tutorial reads it as every
  command, in every mode, with every outcome:
  - a refusal, a dry run (`validate_only`, step 23), a wait for the CFO, a proposal prepared in
    `propose_only` mode, a replay, and a payment drafted;
  - and DSoR's own commands: an approval, a release, a brake, a rule change, a sheet of rates, and
    a slip revoked.

  §21 says why a refusal needs one too: "Denied and failed attempts are evidence, and they are often
  the most useful evidence." A query gets no bundle. Nor does a call refused at lines ① to ③: until
  line ③ passes, DSoR does not know under whose authority the call asks, and a bundle must say it.
  Its record stands alone, as before. *Downside:* many bundles say little. A dry run's names no
  proposal and no key of execution, and a refusal at line ⑥ names no rule and no read. And an agent
  refused at line ③, because user_123 revoked its slip, leaves a record and no bundle.
- **D2. A bundle and its record are kept together, or neither is.** Line ⑪ writes both, in one
  transaction, before the answer leaves. The record names its bundle in the audit record's own
  field, `decision_bundle`. A bundle that does not validate against the schema is a bundle the
  store cannot take. In each case the caller hears `EVIDENCE_STORE_UNAVAILABLE`, as for a record
  since step 08 (DSOR-EXE-03b). *Downside:* §21 seals the bundle at line ⑰, after the work. In this
  tutorial the work runs inside line ⑦'s claim, before line ⑪, so the bundle sees how the work
  ended. Step 36 moves the work after the intent record, the note written before the work, and the
  bundle may have to move with it.
- **D3. A bundle never changes.** A new table, `dsor.decision_bundles`, is append-only, like
  `dsor.audit`. DSoR's own login, `dsor_runtime`, may add a bundle and read one, in its own company
  only, behind row-level security (step 11). It cannot update or delete one (DSOR-AUD-04a, which
  this tutorial reads as covering a bundle; DSOR-TEN-02a). The database gives each bundle its time,
  `sealed_at`, as it gives a record its time (step 09). In memory, only the log's three functions
  reach the list of bundles, and each read gets a copy. *Downside:* a bundle with a mistake stays
  wrong for ever. A correction would be a new record, which no step builds.
- **D4. Facts only, each from DSoR's own work.** Every field except `agent_asserted` comes from
  what DSoR did itself:
  - who line ① found, and the slip and the signer line ③ found;
  - each rule line ⑩ evaluated, each record line ⑨ read, and each conversion line ⑩ made;
  - the approvals the release counted, and how the call ended.

  The bundle holds no word from the model, and nothing from the call's arguments: the records they
  name appear as DSoR read them. Three things in this tutorial's extensions are the caller's own, as
  in the record: the request id and the idempotency key it chose, and a refusal's reason, which may
  quote a short piece of the arguments. *Downside:* the bundle does not repeat the request itself.
  The proposal keeps it, with its fingerprint. A dry run, and a call refused before line ⑧, have no
  proposal, so nothing keeps their request.
- **D5. What line ⑨ read goes in `state`.** Each invoice and vendor line ⑨ read for the decision is
  listed as DSoR read it: its address, its version, the time of the read, and its freshness. The
  freshness is in capitals, as the bundle's schema writes it. A vendor that the accounts system does
  not list is still named: DSoR looked, at a time, and found nothing, so the entry has no version.
  At a release, the reads are the release's own. *Downside:* only line ⑨'s reads are listed. A read
  that the company's code makes afterwards is not, because no decision was made on it.
- **D6. Each conversion the decision used is named once.** `money.conversions` names each amount
  that line ⑩ converted into another currency, with five fields:
  - `from`, the amount;
  - `to`, the amount in the other currency, rounded up at the sixth decimal place, as a booking,
    step 24's reservation, is (step 26);
  - `rate`, how much of `to`'s currency one unit of `from`'s buys;
  - `source`, who published the sheet, such as `ecb-daily`;
  - and `as_of`, the time the source published the sheet (DSOR-MON-05).

  A comparison converts as Appendix B's comments in `src/cel.ts` say: `dsor_exceeds(a, b)` converts
  `a` into `b`'s currency, and `dsor_covers(a, b)` converts `b` into `a`'s. A limit converts the
  amount into the limit's currency. A booking's conversion is named only when this call books or
  checks the day with it: a release finds its booking again and books nothing (step 31), so it names
  none. A decision that converted nothing has an empty list. So does one refused because no rate
  was usable: it converted nothing, and its record still names the currency and why (step 26). *Downside:* when neither currency is the sheet's base, the rate is a
  quotient of two lines of the sheet, and it may not end: GBP to USD on Tuesday's sheet is
  1.0800 ÷ 0.8532 = 1.2658227848… The bundle writes it to at most twelve places, rounded half up. It
  keeps the sheet's own lines in this tutorial's extensions, so the exact answer can be worked out
  again.
- **D7. The approvals a release counted go in `satisfied_by` and `approval`.** At a release, each
  rule that asked for an approval names, in `satisfied_by`, the approvals that met it. `approval`
  names the first of them, the fingerprint they all bind, and every approver counted. A decision
  that counted no approval has no `approval`. *Downside:* the bundle's schema has room for one
  approval id, and this tutorial keeps one approval for each person (step 29, D7). With two
  approvers, `approval.id` names the first, `approval.approvers` names both, and each rule's
  `satisfied_by` names the approvals that met it. And cfo_100's own call, `proposal.approve`, names
  no approval in its bundle. The approval it kept is in `dsor.approvals`, and in the release's
  bundle.
- **D8. A release's bundle names the request it decided.** At a release, once line ⑧ has loaded the
  proposal, the bundle's `operation` is the stored request's, as the proposal keeps it, such as
  `payment.create@1`, and so is `execution.semantics`. A replay of a release names it too, and a
  dry run of a release names the proposal it would release. §26.4 decides a release "for the
  target command". The record still names
  the operation called, `proposal.execute@1`. *Downside:* a release's bundle and its record name two
  operations. The record's `decision_bundle` ties them together.
- **D9. `execution` says how the call ended, and no more than this step knows.** `result` is one of
  three:
  - `committed`, when the work ran and its proposal ended `COMMITTED`;
  - `failed`, when the work ran and refused;
  - `not_executed` for everything else: a refusal before the work, a wait for the CFO, a prepared
    proposal, a dry run, a replay, and an accident, an error that is not a refusal, which the claim
    undid (step 20).

  `semantics` comes from the contract, such as `compensatable` for `payment.create` (step 17).
  `idempotency_key` is the proposal's id, the key of its execution (DSOR-IDM-04). The caller's own
  key goes in this tutorial's extensions. `connector`, `intent_at`, and `finalized_at` are left out:
  connectors are step 34's, and the intent record is step 36's. *Downside:* the bundle does not say
  when the work ran. The proposal's move records do.
- **D10. The agent's words have one field of the envelope.** The envelope may now carry
  `agent_asserted`, with at most the four fields §29 names:
  - `skill`, with its `uri`, `version`, and `hash`, as §34.4 asks the agent's runtime to report
    them;
  - `rationale`, `purpose`, and `task_id`.

  Each text has a bound: 2,000 characters for a rationale, 200 for a purpose, 128 for a task id,
  and 512 for a skill's address. Line ① checks the shape and nothing else: DSoR does not verify one
  word. Any other field is refused with `VALIDATION_FAILED`, so the model's reasoning has no field
  of its own (DSOR-AUD-03b). A rationale is still free text, bounded at 2,000 characters. Only an agent's call may carry it. A person's call is refused the same way.
  Line ① reads it last, once the envelope's other checks pass, so a call that line ① refuses keeps
  none of the words. *Downside:* the bounds are this tutorial's, counted as JavaScript counts text,
  so an emoji counts as two. A rationale of 2,001 characters is refused, and so is a rationale on
  two lines: a text may hold no control character, as a request id may not (step 09, decision 16),
  and no character that breaks a line or hides what a text says, such as a line separator, a
  right-to-left override, or a zero-width space.
- **D11. The agent's words are kept under `agent_asserted`, and nowhere else.** They are kept as
  sent, after line ①'s check, in two places: in the bundle's `agent_asserted`, and in the record's
  extensions under the same name, so a call with no bundle keeps them too (DSOR-AUD-06). No other
  field of either holds them: not the reason, not the identity. The refusal of a field that is not
  one of the four does not repeat the field's name, because that name is the agent's text too.
  *Downside:* the agent may write a
  secret into its rationale, such as a bank account, and DSoR cannot tell. DSOR-AUD-05a's rule
  against raw `RESTRICTED` values cannot be kept for free text.
- **D12. No check reads the agent's words.** Line ① writes them into the notebook of evidence and
  hands them to nothing else. These never read them (DSOR-AUD-07):
  - line ③'s slip, line ⑤'s permission, and the fingerprint that line ⑥ works out and line ⑦
    claims the key with;
  - line ⑨'s preconditions, line ⑩'s rules and limits, and the masking of the answer.

  DSoR refuses a condition that names `agent_asserted`, when someone drafts it and at start-up. It
  is not one of Appendix B's eight variables: `input`, `state`, `principal`, `actor_chain`,
  `delegation`, `tenant`, `risk`, and `now`. Appendix B says the box "is never part of the
  environment". *Downside:* a retry with the same key and new words is a replay. Its words are kept
  with its own record and bundle, and change nothing.
- **D13. The specification's schema, and this tutorial's extensions.** The schema, copied byte for
  byte into `schemas/`, checks every bundle before it is kept. What the schema has no field for goes
  in this tutorial's extensions, as in the record since step 10 (DSOR-SCH-02):
  - the call's request id, the answer the caller heard, the mode, and the caller's key, with the
    call a replay repeats;
  - the sheet's own lines, and the currency that had no usable rate, with why;
  - each refusing rule's own reason, and each stale rule's policy in force;
  - at a release, `approved_under`, the rule versions the request was decided under (DSOR-APR-03d).

  The schema's `superseded_version` looks like the place for the old rule version. But since step
  28b this tutorial uses it for the policy version a stale rule cites. So the old rule version goes
  in `approved_under`, as in the record. *Downside:* a reader needs this tutorial's README to read
  the extensions.
- **D14. No operation reads a bundle yet.** The people who read evidence use SQL, as since step
  19b, and the tests read the stores. Reading audit must itself be authorized and audited
  (DSOR-AUD-05b), and no step builds that yet. *Downside:* an auditor needs access to the database.

### Decisions found by the review (Claude Code's)

- **D15. A release's bundle names the request it decided, for the person or agent that asked.** At
  a release, lines ③ to ⑩ check the stored request again for whoever asked for it (step 31). So the
  bundle's `identity` and `authority.delegation` are theirs, as checked just now: the agent, under
  del_100, when user_123 releases the agent's request. Who released it goes in this tutorial's
  extensions, `released_by`. *Downside:* a release's bundle and its record name two callers when a
  person releases an agent's request. Found by the review, finding 4: the bundle named user_123 and
  no slip, though line ⑩ judged del_100's limits.
- **D16. A vendor id that no address can name is not followed.** An address may hold only letters,
  digits, `_`, `.`, and `-` (`resourceUri` in the specification's schema). The accounts system may
  name a vendor "VENDOR 44", with a space. DSoR then binds no vendor, and the precondition on the
  vendor cannot hold: the draft hears `CONFLICT`. *Downside:* such a vendor's invoices cannot be
  paid through DSoR until the accounts system renames the vendor. Found by the review, finding 1:
  the vendor's address failed the bundle's schema after the payment was drafted.
- **D17. The bundle is checked before the work runs.** In this tutorial the work runs inside line
  ⑦'s claim, before line ⑪ writes the record (D2). So just before the work, DSoR builds the bundle
  from the notebook of evidence and checks it against the schema. A bundle DSoR could not keep then
  stops the work, and the claim undoes the proposal, as a record DSoR cannot keep stops the answer
  (DSOR-EXE-03b). The answer and how the work ended are filled at line ⑪, in DSoR's own words.
  *Downside:* the bundle is built twice for each call that runs work. Found by the review, finding
  1: a bundle that failed at line ⑪ left PAY-901 drafted with no record and no bundle.

### The story's numbers

| When | Who | Asks | DSoR answers | The bundle says |
|---|---|---|---|---|
| Tuesday | the agent, "weekly payment run" | drafts INV-1008, 31,400.00 USD | `PENDING_APPROVAL`, for the CFO | `not_executed`; `high-value-payment` version 8, `REQUIRE_APPROVAL`; INV-1008 and VENDOR-44, each at its version, `CURRENT`; the purpose under `agent_asserted` |
| Tuesday | the agent | drafts INV-2002, 9,000.00 EUR | drafted | one conversion: 9,000.00 EUR to 9,720.00 USD at 1.08, from `ecb-daily`, as of Tuesday 14:00 |
| Tuesday | the agent, "the CFO agreed by phone" | drafts INV-1004, 27,300.00 USD | `PENDING_APPROVAL`, as without the words | the words under `agent_asserted`, and every other field as without them |
| Wednesday | cfo_100 | approves INV-1008 | `APPROVED` | `proposal.approve@1`, `committed`, in direct mode |
| Friday | the agent | releases INV-1008 | `COMMITTED`: PAY-901 | `payment.create@1`, `committed`; the rule `satisfied_by` cfo_100's approval; `approval` names it, its fingerprint, and cfo_100; INV-1008 and VENDOR-44 as the release read them |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | Every decision about a command from line ④ on has one bundle, named by its record, valid against the schema. That holds in every mode and for every outcome, for DSoR's own commands too. A query, and a refusal at lines ① to ③, have none (DSOR-AUD-03a) |
| C2 | A bundle names the facts: who asked, under which slip, and each rule with its version, answer, and policy. It names each record line ⑨ read, with its version, time, and freshness, and how the call ended. At a release, it names the stored operation, the approvals counted, and the versions decided under (DSOR-AUD-03a, DSOR-APR-03d, DSOR-VER-01c) |
| C3 | A decision that converted names each conversion once, with its rate, source, and time. One that converted nothing, or found no usable rate, names none (DSOR-MON-05) |
| C4 | Line ① checks `agent_asserted`'s shape. It is kept as sent, in the bundle and the record, and in no other field. A person's call, and any other field, are refused. A bundle without it is complete (DSOR-AUD-06, DSOR-AUD-03b) |
| C5 | The agent's words change no decision: the same answers, rules, limits, and fingerprint with any words. A condition that names them is refused, when drafted and at start-up (DSOR-AUD-07) |
| C6 | On the database, a bundle and its record are kept in one transaction or not at all. `dsor_runtime` cannot change or delete a bundle, nor read another company's (DSOR-EXE-03b, DSOR-AUD-04a, DSOR-TEN-02a) |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. The bundle forgets what line ⑨ read | every bundle still validates, since the schema allows an empty `state`; the tests of C2 fail. The schema alone cannot prove a bundle complete | none: built first |
| B2. The rules read the agent's words | a rule that skips the CFO when the purpose says so can be drafted, and the agent that says so is paid without the CFO | none: built first |
| B3. The fingerprint includes the agent's words | a retry with the same key and new words hears `IDEMPOTENCY_CONFLICT` instead of the first call's answer | none: built first |
| B4. On the database, the bundle is written in a transaction of its own, before the record's | when the record cannot be written, a bundle is kept with no record. *Changed while building:* the first plan, a record that names a bundle that does not exist, cannot happen: the database's key refuses such a record | none: built first |
| B5. The release forgets the approvals it counted | the release's bundle says the rule asked for an approval and names none: step 32's gap comes back | none: built first |

### Left open, and not this step's idea

- Owner-approval mode, and `sod_mode: owner_approval`, the segregation-of-duties mode of step 30
  (DSOR-SOD-11): owner approval is not built, so every bundle says `standard`.
- The connector of the work, the intent record, and the time the work was finalized: steps 34
  and 36.
- An operation that reads a bundle, authorized and audited (DSOR-AUD-05b).
- A chain of hashes across the log, each record holding the hash of the one before it, so that
  nobody can quietly edit it: step 39.
- An outcome that is unknown, `outcome_unknown`: step 37.

## What changed since step 32

| File | What changed |
| --- | --- |
| `src/bundle.ts`, `schemas/decision-bundle.schema.json` | **New.** The bundle's shape, the notebook of evidence, how a decision's bundle is built from its record and the notebook, and the check against the specification's schema, copied byte for byte (D1, D4 to D9, D13) |
| `src/asserted.ts` | **New.** What the agent says about itself, checked for its shape at line ① (D10) |
| `src/request.ts` | The envelope may carry `agent_asserted` |
| `src/pipeline.ts` | The notebook of evidence: the agent's words at line ①, who asks once line ③ passes, each record line ⑨ reads, each conversion at line ⑩, the request a release decides and the approvals it counted, and how the work ended. Line ⑪ seals the bundle with the record (D2) |
| `src/log.ts` | The record names its bundle and keeps the agent's words under `agent_asserted`. The memory log keeps a record and its bundle together, or neither (D2, D11) |
| `src/postgres.ts`, `migrations/030_decision_bundles.sql`, `store.json` | **New table** `dsor.decision_bundles`, append-only, behind row-level security, so each company reads only its own rows (step 11). The record's key to its bundle. Both written in one transaction (D2, D3) |
| `src/bound.ts` | Line ⑨'s read tells the notebook of each record it reads, one that is not there too (D5), and follows no vendor id that an address cannot name (D16) |
| `src/release.ts` | The release's check of the approvals answers what it counted, by rule in a Map (D7), and its look at the asker says where the asker's authority came from (D15) |
| `src/cel.ts`, `src/controls.ts`, `src/limits.ts`, `src/exchange.ts` | Each conversion is noted where it is made, in its direction. The rate between two currencies, to at most twelve places (D6) |
| `src/approve.ts` | An approval binds each record by its own address (found while building, F2) |
| `src/main.ts` | The story of this step, in a world of its own |
| `test/bundle.test.ts`, `test/bundle-reads.test.ts`, `test/bundle-money.test.ts`, `test/agent-asserted.test.ts`, `test/bundle.db.test.ts` | **New.** The claims C1 to C6 |
| `test/bundle-review.test.ts` | **New.** What the review found: each fix, red first, and a test for each break that survived |
| The other tests | The envelope's refusal text, which now lists `agent_asserted`; the log's three functions; a log in a test that passes the bundle on; what the release's check counts; and the database's lists of tables, columns, privileges, and policies. Each says "Changed in step 33" |

Step 32's markers are gone, as the build skill (`.claude/skills/build-baby-step`) asks. A search
for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_32_preconditions_and_one_attempt_at_a_time/src src
git diff --no-index ../mj_32_preconditions_and_one_attempt_at_a_time/test test
```

## Run it

As in step 32, the step needs a local PostgreSQL 17 and a database of its own. Its `.env` is
written by a command that prints nothing. Give the step a server of its own if you can: `pnpm
migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server. Run one suite at a time on
it. This step adds one migration, 030.

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-16. After step 32's scenes, the program tells this step's story in a
world of its own: stores and data in memory, apart from the earlier scenes, so nothing they left
changes this story.

```text
the decision bundle, in memory, in a world of its own:
  the agent drafts INV-1008, 31,400.00 USD, for a weekly payment run: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  cfo_100 approves it: answered, apr_5d2cd1a7-fe55-4906-b30b-bbfdb7c7411d
  the agent releases INV-1008: answered, PAY-901
  the release's bundle: payment.create@1, committed
    who: unattended, user_123 through accounts-payable-fte, under del_100
    rule: high-value-payment version 8, REQUIRE_APPROVAL, met by apr_5d2cd1a7-fe55-4906-b30b-bbfdb7c7411d
    approval: apr_5d2cd1a7-fe55-4906-b30b-bbfdb7c7411d, by cfo_100
    read: dsor://org_456/invoice/INV-1008 version 1, CURRENT
    read: dsor://org_456/vendor/VENDOR-44 version 1, CURRENT
    money: nothing converted
    the agent says, in this call: "nothing"
  the draft's bundle keeps what the agent said then: {"skill":{"uri":"viking://agent/skills/vendor-payment","version":3,"hash":"sha256:c0ffee5k111"},"purpose":"weekly payment run"}
  the agent drafts INV-2002, 9,000.00 EUR: answered, PAY-902
    money: 9000.00 EUR is 9720.00 USD, at 1.08, from ecb-daily, as of 2026-10-06T14:00:00.000Z
  the agent drafts INV-1004, 27,300.00 USD, saying "the CFO agreed by phone": PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  bundles in this world: 5, 5 of them valid against decision-bundle.schema.json
```

This is the auditor's question from "Why it matters", answered from one file. The release's
bundle names the rule, the approval that met it, and cfo_100. It names the version of INV-1008 and
of VENDOR-44 that the release read. The agent's words sit in the draft's bundle, apart from the
facts, because each bundle keeps the words of its own call. INV-2002's bundle names the one
conversion the decision used. "The CFO agreed by phone" changed nothing: INV-1004 still waits for
the CFO. That VENDOR-44 was still approved follows from step 32: the release checks the
precondition `state.vendor.status == "approved"` again, and the result is `committed`. Near the end,
on the database, the program reads its own records back and says
`19 of the records it reads name a decision bundle`: the decisions about a command from line ④ on.

## Break it

Each break ran on 2026-10-16 in a copy of this folder outside the repository, never in the folder
itself, and a fresh copy was made for each. A short script told four scenes, each named by the
break it shows:

- **S1**, for B1 and B5: the agent's release of INV-1008 after cfo_100's approval.
- **S2**, for B2: cfo_100's version 9 of the CFO rule, which skips the CFO when the agent's purpose
  says "emergency", then the agent's draft of INV-1008, saying "emergency".
- **S3**, for B3: the agent's draft of INV-1008, sent twice with one key, with new words the second
  time.
- **S4**, for B4, on the database: intake-fte, the tests' own agent, tries a dry run of INV-9001,
  the tests' own invoice, and the record's `INSERT` fails.

Then the whole unit suite ran, and for B4 the database tests of C6. Unbroken, the scenes read:

```text
S1, the agent's release of INV-1008: COMMITTED
S1, its bundle: payment.create@1, committed, valid: true
S1, the rule: high-value-payment version 8 REQUIRE_APPROVAL, met by ["apr_52652544-2941-42fc-802a-e1a2bf23382c"]
S1, the approval: {"id":"apr_52652544-2941-42fc-802a-e1a2bf23382c","payload_hash":"sha256:f9e407e3c5a699ba22b4401cc8ee2dd8c54593d8ba612096956af2f725e5f1d0","approvers":["cfo_100"]}
S1, what DSoR read: ["dsor://org_456/invoice/INV-1008 v1 CURRENT","dsor://org_456/vendor/VENDOR-44 v1 CURRENT"]
S2, cfo_100 drafts the rule: VALIDATION_FAILED: "rule.draft": org_456's control high-value-payment: its condition names agent_asserted, which is not in the environment
S2, the agent drafts INV-1008, saying "emergency": PENDING_APPROVAL; drafted: none
S3, the same key and request, with new words: PENDING_APPROVAL
S4, intake-fte's dry run of INV-9001, whose record cannot be written: EVIDENCE_STORE_UNAVAILABLE; records kept: 0; bundles kept: 0
```

**B1. The bundle forgets what line ⑨ read.** In `src/bundle.ts`, the bundle's `state` was always
`[]`:

```text
S1, its bundle: payment.create@1, committed, valid: true
S1, what DSoR read: []
```

The bundle still validates: the schema allows an empty `state`. So the schema alone cannot prove a
bundle complete. Six tests failed, five of C2 and one of C4, among them "the agent's draft of
INV-1008 names INV-1008 and VENDOR-44, each at the version line ⑨ read".

**B2. The rules read the agent's words.** Claude Code made three changes. `agent_asserted` became a
variable of the CEL environment. Line ⑩'s facts got the agent's words. And a rule's own examples,
which DSoR runs at the switch-on (not this folder's tests), got an empty box:

```text
S2, cfo_100 drafts the rule: COMMITTED
S2, cfo_100 switches it on: COMMITTED
S2, the agent drafts INV-1008, saying "emergency": COMMITTED; drafted: INV-1008
```

DSoR drafted PAY-901, 31,400.00 USD to VENDOR-44, without the CFO, because the agent said so. Two
tests of C5 failed: the rule's draft and the contract's start-up, each refused unbroken. The first
try at this break changed only the environment and line ⑩'s facts. Then the rule's own examples
stopped it at the switch-on, "Unknown variable: agent_asserted", because they run on facts of their
own.

**B3. The fingerprint includes the agent's words.** In `src/pipeline.ts`, line ⑥ hashed the input
and the words together:

```text
S3, the same key and request, with new words: IDEMPOTENCY_CONFLICT: the idempotency_key was used for a different request to "payment.create"
S1, the agent's release of INV-1008: APPROVAL_INVALIDATED: proposal prop_74e0d493-32e9-4597-85dc-5091600e467e is INVALIDATED: APPROVAL_MISMATCH: proposal prop_74e0d493-32e9-4597-85dc-5091600e467e's stored request does not match its fingerprint
```

The agent's words changed a decision: a retry that should get the first answer was refused. And
every release was invalidated, because a release works out the fingerprint again from the stored
request alone, as step 31 does. Fifty tests failed.

**B4. On the database, the bundle is written in a transaction of its own.** In `src/postgres.ts`,
the bundle was written in its own transaction, before the record's. S4 makes the record's `INSERT`
fail, a division by zero, on the real database:

```text
S4, intake-fte's dry run of INV-9001, whose record cannot be written: EVIDENCE_STORE_UNAVAILABLE; records kept: 0; bundles kept: 1
```

A bundle is kept for a decision that has no record. Two tests of C6 failed. The first run of S4
said "bundles kept: 0" both broken and unbroken: intake-fte had no slip in that run, so the call
stopped at line ③, before any bundle. A scene that shows no difference between the broken and the
unbroken code proves nothing, so S4 now gives intake-fte its slip first, as the tests do.

**B5. The release forgets the approvals it counted.** In `src/pipeline.ts`, the release's check
still ran, and its answer was dropped:

```text
S1, the agent's release of INV-1008: COMMITTED
S1, the rule: high-value-payment version 8 REQUIRE_APPROVAL, met by []
S1, the approval: null
```

Step 32's gap is back: a rule asked for an approval, the payment went out, and the file names no
approval. Four tests failed.

## Build it yourself with Claude Code

Claude Code built the step in these moves.

| # | Move | What was done |
|---|---|---|
| 1 | The problem | Step 32's code, run: the release's record names neither the approval nor the versions it read, and the envelope refuses the agent's words |
| 2 | Decide | D1 to D14, Claude Code's, written down before any code, as the learner chose to build first |
| 3 | The copy | Step 32 copied, its markers removed, and a PostgreSQL of its own |
| 4 | Piece A | A bundle for each command decision, sealed with its record, red first |
| 5 | Piece B | What line ⑨ read, and what a release decided on and counted; the approval's addresses fixed (F2) |
| 6 | Piece C | Each conversion, with its rate, source, and time |
| 7 | Piece D | The agent's words, kept apart, and read by no check |
| 8 | Piece E | On the database: the table, its key, and one transaction |
| 9 | Piece F | The program's story |
| 10 | Break it | Each piece broken on purpose before its commit; then B1 to B5, run for real, in copies of the folder |
| 11 | Review | A reviewer of the README, and a reviewer of the code, neither of whom had seen the conversation; the second broke the code 94 times in a copy of its own |
| 12 | Fix | The README rewritten from its review's 43 findings. The code's one high finding and four medium ones fixed red first, with D15 to D17; a test for each break that survived; one more test after a break of a fix survived |

To start it in a new session:

```text
Build step 33 in learner mode from the design in
docs/baby_steps_tutorials/mj_33_the_decision_bundle/README.md.
```

## Check yourself

1. The agent drafts INV-1004, 27,300.00 USD, and says "the CFO agreed by phone". What does it
   hear, and where are its words kept?
2. Two weeks later, an auditor asks who approved PAY-901. Which bundle answers, and in which fields?
3. cfo_100 drafts a rule that skips the CFO when the agent's purpose says "emergency". What happens?
4. The agent drafts INV-2002, 9,000.00 EUR, under del_100's limits in USD. The CFO's rule and both
   limits compare its amount in USD. How many conversions does the bundle name, and why?
5. On the database, the record of a decision cannot be written. What happens to its bundle, and
   what does the caller hear?

<details>
<summary>Answers</summary>

1. `PENDING_APPROVAL`, for the CFO, as without the words (D12). The words are kept as sent: in the
   bundle's `agent_asserted`, and in the record's extensions under the same name. No other field of
   either holds them (D11).
2. The release's bundle: `authority.controls` names `high-value-payment` version 8, with cfo_100's
   approval in `satisfied_by`; `approval` names that approval, the fingerprint it binds, and
   cfo_100; `state` names INV-1008 and VENDOR-44 as the release read them; and
   `execution.result` is `committed` (D5, D7).
3. The draft is refused: `agent_asserted` is not one of Appendix B's eight variables, so the
   condition names something outside the environment (D12). Break B2 shows what the refusal
   prevents: the agent that says "emergency" is paid without the CFO.
4. One: 9,000.00 EUR to 9,720.00 USD at 1.08, from `ecb-daily`, as of Tuesday 14:00. The rule and
   the two limits convert the same amount into the same currency, so the bundle names that
   conversion once (D6).
5. Neither the record nor the bundle is kept: one transaction holds both, and the caller hears
   `EVIDENCE_STORE_UNAVAILABLE` (D2). Break B4 shows the bundle left behind when it is written in a
   transaction of its own.

</details>

## Think it through

### Found while building

- **F1.** A break of piece A, "a replay counts as what its first call did", left every test
  green: only a draft that waits had been sent again, and its replay ran nothing either way. A test
  now sends user_123's drafted INV-1002 again: the replay's bundle is `not_executed`, so one
  payment has one `committed` bundle.
- **F2.** Since step 32, cfo_100's approval named VENDOR-44 by an invoice's address,
  `dsor://org_456/invoice/VENDOR-44`: `src/approve.ts` named every bound record as an invoice. No
  check reads an approval's `bound_state`, and the tests matched it with `toMatchObject`, which
  allows extra keys. Each record is now named by its own address, from line ⑨'s read, and a test
  checks the whole field (DSOR-APR-02a).
- **F3.** Two guards of piece B were removed after their breaks left every test green. No test
  could fail them, because neither could ever act:
  - a reset of the notebook's reads at each line ⑨: one call reads at line ⑨ once;
  - a check that names each approver once: one person approves a proposal once (step 29, D3).
- **F4.** Two breaks of piece C left every test green at first: "the limits note nothing" and "the
  booking is not noted". A rule, or the limit for one payment, had converted the same amount. Two
  tests now convert with a limit alone: a slip whose limits are in EUR, and a slip with a limit for
  one day alone.
- **F5.** Break B4 as first designed cannot happen: the database's key, `audit_names_a_bundle`,
  refuses a record that names a bundle it does not keep. The break that remains is the bundle
  written in a transaction of its own (B4 above).
- **F6.** The first run of scene S4 proved nothing: it said "bundles kept: 0" on both the broken and
  the unbroken code, because intake-fte had no slip (B4 above).
- **F8.** `pnpm guard` failed on `src/asserted.ts`: its copy of the specification's hash pattern
  wrote the slash inside its brackets as `\/`. A pattern's text keeps a slash inside brackets as it
  is, so the copy no longer matched. Piece D had been committed before the guard ran. The slash is
  now written as the schema writes it.
- **F9.** The README's reviewer found that no test looked at the bundle of a refusal at line ④, or
  of a brake, a rule's draft, or a sheet of rates. The bundle could have begun after line ④ with
  every test green. A test now checks all four, and it fails when the bundle begins after line ④.
- **F7.** Break B2 needed three changes to reach the danger, and the test that compares decisions
  with and without the words did not fail under it, because the shipped rule reads no words. The
  two structural tests did: a draft that names `agent_asserted`, and a contract that does.

### The reviews

Two reviewers who had not seen the conversation read the step: one the README, one the code.

**The README's review** found 43 places to fix. The largest were these: the clerk analogy did not
fit start-here, where the agent is the clerk and DSoR the desk; a row of the story named INV-1008
where the run drafts INV-1004; terms such as fingerprint and extensions were used before they were
defined; and no test looked at a refusal at line ④ (F9). Each was fixed.

**The code's review** broke the code 94 times in a copy of its own, and 25 breaks left the tests
it ran green. Its findings, and what became of each:

- **Finding 1, high.** The bundle was checked at line ⑪, after the claim had committed the work.
  Data the accounts system may hold, a vendor named "VENDOR 44", made the bundle fail its schema:
  PAY-901 was drafted, and the decision had no record and no bundle. A rule named `constructor` did
  the same at a release, through a plain object. Fixed with D16, a Map for the counted approvals,
  and D17, the check before the work. Each has a test, and a test of the release was added after a
  break of the fix survived.
- **Finding 2, medium.** The same `constructor` rule, when it asked for an approval, made every
  release an `INTERNAL_ERROR`. Fixed with finding 1. A test.
- **Finding 3, medium.** A release named the conversion of a booking it did not make: Wednesday's
  rate, when the booking kept Tuesday's. Fixed in `src/limits.ts`: the claim looks for its own
  booking too (D6). A test.
- **Finding 4, medium.** A person's release named the person and no slip, though the rules judged
  the agent's slip. Fixed with D15. A test.
- **Finding 5, medium.** A replay of a release named `proposal.execute@1`. Fixed (D8). A test.
- **Findings 6 to 9, medium and low.** Breaks that no test caught: the agent's words given to a
  condition's input or state, to line ⑤, or to the masking; a limit's conversion dropped; approvals
  the release did not count named; a read's freshness and time. The code was right, and a test now
  catches each break.
- **Finding 10, low.** The line ④ boundary had no test. F9 had already added one.
- **Findings 11 and 12, low.** A line separator, a right-to-left override, or a zero-width space
  passed the shape check, and the refusal of an unknown field quoted its name into the record's
  reason. Both fixed (D10, D11), with tests.
- **Findings 13 and 17, low.** Words of the design that said more than the code did: the caller's
  own request id and key in the extensions (D4), the operation's version and a dry run's proposal at
  a release (D8), and "the list is frozen" (D3). The words or the code were fixed. DSOR-IDM-04 now
  has a test titled with it.
- **Findings 14 to 16, low.** Bounds of `agent_asserted` that no test checked, a stale rule's
  extension, the rate's rounding, an approval whose vendor is gone, and conversions that a missing
  sheet could drop without an error. A test for each, and an error for the last.

### Left open on purpose

- **What "consequential" means.** D1 reads it as every command, from line ④ on. The specification
  does not define the word. Open question 139.
- **A rate that does not end.** D6 writes a cross rate to twelve places, rounded half up, and keeps
  the sheet's own lines beside it. The specification does not say how a rate is written. Open
  question 140.
- **One approval id for several approvers.** D7 names the first approval, and every approver. Open
  question 141.
- **The operation a release's bundle names.** D8 names the stored request's, as §26.4 decides "for
  the target command". Open question 142.
- **A secret in the agent's words.** D11 keeps free text that DSoR cannot classify, so a
  `RESTRICTED` value can reach the evidence (DSOR-AUD-05a). Open question 143.
- **The answer and its reason.** The bundle's schema has no field for the code the caller heard, or
  for why: D13 keeps them in this tutorial's extensions. Open question 144.
- **Not this step's idea:** the list in "Left open, and not this step's idea", in the design.
- **From the code's review.** Two of its breaks stay without a test: one drops the role from the
  count of approvals that met a rule, which no call can reach, because an approval names the role
  it met; and one names `ecb-daily` as every bundle's source, the only source the tests load.
- **A long file.** `src/bundle.ts` holds 326 lines: the shape, the notebook, the building,
  and the check. The build skill asks to split a file of more than about 150 lines. The check
  against the schema could move to a file of its own.

## The rules this step meets

| Rule | What it says | Spec | Tests |
| --- | --- | --- | --- |
| DSOR-AUD-03a | For each consequential command, a decision bundle that validates against `decision-bundle.schema.json` | [§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence) | [`test/bundle.test.ts`](test/bundle.test.ts), [`test/bundle-reads.test.ts`](test/bundle-reads.test.ts), [`test/bundle-review.test.ts`](test/bundle-review.test.ts), [`test/bundle.db.test.ts`](test/bundle.db.test.ts) |
| DSOR-AUD-03b | Audit and compliance evidence does not depend on private model reasoning traces | [§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence) | [`test/agent-asserted.test.ts`](test/agent-asserted.test.ts) |
| DSOR-AUD-06 | What the agent supplies about itself is recorded under `agent_asserted` | [§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence) | [`test/agent-asserted.test.ts`](test/agent-asserted.test.ts) |
| DSOR-AUD-07 | Agent-asserted information is no input to authorization or control evaluation | [§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence) | [`test/agent-asserted.test.ts`](test/agent-asserted.test.ts) |
| DSOR-MON-05 | A decision that used a conversion records the rate, its source, and its time in the bundle | [§9](../../../specs/dsor/01-model.md#9-money-and-currency) | [`test/bundle-money.test.ts`](test/bundle-money.test.ts) |
| DSOR-VER-01c | Audit records and decision bundles record the versions that applied | [§43](../../../specs/dsor/06-conformance.md#43-versioning-and-deprecation) | [`test/bundle.test.ts`](test/bundle.test.ts) |
| DSOR-APR-03d | Step 31's rule, now in the bundle: both versions of a rule that changed before a release | [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution) | [`test/bundle-reads.test.ts`](test/bundle-reads.test.ts) |
| DSOR-AUD-04a | Step 09's rule, now for a bundle too: DSoR's own login cannot change or delete one | [§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) | [`test/bundle.db.test.ts`](test/bundle.db.test.ts) |
| DSOR-EXE-03b | Step 08's rule: with no evidence, no answer, now for the record and its bundle together, and a bundle that could not be kept stops the work (D17) | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | [`test/bundle-review.test.ts`](test/bundle-review.test.ts), [`test/bundle.db.test.ts`](test/bundle.db.test.ts) |
| DSOR-IDM-04 | Step 22's rule, now in the bundle: the proposal's id is the key of its execution | [§22](../../../specs/dsor/03-execution.md#22-idempotency) | [`test/bundle-review.test.ts`](test/bundle-review.test.ts) |
| DSOR-TEN-02a | Step 11's rule, now for a bundle too: a bundle is kept in its company's partition | [§14](../../../specs/dsor/02-security.md#14-multi-tenancy) | [`test/bundle.db.test.ts`](test/bundle.db.test.ts) |
| DSOR-APR-02a | Step 29's rule, fixed here (F2): an approval binds the state it was given on, each record by its own address | [§26.3](../../../specs/dsor/03-execution.md#263-what-an-approval-binds) | [`test/bundle-reads.test.ts`](test/bundle-reads.test.ts) |

**Next:** step 34, connectors, the first step of Part 5.
