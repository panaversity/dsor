// Three ways to call, on the database (DSOR-OPR-05, DSOR-OPR-06). A propose_only call leaves a
// claim in its mode and a READY proposal, and no payment. A dry run leaves only its decision
// record. One key keeps one mode, even when two calls race for it. A real PostgreSQL, never a mock
// (step 23's README, decisions 4, 12, and 13).
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { payloadHash } from "../src/canonical.ts";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbClaims, createDbLog, createDbProposals } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  dbRegistry,
  newPool,
  NO_PRIVILEGE,
  ownerClaims,
  ownerInvoices,
  requestId,
  tryThenRollBack,
} from "./db.ts";
import { AGENT, keyed, SUPERVISOR } from "./helpers.ts";

// The test's own window into the database: a pool the code under test never uses.
const observer = newPool();
const pool = newPool();
const log = createDbLog(pool);
const registry = dbRegistry(pool);
const proposals = createDbProposals(pool);

// The tests' own invoice, INV-9001, which the owner adds, so the story's invoices stay as they
// are (step 21's README, decision 12).
const INV_9001 = { invoice: "dsor://org_456/invoice/INV-9001", expected_version: 1 };
beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  ownerInvoices("remove");
  await observer.end();
  await pool.end();
});

/** The envelope, in this mode. */
function inMode<E extends object>(envelope: E, mode: string): E & { mode: string } {
  return { ...envelope, mode };
}

/** user_123 drafts a payment for INV-9001, and the answer and the lines that ran come back. */
async function draft(envelope: RequestEnvelope): Promise<{ answer: Answer; lines: number[] }> {
  const lines: number[] = [];
  const answer = await call(registry, log, envelope, "payment.create", INV_9001, (n) =>
    lines.push(n),
  );
  return { answer, lines };
}

/** One statement as dsor_runtime inside org_456, rolled back after, and its rows. */
async function rowsOf(sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await tryThenRollBack(observer, sql, "org_456", values)).rows;
}

/** The payments drafted for INV-9001. */
async function drafts(): Promise<number> {
  const rows = await rowsOf(
    "SELECT count(*)::int AS n FROM app.payments WHERE tenant_id = 'org_456' AND invoice_id = 'INV-9001'",
  );
  return Number(rows[0]?.["n"]);
}

/** The error code PostgreSQL gave one statement, as dsor_runtime inside org_456, or "none". */
async function codeOf(sql: string): Promise<string> {
  try {
    await tryThenRollBack(observer, sql, "org_456");
    return "none";
  } catch (error) {
    return String((error as { code?: string }).code);
  }
}

const proposalId = (answer: Answer): string =>
  ("proposal" in answer ? String(answer.proposal) : "").slice("dsor://org_456/proposal/".length);

describe("propose_only, on the database", () => {
  it("DSOR-OPR-05: on the database, a propose_only call leaves a READY proposal and a claim in its mode, and no payment", async () => {
    const before = await drafts();
    const envelope = inMode(keyed(SUPERVISOR), "propose_only");
    const { answer, lines } = await draft(envelope);
    expect(answer).toMatchObject({ outcome: "READY", semantics: "compensatable" });
    // Since step 24, lines ⑨ and ⑩ too (step 24's README, decision 9).
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const proposal = await proposals.get("org_456", proposalId(answer));
    expect([proposal?.mode, proposal?.state]).toStrictEqual(["propose_only", "READY"]);
    expect(proposal?.transitions.map((t) => t.to)).toStrictEqual(["PROPOSED", "READY"]);
    const claims = await rowsOf(
      "SELECT mode, answer FROM dsor.idempotency WHERE idempotency_key = $1",
      [envelope.idempotency_key],
    );
    expect(claims).toStrictEqual([
      {
        mode: "propose_only",
        answer: { ready: true, proposal: "proposal" in answer && answer.proposal },
      },
    ]);
    expect(await drafts()).toBe(before);
  });

  it("DSOR-IDM-01c: on the database, a replay of a propose_only call names the same proposal, and the database holds one", async () => {
    const envelope = inMode(keyed(SUPERVISOR), "propose_only");
    const first = await draft(envelope);
    const request_id = requestId("s23-replay");
    const again = await draft({ ...envelope, request_id });
    expect(again.answer).toMatchObject({ outcome: "READY" });
    expect(proposalId(again.answer)).toBe(proposalId(first.answer));
    expect(again.lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 11]);
    const rows = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.proposals WHERE idempotency_key = $1",
      [envelope.idempotency_key],
    );
    expect(rows).toStrictEqual([{ n: 1 }]);
    // The replay's record names the first call, as an execute call's does (step 20's README,
    // decision 8). Found by step 23's review: the database's waiting replay was not checked.
    const records = await rowsOf(
      `SELECT extensions FROM dsor.audit WHERE correlation->>'request_id' = $1 AND kind = 'decision'`,
      [request_id],
    );
    expect(records).toStrictEqual([
      {
        extensions: {
          "org.panaversity.steps": {
            idempotency: {
              key: envelope.idempotency_key,
              replay_of: first.answer.correlation.request_id,
            },
            proposal: "proposal" in first.answer && first.answer.proposal,
            invocation_mode: "propose_only",
          },
        },
      },
    ]);
  });

  it("DSOR-SCH-01: the propose_only proposal the database stores passes proposal.schema.json", async () => {
    const { answer } = await draft(inMode(keyed(SUPERVISOR), "propose_only"));
    const proposal = await proposals.get("org_456", proposalId(answer));
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    for (const file of ["common", "security-context"]) {
      const url = new URL(`../schemas/${file}.schema.json`, import.meta.url);
      ajv.addSchema(JSON.parse(readFileSync(url, "utf8")) as object);
    }
    const url = new URL("../schemas/proposal.schema.json", import.meta.url);
    const passes = ajv.compile(JSON.parse(readFileSync(url, "utf8")) as object);
    expect([passes(proposal), passes.errors]).toStrictEqual([true, null]);
  });
});

describe("validate_only, on the database", () => {
  it("DSOR-OPR-06: on the database, a dry run leaves no claim, no proposal, and no payment: only its decision record, which names its mode", async () => {
    const before = await drafts();
    const request_id = requestId("s23-dry");
    const { answer, lines } = await draft(inMode({ ...SUPERVISOR, request_id }, "validate_only"));
    expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
    // Since step 24, lines ⑨ and ⑩ too (step 24's README, decision 8).
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 9, 10, 11]);
    const records = await rowsOf(
      `SELECT kind, "authorization", result, extensions FROM dsor.audit
        WHERE correlation->>'request_id' = $1 ORDER BY sequence`,
      [request_id],
    );
    expect(records).toStrictEqual([
      {
        kind: "decision",
        authorization: "ALLOW",
        result: "ok",
        extensions: { "org.panaversity.steps": { invocation_mode: "validate_only" } },
      },
    ]);
    const claims = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.idempotency WHERE request_id = $1",
      [request_id],
    );
    expect(claims).toStrictEqual([{ n: 0 }]);
    expect(await drafts()).toBe(before);
  });
});

describe("one key, one mode, on the database", () => {
  it("Step 23: on the database, a key prepared and then executed is refused with IDEMPOTENCY_CONFLICT, and nothing is drafted (step 23's README, decision 4)", async () => {
    const before = await drafts();
    const envelope = keyed(SUPERVISOR);
    await draft(inMode(envelope, "propose_only"));
    const { answer } = await draft(envelope);
    expect(answer).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      message:
        'the idempotency_key was used for "payment.create" in propose_only mode, and a key keeps its mode',
    });
    expect(await drafts()).toBe(before);
    const claims = await rowsOf("SELECT mode FROM dsor.idempotency WHERE idempotency_key = $1", [
      envelope.idempotency_key,
    ]);
    expect(claims).toStrictEqual([{ mode: "propose_only" }]);
  });

  // Both orders: the call sent first wins nearly every time. Found by step 23's review: with
  // execute always first, the test proved only "execute, then propose_only is refused".
  it.each([
    ["execute first", ["execute", "propose_only"]],
    ["propose_only first", ["propose_only", "execute"]],
  ])(
    "Step 23: on the database, two calls with one key at the same moment, one in each mode, %s: one wins, and the other is refused",
    async (_order, modes) => {
      const before = await drafts();
      const envelope = keyed(SUPERVISOR);
      // Two connections, so the two INSERTs of the claim really meet at the primary key.
      const answers = await Promise.all(
        modes.map((mode) => draft(mode === "execute" ? envelope : inMode(envelope, mode))),
      );
      const heard = answers.map(({ answer }) => {
        if ("code" in answer) return answer.code;
        return "outcome" in answer ? answer.outcome : "data";
      });
      expect(heard.filter((word) => word === "IDEMPOTENCY_CONFLICT")).toHaveLength(1);
      expect(heard.filter((word) => word === "COMMITTED" || word === "READY")).toHaveLength(1);
      const proposalsMade = await rowsOf(
        "SELECT count(*)::int AS n FROM dsor.proposals WHERE idempotency_key = $1",
        [envelope.idempotency_key],
      );
      expect(proposalsMade).toStrictEqual([{ n: 1 }]);
      // A draft only when execute won.
      expect(await drafts()).toBe(before + (heard.includes("COMMITTED") ? 1 : 0));
    },
  );

  it("Step 23: on the database, a key executed and then sent to prepare is refused, and makes no second proposal", async () => {
    const envelope = keyed(SUPERVISOR);
    await draft(envelope);
    const { answer } = await draft(inMode(envelope, "propose_only"));
    expect(answer).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      message:
        'the idempotency_key was used for "payment.create" in execute mode, and a key keeps its mode',
    });
    const rows = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.proposals WHERE idempotency_key = $1",
      [envelope.idempotency_key],
    );
    expect(rows).toStrictEqual([{ n: 1 }]);
  });

  it("Step 23: on the database, a key sent again with another request, in another mode, hears that the request differs: the fingerprint is compared first", async () => {
    const envelope = keyed(SUPERVISOR);
    await draft(envelope);
    const answer = await call(registry, log, inMode(envelope, "propose_only"), "payment.create", {
      ...INV_9001,
      expected_version: 2,
    });
    expect(answer).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      message: 'the idempotency_key was used for a different request to "payment.create"',
    });
  });

  // Found by step 23's review: a replay gave back a waiting answer kept in an execute claim, and a
  // value kept in a propose_only claim. Only a bug or a change by hand leaves either (step 23's
  // README, decision 16).
  it.each([
    ["a waiting proposal, in an execute claim", "ready", "execute"],
    ["a value, in a propose_only claim", "value", "propose_only"],
  ])(
    "Step 23: a replay of a claim that keeps %s fails with INTERNAL_ERROR (step 23's README, decision 16)",
    async (_what, kind, mode) => {
      const key = keyed(SUPERVISOR).idempotency_key;
      const proposal = JSON.stringify(
        "dsor://org_456/proposal/prop_00000000-0000-4000-8000-000000000024",
      );
      expect(ownerClaims("plant", key, payloadHash(INV_9001), proposal, kind, mode)).toStrictEqual({
        planted: 1,
      });
      const envelope = { ...SUPERVISOR, idempotency_key: key };
      const { answer } = await draft(mode === "execute" ? envelope : inMode(envelope, mode));
      expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    },
  );

  it("Step 23: a replay of a waiting answer that names another company's proposal fails with INTERNAL_ERROR", async () => {
    const key = keyed(SUPERVISOR).idempotency_key;
    const foreign = JSON.stringify(
      "dsor://org_789/proposal/prop_00000000-0000-4000-8000-000000000789",
    );
    expect(ownerClaims("plant", key, payloadHash(INV_9001), foreign, "ready")).toStrictEqual({
      planted: 1,
    });
    const { answer } = await draft(inMode({ ...SUPERVISOR, idempotency_key: key }, "propose_only"));
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect("proposal" in answer).toBe(false);
  });

  it("Step 23: a replay of a claim that keeps a waiting proposal whose ready is not true fails with INTERNAL_ERROR", async () => {
    const key = keyed(SUPERVISOR).idempotency_key;
    const proposal = JSON.stringify(
      "dsor://org_456/proposal/prop_00000000-0000-4000-8000-000000000023",
    );
    expect(ownerClaims("plant", key, payloadHash(INV_9001), proposal, "ready-yes")).toStrictEqual({
      planted: 1,
    });
    const { answer } = await draft(inMode({ ...SUPERVISOR, idempotency_key: key }, "propose_only"));
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  it("Step 23: a replay of a claim that keeps a waiting proposal with no proposal fails with INTERNAL_ERROR", async () => {
    const key = keyed(SUPERVISOR).idempotency_key;
    expect(ownerClaims("plant", key, payloadHash(INV_9001), "none", "ready")).toStrictEqual({
      planted: 1,
    });
    const { answer } = await draft(inMode({ ...SUPERVISOR, idempotency_key: key }, "propose_only"));
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect("proposal" in answer).toBe(false);
  });

  // Found by step 23's sweep: with the claim store's own check of a waiting answer gone, the
  // checklist's check that a command's claim keeps a proposal still refused the call, so no test
  // failed. The store's check is tried alone here, with no checklist around it.
  it("Step 23: the database's claim store, alone, refuses a kept waiting answer with no proposal", async () => {
    const key = keyed(SUPERVISOR).idempotency_key;
    const hash = payloadHash(INV_9001);
    expect(ownerClaims("plant", key, hash, "none", "ready")).toStrictEqual({ planted: 1 });
    const scope = { tenant: "org_456", principal: "user_123", operation: "payment.create", key };
    await expect(
      createDbClaims(pool).run(
        scope,
        hash,
        "propose_only",
        requestId("s23-alone"),
        async () => ({}),
      ),
    ).rejects.toThrow("a claim holds a waiting proposal that is not one");
  });
});

describe("the database's own rules for the modes", () => {
  const CLAIM = `INSERT INTO dsor.idempotency (tenant_id, principal, operation, idempotency_key,
                                                payload_hash, request_id`;
  const HASH = "'sha256:' || repeat('e', 64)";

  it.each([
    [
      "no mode",
      `${CLAIM}) VALUES ('org_456', 'user_123', 'payment.create', 'k-s23-raw', ${HASH}, 'req_s23')`,
      "23502",
    ],
    [
      "mode validate_only",
      `${CLAIM}, mode) VALUES ('org_456', 'user_123', 'payment.create', 'k-s23-raw', ${HASH}, 'req_s23', 'validate_only')`,
      "23514",
    ],
    [
      "mode propose_only",
      `${CLAIM}, mode) VALUES ('org_456', 'user_123', 'payment.create', 'k-s23-raw', ${HASH}, 'req_s23', 'propose_only')`,
      "none",
    ],
  ])(
    "Step 23: the database answers a claim with %s with %s (step 23's README, decision 13)",
    async (_what, sql, code) => {
      expect(await codeOf(sql)).toBe(code);
    },
  );

  it("Step 23: dsor_runtime may never change a claim's mode", async () => {
    const sql = "UPDATE dsor.idempotency SET mode = 'execute' WHERE tenant_id = 'org_456'";
    expect(await codeOf(sql)).toBe(NO_PRIVILEGE.code);
  });

  it.each([
    ["propose_only", "none"],
    ["validate_only", "23514"],
  ])("Step 23: the database answers a new proposal in mode %s with %s", async (mode, code) => {
    const sql = `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload,
                                             payload_hash, resources, requester, idempotency_key)
                 VALUES ('org_456', 'prop_00000000-0000-4000-8000-000000000230',
                         'payment.create@1', '${mode}', 'PROPOSED', '{}',
                         'sha256:' || repeat('c', 64), ARRAY[]::text[], '{}', 'k-s23-proposal')`;
    expect(await codeOf(sql)).toBe(code);
  });

  it("Step 23: migration 016 gives a claim made before it the mode execute, and leaves no default (step 23's README, decision 13)", () => {
    expect(ownerClaims("before016")).toStrictEqual({
      modes: ["execute"],
      column: { column_default: null, is_nullable: "NO" },
    });
  });
});

// Found by step 23's review: on the database too, only payment.create was tried in the two new
// modes, and nothing pinned what a prepared proposal keeps.
describe("from the review, on the database", () => {
  it("DSOR-OPR-05: on the database, a cancel prepared or dry-run leaves the draft as it was", async () => {
    const drafted = await draft(keyed(SUPERVISOR));
    const id = "data" in drafted.answer ? (drafted.answer.data as { id: string }).id : "";
    const cancel = { payment: `dsor://org_456/payment/${id}`, expected_version: 1 };
    const prepared = await call(
      registry,
      log,
      inMode(keyed(SUPERVISOR), "propose_only"),
      "payment.cancel",
      cancel,
    );
    expect(prepared).toMatchObject({ outcome: "READY", semantics: "atomic" });
    const dry = await call(
      registry,
      log,
      inMode(SUPERVISOR, "validate_only"),
      "payment.cancel",
      cancel,
    );
    expect(dry).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
    const rows = await rowsOf("SELECT status, version FROM app.payments WHERE id = $1", [id]);
    expect(rows).toStrictEqual([{ status: "draft", version: 1 }]);
  });

  it("DSOR-SRC-02b: on the database, a propose_only call that names another company's invoice is refused, and leaves no claim and no proposal", async () => {
    const envelope = inMode(keyed(SUPERVISOR), "propose_only");
    const answer = await call(registry, log, envelope, "payment.create", {
      invoice: "dsor://org_789/invoice/INV-2001",
      expected_version: 1,
    });
    expect(answer).toMatchObject({ code: "TENANT_MISMATCH" });
    for (const table of ["dsor.idempotency", "dsor.proposals"]) {
      const rows = await rowsOf(
        `SELECT count(*)::int AS n FROM ${table} WHERE idempotency_key = $1`,
        [envelope.idempotency_key],
      );
      expect(rows).toStrictEqual([{ n: 0 }]);
    }
  });

  it("Step 23: on the database, the agent's prepared proposal keeps the request as line ⑥ checked it, its fingerprint, the URIs it names, and who asked", async () => {
    const { answer } = await draft(inMode(keyed(AGENT), "propose_only"));
    const proposal = await proposals.get("org_456", proposalId(answer));
    expect(proposal?.payload).toStrictEqual(INV_9001);
    expect(proposal?.payload_hash).toBe(payloadHash(INV_9001));
    expect(proposal?.resources).toStrictEqual([INV_9001.invoice]);
    expect(proposal?.requester).toStrictEqual({
      identity_mode: "unattended",
      subject: "user_123",
      subject_type: "human",
      actor_chain: ["accounts-payable-fte"],
      active_tenant: "org_456",
      delegation: "del_100",
      subject_authority: { source: "role_source", as_of: expect.any(String) },
    });
  });
});
