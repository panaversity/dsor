# Step 10 · Tenants

**New in this step:** a second company moves in. Every row says which company it
belongs to (DSOR-TEN-01a), and every request works inside exactly one company that the
caller belongs to (DSOR-IDN-03a).

## In plain words

One DSoR serves many companies. Each one is a **tenant**, like the tenants of one
building. Until now there was only one, `org_456`, written into the code as a constant.
From this step there are two: `org_456` and `org_789`.

Each company numbers its own bills, so both can have an invoice called `INV-1008`. So
every invoice row now carries its `tenant_id`, and a row is found by the pair
*(company, id)*, never by the id alone.

Every request now names the company it works in, beside the login token:
`{ token, tenant: "org_456" }`. DSoR checks, in its own records, that the caller is a
**member** of that company. That company is the request's **active tenant**. Every read
looks only inside it, and only the caller's roles *in that company* count.

Think of a good hotel's front desk. Ask "is John Smith in room 305?", and the answer is
the same whether he is there or not: "I can't share guest information." If strangers got
"no such guest" and real guests got "I can't tell you", the choice of answer would give
the guest away. DSoR answers the same way about other companies. The analogy stops at the
lobby: a hotel shares one building, while here two companies share one database, and a
second lock inside the database itself comes in step 11.

## Why it matters

**A leak between customers ends a product.** §14 says it in those words. If the agent of
`org_456` asks for `INV-1008` and the table cannot tell whose row is whose, it can get
`org_789`'s bill: another company's vendor, amount, and status.

**Authority leaks too, not only data.** An accounting firm runs one agent for many
client companies. §12's own example: "an accounting firm's one Accounts Payable FTE
serves many client organizations". The firm's agent may only read for one client and
issue invoices for another. If DSoR adds up its roles from every company, power granted
by one company is used inside another.

**Common mistake:** §14 names it: "Telling the AI 'only look at org_456' and calling that
isolation. The agent is not a lock." And its cousin: taking the company from the
arguments. An argument is text the agent wrote.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of the specification it relies on was read on
2026-09-29: §11 (DSOR-SRC-01a, DSOR-SRC-02a, DSOR-SRC-02b), §12 (the principal and the
request security context, DSOR-IDN-03a, DSOR-IDN-03b), §14 (DSOR-TEN-01a to 02b), §28
(DSOR-ERR-01b, and the retry class of `TENANT_MISMATCH`), and the audit record's
`tenant` in `audit-record.schema.json`. If the code finds the plan wrong, the plan
changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** One company never sees, touches, or learns about another company's data, and
never uses authority another company gave. The analogy is the hotel desk.

**Outcome.** What is true when this step is done:

1. Every request names one company, and is refused unless the caller is a member of it.
   "No such company" and "not a member" get the same answer, word for word.
2. `invoice.get` for `INV-1008` gives each company its own invoice: 31,400.00 USD for
   `org_456`, and 99,000.00 USD for `org_789`.
3. An invoice that exists only in another company gets the same answer as one that
   exists nowhere.
4. Only the caller's roles in the active company count at line ⑤.
5. A company named in the arguments, a field or a URI, that is not the active company is
   refused with `TENANT_MISMATCH`, the same whether the thing it points at exists or not.
6. Every invoice row and every audit record carries its company. A record of a refusal
   made before the company is known has none.

**Not the outcome of this step.** The second lock: PostgreSQL filtering rows by company
itself, row-level security (step 11). The suite that calls every operation with another
company's URI (step 12). Creating a company through an operation. Here the two companies
are written by a migration.

**The success signals**, each a test that fails if this step's code is deleted:

- Same id, right company: `org_456` gets 31,400.00 USD for `INV-1008`, never
  `org_789`'s 99,000.00.
- A non-member is refused: `accounts-payable-fte` asking to work in `org_789` gets the
  same answer as asking for `org_999`, which does not exist.
- A foreign URI: `dsor://org_789/invoice/INV-1008` and `dsor://org_789/invoice/NOPE` get
  the same answer, word for word.

### What the specification asks, and what this step can honestly give

Checked on 2026-09-29:

1. **The map and DSOR-SRC-02b disagree about a foreign URI.** The map's "done when"
   says it returns "the same 'not found' as a URI that does not exist". DSOR-SRC-02b says
   a tenant identifier in the arguments that disagrees with the security context "MUST
   cause `TENANT_MISMATCH` or `AUTHORIZATION_DENIED`", and a URI's first part is a
   tenant identifier. This step follows the rule: `TENANT_MISMATCH`, for every foreign
   URI, whether its invoice exists or not. That keeps what the map wants to protect:
   the answer never tells whether another company's invoice exists (DSOR-ERR-01b). It
   is recorded as a question for the specification.
2. **DSOR-IDN-03b says an operation must not read *or write* across tenants.** No
   operation writes yet, so this step shows the reading half.
3. **DSOR-TEN-01b asks for two independent locks.** This step builds the first, in
   DSoR's own code. The database's lock is step 11, so DSOR-TEN-01b is not claimed here.
4. **DSOR-TEN-02a asks for audit partitions keyed by tenant.** Each audit record carries
   its tenant. Separate partitions, and the other stores that rule names, come with
   those stores.
5. **Step 02's open note** asked that whatever creates tenants never make an id out of a
   name (DSOR-RID-01b). Here tenants are written by a migration, with fixed ids. No
   operation creates one yet, so the note stays open.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-IDN-03a | **C1.** Each request resolves to exactly one active company, in which the caller holds a membership | A request with no company is refused. A company the caller does not belong to is refused, with the same answer as a company that does not exist. The firm's agent works in either company, one per request |
| DSOR-IDN-03b | **C2.** A read looks only inside the active company | `INV-1008` gives each company its own. `INV-2001`, which only `org_789` has, is "not found" for `org_456`, word for word as `INV-9999` |
| DSOR-IDN-03a, with DSOR-AUT-01b | **C3.** Only the roles in the active company count | The firm's agent issues in `org_789` and is denied `invoice.issue` in `org_456` |
| DSOR-SRC-02b | **C4.** A company in the arguments that is not the active one is refused with `TENANT_MISMATCH` | A `tenant` field, and a URI, naming `org_789` from inside `org_456`. A field naming the active company is not refused for that |
| DSOR-ERR-01b | **C5.** A refusal never tells whether another company, or its invoice, exists | Pairs of answers compared word for word: `org_789` and `org_999`, `INV-1008` of `org_789` and `NOPE` of `org_789` |
| DSOR-TEN-01a | **C6.** Every invoice row and every audit record carries its company | `app.invoices.tenant_id` is `NOT NULL` and part of the key. `dsor.audit.tenant` is the active company, and empty only for a refusal before line ② |

### Decisions the specification leaves to us

Each one is this tutorial's decision, not a rule of DSoR. Each has a downside.

1. **The company is named in the request envelope, beside the token, and it is always
   required:** `{ token, tenant, request_id? }`. DSoR never guesses it, not even for a
   caller with one membership. §12 puts `activeTenantId` in the request security
   context, and DSOR-SRC-02a says that context comes only from the request envelope and
   DSoR's own store. *Downside:* every call carries one more field. A caller that
   belongs to one company must still name it.
2. **Line ② of the checklist resolves the company, right after line ①.** A request
   with no `tenant`, or one that is not in the form `org_` and digits (step 02), is
   refused with `VALIDATION_FAILED`: the envelope is malformed, and its form tells
   nothing about who exists. A well-formed company the caller does not belong to is
   refused with `AUTHORIZATION_DENIED`, with one message for "no such company" and "not a
   member". *Downside:* a caller who typed a real company's id wrongly and one who has no
   right to it get the same message, so the refusal helps an honest caller less.
3. **Only the active company's roles count at line ⑤.** Step 06's constant `COMPANY`
   goes, and `permissionsOf` takes the active company. *Downside:* none that we see. This
   is the rule.
4. **A company named in the arguments is checked at two places, both before "is it
   built".**
   - At line ②: the fields `tenant` and `tenant_id`, at the top of the input and in its
     `correlation`, the same places step 05 checks for a principal. One that is not the
     active company is refused with `TENANT_MISMATCH`.
   - Right after line ⑥: every text in the checked input that starts with `dsor://` must
     be a canonical URI of the active company, or it is refused with `TENANT_MISMATCH`.
     The whole input is searched, not only the fields a schema calls URIs, so a new
     operation cannot forget the check.
   *Downside:* a free-text field that merely mentions another company's URI is refused
   too.
5. **Invoices move to a key of (company, id).** A new migration, `002`, adds
   `tenant_id` to `app.invoices`, fills it with `org_456` for the rows already there, and
   makes `(tenant_id, id)` the key. It adds `org_789`'s two invoices: `INV-1008` for
   99,000.00 USD from `VENDOR-77`, and `INV-2001`, which `org_456` does not have.
   Migration `001` is never edited: a migration that has run is history. *Downside:*
   `VENDOR-77` and the two new invoices are not in the specification's running example.
   They are this step's own.
6. **Each audit record carries its company, in a new column `tenant`.** It is empty for a
   refusal made before line ②, such as "no login". `dsor_runtime` gets `INSERT` on that
   one column too, so the list of privileges from step 09 grows by one word. *Downside:*
   the refusals with no company share one empty value, so they cannot be counted per
   company.
7. **Three new principals, in DSoR's own table.**
   - `firm-ap-fte`, an agent of an accounting firm: `ap_agent` in `org_456`, and
     `ap_supervisor` in `org_789`.
   - `user_700`, `org_789`'s own supervisor: `ap_supervisor` in `org_789`.
   - `accounts-payable-fte`, `user_123`, and `cfo_100` stay in `org_456` only.
   *Downside:* the firm's agent and `user_700` are this step's own, not the running
   example's.
8. **The migration runner runs every file in `migrations/`, in name order, in one
   transaction,** and each file stays safe to run twice. There is no table of migrations
   that have run. *Downside:* every run runs every file again, so each file must be
   written to be repeatable, and a later step with many migrations will want that table.
9. **The request id, the answer's `correlation`, and the rest of step 09 stay as they
   are.** The tenant goes into the audit record, not into `correlation`. *Downside:* a
   caller reading an answer does not see which company it was for, only the log does.

### The tests, by claim

- **C1:** no `tenant` → `VALIDATION_FAILED`. `tenant: "acme"` → `VALIDATION_FAILED`.
  `accounts-payable-fte` with `org_789` → `AUTHORIZATION_DENIED`, and with `org_999` →
  the same code and message. `firm-ap-fte` reads `INV-1008` in `org_456` and in
  `org_789`, and gets each company's own.
- **C2:** `org_456` reads `INV-1008`: 31,400.00 USD, `VENDOR-44`. `org_789` reads
  `INV-1008`: 99,000.00 USD, `VENDOR-77`. `org_456` reads `INV-2001`: the same answer as
  `INV-9999`, apart from the id in the message and the request id.
- **C3:** `firm-ap-fte` in `org_456` calls `invoice.issue` → `AUTHORIZATION_DENIED`. In
  `org_789` it passes line ⑤ and hears that commands are not built yet.
- **C4:** `accounts-payable-fte` in `org_456` sends `invoice.get` with `tenant:
  "org_789"` in the input → `TENANT_MISMATCH`. With `tenant: "org_456"` it is not
  refused for the tenant (line ⑥ then refuses the unknown field). `user_123` sends
  `invoice.issue` with `dsor://org_789/invoice/INV-1008` → `TENANT_MISMATCH`, not "not
  built yet". With `dsor://org_456/invoice/INV-1008` it reaches "not built yet".
- **C5:** the pairs of C1 and C4, compared word for word, apart from the request id.
- **C6:** in the database: `app.invoices.tenant_id` is `NOT NULL` and in the key. A
  call's audit record has `tenant = 'org_456'`. A call with no login has `tenant` empty.
  `dsor_runtime`'s privileges are step 09's list plus `tenant` in the `INSERT` columns.

### Breaks we will try, and what we expect

Run against the finished step. The learner's predictions were recorded before any code.

| # | The break | Expected to be caught by | Learner's prediction |
| --- | --- | --- | --- |
| U1 | The invoice query drops `tenant_id = $1` | C2's `INV-2001` test. `INV-1008` alone may pass by luck, whichever row comes first | both INV-1008 and INV-2001, every time |
| U2 | Line ⑤ adds up the roles from every membership | only C3, the firm's agent | only the firm-agent test |
| U3 | A `tenant` in the arguments is used as the active company | C4 | C4 |
| U4 | The URI check runs after "is it built" | C4's `invoice.issue` test | C4's `invoice.issue` test |
| U5 | "No such company" and "not a member" get different messages | C5 | C5 only |
| U6 | The audit record's tenant is left empty | C6 | not asked; the expectation stands |

The review also attacks the step with the threat that is this step's reason. §10.2
lists the threats. For tenants they are the cross-tenant ones: a URI, a field, or a
membership that crosses from one company into another.

### Left open, and not this step's idea

- **The second lock, in the database:** step 11, with DSOR-TEN-01b and DSOR-RP-01a to
  01d.
- **Every operation called with another company's URI**, as a suite: step 12
  (DSOR-TEN-02b).
- **Writing across companies** (the other half of DSOR-IDN-03b): with the first command
  that writes.
- **An operation that creates a company**, and with it step 02's note on DSOR-RID-01b.
- **The map's "same 'not found'" and DSOR-SRC-02b's `TENANT_MISMATCH`:** a question for
  the specification.

## Before you build: set up Neon

The rule is not "by hand". It is: **a secret never passes through a chat.** Neon's MCP
server returns a connection string with the owner's password inside, so anything it
fetches lands in the transcript. Step 09 learned that live. A command whose output goes
straight into a file keeps the secret out of the chat, so Claude Code may do this setup
itself, this way:

1. Create a branch `step-10` **from `step-09`**, with the Neon MCP server or with
   `neonctl branches create`. It starts with step 09's tables, `dsor_runtime`, and the
   log. Migration `002` builds on them.
2. Write `.env` with `neonctl connection-string`, its output redirected into the file,
   never printed: the owner's string as `DSOR_MIGRATION_URL`, and the same string with
   the user `dsor_runtime` and a new random password (letters and digits) as
   `DSOR_DB_URL`. Both with `sslmode=verify-full` (step 09's README says why).
3. Run `pnpm migrate`. It sets `dsor_runtime`'s password from `DSOR_DB_URL`, so the new
   password works on this branch.
4. Check without looking: `pnpm test:db` passes, and a search of the transcript finds no
   `postgresql://` with a password in it.

Doing it by hand in the console is the same, with you as the pipe. Either way, never
paste the file, and never ask for a connection string.

## What changed since step 09

_To be written when the code exists._

## Run it

_To be written when the code exists._

## Break it

_To be written when the code exists, with real output._

## Build it yourself with Claude Code

_To be written when the code exists._

## Check yourself

1. Why must the company come from the request envelope and DSoR's records, and never
   from the arguments?
2. `accounts-payable-fte` asks to work in `org_789`, and then in `org_999`. Why must the
   two refusals be identical?
3. The firm's agent may issue invoices in `org_789`. Why is it denied `invoice.issue` in
   `org_456`?
4. A foreign URI gets `TENANT_MISMATCH`. Doesn't that tell the caller something?
5. This step is DSoR's lock on companies. Why does §14 ask for a second one?

<details>
<summary>Answers</summary>

1. The arguments are text the agent wrote, and an injected document can shape them. The
   envelope carries the login, and DSoR checks the company against its own table of
   memberships (DSOR-SRC-02a).
2. Different answers would tell a caller which companies exist, one guess at a time.
3. Only the roles in the active company count. The firm's `ap_supervisor` role belongs
   to `org_789`, and in `org_456` it holds only `ap_agent`.
4. Only that the URI names another company, which the caller already knew, because it
   wrote the URI. It says nothing about whether that company's invoice exists: every
   foreign URI gets the same answer.
5. So that one bug cannot leak. If a query in DSoR's code forgets the company, the
   database still filters by it (step 11).

</details>

## Think it through

_To be written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-TEN-01a | Every tenant-owned resource carries its `tenant_id` | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | _to be counted_ |
| DSOR-IDN-03a | Each request resolves to exactly one active tenant in which the subject holds a membership | [§12 Identity and principals](../../../specs/dsor/02-security.md#12-identity-and-principals) | _to be counted_ |
| DSOR-IDN-03b | An operation does not read or write across tenants | [§12 Identity and principals](../../../specs/dsor/02-security.md#12-identity-and-principals) | _to be counted_, reading only: no operation writes yet |
| DSOR-SRC-02b | A tenant or principal in the arguments that disagrees with the security context is refused | [§11 Source trust and the instruction boundary](../../../specs/dsor/02-security.md#11-source-trust-and-the-instruction-boundary) | _to be counted_, the tenant half. The principal half is step 05's |
| DSOR-ERR-01b | An error does not reveal a resource the caller may not read | [§28 Result and error envelopes](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) | _to be counted_, for other companies and their invoices |

Not met here, and why: DSOR-TEN-01b, whose second lock is step 11. DSOR-TEN-02a, whose
partitions come with each store. DSOR-TEN-02b, the suite of step 12.

## Next

Step 11 · Row-level security: the second lock. PostgreSQL itself filters every row by
company, so a query that forgets the company still cannot leak.
