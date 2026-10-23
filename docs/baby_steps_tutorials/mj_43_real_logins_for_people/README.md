# Step 43 · Real logins for people

**New in this step:** people sign in for real. DSoR checks a signed token against the keys its
issuer publishes, accepts only an issuer the company configured, and finds the principal in a table
of its own. A login proves who you are; DSoR decides which principal that is (DSOR-IDN-01,
DSOR-IDN-04a, DSOR-IDN-04b, DSOR-APR-05a).

## In plain words

Since step 05, a login token is a key in a fake table: `tok_d4e8` is cfo_100. The table is in
`src/principals.ts`, a public file. This step replaces those fake tokens, for people, with real
sign-in.

A person signs in at a *sign-in service*, here Managed Better Auth, which Neon runs. The service
gives them a *signed token*: a short text that says "this is user 8c1f…", who *issued* it, for whom
it is meant (its *audience*), and until when it is valid. The issuer signs it with a private key
that only it holds, and *publishes* the matching public keys at a fixed address, as a *JWKS* (a JSON
list of keys). Anyone can check a signature with the public key. Nobody can make one without the
private key.

DSoR takes nothing in the token on trust. It checks the signature against the published keys,
checks the issuer and the audience against its own list for each company, and checks the time. Then
it looks the login up in a small table of its own: which principal is user 8c1f… of this issuer?
The principal's companies and roles stay DSoR's own. A `role` claim in the token is never read.

**Words this step uses.**

- A *JWT* (JSON Web Token) is a signed token in three parts, separated by dots: a header (which key
  and which algorithm), the claims, and the signature.
- A *claim* is one field of the token: `iss` the issuer, `aud` the audience, `sub` the subject (the
  user's id at the issuer), `exp` when it expires.
- *EdDSA* with *Ed25519* is the signing method Managed Better Auth uses. A key's *kid* is its name.
- An *issuer* is a sign-in service DSoR trusts for a company. `issuers.json` lists them.
- A *link* is one row of DSoR's table `dsor.logins`: an issuer, a subject, and the principal they
  belong to.

## Why it matters

A real run on 2026-10-23, on step 42's finished code (`cd999bac`), in memory, in a scratch copy,
through the real HTTP door. Token 3 was signed with a new Ed25519 key, in the shape Managed Better
Auth gives.

```text
1. The agent drafts INV-1008, 31,400.00 USD, through the door
  HTTP 202: {"outcome":"PENDING_APPROVAL","agent":"accounts-payable-fte"}
2. A stranger who read src/principals.ts on GitHub sends cfo_100's token, tok_d4e8, and approves
  HTTP 200: {"outcome":"COMMITTED","state":"APPROVED","principal":"cfo_100"}
  DSoR's log: proposal.approve@1, ALLOW, by {"request_id":"req_6cfa158b-…","principal_id":"cfo_100"}
3. cfo_100 herself signs in and sends her signed token
  HTTP 401: AUTHENTICATION_REQUIRED: log in first: the call has no login token that DSoR gave
```

1. **The CFO's approval is anyone's.** "Only the CFO approves above 25,000 USD" (step 29) rests on
   knowing who the CFO is. A token from a public file approved 31,400.00 USD, and the log blames
   cfo_100.
2. **The real person cannot get in.** A correctly signed token from a real sign-in service is
   refused: DSoR knows only its own table.

**Common mistake:** reading the token without checking it. The claims are only base64, so anyone can
write `{"sub": "cfo_100", "role": "CFO"}` and sign it with their own key. A server that decodes the
claims, or checks the signature with whatever key the token itself names, believes it. DSoR checks
the signature with the keys of an issuer it already trusts, and reads no role from the token at all.

## The design, before any code

### How this step was made

On 2026-10-23 Claude Code showed the run above on step 42's code. The learner said "make all
assumptions and complete 42 and 43", so every decision below is Claude Code's, marked so, for the
learner to review. Step 42 was copied into this folder, its markers removed. The note is
[`../mj_43_why_this_step.md`](../mj_43_why_this_step.md).

### What the rules say

From [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) and
[§12.1](../../../specs/dsor/02-security.md#121-role-source):

- **DSOR-IDN-01:** "DSoR MUST normalize every caller into a principal with a type and tenant
  memberships before any other processing." §12: "Authentication is delegated to an external
  identity provider."
- **DSOR-IDN-04a:** "Role and scope assertions MUST be accepted only from a token issuer or role
  source configured as authoritative for the active tenant."
- **DSOR-IDN-04b:** "A claim from any other origin MUST NOT be used in an authorization decision."

From [§26.5](../../../specs/dsor/03-execution.md#265-the-approval-channel):

- **DSOR-APR-05a:** "`proposal.approve` MUST be accepted only in `direct` identity mode, from an
  approver authenticated to DSoR under their own credentials."

What Managed Better Auth gives, from Neon's documentation on 2026-10-23
([JWT plugin](https://neon.com/docs/auth/guides/plugins/jwt)): EdDSA (Ed25519) tokens with a `kid`;
keys at `<Neon Auth URL>/.well-known/jwks.json`; `iss` and `aud` the origin of the Neon Auth URL;
`sub` the user's id; 15 minutes; claims such as `email` and `role`.

### The claims

| Claim | What it says |
|---|---|
| C1 | Each company names its issuers in `issuers.json`: issuer, audience, and the address of its keys. Start-up refuses a company where people log in with no issuer, an issuer that is not `https` (except `http://127.0.0.1`), a field it does not know, and an issuer named twice for one company |
| C2 | A token is accepted only when its header names EdDSA, its `iss` is a configured issuer exactly, its signature checks against a key that issuer publishes, its `aud` is that issuer's audience, it has a `sub` and an `iat`, it has not expired, and it is at most 15 minutes old (5 seconds of tolerance). Anything else is refused at line ①, with the one answer `AUTHENTICATION_REQUIRED` |
| C3 | DSoR's own table links `(issuer, subject)` to a principal. A login with no link is refused at line ①. A link may name only a person. Nothing else in the token decides anything: a `role` claim is never read |
| C4 | A token counts only in a company that configured its issuer: the principal's companies are cut to those, so in any other company line ② refuses it |
| C5 | Where logins are real, the fake tokens of people are refused; agents and DSoR's own system logins keep theirs until step 44 |
| C6 | cfo_100 approves INV-1008 with her own signed token; the fake `tok_d4e8` cannot (DSOR-APR-05a) |
| C7 | Fail closed: keys that cannot be fetched refuse every token, once the keys DSoR kept are older than ten minutes; a key the issuer stops publishing counts for those ten minutes, and not after |
| C8 | On PostgreSQL, `dsor.logins` holds the links; the program may only read it, and `pnpm link-login`, as the owner, adds one. `pnpm serve` uses real logins for people |

### Decisions

Claude Code's, 2026-10-23, for the learner to review.

- **D1. People only (Claude Code).** Real logins replace the fake tokens of people: cfo_100, user_123,
  admin_100, user_700, admin_700. Agents and DSoR's own system logins keep theirs until step 44.
  *Downside:* an agent's token is still public, so the door stays on 127.0.0.1 (step 42's D7).
- **D2. `jose` 6.2.12 (Claude Code)**, the library Neon's own examples use, published 2026-09-05, past
  the 48-hour quarantine. It checks signatures, fetches and caches the keys, and fetches again for a
  `kid` it has not seen. *Downside:* a new dependency, and the first that touches security.
- **D3. `issuers.json` (Claude Code)**, one list for each company: `issuer`, `audience`, `jwks`.
  *Downside:* one more file to keep in step with the Neon project.
- **D4. What a token must be (Claude Code):** EdDSA only; `iss` exactly a configured issuer; signed
  by a key from that issuer's `jwks`; `aud` that issuer's `audience`; a `sub` and an `iat`; not
  expired, and at most 15 minutes old, as Managed Better Auth's tokens live, with 5 seconds of
  tolerance. *Downside:* a token from a provider with another algorithm, or a longer life, is refused
  until the list grows.
- **D5. A link table of DSoR's own (Claude Code):** `dsor.logins`, `(issuer, subject) → principal`,
  one principal for each login, across companies. The principal's type, companies, and roles stay
  DSoR's. *Downside:* each person's row is added by hand, after they first sign in.
- **D6. A token counts only where its issuer is configured (Claude Code).** *Downside:* a person in two
  companies with two sign-in services needs a link for each login.
- **D7. One answer for every bad token (Claude Code)**, `AUTHENTICATION_REQUIRED`, "log in first".
  *Downside:* an expired token is told no more than a forged one.
- **D8. Each world chooses its logins (Claude Code)**, as each world chose its rules in step 27. The
  stories of `pnpm start` and the earlier tests keep the fake table; `pnpm serve` uses real logins for
  people. *Downside:* the old tests still prove things with fake people.
- **D9. A stand-in for Managed Better Auth (Claude Code)**, `pnpm dev-issuer`, on 127.0.0.1:8043. It
  publishes its keys and signs 15-minute tokens for the story's people, in Neon's shape, so the step
  runs without a Neon account. Each person signs in with a code it prints in its own terminal, new at
  each start, so another program on this computer, the agent included, cannot ask for cfo_100's
  token. The shipped `issuers.json` names it, and `pnpm serve` trusts it only with `DSOR_STAND_IN=on`
  (both after the review's H1). *Downside:* while the stand-in is stopped, another program could take
  its port and publish keys of its own; only a real sign-in service closes that.
- **D10. Not in this step (Claude Code):** an agent's real token (step 44), acting for a person (step
  45), a step-up login, the time of sign-in on an approval, which stays the time of the call, and an
  audience of DSoR's own: a token's `aud` is the sign-in service, so another app of the same Neon
  project could hand a person's token on to DSoR (DSOR-RP-02b, the review's M2).

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | The shipped file passes; each kind of bad file is refused, with its company and field named |
| C2 | A token from the stand-in passes; one signed with another key, one with `alg` HS256 or `none`, one signed ES256 by the issuer's own key, another `iss`, another `aud`, no `sub`, an expired one, one older than 15 minutes, one issued tomorrow, and one that is not a JWT are each refused |
| C3 | cfo_100's login reads INV-1008 whole; a login with no link is refused; a token whose `role` claim says CFO, for user_123, is still user_123, an AP supervisor |
| C4 | user_700's token of org_789's issuer works in org_789; a token of org_789's issuer linked to cfo_100, whose companies are org_456 only, is refused in org_456 at line ② |
| C5 | Under real logins, `tok_d4e8` is refused; `tok_7f3a`, the agent, still works |
| C6 | cfo_100's real token approves the agent's INV-1008; `tok_d4e8` is refused |
| C7 | Keys that cannot be fetched refuse every token; with the shipped cache, a key rotated away still counts for ten minutes and not after |
| C8 | On PostgreSQL: a link added by `pnpm link-login` is read; `dsor_runtime` cannot add or change one; the door over real logins answers cfo_100 |

### The breaks

| Break | What it changes |
|---|---|
| B1 | The signature is not checked: the claims are only decoded |
| B2 | Any algorithm the token names is accepted |
| B3 | The issuer is not checked against the company's list |
| B4 | The audience is not checked |
| B5 | An expired token is accepted |
| B6 | The `role` claim is read as the principal's role |
| B7 | The principal's companies are not cut to the issuer's |
| B8 | The fake tokens of people still work under real logins |

## What changed since step 42

| File | What changed |
| --- | --- |
| `issuers.json`, `src/issuers.ts` | **New.** Each company's issuers, checked at start-up (C1) |
| `src/tokens.ts` | **New.** A signed token, checked with `jose` against its issuer's published keys (C2, C7) |
| `src/logins.ts` | **New.** Where a call's login comes from: step 05's table, or real logins for people, with DSoR's own links and the cut to the issuer's companies (C3 to C5) |
| `src/pipeline.ts`, `src/registry.ts`, `src/principals.ts` | Line ① asks the world's login source first; the registry holds it, step 05's table unless the world gives real logins (D8) |
| `migrations/047_logins.sql`, `store.json`, `src/store.ts`, `src/postgres.ts` | **New migration.** `dsor.logins`, which `dsor_runtime` may only read, and a new kind of table for it, `shared-read` (C8) |
| `src/link-login.ts` | **New program**, `pnpm link-login`: the owner links a login to a person |
| `src/dev-issuer.ts` | **New program**, `pnpm dev-issuer`: the stand-in for Managed Better Auth (D9) |
| `src/serve.ts` | `pnpm serve` takes real logins for people, checking `issuers.json` at start-up |
| `package.json` | `jose` 6.2.12, the one new dependency: it checks signatures and fetches the issuer's keys (D2) |
| `test/issuers.test.ts`, `test/tokens.test.ts`, `test/logins.test.ts`, `test/issuer.ts`, `test/logins.db.test.ts`, `test/serve.db.test.ts` | **New.** The claims, with a real issuer on 127.0.0.1 |
| `test/catalogs.ts`, `test/store-map.test.ts`, `test/audit.db.test.ts`, `test/permissions.test.ts`, `test/registry.test.ts` | The earlier lists of tables, kinds, privileges, and a registry's fields name `dsor.logins`, `shared-read`, and `logins`. Each says "Changed in step 43" |

```bash
git diff --no-index ../mj_42_a_rest_api/src src
git diff --no-index ../mj_42_a_rest_api/test test
```

## Run it

As in step 42: a local PostgreSQL 17 and a new database of its own. Migration 047 is new.

```bash
pnpm install
pnpm migrate
pnpm dev-issuer                    # terminal 1: the stand-in, on 127.0.0.1:8043; it prints each person's code
pnpm link-login http://127.0.0.1:8043 ba_8c1f cfo_100
DSOR_STAND_IN=on pnpm serve        # terminal 2: the door, on 127.0.0.1:8042
```

Without `DSOR_STAND_IN=on`, `pnpm serve` refuses to start:

```text
issuers.json names http://127.0.0.1:8043, which is plain http on this computer: a stand-in, through which anyone here could sign in. Set DSOR_STAND_IN=on to learn with it
```

Then sign in and call the door. cfo_100's token comes from the stand-in, with the code it printed
for her:

```bash
curl 'http://127.0.0.1:8043/token?email=cfo@org456.example&code=<her code>'
```

A real run on 2026-10-23, on a new database. Run 5 is a token the script signed with a key of its
own: the same issuer, the same `kid`, cfo_100's user id, and `role: CFO`. Run 6 names an issuer on
port 8044 that `issuers.json` does not list.

```text
0. the agent asks the stand-in for cfo_100's token, without her code
  the stand-in: the stand-in signs in only the story's people, each with the code it printed
1. cfo_100 signs in at the stand-in with her code
  token: eyJhbGciOiJFZERTQSIsImtpZCI6ImRldi0xNzky… (three parts, EdDSA, kid dev-1792769854045)
2. she reads INV-1008 with it
  {"principal": "cfo_100", "amount": {"value": "31400.00", "currency": "USD"}}
3. the agent drafts INV-1008, 31,400.00 USD (its fake token stays until step 44)
  {"outcome": "PENDING_APPROVAL", "agent": "accounts-payable-fte"}
4. a stranger approves with tok_d4e8, from the public file
  AUTHENTICATION_REQUIRED: log in first: the call has no login token that DSoR gave
5. the stranger forges a perfect-looking token: same issuer, same kid, cfo_100's user id, role CFO, signed with their own key
  AUTHENTICATION_REQUIRED: log in first: the call has no login token that DSoR gave
6. a token from an issuer org_456 never configured, on port 8044
  AUTHENTICATION_REQUIRED: log in first: the call has no login token that DSoR gave
7. user_123 signs in with his code, but DSoR has no link for that login yet
  AUTHENTICATION_REQUIRED: log in first: the call has no login token that DSoR gave
8. cfo_100 approves with her own token
  {"outcome": "COMMITTED", "state": "APPROVED", "principal": "cfo_100"}
```

The decisions in `dsor.audit`, read as the owner (operation, decision, result, who). Run 0 is the
stand-in's own refusal, before DSoR:

```text
invoice.get@1|ALLOW|ok|cfo_100
payment.create@1|ALLOW|PENDING_APPROVAL|accounts-payable-fte
proposal.approve@1|DENY|AUTHENTICATION_REQUIRED|(nobody)
proposal.approve@1|DENY|AUTHENTICATION_REQUIRED|(nobody)
invoice.get@1|DENY|AUTHENTICATION_REQUIRED|(nobody)
invoice.get@1|DENY|AUTHENTICATION_REQUIRED|(nobody)
proposal.approve@1|ALLOW|ok|cfo_100
```

Run 7 is refused because `pnpm link-login` linked only cfo_100. Link user_123's login (`ba_2c91`)
the same way, and his calls pass.

### Run it with Managed Better Auth

These steps need your Neon account, so they are yours to do. Claude Code did not do them.

1. In the Neon console, switch on **Neon Auth** for your project's branch, and copy its **Auth URL**,
   for example `https://ep-quiet-sun-123.neonauth.us-east-2.aws.neon.tech/neondb/auth`.
2. In `issuers.json`, for `org_456` (and `org_789`), set `issuer` and `audience` to the URL's
   **origin**, `https://ep-quiet-sun-123.neonauth.us-east-2.aws.neon.tech`, and `jwks` to
   `<Auth URL>/.well-known/jwks.json`. Start-up refuses an address that is not `https`.
3. Sign cfo_100 up in your app, get her token with `authClient.token()`, and read her user id: the
   token's `sub`, or `neon_auth.user.id` in the database.
4. `pnpm link-login https://ep-quiet-sun-123.neonauth.us-east-2.aws.neon.tech <her user id> cfo_100`.
5. `pnpm serve`, and call it with `Authorization: Bearer <her token>`.

Check a real token's `aud` first: Neon's documentation shows it as the origin, and its Node example
does not check it. If yours differs, the audience in `issuers.json` must match it.

## Break it

Each break was made on 2026-10-23 in a copy of this folder outside the repository, one at a time,
against the final code and `test/issuers.test.ts`, `test/tokens.test.ts`, and `test/logins.test.ts`,
44 tests. The learner chose to build first, so these were not predicted.

| Break | What it changes | What caught it |
|---|---|---|
| B1 | The signature is not checked: the claims are only decoded | 12 tests: the forged token, HS256, ES256, none, another audience, and more |
| B2 | Any algorithm the token names is accepted | 1 test. **At first nothing caught it:** jose refuses `none` by itself, and HS256 against an Ed25519 key. The test of an issuer that publishes an ES256 key and signs with it was added red against B2 |
| B3 | The issuer is not checked: the first configured one is used | 2 tests: user_700's token of org_789's issuer, and the cut in org_456 |
| B4 | The audience is not checked | 1 test: a token for another audience |
| B5 | An expired token is accepted (a tolerance of years) | 3 tests: expired, older than 15 minutes, issued tomorrow |
| B6 | The `role` claim is read as the principal's role | 3 tests: user_123's token that says CFO drafts a rule, and the shape of a login |
| B7 | The principal's companies are not cut to the issuer's | 1 test: a token of org_789's issuer, linked to cfo_100, in org_456 |
| B8 | The fake tokens of people still work under real logins | 2 tests: `tok_d4e8` reads, and approves |

## Think it through

### Found while building

- **A test's shortcut is not a design.** The first database test of `pnpm link-login` passed a flag
  that skipped the issuer check, because the test's issuer runs on a random port. A switch that turns
  a check off has no place in a real tool. The tool now reads the issuers file that
  `DSOR_ISSUERS_FILE` names, and the test writes one that names its own issuer.
- **Break B2 found a test that proved the library, not the rule.** The HS256 and `none` tests pass
  with or without "EdDSA only": jose refuses both by itself. Only an issuer that publishes another
  kind of key shows the list at work.
- **Two runs on one database spoil each other.** The README's run was first made while the full
  database suite ran on the same database, after it had been rebuilt under the suite. The suite's
  tear-ups cancelled the story's proposal. The run above is on a database of its own.

### What the review found

A reviewer who had not seen the conversation read the step against DSOR-IDN-01, DSOR-IDN-04a,
DSOR-IDN-04b, and DSOR-APR-05a, treated every caller as one who can sign tokens with keys of their own,
and broke the code in a copy.

| | Finding | What was done |
|---|---|---|
| H1 | The stand-in gave anyone on this computer cfo_100's real token, with no password: the agent, which runs here, could approve as her. And the shipped setup trusted it by default | Fixed red first: each person signs in with a code the stand-in prints in its own terminal, and `pnpm serve` refuses a stand-in unless `DSOR_STAND_IN=on` (D9) |
| M1 | C7 said a key the issuer stops publishing refuses its tokens; with the shipped cache it counts for ten more minutes, and the test used a cache of zero | C7 corrected; a test with the shipped cache and a clock moved 601 seconds shows both halves |
| M2 | A token's audience is the sign-in service, not DSoR, so another app of the same Neon project could hand a person's token on | Recorded in D10, beside DSOR-RP-02b; a DSoR audience needs the sign-in service's own setting |
| L1 | The README said user_700 is refused in org_456 because of the cut; he has no membership there at all | The C4 row and Check yourself 4 now use the case the cut decides |
| L2 | `docs/status.md` had no row for step 43 | Added in the hand-over |
| L3 | A token whose `exp` says the year 3000 was accepted | Fixed: an `iat`, and 15 minutes at most (D4) |
| L4 | No check of the header's `typ` | Recorded: Neon's documentation does not say its tokens carry one |
| L5 | `pnpm link-login` read the issuers file before `.env`, so it could check another file than `pnpm serve` | Fixed |
| L6 | A login source that threw gave `INTERNAL_ERROR` with DSoR's request id | Fixed red first: no caller, refused at line ①, with the caller's request id |
| L7 | A store or key outage answers `AUTHENTICATION_REQUIRED`, retry never, as a forgery does | Recorded, for the learner: D7 chose one answer; a retryable code would tell an outage apart |
| L8 | The log names the principal, never the issuer and subject that signed in; a link cannot be removed | Recorded |
| L9 | No test that, under real logins, a forged token never reaches the code | Added |

### Left open on purpose

- **The real Managed Better Auth is not connected.** It needs the learner's Neon account; "Run it
  with Managed Better Auth" lists the steps.
- **Agents still use the fake table**, so the door stays on 127.0.0.1 (step 44).
- **A stopped stand-in's port** can be taken by another program on this computer, which could then
  publish keys of its own. `DSOR_STAND_IN=on` makes trusting a stand-in a choice; Neon closes it.
- **A token's audience is the sign-in service** (M2), and **an outage looks like a forgery** (L7).
- **No way to unlink a login**; the log does not name the login, only the principal (L8).

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | The problem, shown with a real run of step 42's door: a public token approves as the CFO, and a real signed token is refused |
| 2 | Decide | D1 to D10, all Claude Code's: the learner said "make all assumptions" and will review them |
| 3 | The copy | Step 42 copied, its markers removed |
| 4 | Build, piece by piece | Five pieces, each with its tests written first and seen red: the issuers; the token check; the logins through the checklist; the links on PostgreSQL; `pnpm serve` and the stand-in |
| 5 | Break it | B1 to B8, for real, in a copy; B2 found a missing test |
| 6 | Review | A reviewer who had not seen the conversation; its findings fixed or recorded |

To start it in a new session:

```text
Build step 43 in learner mode from the design in
docs/baby_steps_tutorials/mj_43_real_logins_for_people/README.md and the decisions in
docs/baby_steps_tutorials/mj_43_why_this_step.md.
```

## Check yourself

1. A stranger copies `tok_d4e8` from `src/principals.ts` and calls `pnpm serve`. What happens?
   <details><summary>Answer</summary>401, <code>AUTHENTICATION_REQUIRED</code>, recorded. Under real logins a person's fake token finds no caller (D1); run 4 above.</details>
2. The stranger signs a token with their own Ed25519 key: the right issuer, the right `kid`,
   cfo_100's user id, `role: CFO`. Why is it refused?
   <details><summary>Answer</summary>DSoR checks the signature with the keys the issuer publishes, not with any key the token names. The stranger's key is not among them (C2); run 5 above.</details>
3. user_123's real token says `role: CFO`. Can he draft a rule?
   <details><summary>Answer</summary>No. A token proves only who signed in. His roles are DSoR's own: an AP supervisor, with no <code>rule:draft</code> (DSOR-IDN-04b, C3).</details>
4. cfo_100 also has a login at org_789's sign-in service, and DSoR links it to her. She sends that
   token with `DSoR-Tenant: org_456`. Who refuses it, and why?
   <details><summary>Answer</summary>Line ②. Her principal keeps only the companies whose issuers include the token's, and org_456 does not trust org_789's service, so through that token she has no company at all (DSOR-IDN-04a, C4). With her org_456 login she is in.</details>
5. Neon's sign-in service cannot be reached for a minute. What does cfo_100 hear?
   <details><summary>Answer</summary>If DSoR holds the keys from an earlier fetch, her token still checks, for up to ten minutes. If not, <code>AUTHENTICATION_REQUIRED</code>: DSoR never accepts a token it cannot check (C7).</details>

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-IDN-01 | Every caller becomes a principal before any other processing | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/tokens.test.ts`, `test/logins.test.ts`, `test/logins.db.test.ts` |
| DSOR-IDN-04a | Roles and scopes only from an issuer or role source configured for the company | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `test/issuers.test.ts`, `test/tokens.test.ts`, `test/logins.test.ts` |
| DSOR-IDN-04b | A claim from any other origin decides nothing | [§12.1](../../../specs/dsor/02-security.md#121-role-source) | `test/logins.test.ts`, C3 |
| DSOR-APR-05a | An approval only from the approver's own login | [§26.5](../../../specs/dsor/03-execution.md#265-the-approval-channel) | `test/logins.test.ts`, C6 |

The issuers file, the algorithms, the links, and the stand-in are this tutorial's decisions: those
tests are titled by step 43's decisions D1 to D9.

**Next:** step 44, an OAuth server for agents: Better Auth, run by us, gives
`accounts-payable-fte` a token of its own, and the last fake tokens go.
