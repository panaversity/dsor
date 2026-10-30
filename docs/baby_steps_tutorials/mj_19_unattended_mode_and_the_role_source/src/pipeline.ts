// The checklist every call goes through. DSOR-EXE-01a in specs/dsor/03-execution.md,
// section 21, and DSOR-OPR-04a in specs/dsor/01-model.md, section 7.
import { randomUUID } from "node:crypto";
import { checkAnswerInTenant, companyOf } from "./company.ts";
import { checkDelegation, checkNamedSlips } from "./delegation.ts";
import { Refusal, toEnvelope, type Answer, type Correlation } from "./envelope.ts";
import { checkInput, jsonCopy, NOT_JSON, refuseInput } from "./inputs.ts";
import { newReads, stalest } from "./freshness.ts";
import { decisionOf, type Authority, type DecisionLog, type Read } from "./log.ts";
import { NO_PAYMENTS } from "./payment.ts";
import { checkResultSize } from "./pages.ts";
import { checkPermission } from "./permissions.ts";
import { clearanceOf, maskRefusal, show } from "./masking.ts";
import { callerIds, checkNamedPrincipals, whoIsCalling } from "./principals.ts";
import { preview, type Registry } from "./registry.ts";
import {
  checkEnvelopeFields,
  checkRequestId,
  usableRequestId,
  type RequestEnvelope,
} from "./request.ts";
import { semanticsOf } from "./semantics.ts";
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
    const { caller, copy } = line(1, () => {
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
      // And nothing in the envelope that DSoR does not read (step 10's
      // README, decision 11).
      checkEnvelopeFields(request);
      return { caller: found, copy };
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
      // NEW IN STEP 19: last, the signer's current authority, from her company's directory:
      //   is she a person who works here, and what does she hold now (DSOR-IDN-05,
      //   DSOR-IDN-06). Last, so an outside failure never hides a refusal that DSoR can make
      //   by itself (step 19's README, decision 12).
      const authority = await registry.roleSource.authorityOf(
        tenant,
        slip,
        JSON.stringify(contract.id),
      );
      return { slip, authority };
    });
    if (found !== undefined) {
      const { slip, authority } = found;
      under = {
        delegation: slip.id,
        subject: slip.delegator,
        actor: caller.id,
        // NEW IN STEP 19: where DSoR learned what the signer holds, and as of when (step 19's
        // README, decision 7).
        source: authority.source,
        as_of: authority.as_of,
      };
    }
    // ④ Check operational status (suspension, freeze, breaker). Not checked yet: step 25.

    // ⑤ Authorize: the caller must hold the permission the contract names (DSOR-AUT-01b).
    // Only the caller's roles in the active company count.
    // NEW IN STEP 19: for an agent, with the roles its signer holds now, which line ③ found.
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

    // ⑥ Validate the input against the operation's input schema. Canonicalizing it and
    //   computing its payload hash: not built yet, step 29.
    //   It checks line ①'s copy, the one the code gets (step 07's README, decision 9).
    //   Found by the Stage 2 review, and fixed from step 07 on.
    line(6, () => checkInput(name, registry.inputs, copy));

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
    // here, because its success needs a proposal (step 22). Its answer has a shape of its
    // own until then (step 17's README, outcome 8 and decision 2).

    // ⑦ Idempotency claim. Commands only. Not built yet: step 20.
    // ⑧ Create the proposal, or load it. Commands only. Not built yet: step 22.
    // ⑨ Read bound state at the required freshness; evaluate preconditions. A query's code
    //   reads here, and each read is labelled (step 15). A required freshness and
    //   preconditions: not built yet, step 32.
    // A command's code reads and writes here, and its record follows at line
    //   ⑪. So a record that fails leaves the write behind, until step 36 commits the two
    //   together (step 17's README, decision 1).
    // The code may read the database, so call waits for it. A refusal it
    // throws while waiting is caught below, like any other.
    const returned = await line(9, async () => {
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
        const payments = contract["kind"] === "query" ? NO_PAYMENTS : registry.payments;
        return await handler(copy, companyOf(registry.invoices, tenant, reads, payments));
      } catch (thrown) {
        // A refusal the code throws is masked as its answer would be
        // (DSOR-CLS-02a; step 14's README, decision 8).
        throw maskRefusal(thrown, clearanceOf(caller));
      } finally {
        // Line ⑨ ends here, so the company the code was given reads nothing
        // more (step 15's README, decision 5). Found by the review. Since step 17, it writes
        // nothing more either.
        reads.closed = true;
      }
    });
    // Ours, not §21's: every tenant_id in the code's answer must be the active company's.
    // Right after ⑨, before anything else reads the answer. Another company's row is a bug
    // in the code, so the call fails with INTERNAL_ERROR, and its record says ALLOW. The
    // check reads DSoR's own copy of the answer, and the caller gets that copy (step 10's
    // README, decision 14). Found by the Stage 2 review, and fixed from step 10 on.
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
      const freshness = stalest(reads);
      answer = { data: shown.data, classification, ...listed, freshness, correlation };
      read = { resources, classification, freshness };
    } else {
      // A command's answer states the semantics its contract declares, never
      // a word of its code (DSOR-EXE-05b). No freshness: DSOR-FRS-01a names query results,
      // and a write is not a read (step 17's README, decision 2).
      const semantics = semanticsOf(contract);
      answer = { data: shown.data, classification, ...listed, semantics, correlation };
      read = { resources, classification };
    }
  } catch (thrown) {
    // toEnvelope never throws, so no throw above can skip line ⑪. Found by step 08's
    // review, and fixed in toEnvelope from step 04 on.
    answer = toEnvelope(thrown, correlation);
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
        ),
      ),
    );
  } catch {
    // A command whose code ran may have changed something, and DSoR cannot
    // prove it did not. So its answer never says a retry is safe: with no idempotency key
    // until step 20, a retry could write a second draft (the reason behind DSOR-ERR-02;
    // step 17's README, decision 17). Found by break B1.
    if (reachedCode && registry.contracts.get(name)?.["kind"] !== "query") {
      const ran =
        "DSoR could not record its decision after the command ran, so a retry is not safe";
      return toEnvelope(new Refusal("INTERNAL_ERROR", ran), answer.correlation);
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
  //   Commands only. Not built yet: steps 21, 24, 33, 34, 36, 37, and 40.
  return answer;
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
