// The checklist every call goes through. DSOR-EXE-01a in specs/dsor/03-execution.md,
// section 21, and DSOR-OPR-04a in specs/dsor/01-model.md, section 7.
import { randomUUID } from "node:crypto";
import { payloadHash } from "./canonical.ts";
import { claimScope, type ProposalSteps, type WorkStores } from "./claims.ts";
import { checkAnswerInTenant, companyOf } from "./company.ts";
import { checkDelegation, checkNamedSlips } from "./delegation.ts";
import { Refusal, toEnvelope, type Answer, type Correlation } from "./envelope.ts";
import { checkInput, jsonCopy, NOT_JSON, refuseInput } from "./inputs.ts";
import { newReads, stalest, type Freshness } from "./freshness.ts";
import { decisionOf, type Authority, type DecisionLog, type Read } from "./log.ts";
import { NO_PAYMENTS } from "./payment.ts";
import { checkResultSize } from "./pages.ts";
import { checkPermission } from "./permissions.ts";
import { clearanceOf, maskRefusal, show } from "./masking.ts";
import { callerIds, checkNamedPrincipals, whoIsCalling } from "./principals.ts";
import {
  closeProposal,
  NO_PROPOSALS,
  openProposal,
  requesterOf,
  urisIn,
  type Opening,
} from "./proposals.ts";
import { preview, type Registry } from "./registry.ts";
import {
  checkedKey,
  checkEnvelopeFields,
  checkRequestId,
  usableRequestId,
  type RequestEnvelope,
} from "./request.ts";
import { semanticsOf } from "./semantics.ts";
import { suspendThenRefuse } from "./suspensions.ts";
import { activeTenant, checkNamedTenants, checkUrisInTenant } from "./tenants.ts";
import { isTenantId } from "./uri.ts";

// The observer is told each line's number as it runs, and only a test
// listens (step 07's README, decision 6).
/** Hears the number of each line of the checklist, as the line runs. */
export type Observer = (line: number) => void;

/**
 * Runs an operation by its name. It answers with an envelope, and never throws.
 * Every call runs one checklist, numbered as §21 numbers it. A line that
 * is not built yet is a comment that names its step, and never a check that says "fine".
 */
// Call is async. It waits for the database at lines ⑨ and ⑪, and answers
// only after the record is committed (step 09's README, decision 9).
export async function call(
  registry: Registry,
  // The log every decision is written to (step 08's README, decision 6).
  log: DecisionLog,
  // The request envelope, beside the arguments (step 05's README, decision 1).
  request: RequestEnvelope,
  name: string,
  input: unknown,
  observe: Observer = () => {},
): Promise<Answer> {
  // DSoR makes a request id first, so every answer carries one (DSOR-COR-01b).
  let correlation: Correlation = { request_id: `req_${randomUUID()}` };

  // Runs one line, and first tells the observer its number. The number and the check are
  // one statement, so neither can move without the other.
  function line<T>(number: number, check: () => T): T {
    observe(number);
    return check();
  }

  // Set once DSoR's checks let the call reach its code at line ⑨. From then on, its
  // record says ALLOW (step 08's README, decision 5).
  let reachedCode = false;
  // Set once line ② has checked the company, so the record names it, even
  // when a later line refuses (step 10's README, decision 6).
  let tenantOfRecord: string | undefined;
  // A well-formed company the caller named. If line ② refuses it, the record
  // keeps it as a claim, never as its tenant (step 10's README, decision 6).
  let claimedTenant: string | undefined;
  // What the answer returned, set only when it returns data. Its record
  // says so (DSOR-CLS-05; step 14's README, decision 7).
  let read: Read | undefined;
  // The slip an agent's call runs under, once line ③ found it. Its record
  // names the slip and its person, refusals after line ③ too (step 18's README, decision 8).
  let under: Authority | undefined;
  // The key line ⑦ claimed, and, for a replay, the request id of the first
  // call. The record names both (step 20's README, decision 8).
  let keyOfRecord: { key: string; replay_of?: string } | undefined;
  // NEW IN STEP 22: the proposal line ⑧ made, or a replay gave back. The record names it, and so
  // does the answer, a refusal too (step 22's README, decision 5).
  let proposalOfRecord: string | undefined;
  // NEW IN STEP 22: the proposal a refusal from the code ended FAILED, which its envelope names.
  // Set only from the claim, so no code can name a proposal of its own (step 22's README,
  // decision 5). Found by the review.
  let failedProposal: string | undefined;
  // The label of each read the code makes, noted by the bound store. Only the
  // checklist holds this notebook (step 15's README, decision 5).
  const reads = newReads();

  // Every refusal is thrown as a Refusal, which names its code. The catch
  // below turns it, and anything else thrown, into an error envelope (step 04's README, C7).
  // The try only works out the answer. It is returned after line ⑪.
  let answer: Answer;
  try {
    // ① Authenticate; build the request security context. Who is calling comes from the
    //   token and DSoR's own table only (DSOR-IDN-01, DSOR-SRC-02a). Then any principal the
    //   arguments name must be the caller (DSOR-SRC-02b), and the request id must be usable
    //   (step 05's README, decisions 6 and 7; step 07's README, decision 8).
    const { caller, copy, key } = line(1, () => {
      // The caller's own request id labels every answer, when DSoR can use it (step 05's
      // README, decisions 6 and 7). It is read inside the try, so an envelope whose
      // request_id cannot be read gets an answer, not a throw. Found by step 07's review,
      // and fixed from step 05 on.
      correlation = { request_id: usableRequestId(request) ?? correlation.request_id };
      const found = whoIsCalling(request);
      correlation = { ...correlation, ...callerIds(found) };
      // One copy of the input, made here, once, after the login is found. Every check from
      // here on, and the operation's code, reads this copy. So no check can see a value that
      // the code does not get. Only an input that cannot be copied is read again, to check
      // the claims it makes before line ② refuses it (step 07's README, decision 9). Found
      // by the Stage 2 review, and fixed from step 07 on.
      const copy = jsonCopy(input);
      checkNamedPrincipals(copy === NOT_JSON ? input : copy, found);
      checkRequestId(request);
      // And an idempotency key, when the envelope carries one, must be well
      // formed. It is read here, once, so line ⑦ claims the key that was checked (step 20's
      // README, decision 2).
      const key = checkedKey(request);
      // And nothing in the envelope that DSoR does not read (step 10's
      // README, decision 11).
      checkEnvelopeFields(request);
      return { caller: found, copy, key };
    });

    // ② Resolve tenant. The company comes from the envelope, and DSoR checks
    //   in its own table that the caller is a member of it (DSOR-IDN-03a, DSOR-SRC-02a).
    //   Right after ①, before the operation is looked up, so a stranger to a company learns
    //   nothing there (step 10's README, decision 2). Then any company the arguments name
    //   must be the active one (DSOR-SRC-02b; step 10's README, decision 4).
    const tenant = line(2, () => {
      // The envelope comes from outside the program, so it may even be null. Read once.
      const named = request?.tenant;
      if (isTenantId(named)) claimedTenant = named;
      const active = activeTenant(named, caller);
      tenantOfRecord = active;
      // Line ①'s copy, never the input again (step 07's README, decision 9). Found by the
      // Stage 2 review, and fixed from step 07 on.
      if (copy === NOT_JSON) refuseUncopyable(name, input, active);
      checkNamedTenants(copy, active);
      return active;
    });

    // Ours, not §21's: which operation? Lines ③ to ⑤ need its contract (step 07's
    // README, decision 4).
    const contract = registry.contracts.get(name);
    if (contract === undefined) {
      throw new Refusal("UNSUPPORTED_CAPABILITY", `no operation named ${preview(name)}`);
    }

    // ③ Resolve delegation; verify the actor chain; establish current authority.
    // Every call from an agent, a read too, runs only under an active slip
    //   that a person signed and DSoR holds, and that allows `unattended`. The person comes
    //   from the slip, never from the request (DSOR-DEL-01a, DSOR-DEL-07, DSOR-DEL-08; step
    //   18's README, decisions 1, 2, and 5). Before line ⑤, which allows only what the slip
    //   and its signer both allow.
    const found = await line(3, async () => {
      const slip = await checkDelegation(caller, contract, registry.delegations, tenant);
      // And any slip the arguments name must be this one. A person calls under none
      // (DSOR-SRC-02b; step 18's README, decision 17). Found by step 18's review.
      checkNamedSlips(copy, slip);
      if (slip === undefined) return undefined;
      // Last, the signer's current authority, from her company's directory:
      //   is she a person who works here, and what does she hold now (DSOR-IDN-05,
      //   DSOR-IDN-06). Last, so an outside failure never hides a refusal that DSoR can make
      //   by itself (step 19's README, decision 12).
      const authority = await registry.roleSource
        .authorityOf(tenant, slip, JSON.stringify(contract.id))
        // When the directory reports her as gone, her slips here are
        //   suspended, with their records, before the call is refused. Line ③ names its own
        //   company and signer, and the call's correlation (DSOR-IDN-07, DSOR-COR-01a; step
        //   19b's README, decisions 4 and 14).
        .catch((thrown: unknown) =>
          suspendThenRefuse(thrown, registry.delegations, tenant, slip.delegator, correlation),
        );
      return { slip, authority };
    });
    if (found !== undefined) {
      const { slip, authority } = found;
      under = {
        delegation: slip.id,
        subject: slip.delegator,
        actor: caller.id,
        // Where DSoR learned what the signer holds, and as of when (step 19's
        // README, decision 7).
        source: authority.source,
        as_of: authority.as_of,
      };
    }
    // ④ Check operational status (suspension, freeze, breaker). Not checked yet: step 25.

    // ⑤ Authorize: the caller must hold the permission the contract names (DSOR-AUT-01b).
    // Only the caller's roles in the active company count.
    // For an agent, with the roles its signer holds now, which line ③ found.
    line(5, () =>
      checkPermission(
        caller,
        contract,
        registry.roles,
        tenant,
        found?.slip,
        found?.authority.roles,
      ),
    );

    // ⑥ Validate the input against the operation's input schema.
    //   It checks line ①'s copy, the one the code gets (step 07's README, decision 9).
    //   Found by the Stage 2 review, and fixed from step 07 on.
    // Then the copy's fingerprint, its payload hash, which line ⑦ claims the
    //   key with (DSOR-IDM-01b; step 20's README, decision 5). Canonicalizing in full: not built
    //   yet, step 29.
    const hash = line(6, () => {
      checkInput(name, registry.inputs, copy);
      return payloadHash(copy);
    });

    // Ours, not §21's: every URI in the checked input must name the active
    // company (DSOR-SRC-02b). After ⑥, so it reads the copy that line ⑥ checked, and before
    // "is it built", so a foreign URI is never answered as "not built yet" (step 10's
    // README, decision 4).
    checkUrisInTenant(copy, tenant);

    // Ours, not §21's: is it built? Never before ⑤, so "not allowed" is never answered as
    // "not built yet" (step 06's README, C5), and never before ⑥ (step 07's README,
    // decision 5).
    const handler = registry.handlers.get(name);
    if (!handler) throw new Refusal("UNSUPPORTED_CAPABILITY", `${preview(name)} is not built yet`);
    // A command's code runs. Step 04's decision 1 refused every command
    // here, because its success needs a proposal. Step 17 let it run with an answer of its own
    // shape (step 17's README, outcome 8 and decision 2). Line ⑧ makes the proposal now.

    // ⑨ Read bound state at the required freshness; evaluate preconditions. A query's code
    //   reads here, and each read is labelled (step 15). A required freshness and
    //   preconditions: not built yet, step 32.
    // A command's code reads and writes here, and its record follows at line
    //   ⑪. So a record that fails leaves the write behind, until step 36 commits the two
    //   together (step 17's README, decision 1).
    // The code, given the stores it works on. A query gets the registry's. A
    //   command gets its claim's, which on the database work inside the claim's transaction,
    //   so line ⑦ runs this, after it has claimed the key (step 20's README, decision 6).
    // The code may read the database, so call waits for it. A refusal it
    // throws while waiting is caught below, like any other.
    const runCode = (stores: WorkStores): Promise<unknown> =>
      line(9, async () => {
        reachedCode = true;
        // The code works inside the active company only. It gets line ①'s copy, the one
        // every check read (step 07's README, decision 9). Found by the Stage 2 review, and
        // fixed from step 07 on. And it gets that company's invoices, never the store
        // itself, so it cannot name another company (step 10's README, decision 13). Found
        // by the Stage 2 review, and fixed from step 10 on.
        try {
          // And, for a command, that company's payments, bound the same way. A
          // query's code gets none, so a query that writes fails: line ③ lets the agent's query
          // through because a query changes nothing, and this makes that true (step 17's README,
          // "Think it through", finding A).
          const payments = contract["kind"] === "query" ? NO_PAYMENTS : stores.payments;
          const returned = await handler(copy, companyOf(stores.invoices, tenant, reads, payments));
          // The company check below runs here too, inside the claim, so a
          // command whose answer holds another company's row keeps neither its work nor its
          // claim (step 20's README, decision 6).
          return checkAnswerInTenant(returned, tenant);
        } finally {
          // Line ⑨ ends here, so the company the code was given reads nothing
          // more (step 15's README, decision 5). Found by the review. Since step 17, it writes
          // nothing more either.
          reads.closed = true;
        }
      });

    // ⑦ Idempotency claim. Commands only, so a query that carries no key skips
    //   it. A command must carry a key and a query must carry none (DSOR-IDM-01a; step 20's
    //   README, decision 3). The key is claimed with the fingerprint, inside the company, by
    //   this caller, for this operation, and the code runs inside the claim (DSOR-IDM-01b). The
    //   same key and the same request get the recorded outcome, and the code does not run
    //   again (DSOR-IDM-01c). A different request is refused (DSOR-IDM-01d).
    // NEW IN STEP 22: ⑧ Create the proposal. Commands only, inside the claim, after line ⑦ has
    //   claimed the key, so a replay gets the first call's proposal and makes none (DSOR-IDM-04).
    //   The proposal keeps the request as line ⑥ checked it, the URIs it names, and who asked. It
    //   moves PROPOSED, READY, and EXECUTING before the code runs, and COMMITTED or FAILED once
    //   the code ends, each move with its record, only along the picture of §26.2 (DSOR-APR-01a,
    //   DSOR-APR-01b, DSOR-APR-01c; step 22's README, decisions 2, 4, and 9). Loading a proposal
    //   for proposal.execute: not built yet, step 23.
    let returned: unknown;
    try {
      if (contract["kind"] === "query" && key === undefined) {
        // A query makes no proposal, so its stores hold none to write (decision 7).
        returned = await runCode({
          invoices: registry.invoices,
          payments: registry.payments,
          proposals: NO_PROPOSALS,
        });
      } else {
        const { scope, claimed } = await line(7, async () => {
          const scope = claimScope(contract, key, tenant, caller.id);
          // Named in the record from here on, a refusal of the key too.
          keyOfRecord = { key: scope.key };
          // What line ⑧ writes, made here, so the claim's work never reads the request again.
          const opening: Opening = {
            tenant,
            draft: {
              operation: `${contract.id}@${String(contract["version"])}`,
              payload: copy,
              payload_hash: hash,
              resources: urisIn(copy),
              requester: requesterOf(caller, under, tenant, new Date().toISOString()),
              idempotency_key: scope.key,
            },
            correlation,
          };
          const steps: ProposalSteps = {
            open: (stores) => line(8, () => openProposal(stores.proposals, opening)),
            close: (stores, proposal, outcome) =>
              closeProposal(stores.proposals, opening, proposal, outcome),
          };
          return {
            scope,
            claimed: await registry.claims.run(scope, hash, correlation.request_id, runCode, steps),
          };
        });
        if (claimed.replay_of !== undefined) {
          // A replay passed every line its first call passed, so its record says ALLOW too,
          // and names the call whose outcome it gives back (step 20's README, decision 8).
          reachedCode = true;
          keyOfRecord = { key: scope.key, replay_of: claimed.replay_of };
        }
        // NEW IN STEP 22: every command's claim gives its proposal back. None is a bug.
        if (claimed.proposal === undefined) throw new Error("a command's claim kept no proposal");
        proposalOfRecord = claimed.proposal;
        // A refusal the code gave is an outcome, and comes back like any other (step 20's
        // README, decision 9).
        // NEW IN STEP 22: its envelope names the proposal that ended FAILED.
        if ("refused" in claimed) {
          failedProposal = claimed.proposal;
          throw claimed.refused;
        }
        returned = claimed.value;
      }
    } catch (thrown) {
      // A refusal the code throws is masked as its answer would be
      // (DSOR-CLS-02a; step 14's README, decision 8).
      // Here, as it leaves, so a refusal the claim kept is masked for the caller
      // now, as a replay's value is. Line ⑦'s own refusals are public, and pass unchanged
      // (step 20's README, decision 7).
      throw maskRefusal(thrown, clearanceOf(caller));
    }
    // Ours, not §21's: every tenant_id in the code's answer must be the active company's.
    // Right after ⑨, before anything else reads the answer. Another company's row is a bug
    // in the code, so the call fails with INTERNAL_ERROR, and its record says ALLOW. The
    // check reads DSoR's own copy of the answer, and the caller gets that copy (step 10's
    // README, decision 14). Found by the Stage 2 review, and fixed from step 10 on.
    // A replay's recorded answer is checked again here, as it leaves, and so is
    // everything below (step 20's README, decision 7).
    const data = checkAnswerInTenant(returned, tenant);
    // Ours, not §21's. For an agent, every field above its clearance is
    // left out before the answer leaves (DSOR-CLS-02a). The contract names the kind of its
    // answer. Masking walks the copy the company check made, so the answer, its record, and
    // the check all read one copy (step 14's README, decision 3). Found by the Stage 2
    // review, and fixed from step 14 on. Masking comes before the size check, so the size
    // measured below is the size that leaves (step 14's README, decision 5).
    const kind = (contract["output"] as { schema: string }).schema;
    const shown = show(data, kind, registry.classifications, clearanceOf(caller));
    // Ours, not §21's. No query's result leaves larger than DSoR gives in
    // one call, whoever wrote its code, a list or not (DSOR-QRY-01; step 13's README,
    // decision 3). Its code ran, so its record says ALLOW, with this refusal as its result.
    // A command's answer passes here too: one draft is far below the limit, so only a bug
    // reaches it.
    checkResultSize(shown.data, shown.redactions);
    // ⑩ Evaluate controls, separation of duties, and limits. Not built yet: steps 24,
    //   27, and 30.

    // A query's answer is { data, correlation } (step 04's README, decision 3).
    // With its label (DSOR-CLS-03), and the fields left out, when there are
    // any (DSOR-CLS-02b).
    const { classification, redactions, resources } = shown;
    const listed = redactions.length > 0 ? { redactions } : {};
    if (contract["kind"] === "query") {
      // The answer's label, from the labels its reads left. Nothing since the
      // copy waited, so no read can have been noted after it: the label covers every read
      // whose rows could be in the copy. Last of the checks, so an answer refused for another
      // reason is refused for that one. A query that read nothing is a bug in its code
      // (DSOR-FRS-01a; step 15's README, decision 6).
      // The label names the record's version only when the caller may see the
      // version itself. Masking withheld it, so the label leaves it out too. Found by the
      // review: an agent whose clearance hid the version read it in the label (DSOR-CLS-02a;
      // step 21's README, decision 9).
      const label = stalest(reads);
      const hidden = redactions.some((redaction) => redaction.field === "version");
      const freshness = hidden ? withoutVersion(label) : label;
      answer = { data: shown.data, classification, ...listed, freshness, correlation };
      read = { resources, classification, freshness };
    } else {
      // A command's answer states the semantics its contract declares, never
      // a word of its code (DSOR-EXE-05b). No freshness: DSOR-FRS-01a names query results,
      // and a write is not a read (step 17's README, decision 2).
      const semantics = semanticsOf(contract);
      // NEW IN STEP 22: the outcome, the proposal, and the fingerprint of the request, so the
      // answer passes result-envelope.schema.json (DSOR-SCH-01; step 22's README, decision 5).
      if (proposalOfRecord === undefined) throw new Error("a command answered with no proposal");
      answer = {
        outcome: "COMMITTED",
        proposal: proposalOfRecord,
        payload_hash: hash,
        data: shown.data,
        classification,
        ...listed,
        semantics,
        correlation,
      };
      read = { resources, classification };
    }
  } catch (thrown) {
    // toEnvelope never throws, so no throw above can skip line ⑪. Found by step 08's
    // review, and fixed in toEnvelope from step 04 on.
    answer = toEnvelope(thrown, correlation, failedProposal);
  }

  // ⑪ Record the decision, including every refusal (DSOR-EXE-02). Every answer comes
  //   through here before it leaves: a success, every refusal, and a bug. A throw anywhere
  //   above cannot skip it (step 08's README, C2).
  // Building the record is inside the try too, so even a bug there gives no answer.
  // Await. The answer waits until the database has committed the record,
  // and a database that refuses it lands in the catch (step 09's README, C2 and C4).
  try {
    await line(11, () =>
      log.add(
        decisionOf(
          answer,
          registry.contracts.get(name),
          reachedCode,
          tenantOfRecord,
          claimedTenant,
          read,
          under,
          keyOfRecord,
          proposalOfRecord,
        ),
      ),
    );
  } catch {
    // A command whose code ran may have changed something, and DSoR cannot
    // prove it did not. Until step 20 its answer never said a retry was safe: with no key, a
    // retry could write a second draft (the reason behind DSOR-ERR-02; step 17's README,
    // decision 17). Found by break B1.
    // Now every command that reaches its code holds a claim. A retry with the
    // same key gets the claim's outcome, or runs once if the work rolled back. So the
    // answer is EVIDENCE_STORE_UNAVAILABLE, whose retry class is safe_same_key (step 20's
    // README, decision 10).
    if (reachedCode && keyOfRecord !== undefined) {
      const ran =
        "DSoR could not record its decision after the command ran, and a retry with the same idempotency_key cannot run it twice";
      return toEnvelope(new Refusal("EVIDENCE_STORE_UNAVAILABLE", ran), answer.correlation);
    }
    // DSOR-EXE-03b, an L2 rule built early: with no record, there is no answer, not even a
    // "yes". Whatever the log threw stays inside: it can name paths and servers. This
    // refusal cannot be recorded, because the log is what failed (step 08's README,
    // decision 4).
    const message = "DSoR could not record its decision, so it refuses the call";
    return toEnvelope(new Refusal("EVIDENCE_STORE_UNAVAILABLE", message), answer.correlation);
  }

  // ⑫ Stop here when an approval is missing, or the mode is propose_only or
  //   validate_only. Not built yet: steps 23 and 29.
  // ⑬ to ⑰ Write the intent record, execute, finalize, commit, and seal the evidence.
  //   Commands only. Not built yet: steps 24, 33, 34, 36, 37, and 40.
  // ⑭'s concurrency check is built. It runs inside the code at line ⑨, where a
  //   command's work runs until step 33 moves the work after the intent record: the code
  //   compares the version, and the store's write checks it again (step 21's README,
  //   decision 6).
  return answer;
}

// A label without its record's version.
/** The label, with no resource_version. */
function withoutVersion(label: Freshness): Freshness {
  const { mode, observed_at, connector } = label;
  return { mode, observed_at, connector };
}

/** Refuses an input that JSON cannot copy, after checking the claims it makes. */
function refuseUncopyable(name: string, input: unknown, tenant: string): never {
  // JSON can carry such an input: nesting that JSON.parse reads and JSON.stringify cannot
  // write. Line ① checked the principals it names, and line ② checks the companies it
  // names here, both on the input as sent. So an attempt to act as someone else, or inside
  // another company, is refused as one, and never hidden behind a bad input. Step 05
  // refused to let a bad request id hide it, for the same reason. The input is read here
  // only to choose the refusal. The call is refused either way, so nothing read here can
  // reach the code (step 07's README, decision 9). Found by the Stage 2 review, and fixed
  // from step 07 on.
  checkNamedTenants(input, tenant);
  refuseInput(name, "it cannot be copied as JSON");
}
