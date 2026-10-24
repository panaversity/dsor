# Why step 43b: people and roles in DSoR's table

The learner's note for step 43b, written on 2026-10-24 from the conversation that decided it. The
step itself is [`mj_43b_people_and_roles`](mj_43b_people_and_roles/README.md).

## The problem

After step 43, a person signs in for real, but who works for a company, and in which job, is still
written in code: `src/principals.ts` for a person on the call, and a fake directory in code for an
absent signer. A run on step 43's code showed it: admin_100 could not hire jane_200 at all, and after
user_123 left and admin_100 unlinked his login, the agent still paid INV-1009 under the slip he
signed, because the directory in code still called him an active AP supervisor.

## The questions the learner asked

- **"Is it prebuilt in Managed Neon Auth, as Better Auth offers this?"** Partly. Neon Auth's
  Organization plugin is in beta and has three fixed roles, owner, admin, and member, with no custom
  roles, so it cannot say "CFO" or "AP supervisor". Self-hosted Better Auth can.
- **"If we go with DSoR's table, is a company that already uses Better Auth stuck?"** No. The choice
  is per company, as `issuers.json` already is, and the specification names three kinds of role
  source: directory synchronization (SCIM), an identity-provider lookup, and DSoR-held role
  assignments (DSOR-IDN-05). A company that keeps its people elsewhere names that source, with a
  role map; a company with nothing uses DSoR's table.
- **"With 500 people and 15 roles that change any time, how does DSoR keep up?"** Losing a role is
  the urgent direction. Three ways: ask at every call, keep a copy that the company's system updates
  (SCIM or a webhook) with a full re-read now and then, or keep a copy and check live before a risky
  call. §44 bounds an absent signer's authority (24 hours at L2, 1 hour at L3, DSOR-IDN-06); it sets
  no bound for a person on the call, which is a gap.
- **"Is it custom config: Neon-like auth uses DSoR roles, otherwise configure yours?"** Yes, with one
  correction: a company may only make the settings stricter, never looser than DSoR's limits, and
  what a role may do always stays in DSoR's rules.
- **"But a token can carry roles?"** Yes. DSOR-IDN-04a allows roles from a token issuer configured as
  authoritative for the company. Step 43 reads none, because Neon's `role` is one value for the whole
  sign-in service. A company's token roles are a decision for step 43c.

## The decisions

Claude Code recommended splitting the work: 43b, DSoR's own table; 43c, a company's own source, which
the learner will build with a real single sign-on server. The learner said "ship 43b", and answered:

- **L1. Powerful roles:** a role that may approve or change people and roles, read from `roles.json`.
- **L2. A second administrator confirms with `role.confirm`.** The learner first chose to reuse
  payment approvals; Claude Code found that step 31 never releases DSoR's own work, so that would
  need a second new idea first, and the learner chose the small command.
- **L3. The owner makes the first administrators:** `pnpm grant` gives `tenant_admin` only, while a
  company has fewer than two. The learner first chose "the owner confirms"; Claude Code found that
  the owner is no person DSoR knows, so it cannot be an approval.
- **L4. Removing is one administrator, at once.**
- **L5 and L6** came from the recommendations: one table read twice, and roles that mean what
  `roles.json` says.

## Still to settle

- Step 43c: a company's own role source, with a role map, its freshness, and token roles.
- A bound for how fresh a person-on-the-call's roles must be, which §44 does not set.
- Whether a quorum of two administrators should also be asked for removing an administrator.
