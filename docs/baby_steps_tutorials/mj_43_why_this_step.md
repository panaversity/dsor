# Step 43 · Why this step: real logins for people

This note keeps the context of step 43 before any design or code. It holds the problem, a real run
of it, what the rules say, what is built today, and the decisions. On 2026-10-23 the learner said
"make all assumptions and complete 42 and 43 as well, then we discuss the details". So every
decision here is Claude Code's, marked so, with its downside, for the learner to review.

## Where we are

- **Step 42 is complete** (`cd999bac`): an HTTP server, `pnpm serve`, over the same checklist, with
  no check of its own except a 421 for a request meant for another host (D8).
- **Step 43's map entry:** "Replace the fake login header, for humans. Switch on Managed Better Auth
  for your Neon branch. People now sign in for real […]. DSoR receives a signed token, checks the
  signature against the published keys, checks who issued it and that it has not expired, and
  accepts only an issuer that this company has configured. Then it looks up which principal that
  login belongs to, in a small table of its own. A login proves who you are. DSoR decides which
  principal that is." **Break it:** "sign a perfect-looking token with your own key and present it."
  **Done when:** "it is refused, and so is a real token from an issuer this company never
  configured."
- **After it:** step 44 gives agents real tokens from a Better Auth server run by us; step 45 an
  agent that acts for a person.

## The problem, in plain words

A *login token* says who is calling. Since step 05, DSoR's tokens are a fake table in
`src/principals.ts`: `tok_d4e8` is cfo_100. That file is public, on GitHub. So anyone who can reach
the door can be cfo_100, and approve a payment as her.

And cfo_100 cannot prove who she is in any other way. A real sign-in service gives her a *signed
token*: a short text that says "this is user 8c1f…, signed by this issuer, valid for 15 minutes",
with a signature only the issuer's private key can make. DSoR does not know how to read one.

## The problem, run for real

A real run on 2026-10-23, on step 42's finished code (`cd999bac`), in memory, in a scratch copy,
through the real HTTP door. Token 3 was signed with a new Ed25519 key, in the shape Managed Better
Auth gives (`alg` EdDSA, `iss` and `aud` the auth origin, `sub` a user id, 15 minutes).

```text
1. The agent drafts INV-1008, 31,400.00 USD, through the door
  HTTP 202: {"outcome":"PENDING_APPROVAL","agent":"accounts-payable-fte"}
2. A stranger who read src/principals.ts on GitHub sends cfo_100's token, tok_d4e8, and approves
  HTTP 200: {"outcome":"COMMITTED","state":"APPROVED","principal":"cfo_100"}
  DSoR's log: proposal.approve@1, ALLOW, by {"request_id":"req_6cfa158b-…","principal_id":"cfo_100"}
3. cfo_100 herself signs in and sends her signed token
  HTTP 401: AUTHENTICATION_REQUIRED: log in first: the call has no login token that DSoR gave
```

`src/principals.ts:58` is the line: `["tok_d4e8", principal("cfo_100", "human", ["CFO"])]`.

## Why it matters

1. **The CFO's approval is anyone's.** Step 29's whole idea, "only the CFO approves above 25,000
   USD", rests on knowing who the CFO is. Run 2 approved 31,400.00 USD with a token from a public
   file, and the log blames cfo_100.
2. **The real person cannot get in.** Run 3: a correctly signed token from a real sign-in service
   is refused, because DSoR knows only its own table.

## What the rules say

- **DSOR-IDN-01** ([§12](../../specs/dsor/02-security.md#12-identity-and-principals)): "DSoR MUST
  normalize every caller into a principal with a type and tenant memberships before any other
  processing." §12 also says: "Authentication is delegated to an external identity provider."
- **DSOR-IDN-04a** ([§12.1](../../specs/dsor/02-security.md#121-role-source)): "Role and scope
  assertions MUST be accepted only from a token issuer or role source configured as authoritative
  for the active tenant."
- **DSOR-IDN-04b:** "A claim from any other origin MUST NOT be used in an authorization decision."
- **DSOR-APR-05a** ([§26.5](../../specs/dsor/03-execution.md#265-the-approval-channel)):
  "`proposal.approve` MUST be accepted only in `direct` identity mode, from an approver
  authenticated to DSoR under their own credentials."

**What Managed Better Auth gives, checked on 2026-10-23** in Neon's documentation
([JWT plugin](https://neon.com/docs/auth/guides/plugins/jwt)): tokens signed with EdDSA (Ed25519),
with a `kid`; the keys at `<Neon Auth URL>/.well-known/jwks.json`; `iss` and `aud` the origin of
the Neon Auth URL; `sub` the user's id; 15 minutes of life; claims such as `email`, `name`, and
`role`, and "custom claims are not supported". Neon's examples verify with `jose`.

## What is built today, at step 42

- `whoIsCalling` (`src/principals.ts`) looks the token up in the fake table, `logins`, and nothing
  else. Line ① calls it first, so a caller with no known token is refused before anything else.
- Each principal's type, companies, and roles are DSoR's own, written in that table. No role comes
  from a token.
- The door listens only on 127.0.0.1 (step 42's D7), and refuses another `Host` (D8).

## The decisions (Claude Code's, 2026-10-23, for the learner to review)

- **D1. People only.** Real logins replace the fake tokens of people: cfo_100, user_123, admin_100,
  user_700, admin_700. Agents and DSoR's own system logins keep their fake tokens until step 44.
  *Downside:* an agent's token is still public, so the door stays on 127.0.0.1 (step 42's D7).
- **D2. `jose` 6.2.12**, the library Neon's own examples use, published 2026-09-05, past the
  48-hour quarantine. *Downside:* a new dependency, the first that touches security.
- **D3. Each company names its issuers** in a new file, `issuers.json`: the issuer, the audience, and
  the address of its keys. Start-up refuses a company with no issuer, an issuer that is not
  `https` (except `http://127.0.0.1`, for a stand-in on this computer), and a field it does not know.
  *Downside:* one more file to keep in step with the Neon project.
- **D4. A token is accepted only if all of these hold:** its header names EdDSA; it is signed by a
  key its issuer publishes; its `iss` is an issuer some company configured, exactly; its `aud` is
  that issuer's configured audience; it has not expired, with 5 seconds of tolerance for clocks;
  and it carries a `sub`. *Downside:* a token from another provider with another algorithm is
  refused until the list grows.
- **D5. DSoR's own table links a login to a principal:** `(issuer, subject) → principal`, in
  `dsor.logins`, which the program may read and only the owner may change. A login with no row is
  refused. The principal's type, companies, and roles stay DSoR's; nothing in the token, `role`
  included, is used for a decision (DSOR-IDN-04b). *Downside:* each person's row must be added by
  hand after they first sign in (`pnpm link-login`).
- **D6. A token counts only in a company that configured its issuer** (DSOR-IDN-04a). The
  principal's companies are cut to those whose `issuers.json` names the token's `iss`, so a token
  from org_789's issuer used in org_456 is refused at line ②. *Downside:* a person in two companies
  with two sign-in services needs a row for each login.
- **D7. One answer for every bad token**, `AUTHENTICATION_REQUIRED`, "log in first", as since step
  05, whatever was wrong: a forged signature, an unknown issuer, an expired token, no row, or keys
  that could not be fetched. *Downside:* a caller whose token expired is told no more than one who
  forged it; the reason is not in the answer.
- **D8. Each world chooses its logins**, as each world chose its rules in step 27. The stories of
  `pnpm start` and the earlier tests keep the fake table; `pnpm serve` uses real logins for people.
  *Downside:* the old tests still prove things with fake people.
- **D9. A stand-in for Managed Better Auth**, `pnpm dev-issuer`, on 127.0.0.1:8043: it publishes
  its keys and signs 15-minute tokens for the story's people, in Neon's shape. It lets the step run
  without a Neon account, and the README says how to point `issuers.json` at the real one.
  *Downside:* a program that makes valid tokens; it is trusted only where `issuers.json` names it.
- **D10. Not built in step 43:** an agent's real token (step 44), acting for a person (step 45), a
  step-up login, and the time of sign-in on an approval (it stays the time of the call).

## What only the learner can do

Switching on Managed Better Auth needs the learner's Neon account. Claude Code cannot sign in or
create accounts. The README's "Run it with Neon" lists the steps: switch on Neon Auth for the
branch, put its URL in `issuers.json`, sign up cfo_100, and run `pnpm link-login` with her user id.

## The learner's predictions

Not asked: the learner chose to build first.

## Built, reviewed, and changed by the review (2026-10-23)

Step 43 is built in five pieces, red first; see its README. The breaks B1 to B8 ran in a copy; B2
found a test that proved jose, not the rule, and a new test closes it. The hostile review changed two
decisions, both still Claude Code's:

- **D9 changed (H1):** the stand-in gave anyone on this computer, the agent too, cfo_100's token with
  no password. Now each person signs in with a code the stand-in prints in its own terminal, and
  `pnpm serve` trusts a stand-in only with `DSOR_STAND_IN=on`.
- **D4 changed (L3):** a token also needs an `iat`, and is at most 15 minutes old.

**For the learner to decide, with D1 to D10:** whether an outage of the keys or of the links should
answer a retryable code instead of `AUTHENTICATION_REQUIRED` (the review's L7, against D7); and
whether DSoR needs an audience of its own in a person's token (M2; open question 164).

## How to continue in a new session

```text
Step 43 is built: docs/baby_steps_tutorials/mj_43_real_logins_for_people/README.md. Its decisions
are Claude Code's, for the learner to review with step 42's A3 and A4. The real Managed Better Auth
is connected since 2026-10-24: the learner's Neon project `dsor-baby-steps`, Neon Auth with Better
Auth; cfo_100 signed in for real and read INV-1008 through the door (the README's "Run it with Managed
Better Auth").
```

## Revised by the learner (2026-10-24)

After the real run on Neon, the learner said: "I see really bad business and prod decisions on this
step". Claude Code listed six, worst first. The learner chose to change four of them inside step 43,
and #1 is proposed as a step of its own, 43b (people and their roles in a DSoR table, not in code).

- **#2 Invitations instead of hand-linking**, decided one question at a time:
  - **R1. An invitation code links a first sign-in (the learner's).** An admin invites a person; DSoR
    answers with a one-time code, single use, valid 7 days; the person signs in and accepts with
    their token and the code, and DSoR links that login. Not "match by email": anyone can sign up at
    Neon Auth, and emails are not verified there, so a stranger could sign up as the CFO's email.
    *Downside:* one more step for the person, and the code must reach them safely.
  - **R2. Tenant admins invite, with guards (the learner's).** New permissions `login:invite` and
    `login:unlink`, held only by `tenant_admin` in the shipped role table; people only, never an
    agent; the inviter's own login can never accept their own invitation; every invitation, link, and
    unlink is recorded with who did it. A second admin's confirmation for powerful people (a two-person
    rule) is noted for step 43b. *Downside:* an admin with a second sign-in account could still
    accept; the log shows it afterwards.
  - **R3. The owner creates invitations, never links (the learner's).** `pnpm link-login` is replaced
    by `pnpm invite <principal>`, run as the database owner: it creates a recorded invitation and
    prints its code; the first tenant admin accepts it with their own sign-in, as everyone else does.
    One path in for every person. *Downside:* the owner can still start an invitation, by command and
    always recorded.
- **R4. Any provider: algorithms and maximum age per issuer (the learner's, #3).** `issuers.json` may
  give each issuer `algorithms` (such as `["RS256"]`) and `max_age` (such as `"60m"`); left out, they
  are Neon's, `["EdDSA"]` and `"15m"`. Start-up refuses a shared-secret algorithm (`HS…`), `none`, and
  an age over 24 hours. So Okta, Entra ID, and Auth0 can sign people in, not only Neon. *Downside:* an
  admin may set a weak but allowed value.
- **R5. An outage is `CONNECTOR_UNAVAILABLE` (the learner's, #4).** When an issuer's keys cannot be
  fetched, or DSoR's links cannot be read, the caller hears `CONNECTOR_UNAVAILABLE` (§28, retry
  `safe_same_key`, the door's 503), and the log names the cause; not "log in first". A token whose key
  the issuer does not publish is still a bad token. Seen live on 2026-10-24, when the door could not
  reach Neon and told the real CFO to log in. *Downside:* the code's name says connector.
- **R6. A sign-in service dedicated to DSoR, stated (the learner's, #5).** Each issuer must carry
  `"dedicated_to_dsor": true`, or start-up refuses it: Managed Better Auth cannot set DSoR as a
  token's audience, so a service shared with another app would make that app's tokens DSoR tokens. A
  real DSoR audience comes with step 44's own Better Auth. *Downside:* a promise, not a proof.
- **R7. Unlinking is the off-switch (the learner's, #6).** A leaver is banned in Neon and unlinked in
  DSoR; DSoR looks the link up on every call, so it refuses the next one. The `banned` claim is not
  read: Better Auth issues no token to a banned user, and the token from before the ban says
  `banned: false`. Claude Code first proposed reading it, and corrected that. *Downside:* two places
  to act; a forgotten unlink leaves up to 15 minutes.
- **Proposed, not decided: step 43b**, people and their roles in a DSoR table, managed by an admin,
  not written in `src/principals.ts`; with a second admin's confirmation for powerful people.

## R1 to R7, built (2026-10-24)

Built red first, one commit per piece, on the learner's "build R1 to R7 into step 43".

- **Pieces:** R4 and R6 (each issuer's algorithms, age, and `dedicated_to_dsor`); R5 (an outage is
  `CONNECTOR_UNAVAILABLE`); R1 (the code redeemed at line ①); the README's revised design; R2 and R7
  (`login.invite`, `login.unlink`); the database (migration 048, `pnpm invite` replacing
  `pnpm link-login`); fifteen breaks.
- **Found while building:** a code was redeemed in any company the call named, even one that does
  not trust the token's issuer. Now only where that issuer is trusted, with its own test.
- **Found while writing the breaks:** the test of one login sending two codes at once counted the
  links but not the invitations, so a code used up by a lost race would have gone unseen.
- **The person is an address** (`dsor://org_456/person/cfo_100`) in the two commands, loosely typed,
  as step 29 does for a proposal, so the cross-company suite still sees `TENANT_MISMATCH` before the
  command's own check refuses anything that is not a person of the company.
- **What the database now holds the line on:** `dsor_runtime` may add a link, but a trigger accepts
  only one that an invitation that very login accepted names; a link ends once and stays as history;
  an invitation moves once, and dsor_runtime cannot name its end date.
- **The hostile review's high finding (R-H1):** an admin could invite a person who already had a
  login, redeem the code with a second sign-up, and be that person too: create a payment as them and
  approve it as the admin. Fixed red first: one live login for each person, held by a unique index.
  An admin can still invite someone never linked and redeem it themselves; a second admin's
  confirmation is for 43b. Two medium and three low findings are recorded in the README.
- **Not done yet:** the invitation flow against the real Neon Auth. cfo_100's Neon login is still the
  one `pnpm link-login` made. It needs the learner to sign in again. Open questions 166 and 167.
