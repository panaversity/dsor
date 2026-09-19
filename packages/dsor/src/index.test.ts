import { SPEC_VERSION } from "@panaversity/dsor-spec";
import { expect, it } from "vitest";
import { TARGET_SPEC_VERSION } from "./index.js";

it("targets the specification version that the spec package ships", () => {
  expect(TARGET_SPEC_VERSION).toBe(SPEC_VERSION);
});
