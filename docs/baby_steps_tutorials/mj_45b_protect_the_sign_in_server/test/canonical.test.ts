// The fingerprint, in full (step 29's README, claim C1, decision D6). A payload hash is SHA-256
// over the RFC 8785 canonical JSON of the stored input (DSOR-APR-02b). Step 20 built most of it,
// early; these tests hold it to RFC 8785's own examples. RFC 8785 takes only I-JSON, so text that
// holds a lone surrogate has no canonical JSON, and line ⑥ refuses it.
import { describe, expect, it } from "vitest";
import { canonicalJson, NotCanonical, payloadHash } from "../src/canonical.ts";
import { CFO, keyed } from "./helpers.ts";
import { RULE, ruleWorldOnTuesday } from "./rule-world.ts";

describe("C1: canonical JSON, as RFC 8785 writes it (step 29's README, decision D6)", () => {
  // RFC 8785, section 3.2.4: its example of a whole object, typed out from the RFC.
  it("DSOR-APR-02b: RFC 8785's own example: the keys sorted, each number as JavaScript writes it, and each string escaped only where JSON must", () => {
    const input = JSON.parse(
      '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],' +
        ' "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        ' "literals": [null, true, false]}',
    );
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  // RFC 8785, section 3.2.3: its example of sorting, by UTF-16 code units.
  it("DSOR-APR-02b: RFC 8785's example of sorting: keys in the order of their UTF-16 code units, an emoji before a Hebrew letter", () => {
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    };
    // The text itself: an object read back from it would put "1" first, as JavaScript orders a key
    // that looks like an index.
    expect(canonicalJson(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control",' +
        '"\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign",' +
        '"\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  // RFC 8785, appendix B: numbers, each written as ECMAScript writes it.
  it.each([
    [9007199254740992, "9007199254740992"],
    [5e-324, "5e-324"],
    [-0, "0"],
    [1.7976931348623157e308, "1.7976931348623157e+308"],
    [1e23, "1e+23"],
    [1e21, "1e+21"],
    [999999999999999900000, "999999999999999900000"],
    [0.000001, "0.000001"],
    [1e-7, "1e-7"],
  ])("DSOR-APR-02b: RFC 8785's number %s is written %s", (value, written) => {
    expect(canonicalJson(value)).toBe(written);
  });

  it("DSOR-APR-02b: the fingerprint is SHA-256 over that text: the same request in another order, or with 4.50 for 4.5, has one fingerprint", () => {
    const one = JSON.parse('{"b": [4.50, "x"], "a": {"d": 1, "c": null}}');
    const two = JSON.parse('{"a": {"c": null, "d": 1}, "b": [4.5, "x"]}');
    expect(payloadHash(one)).toBe(payloadHash(two));
    expect(payloadHash(one)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("C1: text that is not I-JSON has no canonical JSON (step 29's README, decision D6)", () => {
  it.each([
    ["a high surrogate alone", "off \ud800 now"],
    ["a low surrogate alone", "\udc00"],
    ["two surrogates in the wrong order", "\ude00\ud83d"],
  ])("DSOR-APR-02b: %s, in a value or in a key, is refused", (_what, text) => {
    expect(() => canonicalJson({ reason: text })).toThrow(NotCanonical);
    expect(() => canonicalJson({ [text]: 1 })).toThrow(NotCanonical);
    expect(() => canonicalJson([[{ deep: [text] }]])).toThrow(NotCanonical);
  });

  it("DSOR-APR-02b: a whole emoji, its two halves in order, is valid text, and is written as itself", () => {
    expect(canonicalJson({ note: "😀" })).toBe('{"note":"\u{1F600}"}');
  });

  it("DSOR-APR-02b: line ⑥ refuses a request whose text holds a lone surrogate: cfo_100's suspension of version 8, with such a reason, is VALIDATION_FAILED, and version 8 stays active", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.ask(keyed(CFO), "rule.suspend", {
      rule: RULE,
      version: 8,
      reason: "audit week \ud800",
    });
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message:
        'the input of "rule.suspend" is not valid: it holds text that is not valid Unicode, a lone surrogate, so it has no canonical JSON and no fingerprint',
    });
    const versions = await w.rules.versions("org_456", "high-value-payment");
    expect(versions.map((v) => v.status)).toStrictEqual(["active"]);
  });
});
