// Step 42: the proof that the door has no business authorization of its own. No test can prove an
// absence in general, so two tests: route by route, for four callers, the door answers what
// call() answers to the same request, and leaves the same record; and the door's files import
// nothing that decides who may do what (DSOR-OPR-04b; step 42's README, claim C8, decision A4).
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { call } from "../src/pipeline.ts";
import { ROUTES } from "../src/routes.ts";
import { createDoor, listen } from "../src/server.ts";
import { ruleWorldOnTuesday } from "./rule-world.ts";

const PROP = "dsor://org_456/proposal/prop_00000000-0000-4000-8000-000000000000";
const HASH = `sha256:${"0".repeat(64)}`;
const INV_1002 = "dsor://org_456/invoice/INV-1002";
const RULE = "dsor://org_456/rule/high-value-payment";

// One input for each operation: some pass, some are refused for their state. Either way the door
//   must answer as call() does.
const INPUTS: Record<string, Record<string, unknown>> = {
  "invoice.get": { invoice: "dsor://org_456/invoice/INV-1008" },
  "invoice.list": { limit: 2 },
  "alert.list": {},
  "invoice.issue": { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 },
  "payment.create": { invoice: INV_1002, expected_version: 1 },
  "payment.cancel": { payment: "dsor://org_456/payment/PAY-901", expected_version: 1 },
  "payment.execute": {
    invoice: INV_1002,
    payment: "dsor://org_456/payment/PAY-901",
    expected_version: 1,
  },
  "payment.reconcile": { proposal: PROP },
  "payment.run": { lines: [{ invoice: INV_1002, expected_version: 1 }] },
  "proposal.approve": { proposal: PROP, payload_hash: HASH },
  "proposal.execute": { proposal: PROP },
  "delegation.revoke": { slip: "dsor://org_456/delegation/del_100", reason: "the step 42 test" },
  "control.suspend": { target: "dsor://org_456/operation/payment.execute", reason: "a test" },
  "control.lift": { target: "dsor://org_456/operation/payment.execute", reason: "a test" },
  "rule.draft": { rule: RULE, draft: {}, reason: "a test" },
  "rule.activate": { rule: RULE, version: 8, reason: "a test" },
  "rule.suspend": { rule: RULE, version: 8, reason: "a test" },
  "rule.retire": { rule: RULE, version: 8, reason: "a test" },
};

const CALLERS: Record<string, RequestEnvelope> = {
  cfo_100: { token: "tok_d4e8", tenant: "org_456" },
  user_123: { token: "tok_2c91", tenant: "org_456" },
  "accounts-payable-fte": { token: "tok_7f3a", tenant: "org_456" },
  nobody: { tenant: "org_456" },
};

// The same request, written as HTTP by hand, not by the door's own code: the token as a bearer, the
//   company and the key as headers, the id in the path, a list's page in the query string, and a
//   command's input as its body.
function asHttp(route: (typeof ROUTES)[number], who: RequestEnvelope, key: string) {
  const input = INPUTS[route.operation] ?? {};
  const headers: Record<string, string> = { "dsor-tenant": String(who.tenant) };
  if (who.token !== undefined) headers["authorization"] = `Bearer ${String(who.token)}`;
  if (route.method === "POST") headers["idempotency-key"] = key;
  let path = route.path.replace("{id}", "INV-1008");
  if (route.query !== undefined && "limit" in input) path += `?limit=${String(input["limit"])}`;
  const body = route.method === "POST" ? JSON.stringify(input) : undefined;
  return { path, headers, body, input };
}

// Ids and request ids are random on each run, and a read's time is the clock's at the read (step
//   15's lesson: a field that differs on every call breaks exact comparisons). Everything else must
//   be equal.
function same(answer: Answer): unknown {
  const text = JSON.stringify(answer)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/"observed_at":"[^"]*"/g, '"observed_at":"<time>"');
  return JSON.parse(text);
}

const open: Server[] = [];
afterAll(async () => {
  await Promise.all(open.map((s) => new Promise((done) => s.close(done))));
});

const CASES = ROUTES.flatMap((route) =>
  Object.keys(CALLERS).map((who) => [`${route.method} ${route.path}`, who, route] as const),
);
const kinds = { answered: 0, refused: 0 };

describe("C8: the door answers what call() answers", () => {
  it.each(CASES)(
    "DSOR-OPR-04b: %s, called by %s, answers through the door as call() does",
    async (_row, who, route) => {
      const caller = CALLERS[who] ?? {};
      const key = `k-${route.operation}-${who}`;
      const { path, headers, body, input } = asHttp(route, caller, key);

      // Two worlds that start the same: one is asked through the door, one through call() directly.
      const viaDoor = await ruleWorldOnTuesday();
      const direct = await ruleWorldOnTuesday();
      const server = createDoor(viaDoor.registry, viaDoor.log);
      open.push(server);
      const port = await listen(server, "127.0.0.1", 0);

      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: route.method,
        headers,
        body,
      });
      const throughDoor = (await response.json()) as Answer;
      const envelope = route.method === "POST" ? { ...caller, idempotency_key: key } : caller;
      const fromCall = await call(direct.registry, direct.log, envelope, route.operation, input);

      expect(same(throughDoor)).toStrictEqual(same(fromCall));
      const [a, b] = [await viaDoor.log.records(), await direct.log.records()];
      expect(a.length).toBe(b.length);
      expect([a.at(-1)?.authorization, a.at(-1)?.result]).toStrictEqual([
        b.at(-1)?.authorization,
        b.at(-1)?.result,
      ]);
      if ("code" in fromCall) kinds.refused++;
      else kinds.answered++;
    },
  );

  it("DSOR-OPR-04b: the cases hold callers who may and callers who may not", () => {
    expect(kinds.answered).toBeGreaterThan(0);
    expect(kinds.refused).toBeGreaterThan(0);
  });
});

describe("C8: the door's files import nothing that decides who may do what", () => {
  const DOOR_FILES = ["door.ts", "routes.ts", "server.ts", "statuses.ts"];

  function importsOf(file: string): string[] {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    return [...text.matchAll(/^import[^;]*?from "([^"]+)";/gms)].map((m) => m[1] ?? "").sort();
  }

  it("DSOR-OPR-04b: the door imports only the checklist, the types it passes on, its routes, and node:http", () => {
    const all = [...new Set(DOOR_FILES.flatMap(importsOf))].sort();
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

  it("DSOR-OPR-04b: what the door takes from the envelope, the log, and the registry are types only", () => {
    for (const file of DOOR_FILES) {
      const text = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      for (const from of ["./envelope.ts", "./log.ts", "./registry.ts"]) {
        const line = text.split("\n").find((l) => l.includes(`from "${from}"`));
        if (line !== undefined) expect(line).toMatch(/^import type /);
      }
    }
  });
});
