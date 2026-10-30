// STEP 12: every contract carries an example request.
//
// The cross-tenant suite in this step calls every operation with another company's address. To do
// that for an operation nobody has written yet, it needs to know what request that operation takes,
// and the answer lives with the operation: one example request inside its contract, under
// `extensions`, with a reverse-DNS key — the one place the specification's schema lets a contract
// carry something beside the spec's own fields (DSOR-SCH-02, step 03).
//
// Rule DSOR-TEN-02b: an implementation MUST ship a cross-tenant test suite that exercises every
// operation with a foreign-tenant URI. This file is the half that makes "every operation" possible.

import { describe, expect, it } from "vitest";
import { addressesIn } from "../src/examples.ts";
import {
  contractsFromDisk,
  exampleRequestOf,
  loadRegistry,
  TUTORIAL_EXTENSION,
} from "../src/registry.ts";

const registry = loadRegistry(contractsFromDisk());

describe("the example request every contract carries", () => {
  it("DSOR-TEN-02b: every operation in the registry has one, so the suite can call it", () => {
    expect(registry.size).toBeGreaterThan(0);

    for (const [id, contract] of registry) {
      expect(exampleRequestOf(contract), `${id} has no example request`).toBeDefined();
    }
  });

  it("every example names at least one address, and every address is in the story's company", () => {
    // The suite rewrites org_456 to another company. An example with no address would be
    // rewritten into itself and prove nothing; one already in another company would be a
    // foreign call that nobody chose.
    for (const [id, contract] of registry) {
      const addresses = addressesIn(exampleRequestOf(contract));

      expect(addresses.length, `${id}'s example has no dsor:// address`).toBeGreaterThan(0);

      for (const address of addresses) {
        expect(address, `${id}: ${address}`).toMatch(/^dsor:\/\/org_456\//);
      }
    }
  });

  it("an example is read from the one key the step owns, and from nowhere else", () => {
    const base = registry.get("invoice.get")!;

    // The positive case first, so the three refusals below are not testing nothing.
    expect(
      exampleRequestOf({
        ...base,
        extensions: { [TUTORIAL_EXTENSION]: { example_request: { invoice: "x" } } },
      }),
    ).toStrictEqual({ invoice: "x" });
    // The right field under no key at all is not the step's key.
    expect(
      exampleRequestOf({ ...base, extensions: { example_request: { invoice: "x" } } }),
    ).toBeUndefined();
    // Neither an array nor a null where the step's object should be; both found by a mutation pass.
    expect(
      exampleRequestOf({ ...base, extensions: { [TUTORIAL_EXTENSION]: { example_request: [] } } }),
    ).toBeUndefined();
    expect(
      exampleRequestOf({ ...base, extensions: { [TUTORIAL_EXTENSION]: null } }),
    ).toBeUndefined();

    expect(exampleRequestOf({ ...base, extensions: undefined })).toBeUndefined();
    expect(
      exampleRequestOf({ ...base, extensions: { "com.example.other": { example_request: {} } } }),
    ).toBeUndefined();
    // Not an object: not an example. A string there would be a bug in the contract, not a request.
    expect(
      exampleRequestOf({
        ...base,
        extensions: { "com.panaversity.tutorial": { example_request: "dsor://org_456/x/1" } },
      }),
    ).toBeUndefined();
  });
});
