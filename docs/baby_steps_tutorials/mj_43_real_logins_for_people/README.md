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
| C2 | A token is accepted only when its header names EdDSA, its `iss` is a configured issuer exactly, its signature checks against a key that issuer publishes, its `aud` is that issuer's audience, it has a `sub`, and it has not expired (5 seconds of tolerance). Anything else is refused at line ①, with the one answer `AUTHENTICATION_REQUIRED` |
| C3 | DSoR's own table links `(issuer, subject)` to a principal. A login with no link is refused at line ①. A link may name only a person. Nothing else in the token decides anything: a `role` claim is never read |
| C4 | A token counts only in a company that configured its issuer: the principal's companies are cut to those, so in any other company line ② refuses it |
| C5 | Where logins are real, the fake tokens of people are refused; agents and DSoR's own system logins keep theirs until step 44 |
| C6 | cfo_100 approves INV-1008 with her own signed token; the fake `tok_d4e8` cannot (DSOR-APR-05a) |
| C7 | Fail closed: keys that cannot be fetched, or a key the issuer no longer publishes, refuse the token |
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
  by a key from that issuer's `jwks`; `aud` that issuer's `audience`; a `sub`; not expired, with 5
  seconds of tolerance. *Downside:* a token from a provider with another algorithm is refused until
  the list grows.
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
  runs without a Neon account. The shipped `issuers.json` names it. *Downside:* a program that makes
  valid tokens; it is trusted only where `issuers.json` names it, and only on this computer.
- **D10. Not in this step (Claude Code):** an agent's real token (step 44), acting for a person (step
  45), a step-up login, and the time of sign-in on an approval, which stays the time of the call.

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | The shipped file passes; each kind of bad file is refused, with its company and field named |
| C2 | A token from the stand-in passes; one signed with another key, one with `alg` HS256 or `none`, another `iss`, another `aud`, no `sub`, an expired one, and one that is not a JWT are each refused |
| C3 | cfo_100's login reads INV-1008 whole; a login with no link is refused; a token whose `role` claim says CFO, for user_123, is still user_123, an AP supervisor |
| C4 | A token of org_789's issuer, linked to user_700, works in org_789 and is refused in org_456 at line ② |
| C5 | Under real logins, `tok_d4e8` is refused; `tok_7f3a`, the agent, still works |
| C6 | cfo_100's real token approves the agent's INV-1008; `tok_d4e8` is refused |
| C7 | Keys that cannot be fetched refuse every token; a key rotated away refuses its old tokens |
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

The rest of this README is written as the step is built.
