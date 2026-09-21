# Open questions

Things the specification decided provisionally, or has not decided. Each is a question
for a human. An agent may gather evidence; it does not settle these alone.

## Provisional numbers

1. **The §44 ceilings.** Five seconds for a kill switch, one hour of role staleness,
   seventy-two hours of approval validity, and the rest are the editor's proposals
   (AGENTS.md → decision 10). They need measurement in a real deployment. Which are
   too tight for a small tenant on a cheap host? Which are too loose for a bank?

## Design choices that deserve a second opinion

2. **Owner-approval mode at L3** (§16.2). The first instinct was to forbid it at L3.
   That would stop a sole proprietor from ever letting an agent pay a bill, so it is
   allowed with a ceiling, a cooling-off period, step-up authentication, a
   DSoR-rendered payload, and a second-channel notification. Is that set of
   compensating controls enough for an auditor?
3. **CEL over Rego** (§17.3). Chosen because a control condition is an expression
   inside a record, and CEL terminates. `@marcbachmann/cel-js` 8.0.0 ran the spec's
   vectors with flat `dsor_*` functions on 2026-09-19. Not yet checked: its behavior
   with `now`, with large lists, and its error types for DSOR-CTL-07.
4. **A recorded DENY is replayed for the same idempotency key** (§22). After a human
   fixes the permission, the caller needs a new key. Is that the behavior users
   expect, or should denials not claim a key?
5. **An invalidated proposal ends.** When re-evaluation finds a new `REQUIRE_*`
   outcome, the proposal becomes `INVALIDATED` and the caller proposes again (§26.4).
   The alternative, returning to `PENDING_APPROVAL` for the extra approval, is kinder
   to users and harder to reason about.
6. **Compound actions under one MUST.** A few requirements join closely related
   actions ("detect, mark stale, and notify"). Should they be split further?

## Not yet specified

7. **How DSoR learns that KSoR published a new policy version** (DSOR-CTL-03a says
   "detect"; it does not say subscription or polling, or what KSoR must expose).
8. **The conformance suite's shape.** One test per id is the goal. Is it a vitest
   package that targets any DSoR over HTTP and MCP, or a harness each implementation
   embeds?
9. **The rate source contract.** §9 names a tenant rate source. What interface does it
   have, and how is a stale or missing rate reported?
10. **Tokenized fields as command inputs** (DSOR-CLS-02c). The rule exists; the token
    format and lifetime do not.
11. **MCP catalog size.** §38.1 recommends domain-scoped endpoints. Nothing has
    measured tool-selection quality against catalog size for this vertical.
12. **The reference control-plane store shares a PostgreSQL cluster with the
    operational store** so that DSOR-EXE-04a can commit atomically. What is the story
    when the system of record is SAP?

## The context providers (added 2026-09-20, decision 12)

13. **Does Graphiti hold up on real payment-run episodes?** Nothing has been run. Before
    the binding is frozen, feed it a few weeks of masked run logs and check: does the
    closed fact-type list keep operational state out (DSOR-CTX-07), or does state leak
    in through free-text summaries and community descriptions?
14. **What is the closed list of fact types?** A first proposal: Lesson, Preference,
    CounterpartyBehaviour, TaskOutcome, FailureCause. Who owns the list, and does
    changing it need review the way a control does?
15. **Which extraction model satisfies DSOR-CTX-08 for a tenant whose egress policy
    denies external providers?** A local model changes extraction quality. How much?
16. **A graph database on a student laptop.** FalkorDB or Neo4j beside PostgreSQL is a
    real cost for the target audience. Is there a light mode for the class project,
    and is memory even part of the class project? (No build stage needs it.)
17. **Erasure in a graph.** DSOR-RES-05 assumes values can be made unreadable by
    destroying a key. Extracted facts, summaries, and embeddings derived from an
    episode are not encrypted per subject. What does erasure of one person mean there?
18. **Two tenant-isolation models.** Graphiti partitions by group id, a filter. OpenViking
    has tenant, user, and agent scopes of its own. The cross-tenant test suite for the
    stack has to cover both, through the adapter.

## The tutorial's platform (added 2026-09-21, decision 14)

19. **Does Better Auth's OAuth server support token exchange (RFC 8693)?** DSOR-RP-03
    needs a token that names a person and the agent acting for her. Better Auth 1.7
    documents authorization code, refresh, client credentials, and device grants, and
    an extension point for new grants. Token exchange was not found in its
    documentation on 2026-09-21. Step 45 may have to add it as an extension.
20. **Does it support `private_key_jwt` for clients?** DSOR-RP-10 forbids a shared
    secret for unattended agents. Better Auth's schema has a client-assertion table,
    which suggests yes. Confirm before step 44.
21. **What can a Managed Better Auth token say?** DSoR wants to check the audience as
    well as the issuer. Whether the managed JWT plugin lets us set an audience is not
    yet known. Managed Better Auth also does not yet support a front end and a back end
    deployed separately, which is the shape of an approval screen calling DSoR.
22. **Two issuers, one person.** The (issuer, subject) → principal table is simple and
    safe. Is it acceptable to operators, or should the tutorial use one self-run Better
    Auth for people too and keep the managed service for a later, optional step?
23. **Step-up sign-in.** Owner-approval mode (§16.2) needs a fresh second factor. The
    managed service lists multi-factor sign-in as coming soon, so step-up exercises use
    the self-run server for now.
24. **Database tests in CI.** Tests on a Neon branch need an API key in CI secrets and a
    branch per run. Pull requests from forks cannot see secrets. What runs for them?
25. **Learners with poor connectivity.** Steps 09 to 42 work on a local PostgreSQL.
    Steps 43 onward need Neon. Is there an offline path for sign-in, or is that the
    honest limit?

