// NEW IN STEP 10: one audit chain per company.
//
// Step 08's chain was named after a constant and every record joined it. With two companies in one
// table that would mean org_456's hashes depend on org_789's records — and §14 says the audit
// partitions are keyed by tenant. So there is a chain per company, each with its own sequence, its
// own genesis, and its own head, and nothing in one ever links to the other.
//
// Rule DSOR-TEN-02a: caches, idempotency records, counters, holds, proposals, events, and audit
// partitions MUST be keyed by tenant. (This step claims it for the audit partition only.)
// Rule DSOR-EXE-02: the decision MUST be durably recorded before the response, denials included.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { forgetTheLog, theHead, theLog, verifyChain } from "../src/audit.ts";
import { callOperation } from "../src/operations.ts";
import { aDatabase } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT_FOR_456 = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const AGENT_FOR_789 = { loggedInAs: "accounts-payable-fte", tenant: "org_789" };
const AGENT_UNSAID = { loggedInAs: "accounts-payable-fte" };

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

beforeEach(async () => {
  await forgetTheLog("org_456");
  await forgetTheLog("org_789");
});

afterAll(async () => {
  await db.close();
});

describe("one chain per company", () => {
  it("DSOR-TEN-02a: each company's decisions form their own chain, from their own genesis", async () => {
    await callOperation(AGENT_FOR_456, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    await callOperation(AGENT_FOR_789, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    await callOperation(AGENT_FOR_789, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });

    const ours = await theLog("org_456");
    const theirs = await theLog("org_789");

    expect(ours).toHaveLength(1);
    expect(theirs).toHaveLength(2);
    expect(ours.map((r) => r.chain)).toEqual(["audit:org_456"]);
    expect(theirs.map((r) => r.chain)).toEqual(["audit:org_789", "audit:org_789"]);
    // Each starts at 0: the sequence is per chain, not per table.
    expect(ours.map((r) => r.sequence)).toEqual([0]);
    expect(theirs.map((r) => r.sequence)).toEqual([0, 1]);
    // And each verifies against its own head.
    expect(verifyChain(ours, await theHead("org_456"))).toBe(true);
    expect(verifyChain(theirs, await theHead("org_789"))).toBe(true);
  });

  it("DSOR-TEN-02a: a record never links to the other company's chain", async () => {
    await callOperation(AGENT_FOR_456, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    await callOperation(AGENT_FOR_789, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });

    const [ours] = await theLog("org_456");
    const [theirs] = await theLog("org_789");

    // org_789's first record points at the genesis hash, not at org_456's record, though org_456's
    // was written first and sits in the same table.
    expect(theirs?.previous_hash).toBe(`sha256:${"0".repeat(64)}`);
    expect(theirs?.previous_hash).not.toBe(ours?.record_hash);
  });

  it("DSOR-TEN-02a: the record says which company, in its tenant and its correlation", async () => {
    await callOperation(AGENT_FOR_789, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });

    const [record] = await theLog("org_789");

    expect(record?.tenant).toBe("org_789");
    expect(record?.correlation.tenant_id).toBe("org_789");
    expect(record?.identity.subject).toBe("accounts-payable-fte");
  });

  it("DSOR-TEN-02a: erasing one company's log leaves the other's", async () => {
    await callOperation(AGENT_FOR_456, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    await callOperation(AGENT_FOR_789, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });

    await forgetTheLog("org_456");

    expect(await theLog("org_456")).toHaveLength(0);
    expect(await theLog("org_789")).toHaveLength(1);
  });
});

describe("a refusal that belongs to no company", () => {
  it("DSOR-EXE-02: the agent that did not say which company is recorded in both employers' logs", async () => {
    const answer = await callOperation(AGENT_UNSAID, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });

    expect(answer.kind).toBe("error");

    for (const company of ["org_456", "org_789"]) {
      const log = await theLog(company);

      expect(log, company).toHaveLength(1);
      expect(log[0]?.authorization).toBe("DENY");
      expect(log[0]?.result).toBe("TENANT_MISMATCH");
      expect(log[0]?.identity.subject).toBe("accounts-payable-fte");
      expect(log[0]?.tenant).toBe(company);
    }
  });

  it("DSOR-EXE-02: user_123 naming org_789 is recorded in org_456's log, and nowhere else", async () => {
    const answer = await callOperation(
      { loggedInAs: "user_123", tenant: "org_789" },
      "invoice.get",
      {
        invoice: "dsor://org_789/invoice/INV-1008",
      },
    );

    expect(answer.kind).toBe("error");
    expect(await theLog("org_456")).toHaveLength(1);
    expect((await theLog("org_456"))[0]?.result).toBe("TENANT_MISMATCH");
    // Not in org_789's: a company's log never carries a stranger's attempt to reach it.
    expect(await theLog("org_789")).toHaveLength(0);
  });

  it("DSOR-SRC-02b: a mismatching address, once the request HAS a company, is recorded there", async () => {
    // Different from the two above: the request resolved to org_456, and only then was the address
    // for org_789 refused. One company, one record.
    await callOperation(SUPERVISOR, "invoice.get", { invoice: "dsor://org_789/invoice/INV-1008" });

    expect((await theLog("org_456"))[0]?.result).toBe("TENANT_MISMATCH");
    expect(await theLog("org_789")).toHaveLength(0);
  });
});

describe("no company is written into the audit log's code", () => {
  it("DSOR-TEN-02a: audit.ts names no company", () => {
    // Step 09's `audit:${TENANT}` is the kind of line that quietly puts every company in one chain.
    // Comments stripped first: the explanation of WHY there is a chain per company is allowed to
    // name two companies. The code is not.
    const code = readFileSync(fileURLToPath(new URL("../src/audit.ts", import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(code).not.toMatch(/org_\d+/);
    expect(code).not.toContain("TENANT");
  });
});
