# Our decisions (the mj_ builds)

The decisions behind our learner builds, in one place: what was decided, why, what it costs, what
was rejected, and who decided. Entries are numbered and dated. A number is never reused, and a
decision that is reversed stays here, marked superseded, as in [`AGENTS.md`](../../AGENTS.md).

This file starts on 2026-10-26, with the identity work that leads to step 45. Older decisions stay
where they were made: see "Earlier decisions" at the end.

**Who decides.** The learner decides, and Claude Code recommends. Where Claude Code chose, the
entry says so, and the learner can still reverse it.

## 1 · The sign-in server holds who has which role (2026-10-26)

**Decided by:** the learner, on Claude Code's recommendation (step 43d, Q1).

- **What.** People, membership, and who holds which role in which company live in the company's
  sign-in server. DSoR keeps what each role may do (`roles.json`), the slips, the rules, the
  approvals, and the evidence.
- **Why.** A copy of the people in DSoR drifts. A person who left keeps acting until someone edits
  DSoR too.
- **Cost.** DSoR depends on that server, and whoever runs the company there can grant money roles.
- **Rejected.** People and roles only in DSoR's own table. That stays as the kind for a company with
  no directory (entry 8).

## 2 · DSoR asks at every call (2026-10-26). Superseded by entry 11

**Decided by:** the learner (step 43d, Q5).

- **What.** Lines ② and ③ asked the sign-in server at every call. The kept answer counted only when
  no answer came.
- **Superseded on 2026-10-28** by entry 11: a flood of agent calls became a flood of lookups.

## 3 · An answer says whom it is about, and "no answer" is not a fault (2026-10-26)

**Decided by:** the learner (step 43d, Q6).

- **What.** An answer counts only when it names the company and the person DSoR asked about. A
  `429`, a `5xx`, a timeout, or no connection means "cannot answer now": the kept answer counts
  until the bound. Any other reply is a fault: `INTERNAL_ERROR`, and the kept answer is dropped.
- **Why.** A misrouted answer, or an error page, must never read as "still employed".
- **Cost.** A server bug that returns a wrong body stops the agents at once. That is the safe side.
- **Now** part of the proposal for the specification (entries 10 and 17).

## 4 · A person's own call asks too (2026-10-26)

**Decided by:** the learner (step 43d, Q7).

- **What.** A caller's roles come from the lookup, not from their token. One rule for every caller.
- **Why.** A token's roles are a photo from when it was made, up to an hour old.
- **Cost.** One lookup for each person who calls, as well as for each slip's signer.

## 5 · One hour, with an alert at once (2026-10-26)

**Decided by:** the learner (step 43d, Q8).

- **What.** `max_staleness` is one hour for both stories. At the first `FRESHNESS_UNSATISFIABLE`, the
  company's alert receivers hear.
- **Why.** One hour meets the L3 bound of DSOR-IDN-06.
- **Cost.** A sign-in server that is down for more than an hour stops agents and approvals.

## 6 · A DSoR rule must hold for four kinds of company (2026-10-28)

**Decided by:** the learner, who called out design bias.

- **What.** Before a choice becomes DSoR's rule, it is checked against four companies: (1) one on
  Okta or Microsoft Entra, which sends SCIM; (2) one with a sign-in server it built; (3) a small team
  with no directory; (4) Panaversity, on Better Auth. A choice that holds only for (4) is the
  Panaversity SSO's setup, and it is recorded with the SSO.
- **Why.** The only real server we had run against was shaping DSoR's questions.
- **Cost.** Every design question takes one more pass.

## 7 · DSoR owns the role names, and keeps no role map (2026-10-28)

**Decided by:** the learner.

- **What.** DSoR names the roles and says what each may do (`roles.json`). The company's directory
  gives people those names: an app role, SCIM's `roles` attribute, or a group made for DSoR. DSoR
  reads them as they come, and a name it does not define grants nothing (DSOR-AUT-01b).
- **Why.** A naming problem belongs to the sign-in server and is fixed there. A map in DSoR is a
  second place to manage roles. Microsoft Entra's app roles work the same way.
- **Cost.** Each company names its roles DSoR's way in its directory.
- **Rejected.** A role map for each company (step 43c's `role-maps.json`, which stays in 43c); a
  `roles.json` for each company; Better Auth's table of roles for each company, for now.

## 8 · Each company chooses its role source, and there is no default (2026-10-28)

**Decided by:** the specification (DSOR-IDN-05, and the tenant policy's required `role_source`),
confirmed by entry 6.

- **What.** SCIM for a directory that sends it; the lookup for a server that answers DSoR's
  contract; DSoR's own table for a company with no directory.
- **Rejected.** One default kind, which fails at least two of the four companies; and a hub, where
  every company's directory feeds the Panaversity SSO. A hub holds only for Panaversity, and that one
  server down for more than an hour would stop every company's payments.

## 9 · DSoR writes the lookup's contract (2026-10-28), D1

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** The lookup follows a question and an answer of DSoR's own, the same for every sign-in
  server. The Panaversity SSO is the first server to answer it.
- **Why.** No standard serves this question, and one server's own API would tie DSoR to that server.
  Better Auth's own member route answers only a signed-in member, and its `403` means both "this
  person left" and "you are not a member".
- **Cost.** The SSO's route had to change (done in #1331). The contract waits in a proposal
  (entry 17).
- **Rejected.** The SSO's route as it was; SCIM only, which fails a home-built server and Better
  Auth.

## 10 · Two rules for every role source (2026-10-28), D2

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** Proposed as MUST rules for §12.1: an answer counts only when it names the tenant and the
  person asked about; a reply that is neither an answer nor "cannot answer now" refuses the request
  with `INTERNAL_ERROR` and drops the kept answer. The replies that mean "cannot answer now" go in the
  contract's binding. "Role names are DSoR's" goes in as a common mistake, not as a MUST.
- **Cost.** Two more rules to test, for every role source that answers.

## 11 · An answer is reused for up to 10 seconds (2026-10-28), D3

**Decided by:** the learner, on Claude Code's recommendation. Replaces entry 2.

- **What.** DSoR reuses a person's answer for up to 10 seconds, then asks again.
- **Why.** At every call, 500 agent calls a minute made 500 lookups. The server answered `429`, DSoR
  kept its last answer for up to an hour, and a role removed at 1:55 kept working until about 2:55.
- **Cost.** A person who left is caught within 10 seconds, not at the very next call.
- **Rejected.** A `429` as a fault (a flood that times out the server still keeps the old answer); a
  shorter bound for `429` only; keeping the hour as it was.

## 12 · The answer's shape (2026-10-28), D4

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** DSoR asks with `tenant` and `person`, using that company's own key. The answer holds
  `tenant`, `person`, `status` (`active`, `suspended`, or `gone`), `roles` (DSoR's names, empty unless
  `active`), and `as_of` (when the server read its data).
- **Why.** `suspended` and `gone` are the two cases of DSOR-IDN-07. `as_of` lets DSoR refuse an answer
  older than the bound, and it fills the spec's `subjectAuthority.asOf`.
- **Rejected.** Four states, as the SSO had (its two kinds of `gone` came from one server); two states
  with no `as_of`.
- **The learner's questions on the way.** DSoR sends the company and the person: line ② takes them
  from the token and the request's company, and line ③ from the slip. `roles.json` is not a second
  place to manage roles: the directory says who holds a role, and DSoR says what the role may do.

## 13 · One test list for every role-source adapter (2026-10-28), D5

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** Every adapter passes the same tests: a person who left is refused at the next ask, and
  the slips they signed are suspended; an answer older than the bound is refused; an answer about
  someone else never counts; an unclear reply is a fault.
- **Why.** A new adapter could pass its own tests and still let a leaver through.
- **Cost.** Step 45 writes its tests in a shared form.

## 14 · The timer jobs keep their keys for now (2026-10-28), D6

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** `dsor-scheduler` and `dsor-rates` keep their fixed keys in step 45, with a note. A later
  step runs them inside DSoR, and the `scheduler` and `rate_loader` roles go.
- **Why.** Step 45 keeps to one idea.
- **Cost.** Two fixed keys live a step or two longer.

## 15 · A stand-in answers the contract in tests (2026-10-28), D7

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** `pnpm start` and the older tests use a small stand-in that answers DSoR's contract. The
  people's rows in `src/principals.ts` and the fake staff directory go. The live run still asks the
  real SSO.
- **Cost.** Many older tests change in step 45.

## 16 · The contract's form in the specification (2026-10-28)

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** Three reference-profile rules (the request; what counts as an answer; what means "cannot
  answer now"), a JSON Schema for the answer, and an `as_of` up to one minute ahead of DSoR's clock
  read as now. More than a minute ahead is a fault.
- **Rejected.** A description with no rules; prose with no schema; any future `as_of` as a fault (a
  clock two seconds fast would stop every agent); DSoR's own time in place of `as_of`.

## 17 · A change to the specification is a proposal (2026-10-28)

**Decided by:** the learner.

- **What.** On this branch, a change to the specification is written in `mj_notes.md`, "Proposals
  for the specification". All proposals go to the specification together, later, in a pull request
  of their own. Until one lands, a step titles its tests by its own decisions, never by a
  requirement id the specification does not have.
- **Why.** The specification changes only through its own reviewed pull request.
- **History.** The lookup contract was first written straight into the specification (`e2f6965d`)
  and reverted the same day (`d32c5679`). That commit still holds the full text.

## 18 · No SSO setting named after DSoR (2026-10-28)

**Decided by:** the learner.

- **What.** The SSO keeps `OAUTH_MCP_AUDIENCES`, which lists DSoR's audience as before. A rename to
  `OAUTH_DSOR_AUDIENCES`, with a migration 0015 for one-hour DSoR tokens, was dropped.
- **Why.** A general sign-in server should not name one product: the same bias as entry 6. DSoR does
  not need it, because step 44 refuses any token older than `max_age` after its `iat`, one hour in
  its `sign-in.json`.
- **Cost.** The learner dislikes `OAUTH_MCP_AUDIENCES` too. It stays for now.

## 19 · The SSO review's fixes: four kept, one dropped (2026-10-28)

**Decided by:** Claude Code, as lead, at the learner's word ("keep what you want"), with entry 18
decided by the learner.

- **What.** The #1333 session had reviewed #1331 and left five fixes uncommitted. Four are committed
  on #1331 and pushed (`9081c0a24`): migration 0013 stops at its first error; the lookup limits
  refused keys (20 in 60 seconds from one address), but never a key that verified in the last 15
  minutes; a DSoR role in an invitation counts only if its sender is still an owner when it is
  accepted; the unused `dsor:lookup` scope is removed.
- **Why.** Each fixes a real gap, and CI's whole SSO job passes on them.
- **Dropped.** The fifth fix (entry 18).

## 20 · The answers live in DSoR's PostgreSQL (2026-10-28), D8

**Decided by:** the learner, on Claude Code's recommendation, from the learner's question about load.

- **What.** One table of answers (tenant, person, status, roles, `as_of`, when received). It holds the
  10-second reuse and the kept answers.
- **Why.** Every DSoR server shares it, it survives a restart, and it is the evidence a decision
  bundle needs: "`user_123` held `ap_supervisor` as of 01:55".
- **Cost.** One indexed read for each call, and one write for each lookup, in the store DSoR already
  has.
- **Rejected.** Each server's memory (four servers ask four times, disagree for up to 10 seconds, and
  lose the kept answers on a restart); Redis (a new service, which may evict a kept answer).

## 21 · One lookup in flight for each company and person (2026-10-28), D9

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** On each server, while a lookup for a company and a person is in flight, other calls for
  the same pair wait for its answer.
- **Why.** When a busy person's answer expires, 50 calls in flight would send 50 identical lookups.
- **Cost.** A little code, and a waiting call is only as fast as that one lookup.
- **Built in** step 45b (entry 23).

## 22 · A 2-second timeout, no retry, and a pause after five failures (2026-10-28), D10

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** A lookup waits at most 2 seconds and is never retried. After five failures in a row, DSoR
  stops asking that company's server for 10 seconds and uses its kept answers, up to the one-hour
  bound.
- **Why.** Retries multiply the load exactly when a server is weakest.
- **Rejected.** A timeout with no pause; retries with backoff.
- **Built in** step 45 (the timeout) and step 45b (the pause), as entry 23 splits them.

## 23 · Step 45b protects the sign-in server (2026-10-28)

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** Step 45 holds D1 to D8, and D10's 2-second timeout with no second try. A new step
  45b, "Protect the sign-in server", holds D9 (one lookup in flight) and D10's pause after five
  failures.
- **Why.** Each step teaches one new idea. Asking the server is one; protecting it under load is
  another. Step 45 keeps the timeout, because "a timeout means the server cannot answer now"
  needs one.
- **Cost.** One more step in the map, and one more copy.
- **Rejected.** All of D1 to D10 in step 45, which is two ideas at once; and D8 to D10 in step
  45b, which gives the same answers two homes, built twice.

## 24 · Each company's lookup address is in a file, and its key in the environment (2026-10-28), D11

**Decided by:** the learner, on Claude Code's recommendation, from checking step 45's design.

- **What.** `lookups.json` names each company's lookup address. Each company key comes from an
  environment variable, such as `DSOR_LOOKUP_KEY_ORG_456`. Start-up refuses a company that has a
  lookup and no key.
- **Why.** The specification's `role_source` setting holds only `kind` and `max_staleness`, and
  DSOR-SCH-02 keeps our own fields out of it. A key in a file is readable by whatever reads the
  folder, and DSOR-CNR-02 forbids that.
- **Rejected.** The address under `extensions` in `role-sources.json`; every setting in the
  environment.

## 25 · The proposal's schema lives in its own folder (2026-10-28), D12

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** `proposals/role-source-answer.schema.json` in step 45. `schemas/` keeps only the
  specification's copies, byte for byte, so a reader can tell a rule from a proposal by where the
  file is. When the proposal lands, the file moves to `schemas/` unchanged.
- **Rejected.** The proposal in `schemas/`, with a note.

## 26 · An answer is as old as the earlier of two times (2026-10-28), D13

**Decided by:** the learner, on Claude Code's recommendation.

- **What.** An answer's `as_of` is the earlier of the server's `as_of` and the moment DSoR asked.
- **Why.** Step 19's decision 14 says an answer is never later than the moment DSoR asked; D4 adds
  the server's own time. Together, an answer read three hours ago counts as three hours old, and
  one up to a minute ahead counts as the moment DSoR asked.
- **Rejected.** The server's time only (a clock ahead makes an answer look fresher); DSoR's time
  only (a cached answer looks fresh, which is break B3).

## 27 · The company key travels as Authorization: Bearer (2026-10-28), D14

**Decided by:** the learner, on Claude Code's recommendation, while step 45's test server was
written.

- **What.** DSoR sends each company key as `Authorization: Bearer <key>`.
- **Why.** The proposed contract said only "a credential for that tenant alone". The HTTP
  standard for a credential (RFC 6750) works for any server, and keeps a product's habit out of
  DSoR's contract (entry 6).
- **Cost.** The Panaversity SSO's route reads `x-api-key` today, and must read Bearer too.
- **Rejected.** `x-api-key`, Better Auth's habit; a header that each company sets.

## 28 · With no person in DSoR's table, start-up reads no one's job (2026-10-28), D15

**Decided by:** Claude Code, during step 45's build, on its own recommendation. **Waits for the
learner's review.**

- **What.** D7 took the people out of DSoR's own table. Three checks read a person's job there, and
  now read only what DSoR itself knows. A slip's signer is refused at line ③ only when DSoR's table
  names her as an agent, an application, or a timer job; anyone else, her company answers for. A
  control's owner, and `alerts.json`'s escalation person, are refused only when DSoR's table names
  them as no person. A receivers role must be in `roles.json` and hold `alert:read`. Whether a
  person works in the company, and in which job, her company says when she acts, at line ②.
- **Why.** Asking the company at start-up proves a membership at one moment only, and makes DSoR's
  start-up wait on the sign-in server. A control's owner switches it on in person, so line ② checks
  her then.
- **Cost.** A company's server decides who is a person: a service account it lists as an active
  member can sign a slip (step 19's decision 13 guarded against that). And start-up no longer
  catches an escalation to someone who cannot settle a payment (step 38b's review, M3).
- **Rejected.** Keeping a list of people's ids in DSoR, which D7 removed; asking each company's
  lookup at start-up.
- **The review's attack (2026-10-28).** A service account that the company's SSO lists as an
  active member, with a role, signs in through `dsor-people` and acts in direct mode: it reads
  unmasked, drafts with no slip, and approves as a CFO. The answer says nothing about the kind of
  account. An escalation can go to someone who cannot see alerts. And a company's lookup may sit on
  another server than the token's issuer, which may give the same id to someone else.
- **Proposed, for the learner:** the answer carries `kind`, and DSoR acts only on `person`; the
  sweep asks the lookup about the escalation person; start-up refuses a lookup whose origin is not
  the issuer's.

## 29 · Q8's alert is not built in step 45 (2026-10-28)

**Found by:** Claude Code, after step 45's build. **Waits for the learner's decision.**

- **What.** Entry 5 says that at the first `FRESHNESS_UNSATISFIABLE`, the company's alert receivers
  hear. Step 45 refuses the call and records it, but raises no alert.
- **Why.** In this tutorial an alert belongs to a proposal (step 38b). A sign-in server that cannot
  answer has no proposal, so it needs a kind of alert of its own.
- **Proposed.** Build it in step 45b, which is about a server that is down, or in a step of its own.

## Open

- **The SSO writes a key's row on every check.** Better Auth updates `updatedAt` each time, so all
  of one company's lookups write one row. At high volume the SSO could check DSoR keys without that
  write. That is the SSO's choice.
- **Six points from the SSO's review:** a `user_deleted` row keeps the deleted user's email; deleting
  a company revokes its keys with no record; the lookup answers for a disabled company; batched
  history writes can leave gaps; a failed rollback can leave a live, unrecorded key; the client-IP
  parsing is copied three times. The limit's address also trusts the first `X-Forwarded-For` hop,
  which a caller can fake.
- **Back in the chain later:** the SCIM door (step 43c) and DSoR's own people table (step 43b), as
  role-source kinds; the timer jobs inside DSoR (entry 14).
- **The proposals** go to the specification together (entry 17).

## What we know about production (2026-10-28)

- **The `mj_` builds are teaching code.** Each step is a folder of its own, written to be read. The
  real implementation, `@panaversity/dsor`, is not started ([`docs/status.md`](../status.md)). It is
  built in the five stages of [`docs/learn/learning-path.md`](../learn/learning-path.md).
- **After step 45, steps 46 to 53 remain:** who may approve and up to how much, the approval door,
  the agent door (with its two traps and a real agent), an agent with nobody present, the right
  people hear, and part 7.
- **On a host such as Google Cloud Run,** several servers run at once, and they stop when idle:
  - State lives in PostgreSQL (entry 20), not in a server's memory. Cloud SQL fits.
  - Timed work (sweeps, rates, the outbox sender) gets no CPU between requests by default. It needs
    Cloud Scheduler and Cloud Run jobs, or CPU that is always on.
  - DSoR's public https address goes in its settings, because the token check compares it.
  - Each company's DSoR key goes in a secret store, such as Secret Manager, that the agent can never
    read (DSOR-CNR-02).
- **The SSO side:** #1331 is a draft. It needs GitHub's billing fixed, its CI green, and migrations
  0013 and 0014 applied by hand in production before it merges.

## Earlier decisions

Before 2026-10-26, decisions were recorded where they were made:

- each step's README, in "The design, before any code" and "Think it through";
- [`mj_notes.md`](mj_notes.md), in sections such as "Step 19, the design", "Step 23, the decisions
  and the build", "Step 26, understanding and the decisions", "Step 31, check again at execution",
  "Step 33, the decision bundle", "Step 43c's design, the learner's answers", "Step 43d's design,
  the learner's answers", "Step 44's design, the learner's answers", "The reopened answers,
  decided", "The extended chain, with three decisions", and "Better Auth 1.7 against the chain";
- the map, [`readme_mj.md`](readme_mj.md).

The entries above repeat the decisions from step 43d on, so this file can be read alone.
