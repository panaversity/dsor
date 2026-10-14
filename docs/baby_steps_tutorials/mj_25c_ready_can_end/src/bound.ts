// Line ⑨'s read of the state a contract binds. A contract may name, in `bind`, the
// resources its command works on, and, under this tutorial's own name, what the command spends.
// DSoR reads them itself, through the company's store, before any work, so the amount that a limit
// counts is never the caller's word (§21, line 9; step 24's README, decision 2). The specification
// writes each bind in CEL. CEL is not built yet (step 27), so only the plain path input.<field> is
// accepted, and only an invoice can be bound, the one resource DSoR reads before the work.
import { Refusal } from "./envelope.ts";
import type { Invoice, InvoiceStore } from "./invoice.ts";
import type { Money } from "./money.ts";
import type { Draft, Drafted, PaymentStore } from "./payment.ts";
import { preview, type Contract } from "./registry.ts";
import { parseUri } from "./uri.ts";

// This tutorial's own field names, under its own namespace (DSOR-SCH-02).
const OURS = "org.panaversity.steps";
// input.<field>: the field of the input that names the resource.
// not copied: the specification writes a bind in CEL; this plain path is the tutorial's own subset
// until CEL arrives (step 24's README, decision 2).
const BIND = /^input\.([a-z][a-z0-9_]*)$/;
// state.<alias>.<field>: a money field of a bound invoice.
// not copied: the specification has no field for what a command spends; this is the tutorial's own
// (step 24's README, decision 2).
const SPENDS = /^state\.([a-z][a-z0-9_]*)\.(open_amount|amount)$/;

/** The aliases a contract binds, each with the text that says where it comes from. */
function bindsOf(contract: Contract): [string, unknown][] {
  const bind = contract["bind"];
  return typeof bind === "object" && bind !== null ? Object.entries(bind) : [];
}

/** What a contract says its command spends, as written, or undefined. */
function spendsOf(contract: Contract): unknown {
  const extensions = contract["extensions"] as Record<string, unknown> | undefined;
  return (extensions?.[OURS] as { spends?: unknown } | undefined)?.spends;
}

/** Start-up: every bind is input.<field>, a command's only, and every spends names a bound alias. */
export function bindProblems(contracts: Iterable<Contract>): string[] {
  const problems: string[] = [];
  for (const contract of contracts) {
    const binds = bindsOf(contract);
    for (const [alias, path] of binds) {
      if (typeof path !== "string" || !BIND.test(path)) {
        const why =
          "is not input.<field>: CEL in a bind is not built yet (step 24's README, decision 2)";
        problems.push(`${contract.id}: the bind ${JSON.stringify(alias)} ${why}`);
      }
    }
    const spends = spendsOf(contract);
    if (spends === undefined) continue;
    const match = typeof spends === "string" ? SPENDS.exec(spends) : null;
    if (match === null || !binds.some(([alias]) => alias === match[1])) {
      const why = "must be state.<alias>.open_amount or .amount, of an alias its bind names";
      problems.push(
        `${contract.id}: what the command spends ${why} (step 24's README, decision 2)`,
      );
    }
    if (contract["kind"] !== "command") {
      problems.push(`${contract.id}: only a command spends (step 24's README, decision 2)`);
    }
  }
  return problems;
}

/** What line ⑨ read: each bound invoice by its alias, and what the command spends, when it spends. */
export type Bound = { state: Record<string, Invoice>; spends?: Money };

/**
 * Line ⑨: reads each invoice the contract binds, itself, through the company's store, and works out
 * what the command spends. A bound invoice that is not there is refused as the code refuses it.
 */
export async function readBound(
  contract: Contract,
  // Line ①'s copy of the input, which line ⑥ checked.
  copy: unknown,
  invoices: InvoiceStore,
  tenant: string,
): Promise<Bound> {
  const state: Record<string, Invoice> = {};
  for (const [alias, path] of bindsOf(contract)) {
    const field = BIND.exec(String(path))![1]!;
    const uri = (copy as Record<string, unknown>)[field];
    const { id } = parseUri(uri as string);
    const { invoice } = await invoices.get(tenant, id);
    // The same words as the code's refusal, so a dry run hears what the real call hears (step 23's
    // README, decision 3).
    if (invoice === undefined) {
      throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`, "internal");
    }
    state[alias] = invoice;
  }
  const match = SPENDS.exec(String(spendsOf(contract)));
  if (match === null) return { state };
  const spent = state[match[1]!]![match[2] as "open_amount" | "amount"];
  return { state, spends: { ...spent } };
}

// The work writes only on what line ⑨ read. Line ⑩ checked the limits, and
// reserved, on the invoice at the version line ⑨ read. The code reads the invoice again, and could
// draft on a newer version, with another amount, if its caller named that version. So a draft is
// written only for an invoice that line ⑨ read, at the version line ⑨ read: anything else is
// stale, because DSoR's decision was made on another version (DSOR-CON-01b). Found by step 24's
// review: a draft of 120,000.00 USD went out under a reservation of 31,400.00 (decision 16).
/** The payments store, each draft pinned to an invoice line ⑨ read, at the version it read. */
export function pinned(payments: PaymentStore, state: Record<string, Invoice>): PaymentStore {
  const read = Object.values(state);
  if (read.length === 0) return payments;
  return Object.freeze({
    ...payments,
    create: async (tenant: string, draft: Draft, invoiceVersion: number): Promise<Drafted> => {
      const invoice = read.find((one) => one.id === draft.invoice_id);
      // The contract binds the invoice the draft is for, so a draft of another one is a bug.
      if (invoice === undefined)
        throw new Error("the work drafts for an invoice line ⑨ did not read");
      if (invoiceVersion !== invoice.version) {
        const record = `invoice ${preview(invoice.id)}`;
        const message = `${record} was at version ${invoice.version} when DSoR checked the limits, and the request was decided on version ${invoiceVersion}`;
        throw new Refusal("STALE_STATE", message, "internal");
      }
      return payments.create(tenant, draft, invoiceVersion);
    },
  });
}
