// NEW IN STEP 08: one id per request, minted before the first stage.
//
// This is not a new feature; it is a repair, and it has to land before the audit record does.
// `correlation.request_id` is a *required* field of audit-record.schema.json, so step 08 has to put
// something there. Until now the id was minted lazily, inside whichever envelope happened to be
// built — so it named an answer rather than a request. A record that minted its own would carry a
// different id from the answer it was about, and nothing could join the two. That is the single job
// a correlation id has.

// The right requirement ids matter here, because a test title is how this project counts coverage.
// These used to say `DSOR-ERR-01a`, which is "every error MUST validate against
// error-envelope.schema.json" — nothing in this file calls `validateEnvelope`. A review pointed out
// that the correct two were one file over all along:
//
//   DSOR-COR-01b: DSoR MUST generate a `request_id` when the caller supplies none.
//   DSOR-COR-01a: DSoR MUST propagate the correlation identifiers through connectors, audit, and events.
//
// `01a` is the exact rule for "the record and the answer name the same request".

import { describe, expect, it } from "vitest";
import { resetProposalIds, resetRequestIds } from "../src/envelopes.ts";
import { callOperation } from "../src/operations.ts";

const SUPERVISOR = { loggedInAs: "user_123" } as const;
const CFO = { loggedInAs: "cfo_100" } as const;
const INV_1008 = "dsor://org_456/invoice/INV-1008";
// INV-1009 is the draft in the store. INV-1008 is already issued, which is why the CFO's refusal
// above is AUTHORIZATION_DENIED and not "already issued": step 06 asks "may you" before "is it".
const INV_1009 = "dsor://org_456/invoice/INV-1009";

/** The request id on whatever came back, whichever kind of answer it is. */
function idOf(answer: ReturnType<typeof callOperation>): string {
  if (answer.kind === "data") {
    throw new Error("a query's success carries no envelope, so no id — see the README's gap");
  }

  return answer.envelope.correlation.request_id;
}

describe("the request id", () => {
  // Consecutive ids with no gaps is the whole test. A gap would mean a request minted an id and
  // then threw it away, which is what "minted inside the envelope" does as soon as one request
  // builds two envelopes.
  it("DSOR-COR-01b: each request mints exactly one id, and refusals are not exempt", () => {
    resetRequestIds();
    resetProposalIds();

    // Three requests, refused at three different stages, so the id is not an accident of one path.
    const noLogin = callOperation(undefined, "invoice.get", { invoice: INV_1008 });
    const noSuchOperation = callOperation(SUPERVISOR, "invoice.destroy", {});
    const notAllowed = callOperation(CFO, "invoice.issue", { invoice: INV_1008 });

    expect(idOf(noLogin)).toBe("req_1");
    expect(idOf(noSuchOperation)).toBe("req_2");
    expect(idOf(notAllowed)).toBe("req_3");

    // And the refusals really were the three different ones, so this is three paths and not one.
    expect(noLogin.kind === "error" && noLogin.envelope.code).toBe("AUTHENTICATION_REQUIRED");
    expect(noSuchOperation.kind === "error" && noSuchOperation.envelope.code).toBe(
      "UNSUPPORTED_CAPABILITY",
    );
    expect(notAllowed.kind === "error" && notAllowed.envelope.code).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-COR-01a: a command that succeeds carries the id its request was given", () => {
    resetRequestIds();
    resetProposalIds();

    // Refuse once, so the counter has moved and the success below cannot pass by starting at one.
    expect(idOf(callOperation(undefined, "invoice.get", {}))).toBe("req_1");

    const issued = callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    if (issued.kind !== "result") {
      throw new Error(`expected a result, got ${issued.kind}`);
    }

    expect(issued.envelope.correlation.request_id).toBe("req_2");
    expect(issued.envelope.correlation.principal_id).toBe("user_123");

    // And one more, because that is where an extra mint shows. A review added `nextRequestId()` to the
    // top of a handler and the whole suite passed: the handler's extra id lands *after* the door has
    // already taken req_2, so the gap only appears on the request after it.
    expect(idOf(callOperation(undefined, "invoice.get", {}))).toBe("req_3");
  });

  it("DSOR-COR-01b: two requests never share an id", () => {
    resetRequestIds();
    resetProposalIds();

    const seen = new Set<string>();

    for (let i = 0; i < 20; i += 1) {
      seen.add(idOf(callOperation(undefined, "invoice.get", {})));
    }

    expect(seen.size).toBe(20);
  });
});
