# Step 43b · People and roles in DSoR's table

**New in this step:** each company's people, and the roles they hold there, live in a table of
DSoR's own. Line ① reads it for a person on the call, and the company's role source reads it for an
absent signer. Tenant administrators change it with commands, and a role that may approve or grant
needs a second administrator before it counts (DSOR-IDN-01, DSOR-IDN-05, DSOR-IDN-07, DSOR-SOD-04c).

## In plain words

Since step 05, who works for a company, and in which job, is written in code: `src/principals.ts`
says cfo_100 is the CFO of org_456. Since step 19, the company's *role source*, the place DSoR asks
"does this person still hold this job?", is a fake directory, written in code too. To hire someone,
or to take a job away, a programmer edits a file and restarts DSoR.

This step moves the people into DSoR's own store. A *person* is a human principal. A *membership* is
one person in one company, with a *status*: active, suspended, or deprovisioned (gone). A *role
grant* is one role given to one member. The table is the company's role source, of the kind the
specification calls `dsor_assignments`: DSoR-held role assignments.

The people who change it are the company's tenant administrators, through five commands of DSoR's
own: `person.add`, `person.remove`, `role.grant`, `role.confirm`, and `role.revoke`. Every change is a
recorded call. A *powerful* role, one that may approve or grant, does not count on one
administrator's word. It waits until a second administrator confirms it.

## Why it matters

A real run on 2026-10-24, on step 43's finished code (`8b98dff8`), in memory. user_123, the AP
supervisor, signed `del_100`, the agent's permission slip.

```text
1. admin_100 hires jane_200 as an AP clerk
   UNSUPPORTED_CAPABILITY: no operation named "person.add"
2. user_123 leaves the company. admin_100 does what step 43 allows: unlinks his login
   {"outcome":"COMMITTED","by":"admin_100"}
3. that night, the agent pays INV-1009 under del_100, the slip user_123 signed
   {"outcome":"COMMITTED","by":"accounts-payable-fte"}
4. what DSoR's company directory still says about user_123
   {"roles":["ap_supervisor"],"source":"role_source","as_of":"2026-10-24T11:58:25.871Z"}
```

1. **Nobody can be hired.** A new AP clerk needs a programmer.
2. **A leaver keeps their power.** Unlinking ended user_123's login, but not his job. The directory
   is code, so it still says "active AP supervisor", and the agent pays vendors on his authority.
   This is the failure DSOR-IDN-05 names: moved on Monday, still paying vendors months later.
3. **Two lists disagree.** A person's roles are in `src/principals.ts` for a call they make, and in
   a second fake directory for a slip they signed. Change one, and the other still holds.

**Common mistake:** keeping the people in two places, one for logins and one for authority, and
updating one. DSoR keeps one table, and both questions read it.

## The design, before any code

### How this step was made

On 2026-10-24 the learner asked whether Managed Neon Auth's organizations could hold the people
instead. Claude Code read Neon's documentation: its Organization plugin is in beta and has three
fixed roles, owner, admin, and member, with no custom roles, so it cannot say "CFO" or "AP
supervisor". The learner then chose this step: DSoR's own table first, and a company's own source
(its directory, or roles in its tokens) in a later step, 43c, with a real single sign-on server. The
learner answered six questions, recorded below as L1 to L6. The rest are Claude Code's, marked D.

### What the rules say

- **[DSOR-IDN-01]** DSoR normalizes every caller into a principal with a type and tenant
  memberships, before any other processing.
- **[DSOR-IDN-05]** Each tenant configures a role source, such as directory synchronization, an
  identity-provider lookup, or **DSoR-held role assignments**.
- **[DSOR-IDN-06]** When a delegator's current authority cannot be established within the staleness
  bound, DSoR denies the command.
- **[DSOR-IDN-07]** When the role source reports a delegator as deprovisioned or suspended, DSoR
  suspends every delegation that principal granted.
- **[DSOR-SOD-04c]** Where a quorum is required, the approvals come from distinct principals.

The specification does not say who may change a role, or how many people must agree. Those are this
tutorial's decisions.

### The claims

| | Claim |
|---|---|
| C1 | A person's companies and roles at line ① come from DSoR's table. A person with no active membership in the company the call names is refused at line ② |
| C2 | The table is the role source `dsor_assignments` in `role-sources.json`: an absent signer's roles come from it, read at each call, with nothing kept. A signer removed from the company has every slip suspended (DSOR-IDN-07) |
| C3 | `person.add` adds a person to the company with no role. `person.remove` marks them deprovisioned: their next call is refused, and their slips are suspended at the next use |
| C4 | `role.grant` gives a role. An ordinary role counts at once. A powerful role waits, as a pending grant, for seven days |
| C5 | `role.confirm` by a second tenant administrator makes a pending grant count. Never the one who asked, never the person it grants to, never an agent |
| C6 | `role.revoke` ends a role, or a pending grant, by one administrator, from the next call on |
| C7 | `pnpm grant`, as the owner, gives `tenant_admin` only, and only while the company has fewer than two active administrators |
| C8 | On PostgreSQL, `dsor.people` and `dsor.role_grants` (migration 049), each company's rows written only inside that company; a grant is confirmed by someone else and moves once; a link and an invitation name only a member of their company |

### Decisions

- **L1. Powerful roles (the learner's).** A role is powerful when `roles.json` gives it a permission
  to approve (`proposal:approve`, `payment:approve`) or to change people and roles (`person:add`,
  `role:grant`, `role:confirm`). Today that is CFO, AP supervisor, and tenant admin. The list is read
  from `roles.json`, not typed out, so a role that gains an approval becomes powerful by itself.
  *Downside:* a role whose power comes another way, such as a large limit, is not caught.
- **L2. A second administrator confirms, with `role.confirm` (the learner's).** The learner first
  chose to reuse payment approvals. Claude Code found that step 31 never releases DSoR's own work
  (its decision D14), so reuse would need a second new idea first. The learner then chose a small
  command of its own. *Downside:* a second way of saying "two people agree", beside payment
  approvals.
- **L3. The owner makes the first administrators (the learner's).** `pnpm grant`, as the database
  owner, gives `tenant_admin` and nothing else, and only while the company has fewer than two active
  administrators, so org_789, with admin_700 alone, can get a second. The owner is not a person DSoR
  knows, so this is not an approval: the record names `owner`. *Downside:* the owner can make the
  first two administrators alone.
- **L4. Removing is one administrator, at once (the learner's).** Losing power is the urgent
  direction. *Downside:* a rogue administrator can take roles away. The log shows who did it.
- **L5. One table, read twice (the learner's, from the recommendations).** Line ① and the role
  source read the same table, so the two lists of "Why it matters" become one. *Downside:* while the
  table cannot be read, every person's call is refused, as `CONNECTOR_UNAVAILABLE`.
- **L6. Roles mean what DSoR's rules say (the learner's).** The table says who holds which role.
  What a role may do stays in `roles.json`, so a grant can name only a role that file has.
- **D1. People only (Claude Code).** Agents and DSoR's system logins stay in `src/principals.ts`
  until step 44, which gives agents real logins. *Downside:* two kinds of principal, two homes.
- **D2. The story's people are the first rows (Claude Code).** cfo_100, user_123, admin_100,
  user_700, and admin_700, with step 43's roles, written by the migration on PostgreSQL, and by the
  memory store from `src/principals.ts`. So every earlier story runs as before.
- **D3. The confirmer is someone else (Claude Code).** Neither the administrator who asked, nor the
  person who gets the role. Otherwise an administrator could ask a friend to grant them CFO, and
  confirm it themselves.
- **D4. Read at every call, kept nowhere (Claude Code).** The table is DSoR's own, so there is no
  network to wait for: line ① reads it at each call, and the role source keeps no answer. A role
  revoked at 10:00 is gone at 10:00. `max_staleness` stays in `role-sources.json`, as the schema
  requires, and is met by reading now.
- **D5. Readable across companies, written inside one (Claude Code).** Line ① reads a person's
  memberships before it knows the company, so `dsor_runtime` may read every row. It writes only
  inside the company the transaction set. *Downside:* a broken-into program could read who works
  where.
- **D6. History is kept (Claude Code).** A removed person and a revoked role stay as rows, with who
  ended them and when, as the links do since step 43.
- **D7. A pending grant lasts seven days (Claude Code)**, as an invitation does.

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | cfo_100's call reads her roles from the table; a role revoked in the table is gone on her next call; a person removed from org_456 is refused at line ②; a person added with no role reads nothing |
| C2 | An absent signer's roles come from the table; a revoked role refuses the agent's next payment under the slip; a removed signer's slips are suspended |
| C3 | `person.add` and `person.remove`, by an administrator only; a person of another company, an agent's id, and a person added twice are refused |
| C4 | An AP clerk counts at once; a CFO grant answers pending and counts only after a confirm; a role `roles.json` does not have is refused |
| C5 | The asker cannot confirm; the person granted cannot confirm; an AP supervisor cannot; the agent cannot; a confirmed or expired grant cannot be confirmed again |
| C6 | A revoked role is gone on the next call; a revoked pending grant can never be confirmed |
| C7 | `pnpm grant org_789 user_700 tenant_admin` works once; with two administrators, or for CFO, it is refused |
| C8 | `dsor_runtime` is refused a grant confirmed by its asker, a second move, a write in another company, and a link or an invitation for a person of no company |

### The breaks

| Break | What it changes |
|---|---|
| B1 | Line ① reads the roles from `src/principals.ts` again |
| B2 | The role source keeps an answer for an hour |
| B3 | A powerful grant counts at once |
| B4 | The asker may confirm their own grant |
| B5 | The person granted may confirm it |
| B6 | `pnpm grant` gives any role |
| B7 | A removed person's memberships still count |
| B8 | The link trigger forgets the company check |

## What changed since step 43

| File | What changed |
| --- | --- |
| `src/people.ts` | **New.** The table of people in memory, what a grant is, which roles are powerful, the role source's directory over the table, and line ①'s `withPeople` (C1, C2) |
| `src/people-commands.ts`, `contracts/person.*.json`, `contracts/role.*.json`, `inputs/Person*Request.schema.json`, `inputs/Role*Request.schema.json`, `examples/` | **New.** The five commands (C3 to C6) |
| `migrations/049_people.sql`, `store.json`, `src/postgres.ts` | **New migration.** `dsor.people` and `dsor.role_grants`, with their guards and the story's people as the first rows; the database's store (C8) |
| `src/grant.ts`, `package.json` | **New program**, `pnpm grant`: the owner makes a company's first administrators (C7) |
| `src/pipeline.ts`, `src/registry.ts`, `src/logins.ts`, `src/release.ts`, `src/invitations.ts`, `src/invite.ts` | Line ①, a person's own release, and the invitations read the table, never `src/principals.ts`; a real login may name a person who is not in the code |
| `role-sources.json`, `role-sources.step-19.json`, `src/authority.ts` | The shipped role source is `dsor_assignments`, read now and never kept. Step 19's fake directory, `idp_lookup`, moves to its own file, for the stories and tests that drive it |
| `roles.json`, `classifications.json`, `src/routes.ts` | Five permissions for `tenant_admin`, four kinds of answer, five routes |
| `src/serve.ts` | `pnpm serve` reads the table on PostgreSQL, and has no fake directory |
| `test/people.test.ts`, `test/people-commands.test.ts`, `test/people.db.test.ts` | **New.** The claims |
| `test/helpers.ts`, `test/rule-world.ts`, `test/db.ts`, and the earlier lists | A planted person is planted in the table too; the worlds hold a table; every list of operations, routes, roles, labels, tables, triggers, policies, and privileges names the new ones. Each says "Changed in step 43b" |

```bash
git diff --no-index ../mj_43_real_logins_for_people/src src
git diff --no-index ../mj_43_real_logins_for_people/test test
```

## Run it

In memory, the story of this step (a script in a scratch folder, on this step's code, with the
shipped role source), on 2026-10-24:

```text
1. admin_100 hires jane_200
   {"person":"jane_200","status":"active","by":"admin_100"}
2. admin_100 makes her an AP clerk: no approval power, so at once
   {"grant":"dsor://org_456/grant/grt_8c6dde0e-…","person":"jane_200","role":"ap_clerk","state":"active","by":"admin_100"}
3. admin_100 asks for CFO for user_123: CFO may approve, so it waits
   {"grant":"dsor://org_456/grant/grt_d91954bd-…","person":"user_123","role":"CFO","state":"pending","expires_at":"2026-10-13T15:05:00.000Z","by":"admin_100"}
4. admin_100 confirms it himself
   SOD_VIOLATION: admin_100 may not confirm grant grt_d91954bd-…: admin_100 asked for it
5. the owner makes cfo_100 org_456's second administrator (pnpm grant, on PostgreSQL)
6. cfo_100 confirms admin_100's grant
   {"grant":"dsor://org_456/grant/grt_d91954bd-…","person":"user_123","role":"CFO","state":"active","by":"cfo_100"}
7. user_123's roles in DSoR's table now
   {"status":"active","roles":["ap_supervisor","CFO"]}
8. user_123 leaves: admin_100 removes him
   {"person":"user_123","status":"deprovisioned","roles":2,"by":"admin_100"}
9. that night, the agent pays INV-1009 under del_100, the slip user_123 signed
   DELEGATION_REQUIRED: "payment.create": slip del_100 is signed by user_123, whom the directory of org_456 does not list as active
10. del_100 now
   "suspended"
```

Run 9 is the failure of "Why it matters", now refused. The message still says "the directory of
org_456": the role source of that company, which is DSoR's own table now.

On PostgreSQL, as in step 43: a new database, `pnpm migrate` (migration 049 is new), then
`pnpm serve`. A company with one administrator gets its second with the owner's command:

```bash
pnpm grant org_789 user_700 tenant_admin "the second administrator"
```

## Break it

B4 lets the administrator who asked confirm their own grant. In `src/people.ts`, in `confirm`, change

```ts
if (by.person === grant.asked_by || by.person === grant.person) {
```

to

```ts
if (by.person === grant.person) {
```

and run the story again. A real run on 2026-10-24, in a copy of the step:

```text
3. admin_100 asks for CFO for user_123: CFO may approve, so it waits
   {"grant":"dsor://org_456/grant/grt_919bdc63-…","person":"user_123","role":"CFO","state":"pending","expires_at":"2026-10-13T15:05:00.000Z","by":"admin_100"}
4. admin_100 confirms it himself
   {"grant":"dsor://org_456/grant/grt_919bdc63-…","person":"user_123","role":"CFO","state":"active","by":"admin_100"}
```

One administrator made user_123 the CFO alone, and the two-person rule is gone. The tests name it:

```text
     × DSOR-SOD-04c: the administrator who asked cannot confirm their own grant
      Tests  1 failed | 24 passed (25)
```

On PostgreSQL, the trigger `role_grants_move` refuses the same confirm even when the program forgets
to (break B10 below). Restore the line, and `pnpm check` is green again.

Every break of the design was made on 2026-10-24, in a copy of the step, and the database ones on a
fresh database each. Each failed the test written for it:

| Break | What it changes | Caught by |
|---|---|---|
| B1 | Line ① reads the roles from `src/principals.ts` again | "a role revoked in the table is gone from cfo_100's next call", and 17 more |
| B2 | The role source keeps an answer for `dsor_assignments` | "the table cannot be read: the agent is refused, with no answer kept" |
| B3 | A powerful grant counts at once | "a CFO grant to user_123 waits seven days", and 4 more |
| B4 | The asker may confirm their own grant | "the administrator who asked cannot confirm their own grant" |
| B5 | The person granted may confirm it | "the person a grant names cannot confirm it" |
| B6 | `pnpm grant` gives any role | "pnpm grant [org_789, user_700, CFO, x] is refused" |
| B7 | A removed person's memberships still count | "a person removed from her only company is no caller", and 2 more |
| B8 | The link trigger forgets the company check | "a link for a person removed from the invitation's company is refused" |
| B9 | A person's own release reads `src/principals.ts` again | "user_123 prepares INV-1009 …, his role is revoked …: invalidated" |
| B10 | The database's store lets the asker confirm; the trigger still refuses | "a CFO grant waits; its asker cannot confirm it", which then hears a database error instead of `SOD_VIOLATION` |
