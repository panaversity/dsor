// NEW IN STEP 41: a payment run, many drafts proposed as one list (DSOR-BAT-01a to DSOR-BAT-02b in
// specs/dsor/01-model.md, section 8; step 41's README, decisions D1 to D7). A run's contract
// declares a batch, how the run ends and how many lines it may hold, and names, under this
// tutorial's own name, the operation each line is: payment.run's lines are payment.create.
import { createHash } from "node:crypto";
import { Refusal } from "./envelope.ts";
import { sumOf } from "./limits.ts";
import type { Money } from "./money.ts";
import type { Contract } from "./registry.ts";

const OURS = "org.panaversity.steps";

// Only all_or_nothing is built: a run that lets some lines through answers BATCH_PARTIAL and shows
//   its refused lines to the approver (DSOR-BAT-01c, DSOR-BAT-02c), which no step builds yet
//   (step 41's README, decision D2).
const BUILT = ["all_or_nothing"];

/** What a run's contract declares: how it ends, and the most lines it may hold. */
export type Batch = { atomicity: "all_or_nothing" | "per_item"; max_items: number };

/** One line of a run, as its input holds it: the input of one payment.create. */
export type RunLine = { invoice: string; expected_version: number };

/** The contract's batch, or undefined when it declares none. */
export function batchOf(contract: Contract | Record<string, unknown>): Batch | undefined {
  return contract["batch"] as Batch | undefined;
}

/** The operation each line of a run is, as its contract names it, or undefined. */
export function lineOperationOf(contract: Contract | Record<string, unknown>): string | undefined {
  const extensions = contract["extensions"] as Record<string, unknown> | undefined;
  const line = (extensions?.[OURS] as { line?: unknown } | undefined)?.line;
  return typeof line === "string" ? line : undefined;
}

/**
 * Start-up's check of every run: a contract that names its lines' operation declares a batch, a
 * batch names its lines' operation, and its atomicity is one this step builds (DSOR-BAT-01a).
 */
export function runProblems(contracts: Iterable<Contract | Record<string, unknown>>): string[] {
  const problems: string[] = [];
  const all = [...contracts];
  const commands = new Set(all.filter((c) => c["kind"] === "command").map((c) => String(c["id"])));
  for (const contract of all) {
    const id = String(contract["id"]);
    const batch = batchOf(contract);
    const line = lineOperationOf(contract);
    if (batch === undefined) {
      if (line !== undefined) {
        problems.push(
          `${id}: its lines are ${line}, and it declares no batch: its atomicity and its most lines (DSOR-BAT-01a)`,
        );
      }
      continue;
    }
    if (line === undefined) {
      problems.push(
        `${id}: it declares a batch, and names no operation for its lines (DSOR-BAT-01a)`,
      );
      continue;
    }
    // The lines' operation is a command of its own, whose contract each line is checked by.
    if (!commands.has(line)) {
      problems.push(
        `${id}: its lines are ${line}, which is not a command with a contract (DSOR-BAT-01a)`,
      );
    }
    if (!BUILT.includes(batch.atomicity)) {
      problems.push(
        `${id}: the atomicity ${JSON.stringify(batch.atomicity)} is not built yet (DSOR-BAT-01a)`,
      );
    }
  }
  return problems;
}

/**
 * Line ⑥'s check of a run's input, after its schema: at most the contract's lines, and no invoice on
 * two lines, before any bill is read (DSOR-BAT-01a; step 41's README, decisions D3 and D6).
 */
export function checkRunShape(contract: Contract, input: unknown): void {
  const batch = batchOf(contract);
  if (batch === undefined) return;
  const name = JSON.stringify(contract.id);
  const { lines } = input as { lines: RunLine[] };
  if (lines.length > batch.max_items) {
    const why = `${name} takes at most ${batch.max_items} lines, and this run has ${lines.length}`;
    throw new Refusal("VALIDATION_FAILED", why, "public");
  }
  // One bill on two lines would be drafted twice, so the run is refused. The lines are counted
  //   from 1, as a person reads a list.
  const first = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    const seen = first.get(line.invoice);
    if (seen !== undefined) {
      const why = `${name} names one invoice on two lines: lines ${seen + 1} and ${index + 1}`;
      throw new Refusal("VALIDATION_FAILED", why, "public");
    }
    first.set(line.invoice, index);
  }
}

/**
 * A line's own idempotency key, derived by DSoR from the run's key and the line's invoice, never
 * given by the caller: the same run sent again with the same key gives every line the same key
 * (DSOR-BAT-01b; step 41's README, decision D6). The two are hashed as one JSON list, so no run
 * key and invoice can be written to look like another pair.
 */
export function lineKeyOf(runKey: string, invoice: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([runKey, invoice]))
    .digest("hex");
  return `line_${digest}`;
}

/** One vendor's total in one currency: the counterparty of DSOR-BAT-02a, by its address. */
export type VendorTotal = { vendor: string; amount: Money };

/** What a run's approval binds to beside its fingerprint: its totals per currency and per vendor. */
export type RunTotals = { totals: Money[]; vendor_totals: VendorTotal[] };

/** What line ⑨ read of one line: the amount it spends, and the address of its vendor. */
export type LineRead = { spends: Money; vendor: string };

/**
 * A run's totals, added up from what line ⑨ read of each line: one per currency, in the order of
 * the currencies' codes, and one per vendor and currency, in the order of the vendors' addresses
 * (DSOR-BAT-02a; step 41's README, decision D4).
 */
export function totalsOf(lines: readonly LineRead[]): RunTotals {
  const byCurrency = new Map<string, Money[]>();
  const byVendor = new Map<string, Money[]>();
  for (const { spends, vendor } of lines) {
    byCurrency.set(spends.currency, [...(byCurrency.get(spends.currency) ?? []), spends]);
    const key = JSON.stringify([vendor, spends.currency]);
    byVendor.set(key, [...(byVendor.get(key) ?? []), spends]);
  }
  const totals = [...byCurrency.keys()].sort().map((currency) => sumOf(byCurrency.get(currency)!));
  const vendor_totals = [...byVendor.keys()].sort().map((key) => {
    const [vendor] = JSON.parse(key) as [string, string];
    return { vendor, amount: sumOf(byVendor.get(key)!) };
  });
  return { totals, vendor_totals };
}
