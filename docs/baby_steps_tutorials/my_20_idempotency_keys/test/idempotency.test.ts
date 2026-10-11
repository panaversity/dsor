// NEW IN STEP 20: the idempotency key.
//
// Networks fail and clients retry. The caller names each logical request with a key; DSoR claims the
// key with one INSERT and keeps the request's fingerprint and its answer beside it. The same key and
// the same request get the same answer, and nothing runs twice (decision 131).
//
// Rule DSOR-TEN-02a: caches, idempotency records, counters, holds, proposals, events, and audit
// partitions MUST be keyed by tenant.
// Rule DSOR-IDM-01b: the key MUST be claimed by an atomic insert scoped to (tenant, calling
// principal, operation, key) that stores the payload hash.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aDatabase } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

/** What a statement as the application did, with org_456 said: "allowed", or PostgreSQL's refusal. */
async function asTheApplication(sql: string): Promise<string> {
  try {
    await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await tx.query(sql);
    });

    return "allowed";
  } catch (error) {
    return (error as Error).message;
  }
}

const A_CLAIM = `INSERT INTO dsor.idempotency_keys (tenant, principal, operation, key, payload_hash)
                 VALUES ('org_456', 'accounts-payable-fte', 'payment.create', 'k1', 'sha256:x')`;

describe("the claims, in DSoR's own store", () => {
  it("DSOR-TEN-02a: the claims are keyed by company, under the second lock, forced, and a statement with no company sees none", async () => {
    const { rows } = await db.query<{ on: boolean; forced: boolean }>(
      "SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'dsor.idempotency_keys'::regclass",
    );

    expect(rows[0]).toStrictEqual({ on: true, forced: true });
    expect(await asTheApplication(A_CLAIM)).toBe("allowed");
    expect((await db.query("SELECT key FROM dsor.idempotency_keys")).rows).toStrictEqual([]);
  });

  it("DSOR-IDM-01b: one company, one caller, one operation, one key: a second claim of it is refused by the database", async () => {
    const second = A_CLAIM.replace("'k1'", "'k2'");

    expect(await asTheApplication(second)).toBe("allowed");
    expect(await asTheApplication(second)).toMatch(/duplicate key value/);
  });

  it("DSOR-IDM-01b: the application claims a key and writes its answer, and nothing else", async () => {
    const mine = A_CLAIM.replace("'k1'", "'k3'");

    expect(await asTheApplication(mine)).toBe("allowed");
    expect(
      await asTheApplication(
        `UPDATE dsor.idempotency_keys SET answer = '{"kind": "result"}' WHERE key = 'k3'`,
      ),
    ).toBe("allowed");

    for (const sql of [
      "DELETE FROM dsor.idempotency_keys WHERE key = 'k3'",
      "UPDATE dsor.idempotency_keys SET payload_hash = 'sha256:y' WHERE key = 'k3'",
      "UPDATE dsor.idempotency_keys SET key = 'k4' WHERE key = 'k3'",
      `INSERT INTO dsor.idempotency_keys (tenant, principal, operation, key, payload_hash, answer)
       VALUES ('org_456', 'accounts-payable-fte', 'payment.create', 'k5', 'sha256:x', '{}')`,
    ]) {
      expect(await asTheApplication(sql), sql).toMatch(/permission denied/);
    }
  });
});
