# Step 28b · Where a rule came from

**New in this step:** a stand-in for KSoR. When the policy that a rule came from changes, DSoR
marks the rule *stale*, tells its owner, and keeps the rule in force.

## In plain words

A *policy* is a sentence that people in the company write and agree on, such as "payments above
25,000 USD or equivalent need the CFO". The company keeps its policies in KSoR, the record of what
the company knows. Each policy has *versions*: when the finance team changes the sentence, KSoR
keeps the old text and adds a new version. Each version has a *fingerprint*, a short code computed
from its exact text (the specification calls it `content_hash`). Two different texts never get the
same fingerprint in practice.

A rule in DSoR is a policy translated into a condition that a program can check. Since step 27
each rule names the policy it came from: which system, which policy, which version, and the
fingerprint. The specification calls this the rule's *authority*. So version 8 of
`high-value-payment` says: "I was built from version 4 of the payment-approval policy."

In this step DSoR checks that link. DSoR's own *sweep*, a command that a timer calls once a day,
asks KSoR which version of each policy is now in force. When the answer is no longer the version
that a rule cites, DSoR marks the rule `stale_authority` (*stale*: out of date) and leaves a
*notice* for the rule's owner. A stale rule is never switched off by DSoR. For a time that the
rule itself names, its *grace* (`stale_grace`), it behaves as its `on_stale` says: keep going as
before, ask a person every time, or refuse every time. After the grace, on a high-risk operation,
it asks a person at least. Every decision's record names the version of the policy that was in
force. And a person can no longer switch on a version that cites a policy version that is not in
force.

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
  confirmed. That is left open, as a question for the specification.
- **D5. The mark and the notice are one step of the store.** The version moves from `active` to
  `stale_authority`. DSoR keeps the time of the mark and the version in force, with its
  fingerprint. It writes a `control_change` record, and a notice to the version's owner. All of it
  happens, or none of it, under the rule's lock. A version that is stale already, whose policy
  moved again, keeps the time of its first mark and gets the new version in force, a record, and
  a new notice. *Downside:* nothing is sent. The notice waits in DSoR's store, `dsor.notices` on
  the database, for a mailer that this tutorial does not have. Sending it is step 40's idea, the
  outbox. Until then the owner reads the store.
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
- **D10. §44's ceiling on the grace.** This tutorial claims L2, so a rule on a high or critical
  operation may have a grace of at most 30 days. The draft check and start-up refuse a longer one.
  *Downside:* a company that wants 45 days on a high-risk operation cannot have it at L2.
- **D11. The record names the policy in force (DSOR-CTL-04).** Line ⑪'s record names each rule
  that line ⑩ evaluated, by id and version, with `authority`: the policy as DSoR last learned it is
  in force. For a version that is up to date, that is its own citation, which KSoR confirmed when
  the version was switched on. For a stale version, it is its citation with KSoR's version and
  fingerprint in force, and `superseded_version` names the version that the rule cites. The
  specification does not explain `superseded_version`, so this reading is this tutorial's, and a
  question for the specification. *Downside:* a reader who skips `superseded_version` may think
  the rule was built from the version in force.
- **D12. A switch-on asks KSoR first.** `rule.activate`'s line ⑨ asks KSoR about the policy that
  the version cites. It refuses `VALIDATION_FAILED` when KSoR has another version in force, or
  another fingerprint for that version. It refuses `FRESHNESS_UNSATISFIABLE` when KSoR does not
  answer: DSoR cannot confirm the policy now, so the owner tries again later. A version that cites
  `local` has no policy to ask about. *Downside:* KSoR is asked at line ⑨ only, and not again
  inside the change, so that no network call waits inside the database's transaction. A policy
  published between the two is found by the next sweep.
- **D13. A rule cites a source that this step can check:** `ksor`, with a policy of the rule's own
  company (`ksor://org_456/…`), or `local`, the specification's word for a rule with no governed
  source (DSOR-CTL-01b). A draft and start-up refuse any other system, because no sweep could ever
  find it superseded. *Downside:* a company whose policies live in another system marks its rules
  `local`, and loses the check.
- **D14. Start-up accepts `stale_authority` in the store, and never from a file.** Step 27
  refused the status at start-up (its review, finding M2), because nothing evaluated a stale rule
  yet. Now line ⑩ does, so a stale version in the store is checked, and its tests run, as an
  active one's do. A controls file cannot hold DSoR's mark, so a stale version in a file stops
  start-up. *Downside:* a file cannot describe a stale rule for a test. The tests reach one through
  the sweep, as the program does.
- **D15. The tests rate `payment.create` high, to prove DSOR-CTL-03c.** No operation that a rule
  may govern is high in this tutorial: `invoice.issue` and `payment.create` are medium, and
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
| C7 | The record names each rule's id and version, the policy in force, and the version a stale rule cites |
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
