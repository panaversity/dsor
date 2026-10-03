// NEW IN STEP 16: the inspector compares the database with the map (step 16's README, C2,
// C3, and C5). No database: each test plants one difference in today's catalog
// (test/catalogs.ts) and expects it named, and only it.
import { describe, expect, it } from "vitest";
import { storeDifferences, type Catalog } from "../src/inspector.ts";
import { checkStore, readStore } from "../src/store.ts";
import { columnIn, relationIn, relationOf, today } from "./catalogs.ts";

const { map } = checkStore(readStore());

/** Today's catalog with one change, compared with the shipped map. */
function differencesWith(change: (catalog: Catalog) => void): string[] {
  const catalog = today();
  change(catalog);
  return storeDifferences(map, catalog);
}

describe("today's database", () => {
  it("step 16's decision 7: today's catalog matches the shipped map", () => {
    expect(storeDifferences(map, today())).toStrictEqual([]);
  });
});

describe("C2: every schema and table is on the map, and everything on the map exists", () => {
  // The inspector starts from the database's own list, so what nobody wrote down is found.
  it("step 16's decision 5: a table the map does not name is named", () => {
    const found = differencesWith((c) => c.relations.push(relationOf("dsor.notes", "table")));
    expect(found).toStrictEqual(["dsor.notes is a table that store.json does not name"]);
  });

  it("step 16's decision 5: a table on the map that the database does not have is named", () => {
    const found = differencesWith((c) => {
      c.relations = c.relations.filter((r) => r.name !== "dsor.migrations");
    });
    expect(found).toStrictEqual([
      "store.json names dsor.migrations, which the database does not have",
    ]);
  });

  it("step 16's decision 5: a schema the map does not name is named", () => {
    const found = differencesWith((c) => c.schemas.push({ name: "crm", held: [] }));
    expect(found).toStrictEqual(["the schema crm is not in store.json"]);
  });

  it("step 16's decision 5: a schema on the map that the database does not have is named", () => {
    const found = differencesWith((c) => {
      c.schemas = c.schemas.filter((s) => s.name !== "public");
    });
    expect(found).toStrictEqual([
      "store.json names the schema public, which the database does not have",
    ]);
  });

  // Each one read org_789's record from inside org_456 on a local PostgreSQL, on 2026-10-03
  // (step 16's README, decision 5).
  it.each([
    ["dsor.audit_view", "view"],
    ["dsor.audit_copy", "materialized view"],
    ["dsor.bank_lines", "foreign table"],
    ["dsor.events", "partitioned table"],
  ] as const)(
    "step 16's decision 5: %s, a %s, is named, because no kind allows one",
    (name, kind) => {
      const found = differencesWith((c) => c.relations.push(relationOf(name, kind)));
      expect(found).toStrictEqual([`${name} is a ${kind}, and no kind in store.json allows one`]);
    },
  );

  // A view under a table's name in the map is still a view.
  it("step 16's decision 5: a view is named even when the map names it as a table", () => {
    const found = differencesWith((c) => (relationIn(c, "dsor.migrations").kind = "view"));
    expect(found).toStrictEqual([
      "dsor.migrations is a view, and no kind in store.json allows one",
    ]);
  });
});

describe("C3: dsor_runtime's privileges are exactly the map's", () => {
  // Break A2: step 15's start-up check asks only about dsor.audit, so this got past it.
  it("step 16's decision 3: UPDATE on app.invoices is named", () => {
    const found = differencesWith((c) => relationIn(c, "app.invoices").held.push("UPDATE"));
    expect(found).toStrictEqual([
      "app.invoices: dsor_runtime holds UPDATE, which store.json does not list",
    ]);
  });

  // Less is a difference too. The map says what the program needs, and the program would
  // fail later, at a caller's request, instead of now.
  it("step 16's decision 4: no SELECT on app.invoices is named", () => {
    const found = differencesWith((c) => {
      const invoices = relationIn(c, "app.invoices");
      invoices.held = [];
      for (const column of invoices.columns) column.held = [];
    });
    expect(found).toStrictEqual([
      "app.invoices: dsor_runtime lacks SELECT, which store.json lists",
    ]);
  });

  it.each(["UPDATE", "DELETE", "TRUNCATE"])("DSOR-AUD-04a: %s on the log is named", (privilege) => {
    const found = differencesWith((c) => relationIn(c, "dsor.audit").held.push(privilege));
    expect(found).toStrictEqual([
      `dsor.audit: dsor_runtime holds ${privilege}, which store.json does not list`,
    ]);
  });

  // Break A3. A grant on one column is not a grant on the table, so a list of table
  // privileges cannot see it (step 09's review).
  it("step 16's decision 1: INSERT on the log's column sequence is named", () => {
    const found = differencesWith((c) => {
      columnIn(relationIn(c, "dsor.audit"), "sequence").held.push("INSERT");
    });
    expect(found).toStrictEqual([
      "dsor.audit: dsor_runtime holds INSERT on the column sequence, which store.json does not list",
    ]);
  });

  it("DSOR-AUD-04a: UPDATE on one column of the log is named", () => {
    const found = differencesWith((c) => {
      columnIn(relationIn(c, "dsor.audit"), "result").held.push("UPDATE");
    });
    expect(found).toStrictEqual([
      "dsor.audit: dsor_runtime holds UPDATE on the column result, which store.json does not list",
    ]);
  });

  it("step 16's decision 4: a column the map lists and the database does not grant is named", () => {
    const found = differencesWith((c) => {
      columnIn(relationIn(c, "dsor.audit"), "connector").held = ["SELECT"];
    });
    expect(found).toStrictEqual([
      "dsor.audit: dsor_runtime lacks INSERT on the column connector, which store.json lists",
    ]);
  });

  // Found while writing the comparison: a column the map misspells would be compared with
  // no column at all, and never named.
  it("step 16's decision 4: a column the map lists and the table does not have is named", () => {
    const found = differencesWith((c) => {
      const audit = relationIn(c, "dsor.audit");
      audit.columns = audit.columns.filter((col) => col.name !== "connector");
    });
    expect(found).toStrictEqual([
      "store.json lists INSERT on the column connector of dsor.audit, which the table does not have",
    ]);
  });

  it("step 16's decision 3: CREATE on the schema dsor is named", () => {
    const found = differencesWith((c) => c.schemas[1]!.held.push("CREATE"));
    expect(found).toStrictEqual([
      "the schema dsor: dsor_runtime holds CREATE, which store.json does not list",
    ]);
  });

  it("step 16's decision 3: USAGE on the log's sequence is named", () => {
    const found = differencesWith((c) => c.sequences[0]!.held.push("USAGE"));
    expect(found).toStrictEqual([
      "dsor.audit_sequence_seq: dsor_runtime holds USAGE on a sequence, which no kind allows",
    ]);
  });

  it("step 16's decision 3: a privilege on a sequence the map never heard of is named", () => {
    const found = differencesWith((c) =>
      c.sequences.push({ name: "dsor.counter", held: ["UPDATE"] }),
    );
    expect(found).toStrictEqual([
      "dsor.counter: dsor_runtime holds UPDATE on a sequence, which no kind allows",
    ]);
  });

  // The inspector names the user it was asked about (step 16's README, decision 8).
  it("step 16's decision 8: each problem names the user the catalog describes", () => {
    const found = differencesWith((c) => {
      c.user = "neondb_owner";
      relationIn(c, "app.invoices").held.push("UPDATE");
    });
    expect(found).toStrictEqual([
      "app.invoices: neondb_owner holds UPDATE, which store.json does not list",
    ]);
  });
});

describe("C5: every table with a company key is locked by row-level security, enabled and forced", () => {
  it("DSOR-RP-01b: row-level security off on app.invoices is named", () => {
    const found = differencesWith((c) => {
      relationIn(c, "app.invoices").rowSecurity = { enabled: false, forced: false };
    });
    expect(found).toStrictEqual([
      "app.invoices has the company key tenant_id, and row-level security is not enabled",
    ]);
  });

  // Without FORCE, the table's owner skips every policy.
  it("DSOR-RP-01b: row-level security on but not forced on the log is named", () => {
    const found = differencesWith((c) => {
      relationIn(c, "dsor.audit").rowSecurity = { enabled: true, forced: false };
    });
    expect(found).toStrictEqual([
      "dsor.audit has the company key tenant, and row-level security is not forced",
    ]);
  });

  // A company column the map forgot to call a key would get no lock check at all.
  it("DSOR-RP-01b: a table with a tenant_id column and no key in the map is named", () => {
    const found = differencesWith((c) => {
      relationIn(c, "dsor.migrations").columns.push({ name: "tenant_id", held: [] });
    });
    expect(found).toStrictEqual([
      "dsor.migrations has a column tenant_id, and store.json names no company key for it",
    ]);
  });

  it("DSOR-RP-01b: a company key the table does not have is named", () => {
    const found = differencesWith((c) => {
      const invoices = relationIn(c, "app.invoices");
      invoices.columns = invoices.columns.filter((col) => col.name !== "tenant_id");
    });
    expect(found).toStrictEqual([
      "store.json names tenant_id as the company key of app.invoices, and the table has no such column",
    ]);
  });
});

describe("C6: every difference is named at once", () => {
  it("names every difference, not only the first", () => {
    const found = differencesWith((c) => {
      relationIn(c, "app.invoices").held.push("UPDATE");
      c.relations.push(relationOf("dsor.notes", "table"));
      c.sequences[0]!.held.push("USAGE");
    });
    expect(found).toHaveLength(3);
  });
});
