// Everything that talks to PostgreSQL. The log is the table dsor.audit,
// which dsor_runtime can add to and read, and never change (DSOR-AUD-04a in
// specs/dsor/03-execution.md, section 30). The invoices are the table app.invoices.
import {
  unknownFromNote,
  type IntentOutcome,
  type IntentStore,
  type KeptIntent,
} from "./intents.ts";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";
import { millisecondsOf } from "./authority.ts";
import type { Brake, BrakeBy, BrakeStore } from "./brakes.ts";
import type { Freshness } from "./freshness.ts";
import { millionths, type Reservation, type ReservationStore } from "./limits.ts";
import type { Invoice, InvoiceStatus, InvoiceStore } from "./invoice.ts";
import { checkBundle, type DecisionBundle, type SealedBundle } from "./bundle.ts";
import {
  changeOf,
  checkPair,
  controlChangeOf,
  controlOf,
  revocationOf,
  transitionOf,
  type Decision,
  type ControlChange,
  type DelegationChange,
  type OperationalControl,
  type DecisionLog,
  type DecisionRecord,
  type Mover,
  type ProposalTransition,
  type RevokeReason,
  type SuspendReason,
} from "./log.ts";
import { money } from "./money.ts";
import type { Payment, PaymentStatus, PaymentStore } from "./payment.ts";
import type { Vendor, VendorStatus } from "./vendor.ts";
import type { RateSheet } from "./exchange.ts";
import type { Loaded, Newest, RateStore } from "./rates.ts";
import {
  movable,
  NO_CONTROLS,
  type ControlStore,
  type InForce,
  type Live,
  type PolicyInForce,
  type RuleBy,
  type RuleStatus,
  type StaleMark,
} from "./rulebook.ts";
import type { Control } from "./controls.ts";
import type { FoundSlip, SlipStore } from "./slips.ts";
import type { Requirement } from "./envelope.ts";
import { approvalOf, stillOpen, type Approval, type Approving, type Offer } from "./approvals.ts";
import {
  checkMove,
  checkRequires,
  dsorMover,
  isProposalOf,
  proposalUri,
  transitionFrom,
  type Due,
  type MoveBy,
  type Pending,
  type Proposal,
  type ProposalDraft,
  type ProposalMode,
  type ProposalStore,
  type Requester,
  type State,
  type Waiting,
  IN_FLIGHT,
  type InFlight,
} from "./proposals.ts";
import {
  isOutcome,
  keptOf,
  keptText,
  refusalOf,
  usedForAnother,
  usedInAnotherMode,
  type ClaimScope,
  type ClaimStore,
  type Claimed,
  type Ended,
  type ProposalSteps,
  type WorkStores,
} from "./claims.ts";

// The step's own .env, found from this file, so the program finds it whatever folder it
// is started from. Found by step 06's review, for roles.json.
const DOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));

/**
 * Copies the named variables from the step's .env into the environment, when the file
 * exists. A variable already set wins, even when it is "".
 */
export function loadDotEnv(
  names: string[],
  file: string = DOT_ENV,
  env: NodeJS.ProcessEnv = process.env,
): void {
  // Node reads .env itself, so no package is needed (step 09's README, decision 4). There
  // is no .env in CI: there the variables are set, or missing.
  if (!existsSync(file)) return;
  // Only the names asked for. Found by step 09's review: loading the whole file put the
  // owner's key, DSOR_MIGRATION_URL, inside the running program.
  const found = parseEnv(readFileSync(file, "utf8"));
  for (const name of names) {
    const value = found[name];
    if (env[name] === undefined && value !== undefined) env[name] = value;
  }
}

/** The value of a variable. Missing or empty, it throws an error that names the variable. */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (value === undefined || value === "") {
    const where = `step 09's README, "Before you build: set up Neon"`;
    throw new Error(`${name} is not set. Put it in this step's .env file (${where}).`);
  }
  return value;
}

/** A pool of connections to the database at this URL. It connects at its first query. */
export function openPool(url: string): pg.Pool {
  // A pool keeps a few connections open and lends one to each query (step 09's README,
  // decision 1).
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  // The server may close a connection the pool is keeping, for example when Neon's compute
  // goes to sleep. The pool drops it and opens another at the next query. Without this
  // listener, Node would stop the whole program. pg's documentation asks for it.
  pool.on("error", () => {});
  return pool;
}

// Every touch of a company's table is one transaction that sets the
// company first (DSOR-RP-01c; step 11's README, decision 3).
/**
 * Runs the work on one connection, inside one transaction that sets the company first. The
 * company ends with the transaction, so the next request on the connection has none. With
 * no company, it is set to '', which means none.
 */
export async function inCompany<T>(
  pool: pg.Pool,
  company: string | undefined,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    // At READ COMMITTED, whatever the database's default. Each statement then
    // sees what committed before it, so a write that checks a version sees the version now, and
    // a second request waits for the first and reads again (step 21's README, decision 6;
    // step 20's README, decision 6). Found by the review: under REPEATABLE READ, the check
    // read an old snapshot, and a stale draft was written.
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    // true: only until COMMIT or ROLLBACK. Never false, which would leave the company on
    // the connection, and the pool lends the connection to the next request (§36).
    // Set even when there is no company: setting nothing would keep whatever company the
    // connection still carries, behind a shared pooler even another program's. Found by
    // the review (step 11's README, decision 3).
    await client.query("SELECT set_config('dsor.tenant_id', $1, true)", [company ?? ""]);
    const result = await work(client);
    // A COMMIT can roll back without an error: after a failed statement, even one the work
    // caught, PostgreSQL ends the transaction with ROLLBACK and says so in its answer. So
    // the answer is read, and anything but COMMIT takes the error path below (step 11's
    // README, decision 10). Found by the Stage 2 review, and fixed from step 11 on.
    const committed = await client.query("COMMIT");
    if (committed.command !== "COMMIT") throw new Error("the transaction was rolled back");
    client.release();
    return result;
  } catch (error) {
    // Whatever failed may have left the connection in a state the next request must not
    // inherit, so it is closed, never lent again. true tells the pool so.
    await client.query("ROLLBACK").catch(() => {});
    client.release(true);
    throw error;
  }
}

// Where a store's statements run. On the pool, each piece of work runs in a
// transaction of its own that sets the company first (inCompany). Inside a claim, it runs in the
// claim's own transaction, which has set the company already, so the claim, the code's reads
// and writes, and the answer commit together (step 20's README, decision 6).
/** Runs one piece of a store's work inside a company. */
type Runner = <T>(tenant: string, work: (client: pg.PoolClient) => Promise<T>) => Promise<T>;

// Each piece in a transaction of its own, as every store did before step 20.
function onPool(pool: pg.Pool): Runner {
  return <T>(tenant: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
    inCompany(pool, tenant, work);
}

// Each piece inside the claim's transaction. DSoR's own lock: that transaction set one company,
// and its stores work in no other (DSOR-IDN-03b).
function inClaim(client: pg.PoolClient, company: string): Runner {
  return async <T>(tenant: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
    if (tenant !== company) throw new Error("a claim's stores work inside its own company only");
    return work(client);
  };
}

// One row of dsor.audit, as pg gives it back.
type AuditRow = {
  record_id: string;
  sequence: string; // a bigint comes back as text, because it can outgrow a number
  at: Date;
  kind: "decision";
  operation: string | null;
  authorization: "ALLOW" | "DENY";
  result: string;
  reason: string | null;
  correlation: DecisionRecord["correlation"];
  tenant: string | null;
  extensions: DecisionRecord["extensions"] | null;
  // What a read returned. NULL on every other record.
  resources: string[] | null;
  row_count: number | null;
  // Which connector served a read. NULL on every other record.
  connector: string | null;
  // The slip an agent's call ran under, and its person. NULL on every other record.
  identity: DecisionRecord["identity"] | null;
  delegation: string | null;
  // Each control line ⑩ evaluated. NULL when no control governed the call.
  controls: DecisionRecord["controls"] | null;
  // The decision's bundle, by its id. NULL for a call with none.
  decision_bundle: string | null;
};

/** The log in the database: add a decision, and read the records of one company. */
// And read the bundles of one company (step 33's README, decision D14).
export type DbLog = DecisionLog & {
  records: (tenant: string) => Promise<DecisionRecord[]>;
  bundles: (tenant: string) => Promise<SealedBundle[]>;
};

/** The log, as rows of dsor.audit. */
export function createDbLog(pool: pg.Pool): DbLog {
  return Object.freeze({
    add: async (decision: Decision, bundle?: DecisionBundle): Promise<void> => {
      // Both checks before anything is written, as in memory: a record that names
      //   another bundle than the one given, and a bundle that fails its schema, keep nothing
      //   (step 33's README, decision D2).
      checkPair(decision, bundle);
      if (bundle !== undefined) checkBundle(bundle);
      // add finishes only after Postgres has committed the record, so when add returns,
      // the record survives a crash: "durably" in DSOR-EXE-02. The database gives the
      // record its number and its time (step 09's README, decision 6).
      // Inside the transaction of the call's company, or of none when the
      // call was refused before line ②. The policy lets the record in only if it carries
      // exactly that company (DSOR-TEN-02a; step 11's README, decision 4).
      await inCompany(pool, decision.tenant, async (client) => {
        // The bundle first, in the record's own transaction, so the record can name it: the
        //   database's key refuses a record that names a bundle it does not keep. A bundle that
        //   is kept and a record that is not roll back together (step 33's README, D2). The
        //   database gives the bundle its time, the transaction's, which the record shares.
        if (bundle !== undefined) {
          const sealed = await client.query(
            `INSERT INTO dsor.decision_bundles (decision_id, tenant_id, bundle) VALUES ($1, $2, $3)`,
            [bundle.decision_id, bundle.tenant, JSON.stringify(bundle)],
          );
          if (sealed.rowCount !== 1) {
            throw new Error(`the log kept ${sealed.rowCount ?? 0} bundles, not 1`);
          }
        }
        const { rowCount } = await client.query(
          `INSERT INTO dsor.audit
             (record_id, kind, operation, "authorization", result, reason, correlation, tenant,
              extensions, resources, row_count, connector, identity, delegation, controls,
              decision_bundle)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            `aud_${randomUUID()}`,
            decision.kind,
            decision.operation ?? null,
            decision.authorization,
            decision.result,
            decision.reason ?? null,
            decision.correlation,
            // NULL when no company was checked (step 10's README, decision 6).
            decision.tenant ?? null,
            // A company a non-member claimed (step 10's README, decision 6), or the
            // label of what a read returned (step 14's README, decision 7).
            decision.extensions ?? null,
            // The URIs a read returned, and how many (DSOR-CLS-05).
            decision.resources ?? null,
            decision.row_count ?? null,
            // Which connector served the read (step 15's README, decision 7).
            decision.connector ?? null,
            // The slip an agent's call ran under, and its person (step 18's
            // README, decision 8).
            decision.identity ?? null,
            decision.delegation ?? null,
            // Each control line ⑩ evaluated, in the record's own field. pg writes
            // an array as a PostgreSQL array, so the list goes as JSON text (step 27's README,
            // decision D14).
            decision.controls === undefined ? null : JSON.stringify(decision.controls),
            // The bundle it names, in the audit record's own field (step 33's README, D2).
            decision.decision_bundle ?? null,
          ],
        );
        // The database can take an INSERT and keep no row: a rule DO INSTEAD NOTHING on the
        // log, or a trigger that returns NULL. The record is kept only when one row was
        // written, so anything else is a log that cannot take the record (DSOR-EXE-03b).
        // Thrown inside the work, so inCompany rolls the transaction back. Found by step
        // 16's review, and fixed from step 09 on.
        if (rowCount !== 1) throw new Error(`the log kept ${rowCount ?? 0} rows, not 1`);
      });
    },
    // One company at a time. dsor_runtime cannot read another company's
    // records, or a record with no company, so there is no "every record" for it to ask
    // for (step 11's README, decision 6). The WHERE is DSoR's own lock, and the
    // transaction's company is the database's (DSOR-TEN-01b).
    // Decisions only. A suspension's record has no authorization, so it is not a
    // decision, and the people who read it use SQL until a later step (step 19b's README,
    // decision 12).
    records: async (tenant: string): Promise<DecisionRecord[]> => {
      const { rows } = await inCompany(pool, tenant, (client) =>
        client.query<AuditRow>(
          `SELECT record_id, sequence, at, kind, operation, "authorization", result, reason,
                  correlation, tenant, extensions, resources, row_count, connector, identity,
                  delegation, controls, decision_bundle
             FROM dsor.audit WHERE tenant = $1 AND kind = 'decision' ORDER BY sequence`,
          [tenant],
        ),
      );
      return rows.map(recordOf);
    },
    // The bundles of one company, in the order of the records that name them, each
    //   with the time the database gave it (step 33's README, decisions D3 and D14).
    bundles: async (tenant: string): Promise<SealedBundle[]> => {
      const { rows } = await inCompany(pool, tenant, (client) =>
        client.query<{ bundle: DecisionBundle; sealed_at: Date }>(
          `SELECT b.bundle, b.sealed_at
             FROM dsor.decision_bundles b JOIN dsor.audit a ON a.decision_bundle = b.decision_id
            WHERE b.tenant_id = $1 ORDER BY a.sequence`,
          [tenant],
        ),
      );
      return rows.map((row) => ({ ...row.bundle, sealed_at: row.sealed_at.toISOString() }));
    },
  });
}

// The same shape as a record in memory: no operation or reason when there is none.
function recordOf(row: AuditRow): DecisionRecord {
  return {
    record_id: row.record_id,
    sequence: Number(row.sequence),
    at: row.at.toISOString(),
    kind: row.kind,
    ...(row.operation === null ? {} : { operation: row.operation }),
    authorization: row.authorization,
    result: row.result,
    ...(row.reason === null ? {} : { reason: row.reason }),
    correlation: row.correlation,
    ...(row.tenant === null ? {} : { tenant: row.tenant }),
    ...(row.extensions === null ? {} : { extensions: row.extensions }),
    ...(row.resources === null ? {} : { resources: row.resources }),
    ...(row.row_count === null ? {} : { row_count: row.row_count }),
    ...(row.connector === null ? {} : { connector: row.connector }),
    ...(row.identity === null ? {} : { identity: row.identity }),
    ...(row.delegation === null ? {} : { delegation: row.delegation }),
    ...(row.controls === null ? {} : { controls: row.controls }),
    ...(row.decision_bundle === null ? {} : { decision_bundle: row.decision_bundle }),
  };
}

// One row of app.invoices. Money is stored as numeric and char(3) (step 09's README,
// decision 7), and pg gives a numeric back as text, so no number ever touches it.
type InvoiceRow = {
  tenant_id: string;
  id: string;
  vendor_id: string;
  amount_value: string;
  amount_currency: string;
  open_amount_value: string;
  open_amount_currency: string;
  status: InvoiceStatus;
  // The row's version, which the database raises at each change (step 21's
  // README, decision 2).
  version: number;
};

/** The invoices, read from app.invoices. */
export function createDbInvoices(pool: pg.Pool): InvoiceStore {
  return invoicesThrough(onPool(pool));
}

// The same statements, through a runner: on the pool, or inside a claim.
function invoicesThrough(run: Runner): InvoiceStore {
  return {
    // The company is part of every query, as a value (DSOR-IDN-03b). That is the first
    // lock, DSoR's own. The query runs inside the company's transaction, so
    // the database's lock filters the rows too (DSOR-TEN-01b).
    get: async (tenant, id) => {
      const { observed, rows } = await run(tenant, async (client) => ({
        observed: await databaseNow(client),
        rows: (
          await client.query<InvoiceRow>(
            `SELECT tenant_id, id, vendor_id, amount_value, amount_currency,
                    open_amount_value, open_amount_currency, status, version
               FROM app.invoices WHERE tenant_id = $1 AND id = $2`,
            [tenant, id],
          )
        ).rows,
      }));
      const row = rows[0];
      const invoice = row === undefined ? undefined : invoiceOf(row);
      // A read of one invoice names its version, the row's own (DSOR-FRS-01a,
      // DSOR-CNR-03b).
      const version = invoice === undefined ? {} : { resource_version: String(invoice.version) };
      return { invoice, freshness: { ...fromPostgres(observed), ...version } };
    },
    // The first `count` invoices of the company after the cursor, in order
    // of id (step 13's README, decision 4). With no cursor, $2 is NULL, and the list starts
    // at the first. The company is in the WHERE, DSoR's own lock, and the
    // transaction sets it for the database's lock, as for get. The order is the database's
    // C.UTF-8, which compares text by its character codes, as < does in memory.
    list: async (tenant, after, count) => {
      const { observed, rows } = await run(tenant, async (client) => ({
        observed: await databaseNow(client),
        rows: (
          await client.query<InvoiceRow>(
            `SELECT tenant_id, id, vendor_id, amount_value, amount_currency,
                    open_amount_value, open_amount_currency, status, version
               FROM app.invoices WHERE tenant_id = $1 AND ($2::text IS NULL OR id > $2)
              ORDER BY id LIMIT $3`,
            [tenant, after ?? null, count],
          )
        ).rows,
      }));
      return { rows: rows.map(invoiceOf), freshness: fromPostgres(observed) };
    },
    // One vendor of the company, from app.vendors, read as an invoice is: the
    //   company in the WHERE, DSoR's own lock, inside the company's transaction for the database's
    //   (DSOR-TEN-01b; step 32's README, decision D1).
    vendor: async (tenant, id) => {
      const { observed, rows } = await run(tenant, async (client) => ({
        observed: await databaseNow(client),
        rows: (
          await client.query<{
            tenant_id: string;
            id: string;
            status: VendorStatus;
            version: number;
          }>(
            `SELECT tenant_id, id, status, version FROM app.vendors WHERE tenant_id = $1 AND id = $2`,
            [tenant, id],
          )
        ).rows,
      }));
      const row = rows[0];
      const vendor: Vendor | undefined =
        row === undefined
          ? undefined
          : { tenant_id: row.tenant_id, id: row.id, status: row.status, version: row.version };
      const version = vendor === undefined ? {} : { resource_version: String(vendor.version) };
      return { vendor, freshness: { ...fromPostgres(observed), ...version } };
    },
  };
}

// One row of app.payments, as pg gives it back. The amount comes back as
// text, as an invoice's does.
type PaymentRow = {
  tenant_id: string;
  id: string;
  invoice_id: string;
  vendor_id: string;
  amount_value: string;
  amount_currency: string;
  status: PaymentStatus;
  // And its version.
  version: number;
};
const PAYMENT_COLUMNS =
  "tenant_id, id, invoice_id, vendor_id, amount_value, amount_currency, status, version";

// The payments, in the table app.payments (step 17's README, outcome 1).
// Each write is one transaction that sets the company first, as every read is (step 11's
// README, decision 3). The company is in every statement too: DSoR's own lock.
/** The payments, written to app.payments. */
export function createDbPayments(pool: pg.Pool): PaymentStore {
  return paymentsThrough(onPool(pool));
}

// The same statements, through a runner: on the pool, or inside a claim.
function paymentsThrough(run: Runner): PaymentStore {
  return {
    // The database gives the number and the id. The status is written as draft here, never
    // taken from the caller (step 17's README, decisions 12 and 15).
    // And only while the invoice still has the version the caller decided on.
    // The condition is part of the INSERT, so no change can land between the check and the
    // write. When the INSERT writes nothing, one look in the same transaction says why (step
    // 21's README, decision 6).
    create: async (tenant, draft, invoiceVersion) =>
      run(tenant, async (client) => {
        const { rows } = await client.query<PaymentRow>(
          `INSERT INTO app.payments
             (tenant_id, invoice_id, vendor_id, amount_value, amount_currency, status)
           SELECT $1::text, $2::text, $3::text, $4::numeric, $5::char(3), 'draft'
            WHERE EXISTS (SELECT 1 FROM app.invoices
                           WHERE tenant_id = $1 AND id = $2 AND version = $6::int)
           RETURNING ${PAYMENT_COLUMNS}`,
          [
            tenant,
            draft.invoice_id,
            draft.vendor_id,
            draft.amount.value,
            draft.amount.currency,
            invoiceVersion,
          ],
        );
        if (rows.length === 1) return { payment: paymentOf(rows[0]!) };
        // The invoice's version now. Another version, or none, means the invoice has moved on.
        const now = await client.query<{ version: number }>(
          "SELECT version FROM app.invoices WHERE tenant_id = $1 AND id = $2",
          [tenant, draft.invoice_id],
        );
        const version = now.rows[0]?.version;
        // A rule or a trigger could keep no row, and the code would think it had a draft
        // (step 16's README, decision 3).
        if (rows.length !== 0 || version === invoiceVersion) {
          throw new Error(`the payments table kept ${rows.length} rows, not 1`);
        }
        return { invoiceVersion: version };
      }),
    // One UPDATE decides: only a draft changes, so two cancels at the same moment cannot both
    // succeed. When it changes nothing, one look in the same transaction says why: a payment
    // that is not a draft, or none at all (step 17's README, decision 9).
    // And only at the version the caller decided on. The look says which
    // version the payment has now, and the database's trigger raises it at the change (step 21's
    // README, decisions 2 and 6).
    cancel: async (tenant, id, version) =>
      run(tenant, async (client) => {
        const changed = await client.query<PaymentRow>(
          `UPDATE app.payments SET status = 'cancelled'
            WHERE tenant_id = $1 AND id = $2 AND status = 'draft' AND version = $3
            RETURNING ${PAYMENT_COLUMNS}`,
          [tenant, id, version],
        );
        const row = changed.rows[0];
        if (row !== undefined) return { payment: paymentOf(row), changed: true };
        const now = await client.query<PaymentRow>(
          `SELECT ${PAYMENT_COLUMNS} FROM app.payments WHERE tenant_id = $1 AND id = $2`,
          [tenant, id],
        );
        const found = now.rows[0];
        return { payment: found === undefined ? undefined : paymentOf(found), changed: false };
      }),
    // One payment, read and locked in the company's own transaction. Inside a claim
    //   the lock holds until the claim ends, so a cancel of the payment waits while the bank is
    //   asked (step 35's README, decision D7).
    get: async (tenant, id) =>
      run(tenant, async (client) => {
        const { rows } = await client.query<PaymentRow>(
          `SELECT ${PAYMENT_COLUMNS} FROM app.payments WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
          [tenant, id],
        );
        const found = rows[0];
        return found === undefined ? undefined : paymentOf(found);
      }),
    // One UPDATE decides, as for a cancel: only a draft at this version is paid
    //   (step 35's README, decision D7).
    pay: async (tenant, id, version) =>
      run(tenant, async (client) => {
        const changed = await client.query<PaymentRow>(
          `UPDATE app.payments SET status = 'paid'
            WHERE tenant_id = $1 AND id = $2 AND status = 'draft' AND version = $3
            RETURNING ${PAYMENT_COLUMNS}`,
          [tenant, id, version],
        );
        const row = changed.rows[0];
        if (row !== undefined) return { payment: paymentOf(row), changed: true };
        const now = await client.query<PaymentRow>(
          `SELECT ${PAYMENT_COLUMNS} FROM app.payments WHERE tenant_id = $1 AND id = $2`,
          [tenant, id],
        );
        const found = now.rows[0];
        return { payment: found === undefined ? undefined : paymentOf(found), changed: false };
      }),
    // The paid payments of one invoice (step 35's review, F2).
    paidFor: async (tenant, invoiceId) =>
      run(tenant, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM app.payments
            WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'paid' ORDER BY id`,
          [tenant, invoiceId],
        );
        return rows.map((row) => row.id);
      }),
  };
}

// One row as a payment. money() checks the text again, as for an invoice.
function paymentOf(row: PaymentRow): Payment {
  return {
    tenant_id: row.tenant_id,
    id: row.id,
    invoice_id: row.invoice_id,
    vendor_id: row.vendor_id,
    amount: money(row.amount_value, row.amount_currency),
    status: row.status,
    version: row.version,
  };
}

// A read from PostgreSQL, within this request, is current (DSOR-FRS-01a).
/** The label of a read from PostgreSQL, made at this moment of the database's clock. */
function fromPostgres(observed: Date): Freshness {
  return { mode: "current", observed_at: observed.toISOString(), connector: "postgres" };
}

// The database's clock, in the transaction that reads the rows. now() is the
// moment the transaction began, a moment before the rows are read, so the label is never
// younger than the data. One clock for every server, as the log's times are (step 15's
// README, decision 2; step 09's README, decision 6).
/** The database's now(), in this client's transaction. */
async function databaseNow(client: pg.PoolClient): Promise<Date> {
  const { rows } = await client.query<{ now: Date }>("SELECT now() AS now");
  return rows[0]!.now;
}

// One row as an invoice. Shared by get and list.
function invoiceOf(row: InvoiceRow): Invoice {
  // money() checks the text again, so a number from a wrong query is refused here.
  return {
    tenant_id: row.tenant_id,
    id: row.id,
    vendor_id: row.vendor_id,
    amount: money(row.amount_value, row.amount_currency),
    open_amount: money(row.open_amount_value, row.open_amount_currency),
    status: row.status,
    version: row.version,
  };
}

// What Postgres says about the user the program logged in as (step 09's
// README, decision 17).
/** The facts the start-up check needs about the logged-in user. */
export type RoleFacts = {
  who: string;
  superuser: boolean;
  bypassrls: boolean;
  writes_all: boolean;
  owns: number;
  can_change_audit: boolean;
  // How many roles it belongs to. SET ROLE can switch to any of them, and
  // to that role's powers (DSOR-RP-01a; step 11's README, decision 7).
  member_of: number;
};

/** Every reason this login must not run the program. None means it may. */
export function problemsOf(facts: RoleFacts): string[] {
  const problems: string[] = [];
  if (facts.who !== "dsor_runtime") problems.push(`logged in as "${facts.who}", not dsor_runtime`);
  if (facts.superuser) problems.push("is a superuser");
  if (facts.bypassrls) problems.push("holds BYPASSRLS");
  if (facts.writes_all) problems.push("is a member of pg_write_all_data");
  if (facts.owns > 0) problems.push(`owns ${facts.owns} tables`);
  if (facts.can_change_audit) problems.push("can change or remove records in dsor.audit");
  if (facts.member_of > 0) {
    const roles = facts.member_of === 1 ? "role" : "roles";
    problems.push(`belongs to ${facts.member_of} other ${roles}, which SET ROLE can switch to`);
  }
  return problems;
}

/**
 * Asks Postgres about the login, and gives back every problem with it. A pool asks in a
 * read-only transaction of its own. One connection asks inside the transaction its caller
 * has open.
 */
export async function runtimeRoleProblems(db: pg.Pool | pg.ClientBase): Promise<string[]> {
  if (db instanceof pg.Pool) {
    const client = await db.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const problems = await runtimeRoleProblems(client);
      await client.query("ROLLBACK");
      client.release();
      return problems;
    } catch (error) {
      // A connection whose check failed is closed, never lent again.
      await client.query("ROLLBACK").catch(() => {});
      client.release(true);
      throw error;
    }
  }
  // Every name below is looked up in pg_catalog first, and in pg_temp last. Otherwise a
  // function in public named has_table_privilege, found first through a search path the
  // owner set, could answer for PostgreSQL's own. SET LOCAL lasts until the transaction
  // ends. Found by step 16's review, and fixed from step 09 on.
  await db.query("SET LOCAL search_path TO pg_catalog, pg_temp");
  // has_..._privilege counts privileges held directly, through PUBLIC, and through every
  // role this one belongs to. A grant on one column counts too.
  const { rows } = await db.query<RoleFacts>(
    `SELECT r.rolname AS who, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
            pg_has_role(r.oid, 'pg_write_all_data', 'MEMBER') AS writes_all,
            (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns,
            has_table_privilege('dsor.audit', 'DELETE')
              OR has_table_privilege('dsor.audit', 'TRUNCATE')
              OR has_any_column_privilege('dsor.audit', 'UPDATE') AS can_change_audit,
            (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS member_of
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  return problemsOf(rows[0]!);
}

// One row of dsor.delegations, as pg gives it back, with the database's own answer to "has
// its time passed?" (step 18's README, decision 12).
type SlipRow = {
  tenant_id: string;
  id: string;
  delegator: string;
  delegate: string;
  modes: string[];
  permissions: string[];
  constraints: Record<string, unknown>;
  subdelegation: Record<string, unknown>;
  parent: string | null;
  status: string;
  // pg gives infinity as a number, and a year past 275760 as a date JavaScript cannot write.
  expires_at: Date | number;
  extensions: Record<string, unknown> | null;
  past: boolean;
};

// The permission slips, read from dsor.delegations, DSoR's own store
// (DSOR-DEL-01a; step 18's README, decision 3).
/** The slips, read from dsor.delegations, one company at a time. */
export function createDbSlips(pool: pg.Pool): SlipStore {
  return slipsThrough(onPool(pool));
}

// The slip's lock is a PostgreSQL advisory lock, as the brake's is: one number for
// each slip of each company, made from this text by hashtextextended. A command under the slip
// takes it shared, inside its claim, right after line ⑧. The tear-up takes it alone. Not FOR SHARE
// on the slip's row: the policy slip_moves lets dsor_runtime lock only an active or suspended
// slip, so a torn-up one would vanish from the read, and line ③'s own words could not name it
// (step 25c's README, decision D12).
function slipKey(tenant: string, id: string): string {
  return `dsor.slip/${tenant}/${id}`;
}

/** One slip of one company, by its id, read on this connection. */
async function slipById(
  client: pg.PoolClient,
  tenant: string,
  id: string,
): Promise<FoundSlip | undefined> {
  const { rows } = await client.query<SlipRow>(
    `SELECT ${SLIP_COLUMNS} FROM dsor.delegations WHERE tenant_id = $1 AND id = $2`,
    [tenant, id],
  );
  if (rows.length === 0) return undefined;
  // The table's key is the company and the id, so two rows mean the key is gone.
  if (rows.length !== 1) throw new Error(`one id names ${rows.length} slips, not 1`);
  const row = rows[0]!;
  return { slip: slipOf(row), past: row.past };
}

// The slips through a runner, as the invoices and payments are, so a tear-up works
// inside the claim's transaction, with the proposals it cancels and their reservations (step 25's
// README, decision D2). On the pool, each piece runs in a transaction of its own, as before.
function slipsThrough(run: Runner): SlipStore {
  return Object.freeze({
    find: async (tenant: string, delegate: string): Promise<FoundSlip | undefined> => {
      // Inside the company's transaction, so the database's lock filters too, and with
      // DSoR's own WHERE, the company first (DSOR-TEN-01b). The database's clock decides the
      // time, in the same statement (step 18's README, decision 12).
      const { rows } = await run(tenant, (client) =>
        client.query<SlipRow>(
          `SELECT ${SLIP_COLUMNS} FROM dsor.delegations WHERE tenant_id = $1 AND delegate = $2`,
          [tenant, delegate],
        ),
      );
      if (rows.length === 0) return undefined;
      // The table keeps one slip per agent and company (step 18's README, decision 7). Two
      // rows mean that rule is gone, and DSoR never chooses between two slips.
      if (rows.length !== 1) {
        throw new Error(`dsor.delegations holds ${rows.length} slips for one agent in one company`);
      }
      const row = rows[0]!;
      return { slip: slipOf(row), past: row.past };
    },
    // Her active slips in this company are suspended, and each leaves one
    // record, in one transaction: both, or neither (step 19b's README, decisions 3 and 4).
    suspend: async (tenant: string, delegator: string, why: SuspendReason): Promise<string[]> =>
      run(tenant, async (client) => {
        // DSoR's own WHERE, the company first, with row-level security behind it
        // (DSOR-IDN-03b). "Only if still active": a torn-up or expired slip is never suspended,
        // and a second call that heard the same news waits for the first, then changes nothing
        // (C7 and C8). The runtime login may change this one column (decision 3), and only from
        // active to suspended: the database's own policy checks that too (decision 13).
        const { rows } = await client.query<{ id: string }>(
          `UPDATE dsor.delegations SET status = 'suspended'
            WHERE tenant_id = $1 AND delegator = $2 AND status = 'active' RETURNING id`,
          [tenant, delegator],
        );
        const ids = rows.map((row) => row.id).sort();
        for (const id of ids) await recordChange(client, changeOf(tenant, id, why));
        return ids;
      }),
    // One slip of one company, by its id, for the tear-up.
    get: async (tenant: string, id: string): Promise<FoundSlip | undefined> =>
      run(tenant, (client) => slipById(client, tenant, id)),
    // The same, under the slip's lock, shared, until the transaction ends. Only
    // inside a claim does the lock outlast the read: on the pool, its transaction ends at once.
    // The read comes after the wait, so it sees a tear-up that committed meanwhile.
    hold: async (tenant: string, id: string): Promise<FoundSlip | undefined> =>
      run(tenant, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))", [
          slipKey(tenant, id),
        ]);
        return slipById(client, tenant, id);
      }),
    // The tear-up and its record, in one transaction: both, or neither. The check
    // and the change are one statement: only a slip still active or suspended, and not past its
    // date by the database's clock. The runtime login may move a slip to suspended or revoked
    // only, and only from active or suspended: the database's own policy checks that too
    // (migration 018; step 25's README, decisions D5 and D6).
    // First the slip's lock, alone, until the transaction ends. The tear-up waits
    // for every command under the slip that is past its check after line ⑧, and every command after
    // it waits for the tear-up (step 25c's README, decision D12).
    revoke: async (tenant: string, id: string, why: RevokeReason): Promise<boolean> =>
      run(tenant, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          slipKey(tenant, id),
        ]);
        const { rowCount } = await client.query(
          `UPDATE dsor.delegations SET status = 'revoked'
            WHERE tenant_id = $1 AND id = $2 AND status IN ('active', 'suspended')
              AND expires_at > now()`,
          [tenant, id],
        );
        if (rowCount === 0) return false;
        if (rowCount !== 1) throw new Error(`one tear-up changed ${rowCount} slips, not 1`);
        await recordChange(client, revocationOf(tenant, id, why));
        return true;
      }),
  });
}

// The brakes, in dsor.brakes, DSoR's own store. On the pool for line ④, and
// inside the claim's transaction for the check after line ⑧ and for DSoR's own work (step 25b's
// README, decisions D5, D8, and D9).
/** The brakes, read from dsor.brakes, one company at a time. */
export function createDbBrakes(pool: pg.Pool): BrakeStore {
  return brakesThrough(onPool(pool));
}

// One brake's row, as pg gives it back.
type BrakeRow = {
  tenant_id: string;
  id: string;
  agent: string | null;
  pulled_by: string;
  reason: string;
  lifted_by: string | null;
  lift_reason: string | null;
};
const BRAKE_COLUMNS = "tenant_id, id, agent, pulled_by, reason, lifted_by, lift_reason";

// The brake's lock is a PostgreSQL advisory lock: a lock on a number the program chooses, not on
// a row. One number for each agent of each company, and one for each company, made from this
// text by hashtextextended. A command from an agent takes both, shared. A pull takes its
// target's, alone (step 25b's README, decision D8).
function brakeKey(tenant: string, agent: string | undefined): string {
  return `dsor.brake/${tenant}/${agent ?? "*"}`;
}

// A brake on this agent, or the company's freeze, that is on now. DSoR's own WHERE, the company
// first, with row-level security behind it (DSOR-TEN-01b).
const BRAKE_ON = `SELECT EXISTS (
    SELECT 1 FROM dsor.brakes
     WHERE tenant_id = $1 AND lifted_at IS NULL AND (agent = $2 OR agent IS NULL)) AS on`;

/** A brake in the shape DSoR keeps it, from its row. */
function brakeOf(row: BrakeRow): Brake {
  return {
    tenant: row.tenant_id,
    id: row.id,
    ...(row.agent === null ? {} : { agent: row.agent }),
    pulled_by: row.pulled_by,
    reason: row.reason,
    ...(row.lifted_by === null ? {} : { lifted_by: row.lifted_by }),
    ...(row.lift_reason === null ? {} : { lift_reason: row.lift_reason }),
  };
}

function brakesThrough(run: Runner): BrakeStore {
  return Object.freeze({
    on: async (tenant: string, agent: string): Promise<boolean> =>
      run(tenant, async (client) => {
        const { rows } = await client.query<{ on: boolean }>(BRAKE_ON, [tenant, agent]);
        return rows[0]?.on === true;
      }),
    holdOff: async (tenant: string, agent: string): Promise<boolean> =>
      run(tenant, async (client) => {
        // The agent's number first, then the company's, the same order for every call, so two
        // calls never wait for each other in a circle. Held until the transaction ends.
        await client.query(
          `SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0)),
                  pg_advisory_xact_lock_shared(hashtextextended($2, 0))`,
          [brakeKey(tenant, agent), brakeKey(tenant, undefined)],
        );
        const { rows } = await client.query<{ on: boolean }>(BRAKE_ON, [tenant, agent]);
        return rows[0]?.on === true;
      }),
    get: async (tenant: string, agent: string | undefined): Promise<Brake | undefined> =>
      run(tenant, async (client) => {
        const { rows } = await client.query<BrakeRow>(
          `SELECT ${BRAKE_COLUMNS} FROM dsor.brakes
            WHERE tenant_id = $1 AND agent IS NOT DISTINCT FROM $2::text AND lifted_at IS NULL`,
          [tenant, agent ?? null],
        );
        if (rows.length === 0) return undefined;
        // The table keeps one brake on for each target. Two mean that rule is gone.
        if (rows.length !== 1)
          throw new Error(`${rows.length} brakes are on for one target, not 1`);
        return brakeOf(rows[0]!);
      }),
    // The pull and its record, in one transaction: both, or neither. First the target's number,
    // alone, until the transaction ends: the pull waits for every command of the agent that is
    // past its check after line ⑧, and every command after it waits for the pull. Then one
    // statement adds the brake, unless one is on for the target already (decision L9).
    pull: async (tenant: string, agent: string | undefined, by: BrakeBy) =>
      run(tenant, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          brakeKey(tenant, agent),
        ]);
        const { rows } = await client.query<BrakeRow>(
          `INSERT INTO dsor.brakes (tenant_id, id, agent, pulled_by, reason)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, (coalesce(agent, '*'))) WHERE lifted_at IS NULL DO NOTHING
           RETURNING ${BRAKE_COLUMNS}`,
          [tenant, `brk_${randomUUID()}`, agent ?? null, by.person, by.words],
        );
        if (rows.length === 0) return undefined;
        const result = agent === undefined ? "frozen" : "suspended";
        await recordControl(client, controlOf(tenant, agent, result, by));
        return brakeOf(rows[0]!);
      }),
    // The lift and its record, in one transaction: both, or neither. It takes no lock: a lift
    // only lets work go again (decision D10). Only a brake that is on: the database's own policy
    // checks that too.
    lift: async (tenant: string, agent: string | undefined, by: BrakeBy) =>
      run(tenant, async (client) => {
        const { rows } = await client.query<BrakeRow>(
          `UPDATE dsor.brakes SET lifted_by = $3, lifted_at = clock_timestamp(), lift_reason = $4
            WHERE tenant_id = $1 AND agent IS NOT DISTINCT FROM $2::text AND lifted_at IS NULL
            RETURNING ${BRAKE_COLUMNS}`,
          [tenant, agent ?? null, by.person, by.words],
        );
        if (rows.length === 0) return undefined;
        if (rows.length !== 1) throw new Error(`one lift changed ${rows.length} brakes, not 1`);
        await recordControl(client, controlOf(tenant, agent, "lifted", by));
        return brakeOf(rows[0]!);
      }),
  });
}

// One pull or lift of a brake, in the log, inside the change's own transaction, with its target
// in resources (step 25b's README, decision D6).
async function recordControl(client: pg.PoolClient, record: OperationalControl): Promise<void> {
  const { rowCount } = await client.query(
    `INSERT INTO dsor.audit
       (record_id, kind, result, reason, correlation, tenant, identity, resources)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      `aud_${randomUUID()}`,
      record.kind,
      record.result,
      record.reason,
      record.correlation,
      record.tenant,
      record.identity,
      record.resources,
    ],
  );
  // As for the log's own INSERT: a record is kept only when one row was written.
  if (rowCount !== 1) throw new Error(`the log kept ${rowCount ?? 0} rows, not 1`);
}

// The columns of a slip, and whether its time has passed by the database's clock, in the same
// statement (step 18's README, decision 12). Since step 25 both reads use it.
const SLIP_COLUMNS = `tenant_id, id, delegator, delegate, modes, permissions, constraints,
  subdelegation, parent, status, expires_at, extensions, expires_at <= now() AS past`;

// One change to a slip, in the log, inside the change's own transaction. No authorization: the
// change allowed and denied nothing (step 19b's README, decision 10). Since step 25 a tear-up
// writes one too.
async function recordChange(client: pg.PoolClient, change: DelegationChange): Promise<void> {
  const { rowCount } = await client.query(
    `INSERT INTO dsor.audit
       (record_id, kind, result, reason, correlation, tenant, identity, delegation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      `aud_${randomUUID()}`,
      change.kind,
      change.result,
      change.reason,
      change.correlation,
      change.tenant,
      change.identity,
      change.delegation,
    ],
  );
  // As for the log's own INSERT: a record is kept only when one row was written. Thrown inside
  // the work, so the transaction rolls back the change too, as step 16's review found for the log.
  if (rowCount !== 1) throw new Error(`the log kept ${rowCount ?? 0} rows, not 1`);
}

// The slip in the specification's shape: tenant, not tenant_id, and no field that the row
// leaves empty. Line ③ checks it against the schema.
function slipOf(row: SlipRow): unknown {
  return {
    id: row.id,
    tenant: row.tenant_id,
    delegator: row.delegator,
    delegate: row.delegate,
    modes: row.modes,
    permissions: row.permissions,
    constraints: row.constraints,
    subdelegation: row.subdelegation,
    ...(row.parent === null ? {} : { parent: row.parent }),
    status: row.status,
    // A time JavaScript cannot write is left out, so the schema check refuses the slip.
    // Found by step 18's review: infinity failed here by accident, with DSoR's message for a
    // bug (step 18's README, decision 13).
    expires_at: writable(row.expires_at),
    ...(row.extensions === null ? {} : { extensions: row.extensions }),
  };
}

// The time as the specification writes it, or nothing.
function writable(time: Date | number): string | undefined {
  return time instanceof Date && Number.isFinite(time.getTime()) ? time.toISOString() : undefined;
}

// The claims of idempotency keys, in the table dsor.idempotency (DSOR-IDM-01b;
// step 20's README, decisions 6, 7, 9, and 12).
// One claim's row, as a second request reads it: the fingerprint, the first call's request id,
// and its outcome, which pg gives back already read from its JSON text.
// With the mode of the call that made the claim.
type ClaimRow = {
  payload_hash: string;
  mode: ProposalMode;
  request_id: string;
  answer: unknown;
  unanswered: boolean;
};

// The claim's scope, as the first four values of each statement. The company is DSoR's own lock
// here, beside the database's (DSOR-TEN-01b).
const IN_SCOPE = "tenant_id = $1 AND principal = $2 AND operation = $3 AND idempotency_key = $4";

/** The claims, in dsor.idempotency. */
export function createDbClaims(
  pool: pg.Pool,
  // And the store of rules that the claim's work reads and changes: "database" for
  // dsor.controls, inside the claim's own transaction, or the store the world gives, none unless
  // it gives one, so a world of an earlier step's idea reads no rule (step 28's README, decision
  // D18).
  controls: ControlStore | "database" = NO_CONTROLS,
): ClaimStore {
  return Object.freeze({
    // The reservations, each piece in a transaction of its own, for a dry run.
    reservations: createDbReservations(pool),
    // And the sheets of rates, for a dry run's line ⑩ (step 26's README, claim C3).
    rates: createDbRates(pool),
    // And the proposals, for a dry run's line ⑨ (step 29's README, decision D5).
    proposals: createDbProposals(pool),
    // NEW IN STEP 36: and the intent records, each read in a transaction of its own.
    intents: createDbIntents(pool),
    run: async (
      scope: ClaimScope,
      payloadHash: string,
      mode: ProposalMode,
      requestId: string,
      work: (stores: WorkStores) => Promise<unknown>,
      steps?: ProposalSteps,
    ): Promise<Claimed> => {
      // One transaction: the claim, the code's reads and writes, and the outcome. They commit
      // together, or none of them does (decision 6).
      // And the proposal, with the records of its moves (step 22's README,
      // decision 9).
      const claimed = await inCompany(pool, scope.tenant, async (client) => {
        const ids = [scope.tenant, scope.principal, scope.operation, scope.key];
        // The claim is one INSERT, and the primary key picks the winner. A second request with
        // the same key waits here until this transaction ends. Then it adds nothing, and reads
        // the row below. Never "look, then add": two requests could both look first (§22,
        // "Common mistake").
        // With the call's mode, which the claim keeps (step 23's README, decision 4).
        const added = await client.query(
          `INSERT INTO dsor.idempotency
             (tenant_id, principal, operation, idempotency_key, payload_hash, mode, request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tenant_id, principal, operation, idempotency_key) DO NOTHING`,
          [...ids, payloadHash, mode, requestId],
        );
        if (added.rowCount === 0) return replay(client, ids, payloadHash, mode);
        if (added.rowCount !== 1) throw new Error(`the claim added ${added.rowCount} rows, not 1`);
        const stores = storesIn(client, scope.tenant, controls);
        // Line ⑧, before the savepoint, so a refusal that undoes the code's work
        // keeps the proposal (step 22's README, decision 9).
        const opened = steps === undefined ? undefined : await steps.open(stores);
        const proposal = opened?.proposal;
        // A proposal that lines ⑨ and ⑩ refused ended DENIED. The claim keeps that
        // refusal with it, as it keeps a refusal of the code, and runs no work (step 24's README,
        // decision 6).
        if (opened?.refused !== undefined) {
          const refused = keptText(keptOf(opened.refused));
          await keepAnswer(
            client,
            ids,
            `{"refused":${refused},"proposal":${keptText(opened.proposal)},"denied":true}`,
          );
          return { refused: opened.refused, proposal: opened.proposal, denied: true as const };
        }
        // A proposal that a control stopped waits for its approval, in every mode,
        // and the work never runs. The claim keeps what it waits for, so a replay gives the same
        // answer (step 27's README, decision D10).
        if (opened?.pending !== undefined) {
          const pending = keptText(opened.pending);
          await keepAnswer(
            client,
            ids,
            `{"pending":${pending},"proposal":${keptText(opened.proposal)}}`,
          );
          return { pending: opened.pending, proposal: opened.proposal };
        }
        // In propose_only mode the proposal waits READY, and the work never runs.
        // The claim keeps that as its answer, so a replay names the same waiting proposal (step
        // 23's README, decision 12).
        if (mode === "propose_only") {
          if (proposal === undefined) throw new Error("a propose_only claim made no proposal");
          await keepAnswer(client, ids, `{"ready":true,"proposal":${keptText(proposal)}}`);
          return { ready: true as const, proposal };
        }
        // The work runs inside a savepoint, so a refusal can undo the work and keep the claim.
        await client.query("SAVEPOINT work");
        let outcome: Ended;
        try {
          outcome = { value: await work(stores) };
        } catch (thrown) {
          // An accident is thrown on, and inCompany rolls back everything: the claim goes too.
          if (!isOutcome(thrown)) throw thrown;
          await client.query("ROLLBACK TO SAVEPOINT work");
          outcome = { refused: thrown };
        }
        // The proposal's last move, after the savepoint, so a refusal's FAILED
        // and its record are kept with the claim.
        if (steps !== undefined && proposal !== undefined) {
          await steps.close(stores, proposal, outcome);
        }
        // Checked before the UPDATE, so a value that JSON cannot keep rolls the claim back, as
        // it does in memory. Found by the review: JSON wrote it as {}, and every retry failed.
        // With the proposal's URI, so a replay names it.
        const named = proposal === undefined ? "" : `,"proposal":${keptText(proposal)}`;
        const text =
          "value" in outcome
            ? `{"value":${keptText(outcome.value)}${named}}`
            : `{"refused":${keptText(keptOf(outcome.refused))}${named}}`;
        await keepAnswer(client, ids, text);
        return proposal === undefined ? outcome : { ...outcome, proposal };
      });
      // The conflict is refused after the transaction ends, which only read, and committed. So
      // the connection goes back to the pool. Found by the review: a refusal thrown inside
      // closed a working connection, and any caller could make DSoR open a new one every time.
      // A key sent again in another mode is a conflict too (step 23's README,
      // decision 4).
      if ("conflict" in claimed) {
        if (claimed.conflict === "request") throw usedForAnother(scope.operation);
        throw usedInAnotherMode(scope.operation, claimed.first);
      }
      return claimed;
    },
  });
}

// The answer of a claim, written once, as JSON text.
// Its own function, now that a propose_only claim writes one too.
async function keepAnswer(client: pg.PoolClient, ids: string[], text: string): Promise<void> {
  // json, not jsonb: json keeps the text as written, so a replay's fields come in the first
  // answer's order (step 20's README, decision 12).
  const { rowCount } = await client.query(
    `UPDATE dsor.idempotency SET answer = $5::json WHERE ${IN_SCOPE}`,
    [...ids, text],
  );
  // A rule or a trigger could keep no answer, and a replay would find none.
  if (rowCount !== 1) throw new Error(`the claim kept ${rowCount ?? 0} answers, not 1`);
}

// The stores for a claim's work, inside its transaction.
// The proposals too, so line ⑧ writes inside the claim's transaction.
function storesIn(
  client: pg.PoolClient,
  tenant: string,
  controls: ControlStore | "database",
): WorkStores {
  const run = inClaim(client, tenant);
  return {
    invoices: invoicesThrough(run),
    payments: paymentsThrough(run),
    proposals: proposalsThrough(run),
    // And the reservations, so line ⑩ reserves inside the claim's transaction.
    reservations: reservationsThrough(run),
    // And the slips, so DSoR's own work tears one up inside the claim's
    // transaction (step 25's README, decision D2).
    slips: slipsThrough(run),
    // And the brakes, so the check after line ⑧ takes the brake's lock inside
    // the claim's transaction, and DSoR's own work pulls and lifts there (step 25b's README,
    // decisions L8 and D1).
    brakes: brakesThrough(run),
    // And the sheets of rates, so line ⑩ converts with the rates of the claim's
    // own transaction, and rate.load writes a sheet there (step 26's README, decisions L1 and L2).
    rates: ratesThrough(run),
    // NEW IN STEP 36: and the intent records, written inside the claim's transaction, which the
    //   checkpoint then commits (step 36's README, decision D2).
    intents: intentsThrough(run),
    // The claim, its proposal at EXECUTING, the code's reads so far, and the note commit here,
    //   before the bank is asked. A crash after this leaves all four behind, and the note says
    //   what was about to happen. The work goes on in a new transaction, in the same company,
    //   inside a new savepoint, so a refusal still undoes the code's later writes and keeps the
    //   claim (DSOR-EXE-03a, DSOR-EXE-04b; decision D2).
    checkpoint: async () => {
      const committed = await client.query("COMMIT");
      if (committed.command !== "COMMIT") throw new Error("the note was rolled back");
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SELECT set_config('dsor.tenant_id', $1, true)", [tenant]);
      await client.query("SAVEPOINT work");
    },
    // And the company's rules, so line ⑩ reads them and DSoR's own work changes
    // one inside the claim's transaction, with its record (step 28's README, decisions D14 and
    // D15).
    controls: controls === "database" ? controlsThrough(run) : controls,
  };
}

// NEW IN STEP 36: the intent records, in dsor.intents (step 36's README, decisions D1 to D3).
/** The intent records, written to and read from dsor.intents, one company at a time. */
export function createDbIntents(pool: pg.Pool): IntentStore {
  return intentsThrough(onPool(pool));
}

// One note as pg gives it back.
type IntentRow = {
  proposal_id: string;
  tenant_id: string;
  operation: string;
  payload_hash: string;
  principal: string;
  claim_operation: string;
  idempotency_key: string;
  connector: string;
  security_context: Record<string, unknown>;
  written_at: Date;
  outcome: IntentOutcome | null;
  ended_at: Date | null;
};

const INTENT_COLUMNS =
  "proposal_id, tenant_id, operation, payload_hash, principal, claim_operation, idempotency_key, connector, security_context, written_at, outcome, ended_at";

function intentOf(row: IntentRow): KeptIntent {
  const { written_at, outcome, ended_at, ...rest } = row;
  return {
    ...rest,
    written_at: written_at.toISOString(),
    ...(outcome === null ? {} : { outcome }),
    ...(ended_at === null ? {} : { ended_at: ended_at.toISOString() }),
  };
}

// The same statements, through a runner: on the pool, or inside a claim.
function intentsThrough(run: Runner): IntentStore {
  return {
    write: async (tenant, intent) =>
      run(tenant, async (client) => {
        await client.query(
          `INSERT INTO dsor.intents (proposal_id, tenant_id, operation, payload_hash, principal,
                                     claim_operation, idempotency_key, connector, security_context)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
          [
            intent.proposal_id,
            tenant,
            intent.operation,
            intent.payload_hash,
            intent.principal,
            intent.claim_operation,
            intent.idempotency_key,
            intent.connector,
            JSON.stringify(intent.security_context),
          ],
        );
      }),
    end: async (tenant, proposalId, outcome) =>
      run(tenant, async (client) => {
        const { rowCount } = await client.query(
          "UPDATE dsor.intents SET outcome = $3 WHERE tenant_id = $1 AND proposal_id = $2",
          [tenant, proposalId, outcome],
        );
        if (rowCount !== 1) throw new Error(`proposal ${proposalId} has no note to end`);
      }),
    get: async (tenant, proposalId) =>
      run(tenant, async (client) => {
        const { rows } = await client.query<IntentRow>(
          `SELECT ${INTENT_COLUMNS} FROM dsor.intents WHERE tenant_id = $1 AND proposal_id = $2`,
          [tenant, proposalId],
        );
        return rows[0] === undefined ? undefined : intentOf(rows[0]);
      }),
    forClaim: async (tenant, principal, operation, idempotencyKey) =>
      run(tenant, async (client) => {
        const { rows } = await client.query<IntentRow>(
          `SELECT ${INTENT_COLUMNS} FROM dsor.intents
            WHERE tenant_id = $1 AND principal = $2 AND claim_operation = $3
              AND idempotency_key = $4`,
          [tenant, principal, operation, idempotencyKey],
        );
        return rows[0] === undefined ? undefined : intentOf(rows[0]);
      }),
    open: async (tenant) =>
      run(tenant, async (client) => {
        const { rows } = await client.query<IntentRow>(
          `SELECT ${INTENT_COLUMNS} FROM dsor.intents
            WHERE tenant_id = $1 AND outcome IS NULL ORDER BY written_at`,
          [tenant],
        );
        return rows.map(intentOf);
      }),
  };
}

// NEW IN STEP 36: the sweep at start-up. A note with no outcome is OUTCOME_UNKNOWN (DSOR-EXE-04b).
//   For each one, in one transaction: its proposal moves from EXECUTING to OUTCOME_UNKNOWN with
//   its record, its claim keeps OUTCOME_UNKNOWN as its answer, and the note ends outcome_unknown.
//   The money may have left, so nothing is undone and nothing is sent again: finding out is a
//   reconciliation, step 37's (decision D4). It must run before this program takes calls, and
//   while no other program on this database takes them: a note of a call still running looks
//   the same as a note left by a crash. Open question 150.
/** Ends every note with no outcome as OUTCOME_UNKNOWN, for these companies. How many it ended. */
export async function sweepIntents(pool: pg.Pool, tenants: Iterable<string>): Promise<number> {
  let ended = 0;
  for (const tenant of tenants) {
    for (const note of await createDbIntents(pool).open(tenant)) {
      await inCompany(pool, tenant, async (client) => {
        const run = inClaim(client, tenant);
        const proposals = proposalsThrough(run);
        const id = note.proposal_id;
        const proposal = await proposals.get(tenant, id);
        if (proposal === undefined)
          throw new Error(`a note names proposal ${id}, which is not kept`);
        const unknown = unknownFromNote();
        if (proposal.state === "EXECUTING") {
          const by: MoveBy = {
            mover: dsorMover(proposal.requester),
            cause: `the outcome is unknown: ${unknown.message}`,
            correlation: { request_id: `req_${randomUUID()}` },
          };
          if (!(await proposals.move(tenant, id, "EXECUTING", "OUTCOME_UNKNOWN", by))) {
            throw new Error(`proposal ${id} moved while the sweep moved it`);
          }
        }
        const answer = `{"refused":${keptText(keptOf(unknown))},"proposal":${keptText(proposalUri(tenant, id))}}`;
        await client.query(
          `UPDATE dsor.idempotency SET answer = $5::json
            WHERE ${IN_SCOPE} AND answer IS NULL`,
          [tenant, note.principal, note.claim_operation, note.idempotency_key, answer],
        );
        await intentsThrough(run).end(tenant, id, "outcome_unknown");
      });
      ended += 1;
    }
  }
  return ended;
}

// Each company's sheets of rates, in dsor.rates (step 26's README, decisions L1,
// D2 to D6, and D9).
/** The sheets of rates, read from and written to dsor.rates, one company at a time. */
export function createDbRates(pool: pg.Pool): RateStore {
  return ratesThrough(onPool(pool));
}

// One row of a sheet, as pg gives it back. per_base comes back as text, as it was written.
type RateRow = {
  published_at: Date;
  base: string;
  currency: string;
  per_base: string;
  fresh: boolean;
};

function ratesThrough(run: Runner): RateStore {
  return Object.freeze({
    // The newest sheet of the source: every row at its latest time. DSoR's own WHERE, the company
    // first, with row-level security behind it (DSOR-TEN-01b). Its age by the database's clock,
    // in milliseconds, so a day is 24 hours wherever the server is (decision D5; step 25c's
    // review, finding L6).
    newest: async (tenant: string, source: string, maxAgeMs: number) =>
      run(tenant, async (client): Promise<Newest | undefined> => {
        const { rows } = await client.query<RateRow>(
          `SELECT published_at, base, currency, per_base::text AS per_base,
                  published_at >= now() - $3::bigint * interval '1 millisecond' AS fresh
             FROM dsor.rates
            WHERE tenant_id = $1 AND source = $2
              AND published_at = (SELECT max(published_at) FROM dsor.rates
                                   WHERE tenant_id = $1 AND source = $2)
            ORDER BY currency`,
          [tenant, source, maxAgeMs],
        );
        if (rows.length === 0) return undefined;
        const first = rows[0]!;
        const sheet: RateSheet = {
          source,
          base: first.base,
          published_at: first.published_at.toISOString(),
          rates: Object.fromEntries(rows.map((row) => [row.currency, row.per_base])),
        };
        return { sheet, fresh: first.fresh };
      }),
    // What a load would do, writing nothing, by the database's clock: line ⑨ asks before any work.
    // DSoR's own WHERE, the company first (step 26's README, decision D16).
    wouldLoad: async (tenant: string, source: string, published_at: string) =>
      run(tenant, async (client): Promise<Loaded> => {
        const { rows } = await client.query<{ future: boolean; found: boolean }>(
          `SELECT $3::timestamptz > now() AS future,
                  EXISTS (SELECT 1 FROM dsor.rates
                           WHERE tenant_id = $1 AND source = $2
                             AND published_at = $3::timestamptz) AS found`,
          [tenant, source, published_at],
        );
        return rows[0]!.future ? "future" : rows[0]!.found ? "exists" : "loaded";
      }),
    // A sheet, written once, with its base's own row at 1, in one statement. A time after the
    // database's clock is refused first (decisions D5, D6, and D9).
    load: async (tenant: string, sheet: RateSheet) =>
      run(tenant, async (client): Promise<Loaded> => {
        const { rows } = await client.query<{ future: boolean }>(
          "SELECT $1::timestamptz > now() AS future",
          [sheet.published_at],
        );
        if (rows[0]!.future) return "future";
        const lines = [[sheet.base, "1"], ...Object.entries(sheet.rates)];
        // A sheet of that source and time meets the first one's base row, and nothing is written.
        await client.query("SAVEPOINT load");
        try {
          await client.query(
            `INSERT INTO dsor.rates (tenant_id, source, published_at, base, currency, per_base)
             SELECT $1, $2, $3, $4, line.currency, line.per_base::numeric
               FROM unnest($5::text[], $6::text[]) AS line(currency, per_base)`,
            [
              tenant,
              sheet.source,
              sheet.published_at,
              sheet.base,
              lines.map(([currency]) => currency),
              lines.map(([, rate]) => rate),
            ],
          );
        } catch (thrown) {
          await client.query("ROLLBACK TO SAVEPOINT load");
          if ((thrown as { code?: string }).code === "23505") return "exists";
          throw thrown;
        }
        await client.query("RELEASE SAVEPOINT load");
        return "loaded";
      }),
  });
}

// Each company's rules, in dsor.controls: every version, its status, and the
// rule's text as its draft wrote it (step 28's README, decisions D2 to D4, D14, and D15).
/** The rules, read from and written to dsor.controls, each piece in a transaction of its own. */
export function createDbControls(pool: pg.Pool): ControlStore {
  return controlsThrough(onPool(pool));
}

// One version's row, as pg gives it back.
type ControlRow = {
  id: string;
  version: number;
  status: string;
  rule: Record<string, unknown>;
  compiled_by: string;
  reviewed_by: string | null;
  effective_from: Date | null;
};
const CONTROL_COLUMNS = "id, version, status, rule, compiled_by, reviewed_by, effective_from";

// And DSoR's mark on a stale version, which only line ⑩'s read and the sweep's
// get (step 28b's README, decision D5).
type MarkRow = { stale_since: Date | null; in_force: PolicyInForce | null };

// A rule's lock is a PostgreSQL advisory lock, as a brake's is: one number for each rule of each
// company, made from this text. A change takes it alone, until its transaction ends, so two
// changes to one rule wait for each other (step 28's README, decision D15).
function ruleKey(tenant: string, id: string): string {
  return `dsor.rule/${tenant}/${id}`;
}

/** A version in the shape control.schema.json gives it, from its row. */
function versionOf(row: ControlRow): Control {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    ...(row.rule as Omit<Control, "id" | "version" | "status">),
    compiled_by: row.compiled_by,
    ...(row.reviewed_by === null ? {} : { reviewed_by: row.reviewed_by }),
    ...(row.effective_from === null ? {} : { effective_from: writable(row.effective_from) }),
  };
}

function controlsThrough(run: Runner): ControlStore {
  // DSoR's own WHERE, the company first, with row-level security behind it (DSOR-TEN-01b).
  const versions = async (tenant: string, id?: string): Promise<Control[]> =>
    run(tenant, async (client) => {
      const { rows } = await client.query<ControlRow>(
        `SELECT ${CONTROL_COLUMNS} FROM dsor.controls
          WHERE tenant_id = $1 AND ($2::text IS NULL OR id = $2::text) ORDER BY id, version`,
        [tenant, id ?? null],
      );
      return rows.map(versionOf);
    });
  return Object.freeze({
    where: "dsor.controls",
    // The versions in force, active and stale, in one read, each stale one with
    // its mark, on one operation or on every one (step 28b's README, decision D7).
    inForce: async (tenant: string, operation?: string): Promise<InForce[]> =>
      run(tenant, async (client) => {
        const { rows } = await client.query<ControlRow & MarkRow>(
          `SELECT ${CONTROL_COLUMNS}, stale_since, in_force FROM dsor.controls
            WHERE tenant_id = $1 AND status IN ('active', 'stale_authority')
              AND ($2::text IS NULL OR rule->>'operation' = $2::text)
            ORDER BY id, version`,
          [tenant, operation ?? null],
        );
        return rows.map((row): InForce => {
          const version = versionOf(row);
          if (row.status !== "stale_authority") return version;
          // The database keeps a stale version's mark: controls_stale_marked. Should a row ever
          // have none, line ⑩ refuses, and never reads it as active. Found by step 28b's review,
          // finding L2.
          const since = row.stale_since === null ? undefined : writable(row.stale_since);
          if (since === undefined || row.in_force === null) {
            throw new Error(`version ${row.version} of ${row.id} has no mark`);
          }
          return { ...version, stale: { since, in_force: row.in_force } };
        });
      }),
    versions,
    // The rule's lock first, alone, until the transaction ends. Then its versions.
    hold: async (tenant: string, id: string): Promise<Control[]> =>
      run(tenant, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          ruleKey(tenant, id),
        ]);
        const { rows } = await client.query<ControlRow>(
          `SELECT ${CONTROL_COLUMNS} FROM dsor.controls
            WHERE tenant_id = $1 AND id = $2 ORDER BY version`,
          [tenant, id],
        );
        return rows.map(versionOf);
      }),
    // The draft and its record, in one transaction: both, or neither. The six fields the row
    // keeps in columns of its own leave the rule's text.
    add: async (tenant: string, draft: Control, by: RuleBy): Promise<void> =>
      run(tenant, async (client) => {
        // A draft names no reviewer and no time, and the row keeps neither in its text.
        const { id, version, status, compiled_by, ...kept } = draft;
        const { reviewed_by: _reviewer, effective_from: _from, ...rule } = kept;
        await client.query(
          `INSERT INTO dsor.controls (tenant_id, id, version, status, rule, compiled_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenant, id, version, status, rule, compiled_by ?? null],
        );
        await recordRuleChange(
          client,
          controlChangeOf(tenant, id, version, undefined, "draft", by),
        );
      }),
    // The switch-on in one step, under a savepoint inside the transaction: the live version
    // retired, and this one switched on, by the database's own clock, each with its record, or
    // nothing (step 28's README, decisions D4 and D15; step 28's review, finding H1).
    switchOn: async (
      tenant: string,
      id: string,
      version: number,
      from: RuleStatus,
      live: Live | undefined,
      by: RuleBy,
    ): Promise<boolean> => {
      if (!movable(from, "active")) return false;
      return run(tenant, async (client) => {
        await client.query("SAVEPOINT switch_on");
        const undo = async (): Promise<false> => {
          await client.query("ROLLBACK TO SAVEPOINT switch_on");
          return false;
        };
        try {
          if (live !== undefined) {
            const retired = await client.query(
              `UPDATE dsor.controls SET status = 'retired'
                WHERE tenant_id = $1 AND id = $2 AND version = $3 AND status = $4`,
              [tenant, id, live.version, live.from],
            );
            if (retired.rowCount !== 1) return await undo();
            const record = controlChangeOf(tenant, id, live.version, live.from, "retired", by);
            await recordRuleChange(client, record);
          }
          const on = await client.query(
            `UPDATE dsor.controls
                SET status = 'active', reviewed_by = $5, effective_from = clock_timestamp()
              WHERE tenant_id = $1 AND id = $2 AND version = $3 AND status = $4`,
            [tenant, id, version, from, by.person],
          );
          if (on.rowCount !== 1) return await undo();
          await recordRuleChange(client, controlChangeOf(tenant, id, version, from, "active", by));
        } catch (thrown) {
          await client.query("ROLLBACK TO SAVEPOINT switch_on");
          // Another live version took the index's place meanwhile: nothing was switched on.
          if ((thrown as { code?: string }).code === "23505") return false;
          throw thrown;
        }
        await client.query("RELEASE SAVEPOINT switch_on");
        return true;
      });
    },
    // The move and its record, in one transaction: both, or neither. Only from the status the
    // version is in now. A version switched on names the person as its reviewer, and the
    // database's own time.
    move: async (
      tenant: string,
      id: string,
      version: number,
      from: RuleStatus,
      to: RuleStatus,
      by: RuleBy,
    ): Promise<boolean> => {
      if (!movable(from, to)) return false;
      return run(tenant, async (client) => {
        const { rowCount } = await client.query(
          `UPDATE dsor.controls
              SET status = $5,
                  reviewed_by = CASE WHEN $5 = 'active' THEN $6 ELSE reviewed_by END,
                  effective_from = CASE WHEN $5 = 'active' THEN clock_timestamp()
                                        ELSE effective_from END
            WHERE tenant_id = $1 AND id = $2 AND version = $3 AND status = $4`,
          [tenant, id, version, from, to, by.person],
        );
        if (rowCount === 0) return false;
        if (rowCount !== 1) throw new Error(`one move changed ${rowCount ?? 0} versions, not 1`);
        await recordRuleChange(client, controlChangeOf(tenant, id, version, from, to, by));
        return true;
      });
    },
    // The sweep's mark, its record, and the notice to the version's owner, in
    // one transaction: all, or none. Only from what the sweep saw: active, or stale with the
    // version in force it saw, and only to another version in force. The database's trigger
    // writes the time of a first mark, by its own clock (step 28b's README, decisions D5 and D6).
    mark: async (
      tenant: string,
      id: string,
      version: number,
      seen: StaleMark | undefined,
      in_force: PolicyInForce,
      by: RuleBy,
      words: string,
    ): Promise<boolean> =>
      run(tenant, async (client) => {
        const { rows } = await client.query<{ owner: string }>(
          `UPDATE dsor.controls SET status = 'stale_authority', in_force = $5::jsonb
            WHERE tenant_id = $1 AND id = $2 AND version = $3
              AND (($4::jsonb IS NULL AND status = 'active')
                OR (status = 'stale_authority' AND in_force = $4::jsonb
                    AND in_force IS DISTINCT FROM $5::jsonb))
            RETURNING rule->>'owner' AS owner`,
          [tenant, id, version, seen === undefined ? null : seen.in_force, in_force],
        );
        if (rows.length === 0) return false;
        if (rows.length !== 1) throw new Error(`one mark changed ${rows.length} versions, not 1`);
        const from = seen === undefined ? "active" : "stale_authority";
        const record = controlChangeOf(tenant, id, version, from, "stale_authority", by, in_force);
        await recordRuleChange(client, record);
        const { rowCount } = await client.query(
          `INSERT INTO dsor.notices
             (notice_id, tenant_id, to_person, rule_id, version, words, correlation)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [`ntc_${randomUUID()}`, tenant, rows[0]!.owner, id, version, words, by.correlation],
        );
        if (rowCount !== 1) throw new Error(`the notices kept ${rowCount ?? 0} rows, not 1`);
        return true;
      }),
  });
}

// One change to a rule, in the log, inside the change's own transaction, with the rule in
// resources and its version under extensions (step 28's README, decision D14).
async function recordRuleChange(client: pg.PoolClient, record: ControlChange): Promise<void> {
  const { rowCount } = await client.query(
    `INSERT INTO dsor.audit
       (record_id, kind, result, reason, correlation, tenant, identity, resources, extensions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      `aud_${randomUUID()}`,
      record.kind,
      record.result,
      record.reason,
      record.correlation,
      record.tenant,
      record.identity,
      record.resources,
      record.extensions,
    ],
  );
  // As for the log's own INSERT: a record is kept only when one row was written.
  if (rowCount !== 1) throw new Error(`the log kept ${rowCount ?? 0} rows, not 1`);
}

// The day's totals and the reservations, in dsor.limit_counters and
// dsor.reservations. The day is the database's own: today, in UTC, at the start of the
// transaction (step 24's README, decisions 3 to 5 and 13).
const TODAY = "(now() AT TIME ZONE 'UTC')::date";

/** The reservations, in dsor.reservations, each piece in a transaction of its own. */
export function createDbReservations(pool: pg.Pool): ReservationStore {
  return reservationsThrough(onPool(pool));
}

// One reservation's row, as pg gives it back.
type ReservationRow = {
  tenant_id: string;
  proposal_id: string;
  delegation: string;
  day: string;
  amount_value: string;
  amount_currency: string;
  state: Reservation["state"];
};

/** True when both amounts can be compared: readable, and in one currency. */
function comparable(amount: { value: string; currency: string }, limit: typeof amount): boolean {
  const readable = millionths(amount.value) !== undefined && millionths(limit.value) !== undefined;
  return readable && amount.currency === limit.currency;
}

function reservationsThrough(run: Runner): ReservationStore {
  return Object.freeze({
    reserve: async (tenant, proposal, delegation, amount, limit) =>
      run(tenant, async (client) => {
        // An amount that cannot be compared fits no limit (step 24's README, decision 11).
        if (!comparable(amount, limit)) return false;
        // Both rows or neither: the reservation, keyed by the proposal, and the day's total.
        await client.query("SAVEPOINT reserve");
        const added = await client.query(
          `INSERT INTO dsor.reservations
             (tenant_id, proposal_id, delegation, day, amount_value, amount_currency, state)
           VALUES ($1, $2, $3, ${TODAY}, $4, $5, 'held')
           ON CONFLICT (tenant_id, proposal_id) DO NOTHING`,
          [tenant, proposal, delegation, amount.value, amount.currency],
        );
        // A proposal that reserved already adds nothing more (DSOR-DEL-06b).
        if (added.rowCount === 0) {
          await client.query("RELEASE SAVEPOINT reserve");
          return true;
        }
        // The last hotel room, in one statement: the day's total grows only while it stays within
        // the limit. A second request at the same moment waits on the row, then checks again with
        // the first one's amount in it. Never "read, check, then write" (DSOR-DEL-06a; §13.4,
        // "Common mistake").
        const { rows } = await client.query(
          `INSERT INTO dsor.limit_counters (tenant_id, delegation, day, currency, used)
             SELECT $1, $2, ${TODAY}, $3, $4::numeric WHERE $4::numeric <= $5::numeric
           ON CONFLICT (tenant_id, delegation, day, currency)
           DO UPDATE SET used = dsor.limit_counters.used + EXCLUDED.used
             WHERE dsor.limit_counters.used + EXCLUDED.used <= $5::numeric
           RETURNING used`,
          [tenant, delegation, amount.currency, amount.value, limit.value],
        );
        if (rows.length === 0) {
          await client.query("ROLLBACK TO SAVEPOINT reserve");
          return false;
        }
        await client.query("RELEASE SAVEPOINT reserve");
        return true;
      }),
    fits: async (tenant, delegation, amount, limit) =>
      run(tenant, async (client) => {
        if (!comparable(amount, limit)) return false;
        const { rows } = await client.query<{ fits: boolean }>(
          `SELECT coalesce((SELECT used FROM dsor.limit_counters
                             WHERE tenant_id = $1 AND delegation = $2 AND day = ${TODAY}
                               AND currency = $3), 0) + $4::numeric <= $5::numeric AS fits`,
          [tenant, delegation, amount.currency, amount.value, limit.value],
        );
        return rows[0]!.fits;
      }),
    commit: async (tenant, proposal) =>
      run(tenant, async (client) => {
        await client.query(
          `UPDATE dsor.reservations SET state = 'committed'
            WHERE tenant_id = $1 AND proposal_id = $2 AND state = 'held'`,
          [tenant, proposal],
        );
      }),
    release: async (tenant, proposal) =>
      run(tenant, async (client) => {
        const { rows } = await client.query<ReservationRow>(
          `UPDATE dsor.reservations SET state = 'released'
            WHERE tenant_id = $1 AND proposal_id = $2 AND state = 'held'
            RETURNING delegation, day, amount_value, amount_currency`,
          [tenant, proposal],
        );
        if (rows.length === 0) return;
        const { delegation, day, amount_value, amount_currency } = rows[0]!;
        // The day gets the amount back, in the same transaction as the release.
        const { rowCount } = await client.query(
          `UPDATE dsor.limit_counters SET used = used - $5::numeric
            WHERE tenant_id = $1 AND delegation = $2 AND day = $3 AND currency = $4`,
          [tenant, delegation, day, amount_currency, amount_value],
        );
        if (rowCount !== 1)
          throw new Error(`a release gave back to ${rowCount ?? 0} totals, not 1`);
      }),
    get: async (tenant, proposal) =>
      run(tenant, async (client) => {
        const { rows } = await client.query<ReservationRow>(
          `SELECT proposal_id, delegation, day::text AS day, amount_value::text AS amount_value,
                  amount_currency, state
             FROM dsor.reservations WHERE tenant_id = $1 AND proposal_id = $2`,
          [tenant, proposal],
        );
        if (rows.length === 0) return undefined;
        const row = rows[0]!;
        return {
          tenant,
          proposal: row.proposal_id,
          delegation: row.delegation,
          day: row.day,
          amount: { value: row.amount_value, currency: row.amount_currency },
          state: row.state,
        };
      }),
  });
}

// The key was claimed first by another request, which has committed. Same fingerprint: its
// outcome, without running anything. A different one: a conflict, which the caller refuses
// with IDEMPOTENCY_CONFLICT (DSOR-IDM-01c, DSOR-IDM-01d; decision 7).
// And then the mode, so the same request in another mode is a conflict too, which
// names the first call's mode (step 23's README, decision 4).
async function replay(
  client: pg.PoolClient,
  ids: string[],
  payloadHash: string,
  mode: ProposalMode,
): Promise<Claimed | { conflict: "request" } | { conflict: "mode"; first: ProposalMode }> {
  const { rows } = await client.query<ClaimRow>(
    `SELECT payload_hash, mode, request_id, answer, answer IS NULL AS unanswered
       FROM dsor.idempotency WHERE ${IN_SCOPE}`,
    ids,
  );
  // The scope names one claim, so two rows mean the scope is broken, and DSoR never chooses
  // between two claims. A claim commits with its outcome, so a row with none is a bug too.
  // Found by the review: with no company in the WHERE, the owner's replay read two rows.
  if (rows.length !== 1) throw new Error(`the scope names ${rows.length} claims, not 1`);
  const found = rows[0]!;
  // NEW IN STEP 36: a claim with no outcome that wrote a note was committed with it, before
  //   the bank was asked, and has not ended: it is still running, or it crashed. Either way
  //   nobody knows whether the money left, so the answer is OUTCOME_UNKNOWN, never a second run
  //   (DSOR-EXE-04b; decision D4). A claim with no outcome and no note is still a bug.
  if (found.unanswered) {
    if (found.payload_hash !== payloadHash) return { conflict: "request" };
    const { rows: notes } = await client.query<{ proposal_id: string }>(
      `SELECT proposal_id FROM dsor.intents
        WHERE tenant_id = $1 AND principal = $2 AND claim_operation = $3 AND idempotency_key = $4`,
      ids,
    );
    if (notes[0] === undefined) throw new Error("a claim was found with no outcome");
    if (found.mode !== mode) return { conflict: "mode", first: found.mode };
    return {
      refused: unknownFromNote(),
      proposal: proposalUri(ids[0]!, notes[0].proposal_id),
      replay_of: found.request_id,
    };
  }
  if (found.payload_hash !== payloadHash) return { conflict: "request" };
  if (found.mode !== mode) return { conflict: "mode", first: found.mode };
  const kept = found.answer as {
    value?: unknown;
    refused?: unknown;
    ready?: unknown;
    pending?: unknown;
    proposal?: unknown;
    denied?: unknown;
  } | null;
  if (typeof kept !== "object" || kept === null) throw new Error("a claim holds no outcome");
  // The proposal the first call made, which the replay names (DSOR-IDM-04). It must
  // be a proposal of the claim's own company: a claim is DSoR's own record, and a bug or a change
  // by hand must not make a replay name another company's proposal. Found by step 22's sweep.
  if (kept.proposal !== undefined && !isProposalOf(ids[0]!, kept.proposal)) {
    throw new Error("a claim holds a proposal that is not one of its company's");
  }
  const named = kept.proposal === undefined ? {} : { proposal: kept.proposal };
  // The answer must fit the claim's mode: a waiting proposal in propose_only mode only,
  // and a value in execute mode only. A claim that holds another is a bug, or a change by hand,
  // and gives no answer. Found by step 23's review: an execute call heard a planted READY.
  // A refusal fits both modes, since lines ⑨ and ⑩ can deny a propose_only call.
  // Found by step 24's review: its replay gave INTERNAL_ERROR (decision 17).
  const proposing = found.mode === "propose_only";
  if (("ready" in kept && !proposing) || ("value" in kept && proposing)) {
    throw new Error("a claim holds an answer that does not fit its mode");
  }
  // A proposal that waits. Only true, and only with its proposal: anything else is
  // a bug, or a change by hand, and gives no answer.
  if ("ready" in kept) {
    if (kept.ready !== true || kept.proposal === undefined) {
      throw new Error("a claim holds a waiting proposal that is not one");
    }
    return { ready: true, ...named, replay_of: found.request_id };
  }
  // A proposal that waits for an approval, in either mode: what it requires, and
  // when it expires, as the first call kept them. Anything else gives no answer.
  if ("pending" in kept) {
    const pending = kept.pending as { requires?: unknown; expires_at?: unknown } | null;
    if (
      typeof pending !== "object" ||
      pending === null ||
      !Array.isArray(pending.requires) ||
      typeof pending.expires_at !== "string" ||
      kept.proposal === undefined
    ) {
      throw new Error("a claim holds a waiting proposal that is not one");
    }
    const waits: Pending = {
      requires: pending.requires as Pending["requires"],
      expires_at: pending.expires_at,
    };
    return { pending: waits, ...named, replay_of: found.request_id };
  }
  if ("value" in kept) return { value: kept.value, ...named, replay_of: found.request_id };
  // A refusal that lines ⑨ and ⑩ gave stays a denial in its replay's record.
  const denied = kept.denied === true ? { denied: true as const } : {};
  return { refused: refusalOf(kept.refused), ...named, ...denied, replay_of: found.request_id };
}

// Proposals, in dsor.proposals, and the record of each move, in dsor.audit,
// written in one transaction: both, or neither (DSOR-APR-01b; step 22's README,
// decisions 3, 4, and 6).
// One proposal's row, as pg gives it back.
type ProposalRow = {
  tenant_id: string;
  id: string;
  operation: string;
  mode: ProposalMode;
  state: State;
  payload: unknown;
  payload_hash: string;
  resources: string[];
  requester: Requester;
  idempotency_key: string;
  created_at: Date;
  // And its expiry.
  expires_at: Date;
  // And what it waits for, once it waits.
  requires: Requirement[] | null;
};

// One move's record, as pg gives it back.
type MoveRow = {
  at: Date;
  result: string;
  reason: string;
  identity: Mover;
  extensions: ProposalTransition["extensions"] | null;
};

/** The proposals, in dsor.proposals, each piece of work in a transaction of its own. */
export function createDbProposals(pool: pg.Pool): ProposalStore {
  return proposalsThrough(onPool(pool));
}

// One ending at a time in a company. A tear-up and a sweep each move many
// proposals, and give each one's booking back to the day's total, one after the other. Two at once
// could each hold what the other waits for: one a proposal, the other a day's total, and
// PostgreSQL would fail one of them. So each takes the company's ending lock, alone, before it
// lists its work, until its transaction ends. Found by step 25c's review (finding M1; step 25c's
// README, decision D13).
// And an approval takes it too, before it reads the proposal. A tear-up or a sweep
// that listed a proposal as PENDING_APPROVAL would otherwise find it APPROVED a moment later, and
// leave it so: its move starts from the state it listed (step 29's README, decision D9).
function endingKey(tenant: string): string {
  return `dsor.ending/${tenant}`;
}

function proposalsThrough(run: Runner): ProposalStore {
  return Object.freeze({
    create: async (
      tenant: string,
      id: string,
      draft: ProposalDraft,
      by: MoveBy,
      lifetime: string,
    ): Promise<void> =>
      run(tenant, async (client) => {
        if (by.cause.trim() === "") throw new Error("a move needs a cause");
        if (by.mover.subject.trim() === "") throw new Error("a move needs an actor");
        // A new proposal starts as PROPOSED, here and in the database's trigger. The request is
        // written as JSON text, and the database keeps it as it was checked.
        const { rowCount } = await client.query(
          // In the mode of its call (step 23's README, decision 13).
          // With its expiry, from the database's own clock and the company's
          // lifetime, in milliseconds, so P7D is 168 hours exactly, as in memory. PostgreSQL would
          // read "P7D" as 7 calendar days of the session's time zone: 167 or 169 hours where the
          // clocks change. Found by step 25c's review (finding L6). The table's CHECK keeps it
          // after created_at and within 720 hours of it (step 25c's README, decision D6).
          `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload, payload_hash,
                                       resources, requester, idempotency_key, expires_at,
                                       exclusive_over)
           VALUES ($1, $2, $3, $9, 'PROPOSED', $4::jsonb, $5, $6::text[], $7::jsonb, $8,
                   now() + $10::bigint * interval '1 millisecond', $11)`,
          [
            tenant,
            id,
            draft.operation,
            JSON.stringify(draft.payload),
            draft.payload_hash,
            draft.resources,
            JSON.stringify(draft.requester),
            draft.idempotency_key,
            draft.mode,
            millisecondsOf(lifetime),
            // The record its operation is exclusive over, or none: the key
            //   proposals_one_attempt reads it (migration 029; step 32's README, decision D7).
            draft.exclusive_over ?? null,
          ],
        );
        if (rowCount !== 1)
          throw new Error(`the proposal was added ${rowCount ?? 0} times, not once`);
        const uri = proposalUri(tenant, id);
        await recordMove(
          client,
          transitionOf(
            tenant,
            uri,
            draft.operation,
            undefined,
            "PROPOSED",
            by.mover,
            by.cause,
            by.correlation,
          ),
        );
      }),
    move: async (
      tenant: string,
      id: string,
      from: State,
      to: State,
      by: MoveBy,
      requires?: Requirement[],
    ): Promise<boolean> => {
      // DSoR's own guard first, before any statement. The trigger is the database's (decision 3).
      checkMove(from, to, by);
      // And what it waits for, on the move to PENDING_APPROVAL only.
      checkRequires(from, to, requires);
      return run(tenant, (client) => moveWith(client, tenant, id, from, to, by, requires));
    },
    get: async (tenant: string, id: string): Promise<Proposal | undefined> =>
      run(tenant, async (client) => {
        const { rows } = await client.query<ProposalRow>(
          `SELECT tenant_id, id, operation, mode, state, payload, payload_hash, resources, requester,
                  idempotency_key, created_at, expires_at, requires
             FROM dsor.proposals WHERE tenant_id = $1 AND id = $2`,
          [tenant, id],
        );
        if (rows.length === 0) return undefined;
        if (rows.length !== 1) throw new Error(`one id names ${rows.length} proposals, not 1`);
        // The history: the records of its moves, in the order the log kept them.
        const uri = proposalUri(tenant, id);
        const moves = await client.query<MoveRow>(
          `SELECT at, result, reason, identity, extensions FROM dsor.audit
            WHERE tenant = $1 AND kind = 'proposal_transition' AND resources = ARRAY[$2]::text[]
            ORDER BY sequence`,
          [tenant, uri],
        );
        // And the ids of its approvals, in the order they were given.
        const given = await approvalsIn(client, tenant, id);
        return proposalOf(
          rows[0]!,
          moves.rows,
          given.map((approval) => approval.id),
        );
      }),
    // The proposals made under one slip that still wait: the slip their requester names (step
    // 22's README, decision 11). DSoR's own WHERE, the company first, with row-level security
    // behind it (DSOR-TEN-01b). READY too (step 25c's README, claim C2). And
    // first the company's ending lock, as the sweep's list takes it (decision D13).
    waiting: async (tenant: string, delegation: string): Promise<Waiting[]> =>
      run(tenant, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          endingKey(tenant),
        ]);
        const { rows } = await client.query<Waiting>(
          `SELECT id, state FROM dsor.proposals
            WHERE tenant_id = $1 AND requester->>'delegation' = $2
              AND state IN ('PENDING_APPROVAL', 'APPROVED', 'READY')
            ORDER BY id`,
          [tenant, delegation],
        );
        return rows;
      }),
    // This company's READY proposals whose time has come, by the database's
    // clock. DSoR's own WHERE, the company first, with row-level security behind it (DSOR-TEN-01b;
    // step 25c's README, claim C4). And its PENDING_APPROVAL ones, with their
    // states (step 27's README, decision D11). And its APPROVED ones, whose
    // approvals expire with them (step 29's README, decision D11).
    due: async (tenant: string): Promise<Due[]> =>
      run(tenant, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          endingKey(tenant),
        ]);
        const { rows } = await client.query<Due>(
          `SELECT id, state FROM dsor.proposals
            WHERE tenant_id = $1 AND state IN ('READY', 'PENDING_APPROVAL', 'APPROVED')
              AND expires_at <= now()
            ORDER BY id`,
          [tenant],
        );
        return rows;
      }),
    // The approval's one step, inside one transaction: the claim's, on the call's
    // path. The company's ending lock first, which every mover of a waiting proposal takes: an
    // approval, a tear-up, and a sweep. So two approvals of one proposal run one after the other,
    // and the count sees every approval before it (step 29's README, decision D9). Found by the
    // step's own breaks: a lock of the proposal's row as well changed nothing, so there is none.
    approve: async (tenant: string, id: string, offer: Offer, by: MoveBy): Promise<Approving> => {
      checkMove("PENDING_APPROVAL", "APPROVED", by);
      return run(tenant, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          endingKey(tenant),
        ]);
        // DSoR's own WHERE, the company first, with row-level security behind it (DSOR-TEN-01b).
        const { rows } = await client.query<LockedRow>(
          `SELECT state, operation, resources, payload_hash, expires_at, requires,
                  expires_at <= clock_timestamp() AS due
             FROM dsor.proposals WHERE tenant_id = $1 AND id = $2`,
          [tenant, id],
        );
        // Found by the step's own breaks: with the company gone from this WHERE, row-level security
        // hid it. As get does, one id names one proposal, or the store has a bug.
        if (rows.length > 1) throw new Error(`one id names ${rows.length} proposals, not 1`);
        const row = rows[0];
        if (row === undefined) return { refused: "moved" };
        if (row.state !== "PENDING_APPROVAL") return { refused: "moved", state: row.state };
        // The move to PENDING_APPROVAL wrote it, and the trigger lets nothing clear it.
        if (row.requires === null) throw new Error("a waiting proposal names what it waits for");
        // Its time has come, by the database's clock, though no sweep has moved it yet. The clock as
        // it reads now, after the wait for the lock: now() is the time the transaction began. Found
        // by step 29's review, finding M1.
        if (row.due) return { refused: "expired" };
        const before = await approvalsIn(client, tenant, id);
        const { operation, resources, payload_hash, requires } = row;
        const uri = proposalUri(tenant, id);
        const expires_at = row.expires_at.toISOString();
        const bindable = { uri, tenant, operation, resources, payload_hash, expires_at, requires };
        const made = approvalOf(bindable, before, offer);
        if (typeof made === "string") return { refused: made };
        const added = await client.query(
          `INSERT INTO dsor.approvals (tenant_id, id, proposal_id, approver, approval)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [tenant, made.id, id, offer.approver, JSON.stringify(made)],
        );
        if (added.rowCount !== 1)
          throw new Error(`the approval was added ${added.rowCount ?? 0} times, not once`);
        const waits_for = stillOpen(requires, [...before, made]);
        if (waits_for.length > 0) return { approval: made, state: "PENDING_APPROVAL", waits_for };
        // The last one it waited for: the move, under the same lock, with its record.
        if (!(await moveWith(client, tenant, id, "PENDING_APPROVAL", "APPROVED", by))) {
          throw new Error("a locked proposal did not move");
        }
        return { approval: made, state: "APPROVED", waits_for };
      });
    },
    approvals: async (tenant: string, id: string): Promise<Approval[]> =>
      run(tenant, (client) => approvalsIn(client, tenant, id)),
    // The lock of one operation over one record, an advisory lock, as a slip's is,
    //   alone, until the transaction ends: the claim's, inside a claim (step 32's README, D7).
    holdOver: async (tenant: string, operation: string, uri: string): Promise<void> =>
      run(tenant, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          JSON.stringify(["exclusive", tenant, operation, uri]),
        ]);
      }),
    // The company's proposals in flight whose request names this record. DSoR's
    //   own WHERE, the company first, with row-level security behind it (DSOR-TEN-01b). Inside a
    //   claim, in the claim's transaction, after the record's lock (step 32's README, decision D7).
    inFlightOver: async (tenant: string, uri: string): Promise<InFlight[]> =>
      run(tenant, async (client) => {
        const { rows } = await client.query<InFlight>(
          `SELECT id, operation, state FROM dsor.proposals
            WHERE tenant_id = $1 AND $2 = ANY (resources) AND state = ANY ($3::text[])
            ORDER BY id`,
          [tenant, uri, IN_FLIGHT],
        );
        return rows;
      }),
    // By the database's clock as it reads now. DSoR's own WHERE, the company first, with row-level
    // security behind it (DSOR-TEN-01b).
    isDue: async (tenant: string, id: string): Promise<boolean> =>
      run(tenant, async (client) => {
        const { rows } = await client.query<{ due: boolean }>(
          `SELECT expires_at <= clock_timestamp() AS due FROM dsor.proposals
            WHERE tenant_id = $1 AND id = $2`,
          [tenant, id],
        );
        if (rows.length > 1) throw new Error(`one id names ${rows.length} proposals, not 1`);
        return rows[0]?.due === true;
      }),
  });
}

// A proposal's row, as the approval's step reads it under the ending lock.
type LockedRow = {
  state: State;
  operation: string;
  resources: string[];
  payload_hash: string;
  expires_at: Date;
  requires: Requirement[] | null;
  due: boolean;
};

/** One move of a proposal still in `from`, with its record, inside the caller's transaction. */
async function moveWith(
  client: pg.PoolClient,
  tenant: string,
  id: string,
  from: State,
  to: State,
  by: MoveBy,
  requires?: Requirement[],
): Promise<boolean> {
  // Only while it is still in `from`: the check and the write are one statement, so a second mover
  // that read the same state changes nothing (step 22's README, decision 6). DSoR's own WHERE, the
  // company first, with row-level security behind it (DSOR-TEN-01b).
  // And what it waits for, named only on the move that starts the wait (step 29's README, decision
  // D4).
  const named = requires === undefined ? "" : ", requires = $5::jsonb";
  const values: unknown[] = [tenant, id, to, from];
  if (requires !== undefined) values.push(JSON.stringify(requires));
  const { rows } = await client.query<{ operation: string }>(
    `UPDATE dsor.proposals SET state = $3${named}
      WHERE tenant_id = $1 AND id = $2 AND state = $4 RETURNING operation`,
    values,
  );
  if (rows.length === 0) return false;
  if (rows.length !== 1) throw new Error(`one move changed ${rows.length} proposals, not 1`);
  const uri = proposalUri(tenant, id);
  await recordMove(
    client,
    transitionOf(tenant, uri, rows[0]!.operation, from, to, by.mover, by.cause, by.correlation),
  );
  return true;
}

/** Every approval of one proposal, in the order they were given. */
async function approvalsIn(client: pg.PoolClient, tenant: string, id: string): Promise<Approval[]> {
  // DSoR's own WHERE, the company first, with row-level security behind it (DSOR-TEN-01b).
  const { rows } = await client.query<{ approval: Approval }>(
    `SELECT approval FROM dsor.approvals WHERE tenant_id = $1 AND proposal_id = $2
      ORDER BY given_at, id`,
    [tenant, id],
  );
  return rows.map((row) => row.approval);
}

// One move's record, in the log, inside the move's own transaction. As for every other record,
// it is kept only when one row was written: thrown inside the work, so the move rolls back too.
async function recordMove(client: pg.PoolClient, made: ProposalTransition): Promise<void> {
  const { rowCount } = await client.query(
    `INSERT INTO dsor.audit
       (record_id, kind, operation, result, reason, correlation, tenant, identity, resources,
        extensions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      `aud_${randomUUID()}`,
      made.kind,
      made.operation,
      made.result,
      made.reason,
      made.correlation,
      made.tenant,
      made.identity,
      made.resources,
      made.extensions ?? null,
    ],
  );
  if (rowCount !== 1) throw new Error(`the log kept ${rowCount ?? 0} rows, not 1`);
}

// A proposal in the specification's shape, with its history from the log.
// And the ids of its approvals.
function proposalOf(row: ProposalRow, moves: MoveRow[], approvals: string[]): Proposal {
  return {
    uri: proposalUri(row.tenant_id, row.id),
    tenant: row.tenant_id,
    operation: row.operation,
    mode: row.mode,
    state: row.state,
    // And what it waits for, once it waits.
    ...(row.requires === null ? {} : { requires: row.requires }),
    // And its approvals, once it has one.
    ...(approvals.length === 0 ? {} : { approvals }),
    payload: row.payload,
    payload_hash: row.payload_hash,
    resources: row.resources,
    requester: row.requester,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at.toISOString(),
    // And its expiry.
    expires_at: row.expires_at.toISOString(),
    transitions: moves.map((move) =>
      transitionFrom({
        result: move.result,
        reason: move.reason,
        identity: move.identity,
        ...(move.extensions === null ? {} : { extensions: move.extensions }),
        at: move.at.toISOString(),
      }),
    ),
  };
}
