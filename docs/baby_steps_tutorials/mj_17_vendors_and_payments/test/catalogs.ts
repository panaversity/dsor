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

// NEW IN STEP 17: app.payments, as migration 009 makes it. The database numbers each
// payment and writes its id from the number, so dsor_runtime writes neither. It writes
// the other columns once, and changes only the status (step 17's README, decisions 3, 12,
// and 15).
const PAYMENT_COLUMNS = [
  "number",
  "id",
  "tenant_id",
  "invoice_id",
  "vendor_id",
  "amount_value",
  "amount_currency",
  "status",
];
const PAYMENT_FILLED = ["number", "id"];
const PAYMENT_UPDATES = ["status"];

/** The catalog as steps 09 to 17 left it, seen by dsor_runtime. A fresh copy each call. */
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
        name: "app.payments",
        kind: "table",
        held: ["SELECT"],
        columns: PAYMENT_COLUMNS.map((name) => {
          const filled = PAYMENT_FILLED.includes(name);
          const held = filled ? ["SELECT"] : ["SELECT", "INSERT"];
          if (PAYMENT_UPDATES.includes(name)) held.push("UPDATE");
          return { name, held, filled };
        }),
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
    // The counter behind each payment's number. dsor_runtime holds nothing on it: an
    // identity column takes its next number without a privilege on the counter.
    sequences: [
      { name: "app.payments_number_seq", held: [] },
      { name: "dsor.audit_sequence_seq", held: [] },
    ],
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
