// Step 43: each company names the sign-in services it trusts, in issuers.json, checked at start-up
// (DSOR-IDN-04a; step 43's README, claim C1, decision D3).
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkIssuers, readIssuers } from "../src/issuers.ts";
import { logins } from "../src/principals.ts";

const people = [...logins.values()];
const DEV = "http://127.0.0.1:8043";
const ONE = { issuer: DEV, audience: DEV, jwks: `${DEV}/.well-known/jwks.json` };
// The learner's project dsor-baby-steps on Neon: its Auth URL's origin is the issuer and the
//   audience, and its keys are under the Auth URL (Neon's documentation, 2026-10-23).
const NEON_ORIGIN = "https://ep-mute-hall-b5uk82zn.neonauth.c-7.us-east-2.aws.neon.tech";
const NEON = {
  issuer: NEON_ORIGIN,
  audience: NEON_ORIGIN,
  jwks: `${NEON_ORIGIN}/neondb/auth/.well-known/jwks.json`,
};

/** The problems of a file with this content. */
function problemsOf(data: unknown): string[] {
  return checkIssuers({ file: "issuers.json", text: JSON.stringify(data) }, people).problems;
}

describe("C1: issuers.json, checked at start-up", () => {
  it("DSOR-IDN-04a: the shipped file passes, and names the learner's Managed Better Auth on Neon for org_456 and org_789", () => {
    const { issuers, problems } = checkIssuers(readIssuers(), people);
    expect(problems).toStrictEqual([]);
    expect([...issuers.keys()].sort()).toStrictEqual(["org_456", "org_789"]);
    expect(issuers.get("org_456")).toStrictEqual([NEON]);
  });

  it("Step 43, D9: issuers.stand-in.json passes too, and names the stand-in on this computer", () => {
    const file = fileURLToPath(new URL("../issuers.stand-in.json", import.meta.url));
    const { issuers, problems } = checkIssuers(readIssuers(file), people);
    expect(problems).toStrictEqual([]);
    expect(issuers.get("org_456")).toStrictEqual([ONE]);
  });

  it("DSOR-IDN-04a: a company where people log in with no issuer is refused", () => {
    expect(problemsOf({ org_456: [ONE] })).toStrictEqual([
      "issuers.json: org_789, where people log in, names no issuer",
    ]);
    expect(problemsOf({ org_456: [ONE], org_789: [] })).toStrictEqual([
      "issuers.json: org_789, where people log in, names no issuer",
    ]);
  });

  it("DSOR-IDN-04a: a company where nobody logs in is refused, as a typo", () => {
    expect(problemsOf({ org_456: [ONE], org_789: [ONE], org_999: [ONE] })).toStrictEqual([
      "issuers.json: org_999 is no company where people log in",
    ]);
  });

  it.each([
    ["http://auth.example.com", "issuer"],
    ["https://auth.example.com", "jwks"],
    ["ftp://127.0.0.1:8043", "issuer"],
    ["http://localhost:8043", "issuer"],
    ["not a url", "audience"],
  ])("Step 43, D3: %s as the %s is refused: https, or http on 127.0.0.1 only", (url, field) => {
    const bad = {
      ...ONE,
      [field]: url,
      ...(field === "jwks" ? { jwks: "http://keys.example.com/jwks.json" } : {}),
    };
    const problems = problemsOf({ org_456: [bad], org_789: [ONE] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^issuers\.json: org_456, issuer 1: (issuer|audience|jwks) must be an https address, or http on 127\.0\.0\.1$/,
    );
  });

  it("Step 43, D3: a field the file does not know, and a missing one, are refused", () => {
    expect(
      problemsOf({ org_456: [{ ...ONE, roles_claim: "role" }], org_789: [ONE] }),
    ).toStrictEqual([
      'issuers.json: org_456, issuer 1: an issuer has only issuer, audience, and jwks, not "roles_claim"',
    ]);
    const { jwks: _gone, ...noKeys } = ONE;
    expect(problemsOf({ org_456: [noKeys], org_789: [ONE] })).toStrictEqual([
      "issuers.json: org_456, issuer 1: jwks must be an https address, or http on 127.0.0.1",
    ]);
  });

  it("Step 43, D3: one issuer named twice for one company is refused", () => {
    expect(problemsOf({ org_456: [ONE, ONE], org_789: [ONE] })).toStrictEqual([
      `issuers.json: org_456 names ${DEV} twice`,
    ]);
  });

  it("Step 43, D3: an issuer two companies name must have the same audience and keys in both", () => {
    const other = { ...ONE, audience: "https://another-app.example" };
    expect(problemsOf({ org_456: [ONE], org_789: [other] })).toStrictEqual([
      `issuers.json: ${DEV} has another audience or keys in org_789 than in org_456`,
    ]);
  });

  it("Step 43, D3: a file that is not JSON, or not one list for each company, is refused", () => {
    expect(checkIssuers({ file: "issuers.json", text: "{" }, people).problems[0]).toMatch(
      /^issuers\.json is not JSON/,
    );
    expect(problemsOf([ONE])).toStrictEqual([
      "issuers.json must be one list of issuers for each company",
    ]);
    expect(problemsOf({ org_456: ONE, org_789: [ONE] })).toStrictEqual([
      "issuers.json: org_456 must be a list of issuers",
    ]);
  });
});
