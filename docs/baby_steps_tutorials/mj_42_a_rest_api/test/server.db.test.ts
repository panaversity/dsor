// Step 42: the door over the database. Each request is answered by call() over PostgreSQL, and its
// decision lands in dsor.audit, a refusal too, with the request id the answer carries (step 42's
// README, claims C1 and C5).
import { afterAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { createDbLog } from "../src/postgres.ts";
import { createDoor, listen } from "../src/server.ts";
import { dbRegistry, newPool, ownerRowsFor, rowsFor } from "./db.ts";

const pool = newPool();
const server = createDoor(dbRegistry(pool), createDbLog(pool));
const port = await listen(server, "127.0.0.1", 0);
afterAll(async () => {
  await new Promise((done) => server.close(done));
  await pool.end();
});

async function get(path: string, headers: Record<string, string>) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return { status: response.status, answer: (await response.json()) as Answer };
}

const requestOf = (answer: Answer): string => answer.correlation.request_id;

describe("C1 and C5: the door over PostgreSQL", () => {
  it("DSOR-OPR-04a: cfo_100 reads INV-1008 through the door, and dsor.audit keeps the decision", async () => {
    const { status, answer } = await get("/invoices/INV-1008", {
      authorization: "Bearer tok_d4e8",
      "dsor-tenant": "org_456",
    });
    expect([status, answer]).toMatchObject([200, { data: { id: "INV-1008" } }]);
    const rows = await rowsFor(pool, "org_456", requestOf(answer));
    expect(rows.map((r) => [r["operation"], r["authorization"], r["result"]])).toStrictEqual([
      ["invoice.get@1", "ALLOW", "ok"],
    ]);
  });

  it("Step 42, A2: a request with no login, on no route, is 401 and is in dsor.audit", async () => {
    const { status, answer } = await get("/admin/export", { "dsor-tenant": "org_456" });
    expect([status, answer]).toMatchObject([401, { code: "AUTHENTICATION_REQUIRED" }]);
    // A refusal before line ② names no company, so dsor_runtime, which sees one company at a time,
    //   cannot read it; the owner can (step 11's README).
    const rows = ownerRowsFor(requestOf(answer));
    expect(rows.map((r) => [r["authorization"], r["result"]])).toStrictEqual([
      ["DENY", "AUTHENTICATION_REQUIRED"],
    ]);
  });
});
