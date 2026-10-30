// Proposals in flight, at line ⑨ (§25.1; step 32's README, decisions D6 to D9 and
// D11). Only one attempt may be open on a record its contract is exclusive over: a second proposal
// of the same operation over it is refused with CONFLICT, naming the first (DSOR-EXC-01).
// While a proposal that spends an invoice may still run, or runs, DSoR counts that invoice's open
// amount as spent: a precondition over it sees nothing left (DSOR-EXC-02). payment.create drafts
// all that is left of an invoice, so one in flight commits all of it. The proposal being decided,
// at its own release, is in flight too, and is left out of its own count.
import { inputBound, spendsAnything, type Bound } from "./bound.ts";
import { Refusal } from "./envelope.ts";
import { invoiceUri } from "./invoice.ts";
import type { ProposalStore } from "./proposals.ts";
import type { Contract } from "./registry.ts";

/** The aliases a contract's in_flight.exclusive_over names, as written, or none. */
function exclusiveListOf(contract: Contract): unknown {
  return (contract["in_flight"] as { exclusive_over?: unknown } | undefined)?.exclusive_over;
}

/**
 * Start-up: exclusive_over names one alias at most, of a command, and one that the input binds, so
 * line ⑧ knows the record's address before line ⑨ reads it. Not copied: the schema allows a list;
 * one is this tutorial's own (step 32's README, decision D6).
 */
export function exclusiveProblems(contracts: Iterable<Contract>): string[] {
  const problems: string[] = [];
  for (const contract of contracts) {
    const listed = exclusiveListOf(contract);
    if (listed === undefined) continue;
    const named = Array.isArray(listed) ? listed : [];
    const fromInput = inputBound(contract);
    const one = named.length === 1 && contract["kind"] === "command";
    if (one && typeof named[0] === "string" && fromInput.has(named[0])) continue;
    problems.push(
      `${contract.id}: in_flight.exclusive_over must name one alias that the input binds, of a command (step 32's README, decision D6)`,
    );
  }
  return problems;
}

/** The address of the record the call is exclusive over, from line ①'s copy, or none. */
export function exclusiveOf(contract: Contract, copy: unknown): string | undefined {
  const listed = exclusiveListOf(contract);
  if (!Array.isArray(listed) || typeof listed[0] !== "string") return undefined;
  const field = inputBound(contract).get(listed[0]);
  const uri = field === undefined ? undefined : (copy as Record<string, unknown> | null)?.[field];
  return typeof uri === "string" ? uri : undefined;
}

/**
 * Line ⑨'s look: the record's lock first, alone, inside a claim, then another proposal in flight
 * of the same operation over the record. The proposal being decided is left out of its own look.
 */
export async function checkExclusive(
  contract: Contract,
  bound: Bound,
  proposals: Pick<ProposalStore, "inFlightOver" | "holdOver">,
  tenant: string,
  self: string | undefined,
  // Whether to take the invoice's lock: only inside the claim of a new attempt.
  locks: boolean,
): Promise<void> {
  const listed = exclusiveListOf(contract);
  if (!Array.isArray(listed) || typeof listed[0] !== "string") return;
  const invoice = bound.invoices[listed[0]];
  if (invoice === undefined) return;
  const uri = invoiceUri(invoice);
  if (locks) await proposals.holdOver(tenant, contract.id, uri);
  const first = (await proposals.inFlightOver(tenant, uri)).find(
    (other) => other.id !== self && operationOf(other.operation) === contract.id,
  );
  if (first === undefined) return;
  const address = `dsor://${tenant}/proposal/${first.id}`;
  const why = `${listed[0]} ${invoice.id} has an attempt in flight already: proposal ${address}, ${first.state}`;
  // Public, so every caller hears which proposal holds the invoice, as DSOR-EXC-01 asks: the words
  //   repeat the invoice the caller named, and add a proposal's address and state. Found by step
  //   32's review, finding M3: labelled internal, an agent below that clearance heard no name.
  throw new Refusal("CONFLICT", why, "public");
}

/**
 * The bound state, with each bound invoice that another proposal in flight spends counted as
 * spent: its open amount is zero, in its own currency. Only the preconditions read this state.
 * What line ⑩ books stays the invoice's real open amount, so a contract without a precondition
 * over what is left still books what it drafts. Found by a sweep of small breaks, M04: the count
 * set the booking to zero too, and such a contract booked 0.00 and drafted 31,400.00 USD.
 */
export async function countInFlight(
  bound: Bound,
  proposals: Pick<ProposalStore, "inFlightOver">,
  tenant: string,
  contracts: ReadonlyMap<string, Contract>,
  // The proposal being decided: the call's own, or the one a release loaded. None in a dry run of
  // a call, which makes no proposal.
  self: string | undefined,
): Promise<Bound> {
  const state = { ...bound.state };
  for (const [alias, invoice] of Object.entries(bound.invoices)) {
    const others = (await proposals.inFlightOver(tenant, invoiceUri(invoice))).filter(
      (other) => other.id !== self && spendsAnything(contracts.get(operationOf(other.operation))),
    );
    if (others.length === 0) continue;
    const nothing = { value: "0.00", currency: invoice.open_amount.currency };
    state[alias] = { ...invoice, open_amount: nothing };
  }
  return { ...bound, state };
}

/** An operation's name, from the name and version a proposal keeps, such as payment.create@1. */
function operationOf(kept: string): string {
  return kept.split("@")[0] ?? kept;
}
