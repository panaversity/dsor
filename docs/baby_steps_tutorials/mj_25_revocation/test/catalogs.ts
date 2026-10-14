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
  // The version, which migration 014 adds last, with a default (step 21's
  // README, decision 1).
  "version",
];
// The triggers that raise a row's version, as PostgreSQL prints them (step 21's
// README, decision 11).
export const INVOICE_TRIGGER =
  "CREATE TRIGGER invoices_version BEFORE UPDATE ON app.invoices FOR EACH ROW EXECUTE FUNCTION app.next_version()";
export const PAYMENT_TRIGGER =
  "CREATE TRIGGER payments_version BEFORE UPDATE ON app.payments FOR EACH ROW EXECUTE FUNCTION app.next_version()";
// The guard on proposals, the one trigger on DSoR's own side (step 22's README,
// decision 3).
export const PROPOSAL_TRIGGER =
  "CREATE TRIGGER proposals_move BEFORE INSERT OR UPDATE ON dsor.proposals FOR EACH ROW EXECUTE FUNCTION dsor.proposal_moves()";
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
  // Migration 011 adds the agent's slip and person (step 18's README,
  // decision 8).
  "identity",
  "delegation",
];
const FILLED_BY_THE_DATABASE = ["sequence", "at"];

// The table dsor.delegations, as migration 010 makes it. dsor_runtime reads every
// column and writes none (step 18's README, decision 3). Migration 012 lets it
// change the status, and nothing else (step 19b's README, decision 3).
const DELEGATION_COLUMNS = [
  "tenant_id",
  "id",
  "delegator",
  "delegate",
  "modes",
  "permissions",
  "constraints",
  "subdelegation",
  "parent",
  "status",
  "expires_at",
  "extensions",
];

// app.payments, as migration 009 makes it. The database numbers each
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
  // And the version, which the database fills in and raises.
  "version",
];
const PAYMENT_FILLED = ["number", "id", "version"];
const PAYMENT_UPDATES = ["status"];

// dsor.idempotency, as migration 013 makes it. dsor_runtime reads every column,
// adds a claim through every column but answer and claimed_at, and fills the answer once. The
// database fills claimed_at (step 20's README, decision 12).
// And the mode, which migration 016 adds, last, with no default (step 23's README,
// decision 13).
const CLAIM_COLUMNS = [
  "tenant_id",
  "principal",
  "operation",
  "idempotency_key",
  "payload_hash",
  "request_id",
  "answer",
  "claimed_at",
  "mode",
];

// Dsor.proposals, as migration 015 makes it. dsor_runtime reads every column, adds
// a proposal through every column but created_at, which the database fills, and changes only the
// state (step 22's README, decisions 3 and 9).
const PROPOSAL_COLUMNS = [
  "tenant_id",
  "id",
  "operation",
  "mode",
  "state",
  "payload",
  "payload_hash",
  "resources",
  "requester",
  "idempotency_key",
  "created_at",
];

// Dsor.limit_counters and dsor.reservations, as migration 017 makes them.
// dsor_runtime reads every column, adds a row through every column, and changes only a total and a
// reservation's state (step 24's README, decision 13).
const COUNTER_COLUMNS = ["tenant_id", "delegation", "day", "currency", "used"];
const RESERVATION_COLUMNS = [
  "tenant_id",
  "proposal_id",
  "delegation",
  "day",
  "amount_value",
  "amount_currency",
  "state",
];

/** The catalog as steps 09 to 24 left it, seen by dsor_runtime. A fresh copy each call. */
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
        columns: INVOICE_COLUMNS.map((name) => ({
          name,
          held: ["SELECT"],
          filled: name === "version",
        })),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [INVOICE_TRIGGER],
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
        triggers: [PAYMENT_TRIGGER],
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
        name: "dsor.delegations",
        kind: "table",
        held: ["SELECT"],
        columns: DELEGATION_COLUMNS.map((name) => ({
          name,
          held: name === "status" ? ["SELECT", "UPDATE"] : ["SELECT"],
          filled: false,
        })),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [],
      },
      {
        name: "dsor.idempotency",
        kind: "table",
        held: ["SELECT"],
        columns: CLAIM_COLUMNS.map((name) => {
          const filled = name === "claimed_at";
          if (name === "answer") return { name, held: ["SELECT", "UPDATE"], filled };
          return { name, held: filled ? ["SELECT"] : ["SELECT", "INSERT"], filled };
        }),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [],
      },
      // The day's totals, behind the company's lock.
      {
        name: "dsor.limit_counters",
        kind: "table",
        held: ["SELECT"],
        columns: COUNTER_COLUMNS.map((name) => ({
          name,
          held: name === "used" ? ["SELECT", "INSERT", "UPDATE"] : ["SELECT", "INSERT"],
          filled: false,
        })),
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
      // The proposals, behind the company's lock, with their guard.
      {
        name: "dsor.proposals",
        kind: "table",
        held: ["SELECT"],
        columns: PROPOSAL_COLUMNS.map((name) => {
          const filled = name === "created_at";
          if (name === "state") return { name, held: ["SELECT", "INSERT", "UPDATE"], filled };
          return { name, held: filled ? ["SELECT"] : ["SELECT", "INSERT"], filled };
        }),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [PROPOSAL_TRIGGER],
      },
      // The reservations, behind the company's lock.
      {
        name: "dsor.reservations",
        kind: "table",
        held: ["SELECT"],
        columns: RESERVATION_COLUMNS.map((name) => ({
          name,
          held: name === "state" ? ["SELECT", "INSERT", "UPDATE"] : ["SELECT", "INSERT"],
          filled: false,
        })),
        rowSecurity: { enabled: true, forced: true },
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
