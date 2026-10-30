// On the database: a bundle and its record are kept in one transaction, or neither is; DSoR's own
// login cannot change a bundle; and each company reads its own (DSOR-AUD-03a, DSOR-EXE-03b,
// DSOR-AUD-04a, DSOR-TEN-02a; step 33's README, claim C6, decisions D2 and D3). intake-fte drafts
// INV-9001, 31,400.00 USD to VENDOR-44, which waits for the CFO, in a world that reads
// dsor.controls; cfo_100 approves it, and intake-fte releases it. A real PostgreSQL, never a mock.
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bundleProblems } from "../src/bundle.ts";
import type { Answer } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  NO_PRIVILEGE,
  RUNTIME_URL,
  dbRegistry,
  newPool,
  ownerInvoices,
  ownerLimits,
  ownerRules,
  requestId,
  rowsFor,
  tryThenRollBack,
} from "./db.ts";
import { CFO, keyed, storyDirectories, withPlanted } from "./helpers.ts";

const pool = newPool();
const observer = newPool();
const log = createDbLog(pool);
const proposals = createDbProposals(pool);
const registry = dbRegistry(
  pool,
  storyDirectories(),
  handlersFor(),
  ownWorkFor(),
  readLifetimes(),
  "database",
);
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;
const INV_9001 = "dsor://org_456/invoice/INV-9001";
const DRAFT = { invoice: INV_9001, expected_version: 1 };
// The request id's place inside a bundle, in this tutorial's extensions.
const REQUEST_IN_BUNDLE = `bundle #>> '{extensions,org.panaversity.steps,correlation,request_id}'`;

beforeAll(() => {
  ownerRules("clear");
  ownerLimits("add");
});
beforeEach(() => {
  ownerInvoices("add", "31400.00", "USD");
  ownerLimits("reset");
  ownerInvoices("vendor", "VENDOR-44", "approved");
});
afterAll(async () => {
  ownerRules("clear");
  ownerLimits("remove");
  ownerInvoices("remove");
  await pool.end();
  await observer.end();
});

/** One call as intake-fte, the planted agent, through this log. */
function asIntake(
  envelope: RequestEnvelope,
  name: string,
  input: unknown,
  through = log,
): Promise<Answer> {
  return withPlanted("tok_intake", intake, () => call(registry, through, envelope, name, input));
}

/** The record of one request, and the bundle it names, read back through the log. */
async function filesOf(request_id: string) {
  const record = (await log.records("org_456")).find(
    (r) => r.correlation.request_id === request_id,
  );
  const bundle = (await log.bundles("org_456")).find(
    (b) => b.decision_id === record?.decision_bundle,
  );
  return { record, bundle };
}

/** How many bundles of org_456 carry this request id, read as dsor_runtime in org_456. */
async function bundlesFor(request_id: string): Promise<number> {
  const { rows } = await tryThenRollBack(
    observer,
    `SELECT count(*)::int AS n FROM dsor.decision_bundles WHERE ${REQUEST_IN_BUNDLE} = $1`,
    "org_456",
    [request_id],
  );
  return (rows[0] as { n: number }).n;
}

/**
 * A pool whose statements go to the database as written, except the one that starts so, swapped:
 * fault injection around the real client, as step 09's tests do. Each INSERT's first words are
 * noted in ran, and each swapped statement's row count in seen.
 */
function swapping(
  starts: string,
  swapped: string,
  seen: (number | null)[],
  ran: string[] = [],
): pg.Pool {
  const swappingPool = new pg.Pool({ connectionString: RUNTIME_URL, max: 1 });
  swappingPool.on("connect", (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
    client.query = ((...args: unknown[]) => {
      const [text, ...values] = args;
      const words = typeof text === "string" ? text.trimStart() : "";
      if (words.startsWith("INSERT")) ran.push(words.split("(")[0]!.trim());
      if (words.startsWith(starts)) {
        // A statement with no placeholders is sent with no values, so it fails for its own reason.
        const sent = swapped.includes("$1") ? query(swapped, ...values) : query(swapped);
        return sent.then((result) => {
          seen.push((result as pg.QueryResult).rowCount);
          return result;
        });
      }
      return query(...args);
    }) as typeof client.query;
  });
  return swappingPool;
}

describe("C6: on the database, a bundle and its record are kept together (step 33's README, D2)", () => {
  it("DSOR-AUD-03a: on the database, intake-fte's draft of INV-9001 leaves one record and one bundle, which the record names, which validates, sealed at the record's own time", async () => {
    const request_id = requestId("s33-draft");
    const answer = await asIntake({ ...keyed(INTAKE), request_id }, "payment.create", DRAFT);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const { record, bundle } = await filesOf(request_id);
    expect(record?.decision_bundle).toMatch(/^dec_/);
    expect(bundleProblems(bundle)).toStrictEqual([]);
    expect(bundle?.sealed_at).toBe(record?.at);
    expect(bundle).toMatchObject({
      operation: "payment.create@1",
      tenant: "org_456",
      identity: { mode: "unattended", actor_chain: ["intake-fte"] },
      authority: {
        controls: [{ id: "high-value-payment", version: 8, outcome: "REQUIRE_APPROVAL" }],
      },
      state: [
        { uri: INV_9001, version: 1, freshness: "CURRENT" },
        { uri: "dsor://org_456/vendor/VENDOR-44", freshness: "CURRENT" },
      ],
      execution: { result: "not_executed", semantics: "compensatable" },
    });
  });

  it("DSOR-AUD-03a: on the database, intake-fte's release names payment.create@1, cfo_100's approval in the rule's satisfied_by and in approval, and committed", async () => {
    const drafted = await asIntake(keyed(INTAKE), "payment.create", DRAFT);
    const uri = String("proposal" in drafted ? drafted.proposal : "");
    const id = uri.split("/").at(-1)!;
    const kept = (await proposals.get("org_456", id))!;
    const yes = await call(registry, log, keyed(CFO), "proposal.approve", {
      proposal: uri,
      payload_hash: kept.payload_hash,
    });
    expect(yes).toMatchObject({ outcome: "COMMITTED" });
    const [approval] = await proposals.approvals("org_456", id);
    const request_id = requestId("s33-release");
    const released = await asIntake({ ...keyed(INTAKE), request_id }, "proposal.execute", {
      proposal: uri,
    });
    expect(released).toMatchObject({ outcome: "COMMITTED" });
    const { bundle } = await filesOf(request_id);
    expect(bundle).toMatchObject({
      operation: "payment.create@1",
      proposal: uri,
      authority: { controls: [{ id: "high-value-payment", satisfied_by: [approval!.id] }] },
      approval: { id: approval!.id, payload_hash: kept.payload_hash, approvers: ["cfo_100"] },
      execution: { idempotency_key: id, result: "committed" },
    });
  });

  it("DSOR-EXE-03b: on the database, when the record cannot be written, its bundle is not kept either, and the caller hears EVIDENCE_STORE_UNAVAILABLE", async () => {
    const seen: (number | null)[] = [];
    const ran: string[] = [];
    // The record's INSERT fails on the real database, a division by zero, inside the transaction
    //   that has just written the bundle.
    const failing = swapping("INSERT INTO dsor.audit", "SELECT 1 / 0", seen, ran);
    try {
      const request_id = requestId("s33-no-record");
      const answer = await asIntake(
        { ...INTAKE, mode: "validate_only", request_id },
        "payment.create",
        DRAFT,
        createDbLog(failing),
      );
      expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
      expect(ran).toStrictEqual(["INSERT INTO dsor.decision_bundles", "INSERT INTO dsor.audit"]);
      expect(await rowsFor(observer, "org_456", request_id)).toStrictEqual([]);
      expect(await bundlesFor(request_id)).toBe(0);
    } finally {
      await failing.end();
    }
  });

  it("DSOR-EXE-03b: on the database, when the bundle's INSERT keeps no row, the record is not kept either", async () => {
    const seen: (number | null)[] = [];
    const keepsNothing = `INSERT INTO dsor.decision_bundles (decision_id, tenant_id, bundle)
      SELECT $1::text, $2::text, $3::jsonb WHERE false`;
    const swallowing = swapping("INSERT INTO dsor.decision_bundles", keepsNothing, seen);
    try {
      const request_id = requestId("s33-no-bundle");
      const answer = await asIntake(
        { ...INTAKE, mode: "validate_only", request_id },
        "payment.create",
        DRAFT,
        createDbLog(swallowing),
      );
      expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
      expect(seen).toStrictEqual([0]);
      expect(await rowsFor(observer, "org_456", request_id)).toStrictEqual([]);
    } finally {
      await swallowing.end();
    }
  });

  it("DSOR-AUD-03a: on the database, a record cannot name a bundle that is not kept: the key refuses it", async () => {
    await expect(
      tryThenRollBack(
        observer,
        `INSERT INTO dsor.audit (record_id, kind, "authorization", result, correlation, tenant, decision_bundle)
         VALUES ('aud_s33', 'decision', 'ALLOW', 'ok', '{"request_id":"r"}', 'org_456',
                 'dec_00000000-0000-4000-8000-000000000000')`,
        "org_456",
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it.each([
    [
      "names another decision_id than its column",
      `'{"decision_id":"dec_00000000-0000-4000-8000-000000000001","tenant":"org_456"}'`,
    ],
    [
      "names another company than its column",
      `'{"decision_id":"dec_00000000-0000-4000-8000-000000000000","tenant":"org_789"}'`,
    ],
    [
      "carries a time of its own",
      `'{"decision_id":"dec_00000000-0000-4000-8000-000000000000","tenant":"org_456","sealed_at":"2026-10-06T15:05:00Z"}'`,
    ],
  ])(
    "DSOR-AUD-03a: on the database, a bundle that %s is refused by the table's own check",
    async (_why, json) => {
      await expect(
        tryThenRollBack(
          observer,
          `INSERT INTO dsor.decision_bundles (decision_id, tenant_id, bundle)
         VALUES ('dec_00000000-0000-4000-8000-000000000000', 'org_456', ${json})`,
          "org_456",
        ),
      ).rejects.toMatchObject({ code: "23514" });
    },
  );
});

describe("C6: on the database, a bundle never changes, and each company reads its own (step 33's README, D3)", () => {
  it.each([
    ["UPDATE", "UPDATE dsor.decision_bundles SET bundle = '{}'"],
    ["DELETE", "DELETE FROM dsor.decision_bundles"],
    ["TRUNCATE", "TRUNCATE dsor.decision_bundles"],
  ])(
    "DSOR-AUD-04a: on the database, %s on dsor.decision_bundles fails with 42501",
    async (_what, sql) => {
      await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
    },
  );

  it("DSOR-TEN-02a: on the database, org_789's transaction reads none of org_456's bundles, and a bundle of org_789 cannot be written in org_456's", async () => {
    const request_id = requestId("s33-company");
    await asIntake({ ...INTAKE, mode: "validate_only", request_id }, "payment.create", DRAFT);
    expect(await bundlesFor(request_id)).toBe(1);
    const { rows } = await tryThenRollBack(
      observer,
      `SELECT count(*)::int AS n FROM dsor.decision_bundles WHERE ${REQUEST_IN_BUNDLE} = $1`,
      "org_789",
      [request_id],
    );
    expect(rows).toStrictEqual([{ n: 0 }]);
    await expect(
      tryThenRollBack(
        observer,
        `INSERT INTO dsor.decision_bundles (decision_id, tenant_id, bundle)
         VALUES ('dec_00000000-0000-4000-8000-000000000000', 'org_789',
                 '{"decision_id":"dec_00000000-0000-4000-8000-000000000000","tenant":"org_789"}')`,
        "org_456",
      ),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });
});
