# Step 28b · Where a rule came from

**New in this step:** a stand-in for KSoR. When the policy that a rule came from changes, DSoR
marks the rule *stale*, tells its owner, and keeps the rule in force.

## In plain words

A *policy* is a sentence that people in the company write and agree on, such as "payments above
25,000 USD or equivalent need the CFO". The company keeps its policies in KSoR, the record of what
the company knows. Each policy has *versions*: when the finance team changes the sentence, KSoR
keeps the old text and adds a new version. Each version has a *fingerprint*, a short code computed
from its exact text with SHA-256, a standard method for it (the specification calls it
`content_hash`). Two different texts never get the same fingerprint in practice.

A rule in DSoR is a policy translated into a condition that a program can check. Since step 27
each rule names the policy it came from: which system, which policy, which version, and the
fingerprint. The specification calls this the rule's *authority*. So version 8 of
`high-value-payment` says: "I was built from version 4 of the payment-approval policy."

In this step DSoR checks that link. DSoR's own *sweep*, a command that a deployment's timer would
call once a day (this step builds no timer), asks KSoR which version of each policy is now in
force. When the answer is no longer the version
that a rule cites, DSoR marks the rule `stale_authority` (*stale*: out of date) and leaves a
*notice* for the rule's owner. A stale rule is never switched off by DSoR. For a time that the
rule itself names, its *grace* (`stale_grace`), it behaves as its `on_stale` says: keep going as
before, ask a person every time, or refuse every time. After the grace, on a high-risk operation,
it asks a person at least. Every decision's record names the policy version that each rule cites,
and for a stale rule, the version in force beside it. And a person can no longer switch on a version
that cites a policy version that is not in force.

## Why it matters

On Monday the finance team changes the payment-approval policy in KSoR: from now on, payments above
20,000 USD need the CFO. That is version 5 of the policy. Version 8 of `high-value-payment` still
says 25,000, because it was built from version 4. Without this step DSoR never notices. The agent
drafts INV-2008 for 21,000.00 USD, and DSoR pays it without the CFO, against the company's own
policy. It does the same every day, and nobody is told.

The wrong fix is as bad. A DSoR that switched version 8 off "because it is out of date" would pay
INV-1008's 31,400.00 USD without the CFO too. §17.4 names this mistake: "Out of date is still safer
than absent."

## The design, before any code

The circled numbers are lines of DSoR's checklist. Every call runs through them in order, as a
pilot runs through a checklist. Line ⑤ checks the caller's permission, and ⑥ the input. Line ⑧
makes the proposal. Line ⑨ is DSoR's own look before any work, line ⑩ checks the rules and the
limits, and line ⑪ writes the record.

### How this step was made

The learner chose to build first and understand afterwards, for both halves of step 28
(2026-10-12). So every decision below is Claude Code's, for the learner to review, and each one
says what it costs. This folder is a copy of step 28, the first half, "who may switch a rule on".

### What each rule says

- **DSOR-CTL-03a:** "DSoR MUST detect, within the bound of §44, that the authority a control cites
  has been superseded, and then mark the control `stale_authority` and notify its owner"
  ([§17.4](../../../specs/dsor/02-security.md#174-lifecycle-and-drift)). The bound at L2 is 24 hours
  ([§44](../../../specs/dsor/06-conformance.md#44-operational-bounds)). *Superseded* means replaced
  by a newer version.
- **DSOR-CTL-03b:** "A stale control MUST NOT be dropped or skipped."
- **DSOR-CTL-03c:** "After its grace period, a stale control on a `HIGH` or `CRITICAL` operation
  MUST yield at least `REQUIRE_APPROVAL`." §44 caps that grace at 30 days at L2.
- **§17.4, beside the rules:** "During `stale_grace` a stale control behaves per `on_stale`." The
  three values are `enforce_and_flag`, `require_approval`, and `deny`.
- **DSOR-CTL-04**, met in step 27 for a rule that is up to date: "Every decision record MUST
  identify each evaluated control by id and version, together with the authority reference and
  version in force."

### Decisions (Claude Code)

- **D1. A stand-in for KSoR, one for each company,** inside DSoR's program (`src/ksor.ts`), as step
  19 wrote a stand-in for each company's staff directory. It keeps each policy's versions, each
  with its text and its fingerprint, `sha256:` and the SHA-256 of the text. It answers one
  question: which version of this policy is in force? The story and the tests can publish a new
  version, and turn it off or make it stuck. *Downside:* it answers at once and never lies. A real
  KSoR is reached over a network. DSoR checks each answer (D2), but no test here crosses a network.
- **D2. DSoR asks KSoR itself, and waits at most 2 seconds,** as it waits for a directory (step 19,
  decision 9). It uses an answer only when the answer names the company and the policy that DSoR
  asked about, a version number, and a fingerprint of the form `sha256:…`. Anything else counts as
  no answer. DSoR never takes a rule's word, or an agent's, for what is in force. *Downside:* a
  slow KSoR makes a switch-on fail (D12), and the sweep counts the policy as unanswered.
- **D3. A version is stale when KSoR's version in force is not the one it cites,** in number or in
  fingerprint. A newer version, an older one, and the same number with another text all count: the
  text the rule was built from is not the text in force. A policy that KSoR does not list at all
  counts as no answer, not as a change, because this stand-in never withdraws a policy. *Downside:*
  if a real KSoR withdraws a policy, the rule stays active, and the sweep counts it unanswered
  every day. Withdrawal is left open.
- **D4. The sweep, `rule.check_authority`, finds the change.** It is DSoR's own command, for
  DSoR's system logins only, as the expiry sweep is (step 25c, decision D14). It needs the new
  permission `rule:check`, which the role `scheduler` now holds beside `proposal:expire`. Its
  input names the company, as the expiry sweep's does: `{ "company":
  "dsor://org_456/tenant/org_456" }`. It asks KSoR once for each policy that a rule in force
  cites, and marks each version whose policy moved. It answers with counts:
  `{ tenant_id, asked, unanswered, marked }`. *Downside:* §44's 24 hours hold only if a
  deployment's timer calls the sweep at least once a day. This step builds no timer, as step 25c
  built none. If the timer stops, or KSoR is down for days, a rule stays active on a policy nobody
  confirmed. That is left open, as a question for the specification. And the sweep asks KSoR
  inside its own transaction, one policy at a time, so a stuck KSoR holds a database connection 2
  seconds for each policy (the review, finding L3).
- **D5. The mark and the notice are one step of the store.** The version moves from `active` to
  `stale_authority`. DSoR keeps the time of the mark and the version in force, with its
  fingerprint. It writes a `control_change` record, the log's record of a change to a rule (step
  28), and a notice to the version's owner. All of it happens in one *transaction*, the set of
  database writes that are kept together or not at all, while no other change of the rule can run
  (step 28, decision D15). A version that is stale already, whose policy moved again, keeps the
  time of its first mark and gets the new version in force, a record, and a new notice.
  *Downside:* nothing is sent, and nothing in this step reads the notice. It waits in DSoR's store,
  `dsor.notices` on the database, for a mailer that this tutorial does not have. Sending it is
  step 40's idea, the *outbox*: a table of messages, written in the same transaction as the change,
  that a sender delivers. Until then the notice is written and not delivered (the review, finding
  M5).
- **D6. Only the sweep marks a version stale, and only an active one.** No command lets a person
  or an agent set or clear `stale_authority`. A suspended version is never marked: its owner
  switched it off, and a stale version is in force (D7), so the mark would switch it back on. A
  stale version never becomes active again. Its owner suspends it, retires it, or switches on a
  new version that cites the policy in force, which retires it. *Downside:* if KSoR goes back to
  the old version, the stale version stays stale. Its owner drafts a new version with the same
  text and switches that on.
- **D7. Line ⑩ evaluates every version in force, at every call:** the active ones and the stale
  ones, in one read of the store, with each stale version's mark. A stale rule is never dropped and
  never skipped (DSOR-CTL-03b). It is the lock that stays locked when the power fails: when DSoR is
  unsure, the rule stays. *Downside:* a stale rule keeps its cost. A company whose policy became
  looser still waits for the CFO until the owner acts.
- **D8. During its grace, a stale version answers as its `on_stale` says, for every call it
  governs.** `enforce_and_flag`: its own answer, as before. `require_approval`: at least the
  approval its effect names, even when its condition does not hold. `deny`: DENY. A rule whose
  effect is `deny` names no approver, so where it must ask for an approval, it refuses. This is
  this tutorial's reading: the specification does not say whether `on_stale` applies only when
  the condition holds. *Downside:* under `require_approval` every payment that the rule governs
  waits for the CFO, 900.00 USD too, until the owner acts. The other reading is a question for the
  specification.
- **D9. The grace runs from DSoR's mark,** by DSoR's own clock, not from the time KSoR published
  the new version. After the grace, on a high or critical operation, a stale version answers at
  least the approval its effect names, whatever its `on_stale` says (DSOR-CTL-03c). On a low or
  medium operation its `on_stale` goes on. *Downside:* a sweep that runs late makes the grace up
  to a day longer than the policy's change.
- **D10. §44's ceiling on the grace.** This tutorial claims L2, the specification's second level of
  conformance, so a rule on a high or critical operation may have a grace of at most 30 days. The draft check and start-up refuse a longer one.
  *Downside:* a company that wants 45 days on a high-risk operation cannot have it at L2.
- **D11. The record names the authority each rule cites, and for a stale rule the version in
  force beside it (DSOR-CTL-04).** Line ⑪'s record names each rule that line ⑩ evaluated, by id
  and version, with `authority`: the policy, the version, and the fingerprint that the version
  cites, the text it was built from. For a stale version, `superseded_version` repeats the cited
  version, to mark it superseded. Beside the controls, in this tutorial's own extensions, the
  record names the version KSoR had in force when DSoR marked the rule, with its fingerprint, and
  the time of the mark: the audit record's field for one control has no place for them. The
  specification does not explain `superseded_version`, so this reading is this tutorial's, and a
  question for the specification. Changed by the review, finding M1: the record first named KSoR's
  version as the authority, and lost the fingerprint of the text the rule enforces. *Downside:*
  between a change in KSoR and the next sweep, the record names the cited version with nothing
  beside it, though KSoR has moved on.
- **D12. A switch-on asks KSoR first.** `rule.activate`'s line ⑨ asks KSoR about the policy that
  the version cites, for a draft and for a suspended version alike. It refuses `VALIDATION_FAILED`,
  the code that says the request itself is wrong, when KSoR has another version in force, or
  another fingerprint for that version. It refuses `FRESHNESS_UNSATISFIABLE`, the code that says
  DSoR cannot get a current answer now, when DSoR has no answer it can use, or KSoR does not list
  the policy yet: the owner tries again later. A version that cites `local` has no policy to ask
  about. *Downside:* KSoR is asked at line ⑨ only, and not again inside the change, so that no
  network call waits inside the switch-on's transaction. A policy published between the two is
  found by the next sweep. The sweep itself does ask inside its transaction (D4).
- **D13. A rule cites a source that this step can check:** `ksor`, with a policy of the rule's own
  company (`ksor://org_456/…`), or `local`, the specification's word for a rule with no governed
  source (DSOR-CTL-01b). A draft and start-up refuse any other system, because no sweep could ever
  find it superseded. *Downside:* a company whose policies live in another system marks its rules
  `local`, and loses the check. And an owner can leave the check on purpose: a new version that
  cites `local` is never asked about again, though the rule cited KSoR before (the review, finding
  L4). That is a question for the specification.
- **D14. Start-up accepts `stale_authority` in the store, and never from a file.** Step 27
  refused the status at start-up (its review, finding M2), because nothing evaluated a stale rule
  yet. Now line ⑩ does, so a stale version in the store is checked, and its tests run, as an
  active one's do. A controls file cannot hold DSoR's mark, so a stale version in a file stops
  start-up. *Downside:* a file cannot describe a stale rule for a test. The tests reach one through
  the sweep, as the program does.
- **D15. The tests rate `payment.create` high, to prove DSOR-CTL-03c.** Each operation's contract
  names its risk: low, medium, high, or critical. No operation that a rule may govern is high in
  this tutorial: `invoice.issue` and `payment.create` are medium, and
  `payment.cancel` is low. A test world whose `payment.create` contract says high is the only way
  to reach the rule. *Downside:* the program's story cannot show a grace ending on a high-risk
  operation.

### The story's numbers

| Who | Asks | DSoR answers |
|---|---|---|
| dsor-scheduler | sweeps org_456 | asked 1 policy, marked 0: version 8 cites version 4, which is in force |
| the finance team, in KSoR | publishes version 5 of the payment-approval policy: above 20,000 USD | (KSoR only) |
| the agent | drafts INV-2007, 21,000.00 USD | paid: version 8 still says 25,000, and DSoR has not swept yet |
| dsor-scheduler | sweeps org_456 | marked 1: version 8 is `stale_authority`, and cfo_100 gets a notice |
| the agent | drafts INV-2008, 21,000.00 USD | waits for the CFO: version 8's `on_stale` is `require_approval` |
| the agent | drafts INV-2009, 900.00 USD | waits for the CFO too: every payment version 8 governs |
| cfo_100 | drafts version 9, which still cites version 4, and switches it on | `VALIDATION_FAILED`: KSoR has version 5 in force |
| cfo_100 | drafts version 10: above 20,000 USD, citing version 5, and switches it on | version 10 `active`, version 8 `retired` |
| the agent | drafts INV-2010, 19,500.00 USD | paid |
| the agent | drafts INV-2011, 21,000.00 USD | waits for the CFO, by version 10's own condition |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | The stand-in for KSoR says which version of a policy is in force. DSoR uses only an answer it can use, within 2 seconds |
| C2 | The sweep marks an active version whose policy moved: the time, the version in force, a record, and a notice to its owner, all or none. A second sweep marks nothing new |
| C3 | Only DSoR's system login may sweep, and the sweep never marks a draft or a suspended version |
| C4 | Line ⑩ evaluates a stale version at every call: never dropped, never skipped |
| C5 | During its grace, a stale version answers as its `on_stale` says |
| C6 | After its grace, on a high or critical operation, a stale version answers at least `REQUIRE_APPROVAL` |
| C7 | The record names each rule's id and version and the authority it cites, and for a stale rule `superseded_version`, with the version in force beside it |
| C8 | A switch-on asks KSoR, and refuses a citation that is not in force, or that KSoR does not confirm |
| C9 | A draft and start-up refuse a citation this step cannot check, and a grace above 30 days on a high or critical operation. Start-up accepts a stale version in the store, and refuses one in a file |
| C10 | A stale version leaves its status only when its owner suspends or retires it, or switches on a new version |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. Line ⑩ reads only the active versions | after the mark, INV-2008's 21,000.00 USD and INV-1008's 31,400.00 USD are both paid without the CFO: the stale rule is gone, not stricter | (asked at the review) |
| B2. The sweep compares version numbers only, not fingerprints | KSoR's version 4 with a changed text is not found, and version 8 stays active | (asked at the review) |
| B3. The grace never ends | a stale rule with `enforce_and_flag` on a high-risk `payment.create` pays 21,000.00 USD without the CFO a week after its grace | (asked at the review) |
| B4. The switch-on does not ask KSoR | cfo_100 switches on version 9, which cites version 4, after version 5 is out, and it runs as active until the next sweep marks it | (asked at the review) |

### Left open, and not this step's idea

- A timer that calls the sweep, and a rule whose policy nobody could confirm for days (D4).
- Sending the notice: the outbox, step 40 (D5).
- A policy that KSoR withdraws (D3).
- An agent that drafts a rule for a person to review, and a rule handed to a new owner: step 28's
  questions 114 and 115.

## Before you build: set up a database

As in step 28: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Migration 024 runs. It adds the status `stale_authority` and
DSoR's mark beside it, in two columns: `stale_since`, the time of the first mark, which the
database writes itself, and `in_force`, the version of the policy KSoR had in force. The trigger
draws the moves of a stale version, the index of one live version counts a stale one, and a new
table, `dsor.notices`, keeps each notice to a rule's owner. DSoR's login may read a notice and add
one, and never change or remove it.

Give the step a server of its own, or at least a database of its own with its own `.env`.
`pnpm migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server, so a second step
migrated on the same server changes the first step's login.

## What changed since step 28

| File | What changed |
| --- | --- |
| `src/ksor.ts` | **New.** The stand-in for KSoR, one for each company: each policy's versions, the newest in force, with switches for a new version, off, and stuck |
| `src/drift.ts` | **New.** DSoR's side: its question to the company's KSoR, with a time limit and a check of the answer; the sweep, `rule.check_authority`; and the switch-on's check of a version's citation |
| `migrations/024_stale_rules.sql` | **New.** The fifth status, the mark's two columns, the trigger's new moves, the live index, and `dsor.notices` |
| `contracts/rule.check_authority.json`, `inputs/RuleCheckAuthorityRequest.schema.json`, `examples/rule.check_authority.json` | **New.** The sweep, for DSoR's system logins only, its input, and the cross-tenant suite's example |
| `src/rulebook.ts` | The status `stale_authority`, the mark, `inForce` in place of the active read, the mark's one step with its record and its notice, and start-up's handling of a stale version |
| `src/controls.ts` | A stale version's floor at line ⑩, the record's citation and the version in force beside it, a stale refusal's reason, and the checks of a citation and a grace. Step 27's start-up refusal of a stale control is gone: line ⑩ now evaluates one |
| `src/lifecycle.ts` | A switch-on asks KSoR at line ⑨, and retires a stale live version |
| `src/postgres.ts`, `src/log.ts` | The in-force read and the mark on the database, a mark's record, and the stale rules beside a decision's controls |
| `src/pipeline.ts`, `src/registry.ts`, `src/revocation.ts` | Line ⑩ reads the versions in force. The registry holds each company's KSoR, and DSoR's own look and change get a question to the call's own company's KSoR |
| `roles.json`, `classifications.json`, `store.json` | `rule:check` for the scheduler, the labels of the sweep's answer, and the map's new table and column |
| `src/main.ts` | The step 28 story gets the story's KSoR, and the story of where a rule came from |
| `test/ksor.test.ts`, `test/stale-rules.test.ts`, `test/rule-check.test.ts`, `test/rule-check.db.test.ts`, `test/citations.test.ts` | **New.** The claims C1 to C10 |
| The other tests | The store's and the switch-on's tests grow. The pinned lists of contracts, roles, labels, privileges, policies, tables, and attacks grow by one command and one table |

Step 28's markers are gone, as the build skill (`.claude/skills/build-baby-step`) asks. A search
for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_28_who_may_switch_a_rule_on/src src
git diff --no-index ../mj_28_who_may_switch_a_rule_on/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-13, after the review's fixes. After step 28's story, the program tells where a rule came from, in
memory, in a world with a store and a KSoR of its own.

```text
where a rule came from, in memory, with a store and a KSoR of its own:
  dsor-scheduler sweeps org_456: asked about 1 policy, 0 unanswered, marked 0
  the finance team publishes version 5 of the payment-approval policy in KSoR: above 20,000 USD
  the agent drafts INV-2007, 21,000.00 USD: answered, PAY-901
  dsor-scheduler sweeps org_456: asked about 1 policy, 0 unanswered, marked 1
  the notice to cfo_100: Version 8 of rule high-value-payment cites version 4 of "ksor://org_456/finance/payment-approval-policy", and KSoR now has version 5 in force. DSoR marked it stale_authority. It still applies: for its grace of P7D as its on_stale says, require_approval, and after that, on a high-risk operation, it asks a person at least. Draft a version that cites version 5, and switch it on.
  the agent drafts INV-2008, 21,000.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  the agent drafts INV-2009, 900.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  INV-2008's record: high-value-payment version 8, REQUIRE_APPROVAL, cites version 4, superseded_version 4, and beside it the policy's version 5 in force
  cfo_100 drafts version 9 above 20,000.00 USD, still citing version 4: version 9, draft
  cfo_100 switches version 9 on: VALIDATION_FAILED: "rule.activate": version 9 of rule high-value-payment cites version 4 of "ksor://org_456/finance/payment-approval-policy", and KSoR has version 5 in force
  cfo_100 drafts version 10 above 20,000.00 USD, citing version 5: version 10, draft
  cfo_100 switches version 10 on: version 10, active, version 8 retired
  the agent drafts INV-2010, 19,500.00 USD: answered, PAY-902
  the agent drafts INV-2011, 21,000.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
```

What each line shows:

- **The first sweep marks nothing.** KSoR has version 4 in force, the version that version 8 cites,
  with the same fingerprint.
- **INV-2007 is paid after the policy changed.** The finance team published version 5, and DSoR
  has not asked yet. DSoR asks KSoR in the sweep, not at each payment, so the change is found at
  the next sweep, within the 24 hours of §44 when a timer calls it daily (decision D4).
- **The second sweep marks version 8 stale,** and cfo_100, its owner, gets a notice that says what
  changed and what to do (decision D5).
- **Every payment now waits for the CFO,** 900.00 USD too. Version 8 is not dropped: its
  `on_stale` says `require_approval`, so it asks for the CFO on every payment it governs (D7, D8).
- **The record names where version 8 came from.** It cites version 4, with version 4's
  fingerprint, marked `superseded_version` 4, and beside it the policy's version 5 in force
  (decision D11).
- **A version that still cites version 4 never switches on.** KSoR has version 5 in force
  (decision D12).
- **A version that cites version 5 switches on,** and retires stale version 8 in the same change.
  Then 19,500.00 USD is paid, and 21,000.00 USD waits for the CFO, by version 10's own condition.

## Break it

Each break ran on 2026-10-13, in a copy of the step outside the repository, and the copy was
restored after each run. A short script told the story against the copy's own code, in memory. The
output is copied as it was printed.

**B1. Line ⑩ reads only the active versions.** In `src/rulebook.ts`, the versions in force became
the active ones only:

```text
the finance team publishes version 5; dsor-scheduler sweeps: asked 1, unanswered 0, marked 1
the store: v8 stale_authority
the agent drafts INV-2008, 21,000.00 USD: answered, PAY-901
the agent drafts INV-1008, 31,400.00 USD: answered, PAY-902
```

As built, both wait for the CFO. Broken, the stale rule is gone, not stricter: even 31,400.00 USD,
above both lines, is paid. This is the mistake §17.4 names: out of date is still safer than absent.

**B2. The sweep compares version numbers only.** In `src/drift.ts`, the sweep compared the number of
the version in force with the number the rule cites, and not the fingerprint. KSoR's version 4 now
holds another text:

```text
KSoR's version 4 now holds another text; dsor-scheduler sweeps: asked 1, unanswered 0, marked 0
the store: v8 active
```

As built, the sweep marks version 8 stale: the text it was built from is not the text in force.
The number alone cannot tell two texts apart. The fingerprint can.

**B3. The grace never ends.** In `src/controls.ts`, a stale version's grace was never over. Version
8, with `enforce_and_flag`, was marked stale eight days ago, on a `payment.create` rated high:

```text
version 8, enforce_and_flag, marked stale eight days ago, on a high-risk payment.create
the agent drafts INV-2007, 21,000.00 USD: answered, PAY-901
```

As built, INV-2007 waits for the CFO: after its grace, on a high-risk operation, a stale rule asks a
person at least (DSOR-CTL-03c). Broken, `enforce_and_flag` goes on for ever, and the old line of
25,000 USD keeps paying what the new policy sends to the CFO.

**B4. The switch-on does not ask KSoR.** In `src/lifecycle.ts`, line ⑨ of a switch-on lost its
question to KSoR:

```text
cfo_100 drafts version 9, citing version 4: version 9, draft
the finance team publishes version 5
cfo_100 switches version 9 on: version 9, active, version 8 retired
the store: v8 retired, v9 active
dsor-scheduler sweeps: asked 1, unanswered 0, marked 1
the store: v8 retired, v9 stale_authority
```

As built, the switch-on is refused `VALIDATION_FAILED`, and version 8 stays active until the
sweep. Broken, a version built from a policy that is no longer in force goes active, and only the
next sweep finds it, up to a day later. The sweep is a safety net, not the gate.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The learner chose to build both halves of step 28 first, and a visual story after (2026-10-12) |
| 2 | Decide | D1 to D15, each Claude Code's, each with its downside, for the learner's review |
| 3 | The copy | Step 28 copied, its markers removed, and a PostgreSQL of its own |
| 4 | Piece A | The stand-in for KSoR, and DSoR's question to it, red first |
| 5 | Piece B | The store keeps the mark: in memory, migration 024, and on the database, red first |
| 6 | Piece C | Line ⑩ answers for a stale rule as its `on_stale` says, and the record names where each rule came from, red first |
| 7 | Piece D | The sweep, `rule.check_authority`, red first, and two sweeps at once on the database |
| 8 | Piece E | What a rule may cite, and the 30-day ceiling on its grace, red first |
| 9 | Piece F | A switch-on asks KSoR first, red first |
| 10 | Piece G | The program's story |
| 11 | Break it | B1 to B4, in a copy, each restored |
| 12 | Review | A reviewer who had not seen the conversation: one high finding, five medium, six low, and 57 small breaks of its own, 6 of which survived |
| 13 | Fix | H1 and M1 in the code, five guards for the breaks that survived, L2 failing closed, and the README's false sentences, one commit each or a few related together, each test red first and then broken on purpose |

To start it in a new session:

```text
Build step 28b in learner mode from the design in
docs/baby_steps_tutorials/mj_28b_where_a_rule_came_from/README.md.
```

What each move broke, measured. These were not predictions. Each piece was broken on purpose, one
small change at a time, in a copy outside the repository: the unit tests in a copy of their own,
and the database's in a copy with a PostgreSQL server of its own, built again for each break of the
migration.

| Move | What failed |
| --- | --- |
| Piece A | 19 tests, red first: no module. Broken on purpose, 6 ways: an answer about another policy, a version that is not a whole number, the first version taken as in force, another company's KSoR asked, no time limit, and no copy of the answer. Each failed a test |
| Piece B | 17 tests in memory, red first: no `inForce`, no mark, old messages. Then 2 tests of the store's map, and 3 pinned lists on the database: privileges, tables with their locks, and policies. Broken on purpose, 12 ways in memory and 10 on the database. Two survived, and have tests of their own now: a mark that rode with a version switched on again, and the trigger's guard of the mark's time, which only the owner can reach |
| Piece C | 17 tests, red first: a stale rule answered as an active one. Broken on purpose, 13 ways: no floor, the grace ignoring the risk, critical not high, a grace that never ends, one that ends a millisecond late, a deny rule asking for an approval, deny after the grace becoming an approval, the record naming the citation, no `superseded_version`, a refusal with no reason, `require_approval` not read, an unknown `on_stale` changing nothing, and the reasons read at another time. Each failed a test |
| Piece D | 18 tests, red first: no operation. Then 28 pinned old tests: the cross-tenant suite's attacks (138 became 144), fifteen contracts, the scheduler's permissions, the labels, the semantics, and the program's list of operations. Broken on purpose, 11 ways. Two survived, and have tests now: the mark's version in force ignored, and a rule citing another system. One changes nothing a caller can see: the sweep without the rule's lock, since the mark's compare-and-set already orders two changes |
| Piece E | 7 tests, red first. Two tests that expect "taken" passed at once, as a yes does before any code; the refusals beside them guard them. Broken on purpose, 8 ways. Each failed a test |
| Piece F | 6 tests, red first. One of them found a bug, below. Then the program's step 28 story, whose switch-on now needed a KSoR. Broken on purpose, 6 ways. Each failed a test |
| Piece G | 1 test, red first. Broken on purpose: the story's world with no KSoR. It failed |
| H1, the owner and a stale version | 2 tests, red first: both commands answered `CONFLICT`. Broken on purpose: a suspension from active only (1), a retirement that leaves out a stale version (1) |
| M1, the record | 1 test, red first, and the database's and the program's tests changed with it. Broken on purpose: the record naming KSoR's version again (1), nothing beside the controls (1), the record dropping it (1) |
| M2, M3, M4, L1, L6 | Guards, which passed at once. Broken on purpose: the review's five surviving breaks that change what a caller sees, and one more at the end of the fingerprint's form. Each fails a test now |
| L2, a stale row with no mark | No test: no call can make such a row. The read throws, so the call is refused |

## Check yourself

Use the story: org_456's rule `high-value-payment`, version 8, asks for the CFO above 25,000.00
USD. It cites version 4 of the payment-approval policy in KSoR. Its `on_stale` is
`require_approval`, and its grace is 7 days. cfo_100 owns it.

1. The finance team publishes version 5 at 09:00: above 20,000 USD. At 10:00, before any sweep,
   the agent drafts INV-2007, 21,000.00 USD. What does the agent hear, and why?
2. The sweep runs, and marks version 8 stale. The agent drafts INV-1008, 31,400.00 USD. Is version
   8 skipped? What does the agent hear?
3. Then the agent drafts INV-2009, 900.00 USD. What does it hear, and why?
4. cfo_100 drafts version 9, above 20,000 USD, but forgets to change its citation: it still cites
   version 4. cfo_100 switches it on. What happens?
5. KSoR is down when the sweep runs after the change. What happens to version 8?

<details>
<summary>Answers</summary>

1. It is paid. DSoR asks KSoR in the sweep, not at each payment, and the sweep has not run yet. The
   next sweep finds the change: within the 24 hours of §44 when a timer calls it daily (D4).
2. Not skipped: a stale rule is never dropped or skipped (DSOR-CTL-03b). The agent hears
   `PENDING_APPROVAL`, for the CFO, as before.
3. `PENDING_APPROVAL` too. During its grace, version 8 answers as its `on_stale` says:
   `require_approval` asks for the CFO on every payment it governs, small ones too (D8).
4. `VALIDATION_FAILED` at line ⑨: version 9 cites version 4, and KSoR has version 5 in force.
   Nothing changes, and version 8 stays (D12).
5. Nothing. The sweep counts the policy as unanswered, and marks only what it knows. Version 8
   stays active until a sweep hears KSoR's answer (D3, D4). How long DSoR may go without an
   answer is left open.

</details>

## Think it through

### Found while building

- **A switch-on could not replace a stale version.** It looked for the live version among the
  active and suspended ones only. The store counted the stale version as live, and refused the
  switch-on, so the owner heard `CONFLICT`. Piece B's own tests passed the live version in by hand,
  and never went through the command. Piece F's first test of a switch-on that asks KSoR found it.
  One shared definition of a live version is used in both places now.
- **The time of a mark is the database's.** The first build let DSoR's code name the time. Now the
  trigger writes it at a first mark, and DSoR's login has no privilege on the column, so no caller
  can shorten or lengthen a grace.
- **One check was dropped.** A check that a version goes stale after it took effect would have
  refused a later switch-on of a version that was once stale, suspended, and confirmed again.
- **A failure inside the sweep is `INTERNAL_ERROR`.** When a notice cannot be written, the sweep's
  claim rolls back with every mark of the run, and the answer is `INTERNAL_ERROR`, as for every
  earlier command of DSoR's own.
- **A database run timed out under load.** One concurrency test hit its 30 seconds while other
  programs held the machine's load average at 27. The same file alone passed, and the next full
  runs passed.

### The hostile review

A reviewer who had not seen the conversation read the code at piece G, and broke it 57 times in a
copy of its own. It found one high finding, five medium, and six low.

- **H1, fixed: the owner could not suspend or retire a stale version.** The store and the
  database's trigger drew both moves, and `rule.suspend` and `rule.retire` still refused them,
  `CONFLICT`. With a stale rule whose `on_stale` is `deny`, and KSoR down, nobody could stop it
  refusing every payment: the owner could not suspend it, retire it, or switch on a version that
  KSoR could not confirm. The store's own tests had called the store directly. Both commands take
  a stale version now, and three tests go through them.
- **M1, fixed: the record lost the fingerprint of the text the rule enforces.** It named KSoR's
  version 5 and its fingerprint as version 8's authority. An auditor who follows §17.4's chain, from
  the control to its authority, would reach a text that version 8 does not enforce. The authority
  is the version's own citation now, and the version in force goes beside the controls (D11).
- **M2, M3, M4, fixed with tests: three places the code was right and no test held.** The KSoR that
  a switch-on and the sweep ask is the call's own company's; a suspended version switched on again
  is asked about too; and the sweep reads the rules of every operation. A break of each left every
  test green.
- **M5, recorded: DSOR-CTL-03a is met in part.** DSoR detects and marks, and writes the notice in the
  same transaction as the mark. The 24 hours hold only with a timer, which this step does not
  build, and nothing reads or sends the notice yet (D4, D5). `docs/status.md` says so.
- **L1 and L6, fixed with tests:** a fingerprint's form is checked at both ends, and a citation of
  KSoR with no policy is refused.
- **L2, fixed: a stale row with no mark fails closed.** Both stores read one as an active version.
  No call can make such a row, so no test reaches it.
- **L3, recorded:** the sweep asks KSoR inside its own transaction, though D12 keeps that out of a
  switch-on's (D4).
- **L4, recorded:** an owner can leave the check by citing `local` (D13), a question for the
  specification.
- **L5, fixed in D11's words:** between a change in KSoR and the next sweep, the record names the
  cited version with nothing beside it. D11 said KSoR confirmed every version at its switch-on,
  and version 8 came from a file.
- **The README's words.** "Outbox", a transaction, L2, the two refusal codes, SHA-256, and an
  operation's risk are defined where they first appear now. "In plain words" no longer says that a
  timer calls the sweep. D5 no longer calls the rule's guard a lock two paragraphs before D7's
  lock that stays locked.
- **One break changes nothing a caller can see:** the sweep without the rule's lock, since the
  mark's compare-and-set already orders two changes.

### Left open on purpose

- **A timer.** §44's 24 hours hold only if a deployment's timer calls the sweep at least once a
  day. This step builds none, as step 25c built none (D4).
- **No answer for days.** If KSoR is down, or the timer stops, a rule stays active on a policy that
  nobody confirmed. DSOR-IDN-06 makes DSoR deny when a signer's authority cannot be confirmed in
  time. Whether a control whose authority cannot be confirmed in time should count as stale is a
  question for the specification.
- **Sending the notice.** The notice waits in `dsor.notices`. Sending it is step 40's outbox (D5).
- **A policy that KSoR withdraws.** The stand-in never withdraws one, so a policy KSoR does not list
  counts as no answer (D3).
- **Two readings of the specification.** Whether `on_stale` applies to every call the rule governs,
  or only when its condition holds (D8), and what `superseded_version` names (D11). This tutorial
  chose one reading of each, and the specification should say.
- **An owner who leaves the check.** A new version that cites `local` is never asked about, though
  the rule cited KSoR before (D13).
- **The sweep's question inside a transaction.** A stuck KSoR holds the sweep's database connection
  2 seconds for each policy (D4).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-CTL-03a | DSoR detects, within §44's bound, that a control's authority was superseded, marks it `stale_authority`, and notifies its owner | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | Partly. DSoR asks each company's own KSoR itself, with a time limit and a check of the answer. The sweep marks each version whose policy moved, with its record and a notice to its owner, in one transaction, and a switch-on refuses a citation that is not in force. Not met: the bound holds only when a timer calls the sweep daily, which this step does not build, and nothing reads or sends the notice yet. [`test/ksor.test.ts`](test/ksor.test.ts), [`test/rule-check.test.ts`](test/rule-check.test.ts), [`test/rule-check.db.test.ts`](test/rule-check.db.test.ts), [`test/rule-activate.test.ts`](test/rule-activate.test.ts) |
| DSOR-CTL-03b | A stale control is never dropped or skipped | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | Line ⑩ reads the active and the stale versions in one read, and evaluates each stale one as its `on_stale` says, on the database too. [`test/stale-rules.test.ts`](test/stale-rules.test.ts), [`test/rulebook.test.ts`](test/rulebook.test.ts), [`test/rulebook.db.test.ts`](test/rulebook.db.test.ts) |
| DSOR-CTL-03c | After its grace, a stale control on a high or critical operation yields at least `REQUIRE_APPROVAL` | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | The grace runs from DSoR's mark. After it, on a high or critical operation, a stale version asks a person at least, whatever its `on_stale`. The tests rate `payment.create` high and critical to reach it. [`test/stale-rules.test.ts`](test/stale-rules.test.ts) |
| DSOR-CTL-04 | Every decision record names each evaluated control by id and version, with the authority reference and version in force | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | Met in step 27 for a rule that is up to date. Now a stale rule's record keeps the authority it cites, marks it `superseded_version`, and names KSoR's version in force beside the controls, in this tutorial's extensions: this tutorial's reading. [`test/stale-rules.test.ts`](test/stale-rules.test.ts), [`test/rulebook.db.test.ts`](test/rulebook.db.test.ts) |
| DSOR-CTL-02a | Only a control's human owner activates, modifies, suspends, or retires it | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | Step 28's, and now for a stale version too: only its owner, in person, suspends or retires it, with KSoR down too, and a switch-on of a new version retires it. [`test/rule-suspend.test.ts`](test/rule-suspend.test.ts), [`test/rule-activate.test.ts`](test/rule-activate.test.ts) |
| DSOR-CTL-01b | A control with no governed source declares `authority.system: local` | [§17.2 Control record](../../../specs/dsor/02-security.md#172-control-record) | A rule that cites `local` is drafted, switched on, and never asked about. A rule that cites any other system than KSoR is refused. [`test/citations.test.ts`](test/citations.test.ts), [`test/rule-activate.test.ts`](test/rule-activate.test.ts) |
| DSOR-BND-02 | A tenant-level setting never loosens a §44 limit | [§44 Operational bounds](../../../specs/dsor/06-conformance.md#44-operational-bounds) | A rule on a high or critical operation whose grace is longer than 30 days is refused at a draft and at start-up. [`test/citations.test.ts`](test/citations.test.ts) |

## Next

Step 29 · Approvals. `proposal.approve`: the approver logs in to DSoR in person, and the approval
is tied to a fingerprint of the exact request, and expires. The CFO that version 8 has been asking
for can answer at last.
