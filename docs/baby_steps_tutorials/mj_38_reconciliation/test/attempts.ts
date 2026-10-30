// What the database tests use to end the proposals in flight, between two attempts on one invoice.
// Not a test file. test/db-setup.ts runs it before each database test, and a test that makes two
// attempts on one invoice runs it between them (step 32's README, decision D15). DSoR's own login
// ends them, inside each company, as DSoR's sweep would: the trigger still checks each move, and
// the login may change a proposal's state and nothing else.
import type pg from "pg";

/** Ends every proposal in flight of the story's two companies: CANCELLED, or FAILED if it ran. */
export async function endAttempts(pool: pg.Pool): Promise<void> {
  for (const tenant of ["org_456", "org_789"]) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', $1, true)", [tenant]);
      await client.query(
        `UPDATE dsor.proposals
            SET state = CASE WHEN state IN ('EXECUTING', 'OUTCOME_UNKNOWN') THEN 'FAILED'
                             ELSE 'CANCELLED' END
          WHERE tenant_id = $1
            AND state IN ('READY', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'OUTCOME_UNKNOWN')`,
        [tenant],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
