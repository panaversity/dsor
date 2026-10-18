// Step 34 on the database: line ④ refuses a company's call while its connector is out of service,
// before line ⑦, so the refusal leaves no claim, and the same request with the same key runs once
// the connector is back (DSOR-CNR-01b; step 34's README, claim C4 and decision D3). The tests' own
// invoice, INV-9001, 500.00 USD of VENDOR-44, which the owner adds and removes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readConnectors, type ConnectorsSource } from "../src/connectors.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { dbRegistry, newPool, ownerInvoices, rowsFor, tryThenRollBack } from "./db.ts";
import { keyed, SUPERVISOR } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const INV_9001 = "dsor://org_456/invoice/INV-9001";

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  ownerInvoices("remove");
  await pool.end();
});

/** The shipped file, with org_456's records behind a connector of its own that cannot undo a job. */
function brokenFor456(): ConnectorsSource {
  const shipped = JSON.parse(readConnectors().text) as { connectors: Record<string, unknown>[] };
  const accounting = shipped.connectors[0]!;
  const capabilities = { ...(accounting["capabilities"] as object), transactions: false };
  const own = { ...accounting, id: "accounting-456", capabilities };
  const text = JSON.stringify({
    connectors: [accounting, own],
    companies: { "*": "accounting", org_456: "accounting-456" },
  });
  return { file: "connectors.json", text };
}

describe("C4: the breaker's refusal leaves nothing behind, on the database", () => {
  it("DSOR-CNR-01b: on the database, user_123's draft of INV-9001 is refused at line ④ while org_456's connector is out of service: dsor.audit says DENY, dsor.idempotency holds no claim, and the same request with the same key is drafted once the connector is back", async () => {
    const none = undefined;
    const broken = dbRegistry(pool, none, none, none, none, none, none, brokenFor456());
    const envelope: RequestEnvelope = { ...keyed(SUPERVISOR), mode: "execute" };
    const input = { invoice: INV_9001, expected_version: 1 };
    const refused = await call(broken, log, envelope, "payment.create", input);
    expect(refused).toMatchObject({ code: "CONNECTOR_UNAVAILABLE", retry: "safe_same_key" });
    const [record] = await rowsFor(pool, "org_456", refused.correlation.request_id);
    expect(record).toMatchObject({ authorization: "DENY", result: "CONNECTOR_UNAVAILABLE" });
    const claims = await tryThenRollBack(
      pool,
      "SELECT count(*)::int AS n FROM dsor.idempotency WHERE idempotency_key = $1",
      "org_456",
      [envelope.idempotency_key],
    );
    expect(claims.rows[0]).toStrictEqual({ n: 0 });
    // After the fix and a restart: the shipped file, and the same envelope, key and all.
    const answer = await call(dbRegistry(pool), log, envelope, "payment.create", input);
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
  });
});
