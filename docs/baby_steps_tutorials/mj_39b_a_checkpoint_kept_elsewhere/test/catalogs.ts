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
// Step 32: and a vendor's (step 32's README, decision D1).
export const VENDOR_TRIGGER =
  "CREATE TRIGGER vendors_version BEFORE UPDATE ON app.vendors FOR EACH ROW EXECUTE FUNCTION app.next_version()";
export const PAYMENT_TRIGGER =
  "CREATE TRIGGER payments_version BEFORE UPDATE ON app.payments FOR EACH ROW EXECUTE FUNCTION app.next_version()";
// The guard on proposals, the one trigger on DSoR's own side (step 22's README,
// decision 3).
export const PROPOSAL_TRIGGER =
  "CREATE TRIGGER proposals_move BEFORE INSERT OR UPDATE ON dsor.proposals FOR EACH ROW EXECUTE FUNCTION dsor.proposal_moves()";
// The guard on a version's moves (step 28's review, finding L14).
export const CONTROL_TRIGGER =
  "CREATE TRIGGER controls_move BEFORE UPDATE ON dsor.controls FOR EACH ROW EXECUTE FUNCTION dsor.control_moves()";
// Step 36: the guard on a note, which lets only its outcome be written, once (step 36's README,
//   decision D1).
// Step 38b: the guard on an alert's moves, as migration 034 makes it (step 38b's README, C7).
export const ALERT_TRIGGER =
  "CREATE TRIGGER alerts_move BEFORE INSERT OR DELETE OR UPDATE ON dsor.alerts FOR EACH ROW EXECUTE FUNCTION dsor.alert_moves()";
// Step 38b: dsor.alerts, as migration 034 makes it. dsor_runtime reads every column and escalates
//   an alert through two; the database's own triggers raise and close it. raised_at has a
//   default, and the trigger writes the state on the insert and the times (step 38b's README, decisions D1 and D6).
const ALERT_COLUMNS = [
  "tenant_id",
  "proposal_id",
  "raised_at",
  "state",
  "escalated_to",
  "escalated_at",
  "outcome",
  "closed_at",
];
// Step 38b: no TRUNCATE of the alerts, and the proposals' trigger that raises and closes an alert
//   (step 38b's README, claim C7 and decision D9).
export const ALERTS_STAY =
  "CREATE TRIGGER alerts_stay BEFORE TRUNCATE ON dsor.alerts FOR EACH STATEMENT EXECUTE FUNCTION dsor.alerts_stay()";
export const PROPOSAL_ALERT =
  "CREATE TRIGGER proposals_alert AFTER UPDATE OF state ON dsor.proposals FOR EACH ROW EXECUTE FUNCTION dsor.proposal_alerts()";
export const INTENT_TRIGGER =
  "CREATE TRIGGER intents_end BEFORE UPDATE ON dsor.intents FOR EACH ROW EXECUTE FUNCTION dsor.intent_ends()";
// The log's columns. dsor_runtime may INSERT every one but sequence and at, which the
// database fills in (step 09's README, decision 6).
export const AUDIT_COLUMNS: string[] = [
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
  // Migration 022 adds each control evaluated (step 27's README, decision D14).
  "controls",
  // Changed in step 33: migration 030 adds the bundle a record names (step 33's README, D2).
  "decision_bundle",
  // Changed in step 39: migration 035 adds the chain, which the commit's trigger writes and
  //   dsor_runtime only reads (step 39's README, decisions D2 and D6).
  "chain",
  "chain_position",
  "previous_hash",
  "record_hash",
];
const FILLED_BY_THE_DATABASE = ["sequence", "at"];
// Changed in step 39: the chain's columns, read only, with no default.
const CHAINED_BY_THE_DATABASE = ["chain", "chain_position", "previous_hash", "record_hash"];
// Changed in step 39: the trigger that chains each record at its commit (step 39's README, D2).
export const AUDIT_CHAIN_TRIGGER =
  "CREATE CONSTRAINT TRIGGER audit_chain AFTER INSERT ON dsor.audit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dsor.audit_chains()";

// Changed in step 33: dsor.decision_bundles, as migration 030 makes it. dsor_runtime reads every
//   column and adds a bundle through three. sealed_at is the database's to fill, and nothing
//   changes or removes a bundle (step 33's README, decision D3).
const BUNDLE_COLUMNS = ["decision_id", "tenant_id", "bundle", "sealed_at"];

// Step 37: dsor.holds, as migration 033 makes it. dsor_runtime reads every column and adds a hold
//   through three; placed_at is the database's to fill, and nothing changes or removes a hold
//   (step 37's README, decision D1).
const HOLD_COLUMNS = ["tenant_id", "resource", "proposal_id", "placed_at"];

// Step 36: dsor.intents, as migration 032 makes it. dsor_runtime reads every column, adds a note
//   through nine, and writes its outcome. written_at has a default; ended_at has none, and the
//   trigger writes it with the outcome (step 36's README, decision D1).
const INTENT_COLUMNS = [
  "proposal_id",
  "tenant_id",
  "operation",
  "payload_hash",
  "principal",
  "claim_operation",
  "idempotency_key",
  "connector",
  "security_context",
  "written_at",
  "outcome",
  "ended_at",
];
const INTENT_READ_ONLY = ["written_at", "ended_at"];

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
// And expires_at, which migration 020 adds. dsor_runtime writes it once, when it
// adds a proposal, from the database's clock (step 25c's README, decision D6).
// Changed in step 29: and requires, which migration 025 adds. dsor_runtime writes it on the move to
// PENDING_APPROVAL, through UPDATE only, and never adds it with a proposal (step 29's README,
// decision D4).
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
  "expires_at",
  "requires",
  // Step 32: the record its operation is exclusive over, which migration 029 adds last
  // (step 32's README, decision D7).
  "exclusive_over",
];

// Dsor.brakes, as migration 019 makes it. dsor_runtime reads every column, adds a
// brake through five, and writes its lift through three. pulled_at is the database's to fill
// (step 25b's README, decisions D5, D9, and D11).
const BRAKE_COLUMNS = [
  "tenant_id",
  "id",
  "agent",
  "pulled_by",
  "pulled_at",
  "reason",
  "lifted_by",
  "lifted_at",
  "lift_reason",
];
const BRAKE_ADDED = ["tenant_id", "id", "agent", "pulled_by", "reason"];
const BRAKE_LIFTED = ["lifted_by", "lifted_at", "lift_reason"];

// Dsor.controls, as migration 023 makes it. dsor_runtime reads every column, adds
// a draft through six, and moves a version through three. drafted_at is the database's to fill,
// and nothing removes a row or changes a version's text (step 28's README, decisions D2 and D11).
// Changed in step 28b: and the sweep's mark, in two more columns. dsor_runtime names the version
// in force, and the trigger writes the time of the mark (step 28b's README, decision D5).
const CONTROL_COLUMNS = [
  "tenant_id",
  "id",
  "version",
  "status",
  "rule",
  "compiled_by",
  "drafted_at",
  "reviewed_by",
  "effective_from",
  "stale_since",
  "in_force",
];
const CONTROL_ADDED = ["tenant_id", "id", "version", "status", "rule", "compiled_by"];
const CONTROL_MOVED = ["status", "reviewed_by", "effective_from", "in_force"];

// dsor.approvals, as migration 026 makes it. dsor_runtime reads every column and adds
// an approval through five. given_at is the database's to fill, and nothing changes or removes an
// approval (step 29's README, decision D8).
const APPROVAL_COLUMNS = ["tenant_id", "id", "proposal_id", "approver", "approval", "given_at"];

// Dsor.notices, as migration 024 makes it. dsor_runtime reads every column and adds a notice
// through seven. at is the database's to fill, and nothing changes or removes a notice (step
// 28b's README, decision D5).
const NOTICE_COLUMNS = [
  "notice_id",
  "tenant_id",
  "to_person",
  "rule_id",
  "version",
  "words",
  "at",
  "correlation",
];

// Dsor.rates, as migration 021 makes it. dsor_runtime reads every column, and adds a
// sheet through six. loaded_at is the database's to fill, and nothing changes or removes a row
// (step 26's README, decisions L1 and D6).
const RATE_COLUMNS = [
  "tenant_id",
  "source",
  "published_at",
  "base",
  "currency",
  "per_base",
  "loaded_at",
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
      // Step 32's vendors, read and never written, as invoices are (step 32's README, decision D1).
      {
        name: "app.vendors",
        kind: "table",
        held: ["SELECT"],
        columns: ["tenant_id", "id", "status", "version"].map((name) => ({
          name,
          held: ["SELECT"],
          filled: name === "version",
        })),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [VENDOR_TRIGGER],
      },
      // Step 38b: the alerts, raised with the move and moved only by the trigger's rule.
      {
        name: "dsor.alerts",
        kind: "table",
        held: ["SELECT"],
        columns: ALERT_COLUMNS.map((name) => {
          const filled = name === "raised_at";
          const moved = name === "state" || name === "escalated_to";
          return { name, held: moved ? ["SELECT", "UPDATE"] : ["SELECT"], filled };
        }),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [ALERT_TRIGGER, ALERTS_STAY],
      },
      // The approvals, behind the company's lock, written once.
      {
        name: "dsor.approvals",
        kind: "table",
        held: ["SELECT"],
        columns: APPROVAL_COLUMNS.map((name) => {
          const filled = name === "given_at";
          return { name, held: filled ? ["SELECT"] : ["SELECT", "INSERT"], filled };
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
          const readOnly = filled || CHAINED_BY_THE_DATABASE.includes(name);
          return { name, held: readOnly ? ["SELECT"] : ["SELECT", "INSERT"], filled };
        }),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [AUDIT_CHAIN_TRIGGER],
      },
      // Changed in step 39: each chain's head, the owner's own: dsor_runtime holds nothing on it
      //   (step 39's README, decision D8).
      {
        name: "dsor.audit_heads",
        kind: "table",
        held: [],
        columns: ["chain", "chain_position", "record_hash"].map((name) => ({
          name,
          held: [],
          filled: false,
        })),
        rowSecurity: { enabled: false, forced: false },
        rules: [],
        triggers: [],
      },
      // The brakes, behind the company's lock.
      {
        name: "dsor.brakes",
        kind: "table",
        held: ["SELECT"],
        columns: BRAKE_COLUMNS.map((name) => ({
          name,
          held: [
            "SELECT",
            ...(BRAKE_ADDED.includes(name) ? ["INSERT"] : []),
            ...(BRAKE_LIFTED.includes(name) ? ["UPDATE"] : []),
          ],
          filled: name === "pulled_at",
        })),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [],
      },
      // Each company's rules, behind the company's lock.
      {
        name: "dsor.controls",
        kind: "table",
        held: ["SELECT"],
        columns: CONTROL_COLUMNS.map((name) => ({
          name,
          held: [
            "SELECT",
            ...(CONTROL_ADDED.includes(name) ? ["INSERT"] : []),
            ...(CONTROL_MOVED.includes(name) ? ["UPDATE"] : []),
          ],
          filled: name === "drafted_at",
        })),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [CONTROL_TRIGGER],
      },
      // The decision bundles, behind the company's lock, written once.
      {
        name: "dsor.decision_bundles",
        kind: "table",
        held: ["SELECT"],
        columns: BUNDLE_COLUMNS.map((name) => {
          const filled = name === "sealed_at";
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
      // Step 37: the holds, behind the company's lock, added and never changed.
      {
        name: "dsor.holds",
        kind: "table",
        held: ["SELECT"],
        columns: HOLD_COLUMNS.map((name) => {
          const filled = name === "placed_at";
          return { name, held: filled ? ["SELECT"] : ["SELECT", "INSERT"], filled };
        }),
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
      // Step 36: the notes, behind the company's lock, each ended once.
      {
        name: "dsor.intents",
        kind: "table",
        held: ["SELECT"],
        columns: INTENT_COLUMNS.map((name) => {
          const filled = name === "written_at";
          if (name === "outcome") return { name, held: ["SELECT", "UPDATE"], filled };
          const held = INTENT_READ_ONLY.includes(name) ? ["SELECT"] : ["SELECT", "INSERT"];
          return { name, held, filled };
        }),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [INTENT_TRIGGER],
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
      // The notices to each rule's owner, behind the company's lock, written once.
      {
        name: "dsor.notices",
        kind: "table",
        held: ["SELECT"],
        columns: NOTICE_COLUMNS.map((name) => {
          const filled = name === "at";
          return { name, held: filled ? ["SELECT"] : ["SELECT", "INSERT"], filled };
        }),
        rowSecurity: { enabled: true, forced: true },
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
          if (name === "requires") return { name, held: ["SELECT", "UPDATE"], filled };
          return { name, held: filled ? ["SELECT"] : ["SELECT", "INSERT"], filled };
        }),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [PROPOSAL_ALERT, PROPOSAL_TRIGGER],
      },
      // The sheets of rates, behind the company's lock, written once.
      {
        name: "dsor.rates",
        kind: "table",
        held: ["SELECT"],
        columns: RATE_COLUMNS.map((name) => {
          const filled = name === "loaded_at";
          return { name, held: filled ? ["SELECT"] : ["SELECT", "INSERT"], filled };
        }),
        rowSecurity: { enabled: true, forced: true },
        rules: [],
        triggers: [],
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
