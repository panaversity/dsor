# Step 10 · Tenants

**New in this step:** a second company shares the program and the database, and every request
works inside exactly one company — decided from who is logged in, never from the address.

## In plain words

Until now this program served one company, `org_456`, and said so with a constant. Every person
belonged to it, every invoice was assumed to be its, every audit record joined one chain named after
it.

A **tenant** is one company's share of a system that many companies use. This step adds a second
one, `org_789`, and makes four things true at once:

- **Every row says whose it is.** The invoices moved into PostgreSQL, and every row carries a
  `tenant_id`. The key is the company *and* the invoice number, because `org_456` and `org_789` both
  have an `INV-1008` and they are different invoices.
- **Every request is inside one company**, decided at §21 step 2 from the caller's memberships. One
  membership, and it is implied. Two — the agent `accounts-payable-fte` now works for both companies
  — and the login has to say which, and it has to be one of theirs.
- **An address for another company is refused, and the refusal says nothing.** The same words
  whether that company exists or not, nothing about which company you are in, decided before any
  lookup so it cannot say whether the invoice exists either.
- **Each company has its own audit chain.** Nothing in `org_789`'s log ever links to `org_456`'s.

What this step does **not** do is make PostgreSQL enforce any of it. The database still answers
any query the program sends; the program is what filters. That is one lock. Step 11 adds the second,
row-level security, so a buggy query still cannot leak.

## Why it matters

Measured on step 09, the day before this step, by asking it for another company's invoice:

```text
user_123 asks for another company's invoice:
   TENANT_MISMATCH   "dsor://org_789/invoice/INV-1008 is for org_789, and this program serves org_456"
the store, asked for INV-1008 with no company at all:
   getInvoice('INV-1008') -> org_456's invoice        (no tenant parameter exists)
```

Two failures hide in those lines, and a third behind them. The store had no idea of company: the
day `org_789` had an `INV-1008` too, `getInvoice("INV-1008")` would return whichever row came first
— a leak between customers, which §14 calls the kind of bug that ends a product. The refusal told a
stranger which company this is. And the only "tenant check" there was compared the address against a
constant, which means the company came from the address — an argument, which is data, which the
specification says can never decide who you are or where you belong.

## What changed since step 09

```bash
git diff --no-index ../my_09_postgres_on_neon ../my_10_tenants
```

| File | What |
| --- | --- |
| `src/tenant.ts` | the constant is gone. The companies this program serves, and `tenantFor`: which one THIS request is for |
| `src/people.ts` | `org_789` exists, and the agent belongs to both companies |
| `src/login.ts` | a login may name a company. `tenantClaimed` reads it as data, like `loggedInAs` |
| `src/pipeline.ts` | `Context.tenant`, and "resolve the tenant" is required by name, right after "authenticate" |
| `src/operations.ts` | the new stage at §21.2; the address check moved into §21.6; a refusal with no company is recorded in every company the caller belongs to; handlers are async |
| `migrations/003_invoices.sql` | new — the table, keyed `(tenant_id, id)`, with `UPDATE` granted on `status` alone |
| `migrations/004_running_example.sql` | new — the story as rows, including `org_789`'s `INV-1008` |
| `src/invoice.ts` | SQL now, and every function takes the company first |
| `src/store.ts` | new — the one database handle, shared by both stores |
| `src/audit.ts` | one chain per company; `theLog`, `theHead` and `forgetTheLog` take the company; no company is named in its code |
| `src/envelopes.ts` | a proposal address names the command's company |
| `src/database.ts` | the start-up check also refuses an application that may move, renumber, add or delete invoices |
| `src/main.ts` | the two-companies section, one log printed per company, and the planted-principal line is a refusal now |
| `test/support/database.ts` | `resetInvoices`, as the owner, from 004 |
| `test/tenant.test.ts`, `test/cross-tenant.test.ts`, `test/invoices-in-postgres.test.ts`, `test/audit-per-tenant.test.ts` | new |

325 tests became 373. One test from step 09 changed its example (Break 5 says why), and two of
step 05's changed their answer (the rules section says why).

## Run it

```bash
pnpm install
pnpm start
```

The part that is this step:

```text
Two companies, one program:

accounts-payable-fte  (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued
accounts-payable-fte  (no envelope)            dsor://org_789/invoice/INV-1008  18000.00 USD  draft

agent, company unsaid      accounts-payable-fte  TENANT_MISMATCH   retry: never   you belong to more than one company; say which one this request is for
their address, real        user_123              TENANT_MISMATCH   retry: never   dsor://org_789/invoice/INV-1008 is not an address in your company
their address, no such co  user_123              TENANT_MISMATCH   retry: never   dsor://org_000/invoice/INV-1008 is not an address in your company
login names their company  user_123              TENANT_MISMATCH   retry: never   org_789 is not a company you belong to

The audit log of org_456:

 0  ALLOW  invoice.get@1        user_123               ALLOWED                 sha256:8987d94...
 …
10  ALLOW  invoice.get@1        accounts-payable-fte   ALLOWED                 sha256:6f3fdd5...
11  DENY   (none resolved)      accounts-payable-fte   TENANT_MISMATCH         sha256:c385e34...
12  DENY   invoice.get@1        user_123               TENANT_MISMATCH         sha256:f28be66...
13  DENY   invoice.get@1        user_123               TENANT_MISMATCH         sha256:fc52f83...
14  DENY   (none resolved)      user_123               TENANT_MISMATCH         sha256:55046d5...
org_456: 15 records, chain verifies against the head: true

The audit log of org_789:

 0  ALLOW  invoice.get@1        accounts-payable-fte   ALLOWED                 sha256:4a2dd56...
 1  DENY   (none resolved)      accounts-payable-fte   TENANT_MISMATCH         sha256:8fe61e7...
org_789: 2 records, chain verifies against the head: true
```

Read the first two lines together: the same agent, the same invoice number, two different invoices,
and the only thing that changed between the lines is which company the agent said it was working
for. Read the four refusals: `org_789` is real and `org_000` is not, and the two answers are the
same words. Read `(none resolved)` on records 11 and 14: a request refused at §21.2 was refused before the
operation was even looked up, so the record truthfully has no operation in it — the words are the
printer's, not the record's; the record simply has no `operation` field. And read
`org_789`'s log: the agent's request that never said which employer is there too, because both
employers should know — and nothing of `user_123`'s or the CFO's is, because they are not members.

Run it again:

```text
accounts-payable-fte  CONFLICT   retry: never   INV-1009 is issued, and only a draft invoice can be issued
org_456: 30 records, chain verifies against the head: true
org_789: 4 records, chain verifies against the head: true
```

The invoices are durable now too. Step 09's list died with the process, so every run issued
`INV-1009` afresh; this run finds it issued.

### The database tier

`pnpm check` needs no server: 373 tests on PostgreSQL compiled to WebAssembly, in-process. The nine
tests in `pnpm test:db` need two real logins, and this step needs a database of its own — the
migrations are checksummed, and step 09's database has applied two of them while this step has four.
Copy step 09's `.env` and change the database name in both URLs:

```bash
cp ../my_09_postgres_on_neon/.env .env     # then dsor_step09 -> dsor_step10 in both lines
pnpm migrate && pnpm test:db
```

## Break it

Eight, measured on the full suite after the hostile review. Two of them are not counts, and that
is the lesson of each.

### Break 1 · leave the stage out of the list

In `src/operations.ts`, delete the line `stage(2, "resolve the tenant", "both", resolveTheTenant),`.

```text
TypeError: the pipeline runs resolve the operation where resolve the tenant belongs: the order must
be authenticate then resolve the tenant then resolve the operation then authorize then validate the
input then record the decision
```

Not a failing test — the program refuses to **load**. `assertPipeline` requires the stage by name, so
`pnpm start` stops before it has opened a database, and `pnpm check` reports `9 failed | 199 passed
(208)`: the total shrinks, because every file that imports `operations.ts` dies at import. A
shrinking total is the tell that the guard fired at load, not that a test caught something.

### Break 2 · accept any company the login names

In `src/tenant.ts`, make `tenantFor` return `{ tenant: claim.tenant }` for any named claim.

```text
 Tests  6 failed | 367 passed (373)
```

`user_123` naming `org_789` is now inside `org_789`, and reads its invoice.

### Break 3 · let the store ignore the company

In `src/invoice.ts`, change `getInvoice`'s query to `WHERE id = $1 ORDER BY tenant_id LIMIT 1`
and its parameters to `[id]`.

```text
 Tests  6 failed | 367 passed (373)
```

This is step 09's store, the day a second company exists: `INV-1008` is whichever row sorts first.
Only six tests stand between that leak and green — the ones that ask for org_789's invoice and
check which one came back. The first version of this exercise dropped the `tenant_id` clause but
left `$1` in the parameters, which PostgreSQL refuses as a SQL error: sixty-seven failures that
proved nothing about the leak. A reviewer measured it.

### Break 4 · one audit chain for everyone again

In `src/audit.ts`, make `chainOf` return `` `audit:org_456` `` whatever the company.

```text
 Tests  14 failed | 359 passed (373)
```

### Break 5 · let validate forget the address

In `src/operations.ts`, in `validateTheInput`, change `if (address.tenant !== context.tenant)` to
`if (false)`.

```text
 Tests  14 failed | 359 passed (373)
```

Fourteen, not one, and the reason is worth the paragraph. The address check first lived in the
handler, at §21.14 — and §21.14 runs *after* the decision is recorded at §21.11. So a request refused
for another company's address sat in the log as `ALLOWED` while the caller held a refusal: the log
and the answer disagreeing, which is the one thing a decision record exists to prevent. The audit
tests for this step caught it. The check moved to §21.6, where facts about the arguments are
decided, and a test from step 09 — "a call that fails while executing is recorded as the ALLOW it
was" — lost that example, because it is no longer one.

### Break 6 · remove the handler's re-check

In `src/operations.ts`, in `invoiceIdFrom`, change `if (parsed.tenant !== tenant)` to `if (false)`.

```text
 Tests  1 failed | 372 passed (373)
```

One test, and it is the only one that can reach this line: a door built with a validate stage that
copies and hashes the arguments and forgot the address. Through the real pipeline the line is
unreachable, because validate refused first — so it answers `INTERNAL_ERROR`, this program's bug,
not a refusal the caller could act on. It is here for the same reason the door refuses without a
receipt: a list check cannot see what a stage does.

### Break 7 · make the key the number alone

In `migrations/003_invoices.sql`, change `PRIMARY KEY (tenant_id, id)` to `PRIMARY KEY (id)`.

```text
TypeError: 004_running_example.sql failed and was rolled back: there is no unique or exclusion
constraint matching the ON CONFLICT specification
```

The running example cannot be loaded: it holds an `INV-1008` for each company, and its `ON CONFLICT
(tenant_id, id)` names a key that no longer exists. `pnpm check` reports `61 failed | 130 passed |
182 skipped` — the skipped ones are every file whose setup applies the migrations. Skipped is the
tell of a guard that fired before a test could, and it is written here as what it is.

### Break 8 · grant UPDATE on every column

In `migrations/003_invoices.sql`, change `GRANT UPDATE (status)` to `GRANT UPDATE`.

```text
 Tests  17 failed | 356 passed (373)
```

The application may now move an invoice to another company. One test asks about the grant — and
sixteen more fall because the program **refuses to start**: since the review, the start-up check asks
whether the application could move, renumber, add or delete invoices, and every test that opens the
program's own door is refused. That is the guard a critic's "next attack" asked for.

Restore each break and confirm `pnpm check` prints `373 passed` again.

## Build it yourself with Claude Code

Copy `my_09_postgres_on_neon` to a new folder and ask:

> Start step 10, tenants. Before any code: explain what goes wrong the day a second company shares
> this program, measured on this step. Then ask me, one at a time, where a request's company comes
> from, what an address for another company is answered with, whether the invoices move into
> PostgreSQL now, and who the second company is. Then build it a piece at a time, red first, and
> break each piece on purpose.

## Check yourself

1. Two companies both have an `INV-1008`. What makes them two invoices and not one?
2. Where does a request's company come from, and why not from the address in it?
3. `user_123` asks for `dsor://org_789/invoice/INV-1008` and for `dsor://org_000/invoice/INV-1008`.
   What is the difference between the two answers?
4. The agent's request that never said which employer is in both companies' logs. Why not in
   neither, and why not in a log of its own?
5. The address check used to live in the handler. What was wrong with that, and which test noticed?

<details>
<summary>Answers</summary>

1. The key of the table: `(tenant_id, id)`. An invoice number is an identity only inside one
   company, and the database says so — a second `INV-1008` in the *same* company is refused by
   `invoices_pkey`, and one in *another* company is a different row.
2. From who is logged in: their memberships, and the company the login names if they have more than
   one. The address is an argument, and arguments are data — `DSOR-SRC-02a` says the security context
   comes only from the authenticated envelope and the control-plane store. A program that believed the
   address would let anyone be in any company by typing it.
3. None but the address echoed back. Both are `TENANT_MISMATCH`, the same words, computed from the
   address alone before any lookup. `org_789` is real and `org_000` is not, and the caller cannot tell
   — which is `DSOR-ERR-01b`'s point.
4. Denials are evidence (`DSOR-EXE-02`), so not neither. A log of its own would be an audit partition
   keyed by no company, which `DSOR-TEN-02a` does not allow, and nobody would own it. Every company
   the caller belongs to is the answer: both employers of a shared agent should know it made a request
   without saying who it was working for, and neither log carries a stranger.
5. The handler runs at §21.14, after the decision is recorded at §21.11, so the record said `ALLOW`
   for a request that was then refused — the log contradicting the answer. `audit-per-tenant.test.ts`'s
   "a mismatching address, once the request has a company, is recorded there" noticed, and the check
   moved to §21.6.

</details>

## The rules this step meets

- **[DSOR-TEN-01a · L1]** Every tenant-owned resource MUST carry its `tenant_id`.
  ([§14](../../../specs/dsor/02-security.md#14-multi-tenancy))
- **[DSOR-IDN-03a · L1]** Each request MUST resolve to exactly one active tenant in which the subject
  holds a membership.
- **[DSOR-SRC-02b · L1]** A tenant, principal, or delegation identifier inside operation arguments
  that disagrees with the security context MUST cause `TENANT_MISMATCH` or `AUTHORIZATION_DENIED`.
  **This changed step 05's answer.** Step 05 *ignored* a principal planted in the arguments — the
  context is never derived from them, which is `SRC-02a` — and a review pointed out that the rule
  asks for more: a disagreeing identifier is a claim, and a claim that disagrees with who you are is
  refused and recorded as the `DENY` it is. Four argument names count: `tenant`, `tenant_id`
  (→ `TENANT_MISMATCH`), `principal`, `principal_id` (→ `AUTHORIZATION_DENIED`). One that *agrees*
  still changes nothing. A delegation identifier joins the list in step 18, when delegations exist.
  Any other name a caller plants stays ignored, as before.
- **[DSOR-IDN-03b · L1]** An operation MUST NOT read or write across tenants — met for the two
  operations that exist, by the store taking the company first.
- **[DSOR-TEN-02a · L1]** Audit partitions keyed by tenant — met for the audit partition only. The
  caches, idempotency records, holds and proposals the rule also names do not exist yet. One
  counter does: the flood count of refusals with no subject or no company, which is process-wide on
  purpose, because those refusals have no tenant to key by.

**The map and the spec disagreed, and the spec won.** The map's done-when says an address for another
company returns "the same not found as a URI that does not exist". `DSOR-SRC-02b` says it MUST be
`TENANT_MISMATCH` or `AUTHORIZATION_DENIED`, and `RESOURCE_NOT_FOUND` is neither. So it is
`TENANT_MISMATCH`, and what the done-when *means* — reveal nothing — is held to the letter: the same
words for a company that exists and one that does not, nothing about yours, before any lookup.
Decision 88 in `my_notes` records it.

**"Active"** in `DSOR-IDN-03a` means a tenant that exists and is not suspended. Suspension is a later
step; here a tenant is active when it is on the list in `tenant.ts`.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-TEN-01b` | Two independent layers. This is the first: the program filters. PostgreSQL still answers any query it is sent. Step 11. |
| `DSOR-TEN-01c` | Isolation must not depend on agent behaviour or prompts. Nothing here does, and nothing ever did — but a rule about what is *absent* is not met by a step that adds nothing; it is held by every step. |
| `DSOR-TEN-02b` | A cross-tenant test suite over every operation. `cross-tenant.test.ts` covers `invoice.get` by hand; the generated suite that grows with each operation is step 12. |
| `DSOR-ERR-01b` | The mismatch refusal reveals nothing, but the rule is about every error, and `RESOURCE_NOT_FOUND` for your own company's missing invoice still says it is missing. |

Everything earlier steps claimed still holds. `DSOR-EXE-02` now holds for a refusal with no company
too, which step 09 could not have asked.

**Next:** step 11, `row_level_security` — the second lock. PostgreSQL itself filters rows by company,
so a buggy query still cannot leak, and three traps come with it.
