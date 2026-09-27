// The checklist every call goes through. DSOR-EXE-01a in specs/dsor/03-execution.md,
// section 21, and DSOR-OPR-04a in specs/dsor/01-model.md, section 7.
import { randomUUID } from "node:crypto";
import { Refusal, toEnvelope, type Answer, type Correlation } from "./envelope.ts";
import { checkInput } from "./inputs.ts";
import { decisionOf, type DecisionLog } from "./log.ts";
import { checkPermission } from "./permissions.ts";
import { callerIds, checkNamedPrincipals, whoIsCalling } from "./principals.ts";
import { preview, type Registry } from "./registry.ts";
import { checkRequestId, usableRequestId, type RequestEnvelope } from "./request.ts";

// NEW IN STEP 07: the observer is told each line's number as it runs, and only a test
// listens (step 07's README, decision 6).
/** Hears the number of each line of the checklist, as the line runs. */
export type Observer = (line: number) => void;

/**
 * Runs an operation by its name. It answers with an envelope, and never throws.
 * NEW IN STEP 07: every call runs one checklist, numbered as §21 numbers it. A line that
 * is not built yet is a comment that names its step, and never a check that says "fine".
 */
export function call(
  registry: Registry,
  // NEW IN STEP 08: the log every decision is written to (step 08's README, decision 6).
  log: DecisionLog,
  // The request envelope, beside the arguments (step 05's README, decision 1).
  request: RequestEnvelope,
  name: string,
  input: unknown,
  observe: Observer = () => {},
): Answer {
  // DSoR makes a request id first, so every answer carries one (DSOR-COR-01b).
  let correlation: Correlation = { request_id: `req_${randomUUID()}` };

  // Runs one line, and first tells the observer its number. The number and the check are
  // one statement, so neither can move without the other.
  function line<T>(number: number, check: () => T): T {
    observe(number);
    return check();
  }

  // NEW IN STEP 08: set once DSoR's checks let the call reach its code at line ⑨. From
  // then on, its record says ALLOW (step 08's README, decision 5).
  let reachedCode = false;

  // Every refusal is thrown as a Refusal, which names its code. The catch
  // below turns it, and anything else thrown, into an error envelope (step 04's README, C7).
  // NEW IN STEP 08: the try only works out the answer. It is returned after line ⑪.
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
      return found;
    });

    // Ours, not §21's: which operation? Lines ③ to ⑤ need its contract (step 07's
    // README, decision 4).
    const contract = registry.contracts.get(name);
    if (contract === undefined) {
      throw new Refusal("UNSUPPORTED_CAPABILITY", `no operation named ${preview(name)}`);
    }

    // ② Resolve tenant. Not checked yet: step 10.
    // ③ Resolve delegation; verify the actor chain; establish current authority. Not
    //   checked yet: step 18.
    // ④ Check operational status (suspension, freeze, breaker). Not checked yet: step 25.

    // ⑤ Authorize: the caller must hold the permission the contract names (DSOR-AUT-01b).
    line(5, () => checkPermission(caller, contract, registry.roles));

    // ⑥ Validate the input against the operation's input schema. Canonicalizing it and
    //   computing its payload hash: not built yet, step 29.
    //   From here on, only the copy that line ⑥ checked is used (step 07's README,
    //   decision 9).
    const checked = line(6, () => checkInput(name, registry.inputs, input));

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
    const data = line(9, () => {
      reachedCode = true;
      return handler(checked);
    });
    // ⑩ Evaluate controls, separation of duties, and limits. Not built yet: steps 24,
    //   27, and 30.

    // A query's answer is { data, correlation } (step 04's README, decision 3).
    answer = { data, correlation };
  } catch (thrown) {
    answer = toEnvelope(thrown, correlation);
  }

  // ⑪ Record the decision, including every refusal (DSOR-EXE-02). NEW IN STEP 08: every
  //   answer comes through here before it leaves: a success, every refusal, and a bug. A
  //   throw anywhere above cannot skip it (step 08's README, C2).
  // Building the record is inside the try too, so even a bug there gives no answer.
  try {
    line(11, () => log.add(decisionOf(answer, registry.contracts.get(name), reachedCode)));
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
