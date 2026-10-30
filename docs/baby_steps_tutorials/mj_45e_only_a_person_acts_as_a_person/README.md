# Step 45e · Only a person acts as a person

**New in this step:** a company's answer says what kind of account it is about, and whose ids it
uses. DSoR acts as a person only on `human`: at a person's own call, for a slip's signer, at an
approval, and at a release (DSOR-SOD-01a, DSOR-SOD-01b, DSOR-IDN-01).

## In plain words

Since step 45, DSoR keeps no table of people. It asks each company's sign-in server about a person,
and the answer gives her status and her roles. It does not say whether a person is behind the
account. So DSoR calls every account that a token names a person, unless its own table names that
account as an agent, an application, or a timer job. A script account that a company lists as CFO
can then approve a payment, read for itself, and stand behind an agent's slip.

This step adds two fields to the company's answer. `type` says what kind of account it is: `human`,
`agent`, `application`, or `system`, the four kinds of §12. `issuer` says whose ids the answer uses:
the sign-in server that gave the person her id. DSoR acts as a person only when the type is
`human`, and uses an answer only when its issuer is the server that issues DSoR's tokens.

Think of the new clerk again. The clerk phones HR about each name on a form. Until now HR said only
"CFO, active". Now HR also says "a person" or "a machine", and from which staff list it read the
name. The clerk lets only a person sign, and does not use an answer read from another company's
list.

**Words this step uses.**

- The *type* of an account is its kind (§12): `human` is a person; `agent` is an AI worker, such as
  `accounts-payable-fte`; `application` is a program, such as an export script; `system` is a
  background job, such as `dsor-scheduler`.
- A *script account* is an ordinary account at a company's sign-in server that a program uses. It
  signs in with a password, as a person does.
- The *issuer* is the sign-in server that gives a person her id and her token. An id means something
  only together with its issuer: in OpenID Connect, the issuer and the token's `sub` together name a
  person.
- The *stranger's words* are what line ② tells anyone who does not work in the company the call
  names: "the caller may not work in the tenant it named" (step 45).

## Why it matters

Real runs on 2026-10-29, on step 45c's code, which is this folder before any change. They are the
runs of step 45e's understanding session, in [`../mj_notes.md`](../mj_notes.md), each in a copy
outside the repository.

```text
1. svc_ap_bot, a script account that org_456 lists as an active CFO, approves PAY-901 (31,400.00 USD):
   COMMITTED, APPROVED; approvers ["svc_ap_bot"]; the record: mode direct, subject svc_ap_bot
2. firm-ap-fte reads INV-1008 under del_101, a slip that names svc_ap_bot as its signer: it reads,
   and the record names svc_ap_bot as the subject the agent works for
3. org_456's lookup answers from its HR server, where user_124 is the CFO's deputy. The SSO's
   user_124, a new AP clerk, approves PAY-901: COMMITTED, APPROVED
4. org_456's sign-in server upgrades first and adds type and issuer to its answers. cfo_100 reads
   INV-1008: INTERNAL_ERROR, and DSoR's kept answer about her is erased. 15 seconds later:
   AUTHORIZATION_DENIED "the caller may not work in the tenant it named"
```

1. **A script approves money.** DSOR-SOD-01b says an approver is `human`. Step 29's guard on the
   caller's type passed, because since step 45 every token's login is `human`.
2. **An agent works for a script.** §13 calls a slip "a permission slip from a human to an agent".
   Here no person stands behind the agent, and the record names a program as the person.
3. **One id, two people.** DSoR checks that an answer is about the person it asked about, but the
   check compares text: `user_124` on two servers looks like one person.
4. **The upgrade needs an order.** The answer's contract is strict (step 45's D2), so a field that
   DSoR does not know makes the whole answer a fault.

In the Panaversity ops story, a cron job's SSO account with the operator role could approve the ops
agent's writes in the same way. The SSO's user record has no field that says "script" today.

**Common mistake:** checking the type only at the approval. A person's authority enters DSoR at line
②, at line ③, at an approval, and at a release. A script stopped at one of them walks in through
another.

## The design, before any code

### How this step was made

Step 45's review (finding 1) and the learner's review of D15 found the problem. The learner put two
decisions in this step: the answer's `type` (D18) and its `issuer` (D20), entries 35 and 37 of
[`../mj_decisions.md`](../mj_decisions.md). On 2026-10-29 the learner went through the step in an
understanding session: five parts, each with a real run. On 2026-10-30, before any code, the learner
took four more decisions, each on Claude Code's recommendation: D27 to D30 below (entries 47 to 50).
After the review, two more, the same way: D31 and D32 (entries 51 and 52).

### What the rules say

From [§12](../../../specs/dsor/02-security.md#12-identity-and-principals):

- **DSOR-IDN-01:** "DSoR MUST normalize every caller into a principal with a type and tenant
  memberships before any other processing." Since step 45 a person's memberships come from her
  company at line ②. With this step her type does too.

From [§12.1](../../../specs/dsor/02-security.md#121-role-source):

- **DSOR-IDN-04a and DSOR-IDN-04b:** role assertions count only from a token issuer or a role source
  that the company configured, and "a claim from any other origin MUST NOT be used in an
  authorization decision." A type is such a claim. It comes from the company's role source, and the
  login's guess decides nothing.
- **DSOR-IDN-07:** "When the role source reports a delegator as deprovisioned or suspended, DSoR MUST
  suspend every delegation that principal granted." A signer who is not a person is neither.
  Suspending her slips too is this step's decision (D28).

From [§16](../../../specs/dsor/02-security.md#16-segregation-of-duties):

- **DSOR-SOD-01a:** "A principal of type `agent` MUST NOT act as an approver."
- **DSOR-SOD-01b:** "An approver MUST be of type `human`."

From [§13](../../../specs/dsor/02-security.md#13-delegation), in plain words: "A *delegation* is a
permission slip from a human to an agent." No rule says it in one MUST. This step reads it so (D28).

From [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution):

- **DSOR-APR-03a:** "Executing a proposal MUST re-evaluate the target command's preconditions,
  controls, segregation of duties, limits, delegation, and operational controls against `CURRENT`
  state." DSOR-SOD-01b is a rule of segregation of duties, so at a release an approver's type is
  her company's answer now (D31, after the review).

From [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes):

- **DSOR-ERR-01b:** "An error MUST NOT reveal the existence or attributes of a resource the caller is
  not authorized to read." A non-person at line ② hears the stranger's words (D27).

§12.1 says a role source gives "the current roles of a principal", and nothing about its type or
whose ids it uses. The two fields are this tutorial's proposal for the lookup contract, in
[`../mj_notes.md`](../mj_notes.md), with a question for §12.1.

### The claims

| Claim | What it says |
|---|---|
| C1 | An answer counts only when it carries `type`, one of the four of §12, and `issuer`, and its issuer is exactly the one in `sign-in.json`. An answer with another issuer, or without either field, is a fault: `INTERNAL_ERROR`, and DSoR's kept answer about that person is erased (D18, D20, D29, D30) |
| C2 | Line ②: a person's own call is refused with the stranger's words when her company answers any type but `human`. The record names that type, which the caller's words leave out. Such an answer serves the account's own calls for 10 minutes, as a stranger's does (D27, D32; DSOR-IDN-01, DSOR-ERR-01b) |
| C3 | An approval counts only from a `human` by her company's answer. Line ② refuses any other type first, and the approval's own guard reads the type that line ② found, never the login's guess. At a release, DSoR asks each approver's company again, and an approval from an account that is no longer `human` stops counting (D31; DSOR-SOD-01a, DSOR-SOD-01b, DSOR-APR-03a) |
| C4 | A release asks again about the person who asked for herself. Any type but `human` throws the proposal away, as a requester who left does (D27) |
| C5 | Line ③: a slip whose signer is not `human` is refused with `DELEGATION_REQUIRED`, in the words a signer who left gets, and every slip she signed in that company is suspended first, with a record that names the type (D28) |
| C6 | The upgrade: first DSoR accepts `type` and `issuer` as known fields that may be missing, and reads an answer without them as before; then the servers send them; then DSoR requires them. This step's final code requires them (D30) |
| C7 | DSoR's own table is unchanged: a token for any login it lists as no person is refused at line ①, before any lookup. The stand-in and the test sign-in server answer with `type` and `issuer`, and the story's people are `human` |

Outside DSoR: the Panaversity SSO's lookup will answer `type` and `issuer`. It answers `human` for
every account until it can mark a script account. How it marks one is the SSO's own choice, for its
notes (entry 35's cost).

### Decisions

From before this step:

- **D18, entry 35. The answer gains `type`,** one of §12's four. *Downside:* each company's server
  must know which accounts are people. The Panaversity SSO marks none today, so it answers `human`
  for all until it does.
- **D20, entry 37. The answer gains `issuer`,** and DSoR uses an answer only when it is the issuer in
  `sign-in.json`. *Downside:* a second new field, and each server must know whose ids it uses.

For this step, the learner's, on 2026-10-30:

- **D27, entry 47. A non-person is a non-member,** at line ② and at a release. Line ② gives the
  stranger's words; a release throws the proposal away. The record names the type. *Downside:* the
  script's owner hears only "may not work in the tenant"; the reason is in the record, not the reply.
- **D28, entry 48. A slip whose signer is not a person is refused, and her slips are suspended,** the
  same path as a signer who left. *Downside:* a person marked as a script by mistake keeps her slips
  suspended after the company fixes the mark, and DSoR has no operation that lifts a slip's
  suspension yet.
- **D29, entry 49. An answer from another issuer is a fault,** as an answer about someone else is
  (step 45's D2). *Downside:* after the lookup's address is fixed, the people whose kept answers were
  erased count as strangers, and their own calls wait for step 45c's budget (step 45f's case, which
  is parked).
- **D30, entry 50. Expand, then contract.** The contract stays strict. DSoR first accepts the two
  fields as optional, then the servers send them, then DSoR requires them. *Downside:* two DSoR
  releases. Until the second, a company whose server has not upgraded stays exposed, and DSoR waits
  for the slowest company.

After the review, the learner's, on 2026-10-30:

- **D31, entry 51. A release asks again what each approver is,** as it asks about the requester.
  An approval from an account that its company no longer calls `human` stops counting, and the
  proposal is thrown away with `SOD_VIOLATION`; a company that cannot answer now leaves it waiting.
  Only the type is asked about. *Downside:* one more lookup per approver at each release, and a
  release waits while the server cannot answer. An approver who left still counts: step 46's
  question.
- **D32, entry 52. A non-person's own calls use its answer for 10 minutes,** as a stranger's do
  (D26). *Downside:* when a company fixes a person marked as a script by mistake, her own calls hear
  the stranger's words for up to 10 more minutes.

### The tests, by claim

Test titles start with the rule or decision they prove. A test that expects "yes" passes before any
code, so each "no" test comes with a "yes" beside it.

| Claim | Tests |
|---|---|
| C1 | In `test/kind-and-issuer.test.ts`. `D18`: each of §12's four types can be read, and the type `robot` is a fault. `D29`: an answer with org_456's HR server as its issuer is a fault, and the kept answer about her is erased; a kept answer in another server's ids is never used, even within 10 seconds. `D20`: an issuer with a slash at the end is another issuer. `D30`: an answer without a type, and one without an issuer, is a fault. Step 45's shared list of answers DSoR cannot use (D5) gains four cases: `robot`, another issuer, no type, no issuer |
| C2 | In `test/not-a-person.test.ts`. `D27`: `svc_ap_bot`, typed `application`, reads INV-1008 for itself: the stranger's words, and the record names `application`; `agent` and `system` the same; `human` reads. `DSOR-ERR-01b`: while org_456's server is off, an account that DSoR last heard is an application hears the stranger's words, where a person hears that DSoR has no recent answer. `D32`: four accounts typed `application` that read every 10 seconds cost org_456 four lookups, not 20, and a new person still reads; a person re-marked `human` waits out the 10 minutes |
| C3 | `DSOR-SOD-01b`: `svc_ap_bot`, typed `application` and listed as CFO, approves PAY-901: refused, and PAY-901 still waits. `DSOR-SOD-01a`: an account typed `agent`: refused. `DSOR-SOD-01b`: `cfo_100`, `human`, approves: APPROVED. `DSOR-SOD-01b`: with a role source that calls `svc_ap_bot` a member and an application, line ⑤ still refuses it, because line ② wrote the company's type; and with `people_only` gone too, the approval's own guard at line ⑨ refuses it. `D31`: an approval given while `svc_ap_bot` was typed `human` stops counting at the release once org_456 says `application`: PAY-901 is thrown away, and the record names the account and its type. The same release pays while org_456 still says `human`, and waits while org_456 cannot answer about the approver |
| C4 | `D27`: `svc_ap_bot` prepares a payment of INV-1008 in its own name while org_456 says it is human. Once org_456 says `application`, `user_123`'s release throws the payment away: `APPROVAL_INVALIDATED`. Beside it, the same release pays while org_456 still says `human` |
| C5 | `D28`: `firm-ap-fte` reads INV-1008 under del_101, which `svc_ap_bot` signed: `DELEGATION_REQUIRED`, and both slips `svc_ap_bot` signed in org_456 are suspended, each with a record that names `application`. The same slip reads while org_456 says `human`. A payment `firm-ap-fte` prepared under del_101 is thrown away at its release once org_456 says `application` |
| C6 | Shown by the commits and the live run: the SSO's commit comes between the commit that accepts the fields and the one that requires them, and step 45c's code meets the upgraded SSO in the live run |
| C7 | Step 45's test that a token for an agent in DSoR's table is refused at line ①, with no lookup. The stand-in and the test sign-in server answer with both fields |

### The breaks, with the learner's predictions

Each break makes one mistake in the finished step. The learner predicted each one on 2026-10-30,
before any code. A real run settles each in "Break it".

| Break | The story | The learner's prediction |
|---|---|---|
| B1 · line ② stops refusing a non-human, but still writes the company's type on the caller | At 02:00 `svc_ap_bot`, typed `application` and listed as CFO, approves PAY-901 | PAY-901 is APPROVED |
| B2 · every type check asks "is it an agent?" instead of "is it human?" | `svc_ap_bot`, typed `application`, approves PAY-901 | PAY-901 is APPROVED |
| B3 · line ③ stops checking the signer's type | `firm-ap-fte` reads INV-1008 under del_101, which `svc_ap_bot` signed | It reads, and del_101 stays active |
| B4 · the issuer check is removed | The SSO's `user_124`, a clerk, approves PAY-901. org_456's HR server answers `user_124` · CFO · `human` · its own issuer | PAY-901 is APPROVED |

## What changed since step 45c

| File | What changed |
| --- | --- |
| `proposals/role-source-answer.schema.json` | The answer gains `type`, one of §12's four, and `issuer`. Both are required (D18, D20, D30) |
| `src/authority.ts` | An answer counts only in sign-in.json's ids (D29). `memberOf` refuses an account that its company says is no person, with the stranger's words, and returns the type (D27). `authorityOf` treats a signer who is no person as a signer who left (D28) |
| `src/pipeline.ts`, `src/log.ts` | Line ② writes the company's type on the caller. The record of a non-person that line ② or a release refused names the account and its type, `not_a_person` |
| `src/release.ts` | A release asks each approver's company again what kind of account she is, through the role source's new `typeOf` (D31) |
| `src/sign-in.ts` | `shippedIssuer()`: the issuer that an answer must name |
| `src/directory.ts` | The stand-in names a type, a person's unless the entry says otherwise, and sign-in.json's issuer |
| `src/suspensions.ts` | A comment: a suspension's word may be a type |
| `test/kind-and-issuer.test.ts`, `test/not-a-person.test.ts` | **New.** C1 and C6; C2 to C5 |
| `test/helpers.ts`, `test/sign-in-server.ts` | `A_PERSON`, which a test spreads into an answer it builds by hand; the test sign-in server names both fields |
| Twelve other test files | Answers built by hand name both fields. Step 19's words for a signer who left gain "person" |

`src/main.ts` and `test/person-memory.test.ts` lose only step 45c's markers. `test/recheck.test.ts`
gives `checkApprovals` the role source it now asks.

```bash
git diff --no-index ../mj_45c_lookups_person_by_person/src src
git diff --no-index ../mj_45c_lookups_person_by_person/test test
```

## Run it

A local PostgreSQL 17, as in step 45c. This step adds no migration.

```bash
pnpm install
pnpm check
pnpm test:db test/answers.db.test.ts test/suspended-slips.db.test.ts
pnpm start          # step 45c's night: the stand-in names type and issuer now, and nothing else changes
```

**The real run**, on 2026-10-30 at 06:16 local time (01:16 UTC, which the script prints), on this
computer. `pnpm serve` asks the Panaversity SSO's lookup: draft pull request
[panaversity/agentfactory#1331](https://github.com/panaversity/agentfactory/pull/1331), at local
commits `f2c3c3f55` and `787fee54d`, which add `type` and `issuer` to its answers, on
`localhost:3011`, over a local copy of its database. First step 45c's code, which knew neither
field and still kept an answer about `cfo_100` from the night before; then this step's code.

```text
== step 45c's code, after the SSO upgraded
01:16:01 the SSO's answer about cfo_100: 200 {"tenant":"org_456","person":"cfo_100","status":"active","roles":["CFO"],"as_of":"2026-10-30T01:16:01.165Z","type":"human","issuer":"http://localhost:3011"}
01:16:01 cfo_100 reads INV-1008: 500 INTERNAL_ERROR: the directory of org_456 answered with something DSoR cannot use
01:16:01 the agent reads INV-1008 under del_100: 500 INTERNAL_ERROR: the directory of org_456 answered with something DSoR cannot use
01:16:16 15 seconds later
01:16:16 cfo_100 reads INV-1008: 403 AUTHORIZATION_DENIED: the caller may not work in the tenant it named
== step 45e's final code, the same SSO
01:16:32 the SSO's answer about cfo_100: 200 {"tenant":"org_456","person":"cfo_100","status":"active","roles":["CFO"],"as_of":"2026-10-30T01:16:32.789Z","type":"human","issuer":"http://localhost:3011"}
01:16:33 cfo_100 reads INV-1008: 200 INV-1008, issued
01:16:33 the agent reads INV-1008 under del_100: 200 INV-1008, issued
```

Then DSoR's kept answers, read from `dsor.role_answers`: `cfo_100` and `user_123`, each `human`, in
the ids of `http://localhost:3011`, active.

What it shows:

1. **The order of the upgrade (C6).** Step 45c's contract is strict, so the two new fields made every
   answer a fault. `cfo_100` and the agent heard `INTERNAL_ERROR`, and DSoR erased its answer about
   `cfo_100`. Fifteen seconds later DSoR knew nothing about her, so she heard the stranger's words.
   This is "Why it matters", run 4, against the real server. It is why this step accepted the
   fields before the SSO sent them.
2. **This step's code reads the real SSO's answers,** and requires both fields.
3. **What a live run cannot show:** a non-person refused by the real SSO. The SSO answers `human` for
   every account, because it cannot yet mark a script's account. The stand-in and the tests show the
   refusals.

## Break it

Each break was made for real, in a copy of this step, with a story test that tells what DSoR
answers, once as built and once broken. The predictions are the learner's, from before any code.

| Break | The learner's prediction | As built | Broken |
|---|---|---|---|
| B1 · line ② stops refusing a non-human, but still writes the company's type | PAY-901 is APPROVED | `svc_ap_bot` hears the stranger's words at line ②; PAY-901 waits | refused at **line ⑤**: "proposal.approve" is for people only, and svc_ap_bot is not a person. PAY-901 still waits |
| B2 · every type check asks "is it an agent?" | PAY-901 is APPROVED | the stranger's words; PAY-901 waits | **COMMITTED, APPROVED.** PAY-901 is APPROVED |
| B3 · line ③ stops checking the signer's type | It reads, and del_101 stays active | `DELEGATION_REQUIRED`; del_101 is suspended, and its record names `application` | **it reads INV-1008.** del_101 stays active, with no record |
| B4 · the issuer check is removed | PAY-901 is APPROVED | `user_124` hears the stranger's words; PAY-901 waits | **COMMITTED, APPROVED.** PAY-901 is APPROVED |

Three predictions came out as the learner said: B2, B3, and B4. B1 did not, and the reason is the
step's third claim. Line ② let `svc_ap_bot` through, but it had already written `application` on
the caller. Line ⑤ refuses any caller who is not a person for a contract marked "people only",
which `proposal.approve` is since step 25. The approval's own guard reads the same type. Neither
reads the login's guess. The test with a role source that lets an application through shows the
same thing without a break.

B2 changes four checks: line ②, line ③, line ⑤'s "people only", and the approval's own guard. Each
asks "is it an agent?" instead of "is it a person?". An application is not an agent, so it passes
all four. That is why every check here asks for `human`, and never rules out `agent`.

B4's "As built" is the stranger's words, not `INTERNAL_ERROR`. DSoR knew nothing about `user_124`, so
a fault in her own call sounds like a stranger's refusal, as step 45's review decided (finding 3).
An agent's call that met the same answer would hear `INTERNAL_ERROR`.

Each piece's checks were also broken one at a time, in a copy, against the unit tests: 4 in the two
fields, 6 in line ②, 4 in line ③, and 5 in the contract move; after the review, 3 in its fixes and
the reviewer's 4 surviving mutations again. 24 were caught. The 2 that survived did so on purpose:
the issuer is checked twice, by the schema and by the exact comparison, so either one alone still
refuses a missing issuer. With both removed, 2 tests fail. On the SSO's side, an issuer with a slash
added, or a type left out, fails its lookup tests.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | The problem | Four real runs on step 45c's code: a script approves money, an agent works for a script, one id names two people, and an upgrade breaks every call |
| 2 | Understand | An understanding session in five parts, each settled by a real run (`../mj_notes.md`) |
| 3 | Decide | D27 to D30, each put to the learner with its downside; and the predictions for B1 to B4 |
| 4 | The copy | Step 45c copied, its markers removed |
| 5 | Build, piece by piece | Five pieces, each with its tests red first, its breaks, and its own commit: the two fields, optional; a non-person is a non-member at line ②, at an approval, and at a release; line ③'s signer; the SSO sends both fields, in its own repository; DSoR requires both |
| 6 | The real run | `pnpm serve` against the Panaversity SSO on this computer: step 45c's code first, then this step's |
| 7 | Break it | Four breaks, each made for real in a copy and set beside its prediction |
| 8 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 45e in learner mode from the design in
docs/baby_steps_tutorials/mj_45e_only_a_person_acts_as_a_person/README.md and the decisions in
docs/baby_steps_tutorials/mj_decisions.md, entries 35, 37, and 47 to 50.
```

## Check yourself

1. org_456's server answers `svc_ap_bot` · active · CFO · `type: "application"`. `svc_ap_bot` reads
   INV-1008 for itself. What does it hear, and what does the record keep?
   <details><summary>Answer</summary>The stranger's words: "the caller may not work in the tenant it named". The record keeps <code>not_a_person: "application"</code> beside <code>requested_tenant: "org_456"</code>. The reply leaves the type out, so the script's owner learns only what any stranger learns (D27, DSOR-ERR-01b).</details>
2. `svc_ap_bot` signed del_101 for `firm-ap-fte`. Then org_456 types `svc_ap_bot` as an application,
   and `firm-ap-fte` reads INV-1008. What happens to the read, and to the slips?
   <details><summary>Answer</summary><code>DELEGATION_REQUIRED</code>, in the words a signer who left gets. First every active slip <code>svc_ap_bot</code> signed in org_456 is suspended, each with a record whose reason is <code>application</code> (D28). If org_456 fixes the mark later, the slips stay suspended: no operation lifts a suspension yet (D28's downside).</details>
3. By mistake, org_456's lookup now answers from its HR server, whose ids are not the SSO's. There
   `user_124` is the CFO's deputy; at the SSO `user_124` is a new clerk. The clerk approves PAY-901.
   What happens?
   <details><summary>Answer</summary>Refused. The HR answer names the HR server as its issuer, not sign-in.json's, so it is a fault (D29). The clerk, a stranger to DSoR, hears the stranger's words, and PAY-901 waits. Break B4 removes the check, and PAY-901 is APPROVED.</details>
4. Why did this step add the two fields in three moves, and not in one?
   <details><summary>Answer</summary>The answer's contract is strict: an unknown field is a fault (step 45's D2). When the SSO sent the fields first, step 45c's code refused every answer: in the real run, <code>INTERNAL_ERROR</code> and then the stranger's words. And a DSoR that required the fields before the SSO sent them would refuse every answer too. So DSoR accepts them, then the server sends them, then DSoR requires them (D30).</details>
5. On Monday `svc_ap_bot` approves PAY-901, while its company still says `human`. On Tuesday the
   company marks it `application`, and the agent releases PAY-901. What happens, and what does the
   record keep?
   <details><summary>Answer</summary>PAY-901 is thrown away: <code>APPROVAL_INVALIDATED</code>, "… is INVALIDATED: SOD_VIOLATION". The release asks each approver's company again (D31), and an approval from an account that is no longer a person stops counting. The record keeps <code>not_a_person: { person: "svc_ap_bot", type: "application" }</code>; the reply names neither. If the company cannot answer on Tuesday, PAY-901 waits, still APPROVED.</details>

## Think it through

### Found while building

- **The release came with line ②'s piece.** A release asks the same question as line ②, `memberOf`,
  so a non-person's refusal there throws a release's proposal away too. Its test was written red
  first in that piece, and the planned piece for releases had nothing left to do.
- **Step 19's words were false for a non-person.** They said "whom the directory of org_456 does not
  list as active", but org_456 lists `svc_ap_bot` as active, as an application. They now say "an
  active person", which is true for both, and still does not say which. Six older tests changed with
  them.
- **An outage told a non-person more than a stranger.** DSoR kept an active answer about it, so it
  heard "no recent answer" while a stranger heard the stranger's words. `memberOf` now knows a
  non-person as no member, so it hears the stranger's words too (the `DSOR-ERR-01b` test).
- **The C4 test uses `user_123` and a payment of INV-1008,** not `user_124` and PAY-902 as the
  design said: `user_123` is the story's own AP supervisor, so no extra person is planted.
- **The SSO names one issuer.** Its tokens' `iss` and its lookup's `issuer` come from one function,
  `tokenIssuer()`, so they cannot drift apart. The SSO answers `human` for every account.
- **The contract move has a cost.** The database tier found three tests that kept answers without the
  fields. One showed it: after the move, an answer DSoR kept from before is a fault, not a fallback,
  so an outage refuses where it used to use the kept answer. A deployment should wait at least the
  longest `max_staleness` between the last server's change and the move. The lookup proposal in
  `../mj_notes.md` says so.

### What the review found

A reviewer who had not seen the conversation read the code and the tests against the claims, made
22 small breaks in a copy, and attacked the step as an agent would. Every type check the step added
held: no non-person got past line ②, line ③, or a release's question about its requester. It found
three defects around them, each with a real run, and two gaps in the tests.

- **High: an approval outlived its approver's re-marking.** `svc_ap_bot` approved PAY-901 while its
  company said `human`. After the company said `application`, the agent's release paid. A release
  re-checked only that no approver was in the requesting chain. DSOR-APR-03a asks for segregation of
  duties against current state, and DSOR-SOD-01b is one of those rules. **Fixed** by the learner's
  D31: a release asks each approver's company again, about the type only.
- **Medium: scripts used up the budget.** D27 makes a non-person a stranger, so its own calls spent
  the company's 20 lookups a minute, again every 10 seconds. Four scripts used them up in 50
  seconds, and a new person heard the stranger's words. **Fixed** by the learner's D32: 10 minutes,
  as for a stranger.
- **Medium: a release's record named no type,** though D27 says the record names it. **Fixed:** the
  record's `not_a_person` names the account and its type, at line ② and at a release, whose caller
  is someone else.
- **Low: the approval's own guard was proven only with DSoR's own system logins,** because line ⑤
  refused the test first. **Fixed:** a test with `people_only` gone reaches line ⑨.
- **Low: four breaks survived:** an issuer compared without its case, a remembered reply from
  another server, a kept answer from another server at a person's own call, and a newer kept answer
  from another server. **Fixed:** each fails a test now.
- **Not fixed, on purpose:** no test shows that no answer counts when `sign-in.json` is wrong. A test
  cannot give the role source no issuer, because passing none brings back `sign-in.json`'s. And
  `pnpm serve` refuses to start with a wrong `sign-in.json` (step 44's C5).

### Left open on purpose

- **The Panaversity SSO cannot mark a script's account yet,** so it answers `human` for all. Until it
  can, this step stops a script only at a server that says so. How the SSO marks one is its own
  choice (entry 35's cost).
- **No operation lifts a slip's suspension** (D28's downside). A person marked as a script by mistake
  keeps her slips suspended after the mark is fixed.
- **An approver who left still counts at a release,** and her roles are not asked again: whether
  her job still allows the approval is step 46's question (D31's downside).
- **A slip's signer who is no person, met at a release,** throws the proposal away, but the record
  of the suspension waits for the agent's next call at line ③, as for a signer who left.
- **§12.1 names no type and no issuer.** The lookup proposal in `../mj_notes.md` carries both, with
  the order in which a deployment adds them, to propose later with the rest.

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-IDN-01 | Every caller is normalized into a principal with a type and memberships, before any other processing | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `D27` in `test/not-a-person.test.ts`: line ② takes the type from the company |
| DSOR-IDN-04a, DSOR-IDN-04b | Roles count only from a source the company configured; a claim from any other origin is not used | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `D29` and `D20` in `test/kind-and-issuer.test.ts`: an answer in another server's ids is a fault |
| DSOR-IDN-07 | When the role source reports a delegator as gone, every slip that person granted is suspended | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `D28` in `test/not-a-person.test.ts`: this step's decision to treat a signer who is no person the same way |
| DSOR-SOD-01a | A principal of type `agent` never approves | [§16](../../../specs/dsor/02-security.md#16-segregation-of-duties) | `DSOR-SOD-01a` in `test/not-a-person.test.ts` |
| DSOR-SOD-01b | An approver is of type `human` | [§16](../../../specs/dsor/02-security.md#16-segregation-of-duties) | `DSOR-SOD-01b` in `test/not-a-person.test.ts`, by the company's answer |
| DSOR-APR-03a | A release re-evaluates segregation of duties, among others, against current state | [§26.4](../../../specs/dsor/03-execution.md#264-re-evaluation-at-execution) | `D31` in `test/not-a-person.test.ts`: each approver's type, asked again |
| DSOR-ERR-01b | An error does not reveal what the caller may not read | [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) | `DSOR-ERR-01b` and `D27` in `test/not-a-person.test.ts`: the stranger's words, and the type only in the record |

**Next:** step 46, who may approve and up to how much ([`../readme_mj.md`](../readme_mj.md)).
