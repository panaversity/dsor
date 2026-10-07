// The map itself is checked at start-up, before the database is (step 16's
// README, C4 and C7). No database: these read store.json, and copies of it with one change.
import { describe, expect, it } from "vitest";
import { checkStore, readStore, type StoreSource } from "../src/store.ts";
import { INVOICE_TRIGGER, PAYMENT_TRIGGER } from "./catalogs.ts";

const SHIPPED: StoreSource = readStore();

/** The shipped map with one change, as the file a test starts the program with. */
function mapWith(change: (map: any) => void): StoreSource {
  const map = JSON.parse(SHIPPED.text);
  change(map);
  return { file: "store.json", text: JSON.stringify(map, null, 2) };
}

// The slips' line as step 18 shipped it, control-read and never written, for
// the tests of that kind (step 19b's README, decision 3).
/** Turns the map's dsor.delegations back into a control-read table. */
function asControlRead(map: any): void {
  map.tables["dsor.delegations"].kind = "control-read";
  map.tables["dsor.delegations"].runtime = { table: ["SELECT"] };
}

function problemsOf(source: StoreSource): string[] {
  return checkStore(source).problems;
}

describe("the shipped map", () => {
  it("step 16's decision 1: store.json passes its own checks", () => {
    expect(problemsOf(SHIPPED)).toStrictEqual([]);
  });

  // Step 17 adds app.payments (step 17's README, outcome 1).
  // Step 18 adds a fifth table, the slips (step 18's README, decision 3).
  // And a sixth, the claims of idempotency keys (step 20's README, decision 12).
  it("step 16's decision 1: it names three schemas and six tables", () => {
    const { map } = checkStore(SHIPPED);
    expect([...map.schemas.keys()]).toStrictEqual(["app", "dsor", "public"]);
    expect([...map.tables.keys()]).toStrictEqual([
      "app.invoices",
      "app.payments",
      "dsor.audit",
      "dsor.delegations",
      "dsor.idempotency",
      "dsor.migrations",
    ]);
  });

  // The claims are read inside their company, added through named columns, and
  // finished through the answer alone (step 20's README, decision 12).
  it("step 20's decision 12: dsor.idempotency is read inside its company, added through named columns, and finished through its answer", () => {
    const { map } = checkStore(SHIPPED);
    expect(map.tables.get("dsor.idempotency")).toStrictEqual({
      kind: "control-claimed",
      tenant: "tenant_id",
      runtime: {
        table: ["SELECT"],
        columns: {
          INSERT: [
            "tenant_id",
            "principal",
            "operation",
            "idempotency_key",
            "payload_hash",
            "request_id",
          ],
          UPDATE: ["answer"],
        },
      },
      triggers: [],
    });
  });
});

// NEW IN STEP 21: a table's line may name triggers, in full, where its kind allows one (step
// 21's README, decision 11).
describe("C11: the map names each trigger", () => {
  it("step 21's decision 11: app.invoices and app.payments have the triggers that raise a row's version", () => {
    const { map } = checkStore(SHIPPED);
    expect(map.tables.get("app.invoices")!.triggers).toStrictEqual([INVOICE_TRIGGER]);
    expect(map.tables.get("app.payments")!.triggers).toStrictEqual([PAYMENT_TRIGGER]);
  });

  it.each([
    ["dsor.audit", "an append-only"],
    ["dsor.delegations", "a control-written"],
    ["dsor.idempotency", "a control-claimed"],
    ["dsor.migrations", "a bookkeeping"],
  ])("step 21's decision 11: %s, DSoR's own, may have no trigger", (table, kind) => {
    const source = mapWith((m) => {
      m.tables[table].triggers = [
        "CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW EXECUTE FUNCTION f()",
      ];
    });
    expect(problemsOf(source)).toStrictEqual([
      `store.json: ${table} names a trigger, which ${kind} table does not allow`,
    ]);
  });

  it("step 21's decision 11: triggers must be a list of text", () => {
    const source = mapWith((m) => {
      m.tables["app.invoices"].triggers = "invoices_version";
    });
    expect(problemsOf(source)[0]).toMatch(
      /^store\.json: app\.invoices is not written as a table line/,
    );
  });
});

describe("C4: each kind allows only its own privileges, on its own side", () => {
  it("step 16's decision 3: a business table may only be read, so UPDATE on app.invoices is refused", () => {
    const source = mapWith((m) => m.tables["app.invoices"].runtime.table.push("UPDATE"));
    expect(problemsOf(source)).toStrictEqual([
      "store.json: app.invoices lists UPDATE, which a business table does not allow",
    ]);
  });

  it("step 16's decision 3: a business table may not be written column by column either", () => {
    const source = mapWith(
      (m) => (m.tables["app.invoices"].runtime.columns = { UPDATE: ["status"] }),
    );
    expect(problemsOf(source)).toStrictEqual([
      "store.json: app.invoices lists UPDATE on columns, which a business table does not allow",
    ]);
  });

  // The log's own rule, written into its kind: one wrong line in the map cannot open it.
  it.each(["UPDATE", "DELETE", "TRUNCATE"])(
    "DSOR-AUD-04a: %s on the log is refused, because an append-only table allows it never",
    (privilege) => {
      const source = mapWith((m) => m.tables["dsor.audit"].runtime.table.push(privilege));
      expect(problemsOf(source)).toStrictEqual([
        `store.json: dsor.audit lists ${privilege}, which an append-only table does not allow`,
      ]);
    },
  );

  it("DSOR-AUD-04a: UPDATE on one column of the log is refused too", () => {
    const source = mapWith((m) => (m.tables["dsor.audit"].runtime.columns.UPDATE = ["result"]));
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.audit lists UPDATE on columns, which an append-only table does not allow",
    ]);
  });

  // INSERT on the whole table would include sequence and at, which the database fills in
  // (step 09's README, decision 6). So append-only adds rows column by column only.
  it("step 16's decision 3: an append-only table adds rows column by column, never by the whole table", () => {
    const source = mapWith((m) => m.tables["dsor.audit"].runtime.table.push("INSERT"));
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.audit lists INSERT, which an append-only table does not allow",
    ]);
  });

  it("step 16's decision 3: a bookkeeping table may not be touched, not even read", () => {
    const source = mapWith((m) => m.tables["dsor.migrations"].runtime.table.push("SELECT"));
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.migrations lists SELECT, which a bookkeeping table does not allow",
    ]);
  });

  it("step 16's decision 3: DSoR's paperwork cannot be put in the company's schema", () => {
    const source = mapWith(
      (m) =>
        (m.tables["app.notes"] = { kind: "append-only", tenant: null, runtime: { table: [] } }),
    );
    expect(problemsOf(source)).toStrictEqual([
      "store.json: app.notes is append-only, which lives on DSoR's side, and the schema app is the company's",
    ]);
  });

  it("step 16's decision 3: the company's data cannot be put in DSoR's schema", () => {
    const source = mapWith(
      (m) =>
        (m.tables["dsor.invoices"] = { kind: "business", tenant: null, runtime: { table: [] } }),
    );
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.invoices is business, which lives on the company's side, and the schema dsor is DSoR's",
    ]);
  });

  it("step 16's decision 3: no kind lives in public, which is nobody's", () => {
    const source = mapWith(
      (m) =>
        (m.tables["public.notes"] = { kind: "bookkeeping", tenant: null, runtime: { table: [] } }),
    );
    expect(problemsOf(source)).toStrictEqual([
      "store.json: public.notes is bookkeeping, which lives on DSoR's side, and the schema public is nobody's",
    ]);
  });

  // CREATE in a schema lets dsor_runtime make a table of its own, and own it (step 09's
  // README, decision 5).
  it("step 16's decision 3: a schema allows USAGE and never CREATE", () => {
    const source = mapWith((m) => m.schemas.dsor.runtime.push("CREATE"));
    expect(problemsOf(source)).toStrictEqual([
      "store.json: the schema dsor lists CREATE, and a schema allows only USAGE",
    ]);
  });
});

// Found by the review: a company column named org_id would get no lock check, because only
// tenant_id and tenant are recognised. A kind whose rows belong to a company must say which
// column says so.
describe("C4: a business or append-only table names its company key", () => {
  it.each([
    ["app.invoices", "business"],
    ["dsor.audit", "append-only"],
  ])("DSOR-RP-01b: %s (%s) with no company key is refused", (name, kind) => {
    const source = mapWith((m) => (m.tables[name].tenant = null));
    expect(problemsOf(source)).toStrictEqual([
      `store.json: ${name} is ${kind}, which needs a company key, and names none`,
    ]);
  });

  // Found by the sweep: the bookkeeping kind's column list was never pinned.
  it("step 16's decision 3: a bookkeeping table may not be written column by column", () => {
    const source = mapWith(
      (m) => (m.tables["dsor.migrations"].runtime.columns = { INSERT: ["name"] }),
    );
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.migrations lists INSERT on columns, which a bookkeeping table does not allow",
    ]);
  });
});

describe("C7: the map itself is checked", () => {
  // Found by the sweep: with the check that the column lists are lists gone, the map passed,
  // and the inspector would have thrown later, with a stack trace instead of a problem.
  it("step 16's decision 1: a column list that is not a list is refused", () => {
    const source = mapWith((m) => (m.tables["dsor.audit"].runtime.columns.INSERT = "record_id"));
    expect(problemsOf(source)).toStrictEqual([
      'store.json: dsor.audit is not written as a table line: {"kind", "tenant", "runtime": {"table": [...], "columns": {...}}}',
    ]);
  });

  // Found by the sweep: no test pinned "exactly these fields", so a field nobody reads
  // passed. Each line says all it means, or it is refused.
  it("step 16's decision 1: a field the map does not know is refused, at each level", () => {
    const top = mapWith((m) => (m.owner = "neondb_owner"));
    const schema = mapWith((m) => (m.schemas.app.owner = "neondb_owner"));
    const table = mapWith((m) => (m.tables["app.invoices"].runtime.delete = ["*"]));
    expect(problemsOf(top)).toStrictEqual([
      'store.json: must be {"schemas": {...}, "tables": {...}}',
    ]);
    expect(problemsOf(schema)).toStrictEqual([
      'store.json: the schema app is not written as a schema line: {"side", "runtime": [...]}',
    ]);
    expect(problemsOf(table)).toStrictEqual([
      'store.json: app.invoices is not written as a table line: {"kind", "tenant", "runtime": {"table": [...], "columns": {...}}}',
    ]);
  });

  it("step 16's decision 1: a kind the map does not know is refused", () => {
    const source = mapWith((m) => (m.tables["dsor.migrations"].kind = "ledger"));
    expect(problemsOf(source)).toStrictEqual([
      // Step 17's business-written is a fourth kind, step 18's control-read a fifth, and step
      // 19b's control-written a sixth.
      'store.json: dsor.migrations has the kind "ledger", which is not business, business-written, append-only, control-read, control-written, control-claimed, or bookkeeping',
    ]);
  });

  it("step 16's decision 1: a side the map does not know is refused", () => {
    const source = mapWith((m) => (m.schemas.app.side = "partner"));
    expect(problemsOf(source)).toStrictEqual([
      'store.json: the schema app has the side "partner", which is not company, dsor, or none',
    ]);
  });

  // JSON.parse keeps the second line and drops the first, without a word (src/json.ts).
  it("step 16's decision 1: a table written twice is refused", () => {
    const twice = SHIPPED.text.replace(
      '"dsor.migrations": {',
      '"app.invoices": { "kind": "business", "tenant": "tenant_id", "runtime": { "table": ["SELECT", "UPDATE"] } },\n    "dsor.migrations": {',
    );
    expect(problemsOf({ file: "store.json", text: twice })).toContain(
      'store.json: "app.invoices" is written twice in one object',
    );
  });

  it("step 16's decision 1: a table in a schema the map does not name is refused", () => {
    const source = mapWith(
      (m) => (m.tables["crm.leads"] = { kind: "business", tenant: null, runtime: { table: [] } }),
    );
    expect(problemsOf(source)).toStrictEqual([
      "store.json: crm.leads is in the schema crm, which the map does not name",
    ]);
  });

  // A misspelled "tenant" must not quietly mean "this table has no company key".
  it("step 16's decision 1: a table line with a missing or misspelled field is refused", () => {
    const source = mapWith((m) => {
      const line = m.tables["app.invoices"];
      line.tenent = line.tenant;
      delete line.tenant;
    });
    expect(problemsOf(source)).toStrictEqual([
      'store.json: app.invoices is not written as a table line: {"kind", "tenant", "runtime": {"table": [...], "columns": {...}}}',
    ]);
  });

  it("step 16's decision 1: a schema line with a missing field is refused", () => {
    const source = mapWith((m) => delete m.schemas.app.runtime);
    expect(problemsOf(source)).toStrictEqual([
      'store.json: the schema app is not written as a schema line: {"side", "runtime": [...]}',
    ]);
  });

  it("step 16's decision 1: a table named without its schema is refused", () => {
    const source = mapWith(
      (m) => (m.tables.invoices = { kind: "business", tenant: null, runtime: { table: [] } }),
    );
    expect(problemsOf(source)).toStrictEqual(['store.json: "invoices" must be named schema.table']);
  });

  it("step 16's decision 1: a file that is not JSON is refused", () => {
    expect(problemsOf({ file: "store.json", text: "{ schemas:" })).toStrictEqual([
      "store.json: not valid JSON",
    ]);
  });

  it("step 16's decision 1: a file without schemas and tables is refused", () => {
    expect(problemsOf({ file: "store.json", text: "[]" })).toStrictEqual([
      'store.json: must be {"schemas": {...}, "tables": {...}}',
    ]);
  });

  it("names every problem at once, not only the first", () => {
    const source = mapWith((m) => {
      m.schemas.dsor.runtime.push("CREATE");
      m.tables["app.invoices"].runtime.table.push("UPDATE");
    });
    expect(problemsOf(source)).toHaveLength(2);
  });
});

// A fourth kind, for a company table that DSoR writes (step 17's README,
// C7 and decision 3).
describe("step 17's C7: the kind business-written", () => {
  it("step 17's decision 3: app.payments is read, gets rows by named columns, and changes only its status", () => {
    const { map } = checkStore(SHIPPED);
    expect(map.tables.get("app.payments")).toStrictEqual({
      kind: "business-written",
      tenant: "tenant_id",
      runtime: {
        table: ["SELECT"],
        columns: {
          INSERT: [
            "tenant_id",
            "invoice_id",
            "vendor_id",
            "amount_value",
            "amount_currency",
            "status",
          ],
          UPDATE: ["status"],
        },
      },
      triggers: [PAYMENT_TRIGGER],
    });
  });

  // Whole-table INSERT would include number and id, which the database writes.
  it.each(["INSERT", "UPDATE", "DELETE", "TRUNCATE"])(
    "step 17's decision 3: %s on the whole of a business-written table is refused",
    (privilege) => {
      const source = mapWith((m) => m.tables["app.payments"].runtime.table.push(privilege));
      expect(problemsOf(source)).toStrictEqual([
        `store.json: app.payments lists ${privilege}, which a business-written table does not allow`,
      ]);
    },
  );

  it("step 17's decision 3: a business-written table may not list REFERENCES on columns", () => {
    const source = mapWith(
      (m) => (m.tables["app.payments"].runtime.columns.REFERENCES = ["invoice_id"]),
    );
    expect(problemsOf(source)).toStrictEqual([
      "store.json: app.payments lists REFERENCES on columns, which a business-written table does not allow",
    ]);
  });

  it("step 17's decision 3: a business-written table lives on the company's side", () => {
    const source = mapWith((m) => {
      m.tables["dsor.payments"] = m.tables["app.payments"];
      delete m.tables["app.payments"];
    });
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.payments is business-written, which lives on the company's side, and the schema dsor is DSoR's",
    ]);
  });

  it("DSOR-RP-01b: a business-written table needs a company key", () => {
    const source = mapWith((m) => (m.tables["app.payments"].tenant = null));
    expect(problemsOf(source)).toStrictEqual([
      "store.json: app.payments is business-written, which needs a company key, and names none",
    ]);
  });
});

// The kind control-read, for DSoR's own records that it reads and never
// writes, such as the permission slips (step 18's README, decision 3). Found by step 18's
// sweep: the kind, and the slips' line, could change with every test green.
describe("step 18's decision 3: the kind control-read", () => {
  // dsor.delegations is control-written now, so these tests plant a
  // control-read table of their own, as step 18 shipped it (step 19b's README, decision 3).
  it("step 19b's decision 3: dsor.delegations is read inside its company, and changed through its status only", () => {
    const { map } = checkStore(SHIPPED);
    expect(map.tables.get("dsor.delegations")).toStrictEqual({
      kind: "control-written",
      tenant: "tenant_id",
      runtime: { table: ["SELECT"], columns: { UPDATE: ["status"] } },
      triggers: [],
    });
  });

  it.each(["INSERT", "UPDATE", "DELETE", "TRUNCATE"])(
    "step 18's decision 3: %s on the whole of a control-read table is refused",
    (privilege) => {
      const source = mapWith((m) => {
        asControlRead(m);
        m.tables["dsor.delegations"].runtime.table.push(privilege);
      });
      expect(problemsOf(source)).toStrictEqual([
        `store.json: dsor.delegations lists ${privilege}, which a control-read table does not allow`,
      ]);
    },
  );

  it("step 18's decision 3: a control-read table is not written column by column either", () => {
    const source = mapWith((m) => {
      asControlRead(m);
      m.tables["dsor.delegations"].runtime.columns = { INSERT: ["status"] };
    });
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.delegations lists INSERT on columns, which a control-read table does not allow",
    ]);
  });

  it("DSOR-RP-01b: a control-read table needs a company key", () => {
    const source = mapWith((m) => {
      asControlRead(m);
      m.tables["dsor.delegations"].tenant = null;
    });
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.delegations is control-read, which needs a company key, and names none",
    ]);
  });
});

// The kind control-written, for DSoR's own records that it reads, and changes
// through named columns only, such as a slip's status (step 19b's README, decision 3). Found by
// step 19b's sweep: the kind could allow INSERT under columns, or UPDATE on the whole table, with
// every test green.
describe("step 19b's decision 3: the kind control-written", () => {
  it.each(["INSERT", "UPDATE", "DELETE", "TRUNCATE"])(
    "step 19b's decision 3: %s on the whole of a control-written table is refused",
    (privilege) => {
      const source = mapWith((m) => m.tables["dsor.delegations"].runtime.table.push(privilege));
      expect(problemsOf(source)).toStrictEqual([
        `store.json: dsor.delegations lists ${privilege}, which a control-written table does not allow`,
      ]);
    },
  );

  it.each(["INSERT", "DELETE", "REFERENCES"])(
    "step 19b's decision 3: %s under a control-written table's columns is refused",
    (privilege) => {
      const source = mapWith(
        (m) => (m.tables["dsor.delegations"].runtime.columns[privilege] = ["status"]),
      );
      expect(problemsOf(source)).toStrictEqual([
        `store.json: dsor.delegations lists ${privilege} on columns, which a control-written table does not allow`,
      ]);
    },
  );

  it("step 19b's decision 3: a control-written table lives on DSoR's side", () => {
    const source = mapWith((m) => {
      m.tables["app.delegations"] = m.tables["dsor.delegations"];
      delete m.tables["dsor.delegations"];
    });
    expect(problemsOf(source)).toStrictEqual([
      "store.json: app.delegations is control-written, which lives on DSoR's side, and the schema app is the company's",
    ]);
  });

  it("DSOR-RP-01b: a control-written table needs a company key", () => {
    const source = mapWith((m) => (m.tables["dsor.delegations"].tenant = null));
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.delegations is control-written, which needs a company key, and names none",
    ]);
  });
});

// The kind control-claimed, for DSoR's own claims, which it reads, adds through
// named columns, and finishes once through a named column (step 20's README, decision 12). Each
// refusal is tested, as step 19b's sweep showed a kind needs.
describe("step 20's decision 12: the kind control-claimed", () => {
  it.each(["INSERT", "UPDATE", "DELETE", "TRUNCATE"])(
    "step 20's decision 12: %s on the whole of a control-claimed table is refused",
    (privilege) => {
      const source = mapWith((m) => m.tables["dsor.idempotency"].runtime.table.push(privilege));
      expect(problemsOf(source)).toStrictEqual([
        `store.json: dsor.idempotency lists ${privilege}, which a control-claimed table does not allow`,
      ]);
    },
  );

  it.each(["DELETE", "REFERENCES"])(
    "step 20's decision 12: %s under a control-claimed table's columns is refused",
    (privilege) => {
      const source = mapWith(
        (m) => (m.tables["dsor.idempotency"].runtime.columns[privilege] = ["answer"]),
      );
      expect(problemsOf(source)).toStrictEqual([
        `store.json: dsor.idempotency lists ${privilege} on columns, which a control-claimed table does not allow`,
      ]);
    },
  );

  it("step 20's decision 12: a control-claimed table lives on DSoR's side", () => {
    const source = mapWith((m) => {
      m.tables["app.idempotency"] = m.tables["dsor.idempotency"];
      delete m.tables["dsor.idempotency"];
    });
    expect(problemsOf(source)).toStrictEqual([
      "store.json: app.idempotency is control-claimed, which lives on DSoR's side, and the schema app is the company's",
    ]);
  });

  it("DSOR-RP-01b: a control-claimed table needs a company key", () => {
    const source = mapWith((m) => (m.tables["dsor.idempotency"].tenant = null));
    expect(problemsOf(source)).toStrictEqual([
      "store.json: dsor.idempotency is control-claimed, which needs a company key, and names none",
    ]);
  });
});

// Found by the review's sweep. DELETE is never a column privilege, so a kind
// that let it in under columns would pass every other test.
describe("the review: business-written lists only INSERT and UPDATE under columns", () => {
  it("step 17's decision 3: DELETE under a business-written table's columns is refused", () => {
    const source = mapWith((m) => (m.tables["app.payments"].runtime.columns.DELETE = ["status"]));
    expect(problemsOf(source)).toStrictEqual([
      "store.json: app.payments lists DELETE on columns, which a business-written table does not allow",
    ]);
  });
});
