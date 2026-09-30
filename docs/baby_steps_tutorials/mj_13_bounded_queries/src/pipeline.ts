// The checklist every call goes through. DSOR-EXE-01a in specs/dsor/03-execution.md,
// section 21, and DSOR-OPR-04a in specs/dsor/01-model.md, section 7.
import { randomUUID } from "node:crypto";
import { Refusal, toEnvelope, type Answer, type Correlation } from "./envelope.ts";
import { checkInput } from "./inputs.ts";
import { decisionOf, type DecisionLog } from "./log.ts";
import { checkResultSize } from "./pages.ts";
import { checkPermission } from "./permissions.ts";
import { callerIds, checkNamedPrincipals, whoIsCalling } from "./principals.ts";
import { preview, type Registry } from "./registry.ts";
import {
  checkEnvelopeFields,
  checkRequestId,
  usableRequestId,
  type RequestEnvelope,
} from "./request.ts";
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

  // Every refusal is thrown as a Refusal, which names its code. The catch
  // below turns it, and anything else thrown, into an error envelope (step 04's README, C7).
  // The try only works out the answer. It is returned after line ⑪.
  let answer: Answer;
  try {
    // ① Authenticate; build the request security context. Who is calling comes from the
    //   token and DSoR's own table only (DSOR-IDN-01, DSOR-SRC-02a). Then any principal the
    //   arguments name must be the caller (DSOR-SRC-02b), and the request id must be usable
    //   (step 05's README, decisions 6 and 7; step 07's README, decision 8).
    const caller = line(1, () => {
      // The caller's own request id labels every answer, when DSoR can use it (step 05's
      // README, decisions 6 and 7). It is read inside the try, so an envelope whose
      // request_id cannot be read gets an answer, not a throw. Found by step 07's review,
      // and fixed from step 05 on.
      correlation = { request_id: usableRequestId(request) ?? correlation.request_id };
      const found = whoIsCalling(request);
      correlation = { ...correlation, ...callerIds(found) };
      checkNamedPrincipals(input, found);
      checkRequestId(request);
      // And nothing in the envelope that DSoR does not read (step 10's
      // README, decision 11).
      checkEnvelopeFields(request);
      return found;
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
      checkNamedTenants(input, active);
      return active;
    });

    // Ours, not §21's: which operation? Lines ③ to ⑤ need its contract (step 07's
    // README, decision 4).
    const contract = registry.contracts.get(name);
    if (contract === undefined) {
      throw new Refusal("UNSUPPORTED_CAPABILITY", `no operation named ${preview(name)}`);
    }

    // ③ Resolve delegation; verify the actor chain; establish current authority. Not
    //   checked yet: step 18.
    // ④ Check operational status (suspension, freeze, breaker). Not checked yet: step 25.

    // ⑤ Authorize: the caller must hold the permission the contract names (DSOR-AUT-01b).
    // Only the caller's roles in the active company count.
    line(5, () => checkPermission(caller, contract, registry.roles, tenant));

    // ⑥ Validate the input against the operation's input schema. Canonicalizing it and
    //   computing its payload hash: not built yet, step 29.
    //   From here on, only the copy that line ⑥ checked is used (step 07's README,
    //   decision 9).
    const checked = line(6, () => checkInput(name, registry.inputs, input));

    // Ours, not §21's: every URI in the checked input must name the active
    // company (DSOR-SRC-02b). After ⑥, so it reads the checked copy, and before "is it
    // built", so a foreign URI is never answered as "not built yet" (step 10's README,
    // decision 4).
    checkUrisInTenant(checked, tenant);

    // Ours, not §21's: is it built? Never before ⑤, so "not allowed" is never answered as
    // "not built yet" (step 06's README, C5), and never before ⑥ (step 07's README,
    // decision 5).
    const handler = registry.handlers.get(name);
    if (!handler) throw new Refusal("UNSUPPORTED_CAPABILITY", `${preview(name)} is not built yet`);
    // A command's success needs a result envelope, and that needs a proposal (step 22). So
    // a command is refused before its code runs (step 04's README, decision 1).
    if (contract["kind"] !== "query") {
      const why = "is a command, and commands are not built yet";
      throw new Refusal("UNSUPPORTED_CAPABILITY", `${preview(name)} ${why}`);
    }

    // ⑦ Idempotency claim. Commands only. Not built yet: step 20.
    // ⑧ Create the proposal, or load it. Commands only. Not built yet: step 22.
    // ⑨ Read bound state at the required freshness; evaluate preconditions. A query's code
    //   reads here. Freshness and preconditions are not built yet: steps 15 and 32.
    // The code may read the database, so call waits for it. A refusal it
    // throws while waiting is caught below, like any other.
    const data = await line(9, () => {
      reachedCode = true;
      // The code works inside the active company only.
      return handler(checked, tenant);
    });
    // NEW IN STEP 13: ours, not §21's. No query's result leaves larger than DSoR gives in
    // one call, whoever wrote its code, a list or not (DSOR-QRY-01; step 13's README,
    // decision 3). Its code ran, so its record says ALLOW, with this refusal as its result.
    checkResultSize(data);
    // ⑩ Evaluate controls, separation of duties, and limits. Not built yet: steps 24,
    //   27, and 30.

    // A query's answer is { data, correlation } (step 04's README, decision 3).
    answer = { data, correlation };
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
        ),
      ),
    );
  } catch {
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
