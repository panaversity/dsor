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

## What changed since step 44

| File | What changed |
| --- | --- |
| `proposals/role-source-answer.schema.json` | **New.** The shape of an answer, from our proposal for the specification: `tenant`, `person`, `status` (`active`, `suspended`, or `gone`), `roles` (empty unless `active`), and `as_of` (D4, D12). It moves into `schemas/` unchanged when the proposal lands |
| `src/lookup.ts` | **New.** The lookup: one `GET` for one company and one person, with the company's key as `Authorization: Bearer` (D1, D14). A `429`, a `5xx`, no reply in 2 seconds, or no connection is "cannot answer now". Any other reply, a redirect too, is a fault (D2, D10) |
| `src/authority.ts` | Line ③'s question reads answers in the proposal's shape. An answer about someone else is a fault. An `as_of` must be a real RFC 3339 time, at most one minute ahead, and the answer counts from the earlier of it and the moment DSoR asked (D13). An answer is used again for 10 seconds (D3). `gone` refuses like `suspended`. `memberOf` asks the same question for line ② |
| `src/answers.ts` | **New.** The kept answers, one for each company and person, in memory. Older news never replaces newer, and a kept answer from the future never blocks a new one |
| `src/postgres.ts`, `migrations/047_role_answers.sql` | **New table** `dsor.role_answers`, under row-level security: the kept answers in DSoR's PostgreSQL, shared by every DSoR server, kept over a restart (D8). `dsor_runtime` may not delete a row: an answer DSoR forgets leaves its row empty |
| `src/store.ts`, `store.json` | The map gains a kind of table, `control-kept`, and the new table |
| `src/lookups.ts`, `lookups.json` | **New.** Each company's lookup address, and its key from the environment, `DSOR_LOOKUP_KEY_ORG_456`, never from a file (D11). Start-up refuses any problem, and names a variable, never its value |
| `src/serve.ts` | `pnpm serve` asks each company's lookup. The fake directory is gone. The kept answers have a database pool of their own |
| `src/pipeline.ts` | Line ② asks a person's company what she holds, for her own call (C2, Q7) |
| `src/principals.ts`, `src/stand-in.ts` | The five people leave DSoR's table for a stand-in sign-in server: the key each person signs in with, and what each company says about her (D7). The agents and the timer jobs stay (D6) |
| `src/logins.ts` | A person's key at the stand-in names her and nothing more. In `pnpm serve`, a token names a person unless DSoR's table names that login as no person |
| `src/delegation.ts`, `src/controls.ts`, `src/alerts.ts` | Start-up and line ③ no longer read a person's job from DSoR's table (D15) |
| `src/release.ts`, `src/proposals.ts`, `src/approve.ts` | A release asks the company about a person who asked for herself. The records of a person's own call name the role source and its time |
| `src/main.ts` | `pnpm start` uses the stand-in. Its story sets the kept answer aside where it says the night moves on, and brings the directory back before user_123's retry |
| `src/directory.ts`, `src/log.ts`, `src/suspensions.ts` | The fake directory answers in the proposal's shape. Comments |
| `test/role-source-list.ts`, `test/lookup.test.ts` | **New.** The list every role source passes (D5), run against the lookup |
| `test/sign-in-server.ts` | **New.** A small sign-in server for the tests, with switches: answer about someone else, reply unreadably, serve old facts, fail, hang, or redirect |
| `test/lookup-replies.test.ts`, `test/answers.test.ts`, `test/answers.db.test.ts`, `test/kept-answers.ts`, `test/lookups.test.ts`, `test/people.test.ts` | **New.** Each kind of reply; the 10-second reuse; the answers on PostgreSQL; `lookups.json` and the keys; line ② and the stand-in |
| `test/helpers.ts`, `test/cross-tenant.ts`, `test/companies.ts`, `test/catalogs.ts`, `test/db.ts`, and 30 more test files | The older tests now say what changed: a person planted by a test is planted at the stand-in, a test that changes a person waits past the 10 seconds, and a person's own call needs her company's answer |

```bash
git diff --no-index ../mj_44_tokens_made_for_dsor/src src
git diff --no-index ../mj_44_tokens_made_for_dsor/test test
```

## Run it

A local PostgreSQL 17 and a new database of its own, as in step 44. Migration 047 is new.

```bash
pnpm install
pnpm check
pnpm migrate
pnpm test:db test/answers.db.test.ts
pnpm start          # the story, with the stand-in sign-in server
```

`pnpm serve` needs each company's key in the environment, and refuses to start without one. Started
with no keys set, a real run:

```text
lookups.json refused to start:
  lookups.json: org_456 has a lookup, and DSOR_LOOKUP_KEY_ORG_456 is not set
  lookups.json: org_789 has a lookup, and DSOR_LOOKUP_KEY_ORG_789 is not set
```

**The live run.** On 2026-10-28, `pnpm serve` asked the Panaversity SSO, branch
`feat/sso-dsor-fix-list` (draft pull request
[panaversity/agentfactory#1331](https://github.com/panaversity/agentfactory/pull/1331)) with one
more commit, `fa9a10ac1`, so that its lookup reads the key as `Authorization: Bearer` (D14). The SSO
ran on this computer, on port 3011, over a copy of step 44's data. Nothing in production was
touched. Three things were set up there first:

- org_789, with user_700 as its AP supervisor;
- an owner for each company, who made that company's DSoR key at `POST /api/dsor/keys`. Only a
  company's owner may make one, and the key answers about that company only;
- a new test password for cfo_100, through the SSO's own reset flow.

cfo_100 signed in, and DSoR's app `dsor-people` got her token through the authorization-code flow
with PKCE, as in step 44. Then the run. Its own words, with times in UTC; tokens, keys, and
passwords are never printed:

```text
cfo_100's token, its claims only: {"iss":"http://localhost:3011","sub":"cfo_100","aud":["http://127.0.0.1:8042","http://localhost:3011/api/auth/oauth2/userinfo"],"azp":"dsor-people","scope":"openid dsor","lifetime_s":3600}
  the token carries no company and no role: true

16:09:48 1. cfo_100 reads INV-1008 with her token; line ② asks org_456 about cfo_100
   DSoR: 200 INV-1008, VENDOR-44, 31400.00 USD
16:09:48 2. the agent reads INV-1008 under del_100; line ③ asks org_456 about user_123
   DSoR: 200 INV-1008, VENDOR-44, amount masked

   dsor.role_answers now:
   org_456 cfo_100: active ["CFO"], as_of 2026-10-28T16:09:48.856Z, asked 2026-10-28T16:09:48.856Z
   org_456 user_123: active ["ap_supervisor"], as_of 2026-10-28T16:09:48.935Z, asked 2026-10-28T16:09:48.935Z
   the agent's record, subject_authority: {"as_of":"2026-10-28T16:09:48.935Z","source":"role_source"}

16:09:48 3. org_456's owner removes cfo_100 at the SSO. DSoR asks again after 10 seconds (D3)
16:09:49    at once: 200 INV-1008, VENDOR-44, 31400.00 USD
16:10:00    11 seconds later: 403 AUTHORIZATION_DENIED: the caller may not work in the tenant it named
16:10:01    org_456's owner adds cfo_100 back as CFO
16:10:12    11 seconds later: 200 INV-1008, VENDOR-44, 31400.00 USD

16:10:12 4. user_123 leaves org_456 at the SSO; the agent reads 11 seconds later
16:10:23    DSoR: 403 DELEGATION_REQUIRED: "invoice.get": slip del_100 is signed by user_123, whom the directory of org_456 does not list as active
   her slips in DSoR now: del_100 suspended, del_101 suspended

16:10:23 5. org_456's owner takes back DSoR's key at the SSO; cfo_100 reads 11 seconds later
16:10:23    the SSO: key taken back, 200
16:10:34    DSoR: 500 INTERNAL_ERROR: the directory of org_456 answered with something DSoR cannot use
```

And what the SSO saw in the same minute, from its own log. Six lookups, not seven: the read "at
once" in part 3 asked nothing, because DSoR used its answer of 16:09:48 again.

```text
GET /api/dsor/lookup?tenant=org_456&person=cfo_100 200 in 32ms
GET /api/dsor/lookup?tenant=org_456&person=user_123 200 in 18ms
GET /api/dsor/lookup?tenant=org_456&person=cfo_100 200 in 191ms
GET /api/dsor/lookup?tenant=org_456&person=cfo_100 200 in 44ms
GET /api/dsor/lookup?tenant=org_456&person=user_123 200 in 99ms
GET /api/dsor/lookup?tenant=org_456&person=cfo_100 401 in 26ms
```

Part 3 is D3's downside, seen for real: for up to 10 seconds after she was removed, cfo_100 still
read the invoice whole, and once she was back, she read it again 11 seconds later. Part 5 is break
B2's story, as built: a key taken back is a fault that someone must fix, not "cannot answer
now". This run was made again after the review's fixes, on the same day.

## Break it

Each break was made for real, in a copy of this step, with a story test that tells what DSoR
answers, once as built and once broken. The predictions are the learner's, from before any code.

| Break | The learner's prediction | As built | Broken |
|---|---|---|---|
| B1 · DSoR no longer checks whom an answer is about | DSoR pays, as with a CFO's authority | `INTERNAL_ERROR`: the directory of org_456 answered with something DSoR cannot use | `AUTHORIZATION_DENIED`: `"payment.create"` needs payment:create, which user_123, who signed slip del_100, does not hold now |
| B1b · the same break, and the mixed-up answer is user_124's, another AP supervisor | (not asked) | `INTERNAL_ERROR` | **the draft is made** |
| B2 · a `403` is read as "cannot answer now" | DSoR pays on the kept answer until about 01:59, then `FRESHNESS_UNSATISFIABLE`; nobody learns the key is gone | `INTERNAL_ERROR` at 01:30 and at 02:00 | the draft is made at 01:30; `FRESHNESS_UNSATISFIABLE` at 02:00 |
| B3 · `as_of` is ignored | DSoR pays | `FRESHNESS_UNSATISFIABLE` | the draft is made |
| B4 · the 10-second reuse never ends | DSoR pays on the 01:50 answer | `DELEGATION_REQUIRED`: user_123 is not listed as active | the draft is made |
| B5 · the 2-second timeout is deleted | The call hangs for minutes, then DSoR falls back to the kept answer | the draft is made, after 2.0 seconds | the draft is made, after **301.1 seconds** |
| B6 · kept answers live in one server's memory | DSoR pays on the 01:58 answer | the draft is made | `FRESHNESS_UNSATISFIABLE` |
| B7 · line ② reads the people's rows again | DSoR allows it | `AUTHORIZATION_DENIED`: the caller may not work in the tenant it named | the draft is made |
| B8 · roles are read whatever the status | DSoR pays, as `ap_supervisor` | `INTERNAL_ERROR` | `INTERNAL_ERROR` |

Five predictions came out as the learner said: B2, B3, B4, B5, and B7. Three did not, and each
teaches something:

- **B1.** DSoR refused, but by luck: the CFO's role does not hold `payment:create`, so the borrowed
  authority could not pay. B1b changes one thing, whose answer it is, and the payment is drafted.
  The check of whom an answer is about is what stands between the two.
- **B5.** The prediction was right, and the number is worth knowing. With DSoR's own two seconds
  gone, Node's `fetch` gave up after 300 seconds of its own: an agent's call held for five minutes,
  while every other call that asked the same server waited too.
- **B6.** The prediction describes the step as built, not the break. Broken, each DSoR server keeps
  its answers in its own memory, so the restart at 02:05 forgot the 01:58 answer, and with the SSO
  down there was nothing to use: refused. As built, the answer is in `dsor.role_answers`, and the
  restarted DSoR pays on it.
- **B8.** Refused either way. The proposal's schema allows roles only while `active`, so an answer
  that says `suspended` with `ap_supervisor` is a fault before its status is ever read. Two checks
  stand in front of the same harm: break one, and the other still holds.

Each new check was also broken one at a time, in a copy, against the unit and database tests: 11
in line ③'s question, 12 in the reuse and the table, 8 in `lookups.json`, 10 in line ② and the
stand-in, and 15 after the review: ten of its changes that no test caught, and five breaks of its
fixes. Every one is caught now, many only after the test that catches it was written, and those
tests are in this step.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | Step 43d's understanding session, then the questions of steps 44 and 45, from two stories |
| 2 | Decide | Q1, Q5 to Q8 for the chain, D1 to D10 for this step, then D11 to D14 from checking the design against the rules and the schemas, each put to the learner. D15 came from the build, and waits for the learner's review |
| 3 | The copy | Step 44 copied, its markers removed |
| 4 | Build, piece by piece | Five pieces, each with its tests, its breaks, and its own commit: the design check and the shared list; line ③'s question through the lookup; the reuse and the table; `lookups.json` and the keys; line ② and the stand-in |
| 5 | The real run | `pnpm serve` against the Panaversity SSO on this computer |
| 6 | Break it | Eight breaks, each made for real in a copy and set beside its prediction |
| 7 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 45 in learner mode from the design in
docs/baby_steps_tutorials/mj_45_ask_the_sign_in_server/README.md and the decisions in
docs/baby_steps_tutorials/mj_decisions.md, entries 1 to 27.
```

## Check yourself

1. At 02:00:00 the agent reads INV-1008 under del_100. At 02:00:05 org_456 removes user_123 at the
   SSO. At 02:00:08 the agent pays PAY-901. What happens, and what at 02:00:12?
   <details><summary>Answer</summary>At 02:00:08 the payment is drafted: DSoR asked about user_123 less than 10 seconds before, so it uses that answer again and does not ask (D3). At 02:00:12 it asks again, hears <code>gone</code>, refuses with <code>DELEGATION_REQUIRED</code>, and suspends del_100 and del_101. Part 3 of the live run shows the same window for cfo_100.</details>
2. A cache in front of org_456's SSO serves user_123's answer, read at 23:00: active, `ap_supervisor`.
   At 02:00 the agent pays. What happens?
   <details><summary>Answer</summary><code>FRESHNESS_UNSATISFIABLE</code>. The answer counts from the earlier of its own <code>as_of</code> and the moment DSoR asked (D13), so it is three hours old, and org_456 allows one hour. Break B3 shows the payment drafted when <code>as_of</code> is ignored.</details>
3. org_456's owner takes back DSoR's key. Why does DSoR answer `INTERNAL_ERROR`, and not keep using
   the answer it holds?
   <details><summary>Answer</summary>A <code>401</code> or <code>403</code> is not "cannot answer now": the server answered, and said DSoR may not ask. Someone must fix it. Using the kept answer would hide the missing key for up to an hour, while a person who left kept her power. Part 5 of the live run, and break B2.</details>
4. cfo_100's token names her and carries no company and no role. How does DSoR know she is the CFO of
   org_456 when she reads INV-1008?
   <details><summary>Answer</summary>Line ② asks org_456's lookup about cfo_100, for the company her call names (C2). The answer says <code>active</code>, <code>CFO</code>. A role written in her token would count for nothing (DSOR-IDN-04b): the token says who she is, her company says what she holds.</details>
5. The SSO goes down at 02:00. DSoR asked about user_123 at 01:58, and restarts at 02:05 for a deploy.
   At 02:06 the agent pays. What happens, and until when?
   <details><summary>Answer</summary>The payment is drafted on the 01:58 answer, because the answers live in <code>dsor.role_answers</code> and a restart keeps them (D8). It counts until about 02:58, org_456's one hour. After that, with the SSO still down, DSoR refuses with <code>FRESHNESS_UNSATISFIABLE</code>. Break B6 shows the restart forgetting it.</details>

## Think it through

### Found while building

Each was found by a run, fixed in the piece that made it, and tested:

- **A warning on start-up.** Once `src/authority.ts` compiled the proposal's schema, the schema
  checker printed "unknown format date-time" to stderr, and `pnpm start` must print nothing there.
  The checker now checks no formats, as `src/slips.ts` does, and the code reads an `as_of` itself.
- **A date that does not exist.** `Date.parse` reads 30 February as 2 March, and the hour 24 as
  the next midnight. RFC 3339, which the proposal names, has neither. An `as_of` like that is now a
  fault, with a test for each.
- **Tests that called again at once.** Since D3, a change at the server counts from the first
  question 10 seconds after the last. Older tests that changed a person and called again at once
  now move DSoR's clock past the 10 seconds. `pnpm start`'s story sets the kept answer aside where
  it says the night moves on.
- **A deadlock.** A release asks line ③'s question again inside its claim, a database transaction
  that holds one of the pool's connections. The kept answers needed a second connection from the
  same pool. With two releases at once and a pool of two, each waited for the other forever. The
  kept answers now have a pool of their own. Found by the database tests, which timed out.
- **An answer from the future.** Older news never replaces newer. So a kept answer whose `as_of`
  was later than DSoR's clock, left by a clock that went back, blocked every new answer until the
  clock caught up. Now a kept answer from the future never stops a new one: step 19's decision 15,
  for keeping as well as for using.
- **Forgetting without deleting.** `dsor_runtime` may not delete a row (step 16's decision 3), so
  an answer DSoR forgets leaves its row with no answer. The map gained a kind of table for that,
  `control-kept`.
- **A citation that did not move.** The cross-tenant suite turns an example into a same-company
  call by moving its addresses into the caller's company. It did not move a `ksor://` citation, so
  org_789's rule draft cited org_456's policy. Step 44 refused that draft for its owner first. Once
  D15 stopped reading the owner's job, the citation was read, and its refusal repeated
  `org_456` back. The suite now moves the citation too.

### What the review found

A reviewer who had not seen the conversation attacked the step as the agent would, with inputs of its
own, and changed the code 55 times, one change at a time, in a copy. Eight findings; 14 changes left
every test green.

Fixed, each with a test that fails without the fix:

- **A person could learn which companies DSoR serves (finding 3, DSOR-ERR-01b).** Naming a company
  DSoR does not serve gave `INTERNAL_ERROR`, "no role source for org_999"; naming one whose server
  was down gave `FRESHNESS_UNSATISFIABLE`, naming its directory; any other company, the stranger's
  words. Now a person DSoR knows nothing about in a company hears the stranger's words, whatever
  stopped the answer. A person DSoR keeps an active answer about there hears the real refusal.
- **An older reply still decided (finding 4).** When a lagging server answered with facts older
  than the answer DSoR kept, the store refused to keep the older reply, but the call decided on it
  anyway: `ap_supervisor` again, though DSoR knew `ap_clerk`. Now the newer of the two decides.
- **A fault never forgot an answer from the future (finding 5).** An answer kept by a DSoR server
  whose clock ran ahead was never forgotten after a reply DSoR could not use. Now it is, as
  keeping already replaced one.
- **The keys could come from `.env` (finding 7).** D11 says never from a file. `pnpm serve` now reads
  them only from the environment it is started in.
- **Ten untested edges.** The minute's edge (61 seconds ahead is a fault, 59 counts); a time with no
  zone; a kept answer's age from its facts' time; the kept answer read again after the 2-second wait;
  a `203` with a good answer; the lookup letting go of the request it waited on; a login that brings
  roles of its own; a release's record of a person's authority; the answers' own pool in `pnpm
  serve`; and the store forgetting by the moment DSoR asked. Each now has a test.

Put to the learner, with D15 (entry 28 of [`../mj_decisions.md`](../mj_decisions.md)):

- **Finding 1: any account the company lists counts as a person.** With no person in DSoR's table,
  a service account that the SSO lists as an active member, with a role, can sign in through
  `dsor-people` and act in direct mode: read unmasked, draft with no slip, approve as a CFO. The
  answer says nothing about what kind of account it is. *Proposed:* the contract's answer carries
  `kind`, and DSoR acts only on `person`.
- **Finding 6: the escalation person is no longer checked.** An escalation to someone who cannot
  see alerts reaches nobody. *Proposed:* the sweep asks the company's lookup about her.
- **Finding 8: a lookup on another server.** Tokens come from the one issuer in `sign-in.json`, and
  a company's lookup could sit on another server, which may give the same id to someone else.
  *Proposed:* start-up refuses a lookup whose origin is not the issuer's.

For step 45b, which protects the server:

- **Finding 2: a stranger can spend a company's lookups.** Any person with a token from the SSO can
  name org_456, and each call asks org_456's lookup with org_456's key. A failure is not kept, so
  the next call asks again. If a server limits each key, a flood of strangers turns org_456's own
  lookups into `429`s, and the kept answers keep counting up to the hour. *Proposed for 45b:* DSoR
  asks about the same company and person at most once in 10 seconds, whatever the reply, and holds a
  budget of lookups about people it knows nothing about.

Lower, and left open: a reply cut off after its headers is a fault, which errs on the safe side; a
company served only by people cannot have a role source, since "companies where a login works"
still come from DSoR's table; `dsor.role_answers` gains a row for each stranger in each company,
and `dsor_runtime` deletes none; the answer's schema takes the specification's `1.3` name before the
specification has it; a release of a person's own proposal holds its claim during a lookup of up to
2 seconds; nothing caps an answer's size; and two DSoR servers keeping at once is not tested. Four
of the review's changes that no test caught make DSoR only stricter, such as reading a `502` as a
fault, and have no test either.

### D15, a decision the build forced

With no person in DSoR's own table, three checks could no longer read a person's job there:

| Check | Before step 45 | Now |
|---|---|---|
| A slip's signer, at line ③ | DSoR's table had to know her as a person, "because a directory lists service accounts too" (step 19's decision 13) | Refused only when DSoR's table names her as an agent, an application, or a timer job. Anyone else, her company answers for |
| A control's owner, at start-up and at a draft | A person who works in the control's company | Not a login DSoR knows as no person. She switches a rule on only in person, and line ② asks her company then |
| `alerts.json`'s escalation person and receivers | A person of the company who can settle a payment and see alerts; a role that a person of the company holds | The person is not a login DSoR knows as no person; the role is in `roles.json` and holds `alert:read` |

**Downside:** a company's server now decides who is a person. If it lists a service account as an
active member with `ap_supervisor`, that account can sign a slip. And start-up no longer catches an
escalation that goes to someone who cannot settle a payment (step 38b's review, finding M3): that
person learns it only when she tries. Claude Code took D15 during the build, with this
recommendation, and it waits for the learner's review: keep it, or keep a list of people's ids in
DSoR after all.

### Left open on purpose

- **Not built: Q8's alert.** Decision Q8 says that at the first `FRESHNESS_UNSATISFIABLE`, the
  company's alert receivers hear, and claim C5 promised it. This step refuses the call, and records
  it, but raises no alert. In this tutorial an alert belongs to a proposal, raised when a payment's
  outcome is unknown (step 38b), and a sign-in server that cannot answer has no proposal: it needs
  a kind of alert of its own. It fits step 45b, which is about a server that is down, and is put
  to the learner there.
- **A stale "suspended" after a lift.** When a person comes back and her owner lifts the
  suspensions, an agent call within 10 seconds of DSoR's last question still uses the old
  "suspended" answer, and suspends her slips again. It fails closed: the owner waits 10 seconds.
- **Line ② suspends nothing.** When line ② hears that a person who calls for herself is gone, it
  refuses her, but her slips are suspended only at her agent's next call, at line ③.
- **`max_staleness` of zero.** A company may set it, and then every call is refused, even with a
  fresh answer: nothing is younger than zero.
- **Two pools.** Each DSoR server opens a second pool for the kept answers. Step 45b counts
  connections.
- **The sign-in server is not protected yet.** A thousand calls about one person in the same second
  are a thousand questions, once the 10 seconds pass together, and a server that is down is asked
  at every call. Step 45b.
- **The proposal.** The lookup contract is not in the specification yet. `proposals/` holds its
  schema, and `mj_notes.md` its sentences, until they are proposed together.

### Found later, and fixed here

- **A release threw a waiting payment away when the sign-in server could not answer** (step 45c's
  review, finding 1; entry 44 of [`../mj_decisions.md`](../mj_decisions.md)). A release asks again
  about the person who made the request, with the question line ② asks. For someone DSoR kept no
  active answer about, a `503` gave the words every stranger hears, and the release read them as
  "no": `APPROVAL_INVALIDATED`. Now only a person's own call hears the stranger's words. The
  release hears `FRESHNESS_UNSATISFIABLE`, and the proposal waits. Fixed on 2026-10-29, with a
  test that fails without the fix.

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-IDN-03a | A call works in one company, where its caller holds a membership | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/people.test.ts` (C2), `test/role-source.test.ts`, `test/slips.test.ts` |
| DSOR-IDN-04a | Roles come only from an issuer or role source the company trusts | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/people.test.ts` (C2) |
| DSOR-IDN-04b | A claim from anywhere else decides nothing | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/people.test.ts` (C2), `test/logins.test.ts` |
| DSOR-IDN-05 | Each company has a role source that DSoR asks about a person who is not in the request | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `test/lookup.test.ts`, `test/lookup-replies.test.ts`, `test/lookups.test.ts` (C1) |
| DSOR-IDN-06 | With no authority recent enough, the command is refused | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `test/lookup.test.ts`, `test/lookup-replies.test.ts` (C5), `test/answers.test.ts`, `test/answers.db.test.ts`, `test/people.test.ts` (a release that waits) |
| DSOR-IDN-07 | A signer reported suspended or gone has every slip she signed suspended | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `test/lookup.test.ts`, `test/suspended-slips.test.ts` (C4) |
| DSOR-AUT-01b | No permission granted, no operation | [§15](../../../specs/dsor/02-security.md#15-authorization) | `test/role-source.test.ts`, `test/people.test.ts` (C4) |
| DSOR-DEL-02 | Effective authority is the slip's grants cut down to the signer's authority now | [§13](../../../specs/dsor/02-security.md#13-delegation) | `test/role-source.test.ts`, `test/recheck.test.ts` (C4) |
| DSOR-BND-02 | A company's setting never loosens a bound | [§44](../../../specs/dsor/06-conformance.md#44-operational-bounds) | `test/role-source.test.ts` (C5) |
| DSOR-TEN-02a | Caches are kept by company | [§14](../../../specs/dsor/02-security.md#14-multi-tenancy) | `test/role-source.test.ts`, `test/answers.db.test.ts` (C7) |
| DSOR-CNR-02 | No credential reaches the model or the agent | [§35](../../../specs/dsor/05-bindings.md#35-connector-contract) | `test/lookups.test.ts` (C1, D11) |
| DSOR-ERR-01b | An error reveals nothing the caller may not read | [§28](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) | `test/people.test.ts`, `test/suspended-slips.test.ts` |

The contract, the reuse, the table, the settings file, the timeout, the earlier-of rule, the Bearer
key, and the stand-in are this tutorial's decisions, and so is D15: those tests are titled by D2,
D3, D4, D7, D8, D10, D11, D13, D14, D15, and Q7.

**Next:** step 45b, protect the sign-in server. When a thousand calls about user_123 arrive in the
same second, DSoR will ask once and share the answer (D9). After five failures in a row, it will
stop asking for 10 seconds, so a server that is down is not hammered as it comes back (D10).
