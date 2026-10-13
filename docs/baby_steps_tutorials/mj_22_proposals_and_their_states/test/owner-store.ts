// The owner runs DSoR's own store. Not a test file: rls.db.test.ts starts
// it through ownerStore in test/db.ts.
// The owner holds BYPASSRLS, so no policy applies to it, and only DSoR's own WHERE can
// filter what the store returns. That tests the first lock alone (DSOR-TEN-01b; step 11's
// README, "What the specification asks", point 1). The key stays in this child, and what
// it prints is redacted first (step 09's README, decision 18).
// Run by the tests as:  node test/owner-store.ts
// Or as  node test/owner-store.ts list,  which lists org_456's invoices
// through the store instead (step 13's README, C7).
// Or as  node test/owner-store.ts payments,  which drafts a payment in
// org_456 and asks the payments store to cancel it inside org_789. Found by step 17's
// sweep: with tenant_id dropped from the cancel's SQL, every test stayed green, because
// the database's lock hid it.
// NEW IN STEP 22: or as  node test/owner-store.ts proposals,  which makes a proposal in org_456
// and asks the proposals store to read it and move it inside org_789. Found by step 22's sweep:
// with tenant_id dropped from the move's SQL, every test stayed green.
import {
  createDbInvoices,
  createDbLog,
  createDbPayments,
  createDbProposals,
  loadDotEnv,
  openPool,
  requireEnv,
} from "../src/postgres.ts";
import { redact } from "./db.ts";
import { randomUUID } from "node:crypto";
import type { MoveBy } from "../src/proposals.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = openPool(owner);
try {
  // Without BYPASSRLS, the policies would filter too, and the test would prove nothing.
  const { rows } = await pool.query(
    "SELECT rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user",
  );
  const invoices = createDbInvoices(pool);
  const bypassrls = rows[0]?.["bypassrls"] === true;
  let result: unknown;
  if (process.argv[2] === "payments") {
    const payments = createDbPayments(pool);
    const amount = { value: "31400.00", currency: "USD" };
    // On version 1 of INV-1008, which no test changes (step 21's README, decision 12).
    const drafted = await payments.create(
      "org_456",
      { invoice_id: "INV-1008", vendor_id: "VENDOR-44", amount },
      1,
    );
    if (!("payment" in drafted)) throw new Error("INV-1008 is not at version 1");
    const draft = drafted.payment;
    const crossCancel = await payments.cancel("org_789", draft.id, draft.version);
    const { rows: after } = await pool.query("SELECT status FROM app.payments WHERE id = $1", [
      draft.id,
    ]);
    result = { bypassrls, crossCancel, statusAfter: after[0]?.["status"] ?? null };
  } else if (process.argv[2] === "proposals") {
    const proposals = createDbProposals(pool);
    const id = `prop_${randomUUID()}`;
    const authority = { source: "token" as const, as_of: new Date().toISOString() };
    const by = (subject: string): MoveBy => ({
      mover: { mode: "direct", subject, actor_chain: [], subject_authority: authority },
      cause: "the owner's test of DSoR's own lock",
      correlation: { request_id: "req_owner_store", principal_id: "user_123" },
    });
    await proposals.create(
      "org_456",
      id,
      {
        operation: "payment.create@1",
        payload: { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 },
        payload_hash: `sha256:${"e".repeat(64)}`,
        resources: ["dsor://org_456/invoice/INV-1008"],
        requester: {
          identity_mode: "direct",
          subject: "user_123",
          subject_type: "human",
          actor_chain: [],
          active_tenant: "org_456",
          subject_authority: authority,
        },
        idempotency_key: "k-owner-store",
      },
      by("user_123"),
    );
    // A record of org_789 that names org_456's proposal, as a bug could write: the history of
    // org_456's proposal leaves it out. Found by the second sweep.
    await pool.query(
      `INSERT INTO dsor.audit (record_id, kind, operation, result, reason, correlation, tenant, resources)
       VALUES ($1, 'proposal_transition', 'payment.create@1', 'COMMITTED', 'forged', '{}', 'org_789', $2)`,
      [`aud_${randomUUID()}`, [`dsor://org_456/proposal/${id}`]],
    );
    const history =
      (await proposals.get("org_456", id))?.transitions.map((move) => move.to) ?? null;
    const crossGet = (await proposals.get("org_789", id)) ?? null;
    const crossMove = await proposals.move("org_789", id, "PROPOSED", "READY", by("dsor"));
    const { rows: after } = await pool.query("SELECT state FROM dsor.proposals WHERE id = $1", [
      id,
    ]);
    result = { bypassrls, history, crossGet, crossMove, stateAfter: after[0]?.["state"] ?? null };
  } else if (process.argv[2] === "list") {
    // Page after page, five rows at a time, so the SQL after a cursor runs too. Found by the
    // review: one read of every row never ran it (step 13's README, C7). Both companies, so
    // a lister that kept only org_456's rows would be seen. Found by the sweep.
    const listed: Record<string, string[]> = {};
    for (const company of ["org_456", "org_789"]) {
      const ids: string[] = [];
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        // The store gives the rows beside its read's label.
        const { rows } = await invoices.list(company, after, 5);
        ids.push(...rows.map(({ tenant_id, id }) => `${tenant_id}/${id}`));
        if (rows.length < 5) break;
        after = rows[rows.length - 1]!.id;
      }
      listed[company] = ids;
    }
    result = { bypassrls, listed };
  } else {
    const records = await createDbLog(pool).records("org_456");
    result = {
      bypassrls,
      // org_789's only invoice by that name.
      inv2001: (await invoices.get("org_456", "INV-2001")).invoice ?? null,
      inv1008: (await invoices.get("org_456", "INV-1008")).invoice?.tenant_id ?? null,
      recordTenants: [...new Set(records.map((record) => record.tenant ?? null))],
    };
  }
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
