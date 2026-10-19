// NEW IN STEP 38: reconciliation, DSoR's own command payment.reconcile (DSOR-UNK-04a and
// DSOR-UNK-04d in specs/dsor/03-execution.md, section 25.3). It names one proposal of payment.execute
// whose outcome is unknown, asks the company's bank by the key DSoR derived from that proposal, and
// settles it with the bank's answer as the evidence, in one transaction: sent, so COMMITTED and the
// payment marked paid; not sent, so FAILED and the payment a draft. Either way its holds stop
// counting (step 37), and the proposal's booking ends as the pipeline ends any command's. Today
// only a draft books, so a send holds none, and the draft's booking stays as it is. A bank that
// does not answer settles nothing. dsor-scheduler calls it, and so may a person with
// payment:reconcile; an agent never may, which line ⑤ checks (step 38's README, decisions D1 to D3
// and D5).
import { bankKeyOf, lookupThrough, type BankReceipt } from "./bank.ts";
import { Refusal } from "./envelope.ts";
import type { Mover } from "./log.ts";
import type { Payment } from "./payment.ts";
import { isProposalOf, proposalIdOf, type Proposal } from "./proposals.ts";
import { preview } from "./registry.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { parseUri } from "./uri.ts";

/** What a reconcile answers: the proposal, its state now, and what the bank said. */
type Reconciliation = { proposal: string; state: string; evidence: string };

/** The proposal the input names, by its id, in the call's own company. */
function namedIn(input: unknown, tenant: string): { uri: string; id: string } {
  const uri = (input as { proposal: string }).proposal;
  // The check of the URIs refused another company's URI before line ⑥; an id of this company that
  //   is not one is "no proposal", as for a release (step 31's README, decision D4).
  if (!isProposalOf(tenant, uri)) {
    const why = `no proposal ${preview(parseUri(uri).id)}`;
    throw new Refusal("RESOURCE_NOT_FOUND", why, "internal");
  }
  return { uri, id: proposalIdOf(tenant, uri) };
}

/** Refuses a proposal that is not a payment's send whose outcome is unknown. */
function mustBeUnknown(found: Proposal | undefined, id: string): Proposal {
  if (found === undefined) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no proposal ${preview(id)}`, "internal");
  }
  if (!found.operation.startsWith("payment.execute@")) {
    const why = `proposal ${preview(id)} sends no payment, so there is nothing to reconcile`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  // A settled proposal is never settled again (step 38's README, claim C6).
  if (found.state !== "OUTCOME_UNKNOWN") {
    const why = `proposal ${preview(id)} is ${found.state}, not OUTCOME_UNKNOWN, so there is nothing to reconcile`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  return found;
}

/** Line ⑨: the proposal is the company's own, a payment's send, and its outcome is unknown. */
async function mayReconcile(input: unknown, look: OwnLook): Promise<void> {
  const { id } = namedIn(input, look.tenant);
  mustBeUnknown(await look.proposals.get(look.tenant, id), id);
}

/** Whether the bank's receipt is for this payment, as DSoR sent it. */
function sameAs(receipt: BankReceipt, payment: Payment): boolean {
  return (
    receipt.payment === payment.id &&
    receipt.vendor === payment.vendor_id &&
    receipt.amount.value === payment.amount.value &&
    receipt.amount.currency === payment.amount.currency
  );
}

/** The work, after line ⑩, inside the claim's transaction. */
async function reconcile(input: unknown, work: OwnStores): Promise<Reconciliation> {
  const { tenant, caller, stores, correlation, now, bank } = work;
  const { uri, id } = namedIn(input, tenant);
  // Read again inside the claim, so of two reconciles at once, one settles and one hears CONFLICT.
  const proposal = mustBeUnknown(await stores.proposals.get(tenant, id), id);
  if (bank === undefined) {
    const why = `${tenant}'s bank is out of service, so the payment cannot be looked up`;
    throw new Refusal("CONNECTOR_UNAVAILABLE", why, "internal");
  }
  const key = bankKeyOf(tenant, id);
  const looked = await lookupThrough(bank, key);
  // A bank that does not answer, or cannot be asked, tells nothing: the proposal stays unknown and
  //   held, and the next call asks again. Never read as "not sent" (step 38's README, claim C4).
  if ("silent" in looked) {
    const evidence = `${looked.silent} by key ${key}, in the call at ${now}`;
    return { proposal: uri, state: "OUTCOME_UNKNOWN", evidence };
  }
  const paymentId = parseUri((proposal.payload as { payment: string }).payment).id;
  const payment = await stores.payments.get(tenant, paymentId);
  if (payment === undefined) throw new Error(`proposal ${id} names a payment that is not kept`);
  const sent = looked.sent;
  // A receipt that is not for this payment, as DSoR sent it, settles nothing: a person must look.
  //   A refusal, so the call's record keeps the reason (found by step 38's review, F4).
  if (sent !== undefined && !sameAs(sent, payment)) {
    const why = `the bank answered key ${key} with ${sent.reference}, which is not this payment as DSoR sent it; a person must look`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  // Sent, but the payment is no longer a draft or paid: a person must look. Paid by another path
  //   is the same fact the bank gives, and settles (found by step 38's review, F1).
  if (sent !== undefined && payment.status !== "draft" && payment.status !== "paid") {
    const why = `the bank sent ${sent.reference}, but payment ${preview(payment.id)} is ${payment.status}; a person must look`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  // The move's record names the caller, through its own call, as the expiry sweep's does (step
  //   25c's README, decision D4), and its cause is the evidence (step 38's README, decision D5).
  const mover: Mover = {
    mode: "direct",
    subject: caller.id,
    actor_chain: [],
    subject_authority: { source: "token", as_of: now },
  };
  // The call's time, not the moment of the bank's answer, which comes a little later.
  const evidence =
    sent === undefined
      ? `the bank has no payment with key ${key}, asked in the call at ${now}`
      : `the bank sent ${sent.reference}: ${sent.amount.value} ${sent.amount.currency} to ${sent.vendor}, asked by key ${key} in the call at ${now}`;
  const to = sent === undefined ? "FAILED" : "COMMITTED";
  const by = { mover, cause: `reconciled: ${evidence}`, correlation };
  if (!(await stores.proposals.move(tenant, id, "OUTCOME_UNKNOWN", to, by))) {
    const why = `proposal ${preview(id)} was settled by another call`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  if (sent === undefined) {
    // Not sent: the payment stays a draft, and the proposal's booking, when it holds one, goes
    //   back to the day, as a failed command's does. A send holds none today (found by step 38's
    //   review, F3).
    await stores.reservations.release(tenant, id);
  } else {
    // Sent: the payment is paid, at the version DSoR read under its lock, and the proposal's
    //   booking, when it holds one, stays counted. A draft that does not change at that version is
    //   a fault, and the work rolls back.
    if (payment.status === "draft") {
      const { changed } = await stores.payments.pay(tenant, payment.id, payment.version);
      if (!changed) throw new Error(`payment ${payment.id} could not be marked paid`);
    }
    await stores.reservations.commit(tenant, id);
  }
  return { proposal: uri, state: to, evidence };
}

/** DSoR's own work for reconciliation. */
export function reconcileWorkFor(): Record<string, OwnWork> {
  return { "payment.reconcile": { check: mayReconcile, change: reconcile } };
}
