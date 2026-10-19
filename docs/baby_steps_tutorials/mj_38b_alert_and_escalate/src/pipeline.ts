// The checklist every call goes through. DSOR-EXE-01a in specs/dsor/03-execution.md,
// section 21, and DSOR-OPR-04a in specs/dsor/01-model.md, section 7.
import { heldBy, heldRefusal, holdsOf, NO_HOLDS, type HoldStore } from "./holds.ts";
import { NO_INTENTS } from "./intents.ts";
import { randomUUID } from "node:crypto";
import { pinned, readBound, type Bound, type BoundRead } from "./bound.ts";
import { checkBrake, holdBrake, NO_BRAKES, type BrakeStore } from "./brakes.ts";
import { ASKS_BANK, checkConnector, SENDS_MONEY } from "./connectors.ts";
import { bankKeyOf, sendThrough, type BankOrder } from "./bank.ts";
import { checkedAssertion } from "./asserted.ts";
import {
  bundleOf,
  checkBundle,
  executedOf,
  newEvidence,
  stateReadOf,
  type DecisionBundle,
} from "./bundle.ts";
import { freshSheet, NO_RATES, readOnce, type RateStore } from "./rates.ts";
import { NO_CONTROLS, type ControlStore } from "./rulebook.ts";
import { NotCanonical, payloadHash } from "./canonical.ts";
import {
  claimScope,
  isOutcome,
  keptAfterNote,
  type ClaimScope,
  type Claimed,
  type ClaimTransaction,
  type Ended,
  type ProposalSteps,
  type WorkStores,
} from "./claims.ts";
import { policyLook } from "./drift.ts";
import { checkAnswerInTenant, companyOf, NO_BANK, type CompanyBank } from "./company.ts";
import { checkDelegation, checkNamedSlips, holdSlip } from "./delegation.ts";
import { tenantOf, type Facts } from "./cel.ts";
import {
  denialsOf,
  evaluateControls,
  mostRestrictive,
  requirementsOf,
  staleOf,
  type ControlAnswer,
  type ControlOutcome,
  type Denial,
  type StaleOfRecord,
} from "./controls.ts";
import {
  Refusal,
  toEnvelope,
  type Answer,
  type Correlation,
  type Requirement,
} from "./envelope.ts";
import { checkInput, jsonCopy, NOT_JSON, refuseInput } from "./inputs.ts";
import type { Converted } from "./exchange.ts";
import { newReads, stalest, type Freshness } from "./freshness.ts";
import type { InvoiceStore } from "./invoice.ts";
import {
  checkLimits,
  limitsOf,
  NO_RESERVATIONS,
  type Conversion,
  type Unconvertible,
  type ReservationStore,
} from "./limits.ts";
import { decisionOf, type Authority, type Decision, type DecisionLog, type Read } from "./log.ts";
import { NO_PAYMENTS, unlocked, type PaymentStore } from "./payment.ts";
import { checkResultSize } from "./pages.ts";
import { checkPermission, effectivePermissions, permissionsOf } from "./permissions.ts";
import { clearanceOf, maskRefusal, show } from "./masking.ts";
import { callerIds, checkNamedPrincipals, whoIsCalling } from "./principals.ts";
import {
  callerMover,
  closeProposal,
  dsorMover,
  isProposalOf,
  NO_PROPOSALS,
  openProposal,
  proposalIdOf,
  requesterOf,
  urisIn,
  type Opening,
  type Proposal,
  type ProposalStore,
  type Requester,
} from "./proposals.ts";
import { preview, type Contract, type Handler, type Registry } from "./registry.ts";
import {
  askerNow,
  causeOf,
  checkApprovals,
  checkDecidedOn,
  decidedOnOf,
  invalidates,
  mayRelease,
  releases,
  targetOf,
  timeCame,
} from "./release.ts";
import {
  checkedKey,
  checkedMode,
  checkEnvelopeFields,
  checkRequestId,
  usableRequestId,
  type Mode,
  type RequestEnvelope,
} from "./request.ts";
import { semanticsOf } from "./semantics.ts";
import { checkExclusive, countInFlight, exclusiveOf } from "./inflight.ts";
import { checkFreshness, checkPreconditions } from "./preconditions.ts";
import { lookFor, type OwnWork } from "./revocation.ts";
import { NO_SLIPS, type Slip, type SlipStore } from "./slips.ts";
import { suspendThenRefuse } from "./suspensions.ts";
import { activeTenant, checkNamedTenants, checkUrisInTenant } from "./tenants.ts";
import { isTenantId, parseUri } from "./uri.ts";

// The observer is told each line's number as it runs, and only a test
// listens (step 07's README, decision 6).
/** Hears the number of each line of the checklist, as the line runs. */
export type Observer = (line: number) => void;

/**
 * Runs an operation by its name. It answers with an envelope, and never throws.
 * Every call runs one checklist, numbered as §21 numbers it. A line that
 * is not built yet is a comment that names its step, and never a check that says "fine".
 */
// Call is async. It waits for the database at lines ⑨ and ⑪, and answers
// only after the record is committed (step 09's README, decision 9).
// What a caller hears when the record of its work could not be written, and so
//   nothing of the work was kept (DSOR-EXE-03b; step 36b's README, decision D3).
const KEPT_NOTHING =
  "DSoR could not record its decision, so it kept nothing of the work, and a retry with the same idempotency_key runs it again";

export async function call(
  registry: Registry,
  // The log every decision is written to (step 08's README, decision 6).
  log: DecisionLog,
  // The request envelope, beside the arguments (step 05's README, decision 1).
  request: RequestEnvelope,
  name: string,
  input: unknown,
  observe: Observer = () => {},
): Promise<Answer> {
  // DSoR makes a request id first, so every answer carries one (DSOR-COR-01b).
  let correlation: Correlation = { request_id: `req_${randomUUID()}` };

  // Runs one line, and first tells the observer its number. The number and the check are
  // one statement, so neither can move without the other.
  function line<T>(number: number, check: () => T): T {
    observe(number);
    return check();
  }

  // Set once DSoR's checks let the call reach its code at line ⑨. From then on, its
  // record says ALLOW (step 08's README, decision 5).
  // Called reachedCode until step 22. A dry run and a propose_only call never reach
  // their code, and their record says ALLOW once DSoR's checks pass (step 23's README, decision 10).
  let allowed = false;
  // Set once line ② has checked the company, so the record names it, even
  // when a later line refuses (step 10's README, decision 6).
  let tenantOfRecord: string | undefined;
  // A well-formed company the caller named. If line ② refuses it, the record
  // keeps it as a claim, never as its tenant (step 10's README, decision 6).
  let claimedTenant: string | undefined;
  // What the answer returned, set only when it returns data. Its record
  // says so (DSOR-CLS-05; step 14's README, decision 7).
  let read: Read | undefined;
  // The slip an agent's call runs under, once line ③ found it. Its record
  // names the slip and its person, refusals after line ③ too (step 18's README, decision 8).
  let under: Authority | undefined;
  // The key line ⑦ claimed, and, for a replay, the request id of the first
  // call. The record names both (step 20's README, decision 8).
  let keyOfRecord: { key: string; replay_of?: string } | undefined;
  // The proposal line ⑧ made, or a replay gave back. The record names it, and so
  // does the answer, a refusal too (step 22's README, decision 5).
  let proposalOfRecord: string | undefined;
  // The sheet and the rates line ⑩ converted with, once it has. The record names
  // them, a refusal's too (step 26's README, decision L7).
  let conversionOfRecord: Conversion | undefined;
  // And, when no rate was usable, which currency and why. Only the record names
  // them (step 26's review, finding H1).
  let unconvertibleOfRecord: Unconvertible | undefined;
  // And each control line ⑩ evaluated. The record names them, a refusal's too
  // (DSOR-EXE-02; step 27's README, decision D14).
  let controlsOfRecord: ControlOutcome[] | undefined;
  // And each control that refused, with its own reason (step 27's review, finding L2).
  let denialsOfRecord: Denial[] | undefined;
  // And each stale control, with the version of its policy in force (step 28b's
  // README, decision D11).
  let staleOfRecord: StaleOfRecord[] | undefined;
  // The proposal a refusal from the code ended FAILED, which its envelope names.
  // Set only from the claim, so no code can name a proposal of its own (step 22's README,
  // decision 5). Found by the review.
  let failedProposal: string | undefined;
  // The answer a claim sealed with its record, whether line ⑪'s record is kept
  //   already, and whether a record that could not be written took the work with it (decision D1).
  let sealedAnswer: Answer | undefined;
  let recordKept = false;
  let nothingKept = false;
  // What undoes a seal whose work was not kept, while one may need undoing, and the one refusal
  //   that says nothing of the work was kept (the review's F1 and F2).
  let undoSeal: (() => void) | undefined;
  const keptNothing = new Refusal("EVIDENCE_STORE_UNAVAILABLE", KEPT_NOTHING);
  // At a release, the rule versions the stored request was decided under.
  let approvedUnderOfRecord: { control: string; version: number }[] | undefined;
  // The mode line ① read, or execute when the envelope names none. A command's
  // record names it (step 23's README, decision 10).
  let modeOfRecord: Mode | undefined;
  // The label of each read the code makes, noted by the bound store. Only the
  // checklist holds this notebook (step 15's README, decision 5).
  const reads = newReads();
  // And the notebook of evidence, which line ⑪ seals into the decision's bundle:
  //   who asks, once line ③ has passed, and how the work ended (step 33's README, D1, D4, and D9).
  const evidence = newEvidence();

  // Every refusal is thrown as a Refusal, which names its code. The catch
  // below turns it, and anything else thrown, into an error envelope (step 04's README, C7).
  // Lines ① to ⑩ are one function, decide, which only works out the answer, so a
  // dry run and a propose_only call return theirs where they stop. The answer is returned after
  // line ⑪, which every call reaches.
  // The bundle the work will be sealed into, built and checked before any work, so
  //   a bundle DSoR could not keep stops the work, as a record it cannot keep stops the answer
  //   (DSOR-EXE-03b). The answer and how the work ended are filled at line ⑪, in DSoR's own words.
  //   Found by step 33's review, finding 1: a bundle that failed at line ⑪ left a drafted payment
  //   with no record and no bundle (step 33's README, D17).
  const presealed = (proposal: string): void => {
    const sure = { outcome: "COMMITTED", correlation } as unknown as Answer;
    const contract = registry.contracts.get(name);
    const decision = decisionOf(
      sure,
      contract,
      true,
      tenantOfRecord,
      claimedTenant,
      undefined,
      under,
      keyOfRecord,
      proposal,
      modeOfRecord,
      conversionOfRecord,
      unconvertibleOfRecord,
      controlsOfRecord,
      denialsOfRecord,
      staleOfRecord,
      approvedUnderOfRecord,
      evidence.asserted,
    );
    const bundle = bundleOf(decision, { ...evidence, executed: "committed" }, contract);
    if (bundle !== undefined) checkBundle(bundle);
  };

  async function decide(): Promise<Answer> {
    // ① Authenticate; build the request security context. Who is calling comes from the
    //   token and DSoR's own table only (DSOR-IDN-01, DSOR-SRC-02a). Then any principal the
    //   arguments name must be the caller (DSOR-SRC-02b), and the request id must be usable
    //   (step 05's README, decisions 6 and 7; step 07's README, decision 8).
    const { caller, copy, key, named } = line(1, () => {
      // The caller's own request id labels every answer, when DSoR can use it (step 05's
      // README, decisions 6 and 7). It is read inside the try, so an envelope whose
      // request_id cannot be read gets an answer, not a throw. Found by step 07's review,
      // and fixed from step 05 on.
      correlation = { request_id: usableRequestId(request) ?? correlation.request_id };
      const found = whoIsCalling(request);
      correlation = { ...correlation, ...callerIds(found) };
      // One copy of the input, made here, once, after the login is found. Every check from
      // here on, and the operation's code, reads this copy. So no check can see a value that
      // the code does not get. Only an input that cannot be copied is read again, to check
      // the claims it makes before line ② refuses it (step 07's README, decision 9). Found
      // by the Stage 2 review, and fixed from step 07 on.
      const copy = jsonCopy(input);
      checkNamedPrincipals(copy === NOT_JSON ? input : copy, found);
      checkRequestId(request);
      // And an idempotency key, when the envelope carries one, must be well
      // formed. It is read here, once, so line ⑦ claims the key that was checked (step 20's
      // README, decision 2).
      const key = checkedKey(request);
      // And the mode, when the envelope names one, read once. A dry run must carry
      // no key (step 23's README, decisions 4 and 6).
      const named = checkedMode(request, key);
      // And nothing in the envelope that DSoR does not read (step 10's
      // README, decision 11).
      checkEnvelopeFields(request);
      // And what the agent says about itself, checked for its shape and read once,
      //   last, into the notebook of evidence. Nothing but the record and the bundle is given it:
      //   no slip, permission, fingerprint, condition, limit, or mask reads it (DSOR-AUD-06,
      //   DSOR-AUD-07; step 33's README, decisions D10 to D12).
      evidence.asserted = checkedAssertion(request, found);
      // Once line ① has passed, a command's record names the mode: execute, when
      // none is named (step 23's README, decision 10).
      modeOfRecord = named ?? "execute";
      return { caller: found, copy, key, named };
    });

    // ② Resolve tenant. The company comes from the envelope, and DSoR checks
    //   in its own table that the caller is a member of it (DSOR-IDN-03a, DSOR-SRC-02a).
    //   Right after ①, before the operation is looked up, so a stranger to a company learns
    //   nothing there (step 10's README, decision 2). Then any company the arguments name
    //   must be the active one (DSOR-SRC-02b; step 10's README, decision 4).
    const tenant = line(2, () => {
      // The envelope comes from outside the program, so it may even be null. Read once.
      const named = request?.tenant;
      if (isTenantId(named)) claimedTenant = named;
      const active = activeTenant(named, caller);
      tenantOfRecord = active;
      // Line ①'s copy, never the input again (step 07's README, decision 9). Found by the
      // Stage 2 review, and fixed from step 07 on.
      if (copy === NOT_JSON) refuseUncopyable(name, input, active);
      checkNamedTenants(copy, active);
      return active;
    });

    // Ours, not §21's: which operation? Lines ③ to ⑤ need its contract (step 07's
    // README, decision 4).
    const contract = registry.contracts.get(name);
    if (contract === undefined) {
      throw new Refusal("UNSUPPORTED_CAPABILITY", `no operation named ${preview(name)}`);
    }
    // Ours, not §21's: a query runs one way only, so it takes no mode, not even
    // execute. Here, before line ③, because line ⑤ reads the mode (step 23's README, decisions 7
    // and 11). A command named with no mode runs in execute mode, the default of §7.3.
    if (contract["kind"] === "query" && named !== undefined) {
      const why = `${JSON.stringify(contract.id)} is a query, which takes no mode`;
      throw new Refusal("VALIDATION_FAILED", why);
    }
    const mode: Mode = named ?? "execute";

    // ③ Resolve delegation; verify the actor chain; establish current authority.
    // Every call from an agent, a read too, runs only under an active slip
    //   that a person signed and DSoR holds, and that allows `unattended`. The person comes
    //   from the slip, never from the request (DSOR-DEL-01a, DSOR-DEL-07, DSOR-DEL-08; step
    //   18's README, decisions 1, 2, and 5). Before line ⑤, which allows only what the slip
    //   and its signer both allow.
    const found = await line(3, async () => {
      const slip = await checkDelegation(caller, contract, registry.delegations, tenant);
      // And any slip the arguments name must be this one. A person calls under none
      // (DSOR-SRC-02b; step 18's README, decision 17). Found by step 18's review.
      checkNamedSlips(copy, slip);
      if (slip === undefined) return undefined;
      // Last, the signer's current authority, from her company's directory:
      //   is she a person who works here, and what does she hold now (DSOR-IDN-05,
      //   DSOR-IDN-06). Last, so an outside failure never hides a refusal that DSoR can make
      //   by itself (step 19's README, decision 12).
      const authority = await registry.roleSource
        .authorityOf(tenant, slip, JSON.stringify(contract.id))
        // When the directory reports her as gone, her slips here are
        //   suspended, with their records, before the call is refused. Line ③ names its own
        //   company and signer, and the call's correlation (DSOR-IDN-07, DSOR-COR-01a; step
        //   19b's README, decisions 4 and 14).
        .catch((thrown: unknown) =>
          suspendThenRefuse(thrown, registry.delegations, tenant, slip.delegator, correlation),
        );
      return { slip, authority };
    });
    if (found !== undefined) {
      const { slip, authority } = found;
      under = {
        delegation: slip.id,
        subject: slip.delegator,
        actor: caller.id,
        // Where DSoR learned what the signer holds, and as of when (step 19's
        // README, decision 7).
        source: authority.source,
        as_of: authority.as_of,
      };
    }
    // Line ③ has passed, so DSoR knows who asks and under whose authority: the
    //   slip's signer and its agent, or the person with the login DSoR gave them. From here on, a
    //   command's decision has a bundle (step 33's README, D1).
    evidence.asker = requesterOf(caller, under, tenant, new Date().toISOString());
    // ④ Check operational status (suspension, freeze, breaker).
    // The emergency brake. A command from an agent that a brake stops, its own or
    //   its company's freeze, is refused, in every mode, with AGENT_SUSPENDED. A query passes, and
    //   so does every call from a person (§18; step 25b's README, decisions L7 and D3). Read from
    //   the store at every call, with no cache, so a brake reaches the next decision
    //   (DSOR-OPS-01b). An operation freeze and a breaker: not built yet.
    // And the breaker of §10.2, after the brake: an operation on the company's
    //   records is refused while that company's connector is out of service, before any claim, so
    //   a retry with the same key is safe. A query too: its read goes there (step 34's README,
    //   decision D4).
    await line(4, async () => {
      await checkBrake(caller, contract, registry.brakes, tenant);
      checkConnector(registry.plugs, tenant, contract);
    });

    // ⑤ Authorize: the caller must hold the permission the contract names (DSOR-AUT-01b).
    // Only the caller's roles in the active company count.
    // For an agent, with the roles its signer holds now, which line ③ found.
    // In the call's mode. In propose_only mode the .propose form is enough (§7.3;
    // step 23's README, decision 5).
    // But not for a release. Line ⑤ runs before DSoR knows which proposal is
    //   released, so line ⑨ decides who may release it, once line ⑧ has loaded it: "the requester,
    //   or a human holding the target permission" (§26.1; step 31's README, decision D12).
    line(5, () => {
      if (releases(contract)) return;
      checkPermission(
        caller,
        contract,
        registry.roles,
        tenant,
        found?.slip,
        found?.authority.roles,
        mode,
      );
    });

    // ⑥ Validate the input against the operation's input schema.
    //   It checks line ①'s copy, the one the code gets (step 07's README, decision 9).
    //   Found by the Stage 2 review, and fixed from step 07 on.
    // Then the copy's fingerprint, its payload hash, which line ⑦ claims the
    //   key with (DSOR-IDM-01b; step 20's README, decision 5).
    // Canonicalizing in full: a request whose text is not valid Unicode has no
    //   canonical JSON, so it has no fingerprint, and line ⑥ refuses it (DSOR-APR-02b; step 29's
    //   README, decision D6).
    const hash = line(6, () => {
      checkInput(name, registry.inputs, copy);
      try {
        return payloadHash(copy);
      } catch (error) {
        if (!(error instanceof NotCanonical)) throw error;
        const why = `${error.message}, so it has no canonical JSON and no fingerprint`;
        throw new Refusal(
          "VALIDATION_FAILED",
          `the input of ${preview(name)} is not valid: ${why}`,
        );
      }
    });

    // Ours, not §21's: every URI in the checked input must name the active
    // company (DSOR-SRC-02b). After ⑥, so it reads the copy that line ⑥ checked, and before
    // "is it built", so a foreign URI is never answered as "not built yet" (step 10's
    // README, decision 4).
    checkUrisInTenant(copy, tenant);
    // A release runs now, so it takes no propose_only mode: a release prepared
    //   would wait for another release (step 31's README, decision D13). A dry run is allowed.
    //   After the check of the URIs' company, so an attempt on another company is refused as one.
    if (releases(contract) && mode === "propose_only") {
      const why = `${JSON.stringify(contract.id)} releases now, so it takes no propose_only mode`;
      throw new Refusal("VALIDATION_FAILED", why);
    }

    // Ours, not §21's: is it built? Never before ⑤, so "not allowed" is never answered as
    // "not built yet" (step 06's README, C5), and never before ⑥ (step 07's README,
    // decision 5).
    const handler = registry.handlers.get(name);
    // Or DSoR's own work, for a command that changes DSoR's own store: its check
    //   at line ⑨, and its change after line ⑩ (step 25's README, decisions D2 and D7).
    const own = registry.own.get(name);
    // And a release, which runs the code of the proposal it loads.
    if (!handler && !own && !releases(contract)) {
      throw new Refusal("UNSUPPORTED_CAPABILITY", `${preview(name)} is not built yet`);
    }
    // A command's code runs. Step 04's decision 1 refused every command
    // here, because its success needs a proposal. Step 17 let it run with an answer of its own
    // shape (step 17's README, outcome 8 and decision 2). Line ⑧ makes the proposal now.

    // ⑨ and ⑩, for a command: DSoR's own read and check, before any work. Line ⑨
    //   reads the state the contract binds, itself: for payment.create, the invoice its input
    //   names, and what the command spends, that invoice's open amount (step 24's README, decision
    //   2). Line ⑩ checks the limits of the slip the call runs under: the limit for one payment,
    //   then the limit for one day. A call that makes a proposal, in execute or propose_only
    //   mode, checks the day's limit by reserving the amount, in one step, keyed by the proposal.
    //   A dry run only checks it (DSOR-DEL-06a, DSOR-DEL-06b, DSOR-DEL-06e; §21: a dry run "takes
    //   no reservation in step 10"; step 24's README, decisions 4, 8, and 9). A person's own call
    //   runs under no slip, so no limit applies (decision 10).
    // What line ⑨ read, which the work's writes are pinned to (step 24's README,
    // decision 16).
    // The invoices line ⑨ read, apart from the vendors it read with them.
    let boundInvoices: Bound["invoices"] = {};
    // And the address of each record line ⑨ bound, by its alias, which a
    //   payment's holds are placed on (step 37's README, decision D6).
    let boundResources: Bound["resources"] = {};
    // The request line ⑨ and line ⑩ decide: its contract, the request, DSoR's own
    //   work for it, who asked for it, the roles they hold now, and the slip it runs under. For a
    //   call, the call itself. For a release, the stored request (step 31's README, decision D1).
    const asCalled = (): Asked => ({
      contract,
      copy,
      own,
      requester: requesterOf(caller, under, tenant, new Date().toISOString()),
      roles:
        found?.authority.roles ??
        caller.memberships.find((m) => m.tenant_id === tenant)?.roles ??
        [],
      slip: found?.slip,
    });
    // What a control's condition may read: Appendix B's eight variables, from DSoR's
    //   own reads and line ⑥'s checked input. The subject is the person: the slip's signer for an
    //   agent's call, with what the directory says the person holds now (DSOR-CTL-06; step 27's
    //   README, decision D5).
    // Of the request asked about: the call's own, or, at a release, the stored
    //   request, for the person or agent that asked for it, with what they hold now.
    const factsOf = (state: Bound["state"], asked: Asked): Facts => {
      const { requester, roles, slip } = asked;
      const level = (asked.contract["risk"] as { level?: unknown } | undefined)?.level;
      return {
        input: structuredClone(asked.copy) as Record<string, unknown>,
        state: structuredClone(state) as Record<string, unknown>,
        principal: { id: requester.subject, type: requester.subject_type, roles: [...roles] },
        actor_chain: [...requester.actor_chain],
        delegation: slip === undefined ? null : (structuredClone(slip) as Record<string, unknown>),
        tenant: tenantOf(tenant, registry.moneyPolicies.get(tenant)),
        risk: String(level ?? ""),
        now: new Date(),
      };
    };
    // And DSoR's own check, at line ⑨, for an operation of DSoR's own. It reads
    //   the slips, inside the claim or, in a dry run, outside it, and changes nothing. Its refusal
    //   is a "no" before any work, as line ⑩'s is: the proposal ends DENIED, the record says DENY,
    //   and every mode hears the same answer (DSOR-EXE-02, DSOR-OPR-05; step 25's README, decision
    //   D7). Found by step 25's review: the check ran inside the work, after DSoR had said yes.
    const decideBeforeWork = async (
      invoices: InvoiceStore,
      store: ReservationStore,
      slips: SlipStore,
      // And the brakes, which the brake's own commands look at.
      brakes: BrakeStore,
      // And the sheets of rates, which line ⑩ converts with.
      rates: RateStore,
      // And the company's rules, which line ⑩ evaluates and line ⑨'s look reads.
      //   Inside the claim, the claim's own store, on its own connection: found by step 28's
      //   review, finding M5. Read through the pool, four calls at once on a pool of two each held
      //   a connection and waited for another, for ever.
      controls: ControlStore,
      // And the proposals, which an approval's look reads: the claim's own, or,
      //   in a dry run, the claim store's, outside any claim.
      proposals: ProposalStore,
      // And the company's payments, which line ⑨ reads when a contract binds one,
      //   and the holds it looks at (step 37's README, decisions D2 and D3).
      looks: { payments: PaymentStore; holds: HoldStore },
      reserveFor?: string,
      // And the request asked about, the call's own unless a release names the
      //   stored one (DSOR-APR-03a).
      asked: Asked = asCalled(),
      // It answers the approvals a control asks for, when one does.
    ): Promise<Requirement[] | undefined> => {
      const { contract, copy, own } = asked;
      const limits = limitsOf(asked.slip);
      const {
        state,
        invoices: read,
        spends,
        resources,
      } = await line(9, async () => {
        // Each record line ⑨ reads goes into the notebook of evidence as it is read, one that
        //   is not there too, before any refusal. One call reads at line ⑨ once (step 33's README,
        //   D5).
        const noted = (read: BoundRead): void => {
          evidence.state.push(stateReadOf(read));
        };
        const bound = await readBound(contract, copy, invoices, tenant, noted, looks.payments);
        // The holds first, before freshness, the version decided on, and one
        //   attempt at a time: a command that binds a record held for an unknown payment hears
        //   RESOURCE_HELD, retried only after reconciliation, whatever else is true (DSOR-UNK-03b;
        //   step 37's README, decision D3). Its own proposal's holds are left out.
        const held = await heldBy(
          looks.holds,
          proposals,
          tenant,
          Object.values(bound.resources),
          reserveFor ?? asked.booked,
        );
        if (held?.state === "OUTCOME_UNKNOWN") throw heldRefusal(held.resource);
        // Each read as fresh as the contract asks, or no decision is made on it,
        //   and no cache stands in (DSOR-FRS-02a, DSOR-FRS-02b; step 32's README, decision D5). At a
        //   release, CURRENT, whatever the contract permits: §26.4 re-evaluates "against CURRENT
        //   state" (DSOR-APR-03a). Found by step 32's review, finding M2: a contract that permits
        //   bounded staleness paid a suspended vendor from a cache four minutes old.
        checkFreshness(contract, bound.labels, Date.now(), asked.release === true);
        // At a release, facts first: a request decided on another version of the
        //   record is refused before any rule is asked (DSOR-APR-03c; step 31's README, D5).
        // And for a call of the company's code, the version its input names, so a
        //   stale request is still stale before it is a conflict, now that the precondition below
        //   comes before the code (DSOR-CON-01b; step 21's README, decision 7). Found while
        //   building: INV-1005 decided on version 2 heard the precondition's CONFLICT.
        const decided =
          asked.decidedOn ??
          (own === undefined ? decidedOnOf(contract, copy).decidedOn : undefined);
        if (decided !== undefined) checkDecidedOn(bound.invoices, decided);
        // One attempt at a time: inside the claim of a new attempt, the invoice's
        //   lock, then another proposal in flight of this operation over it refuses with CONFLICT,
        //   naming it. A dry run takes no lock, and a release takes none either: it is left out of
        //   its own look (DSOR-EXC-01; step 32's README, decisions D6 to D8). Found by step 32's
        //   review, findings L4 and X9: on the database, a dry run took the lock on the pool, and
        //   no test could show what a release's lock protected.
        const locks = reserveFor !== undefined && asked.release !== true;
        await checkExclusive(contract, bound, proposals, tenant, reserveFor ?? asked.booked, locks);
        // A record held for a payment still being sent. A second attempt of the
        //   same operation heard CONFLICT just above: another attempt is running right now, as D3
        //   keeps it. Any other command that binds the record, such as a cancel, waits for that
        //   send to end. Found by step 37's review, F1: a second send heard RESOURCE_HELD.
        if (held !== undefined) throw heldRefusal(held.resource);
        // What another proposal in flight spends is spent: the invoice's open
        //   amount that a precondition reads. The proposal being decided is left out of its own
        //   count (DSOR-EXC-02; step 32's README, decisions D9 and D11).
        const counted = await countInFlight(
          bound,
          proposals,
          tenant,
          registry.contracts,
          reserveFor ?? asked.booked,
        );
        // Then the contract's preconditions, on what DSoR read, for the request
        //   asked about: the call's own, or, at a release, the stored one, against the records as
        //   they are now. The first that does not hold refuses, before any rule or booking
        //   (DSOR-MOD-03, DSOR-CTL-08, DSOR-APR-03a; step 32's README, decisions D3, D4, and D11).
        checkPreconditions(contract, factsOf(counted.state, asked));
        if (own !== undefined)
          await own.check(
            copy,
            // And the rules, with the registry's check of one version.
            lookFor(
              tenant,
              caller,
              slips,
              brakes,
              registry.moneyPolicies,
              rates,
              controls,
              registry.checkRule,
              // And the call's own company's KSoR (step 28b's README, D12).
              policyLook(registry.ksors, tenant),
              // And what an approval looks at (step 29's README, decisions D2,
              //   D5, and D10).
              requesterOf(caller, under, tenant, new Date().toISOString()).identity_mode,
              proposals,
              registry.contracts,
              permissionsOf(caller, registry.roles, tenant),
            ),
          );
        // Line ⑩ reads what DSoR read, never the count: the company's rules and the limits judge
        //   the request's real amount. Found by a sweep of small breaks, M04: with the count, a
        //   contract without the precondition over what is left met the CFO's rule with 0.00, and
        //   was paid without the CFO (step 32's README, decision D9).
        return bound;
      });
      boundInvoices = read;
      boundResources = resources;
      return await line(10, async () => {
        // The company's controls on this operation come first, for every caller. A
        //   condition converts with the newest fresh sheet of the company's source. The most
        //   restrictive answer wins: a control's DENY refuses here, before anything is booked, and a
        //   limit's refusal below is a DENY too. Its words name the operation only (DSOR-AUT-02a,
        //   DSOR-AUT-02b, DSOR-CTL-07; step 27's README, decisions D6, D9, D13, and D15).
        // One read of the newest sheet for the whole line: the controls and the limits convert with
        //   one sheet. Found by step 27's review, finding H2: each read its own, and a sheet loaded
        //   between the two split the decision.
        const once = readOnce(rates);
        // The active versions in the store, read at this call, so a change applies
        //   to the next call (step 28's README, decision D5).
        // And the stale ones, in the same read: a stale rule is never dropped
        //   and never skipped (DSOR-CTL-03b; step 28b's README, decision D7).
        const book = await controls.inForce(tenant, contract.id);
        let outcomes: ControlOutcome[] = [];
        let answer: ControlAnswer = "ALLOW";
        if (book.length > 0) {
          const sheet = await freshSheet(once, tenant, registry.moneyPolicies.get(tenant));
          // Changed in step 33: each amount a condition converts, and the currency it goes into
          //   (step 33's README, D6).
          const used: Converted[] = [];
          // One set of facts for the evaluation and for the reasons of a refusal, so both read one
          //   time (step 28b's README, decision D9).
          const facts = factsOf(state, asked);
          outcomes = evaluateControls(book, contract.id, facts, sheet, used);
          controlsOfRecord = outcomes;
          staleOfRecord = staleOf(book, contract.id);
          // The record names the sheet and the rates a condition converted with, as it names a
          //   limit's (step 26's README, decision L7). Found by step 27's review, finding H2: a
          //   person's draft, which no limit counts, named no sheet at all.
          if (sheet !== undefined && used.length > 0) {
            const { source, published_at, base } = sheet;
            const currencies = new Set(used.flatMap((one) => [one.from.currency, one.to]));
            const usedRates = Object.fromEntries([...currencies].map((c) => [c, sheet.rates[c]!]));
            conversionOfRecord = { source, published_at, base, rates: usedRates };
          }
          // And each conversion, for the bundle (step 33's README, D6).
          evidence.converted.push(...used);
          answer = mostRestrictive(outcomes.map((outcome) => outcome.outcome));
          if (answer === "DENY") {
            denialsOfRecord = denialsOf(book, outcomes, facts);
            const why = `${JSON.stringify(contract.id)} is refused by a control of ${tenant}`;
            throw new Refusal("POLICY_DENIED", why, "public");
          }
        }
        await checkLimits({
          operation: contract.id,
          tenant,
          slip: asked.slip?.id,
          limits,
          spends,
          store,
          ...(reserveFor === undefined ? {} : { reserveFor }),
          ...(asked.booked === undefined ? {} : { booked: asked.booked }),
          // The company's sheets of rates and its money policy, and where to keep
          // what a conversion used (step 26's README, decisions L3, L7, and D4).
          // The line's one read, so the limit's rates join the controls' on one
          //   sheet (step 27's review, finding H2).
          rates: once,
          policy: registry.moneyPolicies.get(tenant),
          converted: (conversion) => {
            const before = conversionOfRecord?.rates ?? {};
            conversionOfRecord = { ...conversion, rates: { ...before, ...conversion.rates } };
          },
          unconvertible: (cause) => {
            unconvertibleOfRecord = cause;
          },
          // And each conversion a limit makes, for the bundle (step 33's README, D6).
          noted: (one) => {
            evidence.converted.push(one);
          },
        });
        // DSoR's own work never waits for an approval. No rule may govern it,
        //   which a draft and start-up check, so a proposal.* command never yields
        //   REQUIRE_APPROVAL (DSOR-APR-08). If a rule ever reached this line, the call fails closed.
        //   Found by step 29's review, finding L3.
        if (answer === "REQUIRE_APPROVAL" && own !== undefined) {
          throw new Error(
            `a rule asks for an approval of ${contract.id}, which is DSoR's own work`,
          );
        }
        // A control that asks for an approval stops the call at PENDING_APPROVAL,
        //   with its booking (step 27's README, decisions D9 and D10).
        return answer === "REQUIRE_APPROVAL" ? requirementsOf(book, outcomes) : undefined;
      });
    };

    // A release loads the proposal its input names, at line ⑧, instead of
    //   making one (§21: "Create the proposal, or load it (proposal.execute)"). Line ⑨ then asks
    //   who may release it and whether it waits to be released (step 31's README, decisions D2
    //   and D7). The gate reads the claim's own store inside the claim, and the claim store's
    //   outside it, in a dry run.
    const released = releases(contract) ? (copy as { proposal: string }).proposal : undefined;
    const releaser = {
      caller,
      slip: found?.slip,
      held: effectivePermissions(
        caller,
        registry.roles,
        tenant,
        found?.slip,
        found?.authority.roles,
      ),
    };
    const gate = async (proposals: ProposalStore, uri: string) =>
      line(9, async () => {
        const id = proposalIdOf(tenant, uri);
        const loaded = await proposals.get(tenant, id);
        if (loaded === undefined) {
          throw new Refusal("RESOURCE_NOT_FOUND", `no proposal ${preview(id)}`, "internal");
        }
        const target = targetOf(registry.contracts, loaded);
        if (target === undefined)
          throw new Error(`proposal ${id} holds an operation with no contract`);
        // The bundle names the request the release decides from here on: the operation as the
        //   proposal keeps it, and the proposal (step 33's README, D8).
        evidence.decided = { operation: loaded.operation, contract: target, proposal: loaded.uri };
        await mayRelease(loaded, target, releaser, () => proposals.isDue(tenant, id));
        // The company's code runs the stored request. DSoR's own work, a brake or a rule prepared
        //   in propose_only mode, is not released in this step: its own look at line ⑨ would
        //   run again first (step 31's README, decision D14).
        const code = registry.handlers.get(target.id);
        if (code === undefined) {
          const why = `releasing ${preview(target.id)}, which is DSoR's own work, is not built yet`;
          throw new Refusal("UNSUPPORTED_CAPABILITY", why);
        }
        return { loaded, target, code };
      });
    // The check again, on live data, for the stored request and whoever asked for
    //   it: its fingerprint, lines ③ to ⑤ for the asker, line ⑨'s read, line ⑩'s rules and limits,
    //   and the approvals against what the rules ask for now (DSOR-APR-03a, DSOR-APR-03b,
    //   DSOR-APR-03c; step 31's README, decisions D1, D3, D5, and D18). Inside the claim, it takes
    //   the brake's and the slip's locks, and finds the booking again by the proposal's id. A dry
    //   run, outside any claim, takes no lock and books nothing, and counts the proposal's own
    //   booking once (D13).
    const checkAgain = async (
      // Changed in step 37: with the payments, which line ⑨ reads when a contract binds one.
      stores: WorkStores,
      loaded: Proposal,
      target: Contract,
      inClaim: boolean,
    ): Promise<void> => {
      const id = proposalIdOf(tenant, loaded.uri);
      await line(9, async () => {
        if (payloadHash(loaded.payload) !== loaded.payload_hash) {
          const why = `proposal ${id}'s stored request does not match its fingerprint`;
          throw new Refusal("APPROVAL_MISMATCH", why, "internal");
        }
      });
      const asker = await line(9, () =>
        askerNow(loaded, target, registry.roles, registry.roleSource, stores, tenant, inClaim),
      );
      // The bundle names the request the release decides, for whom lines ③ to ⑤
      //   checked it again just now, and who released it, in this tutorial's extensions. Found by
      //   step 33's review, finding 4: a person's release named no slip, though line ⑩ judged the
      //   agent's (step 33's README, D15).
      evidence.releasedBy ??= evidence.asker;
      evidence.asker = { ...loaded.requester, subject_authority: { ...asker.authority } };
      const asked: Asked = {
        contract: target,
        copy: loaded.payload,
        own: undefined,
        requester: loaded.requester,
        roles: asker.roles,
        slip: asker.slip,
        ...decidedOnOf(target, loaded.payload),
        ...(inClaim ? {} : { booked: id }),
        release: true,
      };
      if (loaded.requires !== undefined) {
        approvedUnderOfRecord = loaded.requires.map((r) => ({
          control: r.control,
          version: r.control_version,
        }));
      }
      const { invoices, reservations, slips, brakes, rates, controls, proposals } = stores;
      const { payments, holds } = stores;
      // Inside the claim, the booking is found again by the proposal's id, and not made twice (D4).
      // A limit that no usable rate can convert to is a check that cannot be made now: the payment
      //   still does not run (DSOR-MON-04), and it waits for a fresh sheet (D15). Found by step 31's
      //   review, finding M1: a late sheet invalidated an approved payment.
      unconvertibleOfRecord = undefined;
      const requires = await decideBeforeWork(
        invoices,
        reservations,
        slips,
        brakes,
        rates,
        controls,
        proposals,
        { payments, holds },
        inClaim ? id : undefined,
        asked,
      ).catch((thrown: unknown) => {
        if (
          thrown instanceof Refusal &&
          thrown.code === "LIMIT_EXCEEDED" &&
          unconvertibleOfRecord
        ) {
          const why = `no rate is usable now, so proposal ${id} waits: ${thrown.message}`;
          throw new Refusal("FRESHNESS_UNSATISFIABLE", why, "public");
        }
        throw thrown;
      });
      const given = await proposals.approvals(tenant, id);
      // And what it counted, for the bundle (step 33's README, D7).
      evidence.counted = await line(10, () =>
        checkApprovals(loaded, requires ?? [], given, slips, tenant),
      );
    };
    if (released !== undefined) {
      // An address whose id is not a proposal's names no proposal. Line ⑥'s schema lets any id
      //   through, so another company's address met line ②'s refusal first, as for an approval.
      if (!isProposalOf(tenant, released)) {
        throw new Refusal("RESOURCE_NOT_FOUND", `no proposal ${preview(released)}`, "internal");
      }
      // A dry run of a release asks line ⑨, outside any claim, and moves nothing (D13).
      if (mode === "validate_only") {
        try {
          const { loaded, target } = await gate(registry.claims.proposals, released);
          const outside = {
            invoices: registry.invoices,
            reservations: registry.claims.reservations,
            slips: registry.delegations,
            brakes: registry.brakes,
            rates: registry.claims.rates,
            controls: registry.controls,
            proposals: registry.claims.proposals,
            // A dry run writes no note and commits nothing.
            intents: NO_INTENTS,
            // Changed in step 37: and reads the payments, without their lock, and the holds, outside
            //   any claim.
            payments: unlocked(registry.payments),
            holds: registry.claims.holds,
            checkpoint: async () => {},
          };
          try {
            await checkAgain(outside, loaded, target, false);
          } catch (thrown) {
            if (!isOutcome(thrown) || !invalidates(thrown)) throw thrown;
            // The real release would invalidate it. The dry run says so, and moves nothing.
            const id = proposalIdOf(tenant, released);
            const why = `proposal ${id} would be INVALIDATED: ${causeOf(thrown)}`;
            throw new Refusal("APPROVAL_INVALIDATED", why, "internal");
          }
        } catch (thrown) {
          throw maskRefusal(thrown, clearanceOf(caller));
        }
        allowed = true;
        return { outcome: "VALIDATED", decision: "ALLOW", correlation };
      }
      // Before line ⑦, the proposal must be there: line ⑦ keeps an answer beside the
      //   proposal it names, and a proposal that is not there never comes to be.
      if (
        (await registry.claims.proposals.get(tenant, proposalIdOf(tenant, released))) === undefined
      ) {
        const why = `no proposal ${preview(proposalIdOf(tenant, released))}`;
        throw new Refusal("RESOURCE_NOT_FOUND", why, "internal");
      }
    }

    // A dry run stops here, after line ⑩. It skips line ⑦'s claim and line ⑧'s
    //   proposal (§21: "A validate_only invocation skips steps 7 and 8"), and the code, which does
    //   the work, so nothing can be written (DSOR-OPR-06). A "no" was thrown above, as the real
    //   call's would be, so the decision here is ALLOW. Line ⑪ still records it (§7.3; step 23's
    //   README, decisions 2, 3, 8, and 9).
    // After lines ⑨ and ⑩, which are DSoR's own and write nothing. The code still
    //   never runs (step 24's README, decision 8).
    if (mode === "validate_only") {
      let requires: Requirement[] | undefined;
      try {
        requires = await decideBeforeWork(
          registry.invoices,
          registry.claims.reservations,
          registry.delegations,
          registry.brakes,
          // And the claim store's rates, outside any claim.
          registry.claims.rates,
          // And the world's rules, outside any claim.
          registry.controls,
          // And the proposals, outside any claim.
          registry.claims.proposals,
          // And the payments and the holds, outside any claim, so a dry run hears RESOURCE_HELD
          //   as the real call would (DSOR-OPR-06). The payment is read without its lock: a dry run
          //   waits for no send. Found by step 37's review, F4: it waited for the bank's answer.
          { payments: unlocked(registry.payments), holds: registry.claims.holds },
        );
      } catch (thrown) {
        // Masked as the real call's refusal is, as it leaves the claim (step 23's README, decision
        // 3).
        throw maskRefusal(thrown, clearanceOf(caller));
      }
      allowed = true;
      // With the decision the real call would get (step 27's README, decision D12).
      const decision = requires === undefined ? "ALLOW" : "REQUIRE_APPROVAL";
      return { outcome: "VALIDATED", decision, correlation };
    }

    // ⑨ Read bound state at the required freshness; evaluate preconditions. A query's code
    //   reads here, and each read is labelled (step 15). A required freshness and
    //   preconditions: not built yet, step 32.
    // A command's code reads and writes here, and its record follows at line
    //   ⑪. So a record that fails leaves the write behind, until step 36 commits the two
    //   together (step 17's README, decision 1).
    // The code, given the stores it works on. A query gets the registry's. A
    //   command gets its claim's, which on the database work inside the claim's transaction,
    //   so line ⑦ runs this, after it has claimed the key (step 20's README, decision 6).
    // The code may read the database, so call waits for it. A refusal it
    // throws while waiting is caught below, like any other.
    // A query's code is line ⑨'s read, as before. A command's work runs after line
    //   ⑩, with no number of its own: it is the work of §21's line 14, which step 36 puts in its
    //   place, after the intent record (step 24's README, decision 6).
    // And the job it runs: the call's own code and input, or, for a release, the
    //   code of the operation the proposal holds and the request it stored (DSOR-APR-10).
    type Job = { handler: Handler | undefined; own: OwnWork | undefined; input: unknown };
    // The proposal the work runs for, once line ⑧ has opened or loaded it. The bank's
    //   key is derived from it, so every attempt at one payment carries one key (DSOR-IDM-03,
    //   DSOR-IDM-04; step 35's README, decision D3).
    let executing: string | undefined;
    const runCode = (
      stores: WorkStores,
      job: Job = { handler, own, input: copy },
    ): Promise<unknown> => {
      const work = async (): Promise<unknown> => {
        allowed = true;
        // The code works inside the active company only. It gets line ①'s copy, the one
        // every check read (step 07's README, decision 9). Found by the Stage 2 review, and
        // fixed from step 07 on. And it gets that company's invoices, never the store
        // itself, so it cannot name another company (step 10's README, decision 13). Found
        // by the Stage 2 review, and fixed from step 10 on.
        try {
          // And, for a command, that company's payments, bound the same way. A
          // query's code gets none, so a query that writes fails: line ③ lets the agent's query
          // through because a query changes nothing, and this makes that true (step 17's README,
          // "Think it through", finding A).
          // Pinned to what line ⑨ read, so the work drafts only on the version line
          // ⑩ reserved for (step 24's README, decision 16). Found by step 24's review.
          const payments =
            contract["kind"] === "query" ? NO_PAYMENTS : pinned(stores.payments, boundInvoices);
          // DSoR's own change gets DSoR's own stores, inside the claim, with the
          //   caller. The company's code never gets them (step 25's README, decision D2).
          let returned: unknown;
          if (job.own !== undefined) {
            const now = new Date().toISOString();
            // And DSoR's question to the company's own KSoR, for the sweep.
            const ksor = policyLook(registry.ksors, tenant);
            // And every contract, for an approval (step 29's README, decision D7).
            const contracts = registry.contracts;
            // And the company's bank, for an operation that asks it.
            const bank = ASKS_BANK.has(contract.id) ? registry.plugs.bankOf(tenant) : undefined;
            const work = { tenant, caller, stores, correlation, now, ksor, contracts, bank };
            returned = await job.own.change(job.input, work);
          } else if (job.handler !== undefined) {
            // And the company's bank, for an operation that sends money, with a
            //   proposal. The code sends an order; DSoR adds the key and waits, and the code never
            //   sees either (step 35's README, decisions D3 and D6). Only an operation on the list
            //   gets a bank: for a release, the one it runs. Found by step 35's review, F7.
            const bankLine = registry.plugs.bankOf(tenant);
            const sending = executing;
            const running = "target" in job ? (job as { target: Contract }).target.id : contract.id;
            // Whether the bank may have sent: true once it was asked, unless it said it sent
            //   nothing.
            let sent = false;
            // Whether the note was written and committed. From then on the
            //   claim and the proposal cannot be rolled back (decision D2).
            let noted = false;
            const bank: CompanyBank =
              !SENDS_MONEY.has(running) || bankLine === undefined || sending === undefined
                ? NO_BANK
                : Object.freeze({
                    send: async (order: BankOrder) => {
                      const id = proposalIdOf(tenant, sending);
                      const key = bankKeyOf(tenant, id);
                      // The note, then the checkpoint, then the bank (DSOR-EXE-03a).
                      //   The note names the proposal as it is kept, the claim this call holds, the
                      //   bank's connector, and who asked now. A note that cannot be written stops
                      //   the payment: the bank is never asked, and the claim rolls back, so the
                      //   same key runs again (DSOR-EXE-03b; decisions D1 and D2).
                      if (noted) throw new Error("the work sent a second order for one proposal");
                      const proposal = await stores.proposals.get(tenant, id);
                      if (proposal === undefined) throw new Error(`proposal ${id} is not kept`);
                      if (keyOfRecord === undefined)
                        throw new Error("a bank was asked with no claim");
                      const now = new Date().toISOString();
                      // And the holds, with the note, in its transaction, before
                      //   the bank is asked: every record the running contract's hold_on_unknown
                      //   names, at the address line ⑨ bound it. So a silent bank, a lost
                      //   connection, and a crash all find them placed (DSOR-UNK-03b; step 37's
                      //   README, decision D6).
                      const runningContract =
                        "target" in job ? (job as { target: Contract }).target : contract;
                      // A listed alias with no address is a bug start-up refuses; one here stops the
                      //   payment before the note. Found by step 37's review, F2.
                      const held = holdsOf(runningContract).map((alias) => {
                        const at = boundResources[alias];
                        if (at === undefined) throw new Error(`${alias} has no address to hold`);
                        return at;
                      });
                      try {
                        await stores.holds.place(tenant, id, held);
                        await stores.intents.write(tenant, {
                          proposal_id: id,
                          tenant_id: tenant,
                          operation: proposal.operation,
                          payload_hash: proposal.payload_hash,
                          principal: caller.id,
                          claim_operation: contract.id,
                          idempotency_key: keyOfRecord.key,
                          connector: registry.plugs.connectorOf(tenant).bank,
                          security_context: { ...requesterOf(caller, under, tenant, now) },
                        });
                      } catch {
                        const why =
                          "DSoR could not write down what it was about to do, so it did not ask the bank";
                        throw new Refusal("EVIDENCE_STORE_UNAVAILABLE", why);
                      }
                      await stores.checkpoint();
                      noted = true;
                      // The checkpoint's COMMIT let go of the payment's lock. It is taken again
                      //   before the bank is asked, and the payment must still be a draft: a cancel
                      //   that came in between ends the work FAILED, and the bank is never asked.
                      //   Found while building: without it, a cancel landed during the send.
                      const again = await stores.payments.get(tenant, order.payment);
                      if (again?.status !== "draft") {
                        const why = `payment ${preview(order.payment)} changed while DSoR wrote its note, so it was not sent`;
                        throw new Refusal("CONFLICT", why, "internal");
                      }
                      //   And the brake's lock and the slip's, which the COMMIT let go too, so a pull
                      //   or a tear-up still waits for the send. One that came in between ends the
                      //   work FAILED, and the bank is never asked. Found by step 36's review, M3.
                      await holdBrake(caller, contract, stores.brakes, tenant);
                      await holdSlip(caller, contract, under?.delegation, stores.slips, tenant);
                      try {
                        await sendThrough(bankLine, key, order);
                        sent = true;
                      } catch (thrown) {
                        const nothing =
                          thrown instanceof Refusal && thrown.code === "CONNECTOR_UNAVAILABLE";
                        if (!nothing) sent = true;
                        throw thrown;
                      }
                    },
                  });
            try {
              returned = await job.handler(
                job.input,
                companyOf(stores.invoices, tenant, reads, payments, bank),
              );
              return checkAnswerInTenant(returned, tenant);
            } catch (thrown) {
              // Once the money may have left, the work ends COMMITTED or OUTCOME_UNKNOWN, never
              //   anything else. An accident would undo the claim and the proposal, and a retry
              //   would get a new proposal and a new key, and pay again. A refusal would end the
              //   proposal FAILED, out of flight. Found by step 35's review, F1 (DSOR-UNK-01b).
              const unknown = thrown instanceof Refusal && thrown.code === "OUTCOME_UNKNOWN";
              // After the note, a bank that said it sent nothing ends the work
              //   FAILED, kept with the claim, because the claim was committed with the note.
              //   Anything else after the note is OUTCOME_UNKNOWN, as a crash there is once the
              //   sweep has found its note (DSOR-EXE-04b; decision D5).
              //   The retry is safe, as the code's class says, and the claim gives this answer
              //   back to the same key without running again (DSOR-IDM-01c), so the words say a
              //   new key pays. Open question 149.
              if (noted && !sent && thrown instanceof Refusal && !unknown) {
                const words = `${thrown.message}; this idempotency_key keeps this answer, so send the payment again with a new key`;
                throw keptAfterNote(new Refusal(thrown.code, words, thrown.label));
              }
              if ((!sent && !noted) || unknown) throw thrown;
              const why = sent
                ? "the bank was asked to send the payment, and then the work failed, so it may or may not have been sent"
                : "DSoR wrote down that it would pay, and then the work failed, so the payment may or may not have been sent";
              throw new Refusal("OUTCOME_UNKNOWN", why, "internal");
            }
          } else {
            throw new Error("an operation with no code reached its work");
          }
          // The company check below runs here too, inside the claim, so a
          // command whose answer holds another company's row keeps neither its work nor its
          // claim (step 20's README, decision 6).
          return checkAnswerInTenant(returned, tenant);
        } finally {
          // Line ⑨ ends here, so the company the code was given reads nothing
          // more (step 15's README, decision 5). Found by the review. Since step 17, it writes
          // nothing more either.
          reads.closed = true;
        }
      };
      return contract["kind"] === "query" ? line(9, work) : work();
    };

    // ⑦ Idempotency claim. Commands only, so a query that carries no key skips
    //   it. A command must carry a key and a query must carry none (DSOR-IDM-01a; step 20's
    //   README, decision 3). The key is claimed with the fingerprint, inside the company, by
    //   this caller, for this operation, and the code runs inside the claim (DSOR-IDM-01b). The
    //   same key and the same request get the recorded outcome, and the code does not run
    //   again (DSOR-IDM-01c). A different request is refused (DSOR-IDM-01d).
    // ⑧ Create the proposal. Commands only, inside the claim, after line ⑦ has
    //   claimed the key, so a replay gets the first call's proposal and makes none (DSOR-IDM-04).
    //   The proposal keeps the request as line ⑥ checked it, the URIs it names, and who asked. It
    //   moves PROPOSED, READY, and EXECUTING before the code runs, and COMMITTED or FAILED once
    //   the code ends, each move with its record, only along the picture of §26.2 (DSOR-APR-01a,
    //   DSOR-APR-01b, DSOR-APR-01c; step 22's README, decisions 2, 4, and 9). Loading a proposal
    //   for proposal.execute: not built yet, step 31.
    // In propose_only mode, the claim keeps the call's mode, and the proposal
    //   moves PROPOSED and READY, and waits there. The code does not run (step 23's README,
    //   decisions 1, 4, and 12).
    let returned: unknown;
    // What the answer describes: the call's own request and contract, or, for a
    //   release, the request that ran and the contract of its operation. Its fingerprint, the
    //   kind of its answer, and its semantics are the stored request's (DSOR-APR-10).
    let answered: { hash: string; contract: Contract } = { hash, contract };
    // What follows the claim, as its own function, so the claim's transaction
    //   can run it before its COMMIT and keep the record it leads to (decision D1). It gives the
    //   answer of a call that waits, throws a refusal, or sets the value that the tail shapes.
    // And the proposals it reads: the claim's own, inside its transaction, so a
    //   read waits for no other connection. Found while building: through the pool, two releases
    //   at once each held a connection and waited for the other's.
    // What a replay of an unknown outcome answers, once its proposal is settled.
    const settledSince = async (claimed: Claimed, proposals: ProposalStore): Promise<Claimed> => {
      const unknown = "refused" in claimed && claimed.refused.code === "OUTCOME_UNKNOWN";
      if (claimed.replay_of === undefined || !unknown || claimed.proposal === undefined) {
        return claimed;
      }
      const now = await proposals.get(tenant, proposalIdOf(tenant, claimed.proposal));
      const payment = (now?.payload as { payment?: unknown } | undefined)?.payment;
      if (now?.state === "COMMITTED" && typeof payment === "string") {
        // The payment as it is now, read without its lock, as a replay waits for no send. Only a
        //   paid one answers COMMITTED (found by step 38's review, F8).
        const value = await unlocked(registry.payments).get(tenant, parseUri(payment).id);
        if (value?.status !== "paid") return claimed;
        return { value, proposal: claimed.proposal, replay_of: claimed.replay_of };
      }
      if (now?.state === "FAILED") {
        // CONFLICT, whose retry is never: the same key can only hear this again (found by step
        //   38's review, F6).
        const why =
          "reconciliation found that the bank never received this payment; send it again with a new key";
        const refused = new Refusal("CONFLICT", why, "internal");
        return { refused, proposal: claimed.proposal, replay_of: claimed.replay_of };
      }
      return claimed;
    };
    const afterClaim = async (
      scope: ClaimScope,
      kept: Claimed,
      proposals: ProposalStore = registry.claims.proposals,
    ): Promise<Answer | undefined> => {
      // A replay whose kept answer is OUTCOME_UNKNOWN is looked up again against its
      //   proposal: once reconciliation has settled it, the retry answers the settled outcome. The
      //   kept answer is never rewritten (step 38's README, decision D4).
      const claimed = await settledSince(kept, proposals);
      // How the work ended, for the bundle: committed, failed, or not executed. A
      //   replay ran nothing (step 33's README, D9).
      evidence.executed = executedOf(claimed);
      if (claimed.replay_of !== undefined) {
        // A replay passed every line its first call passed, so its record says what the first
        // call's said, and names the call whose outcome it gives back (step 20's README,
        // decision 8).
        // A first call that lines ⑨ and ⑩ refused was denied, and so is its
        // replay. Found by step 24's review: the replay's record said ALLOW (decision 17).
        allowed = claimed.denied !== true;
        keyOfRecord = { key: scope.key, replay_of: claimed.replay_of };
      }
      // Every command's claim gives its proposal back. None is a bug.
      if (claimed.proposal === undefined) throw new Error("a command's claim kept no proposal");
      proposalOfRecord = claimed.proposal;
      // A refusal the code gave is an outcome, and comes back like any other (step 20's
      // README, decision 9).
      // Its envelope names the proposal that ended FAILED, or, since step 24, DENIED.
      if ("refused" in claimed) {
        failedProposal = claimed.proposal;
        throw claimed.refused;
      }
      // A propose_only call stops here, after line ⑩. Its proposal waits READY,
      //   and the code never ran, so there is no data to check, mask, or measure. The
      //   answer names the proposal, the request's fingerprint, and the contract's semantics, as
      //   result-envelope.schema.json asks of READY (DSOR-OPR-05; step 23's README, decisions 1,
      //   8, and 9).
      // A call that a control stopped waits for its approval, in every mode, and
      //   the code never ran. The answer names what it requires and when it expires, as
      //   result-envelope.schema.json asks of PENDING_APPROVAL (step 27's README, decision D10).
      if ("pending" in claimed) {
        allowed = true;
        return {
          outcome: "PENDING_APPROVAL",
          proposal: claimed.proposal,
          payload_hash: hash,
          requires: claimed.pending.requires,
          semantics: semanticsOf(contract),
          expires_at: claimed.pending.expires_at,
          correlation,
        };
      }
      if ("ready" in claimed) {
        allowed = true;
        return {
          outcome: "READY",
          proposal: claimed.proposal,
          payload_hash: hash,
          semantics: semanticsOf(contract),
          correlation,
        };
      }
      returned = claimed.value;
      // Read again after the claim, so a replay, whose claim ran nothing, describes it too.
      if (released !== undefined) {
        const ran = await proposals.get(tenant, proposalIdOf(tenant, released));
        const target = ran === undefined ? undefined : targetOf(registry.contracts, ran);
        if (ran === undefined || target === undefined) {
          throw new Error("a release that ran has no proposal, or no operation");
        }
        answered = { hash: ran.payload_hash, contract: target };
        // And the bundle names what was released, a replay's too. Found by step
        //   33's review, finding 5: a replay's bundle named proposal.execute@1.
        evidence.decided = { operation: ran.operation, contract: target, proposal: ran.uri };
      }
      return undefined;
    };
    // And the tail, which shapes the answer from the value, as its own function.
    const tail = (): Answer => {
      // Ours, not §21's: every tenant_id in the code's answer must be the active company's.
      // Right after ⑨, before anything else reads the answer. Another company's row is a bug
      // in the code, so the call fails with INTERNAL_ERROR, and its record says ALLOW. The
      // check reads DSoR's own copy of the answer, and the caller gets that copy (step 10's
      // README, decision 14). Found by the Stage 2 review, and fixed from step 10 on.
      // A replay's recorded answer is checked again here, as it leaves, and so is
      // everything below (step 20's README, decision 7).
      const data = checkAnswerInTenant(returned, tenant);
      // Ours, not §21's. For an agent, every field above its clearance is
      // left out before the answer leaves (DSOR-CLS-02a). The contract names the kind of its
      // answer. Masking walks the copy the company check made, so the answer, its record, and
      // the check all read one copy (step 14's README, decision 3). Found by the Stage 2
      // review, and fixed from step 14 on. Masking comes before the size check, so the size
      // measured below is the size that leaves (step 14's README, decision 5).
      const kind = (answered.contract["output"] as { schema: string }).schema;
      const shown = show(data, kind, registry.classifications, clearanceOf(caller));
      // Ours, not §21's. No query's result leaves larger than DSoR gives in
      // one call, whoever wrote its code, a list or not (DSOR-QRY-01; step 13's README,
      // decision 3). Its code ran, so its record says ALLOW, with this refusal as its result.
      // A command's answer passes here too: one draft is far below the limit, so only a bug
      // reaches it.
      checkResultSize(shown.data, shown.redactions);
      // ⑩ Evaluate controls, segregation of duties, and limits. Segregation of duties between a request
      //   and its approval runs at line ⑨ of proposal.approve, since step 30 (step 30's README, decision
      //   D3). Incompatible operations by one person (DSOR-SOD-03a) are not built. Found by step 30's
      //   review, finding L1: this said segregation of duties was not built.
      // The controls and the limits are built. They run above, before the work, where §21 puts them
      //   (step 27's README, decision D9). Found by step 27's review: this said the controls were not
      //   built.

      // A query's answer is { data, correlation } (step 04's README, decision 3).
      // With its label (DSOR-CLS-03), and the fields left out, when there are
      // any (DSOR-CLS-02b).
      const { classification, redactions, resources } = shown;
      const listed = redactions.length > 0 ? { redactions } : {};
      if (contract["kind"] === "query") {
        // The answer's label, from the labels its reads left. Nothing since the
        // copy waited, so no read can have been noted after it: the label covers every read
        // whose rows could be in the copy. Last of the checks, so an answer refused for another
        // reason is refused for that one. A query that read nothing is a bug in its code
        // (DSOR-FRS-01a; step 15's README, decision 6).
        // The label names the record's version only when the caller may see the
        // version itself. Masking withheld it, so the label leaves it out too. Found by the
        // review: an agent whose clearance hid the version read it in the label (DSOR-CLS-02a;
        // step 21's README, decision 9).
        const label = stalest(reads);
        const hidden = redactions.some((redaction) => redaction.field === "version");
        const freshness = hidden ? withoutVersion(label) : label;
        read = { resources, classification, freshness };
        return { data: shown.data, classification, ...listed, freshness, correlation };
      } else {
        // A command's answer states the semantics its contract declares, never
        // a word of its code (DSOR-EXE-05b). No freshness: DSOR-FRS-01a names query results,
        // and a write is not a read (step 17's README, decision 2).
        const semantics = semanticsOf(answered.contract);
        // The outcome, the proposal, and the fingerprint of the request, so the
        // answer passes result-envelope.schema.json (DSOR-SCH-01; step 22's README, decision 5).
        if (proposalOfRecord === undefined) throw new Error("a command answered with no proposal");
        read = { resources, classification };
        return {
          outcome: "COMMITTED",
          proposal: proposalOfRecord,
          payload_hash: answered.hash,
          data: shown.data,
          classification,
          ...listed,
          semantics,
          correlation,
        };
      }
    };
    // The whole answer of a claim's first call, as the caller will hear it,
    //   masked as it leaves.
    const finish = async (
      scope: ClaimScope,
      claimed: Claimed,
      proposals: ProposalStore,
    ): Promise<Answer> => {
      try {
        try {
          const early = await afterClaim(scope, claimed, proposals);
          if (early !== undefined) return early;
        } catch (thrown) {
          throw maskRefusal(thrown, clearanceOf(caller));
        }
        return tail();
      } catch (thrown) {
        return toEnvelope(thrown, correlation, failedProposal);
      }
    };
    // Line ⑪ inside the claim's transaction, after its outcome is kept and before
    //   its COMMIT. The record and its bundle are written through the claim's own transaction, so
    //   the work, its outcome, and its record commit together, or none of them does
    //   (DSOR-EXE-04a; decisions D1 to D3). A record that cannot be written takes the work with
    //   it: nothing of the call is kept, and the same key runs it again (DSOR-EXE-03b).
    const sealWith = async (
      scope: ClaimScope,
      stores: WorkStores,
      claimed: Claimed,
    ): Promise<void> => {
      // What the record says, as it was before the seal, to put back if the work is not kept.
      const before = {
        allowed,
        keyOfRecord,
        proposalOfRecord,
        failedProposal,
        read,
        returned,
        answered,
        executed: evidence.executed,
        decided: evidence.decided,
      };
      undoSeal = () => {
        ({ allowed, keyOfRecord, proposalOfRecord, failedProposal, read, returned, answered } =
          before);
        evidence.executed = before.executed;
        evidence.decided = before.decided;
        sealedAnswer = undefined;
        undoSeal = undefined;
      };
      const answer = await finish(scope, claimed, stores.proposals);
      try {
        await line(11, () => keep(recordOf(answer), stores.transaction));
      } catch {
        throw keptNothing;
      }
      sealedAnswer = answer;
    };
    try {
      if (contract["kind"] === "query" && key === undefined) {
        // A query makes no proposal, so its stores hold none to write (decision 7).
        returned = await runCode({
          invoices: registry.invoices,
          payments: registry.payments,
          proposals: NO_PROPOSALS,
          reservations: NO_RESERVATIONS,
          // And no slip to tear up.
          slips: NO_SLIPS,
          // And no brake to pull or lift.
          brakes: NO_BRAKES,
          // And no sheet of rates to load or read.
          rates: NO_RATES,
          // And no rule to change.
          controls: NO_CONTROLS,
          // And no note to write, and nothing to commit.
          intents: NO_INTENTS,
          holds: NO_HOLDS,
          checkpoint: async () => {},
        });
      } else {
        // A seal that ran, and whose work was not kept, undoes what it set for the
        //   record. Found by step 36b's review, F2: a COMMIT that failed after the seal left the
        //   record naming a proposal that was rolled back.
        let seven: { scope: ClaimScope; claimed: Claimed };
        try {
          seven = await line(7, async () => {
            const scope = claimScope(contract, key, tenant, caller.id);
            // Named in the record from here on, a refusal of the key too.
            keyOfRecord = { key: scope.key };
            // A release's line ⑧ loads the proposal, and line ⑨'s gate decides,
            //   inside the claim. A refusal there is kept with the claim, beside the loaded
            //   proposal, which it leaves where it was. A release that passes reads the state the
            //   stored request binds, moves the proposal to EXECUTING, and runs the stored request
            //   with the code of the operation it holds, pinned to what it read. Its last move and
            //   its booking's end follow, as a draft's do (DSOR-APR-10; step 31's README, decisions D4
            //   and D10).
            if (released !== undefined) {
              let job: (Job & { loaded: Proposal; target: Contract }) | undefined;
              const steps: ProposalSteps = {
                open: (stores) =>
                  line(8, async () => {
                    let gated: Awaited<ReturnType<typeof gate>>;
                    try {
                      gated = await gate(stores.proposals, released);
                    } catch (thrown) {
                      if (isOutcome(thrown)) return { proposal: released, refused: thrown };
                      throw thrown;
                    }
                    const { loaded, target, code } = gated;
                    const id = proposalIdOf(tenant, released);
                    // The release runs the proposal it loaded.
                    executing = released;
                    // The check again, on live data, for the stored request and whoever asked for it:
                    //   its fingerprint, lines ③ to ⑤ for the asker, line ⑨'s read, line ⑩'s rules and
                    //   limits, and the approvals against what the rules ask for now. A "no" moves the
                    //   proposal to INVALIDATED, gives its booking back, and is what the caller hears.
                    //   A check that cannot be made now leaves it waiting (DSOR-APR-03a, DSOR-APR-03b,
                    //   DSOR-APR-03c; step 31's README, decisions D1, D3, D5, D6, D8, and D15).
                    try {
                      await checkAgain(stores, loaded, target, true);
                    } catch (thrown) {
                      if (!isOutcome(thrown) || !invalidates(thrown)) throw thrown;
                      const by = {
                        mover: dsorMover(loaded.requester),
                        cause: `the check at the release refused it: ${thrown.code}`,
                        correlation,
                      };
                      if (
                        !(await stores.proposals.move(tenant, id, loaded.state, "INVALIDATED", by))
                      ) {
                        const why = `proposal ${id} was released by another call`;
                        const refused = new Refusal("CONFLICT", why, "internal");
                        return { proposal: released, refused };
                      }
                      await stores.reservations.release(tenant, id);
                      const why = `proposal ${id} is INVALIDATED: ${causeOf(thrown)}`;
                      const refused = new Refusal("APPROVAL_INVALIDATED", why, "internal");
                      return { proposal: released, refused };
                    }
                    // The proposal's time is read again, by the store's clock, after the check again,
                    //   which may wait for the company's directory: an approval expires with its
                    //   proposal (DSOR-APR-04a). Found by step 31's review, finding M2: a release that
                    //   began a moment before the expiry ran after it.
                    if (await stores.proposals.isDue(tenant, id)) {
                      return { proposal: released, refused: timeCame(loaded) };
                    }
                    // The bundle is checked before the work runs (step 33's README,
                    //   D17).
                    presealed(released);
                    // The move to EXECUTING names who released it. It moves only a proposal still in
                    //   the state the gate read, so of two releases at once, one moves it, and the
                    //   other hears CONFLICT (D10).
                    const now = new Date().toISOString();
                    const mover = callerMover(requesterOf(caller, under, tenant, now));
                    const by = { mover, cause: `released by ${caller.id}`, correlation };
                    if (!(await stores.proposals.move(tenant, id, loaded.state, "EXECUTING", by))) {
                      const why = `proposal ${id} was released by another call`;
                      const refused = new Refusal("CONFLICT", why, "internal");
                      return { proposal: released, refused };
                    }
                    job = { handler: code, own: undefined, input: loaded.payload, loaded, target };
                    return { proposal: released };
                  }),
                // The proposal's last move, COMMITTED or FAILED, by DSoR, as a draft's. Then its
                //   booking: committed with COMMITTED, so it stays counted on the day it was drafted,
                //   and released with FAILED (D4).
                close: async (stores, proposal, outcome) => {
                  if (job === undefined)
                    throw new Error("a release closed a proposal it never ran");
                  const ending: Opening = {
                    tenant,
                    draft: job.loaded,
                    correlation,
                    lifetime: lifetimeOf(registry, tenant),
                  };
                  await closeProposal(stores.proposals, ending, proposal, outcome);
                  const id = proposalIdOf(tenant, proposal);
                  // And its note, if the work wrote one.
                  await endNote(stores, tenant, id, outcome);
                  if ("value" in outcome) await stores.reservations.commit(tenant, id);
                  else if (!isUnknown(outcome)) await stores.reservations.release(tenant, id);
                },
              };
              const running = (stores: WorkStores): Promise<unknown> => {
                if (job === undefined) throw new Error("a release ran before its proposal opened");
                return runCode(stores, job);
              };
              return {
                scope,
                claimed: await registry.claims.run(
                  scope,
                  hash,
                  mode,
                  correlation.request_id,
                  running,
                  steps,
                  (stores, claimed) => sealWith(scope, stores, claimed),
                ),
              };
            }
            // What line ⑧ writes, made here, so the claim's work never reads the request again.
            const opening: Opening = {
              tenant,
              draft: {
                operation: `${contract.id}@${String(contract["version"])}`,
                mode,
                payload: copy,
                payload_hash: hash,
                resources: urisIn(copy),
                requester: requesterOf(caller, under, tenant, new Date().toISOString()),
                idempotency_key: scope.key,
                // And the record its operation is exclusive over, for the database's
                //   key (DSOR-EXC-01; step 32's README, decision D7).
                ...(exclusiveOf(contract, copy) === undefined
                  ? {}
                  : { exclusive_over: exclusiveOf(contract, copy)! }),
              },
              correlation,
              // The company's READY lifetime. Start-up refused a registry without
              // one for every company where a login works (step 25c's README, claim C6).
              lifetime: lifetimeOf(registry, tenant),
            };
            // Line ⑧ makes the proposal, PROPOSED. Then lines ⑨ and ⑩ decide it,
            //   inside the claim's transaction. Their refusal ends the proposal DENIED, and the claim
            //   keeps it, as it keeps a refusal of the code. An accident is thrown on, and rolls the
            //   claim back (step 24's README, decision 6). Line ⑩ reserves in propose_only mode too:
            //   §21 takes no reservation only for a dry run, and §26.4 finds "the reservation taken
            //   when the proposal was created" again at the release. Found by step 24's review
            //   (decision 9).
            const steps: ProposalSteps = {
              open: (stores) =>
                line(8, () =>
                  openProposal(stores.proposals, opening, async (proposal) => {
                    try {
                      const reserveFor = proposalIdOf(tenant, proposal);
                      // The work, if it runs, runs for this proposal.
                      executing = proposal;
                      // Line ④ again, right after line ⑧, inside the claim's
                      //   transaction, under the brake's lock. A draft that passed line ④ a moment
                      //   before a brake waits for the pull, then is refused, and its proposal ends
                      //   DENIED. A pull waits for a draft that is past this point. So no proposal of
                      //   a braked agent enters EXECUTING after the brake takes effect (DSOR-OPS-01c;
                      //   step 25b's README, decisions L8, D4, and D8).
                      const { invoices, reservations, slips, brakes, rates, controls, proposals } =
                        stores;
                      await holdBrake(caller, contract, brakes, tenant);
                      // And line ③ again, under the slip's lock. A draft that passed
                      //   line ③ a moment before a tear-up waits for it, then is refused, and its
                      //   proposal ends DENIED. A tear-up waits for a draft that is past this point.
                      //   So the tear-up cancels a prepared draft, never leaves it READY (step 25c's
                      //   README, decision D12).
                      await holdSlip(caller, contract, under?.delegation, slips, tenant);
                      const requires = await decideBeforeWork(
                        invoices,
                        reservations,
                        slips,
                        brakes,
                        rates,
                        controls,
                        proposals,
                        { payments: stores.payments, holds: stores.holds },
                        reserveFor,
                      );
                      // When the work will run, its bundle is checked first
                      //   (step 33's README, D17).
                      if (requires === undefined && mode === "execute") presealed(proposal);
                      // A control's approval stops the proposal at PENDING_APPROVAL.
                      return requires === undefined ? undefined : { requires };
                    } catch (thrown) {
                      if (isOutcome(thrown)) return thrown;
                      throw thrown;
                    }
                  }),
                ),
              // And the reservation's end, with the proposal's: committed with
              //   COMMITTED, so it stays counted, and released with FAILED, so the day gets it back
              //   (DSOR-DEL-06c, DSOR-DEL-06d; step 24's README, decision 7).
              close: async (stores, proposal, outcome) => {
                await closeProposal(stores.proposals, opening, proposal, outcome);
                const id = proposalIdOf(tenant, proposal);
                // And its note, if the work wrote one.
                await endNote(stores, tenant, id, outcome);
                if ("value" in outcome) await stores.reservations.commit(tenant, id);
                else if (!isUnknown(outcome)) await stores.reservations.release(tenant, id);
              },
            };
            return {
              scope,
              claimed: await registry.claims.run(
                scope,
                hash,
                mode,
                correlation.request_id,
                runCode,
                steps,
                (stores, claimed) => sealWith(scope, stores, claimed),
              ),
            };
          });
        } catch (thrown) {
          undoSeal?.();
          // Only the claim's own "kept nothing" means that nothing was kept. Found by step 36b's
          //   review, F1: after the bank was asked, a seal's refusal is not what the claim says.
          if (thrown === keptNothing) nothingKept = true;
          throw thrown;
        }
        const { scope, claimed } = seven;
        // A first call whose record committed with its claim is answered as it
        //   was sealed, and line ⑪ below keeps nothing more. A replay, and an outcome nobody
        //   could seal, go on as before.
        if (claimed.sealed === true && sealedAnswer !== undefined) {
          recordKept = true;
          undoSeal = undefined;
          return sealedAnswer;
        }
        undoSeal?.();
        const early = await afterClaim(scope, claimed);
        if (early !== undefined) return early;
      }
    } catch (thrown) {
      // A refusal the code throws is masked as its answer would be
      // (DSOR-CLS-02a; step 14's README, decision 8).
      // Here, as it leaves, so a refusal the claim kept is masked for the caller
      // now, as a replay's value is. Line ⑦'s own refusals are public, and pass unchanged
      // (step 20's README, decision 7).
      throw maskRefusal(thrown, clearanceOf(caller));
    }
    return tail();
  }

  // The record of an answer, and its bundle, for a command past line ③: the log keeps both or
  //   neither, and the record names its bundle (step 33's README, D1 and D2). Built inside line
  //   ⑪'s try, so even a bug there gives no answer.
  // Its own function, so the claim's transaction can build it too.
  function recordOf(answer: Answer): { decision: Decision; bundle: DecisionBundle | undefined } {
    const decision = decisionOf(
      answer,
      registry.contracts.get(name),
      allowed,
      tenantOfRecord,
      claimedTenant,
      read,
      under,
      keyOfRecord,
      proposalOfRecord,
      modeOfRecord,
      conversionOfRecord,
      unconvertibleOfRecord,
      controlsOfRecord,
      denialsOfRecord,
      staleOfRecord,
      approvedUnderOfRecord,
      evidence.asserted,
    );
    const bundle = bundleOf(decision, evidence, registry.contracts.get(name));
    if (bundle === undefined) return { decision, bundle };
    return { decision: { ...decision, decision_bundle: bundle.decision_id }, bundle };
  }

  // A record and its bundle into the log, inside the claim's transaction when one
  //   is given (decision D1).
  function keep(
    record: { decision: Decision; bundle: DecisionBundle | undefined },
    within?: ClaimTransaction,
  ): Promise<void> {
    return log.add(record.decision, record.bundle, within);
  }

  let answer: Answer;
  try {
    answer = await decide();
  } catch (thrown) {
    // toEnvelope never throws, so no throw above can skip line ⑪. Found by step 08's
    // review, and fixed in toEnvelope from step 04 on.
    answer = toEnvelope(thrown, correlation, failedProposal);
  }

  // ⑪ Record the decision, including every refusal (DSOR-EXE-02). Every answer comes
  //   through here before it leaves: a success, every refusal, and a bug. A throw anywhere
  //   above cannot skip it (step 08's README, C2).
  // Building the record is inside the try too, so even a bug there gives no answer.
  // Await. The answer waits until the database has committed the record,
  // and a database that refuses it lands in the catch (step 09's README, C2 and C4).
  // Unless the claim kept the record with its work already (decision D1).
  try {
    if (!recordKept) await line(11, () => keep(recordOf(answer)));
  } catch {
    // A command whose code ran may have changed something, and DSoR cannot
    // prove it did not. Until step 20 its answer never said a retry was safe: with no key, a
    // retry could write a second draft (the reason behind DSOR-ERR-02; step 17's README,
    // decision 17). Found by break B1.
    // Now every command that reaches its code holds a claim. A retry with the
    // same key gets the claim's outcome, or runs once if the work rolled back. So the
    // answer is EVIDENCE_STORE_UNAVAILABLE, whose retry class is safe_same_key (step 20's
    // README, decision 10).
    if (allowed && keyOfRecord !== undefined && !nothingKept) {
      // A propose_only call ran no code. Its claim keeps the waiting proposal, so a
      // retry with the same key names that one.
      // And neither did a call that waits for an approval. Found by step 27's
      //   review, finding M1: its words said that the command ran.
      const waits = "outcome" in answer && answer.outcome === "PENDING_APPROVAL";
      const ran =
        modeOfRecord === "propose_only" || waits
          ? "DSoR could not record its decision after the proposal was made, and a retry with the same idempotency_key cannot make a second one"
          : "DSoR could not record its decision after the command ran, and a retry with the same idempotency_key cannot run it twice";
      return toEnvelope(new Refusal("EVIDENCE_STORE_UNAVAILABLE", ran), answer.correlation);
    }
    // A record that could not be written took the work with it, and the record of
    //   that refusal could not be written either: the words still say what happened.
    if (nothingKept) {
      return toEnvelope(
        new Refusal("EVIDENCE_STORE_UNAVAILABLE", KEPT_NOTHING),
        answer.correlation,
      );
    }
    // DSOR-EXE-03b, an L2 rule built early: with no record, there is no answer, not even a
    // "yes". Whatever the log threw stays inside: it can name paths and servers. This
    // refusal cannot be recorded, because the log is what failed (step 08's README,
    // decision 4).
    const message = "DSoR could not record its decision, so it refuses the call";
    return toEnvelope(new Refusal("EVIDENCE_STORE_UNAVAILABLE", message), answer.correlation);
  }

  // ⑫ Stop here when an approval is missing, or the mode is propose_only or
  //   validate_only. A call that needs an approval stopped above, after line ⑩, at
  //   PENDING_APPROVAL, before any work (step 27's README, decision D10). Changed in step 29: an
  //   approval is a call of its own, proposal.approve, which moves the waiting proposal to
  //   APPROVED. Executing it is step 31's.
  // A propose_only call and a dry run stopped earlier, inside decide, because the
  //   code at line ⑨ does the work that §21 puts after this line. Both come here only after line
  //   ⑪'s record (step 23's README, decision 8).
  // ⑬ to ⑰ Write the intent record, execute, finalize, commit, and seal the evidence.
  //   Commands only. Not built yet: steps 24, 33, 34, 36, 37, and 40.
  // ⑭'s concurrency check is built. It runs inside the code at line ⑨, where a
  //   command's work runs until step 36 moves the work after the intent record: the code
  //   compares the version, and the store's write checks it again (step 21's README,
  //   decision 6).
  // Step 36, which writes the intent record. This comment named step 33 until
  //   step 23's review found it.
  return answer;
}

/** The request lines ⑨ and ⑩ decide, and who asked for it, as they are now. */
type Asked = {
  contract: Contract;
  copy: unknown;
  own: OwnWork | undefined;
  requester: Requester;
  roles: readonly string[];
  slip: Slip | undefined;
  // At a release, the version of the bound record the stored request was decided on.
  decidedOn?: number;
  // And, in a dry run of a release, the proposal whose booking is made already.
  booked?: string;
  // And whether this is a release, in its claim or its dry run. A release reads
  //   CURRENT state whatever the contract permits (§26.4), and takes no lock of the invoice: the
  //   proposal it releases is in flight until the release ends (step 32's README, D7 and D11).
  release?: true;
};

// A label without its record's version.
/** The label, with no resource_version. */
function withoutVersion(label: Freshness): Freshness {
  const { mode, observed_at, connector } = label;
  return { mode, observed_at, connector };
}

/** Refuses an input that JSON cannot copy, after checking the claims it makes. */
function refuseUncopyable(name: string, input: unknown, tenant: string): never {
  // JSON can carry such an input: nesting that JSON.parse reads and JSON.stringify cannot
  // write. Line ① checked the principals it names, and line ② checks the companies it
  // names here, both on the input as sent. So an attempt to act as someone else, or inside
  // another company, is refused as one, and never hidden behind a bad input. Step 05
  // refused to let a bad request id hide it, for the same reason. The input is read here
  // only to choose the refusal. The call is refused either way, so nothing read here can
  // reach the code (step 07's README, decision 9). Found by the Stage 2 review, and fixed
  // from step 07 on.
  checkNamedTenants(input, tenant);
  refuseInput(name, "it cannot be copied as JSON");
}

// The company's READY lifetime. A company with none is a bug, because start-up
// checks every company where a login works (step 25c's README, claim C6).
/** The READY lifetime of the call's company, from the registry. */
function lifetimeOf(registry: Registry, tenant: string): string {
  const found = registry.lifetimes.get(tenant);
  if (found === undefined) throw new Error(`company ${tenant} has no READY lifetime`);
  return found.lifetime;
}

// An unknown outcome keeps its booking, as the sweep does: the money may have
//   left, so the day's limit does not get it back. Changed in step 36; step 35 gave it back.
//   Found by step 36's review, H2 (DSOR-DEL-06c).
function isUnknown(outcome: Ended): boolean {
  return "refused" in outcome && outcome.refused.code === "OUTCOME_UNKNOWN";
}

// A note ends with its proposal, in the same transaction: committed, failed, or
//   outcome_unknown, as the proposal's last move. A command that called no bank wrote no note
//   (DSOR-EXE-03a; step 36's README, decision D3).
async function endNote(
  stores: WorkStores,
  tenant: string,
  id: string,
  outcome: Ended,
): Promise<void> {
  const note = await stores.intents.get(tenant, id);
  if (note === undefined) return;
  const unknown = "refused" in outcome && outcome.refused.code === "OUTCOME_UNKNOWN";
  await stores.intents.end(
    tenant,
    id,
    "value" in outcome ? "committed" : unknown ? "outcome_unknown" : "failed",
  );
}
