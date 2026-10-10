// STEP 12: the cross-tenant suite, generated from the registry.
//
// Step 11's `cross-tenant.test.ts` proves two operations by hand, and nothing ties it to the list
// of operations: a third operation, added without a tenant check, leaked org_789's invoice while
// that file stayed green (decision 99). This file is one test *per operation*, written once and
// run for every operation the registry holds — the ones that exist, and every one that is added
// later. An operation it cannot test, because its contract carries no example request, fails here
// rather than being skipped. That is what "the suite grows by itself" means.
//
// STEP 14: the questions are asked as user_123, a human, on purpose. The model boundary withholds
// the amount from an agent before the canary check looks, so an agent's answer could carry the
// other company's amount and pass. A human's answer is whole, and the canaries can see it.
//
// It is a function and not a test file, so that it runs twice: on PGlite under `pnpm check`, and
// against a real server in the database tier. The hooks are the two things that differ.
//
// And the six questions are plain functions, `questions`, that the generated tests call. A
// mutation pass deleted assertions from the first version one at a time and every deletion passed
// the whole suite, because nothing tests a test. `cross-tenant-suite-itself.test.ts` feeds each
// question a leaky answer and expects it to throw.
//
// Rule DSOR-TEN-02b: an implementation MUST ship a cross-tenant test suite that exercises every
// operation with a foreign-tenant URI.
// Rule DSOR-ERR-01b: an error MUST NOT reveal the existence or attributes of a resource the caller
// is not authorized to read.

import { describe, expect, it } from "vitest";
import { theLog, type AuditRecord } from "../../src/audit.ts";
import type { ErrorEnvelope } from "../../src/envelopes.ts";
import { addressesIn, movedTo } from "../../src/examples.ts";
import { callOperation, type OperationAnswer } from "../../src/operations.ts";
import {
  contractsFromDisk,
  exampleRequestOf,
  loadRegistry,
  type OperationContract,
} from "../../src/registry.ts";
import { isKnownTenant } from "../../src/tenant.ts";
import { parseUri } from "../../src/uri.ts";

/** The caller in org_456 for every test here. The agent belongs to both companies; user_123 to one. */
export const SUPERVISOR = { loggedInAs: "user_123" };

/** "an invoice", "a payment". */
const withArticle = (word: string): string => `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;

/** The story's company, the other real one, and one that does not exist. */
export const OURS = "org_456";
export const THEIRS = "org_789";
export const NOBODYS = "org_000";

/**
 * What org_789 alone holds, from 004_running_example.sql: a success answer must carry none of it.
 * STEP 17: and its PAY-901's amount, from 010_payments_running_example.sql.
 */
export const CANARIES: readonly string[] = ["18000.00", "9100.00", "4200.00", "INV-2001", "7700.00"];

/**
 * One row of a company's, as the owner reads it: enough to see whether it moved, and what state it
 * is in. STEP 17: an invoice or a payment, so each row says which.
 */
export interface Row {
  readonly entity: string;
  readonly id: string;
  readonly status: string;
}

/**
 * STEP 17: the one query both tiers' `rowsOf` runs, as the owner: every invoice and payment
 * of one company, each with what a careless command could change about it.
 */
export const ROWS_OF = `SELECT 'invoice' AS entity, id, vendor, NULL::text AS invoice,
                               amount_value::text AS amount, amount_currency AS currency, status
                          FROM public.invoices WHERE tenant_id = $1
                        UNION ALL
                        SELECT 'payment', id, vendor, invoice, amount_value::text, amount_currency, status
                          FROM public.payments WHERE tenant_id = $1
                        ORDER BY entity, id`;

export interface SuiteHooks {
  /** Put every row and every log back to how the story starts. Runs before each test. */
  readonly reset: () => Promise<void>;
  /** One company's invoice rows, read as the owner, so the suite can see they did not move. */
  readonly rowsOf: (tenant: string) => Promise<readonly Row[]>;
}

/** What a question needs beside the hooks: a way to call an operation, and a way to read a log. */
export interface Deps extends SuiteHooks {
  readonly call: (
    id: string,
    request: Readonly<Record<string, unknown>>,
  ) => Promise<OperationAnswer>;
  readonly logOf: (tenant: string) => Promise<readonly AuditRecord[]>;
}

/** The refusal an operation gives, or a thrown error naming what came back instead. */
async function refusalFrom(
  deps: Deps,
  id: string,
  request: Readonly<Record<string, unknown>>,
): Promise<ErrorEnvelope> {
  const answer = await deps.call(id, request);

  if (answer.kind !== "error") {
    throw new Error(`${id}: expected a refusal for another company's address, got ${answer.kind}`);
  }

  return answer.envelope;
}

/**
 * A refusal with the company named in it masked and the request id dropped, so two refusals can
 * be compared whole. Whole, not by message: an evaluation wrote an operation that returned a
 * TENANT_MISMATCH-shaped envelope with the other company's row smuggled inside it, and a test that
 * compared only the words let it through. The refusal for a company that does not exist cannot
 * carry that company's rows, so equality with it is the check.
 */
function masked(refusal: object, company: string): unknown {
  const { correlation: _correlation, ...rest } = refusal as Record<string, unknown>;

  return JSON.parse(JSON.stringify(rest).replaceAll(company, "X"));
}

/** An example request, and the same request moved to the two other companies. */
export interface Case {
  readonly id: string;
  readonly contract: OperationContract;
  readonly example: Readonly<Record<string, unknown>>;
  readonly theirs: Readonly<Record<string, unknown>>;
  readonly nobodys: Readonly<Record<string, unknown>>;
}

export function caseFor(
  id: string,
  contract: OperationContract,
  example: Readonly<Record<string, unknown>>,
): Case {
  return {
    id,
    contract,
    example,
    theirs: movedTo(example, OURS, THEIRS) as Readonly<Record<string, unknown>>,
    nobodys: movedTo(example, OURS, NOBODYS) as Readonly<Record<string, unknown>>,
  };
}

/**
 * The six questions, each a function that throws when the answer is wrong. The generated tests
 * below call them with the real pipeline; `cross-tenant-suite-itself.test.ts` calls them with
 * fakes that lie, and expects the throw.
 */
export const questions = {
  async refused(deps: Deps, c: Case): Promise<void> {
    const refusal = await refusalFrom(deps, c.id, c.theirs);

    expect(refusal.code).toBe("TENANT_MISMATCH");
    expect(refusal.retry).toBe("never");
  },

  async sameWhole(deps: Deps, c: Case): Promise<void> {
    const real = await refusalFrom(deps, c.id, c.theirs);
    const fake = await refusalFrom(deps, c.id, c.nobodys);

    // The whole envelope — code, retry, message, and anything else it carries — not the words.
    expect(masked(real, THEIRS)).toStrictEqual(masked(fake, NOBODYS));
    expect(JSON.stringify(real)).not.toContain(OURS);
  },

  async somethingToTouch(deps: Deps, c: Case): Promise<void> {
    // Found by a sabotage: a careless command that issued whatever draft the address named left
    // org_789's rows untouched — because org_789 had no INV-1009, not because the command was
    // careful. And found by a mutation pass: an INV-1009 seeded already `issued` passed too,
    // because the careless command found nothing it could issue. So for a command, the other
    // company's row must be in the same state as yours — the state the example works in.
    // STEP 17: keyed by kind and number, because an invoice and a payment are different rows.
    const key = (row: { entity: string; id: string }): string => `${row.entity}/${row.id}`;
    const ours = new Map((await deps.rowsOf(OURS)).map((row) => [key(row), row.status]));
    const theirs = new Map((await deps.rowsOf(THEIRS)).map((row) => [key(row), row.status]));
    const addresses = addressesIn(c.example);

    expect(addresses.length, `${c.id}: the example names no address`).toBeGreaterThan(0);

    for (const address of addresses) {
      const parsed = parseUri(address);
      const row = key(parsed);

      expect(
        ["invoice", "payment"],
        `${c.id}: ${address} is neither an invoice nor a payment; teach rowsOf about ${parsed.entity}`,
      ).toContain(parsed.entity);
      expect(
        theirs.has(row),
        `${THEIRS} has no ${parsed.id} (${withArticle(parsed.entity)}); add it to the running example`,
      ).toBe(true);

      // STEP 17: asked of every command, the ones that only add rows too. Decision 125 asked it only
      // of commands that change a row, with payment.create's example on INV-1008, issued in one
      // company and a draft in the other: step 12's hollow pass, waiting for the day a precondition
      // arrives. The example names INV-1009, a draft in both (decision 126).
      if (c.contract.effect !== "read") {
        expect(
          theirs.get(row),
          `${THEIRS}'s ${parsed.id} is ${theirs.get(row)}, yours is ${ours.get(row)}: a careless ${c.id} would find nothing to do to it`,
        ).toBe(ours.get(row));
      }
    }
  },

  async rowsUntouched(deps: Deps, c: Case): Promise<void> {
    const before = await deps.rowsOf(THEIRS);

    await refusalFrom(deps, c.id, c.theirs);

    expect(await deps.rowsOf(THEIRS)).toStrictEqual(before);
    expect(before.length).toBeGreaterThan(0); // not testing nothing: there are rows to leave alone
  },

  async oneDenyInTheLog(deps: Deps, c: Case): Promise<void> {
    const theirLogBefore = (await deps.logOf(THEIRS)).length;
    const refusal = await refusalFrom(deps, c.id, c.theirs);

    // Exactly one record for this request, and it is the DENY. Not "the last one is a DENY": an
    // evaluation wrote a handler that let the pipeline record ALLOW and then appended a DENY of
    // its own, and a test that read only the last record believed it.
    const forThisRequest = (await deps.logOf(OURS)).filter(
      (record) => record.correlation.request_id === refusal.correlation.request_id,
    );

    expect(forThisRequest).toHaveLength(1);
    expect(forThisRequest[0]?.authorization).toBe("DENY");
    expect(forThisRequest[0]?.result).toBe("TENANT_MISMATCH");
    expect(forThisRequest[0]?.operation).toBe(`${c.id}@${c.contract.version}`);
    expect((await deps.logOf(THEIRS)).length).toBe(theirLogBefore);
  },

  async ownExampleWorks(deps: Deps, c: Case): Promise<void> {
    const answer = await deps.call(c.id, c.example);

    expect(answer.kind, `${c.id}: ${JSON.stringify(answer)}`).not.toBe("error");

    // And nothing of the other company inside the answer. A critic's handler returned org_456's
    // invoice with org_789's row beside it, in a successful answer, and the first version of this
    // question — "not an error" — passed it. The canaries are what org_789 alone holds in the
    // story: its name, and the amounts and the number org_456 never has.
    const text = JSON.stringify(answer);

    for (const canary of [THEIRS, ...CANARIES]) {
      expect(text, `${c.id}: the own-company answer carries ${canary}`).not.toContain(canary);
    }
  },

  /** The failing test an operation gets when the suite cannot call it. */
  noExample(id: string): never {
    throw new Error(`${id}: no example_request under extensions["com.panaversity.tutorial"]`);
  },

  noAddress(id: string): never {
    throw new Error(`${id}: the example request has no dsor:// address in it`);
  },
} as const;

/**
 * One `describe` per operation in the registry. Call it once at the top of a test file.
 */
export function crossTenantSuite(hooks: SuiteHooks): void {
  const registry = loadRegistry(contractsFromDisk());
  const deps: Deps = {
    ...hooks,
    call: (id, request) => callOperation(SUPERVISOR, id, request),
    logOf: theLog,
  };

  // The suite's own guards, in both tiers. A registry with no operations would register nothing
  // below, and vitest's complaint about an empty file is not this suite's assertion. And the three
  // companies must be what the questions assume: a critic added org_000 to tenant.ts and every
  // question stayed green while comparing two real companies — the "does not exist" half of
  // question 2 was gone and nothing said so.
  it("DSOR-TEN-02b: the registry holds at least one operation to exercise", () => {
    expect(registry.size).toBeGreaterThan(0);
  });

  it("the other company is real and the third one is not, which question 2 depends on", () => {
    expect(isKnownTenant(THEIRS)).toBe(true);
    expect(isKnownTenant(NOBODYS)).toBe(false);
  });

  for (const [id, contract] of registry) {
    describe(`${id}, with another company's address`, () => {
      const example = exampleRequestOf(contract);

      if (example === undefined) {
        // Loud, not skipped: the day an operation arrives without an example, this is the test
        // that fails, and its name says what to do.
        it(`DSOR-TEN-02b: ${id} carries no example request, so this suite cannot call it — add one to its contract`, () => {
          questions.noExample(id);
        });

        return;
      }

      if (addressesIn(example).length === 0) {
        // Also loud. An example with no address would be "moved" into itself, and then asked to be
        // both refused and allowed — two questions that cannot both hold. An operation that takes
        // no address is a shape this step does not test, and says so by name rather than fail both.
        it(`DSOR-TEN-02b: ${id}'s example names no dsor:// address, so there is nothing to move — give it one`, () => {
          questions.noAddress(id);
        });

        return;
      }

      const c = caseFor(id, contract, example);

      it(`DSOR-TEN-02b: ${id} is refused with TENANT_MISMATCH, and a retry cannot help`, async () => {
        await hooks.reset();
        await questions.refused(deps, c);
      });

      it(`DSOR-ERR-01b: ${id}'s refusal is the same, whole, for a company that exists and one that does not, and says nothing about yours`, async () => {
        await hooks.reset();
        await questions.sameWhole(deps, c);
      });

      it(`the other company holds every invoice and payment number ${id}'s example names, in the same state, so a careless write would have something to touch`, async () => {
        await hooks.reset();
        await questions.somethingToTouch(deps, c);
      });

      it(`DSOR-IDN-03b: ${id} leaves the other company's rows exactly as they were`, async () => {
        await hooks.reset();
        await questions.rowsUntouched(deps, c);
      });

      it(`DSOR-EXE-02: ${id}'s request leaves exactly one decision in the caller's log, the DENY, and none in the other company's`, async () => {
        await hooks.reset();
        await questions.oneDenyInTheLog(deps, c);
      });

      it(`${id}'s example works for its own company, so the refusals above are about the address`, async () => {
        await hooks.reset();
        await questions.ownExampleWorks(deps, c);
      });
    });
  }
}
