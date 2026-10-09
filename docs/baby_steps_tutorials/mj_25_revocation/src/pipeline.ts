// The checklist every call goes through. DSOR-EXE-01a in specs/dsor/03-execution.md,
// section 21, and DSOR-OPR-04a in specs/dsor/01-model.md, section 7.
import { randomUUID } from "node:crypto";
import { pinned, readBound, type Bound } from "./bound.ts";
import { payloadHash } from "./canonical.ts";
import { claimScope, isOutcome, type ProposalSteps, type WorkStores } from "./claims.ts";
import { checkAnswerInTenant, companyOf } from "./company.ts";
import { checkDelegation, checkNamedSlips } from "./delegation.ts";
import { Refusal, toEnvelope, type Answer, type Correlation } from "./envelope.ts";
import { checkInput, jsonCopy, NOT_JSON, refuseInput } from "./inputs.ts";
import { newReads, stalest, type Freshness } from "./freshness.ts";
import type { InvoiceStore } from "./invoice.ts";
import { checkLimits, limitsOf, NO_RESERVATIONS, type ReservationStore } from "./limits.ts";
import { decisionOf, type Authority, type DecisionLog, type Read } from "./log.ts";
import { NO_PAYMENTS } from "./payment.ts";
import { checkResultSize } from "./pages.ts";
import { checkPermission } from "./permissions.ts";
import { clearanceOf, maskRefusal, show } from "./masking.ts";
import { callerIds, checkNamedPrincipals, whoIsCalling } from "./principals.ts";
import {
  closeProposal,
  NO_PROPOSALS,
  openProposal,
  proposalIdOf,
  requesterOf,
  urisIn,
  type Opening,
} from "./proposals.ts";
import { preview, type Registry } from "./registry.ts";
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
import { lookFor } from "./revocation.ts";
import { NO_SLIPS, type SlipStore } from "./slips.ts";
import { suspendThenRefuse } from "./suspensions.ts";
import { activeTenant, checkNamedTenants, checkUrisInTenant } from "./tenants.ts";
import { isTenantId } from "./uri.ts";

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
  // The proposal a refusal from the code ended FAILED, which its envelope names.
  // Set only from the claim, so no code can name a proposal of its own (step 22's README,
  // decision 5). Found by the review.
  let failedProposal: string | undefined;
  // The mode line ① read, or execute when the envelope names none. A command's
  // record names it (step 23's README, decision 10).
  let modeOfRecord: Mode | undefined;
  // The label of each read the code makes, noted by the bound store. Only the
  // checklist holds this notebook (step 15's README, decision 5).
  const reads = newReads();

  // Every refusal is thrown as a Refusal, which names its code. The catch
  // below turns it, and anything else thrown, into an error envelope (step 04's README, C7).
  // Lines ① to ⑩ are one function, decide, which only works out the answer, so a
  // dry run and a propose_only call return theirs where they stop. The answer is returned after
  // line ⑪, which every call reaches.
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
    // ④ Check operational status (suspension, freeze, breaker). Not checked yet: step 25.

    // ⑤ Authorize: the caller must hold the permission the contract names (DSOR-AUT-01b).
    // Only the caller's roles in the active company count.
    // For an agent, with the roles its signer holds now, which line ③ found.
    // In the call's mode. In propose_only mode the .propose form is enough (§7.3;
    // step 23's README, decision 5).
    line(5, () =>
      checkPermission(
        caller,
        contract,
        registry.roles,
        tenant,
        found?.slip,
        found?.authority.roles,
        mode,
      ),
    );

    // ⑥ Validate the input against the operation's input schema.
    //   It checks line ①'s copy, the one the code gets (step 07's README, decision 9).
    //   Found by the Stage 2 review, and fixed from step 07 on.
    // Then the copy's fingerprint, its payload hash, which line ⑦ claims the
    //   key with (DSOR-IDM-01b; step 20's README, decision 5). Canonicalizing in full: not built
    //   yet, step 29.
    const hash = line(6, () => {
      checkInput(name, registry.inputs, copy);
      return payloadHash(copy);
    });

    // Ours, not §21's: every URI in the checked input must name the active
    // company (DSOR-SRC-02b). After ⑥, so it reads the copy that line ⑥ checked, and before
    // "is it built", so a foreign URI is never answered as "not built yet" (step 10's
    // README, decision 4).
    checkUrisInTenant(copy, tenant);

    // Ours, not §21's: is it built? Never before ⑤, so "not allowed" is never answered as
    // "not built yet" (step 06's README, C5), and never before ⑥ (step 07's README,
    // decision 5).
    const handler = registry.handlers.get(name);
    // NEW IN STEP 25: or DSoR's own work, for a command that changes DSoR's own store: its check
    //   at line ⑨, and its change after line ⑩ (step 25's README, decisions D2 and D7).
    const own = registry.own.get(name);
    if (!handler && !own) {
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
    const limits = limitsOf(found?.slip);
    // What line ⑨ read, which the work's writes are pinned to (step 24's README,
    // decision 16).
    let boundState: Bound["state"] = {};
    // NEW IN STEP 25: and DSoR's own check, at line ⑨, for an operation of DSoR's own. It reads
    //   the slips, inside the claim or, in a dry run, outside it, and changes nothing. Its refusal
    //   is a "no" before any work, as line ⑩'s is: the proposal ends DENIED, the record says DENY,
    //   and every mode hears the same answer (DSOR-EXE-02, DSOR-OPR-05; step 25's README, decision
    //   D7). Found by step 25's review: the check ran inside the work, after DSoR had said yes.
    const decideBeforeWork = async (
      invoices: InvoiceStore,
      store: ReservationStore,
      slips: SlipStore,
      reserveFor?: string,
    ): Promise<void> => {
      const { state, spends } = await line(9, async () => {
        const bound = await readBound(contract, copy, invoices, tenant);
        if (own !== undefined) await own.check(copy, lookFor(tenant, caller, slips));
        return bound;
      });
      boundState = state;
      await line(10, () =>
        checkLimits({
          operation: contract.id,
          tenant,
          slip: found?.slip.id,
          limits,
          spends,
          store,
          ...(reserveFor === undefined ? {} : { reserveFor }),
        }),
      );
    };

    // A dry run stops here, after line ⑩. It skips line ⑦'s claim and line ⑧'s
    //   proposal (§21: "A validate_only invocation skips steps 7 and 8"), and the code, which does
    //   the work, so nothing can be written (DSOR-OPR-06). A "no" was thrown above, as the real
    //   call's would be, so the decision here is ALLOW. Line ⑪ still records it (§7.3; step 23's
    //   README, decisions 2, 3, 8, and 9).
    // After lines ⑨ and ⑩, which are DSoR's own and write nothing. The code still
    //   never runs (step 24's README, decision 8).
    if (mode === "validate_only") {
      try {
        await decideBeforeWork(
          registry.invoices,
          registry.claims.reservations,
          registry.delegations,
        );
      } catch (thrown) {
        // Masked as the real call's refusal is, as it leaves the claim (step 23's README, decision
        // 3).
        throw maskRefusal(thrown, clearanceOf(caller));
      }
      allowed = true;
      return { outcome: "VALIDATED", decision: "ALLOW", correlation };
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
    const runCode = (stores: WorkStores): Promise<unknown> => {
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
            contract["kind"] === "query" ? NO_PAYMENTS : pinned(stores.payments, boundState);
          // NEW IN STEP 25: DSoR's own change gets DSoR's own stores, inside the claim, with the
          //   caller. The company's code never gets them (step 25's README, decision D2).
          let returned: unknown;
          if (own !== undefined) {
            const now = new Date().toISOString();
            returned = await own.change(copy, { tenant, caller, stores, correlation, now });
          } else if (handler !== undefined) {
            returned = await handler(copy, companyOf(stores.invoices, tenant, reads, payments));
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
    try {
      if (contract["kind"] === "query" && key === undefined) {
        // A query makes no proposal, so its stores hold none to write (decision 7).
        returned = await runCode({
          invoices: registry.invoices,
          payments: registry.payments,
          proposals: NO_PROPOSALS,
          reservations: NO_RESERVATIONS,
          // NEW IN STEP 25: and no slip to tear up.
          slips: NO_SLIPS,
        });
      } else {
        const { scope, claimed } = await line(7, async () => {
          const scope = claimScope(contract, key, tenant, caller.id);
          // Named in the record from here on, a refusal of the key too.
          keyOfRecord = { key: scope.key };
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
            },
            correlation,
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
                    const { invoices, reservations, slips } = stores;
                    await decideBeforeWork(invoices, reservations, slips, reserveFor);
                    return undefined;
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
              if ("value" in outcome) await stores.reservations.commit(tenant, id);
              else await stores.reservations.release(tenant, id);
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
            ),
          };
        });
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
      }
    } catch (thrown) {
      // A refusal the code throws is masked as its answer would be
      // (DSOR-CLS-02a; step 14's README, decision 8).
      // Here, as it leaves, so a refusal the claim kept is masked for the caller
      // now, as a replay's value is. Line ⑦'s own refusals are public, and pass unchanged
      // (step 20's README, decision 7).
      throw maskRefusal(thrown, clearanceOf(caller));
    }
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
    const kind = (contract["output"] as { schema: string }).schema;
    const shown = show(data, kind, registry.classifications, clearanceOf(caller));
    // Ours, not §21's. No query's result leaves larger than DSoR gives in
    // one call, whoever wrote its code, a list or not (DSOR-QRY-01; step 13's README,
    // decision 3). Its code ran, so its record says ALLOW, with this refusal as its result.
    // A command's answer passes here too: one draft is far below the limit, so only a bug
    // reaches it.
    checkResultSize(shown.data, shown.redactions);
    // ⑩ Evaluate controls, separation of duties, and limits. Controls and separation of duties:
    //   not built yet, steps 27 and 30.
    // The limits are built. They run above, before the work, where §21 puts them.

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
      const semantics = semanticsOf(contract);
      // The outcome, the proposal, and the fingerprint of the request, so the
      // answer passes result-envelope.schema.json (DSOR-SCH-01; step 22's README, decision 5).
      if (proposalOfRecord === undefined) throw new Error("a command answered with no proposal");
      read = { resources, classification };
      return {
        outcome: "COMMITTED",
        proposal: proposalOfRecord,
        payload_hash: hash,
        data: shown.data,
        classification,
        ...listed,
        semantics,
        correlation,
      };
    }
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
  try {
    await line(11, () =>
      log.add(
        decisionOf(
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
        ),
      ),
    );
  } catch {
    // A command whose code ran may have changed something, and DSoR cannot
    // prove it did not. Until step 20 its answer never said a retry was safe: with no key, a
    // retry could write a second draft (the reason behind DSOR-ERR-02; step 17's README,
    // decision 17). Found by break B1.
    // Now every command that reaches its code holds a claim. A retry with the
    // same key gets the claim's outcome, or runs once if the work rolled back. So the
    // answer is EVIDENCE_STORE_UNAVAILABLE, whose retry class is safe_same_key (step 20's
    // README, decision 10).
    if (allowed && keyOfRecord !== undefined) {
      // A propose_only call ran no code. Its claim keeps the waiting proposal, so a
      // retry with the same key names that one.
      const ran =
        modeOfRecord === "propose_only"
          ? "DSoR could not record its decision after the proposal was made, and a retry with the same idempotency_key cannot make a second one"
          : "DSoR could not record its decision after the command ran, and a retry with the same idempotency_key cannot run it twice";
      return toEnvelope(new Refusal("EVIDENCE_STORE_UNAVAILABLE", ran), answer.correlation);
    }
    // DSOR-EXE-03b, an L2 rule built early: with no record, there is no answer, not even a
    // "yes". Whatever the log threw stays inside: it can name paths and servers. This
    // refusal cannot be recorded, because the log is what failed (step 08's README,
    // decision 4).
    const message = "DSoR could not record its decision, so it refuses the call";
    return toEnvelope(new Refusal("EVIDENCE_STORE_UNAVAILABLE", message), answer.correlation);
  }

  // ⑫ Stop here when an approval is missing, or the mode is propose_only or
  //   validate_only. A missing approval: not built yet, step 29.
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
