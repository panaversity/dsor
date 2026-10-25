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
- **L8. `active: false` suspends; `DELETE` deprovisions (the learner's).** Either way the person's
  next call is refused, and their slips are suspended at their next use, by step 19b's path
  (DSOR-IDN-07). A suspended person can come back. *Downside:* until that next use, a listing still
  shows the slips as active.
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
  (Claude Code).** The latest `ALLOW` record of the directory login in that company, by the database's
  clock. The quiet sync's reads count (F3). No new timestamp that anything could set by hand.
  *Downside:* reading the audit at each call of a person of that company; an index keeps it short.
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

### The claims

| | Claim |
|---|---|
| C1 | `role-sources.json` may give a company the kind `scim`. `role-maps.json` gives each such company its map: a group's id, its name, and a role `roles.json` has that is no system login's. Start-up refuses a map that is wrong, a map for a company not on `scim`, and a `scim` company with no map |
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
| C1 | The shipped files start; a map naming a role `roles.json` lacks, a system role, a group id that is no uuid, a company not on `scim`, and a `scim` company with no map are each refused at start-up |
| C2 | No token, a wrong token, and another company's token; a path outside `/scim/v2/`; a host not named |
| C3 | authentik's own requests, from the real check: the first sync, a change, a deactivation, a group leave by filter path, a delete, a double post, a search after `409`; another company's id, row, and search |
| C4 | cfo_100 pushed into Finance-Approvers approves INV-1008; removed from the group, she cannot; user_123 made inactive: his agent's payment is refused and del_100 suspended; deleted: the same; back active: his next call works |
| C5 | Two hours and a minute after the last push or read, the agent under user_123's slip is refused; a read by the directory makes the copy current again |
| C6 | A token whose `sub` is cfo_100's uuid is cfo_100; another company's uuid, an unknown uuid, and a deleted user's uuid are no caller |
| C7 | Each of the eight, for org_456 on `scim`, answers that its people come from its directory; for org_789 on DSoR's table, each works as in step 43b |
| C8 | The database refuses a write in another company, a changed DSoR id or `externalId`, a taken id, and a credential written by `dsor_runtime` |

### The breaks

| Break | What it changes |
|---|---|
| B1 | The map is read by the group's name, not its id |
| B2 | The company is taken from the URL, not the token |
| B3 | The copy's age is never checked |
| B4 | `active: false` is read as active |
| B5 | Any bearer token is taken |
| B6 | A search shows every company's rows |
| B7 | A login is linked by the token's `preferred_username`, not its `sub` |
| B8 | The taken check is gone |
| B9 | Step 43b's commands are not refused for a `scim` company |

The rest of this README is written as the step is built: what changed, how to run it, the breaks
for real, and what the review found.
