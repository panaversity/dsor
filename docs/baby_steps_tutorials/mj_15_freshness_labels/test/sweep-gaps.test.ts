// From step 14's review and mutation sweep: each test fails on a break that
// left every other test green (step 14's README, "Think it through").
import { describe, expect, it } from "vitest";
import { checkClassifications, readClassifications, type Kinds } from "../src/labels.ts";
import { createLog } from "../src/log.ts";
import { show } from "../src/masking.ts";
import { call } from "../src/pipeline.ts";
import { logins, type Principal } from "../src/principals.ts";
import {
  CFO,
  INV_1008_OF_456,
  OUR_EXTENSIONS,
  PLANTED,
  SUPERVISOR,
  labelsWith,
  omitted,
  registry,
  registryWith,
} from "./helpers.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** The shipped labels, read the way start-up reads them. */
function shippedKinds(): Kinds {
  return checkClassifications(readClassifications()).kinds;
}

describe("C2, from the review: the pipeline asks clearanceOf", () => {
  // Break Y6's cousin: the pipeline reading caller.clearance itself gave an agent with
  // none every field. Both agents in the table have one, so a planted agent is added to
  // DSoR's table for this test only, and taken out again.
  it("DSOR-CLS-02a: an agent with no clearance written down, sent through the real pipeline, gets every field withheld", async () => {
    const table = logins as Map<string, Principal>;
    const memberships = [{ tenant_id: "org_456", roles: ["ap_agent"] }];
    table.set("tok_intake", { id: "intake-fte", type: "agent", memberships });
    try {
      const answer = await call(
        registry,
        createLog(),
        { token: "tok_intake", tenant: "org_456" },
        "invoice.get",
        GET_1008,
      );
      expect(answer).toMatchObject({ data: {}, classification: "public" });
      const fields = ["amount", "id", "open_amount", "status", "tenant_id", "vendor_id"];
      expect((answer as { redactions?: unknown }).redactions).toStrictEqual(fields.map(omitted));
    } finally {
      table.delete("tok_intake");
    }
  });

  // Start-up lets no other label in. One that got in anyway must sit above them all.
  it("DSOR-CLS-02a: a label DSoR does not know is never shown, and makes the answer restricted", () => {
    const kinds: Kinds = new Map([["Invoice", new Map([["status", "secret"]])]]);
    const invoice = { tenant_id: "org_456", id: "INV-1008", status: "issued" };
    expect(show(invoice, "Invoice", kinds, "restricted").data).not.toHaveProperty("status");
    expect(show(invoice, "Invoice", kinds, undefined).classification).toBe("restricted");
  });
});

describe("C3, from the sweep: a path keeps every list it passes through", () => {
  it("DSOR-CLS-02b: a list inside a page's items keeps its whole path", () => {
    const text = JSON.stringify({
      Batch: { pages: "InvoicePage[]" },
      InvoicePage: { items: "Invoice[]" },
      Invoice: { tenant_id: "internal", id: "internal", amount: "confidential" },
    });
    const { kinds } = checkClassifications({ file: "classifications.json", text });
    const batch = {
      pages: [{ items: [{ tenant_id: "org_456", id: "INV-1008", amount: "31400.00" }] }],
    };
    expect(show(batch, "Batch", kinds, "internal").redactions).toStrictEqual([
      omitted("pages[].items[].amount"),
    ]);
  });
});

describe("C5, from the sweep: the record names exactly what left", () => {
  // The record of a read is set only once the answer is ready to leave.
  it("DSOR-CLS-05: an answer refused for its size names no rows in its record", async () => {
    const log = createLog();
    const large = { ...PLANTED, vendor_bank_account: "x".repeat(70 * 1024) };
    const answer = await call(
      registryWith(async () => large),
      log,
      SUPERVISOR,
      "test.run",
      GET_1008,
    );
    expect(answer).toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    const [record] = await log.records();
    expect(record).not.toHaveProperty("resources");
    expect(record).not.toHaveProperty("row_count");
  });

  // Each row's URI names its kind in lower case. Since the Stage 2 review, a kind must be in
  // the file to start at all, and a row is a kind that labels tenant_id and id (step 14's
  // README, decisions 1 and 7). So this kind is declared, and the answer's field with no
  // line still makes it confidential. Found by the Stage 2 review, and fixed from step 14 on.
  it("DSOR-CLS-05: an answer of another kind the file has is named in its record by that kind", async () => {
    const log = createLog();
    const payment = labelsWith({
      Payment: { tenant_id: "internal", id: "internal", status: "internal" },
    });
    const registry = registryWith(async () => ({ ...PLANTED }), "Payment", payment);
    await call(registry, log, SUPERVISOR, "test.run", GET_1008);
    expect(await log.records()).toMatchObject([
      {
        resources: ["dsor://org_456/payment/INV-1008"],
        row_count: 1,
        extensions: { [OUR_EXTENSIONS]: { classification: "confidential" } },
      },
    ]);
  });

  it("DSOR-CLS-05: a page that holds one invoice twice counts two rows", async () => {
    const log = createLog();
    const twice = { items: [INV_1008_OF_456, INV_1008_OF_456] };
    await call(
      registryWith(async () => twice, "InvoicePage"),
      log,
      CFO,
      "test.run",
      GET_1008,
    );
    const uri = "dsor://org_456/invoice/INV-1008";
    expect(await log.records()).toMatchObject([{ resources: [uri, uri], row_count: 2 }]);
  });

  // The shipped kinds again, so a planted kind cannot hide a broken lookup.
  it("DSOR-CLS-05: a person's page of the shipped kind is named row by row", () => {
    const { resources } = show(
      { items: [INV_1008_OF_456] },
      "InvoicePage",
      shippedKinds(),
      undefined,
    );
    expect(resources).toStrictEqual(["dsor://org_456/invoice/INV-1008"]);
  });
});
