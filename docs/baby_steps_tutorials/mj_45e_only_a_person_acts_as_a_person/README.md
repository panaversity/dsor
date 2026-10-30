# Step 45e · Only a person acts as a person

**New in this step:** a company's answer says what kind of account it is about, and whose ids it
uses. DSoR acts as a person only on `human`: at a person's own call, for a slip's signer, at an
approval, and at a release (DSOR-SOD-01a, DSOR-SOD-01b, DSOR-IDN-01).

> **Status on 2026-10-30: partly built.** Built and tested: an answer may carry `type` and
> `issuer`, and an answer in another server's ids is a fault (C1). A non-person is refused at line
> ②, at an approval, at a release, and as a slip's signer (C2 to C5). Not built yet: the Panaversity
> SSO sends neither field, and DSoR does not require them, so an answer without them reads as
> before (C1, C6, C7). The review, the live run, and this README's sections from "What changed" on
> wait too. Found while building: step 19's words for a signer who left now say "does not list as an
> active person", so they are true for a signer who is no person too.

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
| C2 | Line ②: a person's own call is refused with the stranger's words when her company answers any type but `human`. The record names that type, which the caller's words leave out (D27; DSOR-IDN-01, DSOR-ERR-01b) |
| C3 | An approval counts only from a `human` by her company's answer. Line ② refuses any other type first, and the approval's own guard reads the type that line ② found, never the login's guess (DSOR-SOD-01a, DSOR-SOD-01b) |
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

### The tests, by claim

Test titles start with the rule or decision they prove. A test that expects "yes" passes before any
code, so each "no" test comes with a "yes" beside it.

| Claim | Tests |
|---|---|
| C1 | `D20`: an answer about `user_124` with the HR server's issuer: `INTERNAL_ERROR`, and the kept answer about her is erased. `D18`: an answer with the type `robot` is a fault. `D30`: an answer without `type`, and one without `issuer`, is a fault. The shared list for every role source (step 45's D5) gains both fields |
| C2 | `D27`: `svc_ap_bot`, typed `application`, reads INV-1008 for itself: the stranger's words, and the record names `application`. `D27`: `agent` and `system` are refused the same; `human` reads |
| C3 | `DSOR-SOD-01b`: `svc_ap_bot`, typed `application` and listed as CFO, approves PAY-901: refused, and PAY-901 still waits. `DSOR-SOD-01a`: an account typed `agent` approves: refused. `DSOR-SOD-01b`: `cfo_100`, `human`, approves: APPROVED |
| C4 | `D27`: a script account with `ap_supervisor` prepared PAY-902 in its own name. Once its company types it `application`, `user_124`'s release throws PAY-902 away: `APPROVAL_INVALIDATED` |
| C5 | `D28`: `firm-ap-fte` reads INV-1008 under del_101, which `svc_ap_bot` signed: `DELEGATION_REQUIRED`, and del_101 is suspended, with a record that names `application`. `D28`: a slip a person signed still works |
| C6 | Shown by the commits and the live run: the SSO upgrades between the commit that accepts the fields and the one that requires them |
| C7 | Step 45's test that a token for an agent in DSoR's table is refused at line ①, with no lookup. The stand-in's answers carry both fields |

### The breaks, with the learner's predictions

Each break changes one line in the finished step. The learner predicted each one on 2026-10-30,
before any code. A real run settles each in "Break it".

| Break | The story | The learner's prediction |
|---|---|---|
| B1 · line ② stops refusing a non-human, but still writes the company's type on the caller | At 02:00 `svc_ap_bot`, typed `application` and listed as CFO, approves PAY-901 | PAY-901 is APPROVED |
| B2 · every type check asks "is it an agent?" instead of "is it human?" | `svc_ap_bot`, typed `application`, approves PAY-901 | PAY-901 is APPROVED |
| B3 · line ③ stops checking the signer's type | `firm-ap-fte` reads INV-1008 under del_101, which `svc_ap_bot` signed | It reads, and del_101 stays active |
| B4 · the issuer check is removed | The SSO's `user_124`, a clerk, approves PAY-901. org_456's HR server answers `user_124` · CFO · `human` · its own issuer | PAY-901 is APPROVED |
