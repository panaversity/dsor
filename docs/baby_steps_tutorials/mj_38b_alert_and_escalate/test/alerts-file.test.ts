// Step 38b: alerts.json names, for each company, the role that receives its alerts, the person an
// alert still open after the bound goes to, and the two bounds. Start-up checks it against the
// logins, the role table, and §44's ceilings, and refuses to start on any problem (DSOR-UNK-04b,
// DSOR-UNK-04c; step 38b's README, claim C6 and decisions D2, D4, and D7).
import { describe, expect, it } from "vitest";
import { checkAlerts, readAlerts } from "../src/alerts.ts";
import { checkRoles, readRoles } from "../src/permissions.ts";
import { logins } from "../src/principals.ts";
import { ruleWorld } from "./rule-world.ts";
import { fileURLToPath } from "node:url";

const ROLES = checkRoles(
  readRoles(fileURLToPath(new URL("../roles.json", import.meta.url))),
  logins.values(),
).roles;
const ORG_789 = {
  receivers: "ap_supervisor",
  escalate_to: "admin_700",
  alert_within: "PT0S",
  escalate_after: "PT1H",
};

/** The problems start-up names for this text, with org_789's line added unless it is given. */
function problemsOf(org456: unknown, more: Record<string, unknown> = { org_789: ORG_789 }) {
  const text = JSON.stringify({ org_456: org456, ...more });
  return checkAlerts({ file: "alerts.json", text }, logins.values(), ROLES).problems;
}

const GOOD = {
  receivers: "ap_supervisor",
  escalate_to: "cfo_100",
  alert_within: "PT0S",
  escalate_after: "PT1H",
};

describe("C6: start-up checks alerts.json", () => {
  it("DSOR-UNK-04c: the shipped file passes: org_456's alerts go to ap_supervisor, and after an hour to cfo_100", () => {
    const { alerts, problems } = checkAlerts(readAlerts(), logins.values(), ROLES);
    expect(problems).toStrictEqual([]);
    expect(alerts.get("org_456")).toStrictEqual({
      receivers: "ap_supervisor",
      escalate_to: "cfo_100",
      alert_within: "PT0S",
      escalate_after: "PT1H",
      escalate_ms: 60 * 60 * 1000,
    });
  });

  it("DSOR-UNK-04c: the person is checked: an agent, a system login, someone of another company, and nobody are refused", () => {
    expect(problemsOf({ ...GOOD, escalate_to: "accounts-payable-fte" })).toStrictEqual([
      'alerts.json: org_456\'s escalate_to "accounts-payable-fte" is not a person of org_456',
    ]);
    expect(problemsOf({ ...GOOD, escalate_to: "dsor-scheduler" })).toStrictEqual([
      'alerts.json: org_456\'s escalate_to "dsor-scheduler" is not a person of org_456',
    ]);
    expect(problemsOf({ ...GOOD, escalate_to: "user_700" })).toStrictEqual([
      'alerts.json: org_456\'s escalate_to "user_700" is not a person of org_456',
    ]);
    expect(problemsOf({ ...GOOD, escalate_to: "nobody_1" })).toStrictEqual([
      'alerts.json: org_456\'s escalate_to "nobody_1" is not a person of org_456',
    ]);
  });

  it("DSOR-UNK-04b: the receivers are checked: a role not in the table, and one no person of the company holds, are refused", () => {
    expect(problemsOf({ ...GOOD, receivers: "treasurer" })).toStrictEqual([
      'alerts.json: org_456\'s receivers "treasurer" is not a role in roles.json',
    ]);
    // dsor-scheduler holds scheduler in org_456, and it is not a person.
    expect(problemsOf({ ...GOOD, receivers: "scheduler" })).toStrictEqual([
      'alerts.json: org_456\'s receivers "scheduler" is a role no person of org_456 holds',
    ]);
  });

  it("DSOR-UNK-04b: the bounds are checked against §44: an alert over one minute, an escalation over one hour, and words that are not a duration are refused", () => {
    expect(problemsOf({ ...GOOD, alert_within: "PT2M" })).toStrictEqual([
      "alerts.json: org_456's alert_within \"PT2M\" is over one minute, §44's ceiling for DSOR-UNK-04b",
    ]);
    expect(problemsOf({ ...GOOD, escalate_after: "PT2H" })).toStrictEqual([
      "alerts.json: org_456's escalate_after \"PT2H\" is over one hour, §44's ceiling for DSOR-UNK-04c",
    ]);
    expect(problemsOf({ ...GOOD, escalate_after: "1 hour" })).toStrictEqual([
      'alerts.json: org_456\'s escalate_after "1 hour" is not a duration such as PT1H',
    ]);
  });

  it("DSOR-UNK-04c: a company where a login works, left out, and a line that is not an object, or names a field twice or none at all, are refused", () => {
    expect(problemsOf(GOOD, {})).toStrictEqual([
      "alerts.json: org_789 has no alerts, and a login works there",
    ]);
    expect(problemsOf("cfo_100")).toStrictEqual([
      "alerts.json: org_456 must be an object with receivers, escalate_to, alert_within, and escalate_after",
    ]);
    const { escalate_to: _, ...missing } = GOOD;
    expect(problemsOf(missing)).toStrictEqual([
      "alerts.json: org_456 must be an object with receivers, escalate_to, alert_within, and escalate_after",
    ]);
    expect(problemsOf({ ...GOOD, cc: "user_123" })).toStrictEqual([
      "alerts.json: org_456 must be an object with receivers, escalate_to, alert_within, and escalate_after",
    ]);
    const twice = '{ "org_456": {}, "org_456": {} }';
    expect(
      checkAlerts({ file: "alerts.json", text: twice }, logins.values(), ROLES).problems,
    ).toContain('alerts.json: "org_456" is written twice in one object');
    expect(
      checkAlerts({ file: "alerts.json", text: "not json" }, logins.values(), ROLES).problems,
    ).toStrictEqual(["alerts.json: not valid JSON"]);
  });

  it("DSOR-UNK-04c: a registry built with a broken alerts file refuses to start, and names the problem", () => {
    const broken = { file: "alerts.json", text: JSON.stringify({ org_456: GOOD }) };
    const args = new Array(10).fill(undefined) as unknown as Parameters<typeof ruleWorld>;
    args[10] = broken;
    expect(() => ruleWorld(...args)).toThrow(
      "alerts.json: org_789 has no alerts, and a login works there",
    );
  });
});
