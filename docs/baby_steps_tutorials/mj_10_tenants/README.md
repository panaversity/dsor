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
6. **`audit-record.schema.json` makes `tenant` required, on every record.** A refusal
   made before line ② has no company that DSoR has checked. Writing the company the
   caller *claimed* would put a stranger's record in another company's log. So this step
   leaves it empty (decision 6), and its records do not match the schema there. It is
   recorded as a question for the specification. The records do not claim to match the
   schema yet anyway: the hash chain is step 39.
7. **§6's `invoice` entity is `tenant_scoped`, but lists no `tenant_id` field.** This
   step gives the invoice the field (decision 10). Whether the field is implied, or the
   list needs it, is a question for the specification.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-IDN-03a | **C1.** Each request resolves to exactly one active company, in which the caller holds a membership | A request with no company is refused. A company the caller does not belong to is refused, with the same answer as a company that does not exist. The firm's agent works in either company, one per request |
| DSOR-IDN-03b | **C2.** A read looks only inside the active company | `INV-1008` gives each company its own. `INV-2001`, which only `org_789` has, is "not found" for `org_456`, word for word as `INV-9999` |
| DSOR-IDN-03a, with DSOR-AUT-01b | **C3.** Only the roles in the active company count | The firm's agent issues in `org_789` and is denied `invoice.issue` in `org_456` |
| DSOR-SRC-02b | **C4.** A company in the arguments that is not the active one is refused with `TENANT_MISMATCH` | A `tenant` field, and a URI, naming `org_789` from inside `org_456`. A field naming the active company is not refused for that |
| DSOR-ERR-01b | **C5.** A refusal never tells whether another company, or its invoice, exists | Pairs of answers compared word for word: `org_789` and `org_999`, `INV-1008` of `org_789` and `NOPE` of `org_789` |
| DSOR-TEN-01a | **C6.** Every invoice row and every audit record carries its company | `app.invoices.tenant_id` is `NOT NULL` and part of the key. `dsor.audit.tenant` is the active company, and empty only for a refusal before line ② has checked one |

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
8. **Each migration runs once, and the database remembers which have run.** A new table,
   `dsor.migrations`, holds the name of every file that has run. `pnpm migrate` runs the
   files in `migrations/` that are not in it, in name order, and writes each name in the
   same transaction as the file itself. So a file and its line in the table land
   together, or neither does. `dsor_runtime` gets no privilege on this table.
   *Downside:* a file that has run is never run again, so fixing a mistake in it takes a
   new file. And the table is one more thing the owner must never edit by hand.

   *Changed before any code, on 2026-09-29.* The first version ran every file on every
   run, and asked each file to be safe to run twice. Reading `001` against `002` proved
   it wrong. `001` ends with "add INV-1008 unless an invoice with this id exists"
   (`ON CONFLICT (id)`), and gives no company. After `002` makes the key (company, id)
   and the company required, that sentence has no answer, so every run after the first
   would fail. There are two ways to manage a database's shape. **History:** numbered
   files, each a change, each run once, never edited. **Desired state:** one script that
   describes the database as it should be now, run again and again, and edited when the
   shape changes. The first version mixed them: numbered files, all run every time. With
   one file you cannot tell the difference. With two, the second can take away what the
   first took for granted. Step 09's decision 13 had predicted it: "A table for that
   arrives with the second migration."
9. **The request id, the answer's `correlation`, and the rest of step 09 stay as they
   are.** The tenant goes into the audit record, not into `correlation`. *Downside:* a
   caller reading an answer does not see which company it was for, only the log does.
10. **An invoice carries its `tenant_id`, in DSoR's code and in its answer, not only in
    its row.** From this step, `INV-1008` is two invoices. An invoice's identity is the
    pair (company, id), and its canonical URI writes that pair down:
    `dsor://{tenant_id}/invoice/{id}` (DSOR-RID-01a). An object that holds only `id`
    holds half of its own identity. Once it leaves the database, no code holding it can
    say whose it is, and would have to borrow the company from elsewhere. Pairing a
    record with the wrong company is the very bug this step prevents. DSOR-TEN-01a says
    the *resource* carries its `tenant_id`, and inside DSoR the resource is the object;
    the row is the store's copy of it. Showing the field to the caller tells it nothing
    new: it is the company the caller named. So `invoiceUri(invoice)` reads the invoice's
    own `tenant_id`, and step 01's constant `TENANT` goes. *Downside:* §6's `invoice`
    entity is `tenant_scoped`, but its list of fields has no `tenant_id`, so the answer
    has a field the entity does not list. Every test that compares a whole invoice
    changes.

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
  `dsor_runtime`'s privileges are step 09's list plus `tenant` in the `INSERT` columns,
  and none on `dsor.migrations`.
- **Decision 8, not a rule:** a second `pnpm migrate` runs no file, and succeeds.

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
- **A refusal before line ② has no tenant, but the audit schema requires one**, and
  **§6's `invoice` lists no `tenant_id`:** two more questions for the specification.

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

| File | What changed |
| --- | --- |
| `src/tenants.ts` | **New.** Line ②: `activeTenant` checks the envelope's company against the caller's memberships. `checkNamedTenants` refuses another company in the arguments' fields. `checkUrisInTenant` refuses a URI outside the company, anywhere in the checked input |
| `src/pipeline.ts` | Line ② runs right after line ①. The URI check runs right after line ⑥. The code, line ⑤, and the record all get the active company |
| `src/permissions.ts` | `permissionsOf` and `checkPermission` take the company. Step 06's constant `COMPANY` is gone |
| `src/invoice.ts` | An invoice carries its `tenant_id`, and `invoiceUri` reads it. Step 01's constant `TENANT` is gone. `org_789`'s two invoices, in memory |
| `src/principals.ts` | `firm-ap-fte`, in two companies with a different role in each, and `user_700` |
| `src/postgres.ts` | The invoice query filters by `tenant_id`. The log writes and reads `tenant` |
| `src/log.ts`, `src/registry.ts`, `src/operations.ts` | A decision has an optional `tenant`. The code of an operation is given the company |
| `src/request.ts`, `src/uri.ts` | The envelope has a `tenant`. `isTenantId` checks step 02's form |
| `src/migrate.ts` | Runs each file in `migrations/` once, and remembers it in `dsor.migrations` (decision 8) |
| `migrations/002_tenants.sql` | **New.** `tenant_id` on invoices, the key (company, id), `org_789`'s invoices, `tenant` on the log, and one more `INSERT` column for `dsor_runtime` |
| `src/main.ts` | Four more calls: the firm's agent in each company, a stranger to `org_789`, a foreign URI. Each log line ends with its company |
| `test/tenants.test.ts`, `test/tenants.db.test.ts` | **New.** C1 to C6, and decision 8 |
| `vitest.db.config.ts` | Database test files run one at a time (see "Think it through") |
| every other test | Every envelope names `org_456`. Invoices and records carry their company. Line ② is in the expected order |

Both tenant columns also refuse any text that is not `org_` and digits, a database
`CHECK`. That is this tutorial's decision, from step 02's form. No new dependency.

To see every line, from `docs/baby_steps_tutorials`:

```bash
git diff --no-index mj_09_postgres_on_neon/src mj_10_tenants/src
git diff --no-index mj_09_postgres_on_neon/test mj_10_tenants/test
git diff --no-index mj_09_postgres_on_neon/migrations mj_10_tenants/migrations
```

## Run it

Set up Neon first ("Before you build" above). Then, in this folder:

```bash
pnpm install
pnpm migrate      # runs only the migrations that have not run yet
pnpm check        # typecheck and the unit tests: no database needed
pnpm test:db      # the database tests, against the branch in .env
pnpm start        # the program, against the same branch
```

`pnpm migrate` on the branch `step-10`, made from `step-09`, on 2026-09-29. Before the
table of migrations existed, the new runner ran `001` again once; it could, because
`002` was not there yet. Then `002`, then nothing:

```text
dsor_runtime: password set again from DSOR_DB_URL
migration 001_audit_and_invoices: done

dsor_runtime: password set again from DSOR_DB_URL
migration 002_tenants: done

dsor_runtime: password set again from DSOR_DB_URL
no migration to run
```

The new part of `pnpm start`. The same id, two invoices. Then a stranger, and a URI
from another company. The record numbers come from the database:

```text
org_456 INV-1008 VENDOR-44 { value: '31400.00', currency: 'USD' }
org_789 INV-1008 VENDOR-77 { value: '99000.00', currency: 'USD' }
{
  code: 'AUTHORIZATION_DENIED',
  message: 'the caller may not work in the tenant it named',
  retry: 'never',
  correlation: {
    request_id: 'req_a1d56f79-55d9-4185-b2cf-33824bb4ca65',
    agent_id: 'accounts-payable-fte'
  }
}
{
  code: 'TENANT_MISMATCH',
  message: 'the arguments name a resource outside the active tenant',
  retry: 'never',
  correlation: { request_id: 'ap-desk-7', principal_id: 'user_123' }
}
...
1389 invoice.get@1 ALLOW ok org_456
1390 invoice.get@1 ALLOW RESOURCE_NOT_FOUND org_456
1391 invoice.issue@1 DENY AUTHORIZATION_DENIED org_456
1392 invoice.get@1 DENY AUTHENTICATION_REQUIRED -
1393 invoice.get@1 DENY AUTHORIZATION_DENIED -
1394 invoice.get@1 ALLOW ok org_456
1395 invoice.issue@1 DENY UNSUPPORTED_CAPABILITY org_456
1396 invoice.issue@1 DENY VALIDATION_FAILED org_456
1397 invoice.get@1 ALLOW ok org_456
1398 invoice.get@1 ALLOW ok org_789
1399 invoice.get@1 DENY AUTHORIZATION_DENIED -
1400 invoice.issue@1 DENY TENANT_MISMATCH org_456
```

Record 1393 has no company: the agent named `cfo_100` in its arguments, and line ①
refused it before line ② ran. Record 1399 has none either: line ② itself refused it, so
no company was ever checked.

## Break it

Every break of the design's table, performed on 2026-09-29, one at a time, then put
back. The unit tests ran for all six, the database tests for U1 and U6.

| # | The break | Learner's prediction | Caught by, for real |
| --- | --- | --- | --- |
| U1 | The invoice query drops `tenant_id = $1` | INV-1008 and INV-2001, every time | 4 database tests, **0 unit tests**. `org_456`'s INV-1008 test passed |
| U2 | Line ⑤ adds up the roles from every membership | only the firm-agent test | 7: three firm tests, and **step 06's four membership tests** |
| U3 | A `tenant` in the arguments is used as the active company | C4 | 6: five of C4, one of C6 |
| U4 | The URI check runs after "is it built" | C4's `invoice.issue` test | 2: that test, and `dsor://acme/…` |
| U5 | "No such company" gets its own message | C5 only | 2: C5, and **C1's `org_999` test** |
| U6 | The audit record's tenant is left empty | not asked | 12 unit tests, 2 database tests |

**U1**, the one to try yourself. In `src/postgres.ts`, change the invoice query to
`WHERE id = $1` with `[id]`. Then:

```text
$ pnpm check
      Tests  552 passed (552)

$ pnpm test:db
    × DSOR-IDN-03b: org_456 reading INV-2001 hears the same as for INV-9999
    × DSOR-IDN-03b: org_789 reads INV-1008 from app.invoices: 99,000.00 USD
    × DSOR-IDN-03b: the store finds an invoice by company and id together
    × starts, reads INV-1008 through invoice.get, and prints every answer as an envelope
      Tests  4 failed | 33 passed (37)
```

`pnpm check` stays green: the unit tests read the invoices in memory, which never met
the broken query. Only a test against the real table sees a bug in the real query.
`org_456`'s own INV-1008 test stays green too. Both rows answer to `INV-1008`, and the
query takes the first, which happens to be `org_456`'s. `org_789` gets `org_456`'s
31,400.00 USD. That is the leak §14 warns about, and step 11's second lock is for this
very bug.

**U5.** In `activeTenant`, answer `"no such tenant"` for a company outside a list of
known ones:

```text
    × DSOR-ERR-01b: org_789 and org_999 get the same refusal, word for word
    × DSOR-IDN-03a: the agent asking to work in org_999, which does not exist, is denied
      Tests  2 failed | 550 passed (552)
```

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Design first | "In plain words", "Why it matters", "The design, before any code", before the setup |
| 2 | Neon | A branch `step-10` from `step-09`, `.env` written by a command, never shown ("Before you build") |
| 3 | Check the design | Against §11, §12, §14, §28, the audit schema, **and migration `001`**. Two gaps found: decisions 8 and 10 |
| 4 | Mechanical | Every existing envelope names `org_456`. Nothing checks it yet, so every test stays green |
| 5 | Red | `tenants.test.ts`, `tenants.db.test.ts`, and the old expectations that change. Predict how many pass |
| 6 | Green | One commit per claim: the ledger, `002`, then C1, C2, C3, C4 (C5 came with it), C6 |
| 7 | Break it | U1 to U6, for real. Compare with your predictions |
| 8 | Review | A reviewer who has not seen your conversation attacks the step |

In the red run, the learner predicted about 10 of 51 new tests would pass, and 10 did.
Each of them expects "the same" or "nothing": the same answer for two companies, no
company on a record, "not built yet" for the company's own URI. With no code that tells
companies apart, "the same" is true for free. Such a test proves something only beside
the code it guards.

Build your own step 10 from a copy of your step 09. From `docs/baby_steps_tutorials`:

```bash
cp -R my_09_postgres_on_neon my_10_tenants
cd my_10_tenants
rm -rf node_modules
claude
```

Then paste:

```text
Use the build-baby-step skill in learner mode for step 10. Set up Neon as "Before you
build" says: a branch from step-09, and secrets only from a command into .env, never
through the chat. Check the design against §11, §12, §14, and §28, and against
migration 001, before any test. Red tests first, one commit per claim. Before each
break, ask me what I expect.
```

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

Before any code, checking the design against `001` found decision 8 wrong: running
every migration on every run breaks as soon as a second one changes the key. It became a
table of migrations that have run (decision 8 says why). The same check found that the
design never said whether an invoice object carries its company; decision 10 now says it
does.

_The rest is written after the review, with the result of every break in the table above._

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-TEN-01a | Every tenant-owned resource carries its `tenant_id` | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | `test/tenants.test.ts` (C6), `test/tenants.db.test.ts` (C6: `NOT NULL`, the key, the log's `tenant`) |
| DSOR-IDN-03a | Each request resolves to exactly one active tenant in which the subject holds a membership | [§12 Identity and principals](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/tenants.test.ts` (C1, C3) |
| DSOR-IDN-03b | An operation does not read or write across tenants | [§12 Identity and principals](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/tenants.test.ts` (C2), `test/tenants.db.test.ts` (C2). Reading only: no operation writes yet |
| DSOR-SRC-02b | A tenant or principal in the arguments that disagrees with the security context is refused | [§11 Source trust and the instruction boundary](../../../specs/dsor/02-security.md#11-source-trust-and-the-instruction-boundary) | `test/tenants.test.ts` (C4), the tenant half. The principal half is step 05's |
| DSOR-ERR-01b | An error does not reveal a resource the caller may not read | [§28 Result and error envelopes](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) | `test/tenants.test.ts` (C5, and C2's `INV-2001`), for other companies and their invoices |

Not met here, and why: DSOR-TEN-01b, whose second lock is step 11. DSOR-TEN-02a, whose
partitions come with each store. DSOR-TEN-02b, the suite of step 12.

## Next

Step 11 · Row-level security: the second lock. PostgreSQL itself filters every row by
company, so a query that forgets the company still cannot leak.
