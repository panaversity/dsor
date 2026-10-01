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

In this tutorial, every request names the company it works in, beside the login token:
`{ token, tenant: "org_456" }` (decision 1). DSoR checks, in its own records, that the
caller is a **member** of that company. That company is the request's **active
tenant**. Every operation reads only inside it, and only the caller's roles *in that
company* count.

Think of a good bank teller. Ask "does John Smith have an account here?", and the answer
is the same whether he does or not: "I can't discuss who our customers are." If a
stranger heard "no such customer" for a name the bank does not know, and "I can't tell
you" for a real customer, the choice of answer would give the customer away. DSoR
answers the same way about other companies. The analogy has a limit. A bank keeps its
customers apart with one set of rules. §14 asks for two independent checks, which it
calls two locks: DSoR's own, built here, and a second one inside the database, in step 11.

## Why it matters

**A leak between customers ends a product.** §14 says it in those words. If the agent of
`org_456` asks for `INV-1008` and the table cannot tell whose row is whose, it can get
`org_789`'s bill: another company's vendor, amount, and status.

**Authority leaks too, not only data.** An accounting firm runs one agent for many
client companies. §12's own example: "an accounting firm's one Accounts Payable FTE
serves many client organizations". The firm's agent may only read for one client and
issue invoices for another. If DSoR adds up its roles from every company, power granted
by one company is used inside another.

**A lock must not trust the code it guards.** *Changed by the Stage 2 review,
2026-10-01:* DSoR's lock, built here, and the database's lock, in step 11, both filtered
by the company that an operation's code asked for. So one line of code that asked for
another company was enough. In step 14, a fallback for an invoice that was not found,
`?? await invoices.get("org_456", id)`, let `user_700` of `org_789` read an invoice of
`org_456`, and every test passed. Decisions 13 and 14 close it.

**Common mistake:** §14 names it: "Telling the AI 'only look at org_456' and calling that
isolation. The agent is not a lock." A second mistake is close to it: taking the company
from the arguments. An argument is text the agent wrote.

## The design, before any code

This section was written before the first test, by the learner with Claude Code, before
any code existed. Every sentence of the specification it relies on was read on
2026-09-29: §11 (DSOR-SRC-01a, DSOR-SRC-02a, DSOR-SRC-02b), §12 (the principal, and the
*request security context*: who is calling, for whom, and in which company), §12's
DSOR-IDN-03a and DSOR-IDN-03b, §14 (DSOR-TEN-01a to 02b), §28 (DSOR-ERR-01b, and the
*retry class* of `TENANT_MISMATCH`, which tells a caller whether trying again can help:
"never"), and the audit record's
`tenant` in `audit-record.schema.json`. If the code finds the plan wrong, the plan
changes here first.

### The intent and the outcome

Written first, before the rules were split into claims.

**Intent.** One company never sees, touches, or learns about another company's data, and
never uses authority another company gave. The analogy is the bank teller.

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
   made before DSoR has checked a company has none. When a caller named a well-formed
   company it is not a member of, the record keeps that name, marked as a claim.
7. *Changed by the Stage 2 review, 2026-10-01:* an operation's code can read only the
   active company, and an answer that holds another company's row never leaves.

**Not the outcome of this step.** The second lock: PostgreSQL filtering rows by company
itself, row-level security (step 11). The suite that calls every operation with another
company's URI (step 12). Creating a company through an operation. Here no table holds a
company. The two companies exist as memberships in DSoR's table of logins, and as the
`tenant_id` on rows. *Changed by the Stage 2 review, 2026-10-01:* this said a migration
writes the companies. Migration `002` writes only `org_789`'s invoices.

**The success signals**, each a test that fails if this step's code is deleted:

- Same id, right company: `org_456` gets 31,400.00 USD for `INV-1008`, never
  `org_789`'s 99,000.00.
- A non-member is refused: `accounts-payable-fte` asking to work in `org_789` gets the
  same answer as asking for `org_999`, which does not exist.
- A foreign URI: `dsor://org_789/invoice/INV-1008` and `dsor://org_789/invoice/NOPE` get
  the same answer, word for word.

### What the specification asks, and what this step can honestly give

Checked on 2026-09-29:

1. **The map and DSOR-SRC-02b disagree about a foreign URI.** The map is the list of all
   steps, `../readme.md`. Its "Done when" line for this step says a foreign URI returns "the same 'not found' as a URI that does not exist". DSOR-SRC-02b says
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
4. **DSOR-TEN-02a asks for audit partitions keyed by tenant.** A partition is a separate
   part of a store, one for each company. Each audit record carries its tenant. Separate
   partitions, and the other stores that rule names, come with
   those stores.
5. **Step 02's open note** asked that whatever creates tenants never make an id out of a
   name (DSOR-RID-01b). Here no table holds a tenant: the two companies exist as
   memberships in DSoR's table of logins and as ids on rows, all fixed. No operation
   creates one yet, so the note stays open. (*Changed by the Stage 2 review, 2026-10-01:*
   this said the tenants are written by a migration.)
6. **`audit-record.schema.json` makes `tenant` required, on every record.** A refusal
   made before line ② has no company that DSoR has checked. Writing the company the
   caller *claimed* would put a stranger's record in another company's log. So this step
   leaves it empty (decision 6), and its records do not match the schema there. It is
   recorded as a question for the specification. The records do not claim to match the
   schema yet anyway: the chain of fingerprints that links each record to the one before
   it is step 39.
7. **§6's `invoice` entity is marked `tenant_scoped: true`, which says each invoice
   belongs to one company, but it lists no `tenant_id` field.** This
   step gives the invoice the field (decision 10). Whether the field is implied, or the
   list needs it, is a question for the specification.

### What each rule really says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-IDN-03a | **C1.** Each request resolves to exactly one active company, in which the caller holds a membership | A request with no company is refused. A company the caller does not belong to is refused, with the same answer as a company that does not exist. The firm's agent works in either company, one per request |
| DSOR-IDN-03b | **C2.** A read looks only inside the active company | `INV-1008` gives each company its own. `INV-2001`, which only `org_789` has, is "not found" for `org_456`, word for word as `INV-9999` |
| DSOR-IDN-03a, with DSOR-AUT-01b | **C3.** Only the roles in the active company count | The firm's agent issues in `org_789` and is denied `invoice.issue` in `org_456` |
| DSOR-SRC-02b | **C4.** A company in the arguments that is not the active one is refused with `TENANT_MISMATCH` | A `tenant`, `tenant_id`, `tenantId`, or `activeTenantId` field, and a URI, naming `org_789` from inside `org_456`. A field naming the active company is not refused for that |
| DSOR-ERR-01b | **C5.** A refusal never tells whether another company, or its invoice, exists | Pairs of answers compared word for word: `org_789` and `org_999`, `INV-1008` of `org_789` and `NOPE` of `org_789` |
| DSOR-TEN-01a | **C6.** Every invoice row and every audit record carries its company | `app.invoices.tenant_id` is `NOT NULL` and part of the key. `dsor.audit.tenant` is the active company, and empty only for a refusal before line ② has checked one |
| DSOR-IDN-03a | **C7.** An envelope carries exactly one company, and nothing DSoR does not read | An envelope with `tenant` and also `tenant_id`, or any other field besides `token`, `tenant`, and `request_id`, is refused with `VALIDATION_FAILED` (decision 11) |
| DSOR-IDN-03b for the reach, and decision 14 for the answer | **C8.** The operation's code can reach only the active company, and its answer must belong to it. Changed by the Stage 2 review, 2026-10-01 | The code gets the active company's invoices, never the store, and a second argument changes nothing (decision 13). An answer holding `org_789`'s row, in `org_456`, fails with `INTERNAL_ERROR`, recorded as `ALLOW` (decision 14) |

*Changed by the Stage 2 review, 2026-10-01:* C6's "empty only for a refusal before line
② has checked one" holds for every record this step's code writes. It does not hold for
the whole log on the branch `step-10`. The review counted 1,128 records from before
migration `002`, and 30 `ALLOW` records written while break U6 ran against the database,
all with no tenant. The log never changes a record, so they stay.

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

   *Changed by the Stage 2 review, 2026-10-01:* the form is now `org_` and 1 to 18 digits
   (decision 12).
3. *(Moved to the claims after the review.)* Counting only the active company's roles
   at line ⑤ is not ours to decide: DSOR-IDN-03a and §12 require it. It is claim C3. The
   number stays, so that references to it still point here.
4. **A company named in the arguments is checked at two places, both before "is it
   built".**
   - At line ②: the fields `tenant`, `tenant_id`, `tenantId`, and `activeTenantId`, at
     the top of the input and in its `correlation`, the same places step 05 checks for a
     principal. `tenantId` and `activeTenantId` are §12's own spellings. One that is not
     the active company is refused with `TENANT_MISMATCH`.
   - Right after line ⑥: every text in the checked copy of the input that starts with
     `dsor://`, in any mix of capital and small letters, must be a canonical URI of the
     active company, or it is refused with `TENANT_MISMATCH`. The whole input is
     searched, the names of its fields too, not only the fields a schema calls URIs, so a
     new operation cannot forget the check.
   *Downside:* a field whose whole text is another company's URI is refused, even when
   the caller meant it as a note. A URI inside a longer text, such as a sentence, is not
   looked at: only a text that starts with `dsor://` is read as a URI. And the list of
   field names is fixed: another spelling, such as `company`, is refused only by line ⑥,
   as `VALIDATION_FAILED`, because no input schema lists it.

   *Changed after the review, on 2026-09-29:* the first version knew only `tenant` and
   `tenant_id`, so §12's own spelling `tenantId` got `VALIDATION_FAILED`, which
   DSOR-SRC-02b does not allow.

   *Changed by the Stage 2 review, 2026-10-01:* the downside said that a free-text field
   that mentions another company's URI is refused too. Only a text that starts with
   `dsor://` is. And both checks now read line ①'s one copy of the input (step 07's
   decision 9, changed by the same review). Before, line ② read the input as it was
   sent. So a field that read `org_456` the first time and `org_789` the second passed
   line ②, and reached the code as `org_789`.
5. **Invoices move to a key of (company, id).** A new migration, `002`, adds
   `tenant_id` to `app.invoices`, fills it with `org_456` for the rows already there, and
   makes `(tenant_id, id)` the key. It adds `org_789`'s two invoices: `INV-1008` for
   99,000.00 USD from `VENDOR-77`, and `INV-2001`, which `org_456` does not have.
   Migration `001` is never edited: a migration that has run is history. *Downside:*
   `VENDOR-77` and the two new invoices are not in the specification's running example.
   They are this step's own.
6. **Each audit record carries its company, in a new column `tenant`.** It is empty
   when no company was checked: a refusal at line ①, such as "no login", or at line ②
   itself. `dsor_runtime` gets `INSERT` on that one column too. With `extensions` below,
   the list of privileges from step 09 grows by two words. **When line ② refuses a well-formed
   company the caller is not a member of, the record keeps the name the caller sent**,
   under `extensions`, as `{ "org.panaversity.steps": { "requested_tenant": "org_789" } }`.
   DSOR-SCH-02 says a field an implementation adds goes under `extensions`, keyed by a
   reverse domain name, and the audit schema has that field. The claim is never the
   record's `tenant`, so the record never lands in `org_789`'s part of the log. A
   malformed id is not kept: it is text the caller wrote, and it could be anything.
   Migration `003` adds the column. *Downside:* one more column, and a field that is this
   tutorial's own. A refusal at line ① keeps no claim.

   *Changed after the review, on 2026-09-29:* the first version kept nothing, so an
   agent trying `org_789`, `org_790`, and so on left records that did not say which
   companies it tried.

   *Changed by the Stage 2 review, 2026-10-01:* this said the list "grows by one word". It
   was written before migration `003` added `extensions`. And a claim now has a size: it
   is kept only when it is an id of at most 18 digits, and the column refuses more than
   1,024 bytes (decision 12).
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
    its row.** From this step, `INV-1008` is two invoices. So the id alone no longer
    names an invoice: the pair (company, id) does. Its canonical URI writes that pair
    down: `dsor://{tenant_id}/invoice/{id}` (DSOR-RID-01a). If the invoice in the code
    held only its id, code that holds it could not say whose it is. It would have to take
    the company from somewhere else, and mixing up an invoice's company is the very bug
    this step prevents. DSOR-TEN-01a says the resource carries its `tenant_id`. In DSoR's
    code, the invoice object is the resource; the database row is where it is kept.
    Showing the field to the caller tells it nothing new: it is the company the caller
    named. So `invoiceUri(invoice)` reads the invoice's
    own `tenant_id`, and step 01's constant `TENANT` goes. *Downside:* §6's `invoice`
    entity is `tenant_scoped`, but its list of fields has no `tenant_id`, so the answer
    has a field the entity does not list. Every test that compares a whole invoice
    changes.
11. **The request envelope is closed: `token`, `tenant`, and `request_id`, and nothing
    else.** Any other field is refused with `VALIDATION_FAILED` at line ①, after DSoR
    knows who is calling. An envelope with `tenant: "org_456"` and also
    `tenant_id: "org_789"` names two companies, so it has not resolved to exactly one
    (DSOR-IDN-03a). The list says what is allowed, not what is forbidden, so no spelling
    can slip past it: deny by default, as step 07 did for inputs. *Downside:* step 05's
    decision to ignore other envelope fields is reversed. Its test, "a principal written
    in the envelope is never used", now expects a refusal. Step 18 must add a delegation
    id to the list on purpose.

    *Added after the review, on 2026-09-29:* the envelope
    `{ token, tenant: "org_456", tenant_id: "org_789" }` worked in `org_456`, and the
    second company was ignored without a word.
12. **A company id has at most 18 digits, and the log refuses a large claim.**
    *Changed by the Stage 2 review, 2026-10-01:* step 02's form, `org_` and digits, set
    no length. A non-member's claim is kept whole under `extensions` (decision 6), and
    migration `003` put no limit on that column. In step 14, the review sent an envelope
    with `tenant: "org_"` and a million digits. The refusal the caller heard was 212
    bytes. The record it left was 1,000,433 bytes, and `dsor_runtime` can never remove it.
    §10.2 calls this threat T12, audit flooding: a caller fills the log with records it
    chose. Now a tenant id has 1 to 18 digits (`TENANT_ID` in `src/uri.ts`). Eighteen
    digits are enough for a billion billion companies. A million digits is a malformed id:
    refused with `VALIDATION_FAILED`, and never kept. And migration `003b` makes the
    database refuse an `extensions` larger than 1,024 bytes, in case the code ever keeps a
    large claim again. The largest claim the code can keep is 73 bytes. *Downside:*
    a company id of 19 or more digits cannot exist. Every field this tutorial adds under
    `extensions` must fit in 1,024 bytes, together. And the database checks new records
    only. `003b` does not read the records already kept (`NOT VALID`), because the log
    never changes a record, and a branch that already holds a large one would refuse the
    migration.
13. **The code of an operation gets one company's invoices, never the store.**
    *Changed by the Stage 2 review, 2026-10-01:* until then, the code held the whole
    store. `handlersFor(store)` built the operations with it, and the code named the
    company at each read: `invoices.get(tenant, id)`. So the lock trusted the company the
    code asked for ("Why it matters"). Now the registry holds the store, and
    `handlersFor()` takes none. At line ⑨, the pipeline gives the code a `Company` with
    two fields. `tenant` is the active company's id, for code that must name its company,
    such as in a URI. `invoices` has one function, `get(id)`, which takes an id and
    nothing more. `companyOf(store, tenant)` binds the store to the company, so every read
    is that company's, whatever the code passes. Both are frozen, so the code cannot swap
    them. The review's fallback line cannot be written: the type check refuses a second
    argument, and a second argument changes nothing when it runs ("Break it"). A registry
    built without a store reads no invoice: each read fails with `INTERNAL_ERROR`.
    *Downside:* a bigger change to the code's shape. Every operation's code takes a
    `Company`, and every test that builds a registry for real reads must give
    `buildRegistry` a store. And code that makes a store of its own can still name any
    company. Decision 14 catches what it returns.
14. **Every `tenant_id` in the code's answer must be the active company's.** *Changed by
    the Stage 2 review, 2026-10-01:* right after line ⑨, before anything else reads the
    answer, `checkAnswerInTenant` makes DSoR's own copy of it, through JSON text, as line
    ① does for the input (step 07's decision 9). It walks the copy to any depth, through
    objects and lists. A `tenant_id` that is not the active company's id is a bug in the
    code. The call fails with `INTERNAL_ERROR` and DSoR's fixed message for a bug, so
    nothing of the row leaks. Its record says `ALLOW` with result `INTERNAL_ERROR`: DSoR's
    checks let the call reach the code, and the code failed. Otherwise the caller gets the
    copy that was checked, never the code's own object. So a row the code changes after
    it returns, a field that reads differently the second time, or a `toJSON` cannot
    carry another company's row past the check. An answer that JSON cannot carry fails
    too. This is the second of three layers. The first is decision 13. The review's plan
    puts the third in step 12's suite. *Downside:* this trusts a field the code fills
    in. Code that rewrites `tenant_id` to the caller's company, or leaves it out, passes.
    Only `tenant_id` is read: a `tenant` or `tenantId` field, a URI, or a sentence that
    names another company passes. The third layer looks for the other company's data
    itself. And when a bug reads another company's row, the caller hears
    `INTERNAL_ERROR` where it would hear "not found", so the difference tells it that the
    id exists somewhere. A leak of a whole row becomes a leak of one fact.

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
  `dsor_runtime`'s privileges are step 09's list plus `tenant` and `extensions` in the
  `INSERT` columns, and none on `dsor.migrations`. (*Changed by the Stage 2 review,
  2026-10-01:* this said "plus `tenant`", written before migration `003`.)
- **C7:** `{ ...AGENT, tenant_id: "org_789" }` → `VALIDATION_FAILED`. So does any other
  extra field. A call with no login and an extra field hears about the login first.
- **C8**, *changed by the Stage 2 review, 2026-10-01:* the code is handed exactly
  `tenant` and `invoices`. `companyOf(store, "org_456")` finds no `INV-2001`, given one
  argument or two, in memory and in `app.invoices`. A planted operation that returns
  `org_789`'s row, or reads it through a store of its own, gets `INTERNAL_ERROR` in
  `org_456`, recorded as `ALLOW`, in memory and in the database. A row changed after it
  returns, a getter, and a `toJSON` reach the caller as they were checked, or fail. A
  registry built without a store reads no invoice. An envelope whose tenant reads
  differently the second time works in the company line ② read. The answer's tests are
  titled by decision 14, not by DSOR-IDN-03b: they show that nothing is disclosed, not
  that nothing is read.
- **Decision 6's claim:** the agent in `org_789` leaves a record with no `tenant` and
  `requested_tenant: "org_789"`. With `acme`, or with no login, the record keeps no claim.
- **Decision 8, not a rule:** a second `pnpm migrate` runs no file, and succeeds.
- **Decision 12**, *changed by the Stage 2 review, 2026-10-01:* a company of 19 digits,
  or a million, is `VALIDATION_FAILED`, and its record keeps no claim. 18 digits is still
  an id. `parseUri` refuses a URI whose company has 19 digits. As `dsor_runtime`, an
  `INSERT` with an `extensions` of 2 KB fails with `23514`, PostgreSQL's code for a
  broken `CHECK`.
- **Step 07's decision 9**, *changed by the Stage 2 review, 2026-10-01:* a `principal`
  or a `tenant_id` that reads differently the second time reaches the code exactly as
  the checks saw it, or is refused.

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

Step 09 set up `.env` by hand. The real rule is: **a secret never passes through a
chat.** Neon's MCP server returns a connection string with the owner's password inside,
so anything it fetches lands in the transcript. Step 09 found this in a real run. A command whose output goes
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

Doing it by hand is the same, with you carrying the text from Neon's console into the
file. Either way, never
paste the file, and never ask for a connection string.

## What changed since step 09

| File | What changed |
| --- | --- |
| `src/tenants.ts` | **New.** Line ②: `activeTenant` checks the envelope's company against the caller's memberships. `checkNamedTenants` refuses another company in the arguments' fields. `checkUrisInTenant` refuses a URI outside the company, anywhere in the checked input |
| `src/company.ts` | **New, after the Stage 2 review.** `companyOf` binds the store to the active company, and `checkAnswerInTenant` checks every `tenant_id` in the code's answer (decisions 13 and 14) |
| `src/pipeline.ts` | Line ② runs right after line ①. The URI check runs right after line ⑥. The code, line ⑤, and the record all get the active company. Since the Stage 2 review: line ① makes the one copy of the input, the code gets `companyOf(store, tenant)`, and its answer is checked right after line ⑨ |
| `src/inputs.ts` | Since the Stage 2 review: `jsonCopy` makes line ①'s copy, and `checkInput` checks it without making another (step 07's decision 9) |
| `src/permissions.ts` | `permissionsOf` and `checkPermission` take the company. Step 06's constant `COMPANY` is gone |
| `src/invoice.ts` | An invoice carries its `tenant_id`, and `invoiceUri` reads it. Step 01's constant `TENANT` is gone. `org_789`'s two invoices, in memory. Since the Stage 2 review: `NO_STORE`, for a registry built without a store |
| `src/principals.ts` | `firm-ap-fte`, in two companies with a different role in each, and `user_700` |
| `src/postgres.ts` | The invoice query filters by `tenant_id`. The log writes and reads `tenant` and `extensions` |
| `src/log.ts`, `src/registry.ts`, `src/operations.ts` | A decision has an optional `tenant`, and a non-member's claimed company under `extensions`. The code of an operation is given the company. Since the Stage 2 review, that is a `Company`: the active company's invoices only. The registry holds the store, and `handlersFor()` takes none (decision 13) |
| `src/request.ts`, `src/uri.ts` | The envelope has a `tenant`, and is closed: `checkEnvelopeFields` (decision 11). `isTenantId` checks step 02's form, with at most 18 digits since the Stage 2 review (decision 12) |
| `src/migrate.ts` | Runs each file in `migrations/` once, and remembers it in `dsor.migrations` (decision 8) |
| `migrations/002_tenants.sql` | **New.** `tenant_id` on invoices, the key (company, id), `org_789`'s invoices, `tenant` on the log, and one more `INSERT` column for `dsor_runtime` |
| `migrations/003_claimed_tenant.sql` | **New, after the review.** `extensions` on the log, and `INSERT` on it for `dsor_runtime` (decision 6) |
| `migrations/003b_bounded_claims.sql` | **New, after the Stage 2 review.** The log refuses an `extensions` larger than 1,024 bytes (decision 12) |
| `src/main.ts` | Four more calls: the firm's agent in each company, a stranger to `org_789`, a foreign URI. Each log line ends with its company. Since the Stage 2 review, the registry is given the database's store |
| `test/tenants.test.ts`, `test/tenants.db.test.ts` | **New.** C1 to C8, and decisions 6, 8, and 12 |
| `test/company.test.ts` | **New, after the Stage 2 review.** C8: the store bound to one company, and the check of the answer |
| `vitest.db.config.ts` | Database test files run one at a time (see "Think it through") |
| every other test | Every envelope names `org_456`. Invoices and records carry their company. Line ② is in the expected order. Step 05's and step 06's envelope tests now expect a refusal (decision 11). Since the Stage 2 review: a registry whose code reads invoices is given a store, and the code is handed a `Company` |

Both tenant columns also refuse any text that is not `org_` and digits, a database
`CHECK`. That is this tutorial's decision, from step 02's form. Their form sets no
length. Since the Stage 2 review, the code's form allows at most 18 digits (decision 12).
No new dependency.

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

`pnpm migrate` on the branch `step-10`, made from `step-09`, on 2026-09-29, as the step
was built. The first run of the new runner found no table of migrations, so it ran
`001` again, once; it could, because `002` was not there yet. Then `002`, and after the
review `003`. Then nothing. And on 2026-10-01, after the Stage 2 review, `003b`:

```text
dsor_runtime: password set again from DSOR_DB_URL
migration 001_audit_and_invoices: done

dsor_runtime: password set again from DSOR_DB_URL
migration 002_tenants: done

dsor_runtime: password set again from DSOR_DB_URL
migration 003_claimed_tenant: done

dsor_runtime: password set again from DSOR_DB_URL
no migration to run

dsor_runtime: password set again from DSOR_DB_URL
migration 003b_bounded_claims: done
```

On your own branch made from `step-09`, one `pnpm migrate` prints all four
`migration … done` lines at once. `003b` comes after `003_`, because `_` sorts before
`b`. `pnpm check` prints `628 passed` here, inside the repository. Outside it, three
tests that compare the schemas with the repository's originals are skipped:
`625 passed | 3 skipped`. `pnpm test:db` prints `45 passed`.

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
no company was ever checked. Since the review, record 1399's kind of record also keeps
`org_789` under `extensions`, as the company the agent asked for (decision 6). The line
printed here shows only its tenant.

## Break it

Every break of the design's table, performed on 2026-09-29, one at a time, then put
back, on the code as it stood before the review (commit `34d356e`). The unit tests ran
for all six, the database tests for U1 and U6.

| # | The break | Learner's prediction | Caught by, for real |
| --- | --- | --- | --- |
| U1 | The invoice query drops `tenant_id = $1` | INV-1008 and INV-2001, every time | 4 database tests, **0 unit tests**. `org_456`'s INV-1008 test passed |
| U2 | Line ⑤ adds up the roles from every membership | only the firm-agent test | 7: three firm tests, and **step 06's four membership tests** |
| U3 | A `tenant` in the arguments is used as the active company | C4 | 6: five of C4, one of C6 |
| U4 | The URI check runs after "is it built" | C4's `invoice.issue` test | 2: that test, and `dsor://acme/…` |
| U5 | "No such company" gets its own message | C5 only | 2: C5, and **C1's `org_999` test** |
| U6 | The audit record's tenant is left empty | not asked | 12 unit tests, 2 database tests |

U1 and U5 below were run again after the Stage 2 review, on 2026-10-01, on the code as
it stands now. The table keeps the first run's counts.

**U1**, the one to try yourself. In `src/postgres.ts`, change the invoice query to
`WHERE id = $1` with `[id]`. Then:

```text
$ pnpm typecheck
src/postgres.ts(149,17): error TS6133: 'tenant' is declared but its value is never read.

$ pnpm test
      Tests  628 passed (628)

$ pnpm test:db
    × starts, reads INV-1008 through invoice.get, and prints every answer as an envelope
    × DSOR-EXE-02: prints one record for each of its twelve calls, in order
    × DSOR-IDN-03b: org_789 reads INV-1008 from app.invoices: 99,000.00 USD
    × DSOR-IDN-03b: org_456 reading INV-2001 hears the same as for INV-9999
    × DSOR-IDN-03b: the store finds an invoice by company and id together
    × DSOR-IDN-03b: the store the code gets reads only its own company in app.invoices, whatever it is given
      Tests  6 failed | 39 passed (45)
```

The type check sees that `tenant` is no longer used, so `pnpm check` stops there. (The
first run's text showed `pnpm check` green. With this break, it is `pnpm test` that
stays green.) The unit tests read the invoices in memory, which never met the broken
query. Only a test against the real table sees a bug in the real query. `org_456`'s own
INV-1008 test stays green. Both rows answer to `INV-1008`, and the code takes the first
row. Without `ORDER BY`, PostgreSQL promises no order; in both runs the first row was
`org_456`'s. In the first run, `org_789` got `org_456`'s 31,400.00 USD. That is the leak
§14 warns about. Now the answer check of decision 14 sees `org_456`'s `tenant_id` in an
answer for `org_789`, and the call fails with `INTERNAL_ERROR`. The bug still breaks the
call, and only the database tests see it, but nothing leaks. Step 11's second lock is
for this very bug.

**U5.** In `activeTenant`, answer `"no such tenant"` for a company outside a list of
known ones:

```text
    × DSOR-IDN-03a: a company of 18 digits is still an id, and the agent is no member of it
    × DSOR-IDN-03a: the agent asking to work in org_999, which does not exist, is denied
    × DSOR-ERR-01b: org_789 and org_999 get the same refusal, word for word
      Tests  3 failed | 625 passed (628)
```

The 18-digit test of decision 12 catches it too: that company does not exist either.

**The Stage 2 review's break.** In `src/operations.ts`, give `invoice.get` the review's
fallback: when an invoice is not found, ask another company.

```ts
const invoice = (await company.invoices.get(id)) ?? (await company.invoices.get("org_789", id));
```

```text
$ pnpm typecheck
src/operations.ts(23,98): error TS2554: Expected 1 arguments, but got 2.

$ pnpm test
      Tests  628 passed (628)
```

The store the code holds takes an id and nothing more, so the type check refuses the
line. Run anyway, the line asks the active company twice. Nothing leaks, so every test
passes. Now write the fallback with a store of its own,
`memoryInvoices().get("org_789", id)`. The type check passes, and the answer check
catches it: `org_456` asking for `INV-2001` hears `INTERNAL_ERROR`, not `org_789`'s
invoice. Two tests fail, the two that ask for `INV-2001` from `org_456`. Put the line
back, and `pnpm check` is green again.

## Build it yourself with Claude Code

This is how the step was built:

| # | Move | What you do |
|---|---|---|
| 1 | Design first | "In plain words", "Why it matters", "The design, before any code", before the setup |
| 2 | Neon | A branch `step-10` from `step-09`, `.env` written by a command, never shown ("Before you build") |
| 3 | Check the design | Against §11, §12, §14, §28, the audit schema, **and migration `001`**. Two gaps found: decisions 8 and 10 |
| 4 | Mechanical | Every existing envelope names `org_456`. Nothing checks it yet, so every test stays green |
| 5 | Red | `tenants.test.ts`, `tenants.db.test.ts`, and the old expectations that change. Predict how many pass |
| 6 | Green | One commit per claim: the table of migrations, `002`, then C1, C2, C3, C4 (C5 came with it), C6 |
| 7 | Break it | U1 to U6, for real. Compare with your predictions |
| 8 | Review | Two reviewers who have not seen your conversation attack the step: one checks each rule, one breaks the code in 64 small ways |
| 9 | Fix the review | Change the design first (decisions 4, 6, 11), then the tests that kill the surviving breaks, then red tests, then the code |

In the red run, the learner predicted about 10 of 51 new tests would pass, and 10 did.
Each of them expects "the same" or "nothing": the same answer for two companies, no
company on a record, "not built yet" for the company's own URI. With no code that tells
companies apart, "the same" is true with no code at all. Such a test proves something
only beside the code it guards. The review found two of them still proved nothing after
the code existed (see "Think it through").

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
5. So that one bug is not enough to leak another company's data. From step 11, if a
   query in DSoR's code forgets the company, the database will filter by it too. Break
   U1 is that bug, and in this step only the database tests catch it.

</details>

## Think it through

Before any code, checking the design against `001` found decision 8 wrong: running
every migration on every run breaks as soon as a second one changes the key. It became a
table of migrations that have run (decision 8 says why). The same check found that the
design never said whether an invoice object carries its company; decision 10 now says it
does.

The breaks, against the learner's predictions ("Break it" has the table). Three of six
were right. U1: `org_456`'s own INV-1008 test did not catch it; the INV-2001 test and
`org_789`'s did, and no unit test did. U2 and U5: each was caught by more tests than
predicted, because an older test (step 06's memberships) or an exact message (C1's
`org_999`) guards the same line.

Two things the build found, before the review:

- **The C2 commit broke three step 07 tests**, and was committed because only the new
  file was run. They pinned what the code is called with, and the code now also gets
  the company. A separate commit fixed them. Run the whole suite before every commit.
- **`pnpm migrate` while the program runs can make a new login fail.** The migrate test
  sets `dsor_runtime`'s password again, and a test in another file, opening a login at
  that moment, got "password authentication failed for user dsor_runtime". The database
  test files now run one at a time. In a real system, `pnpm migrate` would stop setting
  the password when it already works. That is left open.

**What the review found, and what was done.** Two reviewers who had not seen the
conversation: one checked each rule against the code and attacked with §10.2's
cross-tenant threats, one made 64 small breaks in a copy. Neither found a way to read
another company's data, use its authority, or put a record in its part of the log.

1. **DSOR-SRC-02b missed §12's own spelling, `tenantId`.** Fixed: four spellings
   (decision 4). Any other spelling is still refused, but by line ⑥.
2. **An envelope naming two companies worked, and ignored the second.** Fixed: the
   envelope is closed (decision 11, claim C7). This reverses part of step 05.
3. **Probing left no trace of which company was tried.** Fixed: the claim is kept under
   `extensions` (decision 6, migration `003`).
4. **Seven breaks survived every test**, and tests were added that catch each: the URI
   check reading the input again instead of line ⑥'s copy (since the Stage 2 review,
   line ①'s copy, which line ⑥ checks); the argument check using the
   caller's first company instead of the active one; field names not searched; long
   texts skipped; `dsor:` instead of `dsor://`; a store matching only the start of a
   company's id; and the C5 tests, which passed with the check they guard deleted,
   because "the same" stays true when both answers change.
5. **Decision 3 was the rule, not our choice.** It moved to the claims.
6. **The prose.** The hotel desk became the bank teller: the house list already uses a
   hotel for "booking the last room". Terms are defined where they first appear, and
   idioms are gone.

**Found by the Stage 2 review (2026-10-01), and fixed.** Six reviewers audited steps 10
to 14 and the seams between them (`../mj_notes.md`). They found no live leak, and one
high finding, here.

- **A check and the code could see two different inputs.** Fixed from step 07 on. Lines
  ① and ② read the input itself, to check the principals and the companies it names.
  Line ⑥ then made its own copy, for the schema check and for the code. A getter, a field
  that runs code each time it is read, can answer the second read differently. The red
  tests plant an input schema that lists `principal` and `tenant_id`. The code was handed
  `principal: "cfo_100"` after line ① saw the caller, and `tenant_id: "org_789"` after
  line ② saw `org_456`.
  - **Fixed:** line ① makes the one copy, right after it finds who is calling. Line ①'s
    principal check, line ②'s company check, line ⑥, the URI check, and the code all read
    it (step 07's decision 9). An input that JSON cannot copy is still refused with
    `VALIDATION_FAILED`. Before that, line ① checks the principals it names and line ②
    the companies it names, on the input as sent. So `cfo_100` inside it is
    `AUTHORIZATION_DENIED`, and `org_789` is `TENANT_MISMATCH`. One difference from step
    07: there, the refusal comes at line ①. Here it comes at the end of line ②, which
    must first find the active company.
  - **Caught by** `DSOR-SRC-02b: a principal that reads as the caller first, then as
    cfo_100, …` and `DSOR-SRC-02b: a tenant_id that reads as org_456 first, then as
    org_789, …` in `test/pipeline.test.ts`. Beside them: the opposite cases, a count of
    every read of the input, and nine inputs that JSON cannot copy. In
    `test/who-is-calling.test.ts`, with no login, the input is not read at all.
  - **Broken on purpose, nine ways:** line ① or line ② reading the input itself, the code
    given the input itself, the URI check reading it again, line ⑥ copying again, and the
    copy made before the login. And, when the copy fails: the companies left unchecked,
    the call let through, or the active company refused too. Each turned at least one of
    these tests red.
  - **A hostile pass on the fix** found three more breaks that every test let through,
    and a test now catches each: refusing an input that JSON cannot copy before the
    membership check, and two ways of mistaking "JSON leaves this out" for "JSON cannot
    copy this". A stranger to `org_789` now hears that it is no member first, and an input
    of nothing at all, or a function, is refused by line ⑥ as "must be object".
- **A company id had no length, and the log kept a claim of any size.** In step 14, an
  envelope naming `org_` and a million digits got a refusal of 212 bytes, and left a
  record of 1,000,433 bytes. Here, in the red run, 19 digits and a million digits were
  refused as `AUTHORIZATION_DENIED`, and the record kept the claim. `parseUri` took a
  company of 19 digits. As `dsor_runtime`, an `INSERT` with an `extensions` of 2 KB went
  in.
  - **Fixed:** a tenant id has 1 to 18 digits, and migration `003b` refuses an
    `extensions` over 1,024 bytes (decision 12). With the migration run and the code not
    yet changed, the million-digit call already failed closed:
    `EVIDENCE_STORE_UNAVAILABLE`, and no record.
  - **Caught by** the 19-digit and million-digit cases of C1, and the tests titled `step
    10's decision 12: …`, in `test/tenants.test.ts`, `test/uri.test.ts`, and
    `test/tenants.db.test.ts`.
  - **Broken on purpose:** with no limit, 4 tests fail. With a limit of 17 digits, the 2
    tests of an 18-digit id fail. A hostile pass on the fix noted that 2 KB alone would
    let a limit of 4,096 bytes pass. A test now measures the edge: 1,024 bytes is kept,
    and 1,025 is refused by `audit_extensions_size`, the CHECK's name. That break was not
    run: the limit lives in the database, and a break must not change Neon.
- **The code could name another company.** The high finding. The lock filtered by the
  company the code asked for, and step 11's lock does the same ("Why it matters"). Here,
  in the red run, the code was handed a bare company id, and an answer holding
  `org_789`'s row reached a caller in `org_456`, in memory and in `app.invoices`.
  - **Fixed, in two layers:** the code gets one company's invoices, never the store
    (decision 13). Every `tenant_id` in its answer must be the active company's
    (decision 14). The third layer, in the review's plan, is step 12's suite.
  - **Caught by** C8, in `test/company.test.ts`, `test/tenants.test.ts`, and
    `test/tenants.db.test.ts`.
  - **Broken on purpose, eight ways:** the review's fallback, written against the store
    the code holds, fails the type check, and leaks nothing when run anyway ("Break it").
    Written with a store of its own, the answer check catches it. And each of these
    turned a test red: the store passing a second argument through, no freeze, the
    answer check deleted, reading only the top of the answer, reading only text, and the
    code given the caller's first company. Break U1, run again, now ends in
    `INTERNAL_ERROR` instead of `org_456`'s invoice.
  - **A hostile pass on the fix** found that the answer check read the code's live
    answer, and the caller got that same object. A row the code changed 5 ms after
    returning it, while the log took 20 ms, reached the caller as `org_789`'s `VENDOR-77`
    and 99,000.00. A getter and a `toJSON` did the same. Now the check makes DSoR's own
    copy, and the caller gets that copy (decision 14). The pass also found that nothing
    tested that the code's company comes from line ②. Reading the envelope's tenant again
    for the store passed every test, and an envelope whose tenant read `org_456` first
    and `org_789` after then read `org_789`'s `INV-2001`. It found that a check of the
    company's visible keys missed a hidden store, and that the answer's tests claimed
    DSOR-IDN-03b, which forbids reading, while they only show that nothing is disclosed.
    Each has a test or a new title now. Four more breaks, each caught: the live answer
    sent, the tenant read again, a hidden store, and the store behind `invoices`.
- **Sentences that said more than the code.** The URI check refuses only a text that
  starts with `dsor://`, not one that mentions a URI (decision 4). No table holds a
  company. "Grows by one word" and "plus `tenant`" were written before `extensions`. C6
  holds for the records this code writes, not for the whole branch (below the claims).
  A comment in `test/program.db.test.ts` called itself the only test that touches the
  owner's key, but the migrate test runs `migrate.ts` too.

- **The start-up check's facts were proven only with facts made by hand.** Fixed from
  step 09 on. The check refuses a login that holds `BYPASSRLS`, belongs to
  `pg_write_all_data`, or owns tables. Only `test/runtime-role.test.ts` proved those
  refusals, and it hands `problemsOf` facts written in the test. With the SQL in
  `runtimeRoleProblems` changed to read any one of the three as false, every test passed.
  - **Fixed:** the test that starts the program as the owner now requires all three, as
    `problemsOf` words them: `holds BYPASSRLS`, `is a member of pg_write_all_data`, and
    `owns … tables`. On Neon the owner holds each one, so the real database proves each
    fact.
  - **Caught by** `DSOR-AUD-04a: refuses to run as the owner, names why, and makes no
    call`, in `test/program.db.test.ts`. Each of the three changes to the SQL turns it
    red. Found by a hostile pass on the Stage 2 review's fix in step 11.

**Left open, on purpose:**

- **The subject, not the caller.** DSOR-IDN-03a says the *subject* holds the membership.
  Until delegations (step 18), the subject is the caller. Then line ② must check the
  subject.
- **Only DSoR's code keeps companies apart.** Break U1 shows one query is enough to break
  a call. Since the Stage 2 review, the answer check turns it into `INTERNAL_ERROR`
  instead of a leak, but only because the row carries its `tenant_id`. Step 11 adds the
  database's own check.
- **The third layer.** An answer with `tenant_id` rewritten to the caller's company
  passes decision 14, and so does another company's name in a `tenant` field, a URI, or a
  sentence. The Stage 2 review's plan closes it in step 12's suite, which is to look for
  the other company's data itself.
- **A refusal the operation's code throws is not checked.** Its message could name
  another company's data. The review's plan has step 12's suite check an operation's own
  "not found".
- **`reason` has no size limit in the database.** The code keeps every refusal message
  short, and the largest record a hostile pass could make was 480 bytes. Only
  `extensions` has a limit of its own (decision 12).
- **`src/pipeline.ts` is 228 lines**, past this tutorial's guide of about 150, and
  `src/registry.ts` is 161. The Stage 2 review's fixes added 34 and 12, most of it
  comments. Splitting them is a step of its own.
- **Analogies to add to the house list, or to change:** "tenants of one building" and
  the bank teller who does not say who banks there. "Lock" here is §14's own word for
  one independent check, not the list's "lock that stays locked when the power fails".
- **Questions for the specification:** the map's "same 'not found'" against
  DSOR-SRC-02b's `TENANT_MISMATCH`; a refusal before line ② has no tenant, but the audit
  schema requires one; §6's `invoice` lists no `tenant_id`.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-TEN-01a | Every tenant-owned resource carries its `tenant_id` | [§14 Multi-tenancy](../../../specs/dsor/02-security.md#14-multi-tenancy) | `test/tenants.test.ts` (C6), `test/tenants.db.test.ts` (C6: `NOT NULL`, the key, the log's `tenant`) |
| DSOR-IDN-03a | Each request resolves to exactly one active tenant in which the subject holds a membership | [§12 Identity and principals](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/tenants.test.ts` (C1, C3, C7). Until step 18, the subject is the caller |
| DSOR-IDN-03b | An operation does not read or write across tenants | [§12 Identity and principals](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/tenants.test.ts` (C2, C8), `test/company.test.ts` (C8), `test/tenants.db.test.ts` (C2, C8). Reading only: no operation writes yet |
| DSOR-SRC-02b | A tenant or principal in the arguments that disagrees with the security context is refused | [§11 Source trust and the instruction boundary](../../../specs/dsor/02-security.md#11-source-trust-and-the-instruction-boundary) | `test/tenants.test.ts` (C4), the tenant half: `tenant`, `tenant_id`, `tenantId`, `activeTenantId`, and URIs. Any other spelling is refused by line ⑥ as `VALIDATION_FAILED`. The principal half is step 05's. `test/pipeline.test.ts`: a field that reads differently the second time, and an input that JSON cannot copy (step 07's decision 9) |
| DSOR-ERR-01b | An error does not reveal a resource the caller may not read | [§28 Result and error envelopes](../../../specs/dsor/03-execution.md#28-result-and-error-envelopes) | `test/tenants.test.ts` (C5, and C2's `INV-2001`), for other companies and their invoices |

Not met here, and why: DSOR-TEN-01b, whose second lock is step 11. DSOR-TEN-02a, whose
partitions come with each store. DSOR-TEN-02b, the suite of step 12.

## Next

Step 11 · Row-level security: the second lock. PostgreSQL itself filters every row by
company, so a query that forgets the company still cannot leak.
