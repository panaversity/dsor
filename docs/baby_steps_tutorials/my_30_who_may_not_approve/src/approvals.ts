// STEP 29: approvals, kept whole (decision 167).
//
// An approval binds the person who gave it to the exact request, by its fingerprint, and to what it
// satisfies: one approval by the CFO, for the CFO's control. It is kept as approval.schema.json says
// it, and checked against that schema before it is kept (DSOR-APR-02a). It expires when its proposal's
// 72 hours end.
//
// Rule DSOR-APR-02a: An approval MUST validate against `approval.schema.json`.

import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import { now } from "./audit.ts";
import { WAITS_FOR_APPROVAL_MS } from "./policy-controls.ts";
import type { ProposalState } from "./proposal.ts";
import { theDatabase } from "./store.ts";

// ajv-formats is CommonJS; under nodenext the callable sits on `.default`, as in audit.ts.
const addFormats = (addFormatsModule as unknown as { default: FormatsPlugin }).default;

const read = (path: string): object =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as object;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(read("./schemas/common.schema.json"));
ajv.addSchema(read("./schemas/approval.schema.json"));

const compiled = ajv.getSchema("urn:dsor:schema:1.3:approval");

if (compiled === undefined) {
  throw new Error("the approval schema did not compile");
}

const validateApproval = compiled;

/** One approval, as approval.schema.json says it. */
export type Approval = Readonly<Record<string, unknown>>;

/** A proposal, as an approval needs to know it: what it is, its fingerprint, and where it stands. */
export interface ProposalToApprove {
  readonly id: string;
  /** `payment.create@1`. */
  readonly operation: string;
  readonly payloadHash: string;
  /** The arguments, as the canonical text its fingerprint was taken of. */
  readonly payload: string;
  readonly state: ProposalState;
  /** When it started waiting for approval, or undefined for one that never did. */
  readonly waitingSince: string | undefined;
}

/** One proposal of one company, or undefined for none of that name. */
export async function proposalToApprove(
  tenant: string,
  id: string,
): Promise<ProposalToApprove | undefined> {
  const { rows } = await theDatabase(tenant).query<{
    operation: string;
    payload_hash: string;
    payload: string;
    state: ProposalState;
    waiting_since: string | null;
  }>(
    `SELECT p.operation, p.payload_hash, p.payload,
            (SELECT m.to_state FROM dsor.proposal_moves m
              WHERE m.tenant = p.tenant AND m.proposal = p.id
                AND NOT EXISTS (SELECT 1 FROM dsor.proposal_moves n
                                 WHERE n.tenant = m.tenant AND n.proposal = m.proposal
                                   AND n.from_state = m.to_state)) AS state,
            (SELECT to_char(m.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
               FROM dsor.proposal_moves m
              WHERE m.tenant = p.tenant AND m.proposal = p.id
                AND m.to_state = 'PENDING_APPROVAL') AS waiting_since
       FROM dsor.proposals p
      WHERE p.tenant = $1 AND p.id = $2`,
    [tenant, id],
  );
  const row = rows[0];

  return row === undefined
    ? undefined
    : Object.freeze({
        id,
        operation: row.operation,
        payloadHash: row.payload_hash,
        payload: row.payload,
        state: row.state,
        waitingSince: row.waiting_since ?? undefined,
      });
}

/** When an approval of a proposal that started waiting at this moment expires: 72 hours on. */
export function expiresAt(waitingSince: string): string {
  return new Date(Date.parse(waitingSince) + WAITS_FOR_APPROVAL_MS).toISOString();
}

/** Whether that moment has passed, on DSoR's own clock. */
export function hasExpired(waitingSince: string): boolean {
  return Date.parse(now()) > Date.parse(waitingSince) + WAITS_FOR_APPROVAL_MS;
}

/**
 * Keep one approval, checked against the schema first, with its number from the sequence. Answers
 * its id, or `undefined` when this person has approved this proposal already.
 */
export async function keepApproval(
  tenant: string,
  proposal: string,
  approver: string,
  record: Approval,
): Promise<string | undefined> {
  // Checked whole, as the schema says an approval is, with the number and the status a kept one
  // will have; neither is kept in the record itself.
  const whole = { id: "apr_0", ...record, status: "active" };

  if (validateApproval(whole) !== true) {
    throw new TypeError(
      `this approval does not match approval.schema.json: ${ajv.errorsText(validateApproval.errors)}`,
    );
  }

  try {
    const { rows } = await theDatabase(tenant).query<{ id: string }>(
      `INSERT INTO dsor.approvals (tenant, proposal, approver, record)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [tenant, proposal, approver, JSON.stringify(record)],
    );

    return rows[0]?.id;
  } catch (failure) {
    if ((failure as { code?: unknown }).code === "23505") {
      return undefined;
    }

    throw failure;
  }
}

/** A proposal's approvals, oldest first, each whole: its record, its number and its status now. */
export async function approvalsOf(tenant: string, proposal: string): Promise<readonly Approval[]> {
  const { rows } = await theDatabase(tenant).query<{ id: string; record: Record<string, unknown> }>(
    `SELECT id, record FROM dsor.approvals
      WHERE tenant = $1 AND proposal = $2 ORDER BY approved_at, id`,
    [tenant, proposal],
  );

  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        id: row.id,
        ...row.record,
        // Expired once its time has passed, on DSoR's own clock; nothing else changes it yet.
        status:
          Date.parse(now()) > Date.parse(String(row.record.expires_at)) ? "expired" : "active",
      }),
    ),
  );
}
