// Masking is for agents only (step 14's README, C6 and decision 5). A
// guard, not a signal: these pass with or without this step's code. They prove the
// masking does not reach too far, because an approver must see what they approve.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import {
  CFO,
  INV_1008_OF_456,
  INV_1008_OF_789,
  SUPERVISOR,
  USER_700,
  log,
  registry,
} from "./helpers.ts";

/** The data of an answer, or the whole answer when it was refused. */
function dataOf(answer: Answer): unknown {
  return "data" in answer ? answer.data : answer;
}

describe("C6: a person gets every field", () => {
  it.each([
    ["cfo_100", CFO],
    ["user_123", SUPERVISOR],
  ])("%s gets INV-1008 with its amount and open_amount, as in step 13", async (_name, who) => {
    const answer = await call(registry, log, who, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(dataOf(answer)).toStrictEqual(INV_1008_OF_456);
  });

  it("user_700 gets org_789's INV-1008 with its amount and open_amount", async () => {
    const answer = await call(registry, log, USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(dataOf(answer)).toStrictEqual(INV_1008_OF_789);
  });

  it("cfo_100's page holds every field of every invoice", async () => {
    const page = dataOf(await call(registry, log, CFO, "invoice.list", {})) as {
      items: object[];
    };
    expect(page.items).toHaveLength(10);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toStrictEqual([
        "amount",
        "id",
        "open_amount",
        "status",
        "tenant_id",
        "vendor_id",
        "version",
      ]);
    }
  });
});
