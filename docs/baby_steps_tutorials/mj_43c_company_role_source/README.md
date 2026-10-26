# Step 43c · A company's own role source

**New in this step:** a company can keep its people in its own directory. Its single sign-on
server, authentik here, pushes each person and group to DSoR by SCIM. DSoR keeps a copy, turns
groups into roles with the company's role map, and refuses a copy it has not heard about for too
long (DSOR-IDN-04a, DSOR-IDN-05, DSOR-IDN-06, DSOR-IDN-07).

## In plain words

Step 43b put each company's people in a table of DSoR's own. A tenant administrator hires, fires,
and grants roles there. That works for a company with no directory.

Most real companies have one already. A *directory* is the company's own list of its people and
their groups, kept in its single sign-on server: Microsoft Entra, Okta, Keycloak, or authentik. HR
works there. When DSoR keeps a second list, somebody must change both, and one day nobody does.

*SCIM* (System for Cross-domain Identity Management, RFC 7643 and RFC 7644) is the common way a
directory tells an application about its people. The directory sends HTTP requests to the
application: "here is a new user", "this user is inactive now", "these users are in this group".
The application keeps a copy. This step gives DSoR a SCIM door, for the directory only.

A group is not a role. "Finance-Approvers" is a name somebody typed in the directory. The company's
*role map* says which group, by its permanent id, gives which of DSoR's roles. What a role may do
stays in `roles.json`, as in step 43b.

Each company chooses one source in `role-sources.json`: DSoR's own table, as in step 43b, or its
directory's copy, as in this step. Never both.

## Why it matters

A real run on 2026-10-26, on step 43b's finished code. org_456 keeps its people in authentik
2026.8.5, on this computer. At 21:07:35 UTC its administrator made user_123 inactive. authentik
pushed the change to DSoR's address at once, and nothing there could take it:

```text
authentik.providers.scim.tasks.scim_sync_direct queued retries=2 next try=21:08:55
```

And step 43b's DSoR, that night:

```text
1. what step 43b's DSoR knows about user_123
   {"status":"active","roles":["ap_supervisor"]}
2. that night, the agent pays INV-1009 under del_100, the slip user_123 signed
   {"outcome":"COMMITTED"}
3. del_100 now
   "active"
```

1. **The company's truth never reaches DSoR.** authentik knows user_123 is gone. DSoR has no door
   for it, so DSoR's table still says "active AP supervisor".
2. **A leaver keeps paying vendors.** The agent pays on the authority of a person who left. This is
   the failure DSOR-IDN-05 names.
3. **Two lists again.** Step 43b ended two lists inside DSoR. A company with a directory has two
   lists across two systems, and DSoR's is the one nobody looks at.

**Common mistake:** reading a group's name as a role. A directory administrator who renames a group,
or makes a second one with the same name, would make its members CFOs. The map names a group by its
permanent id, and only the company's reviewed map can make a group powerful.

## The design, before any code

### How this step was made

The learner chose the single sign-on server and the design in ten answers on 2026-10-26, L1 to L10
below; one, L7, was asked again after a real run. Claude Code ran authentik for real before any
code, because the design depends on what authentik really sends. The run is the "Real check" below.
The rest of the decisions are Claude Code's, marked D.

### What the rules say

- **[DSOR-IDN-04a]** Role and scope assertions are accepted only from a token issuer or role source
  configured as authoritative for the active tenant.
- **[DSOR-IDN-04b]** A claim from any other origin is never used in an authorization decision.
- **[DSOR-IDN-05]** Each tenant configures a role source, such as **directory synchronization such
  as SCIM**, from which DSoR can read the current roles of a principal who is not in the request.
- **[DSOR-IDN-06]** When the delegator's current authority cannot be established within the
  staleness bound of §44, DSoR denies the command.
- **[DSOR-IDN-07]** When the role source reports a delegator as deprovisioned or suspended, DSoR
  suspends every delegation that principal granted.
- **§44** bounds the staleness of the delegator's authority: at most 24 hours at L2, 1 hour at L3.
- **§10** puts a compromised identity provider or role source out of scope: the company addresses
  it outside DSoR.

The specification does not say how a copy's age is measured, how a group becomes a role, or what a
directory's credential looks like. Those are this tutorial's decisions.

### The real check, before any code

On 2026-10-26 Claude Code ran authentik 2026.8.5 in Docker (Colima) and pointed its SCIM provider at
a small recorder, a sketch that answers as a strict SCIM server and writes down every request. Then
it changed people in authentik and read what arrived. What it found:

| # | Fact | What it changes |
|---|---|---|
| F1 | A change is pushed within a second: `POST` a new user or group, `PUT` the whole user on a change, `DELETE` a deleted user. Members are added with `PATCH` `add` on `members`, naming the ids DSoR gave | The door takes four verbs |
| F2 | The full sync, which repairs what a push missed, runs **every 4 hours** by default (`39 */4 * * *`), not hourly as a page of authentik's documentation says | L7 was asked again |
| F3 | The full sync speaks when nothing changed: it lists the users and groups and reads each group | "When DSoR last heard" works as the copy's age (D2) |
| F4 | A failed push is tried again after about 20, 40, 80, and 160 seconds. Once DSoR answered again, a full pass sent user_123's change within 20 seconds | A short outage heals by itself |
| F5 | One user can be posted twice in the same second. After a `409`, authentik searches `userName eq "…"` and **`PUT`s its user over whatever the search finds** | The door shows the company's own copy only, or another company's person is taken over (C3) |
| F6 | After a `409` and an empty search, authentik tries again later and takes nothing | "Taken" is answered as `409`, safely |
| F7 | Leaving a group arrives as `PATCH` `remove` with the path `members[value eq "<id>"]` | The door reads that path |
| F8 | authentik sends no `externalId` unless the company's mapping says so, and it pushes its own `akadmin` and built-in groups too | The door refuses a user or group with no `externalId` (D5); an unmapped group gives no role |
| F9 | Every request names the `Host` `host.lima.internal:8044`, the name the containers use for this computer | Step 42's door, which takes only `127.0.0.1`, would answer `421` (D7) |

### Decisions

- **L1. The single sign-on server is authentik (the learner's),** run on this computer, so the push,
  the groups, and the sign-in all run for real on one machine. *Downside:* fewer companies run it
  than Entra or Okta.
- **L2. A SCIM copy only (the learner's).** authentik pushes; DSoR keeps a copy; line ① and the
  role source read it through the same table of people step 43b built. No lookup, and no roles from
  a token: the token says who is calling, never what they may do. *Downside:* a new door to guard,
  for each company.
- **L3. The map names a group by its id (the learner's),** authentik's `pk`, sent as the group's
  `externalId`. A renamed group keeps its role; a new group with the same name gets none.
  *Downside:* the map is hard to read, so each line also carries the group's name, which DSoR never
  uses to decide.
- **L4. The map is a file per company, `role-maps.json` (the learner's),** read at start-up and
  changed by a pull request. *Downside:* a company cannot change its own map without whoever runs
  DSoR.
- **L5. A person's DSoR id is their authentik username at the first push (the learner's).** After
  that the copy keys them by their `externalId`, authentik's user `uuid`, so a rename changes
  nothing. An id another company has, or had, is taken, as in step 43b. *Downside:* a username
  changed in authentik and the DSoR id drift apart.
- **L6. A login links by the uuid, with no invitation (the learner's).** authentik is the issuer of
  its own company only. A token from it whose `sub` is a pushed person's `uuid` in that company is
  that person. *Downside:* the company's authentik is trusted to say who is who, as it already is,
  being the role source.
- **L7. `max_staleness` is PT2H, and authentik's full sync is set to hourly (the learner's, asked
  again after F2).** A quiet company is heard from each hour, with an hour to spare. If a company
  leaves authentik's default of four hours, DSoR refuses its calls: loudly, never by trusting an old
  copy. *Downside:* a setting outside DSoR that DSoR cannot check at start-up. It meets L2 (24
  hours), not L3 (1 hour).
- **L7b. A refused push stops the copy at once (the learner's, after the review's finding 5).** A
  refused deactivation, say for a display name too long, left the copy current while authentik's
  quiet reads succeeded: a leaver kept her roles for as long as authentik retried. Now, while the
  directory's latest push was refused, the copy is no answer, whatever reads follow, until a push
  succeeds. *Downside:* one bad change in authentik stops every call of the company's people, and its
  agents' slips, until it is fixed there.
- **L8. `active: false` suspends; `DELETE` deprovisions (the learner's).** Either way the person's
  next call is refused. A suspended person can come back. Her slips were to be suspended at their
  next use, by step 19b's path; L8b changed that.
- **L8b. The push itself suspends her slips (the learner's, asked again after the review's finding
  1).** At the next use, a person suspended and made active again before the agent next called never
  had her slips suspended, though her directory had reported it. Now the push that says
  `active: false`, or deletes her, suspends every active slip she signed in that company, in its own
  transaction, with one record each (DSOR-IDN-07). *Downside:* a push writes delegations too, a second
  path beside step 19b's; a person who comes back needs new slips.
- **L9. A mapped group's role counts at once (the learner's).** The second person's check moves to
  the map's pull request: which group makes a CFO is reviewed; who is in the group is the company's
  own process. *Downside:* one authentik administrator can make a CFO alone.
- **L10. Step 43b's commands are refused for a company on a directory (the learner's):**
  `person.add`, `person.remove`, `role.grant`, `role.confirm`, `role.revoke`, `login.invite`,
  `login.unlink`, and the owner's `pnpm grant`. One truth per company. *Downside:* an urgent
  removal happens in authentik, not DSoR.
- **D1. The push is a call, like any other (Claude Code).** Each SCIM request becomes one `call()`
  of a new operation, `directory.push` (a command) or `directory.read` (a query), by the company's
  directory login, a system principal with one role, `directory_sync`, in one company. So every push
  is recorded, line ② sets its company, and a refusal is a `DENY`, as `rate.load` is for `dsor-rates`
  since step 26. *Downside:* a full sync of 500 people writes 500 records.
- **D2. The copy's age is the time since the company's directory last spoke, read from the audit
  (Claude Code).** The latest `ALLOW` record of the directory login in that company **that
  succeeded**, by the database's clock. The quiet sync's reads count (F3); a push refused in its
  work does not (changed by the real run, below), and since L7b a refused push stops the copy until a
  later one succeeds. No new timestamp that anything could set by hand. *Downside:* reading the audit
  at each call of a person of that company; an index keeps it short.
- **D3. The directory's credential names its company (Claude Code).** A random token, made by the
  owner's `pnpm directory-token org_456`, shown once to paste into authentik. DSoR keeps its SHA-256
  only, in `dsor.directory_clients`, which `dsor_runtime` reads and never writes. The company comes
  from the token, never from the URL. *Downside:* a lost token is replaced by the owner, not the
  company.
- **D4. The door shows each company its own copy only (Claude Code, from F5).** A search, a read by
  id, a `PUT`, a `PATCH`, or a `DELETE` of a row of another company answers "not found". *Downside:*
  none found; this is the seam step 43b's review attacked.
- **D5. A user or group with no `externalId`, or a username that is not a DSoR id, is refused
  (Claude Code).** `400`, so authentik tries again and its administrator sees the error, never a
  person DSoR cannot key. Agents', system logins', and DSoR's own names (`owner`, `dsor`) are never a
  person's, as in step 43b. *Downside:* a company whose usernames are e-mail addresses cannot use
  this step as it stands.
- **D6. A member that names a user DSoR has not got is refused (Claude Code).** `400`; the next try
  or the full sync sends it again. A member dropped in silence would be a missing role nobody sees.
- **D7. The SCIM door is a second door (Claude Code).** `pnpm serve` listens on `127.0.0.1:8044`
  too (`DSOR_SCIM_PORT`), for the paths `/scim/v2/…` only, and only for the host names
  `DSOR_SCIM_HOSTS` names, such as `host.lima.internal:8044` (F9). The agent's door has no route to
  `directory.push`, and the SCIM door has no route to anything else. *Downside:* two doors to keep.
- **D8. Roles are read through the map at each call, never stored (Claude Code).** The copy holds
  what authentik said: users, groups, members. A changed map counts from the restart, with no new
  push.
- **D9. The copy has tables of its own, read through step 43b's store (Claude Code, while
  building).** L2 said the copy lands in step 43b's tables. It lands beside them, in
  `dsor.scim_users`, `dsor.scim_groups`, and `dsor.scim_members`, because it holds what the
  directory said (groups and members), not what DSoR decided (roles and grants). What L2 asked for
  holds: line ①, the role source, and every command read one `PeopleStore`, which answers each
  company from the one source it names. *Downside:* two stores of people inside DSoR, one per kind.

### The claims

| | Claim |
|---|---|
| C1 | `role-sources.json` may give a company the kind `scim`. `role-maps.json` gives each such company its map: a group's id, its name, and a role `roles.json` has that is no system login's. Start-up refuses a map that is wrong and a `scim` company with no map. A map for a company on DSoR's table is not read |
| C2 | The SCIM door answers only a directory's token: no token, or one DSoR does not know, is `401`; the company is the token's. It answers only `/scim/v2/…`, and only for the host names it is given |
| C3 | `directory.push` keeps the company's copy: a user by `externalId`, with its DSoR id from the first push; a group by `externalId`; its members. `directory.read` lists, searches, and reads it. Neither sees another company's rows. A taken id, a missing `externalId`, a wrong username, and an unknown member are refused |
| C4 | For a `scim` company, line ① and the role source read the copy: an active user has the roles of their mapped groups; `active: false` is suspended; a deleted user is deprovisioned. A suspended or deprovisioned signer's slips are suspended (DSOR-IDN-07) |
| C5 | A copy whose directory has not spoken within `max_staleness` is not used: an absent signer's agent is refused `FRESHNESS_UNSATISFIABLE` (DSOR-IDN-06), and a person on the call is refused as an outage |
| C6 | A token from a `scim` company's issuer, whose `sub` is a pushed user's id in that company, is that person, with no invitation |
| C7 | Step 43b's commands, `login.invite`, `login.unlink`, and `pnpm grant` are refused for a `scim` company |
| C8 | On PostgreSQL, migration 050 keeps the copy and the credentials; each company's rows are written only inside that company; a user's DSoR id and `externalId` never change; an id another company has or had is refused by the database too |

### The tests, by claim

| Claim | Test |
|---|---|
| C1 | The shipped files start; a map naming a role `roles.json` lacks, a system role, a group by its name, one group twice, and a `scim` company with no map are each refused at start-up; a map for org_789, on DSoR's table, is not read |
| C2 | No token, a wrong token, and another company's token; a path outside `/scim/v2/`; a host not named |
| C3 | authentik's own requests, from the real check: the first sync, a change, a deactivation, a group leave by filter path, a delete, a double post, a search after `409`; another company's id, row, and search |
| C4 | cfo_100 pushed into Finance-Approvers approves INV-1008; removed from the group, she cannot; user_123 made inactive: his agent's payment is refused and del_100 suspended; deleted: the same; back active: his next call works |
| C5 | Two hours and a minute after the last push or read, the agent under user_123's slip is refused; a read by the directory makes the copy current again |
| C6 | A token whose `sub` is cfo_100's uuid is cfo_100; another company's uuid, an unknown uuid, and a deleted user's uuid are no caller |
| C7 | Each of the eight, for org_456 on `scim`, answers that its people come from its directory; for org_789 on DSoR's table, each works as in step 43b |
| C8 | The database refuses a write in another company, a changed DSoR id or `externalId`, a taken id, and a credential written by `dsor_runtime` |

### The breaks

The learner predicted three, asked as stories before the run (2026-10-26).

| Break | What it changes | The learner's prediction |
|---|---|---|
| B1 | The map is read by the group's name, not its id | A second group named Finance-Approvers makes its member CFO: COMMITTED |
| B2 | The company is taken from the request, not the token | |
| B3 | The copy's age is never checked | The agent pays on a three-hour-old copy: COMMITTED |
| B4 | `active: false` is read as active | |
| B5 | Any bearer token is taken | |
| B6 | A search shows every company's rows | authentik's PUT then takes over org_789's row |
| B7 | A login whose `sub` is a username is taken as that person | |
| B8 | The taken check is gone | |
| B9 | Step 43b's commands are not refused for a `scim` company | |

## What changed since step 43b

| File | What changed |
| --- | --- |
| `role-sources.scim.json`, `role-maps.json`, `src/role-maps.ts`, `src/authority.ts` | **New.** The kind `scim`, and each such company's map of group ids to roles, checked at start-up (C1) |
| `src/directory-copy.ts`, `src/company-people.ts` | **New.** The copy in memory, and the people store that answers each company from its one source, through the map, while the directory has spoken within `max_staleness` (C3 to C5) |
| `src/directory-push.ts`, `contracts/directory.*.json`, `inputs/Directory*Request.schema.json`, `examples/directory.*.json`, `classifications.json`, `roles.json`, `src/principals.ts` | **New.** `directory.push` and `directory.read`, and each company's directory login with the one role `directory_sync` (C3) |
| `src/scim-door.ts`, `src/scim-translate.ts`, `src/directory-clients.ts` | **New.** The SCIM door: a directory's own token, the host names it is given, SCIM in and out (C2) |
| `src/logins.ts` | A login no link names may be a pushed person, by the uuid in its `sub` (C6) |
| `src/revocation.ts`, `src/grant.ts` | Step 43b's commands, the invitations, and `pnpm grant` refused for a `scim` company (C7) |
| `migrations/050_directory_copy.sql`, `src/postgres-copy.ts`, `src/postgres.ts`, `src/store.ts`, `store.json`, `src/directory-token.ts`, `package.json` | **New migration** and the owner's `pnpm directory-token`; a new kind of table, `shared-read` (C8) |
| `src/serve.ts`, `src/pipeline.ts`, `src/registry.ts`, `src/claims.ts`, `src/alert-list.ts` | `pnpm serve` reads the copy and opens the SCIM door; the registry holds the maps and settings; the claims and DSoR's own read reach the copy |
| `test/role-maps.test.ts`, `test/directory-copy.test.ts`, `test/company-people.test.ts`, `test/directory-push.test.ts`, `test/scim-door.test.ts`, `test/login-by-uuid.test.ts`, `test/table-commands.test.ts`, `test/directory-copy.db.test.ts`, `test/scim-world.ts` | **New.** The claims |
| `test/rule-world.ts`, `test/helpers.ts`, `test/catalogs.ts`, and the earlier lists | A world holds a copy; every list of operations, logins, roles, kinds, tables, triggers, policies, privileges, and attacks names the new ones. Each says "Changed in step 43c" |

```bash
git diff --no-index ../mj_43b_people_and_roles/src src
git diff --no-index ../mj_43b_people_and_roles/test test
```

## Run it

A real run on 2026-10-26: authentik 2026.8.5 in Docker (Colima), and this step's `pnpm serve` on
PostgreSQL 17, both on this computer. org_456 on `role-sources.scim.json`; authentik's SCIM provider
pointed at `http://host.lima.internal:8044/scim/v2` with the token of the owner's
`pnpm directory-token org_456`; its OIDC provider with `sub_mode` `user_uuid` and DSoR's address as
its client id, so a token's audience names DSoR.

```bash
pnpm directory-token org_456
DSOR_ROLE_SOURCES_FILE=role-sources.scim.json DSOR_ISSUERS_FILE=<issuers naming authentik> \
  DSOR_STAND_IN=on DSOR_SCIM_HOSTS=host.lima.internal:8044 pnpm serve
```

```text
DSOR_STAND_IN=on: trusting http://127.0.0.1:9000/application/o/dsor/, to learn only
DSoR's door listens on http://127.0.0.1:8042
DSoR's SCIM door listens on http://127.0.0.1:8044/scim/v2/
```

After authentik's full sync, what DSoR holds (a script in a scratch folder, through this step's code):

```text
copy users: akadmin, cfo_100, user_123, admin_100
copy groups: authentik Agent-Users[0], authentik Read-only[0], AP-Supervisors[1], Finance-Approvers[1], authentik Admins[1], Tenant-Admins[1]
  cfo_100: {"status":"active","roles":["CFO"]}
  user_123: {"status":"active","roles":["ap_supervisor"]}
  admin_100: {"status":"active","roles":["tenant_admin"]}
```

Then the story, on the REST door, with a real token from authentik for cfo_100 (the agent keeps step
05's token until step 44):

```text
cfo_100, signed in through authentik, reads INV-1008
   200 {"by":"cfo_100","data":{"id":"INV-1008","open_amount":{"value":"31400.00","currency":"USD"},"status":"issued"}}
the agent pays INV-1008, 31,400.00 USD: above 25,000 USD, so it waits for the CFO
   202 PENDING_APPROVAL
cfo_100, CFO by her authentik group Finance-Approvers, approves it
   200 {"outcome":"COMMITTED","by":"cfo_100","data":{"id":"apr_3198e539-…","state":"APPROVED"}}
22:45:25 authentik: user_123 made inactive
the agent pays INV-1009 under del_100, the slip user_123 signed
   403 DELEGATION_REQUIRED: "payment.create": slip del_100 is signed by user_123, whom the directory of org_456 does not list as active
del_100 now "suspended"
22:45:42 authentik: cfo_100 taken out of Finance-Approvers
cfo_100, out of Finance-Approvers, approves the INV-1008 proposal again
   403 AUTHORIZATION_DENIED: "proposal.approve" needs proposal:approve, which the caller does not hold
```

"Why it matters", refused: authentik's push reached DSoR within six seconds. cfo_100 joined with no
invitation, and her role came from her group, never from her token, whose `groups` claim DSoR does
not read.

And a directory that goes quiet. For this run only, org_456's `max_staleness` was one minute (a file
in a scratch folder), and authentik's worker, which sends its pushes, was stopped:

```text
22:56:49 cfo_100 reads INV-1008:
   200 {"by":"cfo_100","data":{"id":"INV-1008",…}}
22:57:01 authentik's worker stopped: its directory sends nothing
22:58:16 cfo_100 reads INV-1008:
   503 CONNECTOR_UNAVAILABLE: the sign-in service could not be checked now (DSoR's table of people): try again
22:58:17 and the agent pays INV-2002 under del_101, the firm's slip:
   503 FRESHNESS_UNSATISFIABLE "payment.create": DSoR has no answer about user_123, who signed slip del_101, from the directory of org_456 that is recent enough
22:58:17 authentik's worker started
22:59:18 after authentik's full sync, cfo_100 reads INV-1008:
   200 {"by":"cfo_100","data":{"id":"INV-1008",…}}
```

The refusal at 22:58:16 named the wrong thing; it now says the directory has not been heard from
recently enough ("Think it through"). Not "suspended": DSoR does not know user_123 left, only that
its copy is too old to say.

**Set up authentik for a company.** Its mapping must send `externalId` (`str(request.user.uuid)` for
a user, `str(group.pk)` for a group; F8). Its SCIM provider's full sync must run hourly, not every
four hours (L7). Its OIDC provider's `sub_mode` must be `user_uuid` (L6). And a provider that
already pushed to another server keeps that server's ids: clear them (its SCIM users and groups in
authentik's admin) before it pushes to a new DSoR, or nothing arrives ("Think it through").

## Break it

B3 lets DSoR use a copy of any age. In `src/company-people.ts`, in `fresh`, change

```ts
if (!(age >= 0 && age < bound)) {
```

to

```ts
if (false && !(age >= 0 && age < bound)) {
```

and run the story: authentik's worker has been down for three hours, and in it HR made user_123
inactive. A real run on 2026-10-26, in a copy of the step, beside the step itself:

```text
--- B3, broken
  the agent pays INV-2002 under del_100: COMMITTED
--- B3, the step
  the agent pays INV-2002 under del_100: FRESHNESS_UNSATISFIABLE: "payment.create": DSoR has no answer about user_123, who signed slip del_100, from the directory of org_456 that is recent enough
```

The learner predicted COMMITTED: right. Restore the line, and `pnpm check` is green again.

Every break was made on 2026-10-26, each in a copy of the step:

| Break | Caught by | The story, broken / the step |
|---|---|---|
| B1 | "the Common mistake: a second group named Finance-Approvers, with another id, gives no role", and 1 more | jane_200, in a second group named Finance-Approvers, approves INV-1008: COMMITTED / AUTHORIZATION_DENIED. Asked of user_123, as the prediction was, it is SOD_VIOLATION both times: he signed the agent's slip. The question named the wrong person |
| B2 | "the company is the token's: org_789's token pushes into org_789, whatever the request says" | Line ② refuses the push anyway (403, not 409): org_789's directory login has no membership in org_456. The door is wrong, and nothing reaches the other company |
| B3 | "two hours and a minute since org_456's authentik spoke, the agent under user_123's slip is refused", and 5 more | above |
| B4 | "user_123 made inactive in authentik: the agent's payment under del_100 is refused", and 3 more | |
| B5 | "a wrong token is answered 401, and nothing is pushed", and 2 more | |
| B6 | "authentik's search after a 409 never finds another company's person", and 2 more | org_456's search finds org_789's jane_300 and its id, and authentik's PUT is 404: nothing is taken over, because a write names its company too (D4). The learner predicted a takeover: seeing a row and changing it are two checks, and the break removed one |
| B7 | "a sub that is cfo_100's username, not her uuid is no caller" | |
| B8 | "an id another company has is taken, and the answer names no company", and 3 more | |
| B9 | each of the seven "is refused, and recorded DENY" | |

## Build it yourself with Claude Code

| # | Move | What was done |
|---|---|---|
| 1 | Understand | Six parts, each with a real run of step 43b's code; the habit found was "DSoR knows what the story knows" |
| 2 | Ask | Ten decisions, L1 to L10, each with its trade-off; L7 asked again after the real check |
| 3 | Check for real | authentik run before any code, its requests recorded (F1 to F9) |
| 4 | Build, piece by piece | Seven pieces, each with its tests: the kind and the map; the copy and its reading; the two operations; the SCIM door; the refused commands; login by uuid; PostgreSQL |
| 5 | Run for real | `pnpm serve` against authentik, which found three gaps, each fixed red first |
| 6 | Break it | B1 to B9, in copies; three predicted by the learner |
| 7 | Review | A reviewer who had not seen the conversation |

To start it in a new session:

```text
Build step 43c in learner mode from the design in
docs/baby_steps_tutorials/mj_43c_company_role_source/README.md and the notes in
docs/baby_steps_tutorials/mj_notes.md, "Step 43c's design".
```

## Check yourself

1. HR makes user_123 inactive in authentik. That night the agent pays INV-1009 under `del_100`. What
   does DSoR answer, and how did it learn?
2. An authentik administrator creates a group named Finance-Approvers and puts jane_200 in it. Is she
   a CFO in DSoR?
3. authentik's worker is down for three hours. What does the agent hear, and why is `del_100` not
   suspended?
4. org_456's authentik pushes a user named `user_700`. What happens, and why does it matter?
5. Why does a token's `groups` claim give nobody a role?

<details>
<summary>Answers</summary>

1. `DELEGATION_REQUIRED`. authentik pushed a PUT of user_123 with `active: false` within seconds;
   that push suspended `del_100` at once (L8b, DSOR-IDN-07), and the copy says he is suspended.
2. No. The map names a group by its uuid (L3). A new group has a new uuid, which no line of
   `role-maps.json` names, and only a reviewed pull request adds one (L4).
3. `FRESHNESS_UNSATISFIABLE` (DSOR-IDN-06). DSoR has not heard from the directory within
   `max_staleness`, so its copy is no answer at all. It does not know user_123 left, so it suspends
   nothing; it refuses.
4. `409`, "the id user_700 is taken" (L5). An id is one for all of DSoR, as its login is: otherwise
   org_456's directory could make a person who signs in as org_789's user_700.
5. The token says who is calling. What she may do comes from DSoR's copy and the company's map
   (L2, DSOR-IDN-04b). A claim in a token is a photo from sign-in, and anyone who controls the token's
   issuer could write it.

</details>

## Think it through

### Found while building

- **The real check changed the design before any code.** authentik's full sync runs every four
  hours, not hourly (L7 asked again). After a 409 it searches and PUTs over what it finds (D4).
  Leaving a group arrives as a filter path (F7). And a group or user with no `externalId` unless the
  company's mapping sends one (F8).
- **Earlier steps' rules shaped the inputs.** Since step 05 an argument named `user` is refused, so
  a pushed user is an `account`. Since step 14 a list in an answer is a list of records, so a member
  is `{ "id": … }`. The cross-company suite asks every input to name its company, so both operations
  carry `company`, as `rate.load` does, and every attack on them is refused (333 swaps).
- **Step 16's map refused two first drafts.** A `SECURITY DEFINER` function that read the audit
  across companies for "last heard" (a door around row-level security); and a credentials table
  with a `tenant_id` and no row-level security. "Last heard" is now read as `dsor_runtime` inside the
  company, and the column is `company`, in a new kind of table, `shared-read`.
- **The real run found three gaps, each fixed red first.** A provider that had pushed to another
  server kept that server's ids, so every push to the new DSoR failed, and each failure, an ALLOW
  record, made the empty copy "current" (D2 now counts only a call that succeeded). The SCIM door
  answered an unknown token 401 by itself, so minutes of refused pushes left no evidence (now line ①
  refuses it and records it). An old copy was reported as a table that could not be read.
- **The run's own mistake.** The database tests ran against the database `pnpm serve` was using;
  their `pnpm directory-token` ended the token authentik held. The live run then used a database of
  its own.
- **A test of step 43 reads the shell, not `.env`.** `test/invitations.db.test.ts` reads
  `DSOR_MIGRATION_URL` from the environment, and `test/db-setup.ts` loads only `DSOR_DB_URL`; it
  passed in step 43b's runs because the shell had exported it. Fixed in step 43, and repeated in 43b
  and here: the test loads it from the step's `.env`.
- **The B1 prediction asked about the wrong person.** user_123 signed the agent's slip, so separation
  of duties refuses him whatever his roles. The break is about anyone else, such as jane_200.

### What the review found

A reviewer who had not seen the conversation read the step against DSOR-IDN-01, IDN-03a, IDN-04a,
IDN-04b, IDN-05, IDN-06, IDN-07, TEN-02b, and EXE-02, attacked it as an agent and a directory's network
would, and broke it in copies. Each finding was fixed red first, or decided again by the learner:

| # | Finding | Fixed |
|---|---|---|
| 1 | A username reused after a delete, under a new uuid, inherited the leaver's slips and approvals: the agent paid under `del_100`, a departed CFO's approval released a payment. And a person suspended and made active again before her slip's next use never had it suspended | An id this company had under another uuid is taken (memory, store, trigger); the push suspends slips itself (L8b) |
| 2 | PATCH operations applied as replace, add, remove whatever their order: an add before a replace made user_123 CFO. A replace whose value carried members dropped them in silence | Operations in their order; anything the door does not read is refused |
| 3 | A user with no `active`, or `null`, was read as active, and brought a leaver back | `active` is required |
| 4 | Refusals the door made itself left no record; a value that was no list threw, and the door dropped the connection | The translation never throws; every refusal goes to `call()` and is recorded |
| 5 | "Last heard" said the directory was alive, not that the copy matched it: a refused deactivation kept a leaver's roles while authentik retried | A refused push stops the copy until a push succeeds (L7b) |
| 6 | One issuer for two companies let one company's directory lock the other's person out of signing in | `pnpm serve` refuses a company on scim whose issuer another lists |
| 7 | A login linked before the company moved to its directory still named its person, and could not be unlinked | In a company on scim, the copy decides who a login is |
| 8 | The database refused a copy's user under another company's id, but not a person of DSoR's table under a copy's id | A trigger on `dsor.people` too |

And tests it asked for, which pass: another company's directory, and the agent's own calls, are no word
from org_456's directory; decision D4 for groups; `person.add` of an id only another company's copy
has. Mutations that had stayed green before (records of any company or any login counting as heard,
groups across companies, a group's `externalId` changing) now fail a test.

### Left open on purpose

- **One bad change in authentik stops a company (L7b).** By design: the lock stays locked. Its
  refused push is in the audit, and authentik shows the error.
- **Step 05's tokens of the directory logins (`tok_5c1a`, `tok_5c7b`) work on the agent's door.**
  For the tests, as every token of that table does; each route refuses them, and the SCIM door takes
  only the owner's hashed token (D3). Step 44 ends step 05's table.
- **Members sent as plain strings, not `{ value }`,** are refused with the input schema's message,
  which names a field the door did not send.
- **A credential is the owner's to make.** A company cannot rotate its own token.
- **Usernames must be DSoR ids.** A directory whose usernames are e-mail addresses is refused (D5).
- **L7 needs a setting outside DSoR.** authentik's default four-hour sync with PT2H refuses a quiet
  company for two hours in four; DSoR cannot check authentik's schedule at start-up.
- **Agents keep step 05's tokens** until step 44.

## The rules this step meets

| Rule | What it says | Spec | Tests |
|---|---|---|---|
| DSOR-IDN-01 | Every caller becomes a principal with a type and tenant memberships | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/login-by-uuid.test.ts`, `test/company-people.test.ts` |
| DSOR-IDN-03a | The call works only in a company the caller belongs to | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/directory-copy.test.ts`, `test/directory-push.test.ts`, `test/scim-door.test.ts`, `test/directory-copy.db.test.ts` |
| DSOR-IDN-04a | Roles are accepted only from an issuer or role source authoritative for the tenant | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/role-maps.test.ts`, `test/scim-door.test.ts`, `test/login-by-uuid.test.ts` |
| DSOR-IDN-04b | A claim from any other origin is never used | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/login-by-uuid.test.ts` |
| DSOR-IDN-05 | Each tenant configures a role source, such as directory synchronization | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/role-maps.test.ts`, `test/company-people.test.ts`, `test/table-commands.test.ts` |
| DSOR-IDN-06 | Authority not established within the staleness bound denies the command | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/company-people.test.ts`, `test/directory-push.test.ts`, `test/directory-copy.db.test.ts` |
| DSOR-IDN-07 | A delegator reported suspended or deprovisioned has every slip suspended | [§12](../../../specs/dsor/02-security.md#12-identity-and-principals) | `test/company-people.test.ts`, `test/scim-door.test.ts` |
| DSOR-TEN-02b | A cross-tenant suite attacks every operation with another company's URI: both new ones, 333 swaps | [§14](../../../specs/dsor/02-security.md#14-multi-tenancy) | `test/cross-tenant.test.ts`, `test/directory-push.test.ts` |
| DSOR-EXE-02 | The decision is recorded before the response, denials included | [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) | `test/directory-push.test.ts`, `test/scim-door.test.ts`, `test/table-commands.test.ts` |

**Next:** step 44, real logins for agents.
