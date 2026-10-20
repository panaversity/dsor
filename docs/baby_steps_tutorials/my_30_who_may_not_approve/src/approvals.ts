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
import { now, OutcomeUnknown, recordInsertIf, recordTogether } from "./audit.ts";
import { WAITS_FOR_APPROVAL_MS } from "./policy-controls.ts";
import { type ForTheRecord, type ProposalState, transition } from "./proposal.ts";
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
  /**
   * NEW IN STEP 30: who asked for it, as it recorded when it was made: the subject, which is the
   * slip's signer for an agent's command, the actors, and the slip (decision 169). Undefined when
   * what it recorded cannot be read (decision 170).
   */
  readonly requester:
    | {
        readonly subject: string;
        readonly actorChain: readonly string[];
        readonly delegation?: string;
      }
    | undefined;
}

/** Where proposal `p` stands now: the state its last move went to. */
const STATE_NOW = `(SELECT m.to_state FROM dsor.proposal_moves m
              WHERE m.tenant = p.tenant AND m.proposal = p.id
                AND NOT EXISTS (SELECT 1 FROM dsor.proposal_moves n
                                 WHERE n.tenant = m.tenant AND n.proposal = m.proposal
                                   AND n.from_state = m.to_state))`;

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
    requester: string;
  }>(
    `SELECT p.operation, p.payload_hash, p.payload, p.requester, ${STATE_NOW} AS state,
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
        requester: requesterFrom(row.requester),
      });
}

/**
 * NEW IN STEP 30: the requester a proposal recorded, read as it was written (§21.8): a subject, the
 * actors, and the slip, each a name. Anything else is a requester nobody can be told apart from,
 * and §21.9 refuses everyone for it, as it would if everyone were in its chain.
 *
 * Decision 170: undefined, not a throw. Thrown, it was caught as a store that could not be read,
 * EVIDENCE_STORE_UNAVAILABLE with retry `safe_same_key`: an invitation to send again a request
 * that could never pass. And an empty subject is no subject: read as one, the CFO approved her
 * own payment, a review measured.
 */
function requesterFrom(text: string): ProposalToApprove["requester"] {
  let parsed: { subject?: unknown; actor_chain?: unknown; delegation?: unknown };

  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return undefined;
  }

  const aName = (value: unknown): value is string =>
    typeof value === "string" && value.trim() !== "";

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !aName(parsed.subject) ||
    !Array.isArray(parsed.actor_chain) ||
    !parsed.actor_chain.every(aName) ||
    (parsed.delegation !== undefined && !aName(parsed.delegation))
  ) {
    return undefined;
  }

  return Object.freeze({
    subject: parsed.subject,
    actorChain: Object.freeze([...(parsed.actor_chain as string[])]),
    ...(parsed.delegation === undefined ? {} : { delegation: parsed.delegation }),
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

/** What keeping an approval came to. */
export type Kept =
  /** Kept; and `approved` when it was the last the proposal waited for, which moved it to APPROVED. */
  | { readonly kind: "kept"; readonly id: string; readonly approved: boolean }
  /** This person approved this proposal before; theirs is that one. */
  | { readonly kind: "already"; readonly id: string }
  /** The proposal stopped waiting after §21.9 looked, or its time ran out: nothing was kept. */
  | { readonly kind: "not_waiting"; readonly state: ProposalState }
  | { readonly kind: "expired" }
  /** The store refused the statement: no approval was kept, and the proposal did not move. */
  | { readonly kind: "not_written" }
  /** The reply was lost, and the approval could not be looked for: nobody knows. */
  | { readonly kind: "unknown" };

/**
 * Keep one approval, checked against the schema first, with its number from the sequence; and when
 * it is the last one the proposal waits for, move the proposal to APPROVED, with the move's record in
 * the log. One statement, all of it or none of it: `proposal.approve` says it is atomic, and §24
 * says what that means, commits or does not, in one transaction (DSOR-EXE-05b, decision 168).
 *
 * Kept only while the proposal waits for approval and the approval's time has not passed, asked in
 * the statement itself: §21.9 looked a moment before, and the proposal could have been cancelled
 * in between. The quorum is counted in the statement too, with this approval, and the statement
 * runs in the company's turn at the log, so two approvals sent at once are counted one after the
 * other, never each without the other.
 */
export async function keepApproval(
  tenant: string,
  proposal: string,
  approver: string,
  record: Approval,
  by: ForTheRecord,
): Promise<Kept> {
  // Checked whole, as the schema says an approval is, with the number and the status a kept one
  // will have; neither is kept in the record itself.
  const whole = { id: "apr_0", ...record, status: "active" };

  if (validateApproval(whole) !== true) {
    throw new TypeError(
      `this approval does not match approval.schema.json: ${ajv.errorsText(validateApproval.errors)}`,
    );
  }

  const cause = `approved: every requirement has its quorum; the last by ${approver}`;
  let written;

  try {
    written = await recordTogether<{ id: string | null; moved: number }>(
      tenant,
      [transition(by, tenant, proposal, "PENDING_APPROVAL", "APPROVED", approver, cause)],
      (records) => {
        const [move] = records;

        if (move === undefined) {
          throw new TypeError("the move to APPROVED was not sealed; nothing was sent");
        }

        const params: unknown[] = [
          tenant,
          proposal,
          approver,
          JSON.stringify(record),
          now(),
          cause,
          move.record_id,
        ];

        // `kept`: the approval, if the proposal waits and its time has not passed, and not this
        // person's second. `moved`: the move, if one was kept and, with it, every requirement has
        // as many approvals naming its control as its quorum. The table, read here, does not hold
        // the row `kept` writes, which is why that row is added to the count by name. NEW IN STEP
        // 30: counted as people, not rows, so one person's two approvals are one even without the
        // table's one-row-per-person rule, which `ON CONFLICT` no longer names (DSOR-SOD-04c,
        // decision 170).
        return {
          sql: `WITH kept AS (
                  INSERT INTO dsor.approvals (tenant, proposal, approver, record)
                  SELECT $1, $2, $3, $4::jsonb
                    FROM dsor.proposals p
                   WHERE p.tenant = $1 AND p.id = $2
                     AND ${STATE_NOW} = 'PENDING_APPROVAL'
                     AND $5::timestamptz <= ($4::jsonb ->> 'expires_at')::timestamptz
                  ON CONFLICT DO NOTHING
                  RETURNING id, approver, record),
                moved AS (
                  INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause, record)
                  SELECT $1, $2, 'PENDING_APPROVAL', 'APPROVED', $3, $6, $7
                   WHERE EXISTS (SELECT 1 FROM kept)
                     AND NOT EXISTS (
                       SELECT 1 FROM dsor.requirements r
                        WHERE r.tenant = $1 AND r.proposal = $2
                          AND r.quorum > (
                            SELECT count(DISTINCT given.approver) FROM (
                              SELECT a.approver, a.record FROM dsor.approvals a
                               WHERE a.tenant = $1 AND a.proposal = $2
                              UNION ALL
                              SELECT k.approver, k.record FROM kept k
                            ) AS given
                             WHERE EXISTS (
                               SELECT 1 FROM jsonb_array_elements(given.record -> 'satisfies') AS s
                                WHERE s ->> 'control' = r.control
                                  AND (s ->> 'version')::int = r.version)))
                  RETURNING proposal),
                r0 AS (${recordInsertIf("EXISTS (SELECT 1 FROM moved)", move, params)})
                SELECT (SELECT id FROM kept) AS id, (SELECT count(*) FROM moved)::int AS moved`,
          params,
        };
      },
    );
  } catch (failure) {
    // The statement failed, or only its reply was lost. The approval, looked for, says which: there,
    // the statement committed, and the move with it if it was the last; not there, nothing was
    // written, unless the server never answered and it may still land.
    let found;

    try {
      found = await approvalBy(tenant, proposal, approver);
    } catch {
      return Object.freeze({ kind: "unknown" });
    }

    if (found !== undefined) {
      return Object.freeze({
        kind: "kept",
        id: found,
        approved: (await stateNow(tenant, proposal)) === "APPROVED",
      });
    }

    return Object.freeze({ kind: failure instanceof OutcomeUnknown ? "unknown" : "not_written" });
  }

  const row = written.rows?.[0];

  // The reply was lost and the move's record was found: the statement committed, and it wrote the
  // record only beside the move, which it made only beside the approval.
  if (row === undefined) {
    return Object.freeze({
      kind: "kept",
      id: (await approvalBy(tenant, proposal, approver)) ?? "",
      approved: true,
    });
  }

  if (row.id !== null) {
    return Object.freeze({ kind: "kept", id: row.id, approved: row.moved > 0 });
  }

  // Nothing kept: say why, from this person's approval, or from where the proposal stands now.
  const before = await approvalBy(tenant, proposal, approver);

  if (before !== undefined) {
    return Object.freeze({ kind: "already", id: before });
  }

  const state = await stateNow(tenant, proposal);

  return state === "PENDING_APPROVAL"
    ? Object.freeze({ kind: "expired" })
    : Object.freeze({ kind: "not_waiting", state: state ?? "PROPOSED" });
}

/** The id of this person's approval of this proposal, or undefined for none. */
async function approvalBy(
  tenant: string,
  proposal: string,
  approver: string,
): Promise<string | undefined> {
  const { rows } = await theDatabase(tenant).query<{ id: string }>(
    "SELECT id FROM dsor.approvals WHERE tenant = $1 AND proposal = $2 AND approver = $3",
    [tenant, proposal, approver],
  );

  return rows[0]?.id;
}

/** Where a proposal stands now, or undefined for none of that name. */
async function stateNow(tenant: string, proposal: string): Promise<ProposalState | undefined> {
  const { rows } = await theDatabase(tenant).query<{ state: ProposalState }>(
    `SELECT ${STATE_NOW} AS state FROM dsor.proposals p WHERE p.tenant = $1 AND p.id = $2`,
    [tenant, proposal],
  );

  return rows[0]?.state;
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
