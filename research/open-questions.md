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
    `trace_id`, and `session_id`. Step 09's learner build found a cost of saying nothing:
    PostgreSQL's `jsonb` refuses the NUL character and half of an emoji. An id holding
    one made the decision record fail, so the call was refused as
    `EVIDENCE_STORE_UNAVAILABLE` and left no record at all, from a store that was
    healthy. The build now also refuses an id that is not well-formed text or holds a
    control character, and records that refusal.
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
31. **What does the record say when the store saved it, and the reply was lost?**
    DSOR-EXE-03b sends `EVIDENCE_STORE_UNAVAILABLE` when the control-plane store cannot
    accept the decision record. A database can accept the record and then lose the reply
    that says so: the connection drops after the commit. DSoR then believes the write
    failed. The caller hears `EVIDENCE_STORE_UNAVAILABLE`, while the log holds a record
    that says `ALLOW` with the result `ok`. Step 08's learner build keeps its log in
    memory, where this cannot happen, and leaves it to step 09. Must the decision record
    say what the caller heard, so a second record is needed when the write's outcome is
    unknown? Or is a decision record that DSoR could not confirm treated like an intent
    record with no outcome (DSOR-EXE-04b), and reconciled later?
32. **What does a failed read at line 9 answer, and what does its record say?** Step 09's
    learner build reads INV-1008 from PostgreSQL at line 9. When the database is down,
    the caller hears `INTERNAL_ERROR`, retry `never`, and the record says `ALLOW`,
    because DSoR's checks let the call reach its code. §28 has `CONNECTOR_UNAVAILABLE`,
    which says the source is down and invites a retry. Must a read that fails at line 9
    answer `CONNECTOR_UNAVAILABLE`? And should the record tell "allowed, and answered"
    apart from "allowed, but the read failed"?
33. **What does "durably" mean in DSOR-EXE-02?** Step 09's learner build answers only
    after PostgreSQL has committed the record, and proves that the record survives when
    every connection is closed and new ones are opened. That is a restart, not a crash.
    §47 asks for fault injection. The rule does not say whether "durably" means
    committed on one server, flushed to its disk, or copied to a second machine. Neon,
    for example, confirms a commit only once its storage has the change. Should §21 or
    §30 say what durable means, and should §47 name the test: kill the process right
    after the answer, and find the record?
34. **Where may the migration role's credential live?** §36 separates `dsor_migration`,
    which owns the tables, from `dsor_runtime`, which the program runs as. It does not
    say where the migration credential is kept. Step 09's learner build keeps both
    connection strings in one `.env` file. Its first version loaded the whole file into
    the running program, so an attacker who controlled the program held the owner's key
    and could rewrite the log. The build now loads only the runtime string, but anyone
    who can read `.env` still holds both. DSOR-CNR-02 keeps connector credentials away
    from the agent and the model. Should a rule keep the migration credential out of the
    runtime's reach too, for example in a separate store that only the migration job can
    read?
35. **Is a foreign URI "not found", or a tenant mismatch?** The baby-steps map says step
    10 is done when "a URI for another company returns the same 'not found' as a URI
    that does not exist". DSOR-SRC-02b says a tenant identifier in the arguments that
    disagrees with the security context "MUST cause `TENANT_MISMATCH` or
    `AUTHORIZATION_DENIED`", and a canonical URI's first part is a tenant identifier.
    Step 10's learner build follows the rule: every foreign URI gets `TENANT_MISMATCH`,
    whether its resource exists or not, so DSOR-ERR-01b still holds, and the probe
    shows in the audit log. Should the map say "the same answer whether the resource
    exists or not", and should §21 name the code? This refines question 30, which asks
    at which line.
36. **What tenant does the audit record of a refusal before line 2 carry?**
    `audit-record.schema.json` requires `tenant`. A call refused at line 1, with no
    login, has no tenant yet, and one refused at line 2 names a company the caller may
    not belong to. Step 10's learner build leaves the record's tenant empty for both, and
    keeps a non-member's claimed company under `extensions`, never as the tenant, so a
    stranger cannot write into another company's audit partition. Should the schema
    allow a record with no tenant, or should §29's aggregated counts cover these
    refusals only?
37. **Why does §6's invoice list no `tenant_id`?** DSOR-TEN-01a says every tenant-owned
    resource carries its `tenant_id`. The invoice in §6's example has none, and step 10's
    learner build adds it to the row and to the invoice DSoR returns. Should §6 show it?
38. **May the migration job change the runtime role's password?** Step 09's learner
    build sets `dsor_runtime`'s password from `DSOR_DB_URL` on every `pnpm migrate`, so
    the password is written in one place only. Step 10's build found live that a login
    opening at that moment can fail, so its database tests now run one file at a time.
    Should the migration job create the runtime role only, and leave its credential to a
    separate, rarer rotation step?
39. **Should audit record numbers be counted per tenant?** DSOR-TEN-02a says audit
    partitions MUST be keyed by tenant. Step 11's learner build keeps each company's
    records apart with row-level security, but one sequence numbers the records of every
    company. So the gaps in one company's numbers show when, and how often, other
    companies are served. `EXPLAIN ANALYZE` shows a similar count for every table.
    Does "keyed by tenant" cover the numbering, so a record's number is counted within
    its tenant, and should §30 or §36 say so?
40. **What ties the tenant setting to the authenticated request?** §36 sets
    `dsor.tenant_id` per transaction, and calls row-level security defense in depth. In
    step 11's learner build, a program holding `dsor_runtime`'s login can set any tenant,
    read that tenant's rows, and add records to its audit log. The write policy cannot
    catch a wrong tenant, because the record and the setting come from one value. Is that the whole promise of
    the store's layer in DSOR-TEN-01b, a lock against mistakes only, or should §36 name
    something stronger, such as a role per tenant, or a setting only a trusted function can
    change?
41. **Should the cross-tenant suite also call each operation in its own tenant, and
    search the answer?** DSOR-TEN-02b asks for a suite that "exercises every operation
    with a foreign-tenant URI". When one check refuses every foreign URI before any
    operation's code runs, such a suite tests that check, and not the operations. Step
    12's learner build planted three operations that leaked another tenant's data, and
    each passed a suite of foreign URIs only. It now also sends each operation's example
    in the caller's own tenant, searches the answer for a `tenant_id` or a URI of another
    tenant, and works from both tenants. Should §14 ask for this, or say what the
    foreign-URI suite is meant to prove?
42. **How is an operation with no URI in its input tested across tenants?** DSOR-TEN-02b
    names a foreign-tenant URI. A query such as `invoice.list`, whose input may hold only
    a page size, has none to swap. Step 12's learner build calls that a finding, so its
    suite stays red until the step that adds such an operation decides. Should §14 say
    how such an operation is exercised, for example by searching its same-tenant answer
    for rows of another tenant?
    Step 13's learner build, which adds `invoice.list`, answers one way. The cursor looks
    like an id and cannot hold a URI, so the suite checks the list by its rows. It asks
    once, then calls the list as every permitted caller of both tenants, with its example
    and with only its required fields. Every item must carry the caller's `tenant_id`,
    and an empty page is a finding, because it checks nothing. The suite still counts the
    list as "exercised", though no foreign URI was sent. Is that what DSOR-TEN-02b means
    for such an operation?
43. **What is a "result size"?** DSOR-QRY-01 asks for "a server-side maximum page size
    and maximum result size on every query", and says no more. Step 13's learner build
    counts a page in rows, and a result in bytes: the answer's data written as JSON, in
    UTF-8, at most 64 KiB, with the correlation not counted. A row count misses one huge
    row, and a byte count alone lets a million tiny rows through. Is a result size
    counted in bytes, in rows, or both? Measured on the data, the envelope, or what
    leaves on the wire? And before masking (§19) or after it? Step 14's learner build
    answers the last part one way: after masking, counting the data and the list of what
    was withheld, because that list holds field names taken from the data.
44. **Which code answers "this result is too large to give"?** §28 has none. Step 13's
    learner build refuses with `UNSUPPORTED_CAPABILITY`, retry `never`, because asking
    again gets the same answer. The same refusal comes when one row alone is larger than
    the cap, and then every row after it is out of reach: no page can step over it.
    Should §28 name a code for this, and should §7.1 say what happens to a row larger
    than the cap?
45. **Where do a query's page size and result size live?** DSOR-QRY-01 asks for
    server-side maxima on every query, but `operation-contract.schema.json` has no field
    for either. Step 13's learner build writes one pair in code for every query: 10 rows
    and 64 KiB. Should a query's contract carry its own maxima, under a ceiling DSoR sets,
    so that a contract can lower its cap but never raise it past the server's?
46. **Does DSOR-CLS-03 cover refusals and empty answers?** "Every query response MUST
    carry a classification label." The error envelope's schema allows no
    `classification`, so a refusal cannot carry one. Step 14's learner build reads "every
    query response" as every answer that carries data. An answer that holds no field,
    such as an empty page, has no "highest classification among the fields it contains":
    the build calls it `public`. Should §19.2 say whether a refusal is a query response,
    and how an answer with no field is labelled?
47. **Is the label taken after masking, or from the whole record?** DSOR-CLS-03 says "the
    highest classification among the fields it contains". Step 14's learner build takes
    the fields the answer still contains after masking, so the agent's `INV-1008` is
    `internal` and `cfo_100`'s is `confidential`. Read as the fields of the record the
    answer came from, both would be `confidential`, and the label would tell the agent
    about data it was not given. Which is meant?
48. **Which clearance does `accounts-payable-fte` hold?** §19.2's example gives it
    `confidential`, which lets it see `amount`. The map's step 14 "done when" asks for
    the agent to see a masked `amount`. Step 14's learner build gives it `internal`.
    Should the example change, or the map?
49. **What is the audit record's kind `classified_read` for?** The audit-record schema
    lists it, and no prose names it. Step 14's learner build records a read's
    `resources` and `row_count` on the one decision record each call leaves, and puts the
    answer's label under `extensions`, because the audit record has no field for a
    classification. Is a classified read meant to be a second record? Should the audit
    record carry the read's classification?
50. **Should a label say anything about a field's value?** A classification belongs to a
    field. Step 14's learner build found that an operation's code can put an amount
    inside `status`, `next_cursor`, or `capped`, fields an agent may see, and the agent
    gets it. Masking cannot see this. Only a check of each result against its output
    schema could. Should DSOR-CLS-02a, or DSOR-SCH-01 for results, say that a query's
    result is checked against its output schema before masking?
51. **Are the freshness modes written `CURRENT` or `current`?** §27's table, DSOR-FRS-01b,
    and `decision-bundle.schema.json` write `CURRENT`. `common.schema.json`, which the
    operation contract and the connector schemas use, writes `current`. Step 15's learner
    build follows the schemas, so a reader meets both spellings. Which one is normative?
52. **Where does `connector_defined` rank among the modes?** Step 15's learner build
    labels an answer from several reads with the weakest mode. That needs an order, and
    §27 gives none for `connector_defined`, whose strength the connector documents. The
    build ranks it below `bounded_staleness` and above `observational`. Should §27 give
    the order, or say that an answer combining reads states each read's mode?
53. **Where does the audit record keep a read's freshness?** DSOR-AUD-01's
    `audit-record.schema.json` has a `connector` field, but no field for the mode
    delivered or `observed_at`. The decision bundle keeps both for each state read
    (DSOR-AUD-03a, L2). Step 15's learner build keeps the connector in the record's own
    field and the rest under `extensions`. The query answer's side is question 19.
54. **Which connector does an answer from several reads name?** DSOR-FRS-01a asks a query
    result to state "the connector", one. A query that reads an invoice from PostgreSQL
    and a vendor from a cache has two. Step 15's learner build names the connector of the
    oldest read, so a cache can hide behind `postgres` in the record when its read is
    the newer one. Should the result state each read's connector?
55. **Does a freshness label describe the data, or only the reads?** DSOR-FRS-01a asks for
    "the mode actually delivered". Step 15's learner build labels the reads a call made
    through its bound store. Code that keeps a copy of `INV-1008` from an earlier call,
    reads anything fresh, and answers with the copy, gets `current`. Checking that every
    row in an answer equals a row read in this call would close it; the build leaves that
    for a step of its own. Is the mode delivered a property of each value in the answer,
    and must DSoR enforce it?
56. **How does DSoR know a connector labels its reads honestly?** DSOR-FRS-01b forbids DSoR
    to label a cached value `CURRENT`, but the mode comes from the connector. Step 15's
    learner build accepts a cache that passes on the `current` label it copied, and a
    `current` label dated in the future. Checking a `current` label's time against the
    call would compare the connector's clock with DSoR's. Should a connector's declared
    `freshness` (`connector.schema.json`) be verified, and how?
