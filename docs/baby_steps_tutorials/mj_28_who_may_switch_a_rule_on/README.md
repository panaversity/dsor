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
  schema, the CEL, the effect, what the rule governs, its owner, and its id. It runs the sample
  cases of each active version, and refuses a draft that names a reviewer or a time it took effect,
  because a draft was never switched on. One that fails stops DSoR. The program checks `dsor.controls` too, for each
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
- **D19. org_789 gets a tenant administrator, admin_700.** Step 12's cross-tenant suite attacks
  every operation from both companies, as a person who may call it, and nobody in org_789 held a
  rule permission. *Downside:* one more login, and the suite's counts change: 138 attacks, where
  step 27 made 93. Found while building.
- **D20. A draft is switched on only by the owner who wrote it.** DSoR shows no version's text yet,
  so this is how the owner has read every word they switch on. A version that was switched on
  before was reviewed then, so its owner may switch it on again, whoever wrote it. Found by the
  hostile review (finding M4): cfo_100 switched on, by its number, a version 9 that admin_100
  wrote, which said `false`. *Downside:* a version that someone else wrote must be written again by
  the owner. A read of a version, and a fingerprint that ties a switch-on to the text it names,
  wait for step 28b, whose policy compiler will write drafts for owners.

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

## Before you build: set up a database

As in step 27: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Migration 023 runs: it makes `dsor.controls`, its lock, its two
policies, and its index, lets `dsor.audit` take a `control_change` record, and adds org_456's
`high-value-payment` version 8, active.

Give the step a server of its own, or at least a database of its own with its own `.env`.
`pnpm migrate` sets `dsor_runtime`'s password for the whole PostgreSQL server, so a second step
migrated on the same server changes the first step's login.

## What changed since step 27

| File | What changed |
| --- | --- |
| `src/rulebook.ts` | **New.** The store of each company's rules: every version with its status, a store in memory filled from a controls file, an empty store for the earlier steps' worlds, the moves a version may make, and start-up's check of a store |
| `src/lifecycle.ts` | **New.** The four commands' own work: the draft, the switch-on, the suspension, and the retirement. The owner of record, the owner check, and the change under the rule's lock |
| `migrations/023_controls.sql` | **New.** `dsor.controls`, its lock, `starts_as_draft` and `moves_on`, the index of one live version, the record's new kind, and version 8 |
| `contracts/rule.*.json`, `inputs/Rule*Request.schema.json`, `examples/rule.*.json` | **New.** The four commands, for people only, their inputs, and the cross-tenant suite's examples |
| `src/controls.ts` | A control's whole shape. Step 27's file check in two parts: the file's own shape, and one check for one control, which now checks its owner and its id too |
| `src/registry.ts`, `src/pipeline.ts`, `src/claims.ts`, `src/revocation.ts` | The registry holds the store and the check of one control. Line ⑩ reads the store at every call. The claim's work and line ⑨'s look get the rules |
| `src/postgres.ts`, `src/log.ts` | `dsor.controls` on the database, under the rule's lock, and the `control_change` record |
| `roles.json`, `classifications.json`, `store.json`, `src/principals.ts` | `rule:draft` and `rule:manage` for the CFO and the tenant administrator, the labels of a rule's answer, the map's new table, and admin_700 (decision D19) |
| `src/main.ts` | Start-up checks `dsor.controls`. The story of who may switch a rule on, in memory |
| `test/rule-world.ts`, `test/owner-rules.ts`, and six new test files | **New.** The claims C1 to C8, in memory and on the database |
| The other tests | Start-up's tests wait for a store. The pinned lists of contracts, logins, roles, privileges, policies, and attacks. The secrets test's time limit (Think it through) |

Step 27's markers are gone, as the build skill (`.claude/skills/build-baby-step`) asks. A search
for "NEW IN STEP" finds only this step's lesson.

```bash
git diff --no-index ../mj_27_controls_in_cel/src src
git diff --no-index ../mj_27_controls_in_cel/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

Start-up checks the story's store, filled from `controls.json`, as step 27 did. After the database
matches its map, start-up checks every version in `dsor.controls` too, and says so:

```text
dsor.controls passed its checks too; the program's stories keep their rules in memory
```

From a real run on 2026-10-12, shortened. After step 27's story, the program tells who may switch a
rule on, in memory, in a world whose store starts from `controls.json`.

```text
who may switch a rule on, in memory, with a store of its own:
  the agent drafts INV-1012, 22,750.00 USD: answered, PAY-901
  cfo_100 drafts the rule above 20,000.00 USD: version 9, draft
  admin_100 drafts the rule false, naming admin_100 its owner: version 10, draft
  admin_100 switches version 10 on: AUTHORIZATION_DENIED: "rule.activate": admin_100 may not change rule "high-value-payment": only its owner may, in person
  the agent switches version 9 on: AUTHORIZATION_DENIED: "rule.activate" is for people only, and accounts-payable-fte is not a person
  cfo_100 drafts step 27's quick rule: version 11, draft
  cfo_100 switches version 11 on: VALIDATION_FAILED: "rule.activate": org_456's control high-value-payment v11 fails its test 3: expects REQUIRE_APPROVAL, gives ALLOW; org_456's control high-value-payment v11 fails its test 5: expects REQUIRE_APPROVAL, gives ALLOW
  cfo_100 switches version 9 on: version 9, active, version 8 retired
  the agent drafts INV-2007, 21,000.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  cfo_100 suspends version 9: version 9, suspended
  the agent drafts INV-1008, 31,400.00 USD: answered, PAY-902
  cfo_100 switches version 9 on again: version 9, active
  the agent drafts INV-1004, 27,300.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z
  the record: version 9 draft, new, by cfo_100: the board lowered the line to 20,000 USD
  the record: version 10 draft, new, by admin_100: no more waiting for the CFO
  the record: version 11 draft, new, by cfo_100: a quicker rule
  the record: version 8 retired, from active, by cfo_100: the new line
  the record: version 9 active, from draft, by cfo_100: the new line
  the record: version 9 suspended, from active, by cfo_100: audit week
  the record: version 9 active, from suspended, by cfo_100: audit over
```

What each line shows:

- **INV-1012 is paid.** 22,750.00 USD is below version 8's 25,000.00 USD.
- **Two drafts change nothing.** Version 9 and version 10 wait in the store. A draft is a proposal
  of a rule, and line ⑩ reads only the active version.
- **admin_100 cannot switch version 10 on.** admin_100 holds `rule:manage`, and named themselves
  the version's owner. The rule's owner of record is still cfo_100, the owner of version 8, the
  newest version ever switched on (decision D10).
- **The agent cannot either.** Line ⑤ refuses it before anything else: the four commands are for
  people only (decision D9).
- **The quick rule fails its tests.** Version 11 compares the number and forgets the currency. Its
  tests 3 and 5 expect the CFO, and it allows both, so it never switches on (DSOR-CTL-02c).
- **cfo_100 switches version 9 on,** and version 8 retires in the same change (decision D4).
- **INV-2007 now waits for the CFO.** 21,000.00 USD is above version 9's 20,000.00 USD, and line ⑩
  read the store at this call (decision D5).
- **The suspension lets INV-1008 through.** With version 9 suspended, no rule is in force. That is
  the owner's choice, and the record names who made it, and why (decision D13).
- **The records** name each change, the person, and the reason, in the order they happened.

## Break it

Each break ran on 2026-10-12, in a copy of the step outside the repository, and the copy was
restored after each run. A short script told the story against the copy's own code. The output is
copied as it was printed. The first lines, the payment of INV-1012 and the two drafts, are left out.

**B1. Switching on checks only the version's own owner.** In `src/lifecycle.ts`, the owner who
decides became `version?.owner`, the owner the version names:

```text
admin_100 switches version 10 on: version 10, active, version 8 retired
the agent drafts INV-1008, 31,400.00 USD: answered, PAY-902
the store: v8 retired, v9 draft, v10 active
```

As built, the same story ends with `AUTHORIZATION_DENIED`, and INV-1008 waits for the CFO. The
version said who owns it, and a check that believes the thing it checks checks nothing. The owner of
record comes from the store's history.

**B2. `rule.activate` loses `people_only`.** The firm's agent works under a slip that cfo_100
signed, which lists `rule:manage`:

```text
the firm's agent, under cfo_100's slip, switches version 9 on: AUTHORIZATION_DENIED: "rule.activate": firm-ap-fte may not change rule "high-value-payment": only its owner may, in person
```

As built, line ⑤ refuses it ("is for people only"). Broken, line ⑤ lets it through, and line ⑨
refuses it: an agent is never an owner, and the owner decides in person. Two locks, and either one
holds.

**B3. Switching on skips the sample cases.** In `src/lifecycle.ts`, line ⑨ checked version 11 with
its tests left out:

```text
cfo_100 switches it on: version 11, active, version 8 retired
the agent drafts INV-2004, 14,000,000.00 PKR: answered, PAY-902
```

As built, the switch-on is refused `VALIDATION_FAILED`, and INV-2004, about 46,300 USD, waits for
the CFO. The quick rule sees "not USD" and lets the rupees through.

**B4. Line ⑩ keeps the rules it read first.** In `src/pipeline.ts`, line ⑩ kept the active rules of
its first read of each operation, as a book read once at start-up would:

```text
cfo_100 switches version 9 on: version 9, active, version 8 retired
the agent drafts INV-2007, 21,000.00 USD: answered, PAY-902
cfo_100 suspends version 9: version 9, suspended
the agent drafts INV-1008, 31,400.00 USD: PENDING_APPROVAL
the store: v8 retired, v9 suspended, v10 draft
```

Both answers are wrong. Version 9 never applies, so INV-2007 is paid. Version 8 still answers
though it is retired, so INV-1008 waits. A change the owner made is a change the next call must
meet.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The session of 2026-10-12 began from zero. The learner asked for the build first, and a visual story after |
| 2 | Decide | D1 to D18, each Claude Code's, each with its downside, for the learner's review. D19 came while building |
| 3 | The copy | Step 27 copied, its markers removed, and a PostgreSQL of its own |
| 4 | Piece A | The store in memory, read by line ⑩ at every call, and start-up's check of a store, red first |
| 5 | Piece B | `dsor.controls`: migration 023, the store on the database, red first |
| 6 | Piece C | `rule.draft`, and the four contracts, red first |
| 7 | Piece D | `rule.activate`, red first, and its race on the database |
| 8 | Piece E | `rule.suspend` and `rule.retire`, red first |
| 9 | Piece G | The program: start-up checks `dsor.controls`, and the story |
| 10 | Break it | B1 to B4, in a copy, each restored |

To start it in a new session:

```text
Build step 28 in learner mode from the design in
docs/baby_steps_tutorials/mj_28_who_may_switch_a_rule_on/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Piece A | 13 tests, red first: no store. Then step 27's start-up tests, which now wait for a store. Broken on purpose: line ⑩ keeping its first read (6 tests, then 1 with a cache for each world) |
| Piece B | 14 tests, red first. Then 4 old tests that pin the privileges, the locks, the policies, and the planted catalog. Broken on purpose: DSoR's own WHERE on the company gone (1), a move with no record (2), line ⑩ reading every status (1) |
| Piece C | 25 tests, red first. Then 32 old tests: the pinned lists of contracts, logins, roles, labels, and the cross-tenant suite's attacks. Broken on purpose: no owner check (4), drafts open to agents (3), line ⑥ letting a draft set DSoR's own fields (6), no size limit (1), a draft numbered from line ⑨'s look (4) |
| Piece C, the break of line ⑥ | It found a hole: a draft that named a time it took effect counted as switched on before, and could make its own owner the owner of record. 2 tests, red first, then DSoR keeps only a rule's text, and start-up refuses such a draft |
| Piece D | 10 tests, red first. Broken on purpose: the version's own owner deciding (3), no tests at a switch-on (2), the command open to agents (3), a change that trusts the look (1), the live version left active (3), no lock on the rule (1). "In person" survived, and has a test of its own now |
| Piece E | 8 tests, red first. Broken on purpose: a suspension from any status (1), a move with no record (1). A retired version allowed back in the store, and a suspension whose line ⑨ checks nobody, survived, and have tests of their own now |
| Piece G | Broken on purpose: start-up skipping `dsor.controls` (1), the story's claims keeping no rules (1) |

## Check yourself

Use the story: org_456's rule `high-value-payment`, version 8, asks for the CFO above 25,000.00
USD. cfo_100 owns it. admin_100, a tenant administrator, holds `rule:draft` and `rule:manage`.

1. admin_100 drafts version 10 with the condition `false`, names admin_100 its owner, and asks to
   switch it on. What does admin_100 hear, and why?
2. cfo_100 drafts version 9, above 20,000.00 USD, and switches it on. The agent drafts INV-2007,
   21,000.00 USD, a moment later. What does the agent hear?
3. cfo_100 suspends version 9. The agent drafts INV-1008, 31,400.00 USD. What happens, and who
   chose it?
4. The agent works under a slip that cfo_100 signed, which lists `rule:manage`. It asks to switch
   version 9 on. What does it hear, and which line refuses it?
5. cfo_100 drafts a version with step 27's quick rule and asks to switch it on. What happens?

<details>
<summary>Answers</summary>

1. `AUTHORIZATION_DENIED`: only the rule's owner may, in person. The owner of record is cfo_100,
   the owner of version 8, the newest version ever switched on. A version's own words do not make
   its writer the owner (decision D10).
2. `PENDING_APPROVAL`, for the CFO. Line ⑩ reads the store at every call, so version 9 applies at
   once (decision D5).
3. It is paid. With version 9 suspended, no rule is in force. cfo_100, the owner, chose it, and the
   record names cfo_100 and the reason (decision D13).
4. `AUTHORIZATION_DENIED`, at line ⑤: the four commands are for people only, whatever a slip lists
   (decision D9, DSOR-CTL-02b). If line ⑤ ever let it through, line ⑨ would refuse it: an agent is
   never an owner.
5. `VALIDATION_FAILED`, before any work. The switch-on runs the version's tests, and the quick rule
   fails tests 3 and 5 (DSOR-CTL-02c). Nothing changes.

</details>

## Think it through

### Found while building

- **A draft could forge its history.** Line ⑥ refuses a draft that names `effective_from`. With that
  check broken on purpose, a draft that named a time counted as a version switched on before, and
  its own owner became the owner of record. Line ⑥ held, and the database refuses such a row too.
  DSoR now keeps only the fields of a rule's text from a draft, and start-up refuses a draft that
  names a reviewer or a time it took effect.
- **Org_789 had nobody to attack the rule commands.** Step 12's cross-tenant suite attacks each
  operation from both companies, as a person who may call it. Org_789 has no CFO and no tenant
  administrator, so admin_700 joined the logins (decision D19).
- **The secrets test ran out of time.** It runs every database test file with no database named,
  and expects each to fail at once. On a machine at load 23, beside step 28's heavier cross-tenant
  suites, that took 88 to 124 seconds, and 35 alone. Its limit rose from one minute to three. A run
  that hangs is still stopped.
- **The earlier steps' worlds on the database read no rules.** Migration 023 adds version 8, active,
  to `dsor.controls`. A world of an earlier step gives its registry the empty store, so line ⑩ reads
  nothing there, while its claims work on the database. In such a world a draft written by
  `rule.draft` still lands in `dsor.controls`. No earlier test drafts a rule, and the cross-tenant
  suite's drafts are removed by the step's own database tests. Step 25b's brakes have the same
  shape.

### Left open on purpose

- A rule that goes stale when its policy changes, the stand-in for KSoR, and the owner told: step
  28b.
- An agent that drafts a rule (§17.4 allows it), a second person who reviews a draft, and a rule
  handed to a new owner.
- A row of `dsor.controls` edited by hand after start-up runs unchecked until the next start
  (decision D6).

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-CTL-02a | A control is activated, modified, suspended, or retired only by its human control owner | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | Only the owner of record, in person, switches a version on, suspends it, or retires it. admin_100's version 10 never switches on. A change is a new version, which the owner switches on. [`test/rule-activate.test.ts`](test/rule-activate.test.ts), [`test/rule-suspend.test.ts`](test/rule-suspend.test.ts), [`test/rule-draft.test.ts`](test/rule-draft.test.ts), [`test/rule-activate.db.test.ts`](test/rule-activate.db.test.ts) |
| DSOR-CTL-02b | An agent principal never activates a control | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | Line ⑤ refuses an agent in every mode, whatever its slip lists, and line ⑨ refuses one that passed line ⑤. [`test/rule-activate.test.ts`](test/rule-activate.test.ts), [`test/rule-draft.test.ts`](test/rule-draft.test.ts) |
| DSOR-CTL-02c | Activation runs the control's tests, and fails when one fails | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | Met at start-up in step 27, and now at a switch-on too: the quick rule fails its tests, and a dry run says so. [`test/rule-activate.test.ts`](test/rule-activate.test.ts) |
| DSOR-CTL-01a | A control names a human owner | [§17.2 Control record](../../../specs/dsor/02-security.md#172-control-record) | Met in step 27, and now checked: a draft, and a version at start-up, whose owner is not a person of its company is refused. [`test/rule-draft.test.ts`](test/rule-draft.test.ts) |
| DSOR-CTL-04 | The decision's record names each control by id and version | [§17.4 Lifecycle and drift](../../../specs/dsor/02-security.md#174-lifecycle-and-drift) | Partly, since step 27: the record names the version read from the store at the call. The authority's version in force is step 28b's. [`test/rulebook.test.ts`](test/rulebook.test.ts) |
| DSOR-TEN-01b | DSoR's own WHERE names the company first, with the database's lock behind it | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | Still met, on `dsor.controls`: run by the owner, which no policy filters, org_456's reads and moves never touch a twin rule in org_789. [`test/rulebook.db.test.ts`](test/rulebook.db.test.ts) |

## Next

Step 28b · Where a rule came from. Each rule points at the exact policy sentence and version it was
built from. When the policy changes in a stand-in for KSoR, DSoR marks the rule stale and tells its
owner, and a stale rule is never skipped.
