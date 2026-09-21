import { describe, expect, it } from "vitest";
import { greet } from "../src/greet.ts";

describe("greet", () => {
  it("greets the caller by name", () => {
    expect(greet("accounts-payable-fte")).toBe("Hello, accounts-payable-fte.");
  });

  // Test the "no" as carefully as the "yes". From step 06 onward, most of what
  // DSoR does is refuse things, and a refusal nobody tested is a refusal nobody has.
  it("refuses an empty name", () => {
    expect(() => greet("   ")).toThrow(TypeError);
  });
});
