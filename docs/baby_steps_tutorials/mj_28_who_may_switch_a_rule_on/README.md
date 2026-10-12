# Step 28 · Who may switch a rule on

**New in this step:** org_456's rules move from a file into DSoR's own store, and only each
rule's human owner can switch it on, change it, suspend it, or retire it. An agent never can.

## In plain words

In step 27, org_456's rules lived in a file, `controls.json`, which DSoR read when it started. A
rule could change only through an edit of that file and a restart, and nothing asked who made the
edit. In this step the rules move into DSoR's own store, and people change them through DSoR, with
four commands: draft a new version, switch a version on, suspend it, and retire it. Only the
rule's *owner*, the person whose name the rule carries, may switch it on, suspend it, or retire
it. Switching a rule on runs its sample cases first, as start-up did in step 27. An agent may
never do any of it, whatever its permission slip says. In the new clerk's picture from step 27:
only the person named on a card may put the card on the clerk's desk, or take it off.

## Why it matters

user_123, the AP supervisor, wants INV-1008, 31,400.00 USD, paid today, without waiting for the
CFO. admin_100, the tenant administrator, can change the company's settings. If DSoR let any
administrator change a rule, admin_100 could write version 10 of the CFO rule with the condition
`false`, name themselves its owner, and switch it on. The agent's next draft for INV-1008 would be
paid, and its record would show a rule that "allowed" it. An agent with a wide permission slip
could do the same, and switch off the very rule that governs it. §17.4 says that only a human may
switch a control on, change it, or retire it, and that an agent may only write a draft.

## The design, before any code

The circled numbers are lines of DSoR's checklist, which every call runs through in order, as a
pilot runs through a checklist: ⑤ checks the caller's permission, ⑥ the input, ⑧ makes the
proposal, ⑨ is DSoR's own look before any work, ⑩ checks the rules and the limits, and ⑪ writes
the record.

### How this step was made

The learner chose to build first and understand afterwards, as in step 27 (2026-10-12). So every
decision below is Claude Code's, for the learner to review, and each one says what it costs.

### What each rule says

- **DSOR-CTL-02a:** a control "MUST be activated, modified, suspended, or retired only by its human
  control owner" ([§17.4](../../../specs/dsor/02-security.md#174-lifecycle-and-drift)).
- **DSOR-CTL-02b:** "An agent principal MUST NOT activate a control."
- **DSOR-CTL-02c**, met in step 27 at start-up: activation "MUST run the control's test vectors and
  fail if any vector fails". This step runs them when a person switches a rule on.
- **DSOR-CTL-01a**, met in step 27: a control names "a named human owner". This step checks that
  the owner is a person.

### Decisions (Claude Code)

- **D1. Step 28 is built in two halves.** This half is "who may switch a rule on": DSOR-CTL-02a and
  DSOR-CTL-02b. Step 28b, "where a rule came from", adds a stand-in for KSoR, a rule that goes
  stale when its policy changes, and its owner told (DSOR-CTL-03a, DSOR-CTL-03b). They are two new
  ideas, and the build skill says to split such a step, as steps 19 and 25 were. *Downside:* two
  folders, and the map's step 28 is complete only with 28b.
- **D2. The rules live in DSoR's own store,** `dsor.controls` on the database and a store in
  memory for the unit tests: one row for each version of a rule, with its status. A version's
  rule text never changes after its draft. A change is a new version. *Downside:* an edit of
  `controls.json` no longer changes a running DSoR.
- **D3. The shipped `controls.json` fills a store in memory.** On the database, migration 023 adds
  the same rule, org_456's `high-value-payment` version 8, active, as earlier migrations add the
  story's invoices and slips. *Downside:* the story's rule is written in two places, the file and
  the migration. A test keeps them equal.
- **D4. One live version of a rule at a time.** Live means active or suspended. Switching version
  9 on retires version 8, in the same change. On the database, a unique index keeps it so.
  *Downside:* two versions of one rule can never run side by side, for example as a trial.
- **D5. Line ⑩ reads the active rules from its world's store at every call,** as line ④ reads the
  brakes. A change applies to the next call. Each world gives the same store to its registry and
  to its claims, as with the brakes, so a change that a command makes is the change that line ⑩
  reads. *Downside:* one more read at every call.
- **D6. Start-up checks every version in its world's store, as step 27 checked the file:** the
  schema, the CEL, the effect, what the rule governs, and its owner. It runs the sample cases of
  each active version. One that fails stops DSoR. The program checks `dsor.controls` too, for each
  company where a login works. *Downside:* a row that someone edits by hand in the database after
  start-up runs unchecked until the next start.
- **D7. Four commands: `rule.draft`, `rule.activate`, `rule.suspend`, and `rule.retire`.** Step 25b
  named its emergency brake `control.suspend` and `control.lift`, so these use the word "rule". A
  rule's address is `dsor://org_456/rule/high-value-payment`, and a command names the version by
  its number. *Downside:* the specification calls them controls, and the names say rule.
- **D8. Two permissions: `rule:draft` to write a draft, and `rule:manage` to switch a version on,
  suspend it, or retire it.** The CFO role and the tenant administrator hold both. A permission
  lets a person ask. Only the owner check at line ⑨ lets the change happen. *Downside:* a tenant
  administrator holds a permission that, alone, changes nothing.
- **D9. The four commands are for people only,** with step 25's `people_only` field, so line ⑤
  refuses an agent and an application in every mode, whatever a slip lists (DSOR-CTL-02b). §17.4
  says that an agent MAY draft a rule. No agent in the story has a slip for it, and step 28b's
  policy compiler may add one. *Downside:* the specification's "an agent may draft" is not shown
  here.
- **D10. The owner check, at line ⑨.** A rule's *owner of record* is the owner of its newest
  version that was ever switched on. A version is switched on only by its own owner, and only when
  that person is the owner of record too, if the rule has one. A suspension or a retirement is
  made by the owner of record, or, for a rule that was never switched on, by the version's own
  owner. The caller must be that person, in person: never an agent. So admin_100 can draft a
  version 10 that names admin_100, and can never switch it on. *Downside:* a rule never passes to
  a new owner in this step. An owner who leaves the company leaves the rule with no one to change
  it.
- **D11. `rule.draft` checks the draft at line ⑨ and adds it as the next version, `draft`:** the
  schema, the CEL, the effect, what it governs, and its owner: a person with a login in the
  company. DSoR sets the id, the version, the status, and `compiled_by`, the person who wrote it.
  Its sample cases run when it is switched on, as DSOR-CTL-02c says. *Downside:* a draft whose
  cases fail waits in the store until someone tries to switch it on.
- **D12. `rule.activate` switches a draft or a suspended version on.** Line ⑨ checks the owner,
  then the version, then its status, then the draft's checks again, then its sample cases. A
  failing case answers `VALIDATION_FAILED` and names the case. The work makes the version active,
  retires the live version, and sets `reviewed_by` to the owner and `effective_from` to DSoR's
  clock, as `control.schema.json` asks of an active control. *Downside:* the owner reviews and
  switches on in one act. No second person checks.
- **D13. `rule.suspend` switches the active version off; `rule.retire` ends a draft, an active, or
  a suspended version for good.** A suspended version can be switched on again. A retired one
  cannot. *Downside:* the owner can switch the CFO rule off, and payments then go through without
  the CFO, by the owner's choice.
- **D14. Each change writes a record of the audit record's own kind, `control_change`,** in the
  same transaction as the change: who, which rule, the version and the status it moved to and
  from, and the reason the person gives. *Downside:* none found.
- **D15. The change checks again, under the rule's lock.** Line ⑨ looked a moment before, and
  another call may have changed the rule since. On the database, the change takes a lock on the
  rule until its transaction ends, reads the versions again, and makes the same checks, except
  the sample cases: a version's text never changes. *Downside:* two changes to one rule wait for
  each other.
- **D16. A refusal follows step 25's tear-up:** a person who may not change a rule hears
  `AUTHORIZATION_DENIED`, whether the rule and the version exist or not, so the refusal tells
  nothing about which rules exist (DSOR-ERR-01b). The owner hears `RESOURCE_NOT_FOUND` for a
  version that is not there, and `CONFLICT` for a move the status does not allow. *Downside:* a
  person who mistypes a rule's id hears "only its owner".
- **D17. Four statuses are built: `draft`, `active`, `suspended`, and `retired`.** `in_review` is
  never set, because the owner's switch-on is the review. `stale_authority` stays refused at
  start-up until step 28b. *Downside:* a rule cannot wait for review by a second person.
- **D18. The earlier steps' tests and stories keep their idea, with no rules,** as in step 27:
  their worlds give an empty store, on the database too, where the store holds version 8.
  *Downside:* as in step 27, most test worlds have no CFO rule.

### The story's numbers

| Who | Asks | DSoR answers |
|---|---|---|
| the agent | drafts INV-1012, 22,750.00 USD | paid: version 8 asks for the CFO above 25,000 |
| cfo_100, the owner | drafts version 9: above 20,000 USD, the CFO | `draft`, version 9 |
| admin_100, a tenant administrator | drafts version 10: the condition `false`, admin_100 its owner | `draft`, version 10: a draft changes nothing |
| admin_100 | switches version 10 on | `AUTHORIZATION_DENIED`: only the rule's owner |
| the agent | switches version 9 on | `AUTHORIZATION_DENIED` at line ⑤: for people only |
| cfo_100 | drafts version 11 with step 27's quick rule, and switches it on | `VALIDATION_FAILED`: it fails its sample case 3 |
| cfo_100 | switches version 9 on | version 9 `active`, version 8 `retired` |
| the agent | drafts INV-2007, 21,000.00 USD | waits for the CFO: version 9 applies at once |
| cfo_100 | suspends version 9 | `suspended`: no rule is in force |
| the agent | drafts INV-1008, 31,400.00 USD | paid without the CFO, by the owner's choice |
| cfo_100 | switches version 9 on again | the agent's draft of INV-1004, 27,300.00 USD, waits for the CFO |

### The tests, by claim

| Claim | What it says |
|---|---|
| C1 | The store keeps each version with its status, one live version at a time, behind its company's lock on the database |
| C2 | Line ⑩ reads the store at every call: a version switched on applies to the next call, and a suspended one stops |
| C3 | `rule.draft` checks the draft, its owner a person of the company, adds the next version, and names who wrote it |
| C4 | `rule.activate` lets only the version's owner, who is the owner of record too, switch it on, runs its sample cases, and retires the live version |
| C5 | `rule.suspend` and `rule.retire` let only the owner of record change the status |
| C6 | An agent can do none of it, in any mode, whatever its slip lists: line ⑤ refuses it, and the owner check refuses it too |
| C7 | Each change has its `control_change` record, in the same transaction, and checks again under the rule's lock |
| C8 | Start-up checks every version in the store, runs the sample cases of the active ones, and refuses to start on one that fails |

### Breaks we will try, and what we expect

| Break | What we expect | The learner predicted |
|---|---|---|
| B1. Switching on checks only the version's own owner, not the owner of record | admin_100 switches on version 10, which names admin_100, and INV-1008 is paid without the CFO | (asked at the review) |
| B2. `rule.activate` loses `people_only` | line ⑤ lets the agent through, and the owner check at line ⑨ still refuses it: an agent is never an owner | (asked at the review) |
| B3. Switching on skips the sample cases | version 11, the quick rule, goes active, and rupees pass without the CFO | (asked at the review) |
| B4. Line ⑩ keeps the rules it read at start-up | a version switched on never applies, and a suspended one still holds INV-1008 | (asked at the review) |

### Left open, and not this half's idea

- A rule that goes stale when its policy changes, the stand-in for KSoR, and the owner told: step
  28b.
- An agent that drafts a rule, a second person who reviews it, and a rule handed to a new owner.
