// NEW IN STEP 39: the chain of DSoR's log (DSOR-AUD-04b and DSOR-AUD-04c in
// specs/dsor/03-execution.md, section 30). The database's trigger writes each record's chain, its
// place, the fingerprint of the record before it, and its own fingerprint, by the recipe in
// migrations/035_audit_chain.sql. This file is the same recipe in TypeScript, and the checker that
// recomputes every fingerprint from the records as they are now (step 39's README, decisions D1,
// D2, D5, and D6). It cannot see a chain rewritten from an edit on, or its newest records removed:
// that is step 39b's checkpoint.
import { createHash } from "node:crypto";
import type pg from "pg";

/** Where the checker puts a record that has no chain: never a company's name. */
export const NO_CHAIN = "(no chain)";

/** The fingerprint the first record of a chain follows. */
export const GENESIS: string = `sha256:${"0".repeat(64)}`;

// Every column of dsor.audit the fingerprint covers, as text, in the recipe's order. The
//   migration's dsor.audit_fingerprint lists the same expressions in the same order; a column added
//   to dsor.audit later must join both (step 39's README, decision D5).
//   The column each covers is named beside it, so a test can hold the list against the table's.
const COVERED: readonly (readonly [string, string])[] = Object.freeze([
  ["sequence", "sequence::text"],
  ["record_id", "record_id"],
  ["at", `to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`],
  ["kind", "kind"],
  ["operation", "operation"],
  ["authorization", `"authorization"`],
  ["result", "result"],
  ["reason", "reason"],
  ["correlation", "correlation::text"],
  ["tenant", "tenant"],
  ["extensions", "extensions::text"],
  ["resources", "resources::text"],
  ["row_count", "row_count::text"],
  ["connector", "connector"],
  ["identity", "identity::text"],
  ["delegation", "delegation"],
  ["controls", "controls::text"],
  ["decision_bundle", "decision_bundle"],
]);
/** The columns of dsor.audit the fingerprint covers, in the recipe's order. */
export const FIELD_NAMES: readonly string[] = Object.freeze(COVERED.map(([name]) => name));
/** The same, each as the text the recipe takes. */
export const FIELD_SQL: readonly string[] = Object.freeze(COVERED.map(([, sql]) => sql));

/** One record as the checker reads it: its chain columns, and its fields as text. */
export type ChainRow = {
  chain: string;
  chain_position: string;
  previous_hash: string;
  record_hash: string;
  // FIELD_SQL's values, in order: the second is the record's id.
  fields: (string | null)[];
};

/** The first record of a chain that does not fit, and why. */
export type Broken = { position: number; record_id: string | null; why: string };

/** One chain's report: how many records it holds, and its first break, if it has one. */
export type ChainReport = { chain: string; records: number; broken?: Broken };

/** A chain's head, as dsor.audit_heads keeps it: its last place and that record's fingerprint. */
export type ChainHead = { chain_position: string; record_hash: string };

/**
 * The text a fingerprint covers: the chain, the place, and every field, each with its length in
 * bytes before it, and a null as "-". So no two different records make the same text: a letter
 * moved from one field to the next changes two lengths (decision D5).
 */
export function recipeText(chain: string, position: string, fields: (string | null)[]): string {
  return [chain, position, ...fields]
    .map((part) => (part === null ? "-" : `${Buffer.byteLength(part, "utf8")}:${part}`))
    .join("|");
}

/** A record's fingerprint: SHA-256 over the fingerprint before it and the record's text. */
export function fingerprint(
  previous: string,
  chain: string,
  position: string,
  fields: (string | null)[],
): string {
  const text = `${previous}\n${recipeText(chain, position, fields)}`;
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * Each chain's report, from its records in any order. Within a chain, the records are walked by
 * their places: place 1, 2, 3 and on, each following the fingerprint of the one before, each
 * matching its own contents. The first that does not is named. Then, when the heads are given,
 * the chain's last record must be its head: a head that says more names the records removed from
 * the end, unless the editor rewrote the head too (found by step 39's review; decision D8).
 */
export function verifyChains(
  rows: readonly ChainRow[],
  heads?: ReadonlyMap<string, ChainHead>,
): ChainReport[] {
  const chains = new Map<string, ChainRow[]>();
  for (const row of rows) chains.set(row.chain, [...(chains.get(row.chain) ?? []), row]);
  // A head whose chain holds no record at all: every record of it was removed.
  for (const chain of heads?.keys() ?? []) if (!chains.has(chain)) chains.set(chain, []);
  const reports: ChainReport[] = [];
  for (const chain of [...chains.keys()].sort()) {
    const records = chains.get(chain)!;
    records.sort((a, b) => Number(a.chain_position) - Number(b.chain_position));
    const report: ChainReport = { chain, records: records.length };
    // The commit's trigger chains every record DSoR's login keeps, so a record with no chain was
    //   kept with the trigger off. Each is counted (step 39's README, decision D2; review, L9).
    if (chain === NO_CHAIN) {
      const why = `${records.length} record(s) belong to no chain`;
      report.broken = { position: 1, record_id: records[0]!.fields[1] ?? null, why };
      reports.push(report);
      continue;
    }
    let previous = GENESIS;
    for (const [i, row] of records.entries()) {
      const place = i + 1;
      const record_id = row.fields[1] ?? null;
      const broke = (why: string): void => {
        report.broken = { position: place, record_id, why };
      };
      if (row.chain_position !== String(place)) broke(`the record at place ${place} is missing`);
      else if (row.previous_hash !== previous) broke("it does not follow the record before it");
      else if (row.record_hash !== fingerprint(previous, chain, row.chain_position, row.fields)) {
        broke("its contents do not match its fingerprint");
      }
      if (report.broken !== undefined) break;
      previous = row.record_hash;
    }
    const head = heads?.get(chain);
    if (report.broken === undefined && head !== undefined) {
      const last = records.at(-1);
      const place = String(records.length);
      if (head.chain_position !== place || head.record_hash !== (last?.record_hash ?? GENESIS)) {
        const why = `its head says place ${head.chain_position}, and its last record is place ${place}`;
        report.broken = { position: records.length, record_id: last?.fields[1] ?? null, why };
      }
    }
    reports.push(report);
  }
  return reports;
}

/** Every record of the log, as the checker reads it. As the owner, every company's. */
export async function readChains(client: pg.ClientBase): Promise<ChainRow[]> {
  const { rows } = await client.query<Record<string, string | null>>(
    `SELECT chain, chain_position::text AS chain_position, previous_hash, record_hash,
            ${FIELD_SQL.map((sql, i) => `${sql} AS f${i}`).join(", ")}
       FROM dsor.audit ORDER BY chain, chain_position`,
  );
  return rows.map((row) => ({
    chain: row["chain"] ?? NO_CHAIN,
    chain_position: row["chain_position"] ?? "0",
    previous_hash: row["previous_hash"] ?? "",
    record_hash: row["record_hash"] ?? "",
    fields: FIELD_SQL.map((_, i) => row[`f${i}`] ?? null),
  }));
}

/** Each chain's head, as the owner reads dsor.audit_heads. */
export async function readHeads(client: pg.ClientBase): Promise<Map<string, ChainHead>> {
  const { rows } = await client.query<{
    chain: string;
    chain_position: string;
    record_hash: string;
  }>("SELECT chain, chain_position::text AS chain_position, record_hash FROM dsor.audit_heads");
  return new Map(
    rows.map(({ chain, chain_position, record_hash }) => [chain, { chain_position, record_hash }]),
  );
}
