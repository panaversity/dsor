// NEW IN STEP 12: the cross-tenant suite, generated from the registry.
//
// Step 11's `cross-tenant.test.ts` proves two operations by hand, and nothing ties it to the list
// of operations: a third operation, added without a tenant check, leaked org_789's invoice while
// that file stayed green (decision 99). This file is one test *per operation*, written once and
// run for every operation the registry holds — the two that exist, and every one that is added
// later. An operation it cannot test, because its contract carries no example request, fails here
// rather than being skipped. That is what "the suite grows by itself" means.
//
// It is a function and not a test file, so that it runs twice: on PGlite under `pnpm check`, and
// against a real server in the database tier. The hooks are the two things that differ.
//
// Rule DSOR-TEN-02b: an implementation MUST ship a cross-tenant test suite that exercises every
// operation with a foreign-tenant URI.
// Rule DSOR-ERR-01b: an error MUST NOT reveal the existence or attributes of a resource the caller
// is not authorized to read.

import { describe, expect, it } from "vitest";
import { theLog } from "../../src/audit.ts";
import { callOperation } from "../../src/operations.ts";
import { contractsFromDisk, exampleRequestOf, loadRegistry } from "../../src/registry.ts";

/** The caller in org_456 for every test here. The agent belongs to both companies; user_123 to one. */
const SUPERVISOR = { loggedInAs: "user_123" };

/** The story's company, the other real one, and one that does not exist. */
const OURS = "org_456";
const THEIRS = "org_789";
const NOBODYS = "org_000";

export interface SuiteHooks {
  /** Put every row and every log back to how the story starts. Runs before each test. */
  readonly reset: () => Promise<void>;
  /** One company's invoice rows, read as the owner, so the suite can see they did not move. */
  readonly rowsOf: (tenant: string) => Promise<readonly { readonly id: string }[]>;
}

/** Every `dsor://` address anywhere inside a value, at any depth. */
export function addressesIn(value: unknown): string[] {
  if (typeof value === "string") {
    return value.startsWith("dsor://") ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(addressesIn);
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(addressesIn);
  }

  return [];
}

/** The same request, with every address inside it moved to another company — at any depth. */
export function moved(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") {
    return value.replaceAll(`dsor://${from}/`, `dsor://${to}/`);
  }

  if (Array.isArray(value)) {
    return value.map((item) => moved(item, from, to));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, moved(item, from, to)]),
    );
  }

  return value;
}

/** The refusal an operation gives, or a thrown error naming what came back instead. */
async function refusalFor(id: string, request: Readonly<Record<string, unknown>>) {
  const answer = await callOperation(SUPERVISOR, id, request);

  if (answer.kind !== "error") {
    throw new Error(`${id}: expected a refusal for another company's address, got ${answer.kind}`);
  }

  return answer.envelope;
}

/**
 * One `describe` per operation in the registry. Call it once at the top of a test file.
 */
export function crossTenantSuite(hooks: SuiteHooks): void {
  const registry = loadRegistry(contractsFromDisk());

  for (const [id, contract] of registry) {
    describe(`${id}, with another company's address`, () => {
      const example = exampleRequestOf(contract);

      if (example === undefined) {
        // Loud, not skipped: the day an operation arrives without an example, this is the test
        // that fails, and its name says what to do.
        it(`DSOR-TEN-02b: ${id} carries no example request, so this suite cannot call it — add one to its contract`, () => {
          throw new Error(`${id}: no example_request under extensions["com.panaversity.tutorial"]`);
        });

        return;
      }

      const theirs = moved(example, OURS, THEIRS) as Readonly<Record<string, unknown>>;
      const nobodys = moved(example, OURS, NOBODYS) as Readonly<Record<string, unknown>>;

      it(`DSOR-TEN-02b: ${id} is refused with TENANT_MISMATCH, and a retry cannot help`, async () => {
        await hooks.reset();

        const refusal = await refusalFor(id, theirs);

        expect(refusal.code).toBe("TENANT_MISMATCH");
        expect(refusal.retry).toBe("never");
      });

      it(`DSOR-ERR-01b: ${id}'s refusal says the same for a company that exists and one that does not, and nothing about yours`, async () => {
        await hooks.reset();

        const real = await refusalFor(id, theirs);
        const fake = await refusalFor(id, nobodys);

        expect(real.message.replaceAll(THEIRS, "X")).toBe(fake.message.replaceAll(NOBODYS, "X"));
        expect(real.message).not.toContain(OURS);
        expect(fake.message).not.toContain(OURS);
      });

      it(`the other company holds every invoice number ${id}'s example names, so a careless write would have something to touch`, async () => {
        // Found by a sabotage: a careless command that issued whatever draft the address named
        // left org_789's rows untouched — because org_789 had no INV-1009, not because the command
        // was careful. The untouched-rows question below is only as strong as the rows it guards.
        await hooks.reset();

        const theirIds = new Set((await hooks.rowsOf(THEIRS)).map((row) => row.id));

        for (const address of addressesIn(example)) {
          const number = address.split("/").at(-1) ?? "";

          expect(
            theirIds.has(number),
            `${THEIRS} has no ${number}; add it to 004_running_example.sql`,
          ).toBe(true);
        }
      });

      it(`DSOR-IDN-03b: ${id} leaves the other company's rows exactly as they were`, async () => {
        await hooks.reset();

        const before = await hooks.rowsOf(THEIRS);

        await refusalFor(id, theirs);

        expect(await hooks.rowsOf(THEIRS)).toStrictEqual(before);
        expect(before.length).toBeGreaterThan(0); // not testing nothing: there are rows to leave alone
      });

      it(`DSOR-EXE-02: ${id}'s refusal is a DENY in the caller's log, and the other company's log gains nothing`, async () => {
        await hooks.reset();

        const theirLogBefore = (await theLog(THEIRS)).length;

        await refusalFor(id, theirs);

        const ours = await theLog(OURS);
        const last = ours.at(-1);

        expect(last?.authorization).toBe("DENY");
        expect(last?.result).toBe("TENANT_MISMATCH");
        expect(last?.operation).toBe(`${id}@${contract.version}`);
        expect((await theLog(THEIRS)).length).toBe(theirLogBefore);
      });

      it(`${id}'s example works for its own company, so the refusals above are about the address`, async () => {
        await hooks.reset();

        const answer = await callOperation(SUPERVISOR, id, example);

        expect(answer.kind, `${id}: ${JSON.stringify(answer)}`).not.toBe("error");
      });
    });
  }
}
