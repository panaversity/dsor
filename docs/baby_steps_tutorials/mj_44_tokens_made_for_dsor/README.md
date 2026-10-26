# Step 44 · Tokens made for DSoR

**New in this step:** a person will be who a token *made for DSoR* says. The token must come from
the one sign-in server DSoR trusts, name DSoR as its audience, carry the `dsor` scope, come from a
client on DSoR's own list, and be at most one hour old (DSOR-RP-02b, DSOR-IDN-01, DSOR-IDN-04a,
DSOR-IDN-04b).

> **Status, 2026-10-27: designed, not built.** This README holds the design, agreed with the
> learner before any code. The sections after the design arrive with the code, each with real
> output. Nothing below claims that the code exists yet.

## In plain words

Since step 05, a caller proves who they are with a fixed key from a table in the code:
`tok_d4e8` is cfo_100. The table is `src/principals.ts`, a public file, and a key never expires.
This step will replace those keys, for people, with real sign-in. Agents keep their keys until
steps 48 and 49.

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

Each break will be made for real in a copy, and its output will go under "Break it". The
predictions were made before any code, on 2026-10-27, and none is judged until its run.

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
