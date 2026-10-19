// NEW IN STEP 39: the chain of DSoR's log (DSOR-AUD-04b and DSOR-AUD-04c in
// specs/dsor/03-execution.md, section 30). The database's trigger writes each record's chain, its
// place, the fingerprint of the record before it, and its own fingerprint, by the recipe in
// migrations/035_audit_chain.sql. This file is the same recipe in TypeScript, and the checker that
// recomputes every fingerprint from the records as they are now (step 39's README, decisions D1,
// D2, D5, and D6). It cannot see a chain rewritten from an edit on, or its newest records removed:
// that is step 39b's checkpoint.
import { createHash } from "node:crypto";
import type pg from "pg";

/** The fingerprint the first record of a chain follows. */
export const GENESIS: string = `sha256:${"0".repeat(64)}`;

// Every column of dsor.audit the fingerprint covers, as text, in the recipe's order. The
//   migration's dsor.audit_fingerprint lists the same expressions in the same order; a column added
//   to dsor.audit later must join both (step 39's README, decision D5).
export const FIELD_SQL: readonly string[] = Object.freeze([
  "sequence::text",
  "record_id",
  `to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  "kind",
  "operation",
  `"authorization"`,
  "result",
  "reason",
  "correlation::text",
  "tenant",
  "extensions::text",
  "resources::text",
  "row_count::text",
  "connector",
  "identity::text",
  "delegation",
  "controls::text",
  "decision_bundle",
]);

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
 * matching its own contents. The first that does not is named.
 */
export function verifyChains(rows: readonly ChainRow[]): ChainReport[] {
  const chains = new Map<string, ChainRow[]>();
  for (const row of rows) chains.set(row.chain, [...(chains.get(row.chain) ?? []), row]);
  const reports: ChainReport[] = [];
  for (const chain of [...chains.keys()].sort()) {
    const records = chains.get(chain)!;
    records.sort((a, b) => Number(a.chain_position) - Number(b.chain_position));
    const report: ChainReport = { chain, records: records.length };
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
    chain: String(row["chain"]),
    chain_position: String(row["chain_position"]),
    previous_hash: String(row["previous_hash"]),
    record_hash: String(row["record_hash"]),
    fields: FIELD_SQL.map((_, i) => row[`f${i}`] ?? null),
  }));
}
