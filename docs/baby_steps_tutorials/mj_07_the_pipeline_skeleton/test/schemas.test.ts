// The schema files are copies. This test keeps them equal to the specification's own,
// whenever the specification is there to compare with.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COPIES = fileURLToPath(new URL("../schemas/", import.meta.url));
// Inside the dsor repository, four folders up from here. A copy of this step outside the
// repository has no original, so the test is skipped there. CI runs inside.
const ORIGINALS = fileURLToPath(new URL("../../../../packages/spec/schemas/", import.meta.url));

describe("the schema copies", () => {
  it
    .skipIf(!existsSync(ORIGINALS))
    .each([["operation-contract.schema.json"], ["common.schema.json"]])(
    "DSOR-OPR-01: schemas/%s equals the specification's own",
    (file) => {
      expect(readFileSync(COPIES + file, "utf8")).toBe(readFileSync(ORIGINALS + file, "utf8"));
    },
  );

  // The error envelope's schema is a copy too (step 04's README, decision 6).
  it.skipIf(!existsSync(ORIGINALS))(
    "DSOR-ERR-01a: schemas/error-envelope.schema.json equals the specification's own",
    () => {
      const file = "error-envelope.schema.json";
      expect(readFileSync(COPIES + file, "utf8")).toBe(readFileSync(ORIGINALS + file, "utf8"));
    },
  );
});
