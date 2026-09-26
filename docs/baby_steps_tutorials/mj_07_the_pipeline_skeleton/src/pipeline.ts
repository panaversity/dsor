// The checklist every call goes through. DSOR-EXE-01a in specs/dsor/03-execution.md,
// section 21, and DSOR-OPR-04a in specs/dsor/01-model.md, section 7.
import { randomUUID } from "node:crypto";
import { Refusal, toEnvelope, type Answer, type Correlation } from "./envelope.ts";
import { checkPermission } from "./permissions.ts";
import { callerIds, checkNamedPrincipals, whoIsCalling } from "./principals.ts";
import { preview, type Registry } from "./registry.ts";
import { checkRequestId, usableRequestId, type RequestEnvelope } from "./request.ts";

/** Runs an operation by its name. It answers with an envelope, and never throws. */
export function call(
  registry: Registry,
  // The request envelope, beside the arguments (step 05's README, decision 1).
  request: RequestEnvelope,
  name: string,
  input: unknown,
): Answer {
  // The caller's own request id labels every answer, when DSoR can use it.
  // Otherwise DSoR makes one (DSOR-COR-01b), and a bad one is refused below (step 05's
  // README, decisions 6 and 7). Nothing in the input is read for it.
  let correlation: Correlation = { request_id: usableRequestId(request) ?? `req_${randomUUID()}` };
  // Every refusal is thrown as a Refusal, which names its code. The catch
  // below turns it, and anything else thrown, into an error envelope (step 04's README, C7).
  try {
    // Who is calling is found before anything is checked (DSOR-IDN-01),
    // from the token and DSoR's own table only (DSOR-SRC-02a). From here, answers name it.
    const caller = whoIsCalling(request);
    correlation = { ...correlation, ...callerIds(caller) };
    // Then what the caller sent is checked: first any principal the
    // arguments name (DSOR-SRC-02b), then the request id (step 05's README, decisions 6 and 7).
    checkNamedPrincipals(input, caller);
    checkRequestId(request);
    // NEW IN STEP 06: the contract is kept, because the permission it names is checked next.
    const contract = registry.contracts.get(name);
    if (contract === undefined) {
      throw new Refusal("UNSUPPORTED_CAPABILITY", `no operation named ${preview(name)}`);
    }
    // NEW IN STEP 06: the caller must hold that permission, or the call is denied
    // (DSOR-AUT-01b). It is checked before "is it built", so "not allowed" is never
    // answered as "not built yet" (step 06's README, C5).
    checkPermission(caller, contract, registry.roles);
    const handler = registry.handlers.get(name);
    if (!handler) throw new Refusal("UNSUPPORTED_CAPABILITY", `${preview(name)} is not built yet`);
    // A command's success needs a result envelope, and that needs a
    // proposal (step 22). So a command is refused before its code runs (step 04's
    // README, decision 1). NEW IN STEP 06: it reads the contract found above.
    if (contract["kind"] !== "query") {
      const why = "is a command, and commands are not built yet";
      throw new Refusal("UNSUPPORTED_CAPABILITY", `${preview(name)} ${why}`);
    }
    // A query's answer is { data, correlation } (step 04's README, decision 3).
    return { data: handler(input), correlation };
  } catch (thrown) {
    return toEnvelope(thrown, correlation);
  }
}
