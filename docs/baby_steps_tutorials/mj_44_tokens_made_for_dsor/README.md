# Step 44 · Tokens made for DSoR

**New in this step:** a person is who a token *made for DSoR* says. The token must come from the
one sign-in server DSoR trusts, name DSoR as its audience, carry the `dsor` scope, come from a
client on DSoR's own list, and be at most one hour old (DSOR-RP-02b, DSOR-IDN-01, DSOR-IDN-04a,
DSOR-IDN-04b).

## In plain words

Since step 05, a caller proves who they are with a fixed key from a table in the code:
`tok_d4e8` is cfo_100. The table is `src/principals.ts`, a public file, and a key never expires.
This step replaces those keys, for people, with real sign-in. Agents keep their keys until steps
48 and 49.

A person signs in at a *sign-in server*, here the Panaversity SSO. It gives them a *signed token*:
a short text that says who they are, who issued it, for which service it is meant, and until when.
The server signs it with a private key that only it holds. It publishes the matching public keys
at a fixed address, so anyone can check a signature, and nobody else can make one.

Think of the new clerk at DSoR's front desk. A visitor shows a badge. The clerk checks three things
before anything else: this building's own security desk printed it, it was printed for *this*
building, and it was printed recently. A real badge from the same security company, printed for
the building next door, does not open this door.

**Words this step uses.**

- A *JWT* (JSON Web Token) is a signed token in three parts, separated by dots: a header (which key
  and which algorithm), the claims, and the signature.
- A *claim* is one field of the token: `iss` the issuer, `sub` the subject (the person's id at the
  issuer), `aud` the audience (the services it is meant for), `iat` when it was issued, `exp` when
  it expires, and `scope` the permissions the person granted the client.
- A *client* is the app that asked the sign-in server for the token. The token names it in `azp`
  (OpenID Connect's "authorized party") or in `client_id` (RFC 9068).
- A *JWKS* (JSON Web Key Set) is the list of public keys the issuer publishes. *RS256* is the
  signing method the Panaversity SSO uses.
- An *audience* is the address of the service a token is for. DSoR's is `http://127.0.0.1:8042`,
  where `pnpm serve` listens.

## Why it matters

A real run on 2026-10-27, on this folder before any change (a copy of step 42), in memory, through
the real HTTP door on `127.0.0.1`. Token 3 was signed with a new RS256 key, in the shape the
Panaversity SSO gives.

```text
1. The agent drafts INV-1008, 31,400.00 USD, through the door
   HTTP 202: {"outcome":"PENDING_APPROVAL"}
2. Anyone who read src/principals.ts sends cfo_100's key, tok_d4e8, and approves
   HTTP 200: {"outcome":"COMMITTED","state":"APPROVED"}
   DSoR's log: proposal.approve@1, ALLOW, by cfo_100
3. cfo_100 signs in at the SSO and sends a signed token made for DSoR
   HTTP 401: AUTHENTICATION_REQUIRED: log in first: the call has no login token that DSoR gave
```

1. **The CFO's approval is anyone's.** "Only the CFO approves above 25,000 USD" (step 29) rests on
   knowing who the CFO is. A key from a public file approved 31,400.00 USD, and the log blames
   cfo_100.
2. **The real person cannot get in.** A correctly signed token from a real sign-in server is
   refused, because DSoR knows only its own table of keys.

Step 43 fixed both for people, but it took **any** token the sign-in service issued, whatever
service it was made for (its review's finding M2). In Panaversity's story, Junaid's token for the
class app, from the same SSO, would have counted at DSoR as Junaid. This step checks that a token
was made for DSoR itself.

**Common mistake:** checking that a token is *real*, and not that it is *for you*. A token the SSO
signed for the class app passes every signature check. Only the audience, and the client that
asked for it, say that it was meant for DSoR.

## The design, before any code

### How this step was made

The understanding session for step 43d questioned steps 43 to 43c from two stories: the finance
story and Panaversity ops. It found that they kept a second copy of what a sign-in server already
keeps: account links, invitations, and company membership. The learner then decided where identity
ends and authority begins (Q1 to Q10), a new chain of steps that branches from step 42 (steps 43 to
43c stay as an explored path), and six answers that the Panaversity SSO's fix list reopened (R1 to
R6). The record is in [`../mj_notes.md`](../mj_notes.md), from "Step 43d, paused" on. So this
folder copies step 42, not step 43c.

### What the rules say

From [§37](../../../specs/dsor/05-bindings.md#37-identity-binding):

- **DSOR-RP-02b:** "DSoR MUST reject an access token whose audience or resource (RFC 8707) is not
  this DSoR deployment."

From [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) and
[§12.1](../../../specs/dsor/02-security.md#121-role-source):

- **DSOR-IDN-01:** "DSoR MUST normalize every caller into a principal with a type and tenant
  memberships before any other processing."
- **DSOR-IDN-04a:** "Role and scope assertions MUST be accepted only from a token issuer or role
  source configured as authoritative for the active tenant."
- **DSOR-IDN-04b:** "A claim from any other origin MUST NOT be used in an authorization decision."

From [§21](../../../specs/dsor/03-execution.md#21-command-pipeline):

- **DSOR-EXE-02:** "The decision — outcome, controls evaluated, and the reason for any `DENY` —
  MUST be durably recorded before the response is returned."

MCP's authorization rules (version 2026-07-28) say the same as DSOR-RP-02b for any MCP server: it
must check that a token was issued for it as the intended audience.

What the Panaversity SSO gives, from its branch `feat/sso-dsor-fix-list` (`apps/sso/docs/dsor.md`)
and step 43c's run: RS256 tokens with a `kid`, keys at `/api/auth/jwks`, an `aud` that lists DSoR's
address and the SSO's own userinfo address when the `openid` scope is asked for, `azp` naming the
client and no `client_id` claim, and a one-hour life only for a token with the `dsor` scope, which
only a client registered with `dsor` can get.

### The claims

| Claim | What it says |
|---|---|
| C1 | A person's call counts only with a token made for DSoR (DSOR-IDN-01, DSOR-RP-02b). All of these hold at once: signed with an allowed algorithm (RS256) by a key the trusted issuer publishes; `iss` exactly the trusted issuer; `aud` names DSoR's address, and any other audience is the SSO's own userinfo address; `scope` includes `dsor`; the client, from `client_id` or `azp` and the same in both when both are present, is on DSoR's list; `sub` and `iat` present; not expired; `iat` at most one hour ago; five seconds of clock slack |
| C2 | Every refused token hears one answer, `AUTHENTICATION_REQUIRED`, at line ①, before any company's code runs, with the decision and its reason recorded before the answer (DSOR-IDN-01, DSOR-EXE-02) |
| C3 | A person's companies and roles come only from step 42's table, read by the token's `sub` (DSOR-IDN-04a, DSOR-IDN-04b). A role or company claim in the token is never read. A good token whose `sub` is nobody in the table hears `AUTHENTICATION_REQUIRED` |
| C4 | In `pnpm serve`, a person's step-42 key is refused, and an agent's key still works. The two are told apart by form. `pnpm start` and the earlier tests keep the fake table |
| C5 | Start-up refuses settings that trust too much: `none` or a shared-secret algorithm, an age over one hour, no audience, no `dsor` scope, an empty client list, or an issuer that is not an absolute address |
| C6 | Keys that cannot be fetched are an outage, not a bad token: `CONNECTOR_UNAVAILABLE`, retry `safe_same_key`, recorded with the cause, never "log in first". A token whose key the issuer does not publish is still a bad token |

### Decisions

The learner's, 2026-10-26 and 2026-10-27, each with Claude Code's recommendation taken. Before
this step, for the whole chain:

- **Q1. The sign-in server holds who has which role; DSoR holds what a role may do.** A person's id
  is the issuer and `sub`. No link table and no invitations. *Downside:* DSoR depends on that
  server, and whoever runs the org there can grant money roles.
- **Q2. Tokens no older than one hour by `iat`, checked by DSoR itself,** whatever `exp` says.
  *Downside:* clients must refresh every hour.
- **Q2b. The Panaversity SSO is the one sign-in server for both stories,** run on this computer.
  *Downside:* the steps depend on a second repository.

For this step:

- **44-1. Step 43's token checks come over:** `jose` 6.2.12, its rule for a token, its start-up
  refusals, `CONNECTOR_UNAVAILABLE` for an outage of the keys, and one answer for every bad token.
  Dropped: `dedicated_to_dsor`, the link table, and invitations. *Downside:* step 43's choices come
  along without a fresh look.
- **44-2. One trusted issuer for every company,** in one small settings file. *Downside:* a company
  that brings its own Okta later needs the file to grow into a list.
- **44-3. The audience is DSoR's own address,** `http://127.0.0.1:8042`. *Downside:* when DSoR
  moves, both ends change together.
- **44-4. A person's id is the token's `sub`.** The story's people are seeded in the local SSO with
  their story ids, so slips and audit keep `user_123` and `cfo_100`. *Downside:* a seed in the
  SSO's database, outside DSoR, and one issuer per deployment.
- **44-5. Until step 45, companies and roles come from step 42's table, read by id.** *Downside:* a
  table in the code for one step, which step 45 removes.
- **44-6. People's step-42 keys are gone from `pnpm serve`.** `pnpm start` and the earlier tests
  keep them, as their world's choice. *Downside:* the old tests still prove things with fake
  people.
- **44-7. A token is told from an agent's key by its form:** three dot-separated parts is a token.
  *Downside:* two kinds of credential share one header until steps 48 and 49.
- **44-8. Tests sign tokens with a test-only key; the real run uses the local SSO.** No stand-in
  server. *Downside:* the real run needs the SSO running on this computer.
- **44-9. A token's audiences are DSoR and, at most, the SSO's own userinfo address.** A token also
  made for another app is refused, because that app could hand it on. *Downside:* a rule shaped by
  how Better Auth fills `aud`.
- **44-10. A good token for nobody in the table hears `AUTHENTICATION_REQUIRED`,** so DSoR tells a
  stranger nothing. *Downside:* a real person missing from the table sees "log in first".
- **R1. The client is `client_id` or `azp`, and the two must agree** when both are present.
  *Downside:* two claim names to explain and to test.
- **R2. A token carries the `dsor` scope and comes from a client on DSoR's own list.** The SSO lets
  any of its clients ask for DSoR's audience, so the audience alone is not enough. *Downside:* one
  more list in DSoR's settings, kept in step with the SSO.

### The tests, by claim

Each test changes one thing while every other check passes, so it proves that one check and no
other. The tests sign their tokens with a test-only key (44-8).

| Claim | Tests |
|---|---|
| C1 | `DSOR-IDN-01`: cfo_100's token from the trusted SSO, made for DSoR, with `dsor` and a listed client, makes cfo_100 the caller, a person, who reads INV-1008 whole. `DSOR-RP-02b`: a token made for DSoR's test copy at `http://127.0.0.1:8043` is refused; one whose `aud` lists DSoR and the class app is refused; one whose `aud` lists DSoR and the SSO's userinfo address counts. `R2`: no `dsor` scope is refused; a client not on DSoR's list is refused. `R1`: `azp` alone counts; `client_id` alone counts; both and equal count; both and different are refused; neither is refused. `Q2`: 59 minutes after `iat` counts; 61 minutes is refused, though `exp` is days away. From step 43: another key, another issuer (a trailing slash), HS256 signed with the public key, `none`, ES256 when only RS256 is allowed, no `sub`, no `iat` or one in the future, expired 10 seconds (refused) and 3 seconds (counts), and a key that stops being published |
| C2 | `DSOR-IDN-01`: a refused token never reaches the company's code, and line ① refuses it. `DSOR-EXE-02`: the refusal is recorded, with its reason, before the answer. `DSOR-IDN-01`: every kind of bad token hears the same `AUTHENTICATION_REQUIRED` |
| C3 | `DSOR-IDN-04b`: user_700's token claims `tenant_id` org_456 and `org_role` CFO; DSoR reads neither, and user_700 is refused in org_456. `DSOR-IDN-04a`: user_123's roles come from the table by `sub`: ap_supervisor in org_456. `44-10`: a good token for user_555, a student nobody listed, hears `AUTHENTICATION_REQUIRED`, and the log says why |
| C4 | `44-6`: in `pnpm serve`'s world, `tok_d4e8` is refused at line ①, and the agent's `tok_7f3a` still works. `44-6`: `pnpm start`'s world keeps step 42's table, where `tok_d4e8` is cfo_100. `44-7`: a three-part string that is not a valid token is refused and never looked up as a key; a key no agent holds is refused |
| C5 | `44-2`: the shipped settings pass and name the local SSO. Start-up refuses `none`, HS256, an age over one hour, a missing audience, a missing `dsor` scope, an empty client list, and an issuer that is not an absolute address |
| C6 | `44-1`: the issuer's keys cannot be fetched: `CONNECTOR_UNAVAILABLE`, retry `safe_same_key`, recorded with the cause. `44-1`: a token whose key the issuer does not publish is still a bad token, not an outage |

The real run: `pnpm serve` against the SSO's branch on `127.0.0.1:3011`, with the story's ids
seeded. cfo_100's token from DSoR's listed client counts; another client's token for DSoR's
audience is refused; `tok_d4e8` is refused.

### The breaks, with the learner's predictions

The predictions were made before any code, on 2026-10-27. Then each break was made for real in a
copy, and "Break it" shows how each prediction came out.

| Break | The story | The learner's prediction |
|---|---|---|
| B1 · the audience check is deleted | DSoR's test copy at `http://127.0.0.1:8043` trusts the same SSO, client, and scope. cfo_100's token for the test copy reaches the real DSoR at `8042` | Accepted as cfo_100, with an ALLOW recorded |
| B2 · the `dsor` scope check is deleted | DSoR's own sign-in app forgets to ask for `dsor`, so cfo_100's token lives 14 days. It arrives 90 minutes after its `iat` | Accepted |
| B3 · the client-list check is deleted | An SSO administrator registers a "reports" client with `dsor`, without DSoR's say. cfo_100's token from it approves PAY-901 | The approval counts, and names cfo_100 |
| B4 · roles are read from the token | user_700, ap_supervisor in org_789, holds a token whose claims say `tenant_id` org_456 and `org_role` CFO, and approves PAY-901 | The approval counts, as a CFO's |
| B5 · people's keys work again in `pnpm serve` | `tok_d4e8` is found in a log file and sent to `pnpm serve` to approve PAY-901 | The approval counts as cfo_100's |
| B6 · the one-hour age check is deleted | The SSO's setting has changed so `dsor` tokens live 14 days. A token stolen three hours ago arrives | Accepted as its owner |
| B7 · an outage of the keys is reported as a bad token | DSoR restarts at 09:00 while the SSO is down, so no keys are cached. cfo_100's good token arrives | cfo_100 hears "log in first" |
| B8 · the client is read only from `client_id` | The Panaversity SSO writes only `azp`. cfo_100's good token arrives on Monday morning | Refused for everyone |

## What changed since step 42

| File | What changed |
| --- | --- |
| `sign-in.json` | **New.** The one sign-in server DSoR trusts: its issuer, the address of its keys, the allowed algorithm, the one-hour age, DSoR's audience, the one other audience allowed, the `dsor` scope, and the clients on DSoR's list (44-2) |
| `src/sign-in.ts` | **New.** Reads `sign-in.json` and refuses settings that trust too much (C5) |
| `src/tokens.ts` | **New.** The token check, with `jose` 6.2.12: the signature with a key the issuer publishes, then the algorithm, the issuer, the audience, the time, the scope, the client, and the subject. Keys that cannot be fetched are an outage, not a bad token (C1, C6) |
| `src/logins.ts` | **New.** Where a call's login comes from. `FAKE_LOGINS` keeps step 42's table for `pnpm start` and the earlier tests. `realLogins`, for `pnpm serve`, takes a person's token and an agent's key (C3, C4) |
| `src/principals.ts` | `callerOf`, the one refusal of line ①, with new words: "log in first: the call has no login that DSoR accepts". An outage of the keys is `CONNECTOR_UNAVAILABLE` |
| `src/pipeline.ts` | Line ① asks the world's logins. A good token for nobody in the table is named in the record (44-10) |
| `src/log.ts` | The record's `unlisted_login`: the issuer, the person's id there, and the client, never the token (44-10) |
| `src/registry.ts` | A registry names its logins, `FAKE_LOGINS` unless a world chooses others |
| `src/serve.ts` | `pnpm serve` checks `sign-in.json` at start-up and uses `realLogins` (C4, C5) |
| `package.json`, `pnpm-lock.yaml` | `jose` 6.2.12, which checks signed tokens and fetches the issuer's keys |
| `test/issuer.ts` | **New.** A test sign-in server in the Panaversity SSO's shape. Its key exists only inside the tests (44-8) |
| `test/sign-in.test.ts`, `test/tokens.test.ts`, `test/logins.test.ts` | **New.** The claims C1 to C6 |
| `test/helpers.ts`, `test/permissions.test.ts`, `test/registry.test.ts` | The refusal's new words, and two registries built by hand that now name their logins |
| `src/door.ts`, `src/routes.ts`, `src/server.ts`, `src/statuses.ts` | Comments only: step 42's `NEW IN STEP` markers removed |

The checklist's lines ② to ⑪, the stores, and the migrations are step 42's.

```bash
git diff --no-index ../mj_42_a_rest_api/src src
git diff --no-index ../mj_42_a_rest_api/test test
```

## Run it

As in step 42: a local PostgreSQL 17 and a new database of its own. No migration is new. The tests
sign their tokens with a test-only key, so they need no sign-in server.

```bash
pnpm install
pnpm check
pnpm migrate
pnpm serve          # DSoR's door listens on http://127.0.0.1:8042
```

`pnpm serve` starts without a sign-in server too: the settings are checked at start-up, and the keys
are fetched at the first token. Until the server answers, a person's call hears
`CONNECTOR_UNAVAILABLE` (break B7 shows it).

**The sign-in server.** The real run used the Panaversity SSO's branch `feat/sso-dsor-fix-list`
(draft pull request [panaversity/agentfactory#1331](https://github.com/panaversity/agentfactory/pull/1331)),
on this computer at `127.0.0.1:3011`, over its own local database. Nothing in production was
touched. Three things were set up there first:

- two clients that may ask for `openid dsor`: `dsor-people`, DSoR's own app for people, and
  `reports`, a second app that DSoR's list does not name;
- a test password for cfo_100, set through the SSO's own password-reset flow;
- DSoR's address, `http://127.0.0.1:8042`, among the audiences the SSO accepts
  (`OAUTH_MCP_AUDIENCES`). The SSO's own DSoR tests need it there too.

Then cfo_100 signed in, and each app got a token through the *authorization-code flow with PKCE*.
In that flow, the app sends the person to the SSO, the SSO sends back a one-time code, and the app
trades the code for the token. *PKCE* is a secret the app makes for each sign-in, so a stolen code
is useless to anyone else. It is the flow of the SSO's own `apps/sso/tests/test-dsor-tokens.ts`.
The app's request names DSoR's address in its `resource` field (RFC 8707), so the SSO makes the
token for DSoR. A real run on 2026-10-27. The tokens' claims, never the tokens:

```text
cfo_100 signs in at the SSO: 200

dsor-people: a token kept in token-people, never printed
  form    3 parts, alg RS256
  iss     http://localhost:3011
  aud     ["http://127.0.0.1:8042","http://localhost:3011/api/auth/oauth2/userinfo"]
  azp     dsor-people
  scope   openid dsor
  sub     cfo_100
  age     0 s; lives 3600 s

reports: a token kept in token-reports, never printed
  form    3 parts, alg RS256
  iss     http://localhost:3011
  aud     ["http://127.0.0.1:8042","http://localhost:3011/api/auth/oauth2/userinfo"]
  azp     reports
  scope   openid dsor
  sub     cfo_100
  age     0 s; lives 3600 s
```

The two tokens differ in one claim only, `azp`. Each call puts its token in the `Authorization`
header:

```bash
curl -H "Authorization: Bearer $TOKEN" -H 'DSoR-Tenant: org_456' http://127.0.0.1:8042/invoices/INV-1008
```

The story, on a new database, in a copy of this folder with the same code and settings:

```text
1. cfo_100's token from dsor-people reads INV-1008
   HTTP 200 to cfo_100 {"id":"INV-1008","amount":{"value":"31400.00","currency":"USD"}}
2. the agent pays INV-1008, 31,400.00 USD
   HTTP 202 PENDING_APPROVAL, waits for CFO (1)
3. cfo_100's token from reports approves it
   HTTP 401 AUTHENTICATION_REQUIRED: log in first: the call has no login that DSoR accepts (retry never)
4. tok_d4e8 approves it
   HTTP 401 AUTHENTICATION_REQUIRED: log in first: the call has no login that DSoR accepts (retry never)
5. cfo_100's token from dsor-people approves it
   HTTP 200 COMMITTED to cfo_100 {"id":"apr_6a6c8dc6-ebbd-4aa3-9b6e-b2def648e295","state":"APPROVED","waits_for":[]}
```

The agent keeps its key. Earlier the same day, `pnpm serve` in this folder answered the agent's
`tok_7f3a` with INV-1008 masked:

```text
4. tok_7f3a, the agent's key
  → 200, answered to agent accounts-payable-fte
    {"tenant_id":"org_456","id":"INV-1008","vendor_id":"VENDOR-44","status":"issued","version":1}
```

DSoR's log for the story, `dsor.audit`, read as the owner (sequence, operation, decision, result,
reason, caller). Records 5 and 6 name nobody: a refused token is no login, so DSoR takes no name
from it, not even its `sub`.

```text
1 | invoice.get@1 | ALLOW | ok | - | cfo_100
2 | payment.create@1 |  | PROPOSED | payment.create called | accounts-payable-fte
3 | payment.create@1 |  | PENDING_APPROVAL | the control high-value-payment asks for an approval | accounts-payable-fte
4 | payment.create@1 | ALLOW | PENDING_APPROVAL | - | accounts-payable-fte
5 | proposal.approve@1 | DENY | AUTHENTICATION_REQUIRED | log in first: the call has no login that DSoR accepts | -
6 | proposal.approve@1 | DENY | AUTHENTICATION_REQUIRED | log in first: the call has no login that DSoR accepts | -
7 | proposal.approve@1 |  | PROPOSED | proposal.approve called | cfo_100
8 | proposal.approve@1 |  | READY | no control asks for an approval | cfo_100
9 | proposal.approve@1 |  | EXECUTING | execute mode: the work starts | cfo_100
10 | payment.create@1 |  | APPROVED | approved by cfo_100 | cfo_100
11 | proposal.approve@1 |  | COMMITTED | the work ended | cfo_100
12 | proposal.approve@1 | ALLOW | ok | - | cfo_100
approval by | cfo_100 | [{"authn": {"at": "2026-10-27T09:07:22.451Z"}, "basis": "role:CFO", "principal": "cfo_100"}]
```

## Break it

Each break was made on 2026-10-27 in its own copy of this folder, outside the repository, against
the final code. Each copy got a new database and its own `pnpm serve` on `8042`, and the break's
story went through the door.

- B3, B5, B7, and B8 used real tokens from the local SSO. For B7, the copy fetched its keys from a
  port where nothing listens. That is what DSoR sees while the SSO is down.
- B1, B2, B4, and B6 used this step's test sign-in server, `test/issuer.ts`. The SSO makes no
  token 90 minutes or three hours old, and none with role claims. It also makes none for an
  address it does not list: asked for `8043`, it answered `invalid_request`, "requested resource
  invalid".

Then `test/tokens.test.ts` and `test/logins.test.ts`, 56 tests, ran in each copy. The column "As
built" is the same story against the step as built.

| Break | What it changes | Broken, DSoR answers | As built | Tests that fail | The learner's prediction |
|---|---|---|---|---|---|
| B1a | Deletes the audience given to `jose`: "DSoR's address is one of the audiences" | The token for the test copy at `8043`: 401, still refused | 401 | 1 | Accepted as cfo_100: **not here** |
| B1b | Deletes 44-9's check too: "every audience is DSoR's or the SSO's userinfo address" | 200, the whole invoice, ALLOW by cfo_100 | 401 | 5 | Accepted as cfo_100, with an ALLOW recorded: **as predicted** |
| B2 | Deletes the `dsor` scope check | The token without `dsor`, 90 minutes after its `iat`: 401. The same kind of token in its first minute: 200, ALLOW by cfo_100 | 401 | 3 | Accepted: **not for the story's token** |
| B3 | Keeps only "a client is named", not "a client on DSoR's list" | The `reports` token approves: 200, APPROVED by cfo_100, `basis` `role:CFO` | 401 | 2 | The approval counts, and names cfo_100: **as predicted** |
| B4 | Takes the company and the role from the token's `tenant_id` and `org_role` | user_700 approves: 200, APPROVED by user_700, `basis` `role:CFO` | 403, "the caller may not work in the tenant it named" | 7 | The approval counts, as a CFO's: **as predicted** |
| B5 | A key counts for anyone in the table, people too | `tok_d4e8` approves: 200, APPROVED by cfo_100 | 401 | 6 | The approval counts as cfo_100's: **as predicted** |
| B6 | Deletes the one-hour age, `maxTokenAge` | The token stolen three hours ago: 200, the whole invoice, ALLOW by cfo_100 | 401 | 3 | Accepted as its owner: **as predicted** |
| B7 | Keys that cannot be fetched count as a bad token | 401, "log in first", retry `never` | 503, `CONNECTOR_UNAVAILABLE`, "try again", retry `safe_same_key` | 2 | cfo_100 hears "log in first": **as predicted** |
| B8 | Reads the client only from `client_id` | cfo_100's good token: 401. The agent's key: 200 | 200 | 13 | Refused for everyone: **as predicted**, for every person |

What the runs add:

- **B1: the audience is checked twice.** `jose` checks that DSoR's address is among the audiences.
  44-9's check refuses any audience that is neither DSoR's nor the SSO's userinfo address. With only
  the first deleted, the `8043` token fails the second. One test noticed B1a: a token with no `aud`
  at all, which passes 44-9's check, because an empty list holds no stranger.
- **B2: the age check still runs.** 90 minutes after `iat` is more than DSoR's one hour (Q2), so the
  token is refused without any scope check. In its first hour, it counts. The scope check is the
  only guard in a token's first hour, and the age check is the guard after it.
- **B3 and B5: the record cannot tell.** An approval through `reports`, or with `tok_d4e8` from a
  public file, is recorded as `{"authn": {"at": …}, "basis": "role:CFO", "principal": "cfo_100"}`,
  exactly like cfo_100's own approval through `dsor-people`.
- **B4: the log looks right.** It shows a CFO's approval by user_700, whom DSoR's table lists in
  org_789 only.
- **B6: the SSO's settings do not matter here.** As built, a token works for at most one hour after
  it was made, however long the SSO lets it live.
- **B7: "retry never" sends the caller the wrong way.** Signing in again cannot help while the SSO
  is down, and the log blames a login, not an outage.
- **B8: "everyone" is every person.** Agents and system logins use keys, which never reach the client
  check.

The two misses, B1a and B2, came from one idea: "one check gone, the token gets in". A token must
pass every check, and the others still run. The new clerk who stops checking which building a badge
was printed for still turns away a badge printed last year.

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | Step 43d's understanding session, from two stories, the finance story and Panaversity ops. It questioned steps 43 to 43c, and they were set aside |
| 2 | Decide | Q1 to Q10 for the chain, then this step's 44-1 to 44-10, R1, and R2, put to the learner one at a time. Then the claims, the tests, and a prediction for each break, before any code |
| 3 | The copy | Step 42 copied, its markers removed |
| 4 | Build, piece by piece | Four pieces, each with its tests written first and seen red: the settings (`sign-in.json`, `src/sign-in.ts`); the token check (`src/tokens.ts`, `jose`); line ① (`src/logins.ts`, `callerOf`); the refusal's new words |
| 5 | The real run | `pnpm serve` against the Panaversity SSO on this computer, with one prediction first |
| 6 | Break it | Eight breaks, each made for real in a copy and set beside its prediction |

To start it in a new session:

```text
Build step 44 in learner mode from the design in
docs/baby_steps_tutorials/mj_44_tokens_made_for_dsor/README.md and the decisions in
docs/baby_steps_tutorials/mj_notes.md, from "Step 43d, paused" on.
```

## Check yourself

1. cfo_100 opens the "reports" app. The SSO gives it a token made for DSoR, with the `dsor` scope,
   signed with the SSO's own key. The app sends cfo_100's approval of PAY-901 to DSoR. What does it
   get, and whom does the log name?
   <details><summary>Answer</summary>401, <code>AUTHENTICATION_REQUIRED</code>, "log in first". The token is real, but <code>reports</code> is not on DSoR's list of clients (R2), so it is no login. The record is a DENY that names nobody: DSoR takes no name from a token it refused. Run it, call 3 and record 5.</details>
2. DSoR starts at 09:00 while the SSO is down. cfo_100's good token arrives. What does she hear,
   and why not "log in first"?
   <details><summary>Answer</summary>503, <code>CONNECTOR_UNAVAILABLE</code>, "try again", retry <code>safe_same_key</code>. DSoR could not check the token, so it cannot call the token bad. "Log in first" with retry <code>never</code> would send her to sign in again, which cannot help, and the log would blame a login instead of an outage. Break B7.</details>
3. user_700's token says `tenant_id` org_456 and `org_role` CFO. Why can't user_700 approve
   PAY-901?
   <details><summary>Answer</summary>DSoR reads a person's companies and roles from its own table, by the token's <code>sub</code>, never from the token's claims (C3, DSOR-IDN-04b). The table lists user_700 in org_789 only, so line ② refuses: "the caller may not work in the tenant it named". Break B4 shows the other way: the approval counts as a CFO's.</details>
4. Someone deletes the `dsor` scope check. cfo_100's token without `dsor` arrives 90 minutes after
   it was made. What happens? And to the same kind of token, a minute after it was made?
   <details><summary>Answer</summary>The first is refused: 90 minutes is more than DSoR's one hour after <code>iat</code> (Q2), and that check still runs. The second counts as cfo_100. So the scope check is the only guard in a token's first hour. Break B2.</details>
5. The SSO decides a token's `exp`. Why does DSoR also count one hour from `iat` itself?
   <details><summary>Answer</summary>The SSO's setting can change, and a token without <code>dsor</code> already lives 14 days. DSoR's own hour bounds a stolen token whatever the SSO says. In break B6, without that hour, a token stolen three hours earlier, valid for 14 days, read INV-1008 whole.</details>

## Think it through

### Found while building

- **17 of line ①'s 28 new tests passed before its code existed.** All 17 expect a refusal, and step
  42 refuses every token, so they were green from the start. Each proved something only once a test
  that expects "yes" stood beside it.
- **The token is read before line ① starts,** because finding the login may wait for the sign-in
  server's keys. An envelope whose `token` field throws when it is read gets `INTERNAL_ERROR` with
  DSoR's own request id, as in step 43.
- **The refusal's words changed.** Step 05 said "the call has no login token that DSoR gave". A
  person's token comes from the SSO now, so it says "the call has no login that DSoR accepts". "Why
  it matters" keeps the old words, because it quotes step 42's run.
- **The audience is checked twice** (break B1a). Only one test, a token with no `aud`, notices the
  loss of `jose`'s check.
- **The SSO makes tokens only for audiences it lists.** Asked for `8043`, it answered "requested
  resource invalid". A test copy of DSoR needs its own address registered at the SSO.
- **The SSO's test email capture stayed empty in dev mode,** though the SSO's log shows that the
  reset email was made. The likely cause: in dev mode, Next.js gives the reset route and
  `/api/test/emails` separate copies of the list. The run read the reset token from the SSO's
  `verification` table instead.

### Left open on purpose

- **Agents keep their keys,** in a public file. Steps 48 and 49 will replace them.
- **Companies and roles still come from step 42's table** (44-5). Step 45 will ask the SSO.
- **No record names the client a person used.** B3's approval through `reports` looks like one
  through `dsor-people`. This matters in step 47, where approvals will count only from DSoR's own
  approval app.
- **A refused token names nobody, even when its signature checked.** The record of the reports call
  cannot say that another app used cfo_100's token. 44-10 names a good token only when its person is
  missing from the table.
- **An app may keep getting new tokens for 30 days.** An app that asks the SSO for `offline_access`
  gets a *refresh token*, which it trades for new tokens, and that lives 30 days. DSoR's hour
  bounds each token, not how long an app may keep getting new ones.
- **One issuer for every company** (44-2).

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-RP-02b | A token whose audience is not this DSoR is rejected | [§37](../../../specs/dsor/05-bindings.md#37-identity-binding) | `test/tokens.test.ts`, `test/sign-in.test.ts` (C1, C5) |
| DSOR-IDN-01 | Every caller becomes a principal before anything else | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/tokens.test.ts`, `test/logins.test.ts` (C1, C2) |
| DSOR-IDN-04a | Roles and scopes only from the issuer or role source the tenant trusts | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `test/tokens.test.ts`, `test/logins.test.ts` (C3) |
| DSOR-IDN-04b | A claim from any other origin decides nothing | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `test/logins.test.ts` (C3) |
| DSOR-EXE-02 | A refusal is recorded, with its reason, before the answer | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | `test/logins.test.ts` (C2) |

The settings, the one-hour age, the list of clients, keys versus tokens, and the outage answer are
this tutorial's decisions: those tests are titled by 44-1, 44-2, 44-6, 44-7, 44-9, 44-10, Q2, R1,
and R2.

**Next:** step 45, ask the sign-in server. At every call, DSoR will ask the SSO who this person is
in this company now. A leaver's next call will be refused, and the leaver's slips suspended.
