// Planted catalogs. Not a test file.
// A planted catalog is what the inspector reads from PostgreSQL, written by the test
// itself, so a unit test can plant one difference and needs no database (step 16's README,
// "The success signals"). store.db.test.ts checks that today() is the real database's.
import type { Catalog, Relation } from "../src/catalog.ts";

// The columns in the order PostgreSQL numbers them. tenant_id came last, in migration 002.
const INVOICE_COLUMNS = [
  "id",
  "vendor_id",
  "amount_value",
  "amount_currency",
  "open_amount_value",
  "open_amount_currency",
  "status",
  "tenant_id",
];
// The log's columns. dsor_runtime may INSERT every one but sequence and at, which the
// database fills in (step 09's README, decision 6).
const AUDIT_COLUMNS = [
  "sequence",
  "record_id",
  "at",
  "kind",
  "operation",
  "authorization",
  "result",
  "reason",
  "correlation",
  "tenant",
  "extensions",
  "resources",
  "row_count",
  "connector",
];
const FILLED_BY_THE_DATABASE = ["sequence", "at"];

/** The catalog as steps 09 to 15 left it, seen by dsor_runtime. A fresh copy each call. */
export function today(): Catalog {
  return {
    user: "dsor_runtime",
    schemas: [
      { name: "app", held: ["USAGE"] },
      { name: "dsor", held: ["USAGE"] },
      { name: "public", held: ["USAGE"] },
    ],
    relations: [
      {
        name: "app.invoices",
        kind: "table",
        held: ["SELECT"],
        columns: INVOICE_COLUMNS.map((name) => ({ name, held: ["SELECT"], filled: false })),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [],
      },
      {
        name: "dsor.audit",
        kind: "table",
        held: ["SELECT"],
        columns: AUDIT_COLUMNS.map((name) => {
          const filled = FILLED_BY_THE_DATABASE.includes(name);
          return { name, held: filled ? ["SELECT"] : ["SELECT", "INSERT"], filled };
        }),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [],
      },
      {
        name: "dsor.migrations",
        kind: "table",
        held: [],
        // at has a default, now(), so the database fills it in.
        columns: [
          { name: "name", held: [], filled: false },
          { name: "at", held: [], filled: true },
        ],
        rowSecurity: { enabled: false, forced: false },
        rules: [],
        triggers: [],
      },
    ],
    sequences: [{ name: "dsor.audit_sequence_seq", held: [] }],
    database: [],
    definers: [],
  };
}

/** The relation of this name in the catalog, to change in a test. */
export function relationIn(catalog: Catalog, name: string): Relation {
  const found = catalog.relations.find((r) => r.name === name);
  if (found === undefined) throw new Error(`the catalog has no ${name}`);
  return found;
}

/** The column of this name in the relation, to change in a test. */
export function columnIn(relation: Relation, name: string): Relation["columns"][number] {
  const found = relation.columns.find((c) => c.name === name);
  if (found === undefined) throw new Error(`${relation.name} has no column ${name}`);
  return found;
}

/** A relation that is not on the map, with no privilege and no lock. */
export function relationOf(name: string, kind: Relation["kind"]): Relation {
  return {
    name,
    kind,
    held: [],
    columns: [{ name: "note", held: [], filled: false }],
    rowSecurity: { enabled: false, forced: false },
    rules: [],
    triggers: [],
  };
}
