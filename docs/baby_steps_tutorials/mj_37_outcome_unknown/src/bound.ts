// Line ⑨'s read of the state a contract binds. A contract may name, in `bind`, the
// resources its command works on, and, under this tutorial's own name, what the command spends.
// DSoR reads them itself, through the company's store, before any work, so the amount that a limit
// counts is never the caller's word (§21, line 9; step 24's README, decision 2). The specification
// writes each bind in CEL. Step 27 evaluates CEL for a control's condition only, so a bind is still
// the plain path input.<field>, which binds an invoice.
// Or state.<alias>.vendor_id, which binds the vendor of an invoice bound before it.
//   The request never names a vendor: DSoR follows the invoice's own link (DSOR-MOD-03; step 32's
//   README, decision D2).
// NEW IN STEP 37: and the alias payment, input.<field>, which binds a payment, and
//   state.<alias>.invoice_id, the invoice of a payment bound before it: DSoR finds the invoice on the
//   payment itself, never in the request (step 37's README, decision D2).
import { Refusal } from "./envelope.ts";
import type { Freshness } from "./freshness.ts";
import type { Invoice, InvoiceStore } from "./invoice.ts";
import type { Money } from "./money.ts";
import type { Draft, Drafted, Payment, PaymentStore } from "./payment.ts";
import { preview, type Contract } from "./registry.ts";
import { formatUri, parseUri } from "./uri.ts";
import type { Vendor } from "./vendor.ts";

// This tutorial's own field names, under its own namespace (DSOR-SCH-02).
const OURS = "org.panaversity.steps";
// input.<field>: the field of the input that names the resource.
// not copied: the specification writes a bind in CEL; this plain path is the tutorial's own subset
// until CEL arrives (step 24's README, decision 2).
const BIND = /^input\.([a-z][a-z0-9_]*)$/;
// State.<alias>.vendor_id: the vendor of an invoice the input binds. A field that
//   ends in _id links to the record of that name, §6's pattern (step 17's README, decision 15).
// not copied: the tutorial's own reading of a link, and its only one (step 32's README, decision D2).
// NEW IN STEP 37: or state.<alias>.invoice_id, the invoice of a payment.
const LINK = /^state\.([a-z][a-z0-9_]*)\.(vendor_id|invoice_id)$/;
// NEW IN STEP 37: the one alias that binds a payment, not an invoice. Not copied: the tutorial's
//   own convention, as its plain paths are (step 37's README, decision D2).
const PAYMENT = "payment";
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

// The aliases the input binds, each with its input's field, in the bind's order.
/** The aliases a contract binds from its input, by the field of the input that names each. */
export function inputBound(contract: Contract): Map<string, string> {
  const found = new Map<string, string>();
  for (const [alias, path] of bindsOf(contract)) {
    const field = typeof path === "string" ? BIND.exec(path)?.[1] : undefined;
    if (field !== undefined) found.set(alias, field);
  }
  return found;
}

// A proposal in flight of a command that spends commits what it spends
//   (DSOR-EXC-02; step 32's README, decision D9).
/** Whether a contract's command spends what it binds. */
export function spendsAnything(contract: Contract | undefined): boolean {
  return contract !== undefined && spendsOf(contract) !== undefined;
}

/**
 * Start-up: every bind is input.<field>, or the vendor of an alias the input binds before it, a
 * command's only, and every spends names an alias the input binds.
 */
export function bindProblems(contracts: Iterable<Contract>): string[] {
  const problems: string[] = [];
  for (const contract of contracts) {
    const binds = bindsOf(contract);
    // The aliases the input binds, in the bind's order: a link may name only one
    //   of these, bound before it, so line ⑨ has read the invoice when it follows the link.
    const fromInput = new Set<string>();
    for (const [alias, path] of binds) {
      if (typeof path === "string" && BIND.test(path)) {
        fromInput.add(alias);
        continue;
      }
      const link = typeof path === "string" ? LINK.exec(path) : null;
      if (link !== null && fromInput.has(link[1]!)) continue;
      const why =
        "is not input.<field>, nor state.<alias>.vendor_id or .invoice_id of an alias the input binds before it: CEL in a bind is not built yet (step 24's README, decision 2; step 32's README, decision D2; step 37's README, decision D2)";
      problems.push(`${contract.id}: the bind ${JSON.stringify(alias)} ${why}`);
    }
    const spends = spendsOf(contract);
    if (spends === undefined) continue;
    const match = typeof spends === "string" ? SPENDS.exec(spends) : null;
    if (match === null || !fromInput.has(match[1]!)) {
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

/** A record's canonical address, or none when its id cannot be part of one (step 33's review, finding 1). */
function addressOf(tenant: string, entity: string, id: string): string | undefined {
  try {
    return formatUri({ tenant_id: tenant, entity, id });
  } catch {
    return undefined;
  }
}

/** What line ⑨ read: each bound invoice by its alias, and what the command spends, when it spends. */
// And each bound vendor. The state, which a condition reads, holds both. The
//   invoices, the records the request names, are kept apart: a check of the version the request
//   was decided on, and the pin of the work's draft, are about them alone. Found while building:
//   step 31's check of the version skipped itself once two records were bound.
export type Bound = {
  // And, since step 37, each bound payment.
  state: Record<string, Invoice | Vendor | Payment>;
  invoices: Record<string, Invoice>;
  spends?: Money;
  // And each read's label, which the contract's freshness is checked against (DSOR-FRS-02a).
  labels: Freshness[];
  // NEW IN STEP 37: and each bound record's address, by its alias, which line ⑨'s look at the
  //   holds matches, and a payment's holds are placed on (step 37's README, decision D2).
  resources: Record<string, string>;
};

// One read line ⑨ made, for the decision's bundle: the record's address, its
//   version when the store had the record, and the read's label (step 33's README, D5).
/** One read of a bound record, as line ⑨ made it, whether or not the record was there. */
export type BoundRead = { uri: string; version?: number; label: Freshness };

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
  // And who hears of each read as it is made, a read that finds nothing too, before any refusal
  //   (step 33's README, D5).
  note: (read: BoundRead) => void = () => {},
  // NEW IN STEP 37: and the company's payments, for a contract that binds one.
  payments?: PaymentStore,
): Promise<Bound> {
  const state: Record<string, Invoice | Vendor | Payment> = {};
  const read: Record<string, Invoice> = {};
  const labels: Freshness[] = [];
  const resources: Record<string, string> = {};
  // The payments read, by alias, so a link finds the invoice on its payment.
  const paid: Record<string, Payment> = {};
  for (const [alias, path] of bindsOf(contract)) {
    // A link: the vendor of an invoice read above, in the call's own company. A
    //   vendor the accounts system does not list is not bound, and a condition that reads it cannot
    //   be evaluated (step 32's README, decision D4).
    const link = LINK.exec(String(path));
    // NEW IN STEP 37: the invoice of a payment read above. It is state for a condition, and a
    //   record a hold can hold, but not one of the invoices the request names: the version a cancel
    //   names is its payment's, so the check of the version decided on leaves this invoice out.
    if (link !== null && link[2] === "invoice_id") {
      const payment = paid[link[1]!];
      if (payment === undefined) continue;
      const { invoice, freshness } = await invoices.get(tenant, payment.invoice_id);
      labels.push(freshness);
      const at = addressOf(tenant, "invoice", payment.invoice_id);
      if (at === undefined) continue;
      note(
        invoice === undefined
          ? { uri: at, label: freshness }
          : { uri: at, version: invoice.version, label: freshness },
      );
      if (invoice === undefined) {
        const why = `no invoice ${preview(payment.invoice_id)}`;
        throw new Refusal("RESOURCE_NOT_FOUND", why, "internal");
      }
      state[alias] = invoice;
      resources[alias] = at;
      continue;
    }
    if (link !== null) {
      const vendorId = read[link[1]!]!.vendor_id;
      // A vendor id that no address can name, such as one with a space, is not followed: no
      //   vendor is bound, and a condition that reads it cannot be evaluated. Found by step 33's
      //   review, finding 1: its address failed the bundle's schema after the payment was drafted
      //   (step 33's README, decision D16).
      const at = addressOf(tenant, "vendor", vendorId);
      if (at === undefined) continue;
      const { vendor, freshness } = await invoices.vendor(tenant, vendorId);
      labels.push(freshness);
      note(
        vendor === undefined
          ? { uri: at, label: freshness }
          : { uri: at, version: vendor.version, label: freshness },
      );
      if (vendor !== undefined) state[alias] = vendor;
      continue;
    }
    const field = BIND.exec(String(path))![1]!;
    const uri = (copy as Record<string, unknown>)[field];
    const { entity, id } = parseUri(uri as string);
    // NEW IN STEP 37: a payment, read through the company's own payments, by an address of a
    //   payment only. The same words as the code's refusal, so a dry run hears what the real call
    //   hears. Its read is not in the bundle yet: the payments store gives no freshness label.
    if (alias === PAYMENT) {
      if (entity !== "payment") {
        throw new Refusal("RESOURCE_NOT_FOUND", `no payment ${preview(id)}`, "internal");
      }
      if (payments === undefined) throw new Error("line ⑨ was given no payments to read");
      const payment = await payments.get(tenant, id);
      if (payment === undefined) {
        throw new Refusal("RESOURCE_NOT_FOUND", `no payment ${preview(id)}`, "internal");
      }
      state[alias] = payment;
      paid[alias] = payment;
      resources[alias] = formatUri({ tenant_id: tenant, entity: "payment", id });
      continue;
    }
    // And the address must be an invoice's. The store reads by id alone, so an
    //   address of another kind with an invoice's id would read that invoice, and the look, which
    //   searches the invoice's own address, would miss the attempt. Only the input schema's
    //   /invoice/ stood in the way. Found by step 32's review, finding L1.
    if (entity !== "invoice") {
      throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`, "internal");
    }
    const { invoice, freshness } = await invoices.get(tenant, id);
    labels.push(freshness);
    // The input's own address, which line ⑥ checked, so formatUri never refuses it here.
    const at = formatUri({ tenant_id: tenant, entity: "invoice", id });
    note(
      invoice === undefined
        ? { uri: at, label: freshness }
        : { uri: at, version: invoice.version, label: freshness },
    );
    // The same words as the code's refusal, so a dry run hears what the real call hears (step 23's
    // README, decision 3).
    if (invoice === undefined) {
      throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`, "internal");
    }
    state[alias] = invoice;
    read[alias] = invoice;
    resources[alias] = at;
  }
  const match = SPENDS.exec(String(spendsOf(contract)));
  if (match === null) return { state, invoices: read, labels, resources };
  const spent = read[match[1]!]![match[2] as "open_amount" | "amount"];
  return { state, invoices: read, spends: { ...spent }, labels, resources };
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
