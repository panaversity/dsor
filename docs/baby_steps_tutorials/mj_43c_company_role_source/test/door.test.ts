// Step 42: how the door turns an HTTP request into what call() takes: the operation's name, the
// request envelope, and the input. It hands everything over as it came, and decides nothing (step
// 42's README, claims C3 and C4, decisions D3, D5, and A1).
import { describe, expect, it } from "vitest";
import { OVER, translate, type HttpRequest } from "../src/door.ts";
import { call } from "../src/pipeline.ts";
import { log, registry } from "./helpers.ts";

/** A request with these parts; headers are lower case, as Node gives them. */
function request(
  method: string,
  url: string,
  headers: Record<string, string[]> = {},
  body?: HttpRequest["body"],
): HttpRequest {
  return { method, url, headers, body };
}

const CFO = { authorization: ["Bearer tok_d4e8"], "dsor-tenant": ["org_456"] };
const SUPERVISOR = { authorization: ["Bearer tok_2c91"], "dsor-tenant": ["org_456"] };

/** What call() answers to what the door made of this request. */
async function answer(req: HttpRequest) {
  const { name, envelope, input } = translate(req);
  return call(registry, log, envelope, name, input);
}

describe("C3: the envelope, from the headers", () => {
  it("Step 42, D3: each header becomes its field of the envelope", () => {
    const headers = {
      authorization: ["Bearer tok_7f3a"],
      "idempotency-key": ["pay-INV-1008-a"],
      "dsor-tenant": ["org_456"],
      "dsor-mode": ["propose_only"],
      "dsor-request-id": ["req_from_the_phone"],
      "dsor-supersedes": ["dsor://org_456/proposal/prop_1"],
      "dsor-agent-asserted": ['{"task_id":"t_1"}'],
      "content-type": ["application/json"],
    };
    expect(translate(request("POST", "/payments", headers)).envelope).toStrictEqual({
      token: "tok_7f3a",
      idempotency_key: "pay-INV-1008-a",
      tenant: "org_456",
      mode: "propose_only",
      request_id: "req_from_the_phone",
      supersedes: "dsor://org_456/proposal/prop_1",
      agent_asserted: { task_id: "t_1" },
    });
  });

  it("Step 42, D3: no Authorization header gives no token, and line ① refuses", async () => {
    const req = request("GET", "/invoices/INV-1008", { "dsor-tenant": ["org_456"] });
    expect(translate(req).envelope).toStrictEqual({ tenant: "org_456" });
    expect(await answer(req)).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it.each(["Basic dG9rX2Q0ZTg=", "tok_d4e8"])(
    "Step 42, D3: an Authorization that is not a bearer token, %s, is handed over as the field authorization, never as a token, and line ① refuses it",
    async (value) => {
      // Found by the review's L1: "Authorization: tok_d4e8", with no scheme, logged in as cfo_100.
      const req = request("GET", "/invoices/INV-1008", {
        authorization: [value],
        "dsor-tenant": ["org_456"],
      });
      expect(translate(req).envelope).toStrictEqual({ authorization: value, tenant: "org_456" });
      expect(await answer(req)).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    },
  );

  it("Step 42, D5: a header given twice is handed over as both values, and line ② refuses them", async () => {
    const req = request("GET", "/invoices/INV-1008", {
      authorization: ["Bearer tok_d4e8"],
      "dsor-tenant": ["org_456", "org_789"],
    });
    expect(translate(req).envelope["tenant"]).toStrictEqual(["org_456", "org_789"]);
    expect(await answer(req)).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("Step 42, D5: two Authorization lines give two tokens, and line ① refuses them", async () => {
    const req = request("GET", "/invoices/INV-1008", {
      authorization: ["Bearer tok_d4e8", "Bearer tok_7f3a"],
      "dsor-tenant": ["org_456"],
    });
    expect(translate(req).envelope["token"]).toStrictEqual(["tok_d4e8", "tok_7f3a"]);
    expect(await answer(req)).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it.each([
    ["dsor-token", "tok_7f3a", "dsor_token"],
    ["dsor-idempotency-key", "pay-1", "dsor_idempotency_key"],
    ["dsor-tenantt", "org_789", "dsor_tenantt"],
    ["dsor_mode", "validate_only", "dsor_mode"],
  ])(
    "Step 42, D3: %s is not one of the five DSoR- headers, so it is handed over under its own name, and line ① refuses it",
    async (header, value, field) => {
      // One spelling for each field (§39). Found by the review's L1 and L3: DSoR-Token and
      //   DSoR-Idempotency-Key were second spellings, and DSoR_Mode was dropped, so a dry run ran.
      const req = request("GET", "/invoices/INV-1008", { ...CFO, [header]: [value] });
      expect(translate(req).envelope[field]).toBe(value);
      expect(await answer(req)).toMatchObject({
        code: "VALIDATION_FAILED",
        message: expect.stringContaining(`not "${field}"`),
      });
    },
  );

  it("Step 42, D5: a DSoR-Agent-Asserted that is not JSON is handed over as its text", () => {
    const req = request("POST", "/payments", { "dsor-agent-asserted": ["task t_1"] });
    expect(translate(req).envelope["agent_asserted"]).toBe("task t_1");
  });
});

describe("C3, changed in step 43: the invitation's header", () => {
  it("Step 43, R1: DSoR-Invitation gives the envelope's invitation, handed over as it came", () => {
    const req = request("GET", "/invoices/INV-1008", {
      ...CFO,
      "dsor-invitation": ["Zq3k_example_code_22ch"],
    });
    expect(translate(req).envelope["invitation"]).toBe("Zq3k_example_code_22ch");
  });
});

describe("C4: the input, from the path, the query string, and the body", () => {
  it("Step 42, A1: GET /invoices/INV-1008 builds org_456's address, and cfo_100 reads the bill", async () => {
    const req = request("GET", "/invoices/INV-1008", CFO);
    expect(translate(req)).toMatchObject({
      name: "invoice.get",
      input: { invoice: "dsor://org_456/invoice/INV-1008" },
    });
    expect(await answer(req)).toMatchObject({
      data: { id: "INV-1008", amount: { value: "31400.00", currency: "USD" } },
    });
  });

  it("Step 42, A1: with org_789 in the header, the address is org_789's, and line ② refuses cfo_100", async () => {
    const req = request("GET", "/invoices/INV-1008", { ...CFO, "dsor-tenant": ["org_789"] });
    expect(translate(req).input).toStrictEqual({ invoice: "dsor://org_789/invoice/INV-1008" });
    expect(await answer(req)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("Step 42, A1: with no company, the address has none, and line ② refuses", async () => {
    const req = request("GET", "/invoices/INV-1008", { authorization: ["Bearer tok_d4e8"] });
    expect(translate(req).input).toStrictEqual({ invoice: "dsor:///invoice/INV-1008" });
    expect(await answer(req)).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("Step 42, C4: ?limit=2 is handed over as the number 2, and the page has two invoices", async () => {
    const req = request("GET", "/invoices?limit=2", CFO);
    expect(translate(req).input).toStrictEqual({ limit: 2 });
    const page = await answer(req);
    expect((page as { data: { items: unknown[] } }).data.items).toHaveLength(2);
  });

  it("Step 42, D5: ?limit=two and ?colour=red are handed over as text, and line ⑥ refuses them", async () => {
    expect(translate(request("GET", "/invoices?limit=two", CFO)).input).toStrictEqual({
      limit: "two",
    });
    expect(await answer(request("GET", "/invoices?limit=two", CFO))).toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(translate(request("GET", "/invoices?colour=red", CFO)).input).toStrictEqual({
      colour: "red",
    });
    expect(await answer(request("GET", "/invoices?colour=red", CFO))).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("Step 42, C4: a command's body is its input, exactly", () => {
    const body = { text: '{"invoice":"dsor://org_456/invoice/INV-1008","expected_version":1}' };
    expect(translate(request("POST", "/payments", CFO, body))).toMatchObject({
      name: "payment.create",
      input: { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 },
    });
  });

  it("Step 42, D5: broken JSON is handed over as its text: line ⑥ refuses user_123, and line ① refuses nobody first", async () => {
    const body = { text: '{"invoice": ' };
    expect(translate(request("POST", "/payments", CFO, body)).input).toBe('{"invoice": ');
    // user_123 may draft a payment, so the call reaches line ⑥ (cfo_100 may not: line ⑤).
    const keyed = { ...SUPERVISOR, "idempotency-key": ["pay-broken-json"] };
    expect(await answer(request("POST", "/payments", keyed, body))).toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(
      await answer(request("POST", "/payments", { "dsor-tenant": ["org_456"] }, body)),
    ).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("Step 42, D5: a field named twice, in the query string and the body, is handed over as both", () => {
    const req = request("POST", "/payments?expected_version=2", CFO, {
      text: '{"expected_version":1}',
    });
    expect(translate(req).input).toStrictEqual({ expected_version: [1, "2"] });
  });

  it("Step 42, D5: a body that is not an object, beside a query string, is handed over as the list of both", () => {
    const req = request("POST", "/payments?x=1", CFO, { text: "[1,2]" });
    expect(translate(req).input).toStrictEqual([[1, 2], { x: "1" }]);
  });

  it("Step 42, A2: a body over the cap is handed over as a short text, never as its content", () => {
    const req = request("POST", "/payments", CFO, { over: true });
    expect(translate(req).input).toBe(OVER);
  });

  it("Step 42, C4: no body and no query string give an empty input", () => {
    expect(translate(request("GET", "/alerts", CFO)).input).toStrictEqual({});
  });
});

describe("C5: a request on no route", () => {
  it("Step 42, A2: its operation's name is its method and path, which no contract has", () => {
    expect(translate(request("DELETE", "/payments/PAY-901?x=1", CFO)).name).toBe(
      "DELETE /payments/PAY-901",
    );
  });
});
