// STEP 29: what a waiting proposal waits for, kept (decision 167).
//
// A control that requires approval says by whom and how many: one approval by the CFO. When the
// door holds a proposal at PENDING_APPROVAL, it writes each requirement here, before the move, and
// nothing ever changes one. An approval is checked against them, and the proposal moves to APPROVED
// only when every one has its quorum (DSOR-AUT-02c).

import { theDatabase } from "./store.ts";

/** One approval a proposal waits for: which control asked, for whom, how many. */
export interface Requirement {
  readonly control: string;
  readonly version: number;
  readonly role: string;
  readonly quorum: number;
}

/** Write what a proposal waits for, in one statement: all of it, or none. */
export async function keepRequirements(
  tenant: string,
  proposal: string,
  requires: readonly Requirement[],
): Promise<void> {
  const params: unknown[] = [tenant, proposal];
  const rows = requires.map((r) => {
    params.push(r.control, r.version, r.role, r.quorum);

    const at = params.length;

    return `($1, $2, $${at - 3}, $${at - 2}::int, $${at - 1}, $${at}::int)`;
  });

  if (rows.length === 0) {
    return;
  }

  await theDatabase(tenant).query(
    `INSERT INTO dsor.requirements (tenant, proposal, control, version, role, quorum)
     VALUES ${rows.join(", ")}`,
    params,
  );
}

/** What one proposal waits for, by control, or nothing for one that waits for nobody. */
export async function requirementsOf(
  tenant: string,
  proposal: string,
): Promise<readonly Requirement[]> {
  const { rows } = await theDatabase(tenant).query<Requirement>(
    `SELECT control, version, role, quorum FROM dsor.requirements
      WHERE tenant = $1 AND proposal = $2 ORDER BY control`,
    [tenant, proposal],
  );

  return Object.freeze(rows.map((r) => Object.freeze({ ...r })));
}
