// Step 42: the door as a real HTTP server, on Node's own node:http, called with fetch. Every
// request is answered by one call of call(), and the door has no answer of its own (step 42's
// README, claims C1, C5, C6, and C7, decisions D4, D5, D6, D7, and A2).
import type { Server } from "node:http";
import { connect } from "node:net";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { DecisionRecord } from "../src/log.ts";
import { CAP, doorOver, listen, readBody } from "../src/server.ts";
import { ROUTES } from "../src/routes.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";
import { schemaProblems } from "./helpers.ts";

const CFO = { authorization: "Bearer tok_d4e8", "dsor-tenant": "org_456" };
const SUPERVISOR = { authorization: "Bearer tok_2c91", "dsor-tenant": "org_456" };
const NOBODY = { "dsor-tenant": "org_456" };

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/** A world in memory, and its door, listening on a free port of 127.0.0.1. */
async function doorOf(w?: RuleWorld) {
  const world = w ?? (await ruleWorldOnTuesday());
  const server = doorOver(world.registry, world.log);
  open.push(server);
  const port = await listen(server, "127.0.0.1", 0);
  return { world, base: `http://127.0.0.1:${port}` };
}

/** Sends one request, and reads its status and its body as JSON. */
async function send(
  base: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; answer: Answer }> {
  const response = await fetch(base + path, { method, headers, body });
  return { status: response.status, answer: (await response.json()) as Answer };
}

async function records(w: RuleWorld): Promise<DecisionRecord[]> {
  return w.log.records();
}

describe("C1: every request is answered by one call of call()", () => {
  it.each(ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "DSOR-OPR-04a: %s reaches call() once, with the operation its row names",
    async (_row, route) => {
      const { world, base } = await doorOf();
      const before = (await records(world)).length;
      const path = route.path.replace("{id}", "INV-1008");
      const body = route.method === "POST" ? "{}" : undefined;
      await send(base, route.method, path, { ...CFO, "idempotency-key": "k-1" }, body);
      const after = await records(world);
      expect(after.length - before).toBe(1);
      expect(String(after.at(-1)?.operation)).toMatch(new RegExp(`^${route.operation}@`));
    },
  );
});

describe("C5: the door has no answer of its own", () => {
  it("Step 42, A2: an unknown route is answered by call(): 404 UNSUPPORTED_CAPABILITY for cfo_100, recorded", async () => {
    const { world, base } = await doorOf();
    const before = (await records(world)).length;
    const { status, answer } = await send(base, "DELETE", "/payments/PAY-901", CFO);
    expect([status, answer]).toMatchObject([
      404,
      { code: "UNSUPPORTED_CAPABILITY", message: 'no operation named "DELETE /payments/PAY-901"' },
    ]);
    expect((await records(world)).length - before).toBe(1);
  });

  it("Step 42, A2: an unknown route with no login is 401: line ① runs first, and it is recorded", async () => {
    const { world, base } = await doorOf();
    const before = (await records(world)).length;
    const { status, answer } = await send(base, "GET", "/admin", NOBODY);
    expect([status, answer]).toMatchObject([401, { code: "AUTHENTICATION_REQUIRED" }]);
    expect((await records(world)).length - before).toBe(1);
  });

  it("Step 42, A2: the four system jobs have no route: POST /proposals/expire_due is an unknown route", async () => {
    const { base } = await doorOf();
    const { status, answer } = await send(base, "POST", "/proposals/expire_due", CFO, "{}");
    expect([status, answer]).toMatchObject([404, { code: "UNSUPPORTED_CAPABILITY" }]);
  });

  it("Step 42, A2: a body of 1 MiB is 422 for user_123 and 401 for nobody, each recorded", async () => {
    const { world, base } = await doorOf();
    const big = JSON.stringify({
      invoice: "dsor://org_456/invoice/INV-1008",
      pad: "x".repeat(1 << 20),
    });
    const before = (await records(world)).length;
    const keyed = { ...SUPERVISOR, "idempotency-key": "pay-big-body" };
    const supervisor = await send(base, "POST", "/payments", keyed, big);
    const nobody = await send(base, "POST", "/payments", NOBODY, big);
    expect([supervisor.status, supervisor.answer]).toMatchObject([
      422,
      { code: "VALIDATION_FAILED" },
    ]);
    expect([nobody.status, nobody.answer]).toMatchObject([
      401,
      { code: "AUTHENTICATION_REQUIRED" },
    ]);
    expect((await records(world)).length - before).toBe(2);
  });

  it("Step 42, D5: broken JSON through the door is 422 for user_123 and 401 for nobody, each recorded", async () => {
    // Found by break B8: a door that answered broken JSON with 400 itself left every test green.
    const { world, base } = await doorOf();
    const before = (await records(world)).length;
    const keyed = { ...SUPERVISOR, "idempotency-key": "pay-broken-json" };
    const supervisor = await send(base, "POST", "/payments", keyed, '{"invoice": ');
    const nobody = await send(base, "POST", "/payments", NOBODY, '{"invoice": ');
    expect([supervisor.status, supervisor.answer]).toMatchObject([
      422,
      { code: "VALIDATION_FAILED" },
    ]);
    expect([nobody.status, nobody.answer]).toMatchObject([
      401,
      { code: "AUTHENTICATION_REQUIRED" },
    ]);
    expect((await records(world)).length - before).toBe(2);
  });

  it("Step 42, A2: the door keeps no more than 64 KiB of a body: exactly the cap is read, one byte more is not", async () => {
    const exactly = await readBody(Readable.from([Buffer.alloc(CAP, "a")]));
    expect(exactly).toStrictEqual({ text: "a".repeat(CAP) });
    const over = await readBody(Readable.from([Buffer.alloc(CAP, "a"), Buffer.from("b")]));
    expect(over).toStrictEqual({ over: true });
  });

  it("Step 42, A2: a body sent in pieces is joined, and an empty one is no body", async () => {
    const pieces = await readBody(Readable.from([Buffer.from('{"a"'), Buffer.from(":1}")]));
    expect(pieces).toStrictEqual({ text: '{"a":1}' });
    expect(await readBody(Readable.from([]))).toBeUndefined();
  });
});

describe("C5: no request can stop the door (the review's H1 and L2)", () => {
  /** Sends raw text on a socket, and reads what comes back until the server closes it. */
  function raw(base: string, text: string, cut = false): Promise<string> {
    const { port } = new URL(base);
    return new Promise((done) => {
      const socket = connect(Number(port), "127.0.0.1");
      let heard = "";
      socket.on("data", (d) => (heard += d.toString()));
      socket.on("close", () => done(heard));
      socket.on("error", () => done(heard));
      socket.write(text, () => {
        if (cut) socket.destroy();
      });
    });
  }

  it("Step 42, A2: a request target that is no URL is answered by call(), recorded, and the door still answers the next", async () => {
    const { world, base } = await doorOf();
    const before = (await records(world)).length;
    const heard = await raw(
      base,
      `GET http://a:99999/x HTTP/1.1\r\nHost: 127.0.0.1:${new URL(base).port}\r\nAuthorization: Bearer tok_d4e8\r\nDSoR-Tenant: org_456\r\nConnection: close\r\n\r\n`,
    );
    expect(heard).toMatch(/^HTTP\/1\.1 404 /);
    expect(heard).toContain('no operation named \\"GET http://a:99999/x\\"');
    expect((await records(world)).length - before).toBe(1);
    expect((await send(base, "GET", "/invoices/INV-1008", CFO)).status).toBe(200);
  });

  it("Step 42, A2: a body cut off mid-upload is recorded, and the door still answers the next", async () => {
    const { world, base } = await doorOf();
    const before = (await records(world)).length;
    await raw(
      base,
      `POST /payments HTTP/1.1\r\nHost: 127.0.0.1:${new URL(base).port}\r\nDSoR-Tenant: org_456\r\nContent-Length: 100\r\n\r\n{"inv`,
      true,
    );
    await vi.waitFor(async () => expect((await records(world)).length - before).toBe(1));
    expect((await records(world)).at(-1)?.result).toBe("AUTHENTICATION_REQUIRED");
    expect((await send(base, "GET", "/invoices/INV-1008", CFO)).status).toBe(200);
  });

  it.each([
    "/alerts/../invoices/INV-1008",
    "/alerts/%2e%2e/invoices/INV-1008",
    "//evil/invoices/INV-1008",
  ])("Step 42, A2: %s is matched as it was sent: no route, never invoice.get", async (path) => {
    const { base } = await doorOf();
    const heard = await raw(
      base,
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${new URL(base).port}\r\nAuthorization: Bearer tok_d4e8\r\nDSoR-Tenant: org_456\r\nConnection: close\r\n\r\n`,
    );
    expect(heard).toMatch(/^HTTP\/1\.1 404 /);
    expect(heard).toContain(`no operation named \\"GET ${path}`);
  });
});

describe("C5: what Node would answer by itself (the review's M3, L4, and L6)", () => {
  it("Step 42, A2: an Expect header Node does not know is answered by call(), not by Node's 417, and recorded", async () => {
    const { world, base } = await doorOf();
    const before = (await records(world)).length;
    // fetch will not send an Expect header, so the request goes on a socket of its own.
    const heard = await new Promise<string>((done) => {
      const socket = connect(Number(new URL(base).port), "127.0.0.1");
      let text = "";
      socket.on("data", (d) => (text += d.toString()));
      socket.on("close", () => done(text));
      socket.write(
        `GET /invoices/INV-1008 HTTP/1.1\r\nHost: 127.0.0.1:${new URL(base).port}\r\nAuthorization: Bearer tok_d4e8\r\nDSoR-Tenant: org_456\r\nExpect: nope\r\nConnection: close\r\n\r\n`,
      );
    });
    expect(heard).toMatch(/^HTTP\/1\.1 200 /);
    expect((await records(world)).length - before).toBe(1);
  });

  it("Step 42, D4: a 401 names the scheme a caller must use, as HTTP asks", async () => {
    const { base } = await doorOf();
    const response = await fetch(`${base}/invoices/INV-1008`, { headers: NOBODY });
    expect([response.status, response.headers.get("www-authenticate")]).toStrictEqual([
      401,
      "Bearer",
    ]);
  });

  it("Step 42, D5: a body that is not UTF-8 is handed over as a short text, never as a guess, and refused", async () => {
    const { world, base } = await doorOf();
    const before = (await records(world)).length;
    const body = Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]);
    const keyed = { ...SUPERVISOR, "idempotency-key": "pay-not-utf8" };
    const response = await fetch(`${base}/payments`, { method: "POST", headers: keyed, body });
    expect([response.status, ((await response.json()) as { code: string }).code]).toStrictEqual([
      422,
      "VALIDATION_FAILED",
    ]);
    expect((await records(world)).length - before).toBe(1);
    expect(await readBody(Readable.from([body]))).toStrictEqual({ notUtf8: true });
  });
});

describe("C6: the status, and the body unchanged", () => {
  it("Step 42, D4: cfo_100 reads INV-1008: 200, and the body is call()'s answer", async () => {
    const { base } = await doorOf();
    const { status, answer } = await send(base, "GET", "/invoices/INV-1008", CFO);
    expect(status).toBe(200);
    expect(answer).toMatchObject({ data: { id: "INV-1008", amount: { value: "31400.00" } } });
  });

  it("Step 42, D4: the agent's INV-1008 waits for the CFO: 202 PENDING_APPROVAL", async () => {
    const { base } = await doorOf();
    const agent = {
      authorization: "Bearer tok_7f3a",
      "dsor-tenant": "org_456",
      "idempotency-key": "pay-1008",
    };
    const body = JSON.stringify({
      invoice: "dsor://org_456/invoice/INV-1008",
      expected_version: 1,
    });
    const { status, answer } = await send(base, "POST", "/payments", agent, body);
    expect([status, answer]).toMatchObject([202, { outcome: "PENDING_APPROVAL" }]);
  });

  it("Step 42, D4: a silent bank's OUTCOME_UNKNOWN is 409, never a status a library repeats, and its body is unchanged", async () => {
    const { world, base } = await doorOf();
    const draft = await send(
      base,
      "POST",
      "/payments",
      { ...SUPERVISOR, "idempotency-key": "pay-1002" },
      JSON.stringify({ invoice: "dsor://org_456/invoice/INV-1002", expected_version: 1 }),
    );
    const payment = `dsor://org_456/payment/${(draft.answer as { data: { id: string } }).data.id}`;
    world.bank.mode = "silent";
    const sent = await send(
      base,
      "POST",
      "/payments/execute",
      { ...SUPERVISOR, "idempotency-key": "send-1002" },
      JSON.stringify({ invoice: "dsor://org_456/invoice/INV-1002", payment, expected_version: 1 }),
    );
    world.bank.mode = "good";
    expect([sent.status, sent.answer]).toMatchObject([
      409,
      { code: "OUTCOME_UNKNOWN", retry: "after_reconciliation" },
    ]);
  });
});

describe("C9: only requests meant for this door (the learner's D8, the review's M4)", () => {
  /** Sends one request on a socket of its own, with these header lines, and reads the answer. */
  function rawAt(base: string, lines: string[]): Promise<string> {
    return new Promise((done) => {
      const socket = connect(Number(new URL(base).port), "127.0.0.1");
      let heard = "";
      socket.on("data", (d) => (heard += d.toString()));
      socket.on("close", () => done(heard));
      socket.write(
        [
          ...lines,
          "Authorization: Bearer tok_d4e8",
          "DSoR-Tenant: org_456",
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
    });
  }

  /** The body of an HTTP answer. */
  function bodyOf(heard: string): unknown {
    return JSON.parse(heard.slice(heard.indexOf("\r\n\r\n") + 4));
  }

  it.each([
    ["a name made to point at 127.0.0.1", (port: string) => `Host: attacker.example:${port}`],
    ["localhost", (port: string) => `Host: localhost:${port}`],
    ["another port", () => "Host: 127.0.0.1:1"],
    ["no port", () => "Host: 127.0.0.1"],
  ])(
    "Step 42, D8: a Host of %s is refused with 421 by the door, and call() is never asked",
    async (_kind, host) => {
      const { world, base } = await doorOf();
      const before = (await records(world)).length;
      const heard = await rawAt(base, [
        "POST /proposals/approve HTTP/1.1",
        host(new URL(base).port),
      ]);
      expect(heard).toMatch(/^HTTP\/1\.1 421 /);
      expect(schemaProblems(bodyOf(heard))).toStrictEqual([]);
      expect(bodyOf(heard)).toMatchObject({ code: "VALIDATION_FAILED", retry: "never" });
      expect((await records(world)).length - before).toBe(0);
    },
  );

  it("Step 42, D8: a request with no Host at all is refused with 421", async () => {
    const { world, base } = await doorOf();
    const before = (await records(world)).length;
    const heard = await rawAt(base, ["GET /invoices/INV-1008 HTTP/1.0"]);
    expect(heard).toMatch(/^HTTP\/1\.[01] 421 /);
    expect((await records(world)).length - before).toBe(0);
  });

  it("Step 42, D8: the door's own address, 127.0.0.1 and its port, goes to call()", async () => {
    const { world, base } = await doorOf();
    const before = (await records(world)).length;
    const heard = await rawAt(base, [
      "GET /invoices/INV-1008 HTTP/1.1",
      `Host: 127.0.0.1:${new URL(base).port}`,
    ]);
    expect(heard).toMatch(/^HTTP\/1\.1 200 /);
    expect((await records(world)).length - before).toBe(1);
  });
});

describe("C7: only this computer", () => {
  it.each(["0.0.0.0", "::", "localhost", "192.168.1.20"])(
    "Step 42, D7: start-up on %s is refused while the logins are the fake table",
    async (host) => {
      const w = await ruleWorldOnTuesday();
      const server = doorOver(w.registry, w.log);
      open.push(server);
      await expect(listen(server, host, 0)).rejects.toThrow(
        `the door listens only on 127.0.0.1 while the logins are step 05's fake table, not on ${host}`,
      );
      expect(server.listening).toBe(false);
    },
  );

  it("Step 42, D7: on 127.0.0.1 it listens, on the port it was given or a free one", async () => {
    const { base } = await doorOf();
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("Step 42, D2: a door whose table of routes is wrong does not start", async () => {
    const w = await ruleWorldOnTuesday();
    const routes = [
      ...ROUTES,
      { method: "POST" as const, path: "/x", operation: "proposal.cancel" },
    ];
    expect(() => doorOver(w.registry, w.log, routes)).toThrow(
      'the routes refused to start:\n  POST /x names "proposal.cancel", which no contract has',
    );
  });
});
