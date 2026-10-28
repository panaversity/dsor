# Step 45 · Ask the sign-in server

**New in this step:** DSoR stops deciding who a person is from lists in its own code. It asks the
company's sign-in server, in a question and an answer of DSoR's own, and a person who has left is
refused at the next ask, with every slip they signed suspended (DSOR-IDN-04a, DSOR-IDN-05,
DSOR-IDN-06, DSOR-IDN-07).

## In plain words

Since step 05, DSoR has known its people from a table in its own code, `src/principals.ts`. Step 19
let DSoR ask about a slip's signer who is not present, but the "staff directory" it asks is a list
inside DSoR too (`src/serve.ts`). Step 44 made a person's sign-in real. Who that person is now, in
which company, and in which job, still came from DSoR's own lists.

This step asks the company's sign-in server instead, because it already knows: here, the
Panaversity SSO. DSoR asks one question, "who is this person in this company now?", and the server
answers in a shape that DSoR defines. DSoR reuses an answer for 10 seconds, then asks again. It
keeps the last answer for up to one hour, for when the server cannot answer, and it treats a reply
it cannot read as a fault.

Think of DSoR as a new clerk. Before, the clerk kept a private staff list and trusted it forever.
Now, before acting on a slip, the clerk phones HR and asks whether its signer still works here, in
the same job.

**Words this step uses.**

- A *role source* is where DSoR learns who holds which job in a company
  ([§12.1](../../../specs/dsor/02-security.md#121-role-source)). Step 19's was a fake directory.
  This step's is the company's sign-in server.
- A *lookup* is one question to the role source about one person in one company.
- The *contract* is that question and its answer, written by DSoR. The request names `tenant` and
  `person`. The answer holds `tenant`, `person`, `status`, `roles`, and `as_of`. It is our proposal
  for the specification and is not in it yet ([`../mj_notes.md`](../mj_notes.md), "Proposals for the
  specification").
- `status` is `active`; `suspended`, a person who may not act for now; or `gone`, a person who left
  the company or has no account.
- `as_of` is when the server read its facts. An answer's age runs from it.
- A *kept answer* is the last answer DSoR received about a person. It counts for up to the
  company's `max_staleness` while the server cannot answer: one hour for org_456 and four for
  org_789, in `role-sources.json`.
- *Cannot answer now* means a `429` (too many requests), a `5xx` (the server failed), a timeout, or
  no connection.
- A *company key* is the credential that the company's owner made in the SSO for DSoR. It reads that
  one company's people, and nothing else.
- *Line ①*, *line ②*, and *line ③* are the first items of DSoR's checklist (step 07's pilot's
  checklist): who is calling, in which company, and under whose authority, which is the slip and
  whether its signer still holds the job (step 19).

## Why it matters

A real run on 2026-10-28, on this folder before any change (a copy of step 44), with no sign-in
server running. It asks the copy's own code who `user_123` is, the way lines ② and ③ do.

```text
1. Line ②, a person calling: user_123's roles come from src/principals.ts
   key tok_2c91 -> {"id":"user_123","type":"human","memberships":[{"tenant_id":"org_456","roles":["ap_supervisor"]}]}
2. Line ③, 02:00: the agent pays under del_100, and DSoR asks org_456's directory about its signer
   DSoR's answer: {"roles":["ap_supervisor"],"source":"role_source","as_of":"2026-10-28T10:27:56.796Z"}
   questions the directory was asked: 1 (it is a list inside DSoR, src/serve.ts)
3. Is org_456's sign-in server, the SSO on localhost:3011, answering at all?
   no answer: ECONNREFUSED
```

1. **DSoR is sure without asking anyone.** Nothing answered at the sign-in server's address, and
   DSoR still said that `user_123` is the AP supervisor of org_456, from two lists in its own code.
2. **A person who left keeps the job in DSoR.** If `user_123` left org_456 at 01:55, the answer at
   02:00 would be the same, and the agent would keep paying `INV-1008` and the invoices after it
   under `del_100`. The specification's own example: without a role source, "the agent keeps paying
   vendors under her authority for months".

In the Panaversity ops story, an ops lead who leaves Panaversity would keep signing for the coupon
agent, until someone edits DSoR's lists too.

**Common mistake:** trusting a reply because it arrived. A cached answer about someone else, an
error page, and an answer read three hours ago all arrive as replies. DSoR uses an answer only when
it is about the person and the company it asked about, and fresh enough.

## The design, before any code

### How this step was made

This step's idea was studied as step 43d on 2026-10-26, and designed on 2026-10-28 in decisions D1
to D10 ([`../mj_notes.md`](../mj_notes.md), "Step 45's design, the learner's answers"). Every one of
them is also in [`../mj_decisions.md`](../mj_decisions.md). Two of them moved to step 45b, "Protect
the sign-in server", to keep one new idea in each step: one lookup in flight for each company and
person (D9), and the pause after five failures (D10). This step keeps D10's 2-second timeout,
because "a timeout means the server cannot answer now" needs one.

The lookup's contract is a proposal for the specification. Until it lands, this step's tests for it
are titled by the decisions (D1, D2, …), never by a requirement id that the specification does not
have.

### What the rules say

From [§12](../../../specs/dsor/02-security.md#12-identity-and-principals):

- **DSOR-IDN-03a:** "Each request MUST resolve to exactly one active tenant in which the subject
  holds a membership."

From [§12.1](../../../specs/dsor/02-security.md#121-role-source):

- **DSOR-IDN-04a:** "Role and scope assertions MUST be accepted only from a token issuer or role
  source configured as authoritative for the active tenant."
- **DSOR-IDN-04b:** "A claim from any other origin MUST NOT be used in an authorization decision."
- **DSOR-IDN-05:** "Each tenant MUST configure a role source — directory synchronization such as
  SCIM, identity-provider lookup, or DSoR-held role assignments — from which DSoR can read the
  current roles of a principal who is not present in the request."
- **DSOR-IDN-06:** "When the delegator's current authority cannot be established within the
  staleness bound of §44, DSoR MUST deny the command."
- **DSOR-IDN-07:** "When the role source reports a delegator as deprovisioned or suspended, DSoR
  MUST suspend every delegation that principal granted."

From [§15](../../../specs/dsor/02-security.md#15-authorization):

- **DSOR-AUT-01b:** "DSoR MUST deny any operation for which no permission is granted." So a role
  name that `roles.json` does not define grants nothing.

From [§13](../../../specs/dsor/02-security.md#13-delegation) and
[§44](../../../specs/dsor/06-conformance.md#44-operational-bounds):

- **DSOR-DEL-02:** "Effective authority MUST be computed at decision time as the intersection of the
  delegator's current authority, the delegation's grants and constraints, and the token scopes."
  From this step on, "the delegator's current authority" is what the sign-in server said.
- **DSOR-BND-02:** "A tenant-level setting MUST NOT loosen a parameter beyond the limit for the
  claimed level." Here, no company's `max_staleness` may be over 24 hours, the most §44 allows at
  L2, and the 10-second reuse never stretches an answer past a company's own bound.

Proposed by the learner, and not in the specification yet ([`../mj_notes.md`](../mj_notes.md),
"Proposals for the specification"):

- For every role source: an answer counts only when it names the tenant and the person that DSoR
  asked about; and a reply that is neither an answer nor a sign that the source cannot answer now
  refuses the request with `INTERNAL_ERROR`, and drops the kept answer.
- For the lookup: each request asks about one tenant and one person, with a credential for that
  tenant alone; a reply is an answer only when it is a `200` that validates against the
  `role-source-answer` schema, with an `as_of` at most one minute ahead of DSoR's clock; and a
  `429`, a `5xx`, a timeout, or no connection means the source cannot answer now.

### The claims

| Claim | What it says |
|---|---|
| C1 | Line ③ asks the company's sign-in server about a slip's signer, through the contract: one request for one tenant and one person, with that company's key and no other. The address comes from `lookups.json`, and the key from the environment, sent as `Authorization: Bearer` (DSOR-IDN-05; D1, D4, D11, D14) |
| C2 | Line ② asks too: a person's companies and roles come from the same lookup, by the token's `sub`, never from a row in DSoR's code and never from a claim in the token. A person who is not `active` in the company has no membership there, and is refused (DSOR-IDN-03a, DSOR-IDN-04a, DSOR-IDN-04b; decision Q7) |
| C3 | An answer counts only when it is a `200` that validates against `role-source-answer` (in `proposals/`, D12), names the tenant and the person DSoR asked about, and has an `as_of` at most one minute ahead of DSoR's clock (D2, D4) |
| C4 | Roles count only when `status` is `active`. `suspended` or `gone` refuses the call and suspends every slip that person signed (DSOR-IDN-07). The signer's authority at decision time is what the lookup said (DSOR-DEL-02). A role that `roles.json` does not define grants nothing (DSOR-AUT-01b) |
| C5 | When the server cannot answer now (a `429`, a `5xx`, no reply within 2 seconds, or no connection), DSoR does not try again. The kept answer counts while it is younger than `max_staleness`, measured from its `as_of`: the earlier of the server's and the moment DSoR asked (D13). After that the call is refused with `FRESHNESS_UNSATISFIABLE`, and the company's alert receivers hear at once. Start-up still refuses a `max_staleness` over 24 hours (DSOR-IDN-06, DSOR-BND-02; decision Q8; D10's timeout) |
| C6 | Any other reply is a fault: `INTERNAL_ERROR`, and the kept answer is dropped (D2) |
| C7 | An answer is reused for up to 10 seconds. The answers live in a table in DSoR's PostgreSQL, so every DSoR server shares them and a restart keeps them. A decision's record names the answer's `as_of` (D3, D8) |
| C8 | One world: the people's rows in `src/principals.ts` and the fake directory in `src/serve.ts` are gone. `pnpm start` and the older tests use a small stand-in that answers the contract. The timer jobs keep their keys for now (D6, D7) |

### Decisions

Before this step, for the whole chain (decided on 2026-10-26; entries 1 to 5 of
[`../mj_decisions.md`](../mj_decisions.md)):

- **Q1. Who holds which role comes from the sign-in server; what a role may do stays in DSoR.**
  *Downside:* DSoR depends on that server, and whoever runs the company there can grant money roles.
- **Q5. Ask at every call.** Replaced on 2026-10-28 by D3.
- **Q6. An answer names whom it is about, "cannot answer now" keeps the kept answer, and anything
  else is a fault.** *Downside:* a server bug that returns a wrong body stops the agents at once.
- **Q7. A person's own call asks too.** *Downside:* one lookup for each person who calls, as well as
  for each slip's signer.
- **Q8. `max_staleness` is one hour for both stories, with an alert at once.** *Downside:* a sign-in
  server that is down for more than an hour stops agents and approvals.

For this step, the learner's, on 2026-10-28, each with Claude Code's recommendation taken:

- **D1. The lookup follows DSoR's own contract,** proposed for the specification. Any sign-in server
  can serve it, and the Panaversity SSO is the first. *Downside:* this step rests on a proposal
  until it lands, and the SSO's route had to change to match.
- **D2. Two rules for every role source:** an answer about someone else never counts, and a reply
  that is neither an answer nor "cannot answer now" is a fault. *Downside:* two more rules to test,
  for every role source that answers.
- **D3. An answer is reused for up to 10 seconds,** then DSoR asks again. A flood of agent calls is
  then a few lookups a minute, not a flood of lookups. *Downside:* a person who left is caught
  within 10 seconds, not at the very next call.
- **D4. The answer's shape:** `tenant`, `person`, `status` (`active`, `suspended`, or `gone`),
  `roles` (empty unless `active`), and `as_of`. *Downside:* the SSO's route had to change: `tenant`
  and `person`, one `gone` for its two kinds of missing person, and an `as_of`.
- **D5. One shared test list for every role-source adapter:** a person who left is refused at the
  next ask, and the slips they signed are suspended; an answer older than the bound is refused; an
  answer about someone else never counts; an unclear reply is a fault. This step runs it against
  the lookup. *Downside:* the tests are written in a shared form.
- **D6. The timer jobs keep their keys in this step,** with a note. A later step runs them inside
  DSoR. *Downside:* two fixed keys live a step or two longer.
- **D7. A stand-in that answers the contract** replaces the people's rows and the fake directory,
  for `pnpm start` and the older tests. The live run asks the real SSO. *Downside:* many older tests
  change in this step.
- **D8. The answers live in DSoR's PostgreSQL:** one table holds the 10-second reuse and the kept
  answers. It is also the evidence of what DSoR knew, and as of when. *Downside:* one indexed read
  for each call, and one write for each lookup.
- **D10, in part. A lookup waits at most 2 seconds, and is never tried again.** *Downside:* a server
  that answers in three seconds counts as one that cannot answer now.

D9, one lookup in flight for each company and person, and the rest of D10, a 10-second pause after
five failures in a row, are step 45b's.

Found by checking this design against the rules and the schemas, and put to the learner on
2026-10-28, each with Claude Code's recommendation taken:

- **D11. Each company's lookup address is in `lookups.json`, and its key comes from the
  environment,** as `DSOR_LOOKUP_KEY_ORG_456`, never from a file (DSOR-CNR-02). The specification's
  `role_source` setting holds only `kind` and `max_staleness`, and DSOR-SCH-02 keeps our own fields
  out of it. Start-up refuses a company that has a lookup and no key. *Downside:* one more settings
  file, and one variable for each company.
- **D12. The proposal's answer schema is `proposals/role-source-answer.schema.json`.** `schemas/`
  keeps only the specification's copies, byte for byte (step 03's README, decision 3). When the
  proposal lands, the file moves there unchanged. *Downside:* a second folder of schemas until then.
- **D13. An answer's `as_of` is the earlier of the server's `as_of` and the moment DSoR asked.** An
  answer read three hours ago counts as three hours old, and one up to a minute ahead counts as the
  moment DSoR asked (step 19's README, decision 14, together with D4). *Downside:* one more rule to
  hold in mind.
- **D14. DSoR sends the company key as `Authorization: Bearer`,** the HTTP standard for a credential
  (RFC 6750), so that no product's habit enters DSoR's contract. *Downside:* the Panaversity SSO's
  route reads `x-api-key` today, and must read Bearer too, a change in #1331.

### The tests, by claim

Each test changes one thing while every other check passes, so it proves that one check and no
other. The lookup's tests ask a small test server that answers the contract, with a test company key
(D7). The tests of C3 to C6 are written once, as the shared list of D5.

| Claim | Tests |
|---|---|
| C1 | `DSOR-IDN-05`: a slip signed by `user_123` in org_456 makes one request, for tenant org_456 and person `user_123`, with org_456's key. `D1`: org_789's lookup uses org_789's key, and never org_456's. `D11`: start-up refuses org_456 with a lookup address and no key in the environment, and no key appears in a log or a record. `D14`: the key travels as `Authorization: Bearer`, and a server that gets none answers `401`, a fault (C6) |
| C2 | `DSOR-IDN-04a`: `cfo_100`'s token; their roles in org_456 come from the lookup (`CFO`), and no row in `src/principals.ts` names them. `DSOR-IDN-04b`: a token that claims `CFO` for `user_700` does not change what the lookup says. `DSOR-IDN-03a`: `user_123`, `gone` from org_456, calls with a good token and is refused at line ② |
| C3 | `D2`: an answer about `cfo_100` when DSoR asked about `user_123`, and an answer about org_789 when DSoR asked about org_456, are faults. `D4`: an answer with no `as_of`, with a fourth status, or with roles while `gone` is a fault. `D4`, `D13`: an `as_of` 59 seconds ahead counts, and is recorded as the moment DSoR asked; 61 seconds ahead is a fault |
| C4 | `DSOR-IDN-07`: `gone` refuses the payment and suspends `del_100`; so does `suspended`. `DSOR-DEL-02`: the earlier steps' tests of effective authority (`user_123` moves to `ap_clerk`, and the agent under `del_100` may prepare but never execute) pass with the lookup's answers. `DSOR-AUT-01b`: `active` with a role that `roles.json` does not define is refused for lack of a permission |
| C5 | `DSOR-IDN-06`: a `429`, a `503`, no reply within 2 seconds, and no connection each let the kept answer count while it is younger than one hour; at 61 minutes the call is refused with `FRESHNESS_UNSATISFIABLE`, and an alert goes out at the first one. `DSOR-IDN-06`: an answer whose `as_of` is 61 minutes old is refused. `D10`: a reply after 2.5 seconds counts as no reply, and no second request is sent. `DSOR-BND-02`: start-up still refuses a `max_staleness` over 24 hours |
| C6 | `D2`: a `401`, a `403`, a `404`, a `200` that is not JSON, and a `200` that fails the schema are each `INTERNAL_ERROR`, and the kept answer is gone afterwards |
| C7 | `D3`: a second call 9 seconds later makes no lookup; one 11 seconds later makes one. `D8`, on PostgreSQL (`*.db.test.ts`): the answer is in the answers table; a second DSoR on the same database reuses it; after a restart the kept answer still counts; the decision's record names the answer's `as_of` |
| C8 | `D7`: `pnpm start`'s world and the older tests run through the stand-in, and `src/principals.ts` holds no person. `D6`: the timer jobs' keys still work |

The real run: `pnpm serve` against the SSO's branch, draft pull request
[panaversity/agentfactory#1331](https://github.com/panaversity/agentfactory/pull/1331) at `9081c0a24`,
on this computer, with the story's people. org_456's owner makes DSoR's company key. `user_123` is
removed from org_456 in the SSO, and the agent's next payment under `del_100` is refused, with
`del_100` suspended.

### The breaks, with the learner's predictions

The predictions were made before any code, on 2026-10-28. Each break will be made for real in a
copy, and "Break it" will show how each prediction came out.

| Break | The story | The learner's prediction |
|---|---|---|
| B1 · DSoR no longer checks whom an answer is about | At 02:00 a cache in front of org_456's SSO mixes two lookups. DSoR asks about `user_123`, who left at 01:55, and gets `cfo_100`'s answer (active, `CFO`). The agent pays PAY-901 under `del_100` | DSoR pays, as with a CFO's authority |
| B2 · a `403` is read as "cannot answer now" | At 01:00 org_456's owner takes back DSoR's key, so the SSO answers `403` to every lookup. At 02:00 the agent pays under `del_100`; DSoR's last answer is from 00:59 | DSoR pays on the kept answer until about 01:59, then refuses with `FRESHNESS_UNSATISFIABLE`; nobody learns that the key is gone |
| B3 · `as_of` is ignored | A proxy in front of the SSO serves a copy of `user_123`'s answer read at 23:00 (active, `ap_supervisor`). `user_123` left at 01:55. At 02:00 the agent pays under `del_100` | DSoR pays |
| B4 · the 10-second reuse never ends | DSoR asked about `user_123` at 01:50 (active). `user_123` left at 01:55. At 02:00 the agent pays under `del_100` | DSoR pays on the 01:50 answer |
| B5 · the 2-second timeout is deleted | At 02:00 the SSO accepts DSoR's connection and never answers. The agent pays under `del_100`; DSoR's last answer is from 01:59 (active) | The call hangs for minutes, then DSoR falls back to the kept answer |
| B6 · kept answers live in one server's memory | The SSO goes down at 02:00. DSoR asked about `user_123` at 01:58 (active). DSoR restarts at 02:05 for a deploy. At 02:06 the agent pays under `del_100` | DSoR pays on the 01:58 answer |
| B7 · line ② reads the people's rows again | `user_123` left org_456 at 01:55 but holds a token made at 01:30. At 02:00 `user_123` calls DSoR to draft a payment | DSoR allows it |
| B8 · roles are read whatever the status | `user_123` was suspended at 01:00 for an investigation, and a bug in the SSO answers `suspended` with the role `ap_supervisor`. At 02:00 the agent pays under `del_100` | DSoR pays, as `ap_supervisor` |

*The sections from "What changed since step 44" on are written as the step is built.*
