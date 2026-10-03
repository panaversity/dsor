// The map itself is checked at start-up, before the database is (step 16's
// README, C4 and C7). No database: these read store.json, and copies of it with one change.
import { describe, expect, it } from "vitest";
import { checkStore, readStore, type StoreSource } from "../src/store.ts";

const SHIPPED: StoreSource = readStore();

/** The shipped map with one change, as the file a test starts the program with. */
function mapWith(change: (map: any) => void): StoreSource {
  const map = JSON.parse(SHIPPED.text);
  change(map);
  return { file: "store.json", text: JSON.stringify(map, null, 2) };
}

function problemsOf(source: StoreSource): string[] {
  return checkStore(source).problems;
}

describe("the shipped map", () => {
  it("step 16's decision 1: store.json passes its own checks", () => {
    expect(problemsOf(SHIPPED)).toStrictEqual([]);
  });

  it("step 16's decision 1: it names three schemas and three tables", () => {
    const { map } = checkStore(SHIPPED);
    expect([...map.schemas.keys()]).toStrictEqual(["app", "dsor", "public"]);
    expect([...map.tables.keys()]).toStrictEqual(["app.invoices", "dsor.audit", "dsor.migrations"]);
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
      'store.json: dsor.migrations has the kind "ledger", which is not business, append-only, or bookkeeping',
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

// NEW IN STEP 17: a fourth kind, for a company table that DSoR writes (step 17's README,
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
          INSERT: ["tenant_id", "invoice_id", "vendor_id", "amount_value", "amount_currency", "status"],
          UPDATE: ["status"],
        },
      },
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
