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

## Found by the baby steps (added 2026-09-26)

19. **What does a query's answer look like?** Appendix A says `result-envelope` carries
    "command and query results", so DSOR-SCH-01 covers a query's answer. But a result
    envelope must name an outcome, and none fits a read. `COMMITTED`, `READY`, and
    `PENDING_APPROVAL` need a proposal and a payload hash. `VALIDATED` passes with only a
    `decision`, but it answers a `validate_only` dry run. DSOR-FRS-01a also asks every
    query result to state `observed_at`, the resource version, the connector, and the
    freshness delivered, and the closed schema has no field for any of them. Step 04's
    learner build answers a query with `{ data, correlation }` and records that this
    breaks DSOR-SCH-01. Does the result envelope need an outcome for a read, or does a
    query's answer need a schema of its own?
20. **Is a code's retry class the one in the §28 table?** DSOR-ERR-01a asks for "a code
    from this table ... a retry class". The error-envelope schema ties a class to a code
    for only three codes: `OUTCOME_UNKNOWN`, `RESOURCE_HELD`, and `BATCH_PARTIAL`. So
    `AUTHORIZATION_DENIED` with `safe_same_key`, "denied, try again at once", passes the
    schema. Should the rule say "the retry class the table gives that code", and should
    the schema tie all 32 codes? Two rows also carry a condition the schema cannot see:
    `DEPENDENCY_TIMEOUT` is `safe_same_key` only for queries and for commands that
    provably did not run, and `INTERNAL_ERROR` is `never` "for commands".
21. **Which caller does `principal_id` name, and which does `agent_id`?** DSOR-COR-01a
    carries both ids through connectors, audit, and events, and the correlation schema
    lists both. Nothing says what either one holds. The audit record already names the
    subject and the actor chain in its `identity` block. Its example sets only
    `agent_id`, even though the subject is `user_123`. §36 also sets `dsor.principal_id`
    in every database transaction, and does not say whose id it is. Step 05's learner
    build names an agent in `agent_id` and anyone else in `principal_id`, and records
    that as its own choice. Is `principal_id` the subject, and `agent_id` the agent in
    the actor chain? Which one does §36 set?
22. **What may a caller's own `request_id` hold?** §32 lets a caller send a `request_id`,
    and DSOR-COR-01a carries it into connectors, audit, and events. The schema asks only
    for a string. So a line break, a control character, a megabyte of text, an id in the
    form DSoR makes, or another caller's id all travel on unchanged. Step 05's learner
    build accepts 1 to 128 characters and refuses anything else with
    `VALIDATION_FAILED`, as its own decision, and never checks for repeats. It even
    echoes the caller's own text to a caller with no login. Should the specification
    bound the form of the correlation ids a caller sends, and say what DSoR does with a
    bad one? Must a request id be unique for a principal? The same goes for `task_id`,
    `trace_id`, and `session_id`.
23. **What does a membership's `scopes` hold?** §12 gives each tenant membership `roles`
    and `scopes`, and nothing else in the specification mentions membership scopes. The
    security context has `tokenScopes`, and DSOR-DEL-01b and DSOR-DEL-02 use token
    scopes. DSOR-IDN-04a accepts "role and scope assertions" only from an authoritative
    issuer. Step 05's learner build stores roles and leaves scopes out. Are membership
    scopes the scope assertions of DSOR-IDN-04a? How do they combine with token scopes
    in the intersection that DSOR-DEL-02 computes? Or should the field go?
24. **How does DSoR find an identifier inside the arguments?** DSOR-SRC-02b refuses a
    tenant, principal, or delegation id "inside operation arguments" that disagrees with
    the security context. An operation contract names its input schema, but marks no
    field as such an identifier. `bind` shows where a resource URI sits, and a URI
    carries its tenant. Nothing shows where a principal or a delegation id sits. Step
    05's learner build checks a list of field names: `principal`, `subject`, `user`, and
    six more. It misses other spellings, such as `principalId` or a nested
    `invoice.principal`. It also refuses an operation that uses one of those names for
    other data, such as the `subject` of an email. Should a contract mark the input
    fields that carry a principal, tenant, or delegation id? Then DSOR-SRC-02b could be
    checked exactly, and the injection suite of DSOR-SRC-01b could be built from the
    same marks.
25. **In which identity mode does an agent call at L1?** §0.2 calls L1 "a supervised
    trainee". §13.2 has three modes, and `direct` is for "a human or application, for
    itself", so it does not fit an agent. The rules that settle an agent's mode are all
    L2: DSOR-DEL-03a and DSOR-DEL-03b ask for a verifiable actor chain in
    `on_behalf_of`, and DSOR-DEL-07 asks for a delegation in `unattended`. But
    DSOR-IDN-02a, that an agent logs in with its own credentials, is L1. And the
    security context, which requires an identity mode, is an Appendix A artifact. So an
    L1 deployment can receive an agent's call with no rule that says which mode it is
    in, or what proves the person the agent works for. Step 05's learner build meets
    exactly this case: the agent logs in as itself, has no mode, and reads INV-1008
    just as `cfo_100` does. Must an agent at L1 call `on_behalf_of`? If so, should
    DSOR-DEL-03a be L1? Or does serving an agent need L2? Step 06's learner build shows
    what the gap costs. It gives the agent a stand-in role that grants `invoice:read`,
    until delegations arrive in step 18. Then anyone who can ask the agent can read
    what it reads: with the CFO role granting nothing, `cfo_100` is denied INV-1008
    directly, and gets it by asking the agent. That is T3, the confused deputy, for
    reads.
26. **May a refusal show that an operation exists?** DSOR-ERR-01b forbids an error
    that reveals "the existence or attributes of a resource the caller is not
    authorized to read". An operation is not a resource, so no rule covers it. Step
    06's learner build refuses an unknown name with `UNSUPPORTED_CAPABILITY`, and a
    known operation the caller may not call with `AUTHORIZATION_DENIED`, naming the
    permission it needs. So any caller who can log in can list which operations exist,
    and what each one needs. Should an operation the caller may not call be refused
    exactly like one that does not exist? Should DSOR-ERR-01b cover operations too?
27. **May one permission grant another?** §15 fixes the form `<resource>:<action>`,
    with an optional `.propose`, and §7.3 says what the `.propose` form allows. The
    pattern refuses `*`, so a wildcard is out. Nothing says whether a permission may
    imply another, for example whether `invoice:issue` grants `invoice:read`. Step
    06's learner build grants a permission only for the very same text (its decision
    2). Is that DSoR's rule, or each deployment's choice? If one permission may imply
    another, where is that written down, so that someone can review it?
28. **Where is an operation's input schema defined?** Every contract names one, such as
    `PaymentExecutionRequest` in §7, and line 6 of §21 validates the input. But neither
    Appendix A nor the schemas package defines any input schema, and nothing says where
    one lives, how a contract's name finds it, or whether it must close its top level
    with `additionalProperties: false`, as every Appendix A schema does. Step 07's
    learner build keeps its own, `InvoiceGetRequest` and `InvoiceIssueRequest`, in a
    folder beside the contracts. Its start-up refuses an input schema that lets unlisted
    fields through, and one that no contract names. Should the specification say where
    input schemas live, and require them to be closed?
29. **Which code does an unknown field that names a principal get?** DSOR-SRC-02b asks
    for `TENANT_MISMATCH` or `AUTHORIZATION_DENIED` when a principal id in the arguments
    disagrees with the security context. Step 07's learner build refuses every field its
    input schema does not list, at line 6. So `as_user: "cfo_100"` is refused, but with
    `VALIDATION_FAILED`. DSoR cannot tell that a field it does not know names a
    principal. This is question 24 seen from the other side. Is a closed input schema
    enough to meet DSOR-SRC-02b, whatever the code? Or must a contract mark the fields
    that carry a principal, so that each one gets the rule's own code?
30. **At which line of the pipeline does DSOR-SRC-02b's tenant check run?** A canonical
    URI in the arguments carries its tenant, as in `dsor://org_999/invoice/INV-1008`.
    Line 6 of §21 checks only the URI's shape, as `resourceUri` does, so the URI passes.
    Line 2 resolves the tenant, but runs before the input is validated. Line 9 reads the
    bound state, and `bind` shows where the URI sits. Step 07's learner build answers
    user_123 with "not built yet" for that URI, and leaves the check to step 10. Should
    §21 say which line compares a tenant inside the arguments with the resolved tenant,
    so that no interface can skip it?
