// Lookups.json and the company keys, checked when pnpm serve starts (step 45's
// README, C1 and D11). Each company's lookup is an address in the file and a key in the
// environment, and the key is never written down anywhere else: not in the file, not in a
// problem, not in a record.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createLog } from "../src/log.ts";
import { lookupDirectory } from "../src/lookup.ts";
import { checkLookups, keyVariable, readLookups } from "../src/lookups.ts";
import { call } from "../src/pipeline.ts";
import { AGENT, FIRM_IN_789, slipRegistry } from "./helpers.ts";
import { startSignInServer, type SignInServer } from "./sign-in-server.ts";

const SSO = "http://localhost:3011/api/dsor/lookup";
const BOTH = ["org_456", "org_789"];
const KEYS = {
  DSOR_LOOKUP_KEY_ORG_456: "key-of-org-456",
  DSOR_LOOKUP_KEY_ORG_789: "key-of-org-789",
};

/** The problems of a lookups file with this content, for these companies and keys. */
function problemsOf(data: unknown, env: NodeJS.ProcessEnv = KEYS, companies = BOTH): string[] {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return checkLookups({ file: "lookups.json", text }, companies, env).problems;
}

const GOOD = { org_456: { address: SSO }, org_789: { address: SSO } };

describe("C1 and D11: lookups.json and the keys, checked at start-up", () => {
  it("D11: the shipped lookups.json names the Panaversity SSO's lookup on this computer for both companies", () => {
    const { lookups, problems } = checkLookups(readLookups(), BOTH, KEYS);
    expect(problems).toStrictEqual([]);
    expect(lookups).toStrictEqual(
      new Map([
        ["org_456", { address: SSO, key: "key-of-org-456" }],
        ["org_789", { address: SSO, key: "key-of-org-789" }],
      ]),
    );
  });

  it("D11: org_456's key is DSOR_LOOKUP_KEY_ORG_456, and org_789's is DSOR_LOOKUP_KEY_ORG_789", () => {
    expect(keyVariable("org_456")).toBe("DSOR_LOOKUP_KEY_ORG_456");
    expect(keyVariable("org_789")).toBe("DSOR_LOOKUP_KEY_ORG_789");
  });

  it("D11: start-up refuses org_456 with a lookup and no key, or an empty one, and names the variable", () => {
    const missing = "lookups.json: org_456 has a lookup, and DSOR_LOOKUP_KEY_ORG_456 is not set";
    expect(problemsOf(GOOD, { DSOR_LOOKUP_KEY_ORG_789: "key-of-org-789" })).toStrictEqual([
      missing,
    ]);
    expect(problemsOf(GOOD, { ...KEYS, DSOR_LOOKUP_KEY_ORG_456: "" })).toStrictEqual([missing]);
  });

  it("D11: a key with a space or a line break is refused, and the problem never shows the key", () => {
    for (const key of ["two words", "line\nbreak", "tab\there"]) {
      const problems = problemsOf(GOOD, { ...KEYS, DSOR_LOOKUP_KEY_ORG_456: key });
      expect(problems).toStrictEqual([
        "lookups.json: DSOR_LOOKUP_KEY_ORG_456 must be one word of letters, digits, and - . _ ~ + /, as a Bearer credential has",
      ]);
      expect(problems.join(" ")).not.toContain(key);
    }
  });

  it("DSOR-CNR-02: a key written in lookups.json is refused: a key comes from the environment, never from a file", () => {
    const written = { ...GOOD, org_456: { address: SSO, key: "key-of-org-456" } };
    const problems = problemsOf(written);
    expect(problems).toStrictEqual([
      'lookups.json: org_456 has only an address, not "key": its key comes from DSOR_LOOKUP_KEY_ORG_456, never from a file',
    ]);
    expect(problems.join(" ")).not.toContain("key-of-org-456");
  });

  it("D11: an address over plain http to another computer, with a password, or with a query of its own is refused", () => {
    const address =
      "lookups.json: org_456's address must be an https address, or http on this computer (127.0.0.1 or localhost), with no query";
    for (const bad of [
      "http://sso.example.com/api/dsor/lookup",
      "https://dsor:secret@sso.example.com/api/dsor/lookup",
      "https://sso.example.com/api/dsor/lookup?tenant=org_789",
      "sso.example.com/api/dsor/lookup",
      7,
    ]) {
      expect(problemsOf({ ...GOOD, org_456: { address: bad } })).toStrictEqual([address]);
    }
    expect(
      problemsOf({ ...GOOD, org_456: { address: "https://sso.example.com/lookup" } }),
    ).toStrictEqual([]);
  });

  it("D11: a company with a role source and no lookup is refused, and so is a lookup for a company with none", () => {
    expect(problemsOf({ org_456: { address: SSO } })).toStrictEqual([
      "lookups.json: org_789, which has a role source, has no lookup",
    ]);
    expect(problemsOf({ ...GOOD, org_999: { address: SSO } })).toStrictEqual([
      "lookups.json: org_999 has a lookup, but no role source",
    ]);
  });

  it("D11: a file that is not one object, a company id that is not one, and a company written twice are refused", () => {
    expect(problemsOf("[")).toStrictEqual(["lookups.json: not valid JSON"]);
    expect(problemsOf([])).toStrictEqual([
      "lookups.json: must be an object that gives each company its lookup",
    ]);
    expect(problemsOf({ ...GOOD, acme: { address: SSO } })).toStrictEqual([
      'lookups.json: "acme" is not a company id like org_456',
    ]);
    const twice = `{"org_456": {"address": "${SSO}"}, "org_789": {"address": "${SSO}"}, "org_456": {"address": "${SSO}"}}`;
    expect(problemsOf(twice)).toStrictEqual([
      'lookups.json: "org_456" is written twice in one object',
    ]);
  });

  it("D11: pnpm serve stops on any problem in lookups.json, and asks each company's lookup, never a fake directory", () => {
    // serve.ts starts a server on import, so its wiring is read as text, as step 44's test does.
    const serve = readFileSync(new URL("../src/serve.ts", import.meta.url), "utf8");
    expect(serve).toMatch(/if \(lookupProblems\.length > 0\) \{?\s*refuse\(/);
    expect(serve).toMatch(/lookupDirectory\(\{ tenant, address, key \}\)/);
    expect(serve).not.toMatch(/fakeDirectory/);
  });

  it("D11: pnpm serve reads no key from .env, a file, and keeps the answers on a pool of their own", () => {
    const serve = readFileSync(new URL("../src/serve.ts", import.meta.url), "utf8");
    // Found by step 45's review, finding 7: the keys were read from .env too.
    expect(serve).toMatch('loadDotEnv(["DSOR_DB_URL", "DSOR_HTTP_PORT"]);');
    expect(serve).not.toMatch(/keyVariable/);
    // And mutation SV1: on the main pool, releases waited for each other forever.
    expect(serve).toMatch(/createDbAnswers\(openPool\(/);
  });
});

describe("C1 and D1: each company's lookup uses that company's key, and no other", () => {
  let servers: SignInServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers = [];
  });

  it("D1: org_789's lookup sends org_789's key and never org_456's, and no record holds either key", async () => {
    const of456 = await startSignInServer("org_456", {
      user_123: { status: "active", roles: ["ap_supervisor"] },
    });
    const of789 = await startSignInServer("org_789", {
      user_700: { status: "active", roles: ["ap_supervisor"] },
    });
    servers = [of456, of789];
    const text = JSON.stringify({
      org_456: { address: of456.address },
      org_789: { address: of789.address },
    });
    const env = { DSOR_LOOKUP_KEY_ORG_456: of456.key, DSOR_LOOKUP_KEY_ORG_789: of789.key };
    const { lookups, problems } = checkLookups({ file: "lookups.json", text }, BOTH, env);
    expect(problems).toStrictEqual([]);
    const directories = new Map(
      [...lookups].map(([tenant, { address, key }]) => [
        tenant,
        lookupDirectory({ tenant, address, key }),
      ]),
    );
    const registry = slipRegistry(undefined, undefined, [], directories);
    const log = createLog();
    const read = { invoice: "dsor://org_456/invoice/INV-1008" };
    expect(await call(registry, log, AGENT, "invoice.get", read)).toMatchObject({
      data: { id: "INV-1008" },
    });
    // The firm's agent, under del_102, which user_700 signed in org_789.
    const theirs = { invoice: "dsor://org_789/invoice/INV-1008" };
    expect(await call(registry, log, FIRM_IN_789, "invoice.get", theirs)).toMatchObject({
      data: { id: "INV-1008" },
    });
    expect(of456.seen()).toStrictEqual([
      { tenant: "org_456", person: "user_123", authorization: `Bearer ${of456.key}` },
    ]);
    expect(of789.seen()).toStrictEqual([
      { tenant: "org_789", person: "user_700", authorization: `Bearer ${of789.key}` },
    ]);
    const written = JSON.stringify(await log.records());
    expect(written).not.toContain(of456.key);
    expect(written).not.toContain(of789.key);
  });
});
