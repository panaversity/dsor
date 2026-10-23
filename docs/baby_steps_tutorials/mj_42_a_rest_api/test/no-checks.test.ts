// Step 42: the proof that the door has no business authorization of its own. No test can prove an
// absence in general, so two tests. First, for every route, six callers, and seven envelopes, the
// door hands call() exactly the request that was sent, once, and answers exactly what call()
// answered. Second, the door's files import nothing that decides who may do what (DSOR-OPR-04b; step
// 42's README, claim C8, decision A4). Rebuilt after the review's M1 and M2: the first version
// compared two worlds, with one company, no mode, and few callers who may, and four door checks
// passed it.
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { call } from "../src/pipeline.ts";
import { ROUTES, type Route } from "../src/routes.ts";
import { createDoor, listen } from "../src/server.ts";
import { statusOf } from "../src/statuses.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const INV_1002 = "dsor://org_456/invoice/INV-1002";
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const RULE = "dsor://org_456/rule/high-value-payment";
const AGENT_TARGET = "dsor://org_456/agent/accounts-payable-fte";

/** What the world holds before each case: a proposal that waits for the CFO, and a drafted payment. */
type Setup = { proposal: string; payload_hash: string; payment: string };

/** The agent's INV-1008, which waits for cfo_100, and user_123's draft of INV-1002. */
async function setUp(w: RuleWorld): Promise<Setup> {
  const agent = { token: "tok_7f3a", tenant: "org_456", idempotency_key: "setup-1008" };
  const waits = (await call(w.registry, w.log, agent, "payment.create", {
    invoice: INV_1008,
    expected_version: 1,
  })) as { proposal: string; payload_hash: string };
  const user = { token: "tok_2c91", tenant: "org_456", idempotency_key: "setup-1002" };
  const drafted = (await call(w.registry, w.log, user, "payment.create", {
    invoice: INV_1002,
    expected_version: 1,
  })) as { data: { id: string } };
  return {
    proposal: waits.proposal,
    payload_hash: waits.payload_hash,
    payment: `dsor://org_456/payment/${drafted.data.id}`,
  };
}

// One input for each operation, with the world's real records, so that some callers may.
function inputOf(operation: string, s: Setup): Record<string, unknown> {
  const inputs: Record<string, Record<string, unknown>> = {
    "invoice.get": { invoice: INV_1008 },
    "invoice.list": { limit: 2 },
    "alert.list": {},
    "invoice.issue": { invoice: INV_1008, expected_version: 1 },
    "payment.create": { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 },
    "payment.cancel": { payment: s.payment, expected_version: 1 },
    "payment.execute": { invoice: INV_1002, payment: s.payment, expected_version: 1 },
    "payment.reconcile": { proposal: s.proposal },
    "payment.run": {
      lines: [
        { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 },
        { invoice: "dsor://org_456/invoice/INV-2002", expected_version: 1 },
      ],
    },
    "proposal.approve": { proposal: s.proposal, payload_hash: s.payload_hash },
    "proposal.execute": { proposal: s.proposal },
    "delegation.revoke": { slip: "dsor://org_456/delegation/del_100", reason: "a step 42 test" },
    "control.suspend": { target: AGENT_TARGET, reason: "a step 42 test" },
    "control.lift": { target: AGENT_TARGET, reason: "a step 42 test" },
    "rule.draft": { rule: RULE, draft: {}, reason: "a step 42 test" },
    "rule.activate": { rule: RULE, version: 8, reason: "a step 42 test" },
    "rule.suspend": { rule: RULE, version: 8, reason: "a step 42 test" },
    "rule.retire": { rule: RULE, version: 8, reason: "a step 42 test" },
  };
  return inputs[operation] ?? {};
}

const CALLERS: Record<string, RequestEnvelope> = {
  cfo_100: { token: "tok_d4e8", tenant: "org_456" },
  user_123: { token: "tok_2c91", tenant: "org_456" },
  "accounts-payable-fte": { token: "tok_7f3a", tenant: "org_456" },
  admin_100: { token: "tok_a100", tenant: "org_456" },
  "user_700 of org_789": { token: "tok_e1a7", tenant: "org_789" },
  nobody: { tenant: "org_456" },
};

// The fields of the envelope a request may add, one at a time, besides none.
function variantsOf(s: Setup): Record<string, Record<string, unknown>> {
  return {
    "no more": {},
    validate_only: { mode: "validate_only" },
    propose_only: { mode: "propose_only" },
    execute: { mode: "execute" },
    request_id: { request_id: "req_from_the_phone" },
    supersedes: { supersedes: s.proposal },
    agent_asserted: { agent_asserted: { task_id: "task_42" } },
  };
}

// The request written as HTTP by hand, not by the door's own code, and the input call() must get:
//   the token as a bearer, each other field as its header, the id in the path, a list's page in
//   the query string, and a command's input as its body.
function asHttp(route: Route, envelope: Record<string, unknown>, input: Record<string, unknown>) {
  const headers: Record<string, string> = {};
  const names: Record<string, string> = {
    tenant: "DSoR-Tenant",
    mode: "DSoR-Mode",
    request_id: "DSoR-Request-Id",
    supersedes: "DSoR-Supersedes",
    idempotency_key: "Idempotency-Key",
  };
  for (const [field, value] of Object.entries(envelope)) {
    if (field === "token") headers["Authorization"] = `Bearer ${String(value)}`;
    else if (field === "agent_asserted") headers["DSoR-Agent-Asserted"] = JSON.stringify(value);
    else headers[names[field] ?? field] = String(value);
  }
  let path = route.path;
  if (route.id !== undefined) {
    const id = String(input[route.id.field]).split("/").at(-1) ?? "";
    path = path.replace("{id}", id);
    // The door builds the address with the header's company (decision A1).
    input = { [route.id.field]: `dsor://${String(envelope["tenant"])}/${route.id.entity}/${id}` };
  }
  if (route.query !== undefined && "limit" in input) path += `?limit=${String(input["limit"])}`;
  const body = route.method === "POST" ? JSON.stringify(input) : undefined;
  return { path, headers, body, input };
}

const open: Server[] = [];
afterAll(async () => {
  await Promise.all(open.map((s) => new Promise((done) => s.close(done))));
});

const VARIANTS = Object.keys(variantsOf({ proposal: "", payload_hash: "", payment: "" }));
const CASES = ROUTES.flatMap((route) =>
  Object.keys(CALLERS).flatMap((who) =>
    VARIANTS.map((variant) => [`${route.method} ${route.path}`, who, variant, route] as const),
  ),
);
const allowed = new Set<string>();

// The routes where no case sets up what a caller who may needs, so every case there is a refusal:
//   control.lift needs a brake pulled, invoice.issue a draft invoice, payment.reconcile an unknown
//   outcome, proposal.execute an approved proposal, rule.draft a whole draft, and rule.activate a
//   drafted version (step 42's README, Think it through).
const NEVER_ALLOWED: string[] = [
  "control.lift",
  "invoice.issue",
  "payment.reconcile",
  "proposal.execute",
  "rule.activate",
  "rule.draft",
];

describe("C8: the door hands call() the request, and gives back its answer", () => {
  it.each(CASES)(
    "DSOR-OPR-04b: %s, by %s, with %s: call() gets exactly the request, once, and the answer is call()'s",
    async (_row, who, variant, route) => {
      const w = await ruleWorldOnTuesday();
      const setup = await setUp(w);
      const asked: { envelope: unknown; name: string; input: unknown }[] = [];
      const answered: Answer[] = [];
      // A spy around call(): the door gets nothing else to ask.
      const server = createDoor(async (envelope, name, input) => {
        asked.push({ envelope, name, input });
        const answer = await call(w.registry, w.log, envelope as RequestEnvelope, name, input);
        answered.push(answer);
        return answer;
      }, w.registry.contracts);
      open.push(server);
      const port = await listen(server, "127.0.0.1", 0);

      const extra = variantsOf(setup)[variant] ?? {};
      const key = route.method === "POST" ? { idempotency_key: `k-${route.operation}` } : {};
      const envelope = { ...CALLERS[who], ...extra, ...key };
      const http = asHttp(route, envelope, inputOf(route.operation, setup));
      const response = await fetch(`http://127.0.0.1:${port}${http.path}`, {
        method: route.method,
        headers: http.headers,
        body: http.body,
      });

      expect(asked).toStrictEqual([{ envelope, name: route.operation, input: http.input }]);
      expect(await response.json()).toStrictEqual(JSON.parse(JSON.stringify(answered[0])));
      expect(response.status).toBe(statusOf(answered[0] as Answer));
      if (!("code" in (answered[0] as Answer))) allowed.add(route.operation);
    },
  );

  it("DSOR-OPR-04b: callers who may: on every other route, some case is let through by DSoR", () => {
    const expected = ROUTES.map((r) => r.operation).filter((o) => !NEVER_ALLOWED.includes(o));
    expect([...allowed].sort()).toStrictEqual(expected.sort());
  });
});

describe("C8: the door's files import nothing that decides who may do what", () => {
  const DOOR_FILES = ["door.ts", "routes.ts", "server.ts", "statuses.ts"];
  const read = (file: string): string =>
    readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

  // Every module a file names: in a static import, an export from, a dynamic import(), or require.
  function modulesOf(text: string): string[] {
    const named = [
      ...text.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gs),
      ...text.matchAll(/\bimport\s*\(\s*["'`]([^"'`]+)["'`]/g),
      ...text.matchAll(/\bimport\s+["']([^"']+)["']/g),
      ...text.matchAll(/\brequire\s*\(\s*["'`]([^"'`]+)["'`]/g),
    ];
    return named.map((m) => m[1] ?? "");
  }

  it("DSOR-OPR-04b: the door imports only the checklist, the types it passes on, its own parts, and node:http", () => {
    const all = [...new Set(DOOR_FILES.flatMap((f) => modulesOf(read(f))))].sort();
    expect(all).toStrictEqual([
      "./door.ts",
      "./envelope.ts",
      "./log.ts",
      "./pipeline.ts",
      "./registry.ts",
      "./routes.ts",
      "./statuses.ts",
      "node:http",
    ]);
  });

  it("DSOR-OPR-04b: every import from the envelope, the log, and the registry is of types only", () => {
    const pattern = /\bimport\b[^;]*?\bfrom\s*"\.\/(?:envelope|log|registry)\.ts"/gs;
    for (const file of DOOR_FILES) {
      for (const [statement] of read(file).matchAll(pattern)) {
        expect(statement).toMatch(/^import\s+type\s/);
      }
    }
  });

  it("DSOR-OPR-04b: pnpm serve makes the door only with doorOver, and adds no request handler of its own", () => {
    const serve = read("serve.ts");
    expect(serve).toMatch(/doorOver\(registry, createDbLog\(pool\)\)/);
    expect(serve).not.toMatch(/createServer|createDoor|\.on\(|addListener|prependListener/);
  });
});
