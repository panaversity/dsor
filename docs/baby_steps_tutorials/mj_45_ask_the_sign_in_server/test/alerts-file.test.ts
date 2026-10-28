// Step 38b: alerts.json names, for each company, the role that receives its alerts, the person an
// alert still open after the bound goes to, the two bounds, and how often the sweep runs. Start-up
// checks it against the logins, the role table, and §44's ceilings, and refuses to start on any
// problem (DSOR-UNK-04b, DSOR-UNK-04c; step 38b's README, claim C6 and decisions D2, D4, D7, D10,
// and D11).
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkAlerts, readAlerts } from "../src/alerts.ts";
import { checkRoles, readRoles } from "../src/permissions.ts";
import { logins } from "../src/principals.ts";
import { ruleWorld } from "./rule-world.ts";

const ROLES = checkRoles(
  readRoles(fileURLToPath(new URL("../roles.json", import.meta.url))),
  logins.values(),
).roles;
const GOOD = {
  receivers: "ap_supervisor",
  escalate_to: "cfo_100",
  alert_within: "PT0S",
  escalate_after: "PT59M",
  sweep_every: "PT1M",
};
const ORG_789 = { ...GOOD, escalate_to: "user_700" };
const SHAPE =
  "alerts.json: org_456 must be an object with receivers, escalate_to, alert_within, escalate_after, and sweep_every";

/** The problems start-up names for this text, with org_789's line added unless it is given. */
function problemsOf(org456: unknown, more: Record<string, unknown> = { org_789: ORG_789 }) {
  const text = JSON.stringify({ org_456: org456, ...more });
  return checkAlerts({ file: "alerts.json", text }, logins.values(), ROLES).problems;
}

describe("C6: start-up checks alerts.json", () => {
  it("DSOR-UNK-04c: the shipped file passes: org_456's alerts go to ap_supervisor, and after 59 minutes to cfo_100", () => {
    const { alerts, problems } = checkAlerts(readAlerts(), logins.values(), ROLES);
    expect(problems).toStrictEqual([]);
    expect(alerts.get("org_456")).toStrictEqual({ ...GOOD, escalate_ms: 59 * 60 * 1000 });
  });

  // Changed in step 45: DSoR's table holds no person, so only a login it knows as no person is
  //   refused here. Whether someone works in the company, her company says when she acts
  //   (step 45's README, D15).
  it("DSOR-UNK-04c: the person is checked: an agent and a system login are refused", () => {
    for (const who of ["accounts-payable-fte", "dsor-scheduler"]) {
      expect(problemsOf({ ...GOOD, escalate_to: who })).toStrictEqual([
        `alerts.json: org_456's escalate_to "${who}" is not a person`,
      ]);
    }
  });

  it("D15: start-up no longer reads a person's job: user_700 of org_789, and nobody_1, pass; org_456's lookup decides when they act", () => {
    for (const who of ["user_700", "nobody_1"]) {
      expect(problemsOf({ ...GOOD, escalate_to: who })).toStrictEqual([]);
    }
  });

  // Found by step 38b's review, M3: cfo_100 was the person, and could not settle the payment.
  // Changed in step 45: start-up no longer checks what the person holds, as step 38b's review
  //   (M3) had it: DSoR's table holds no person (step 45's README, D15, open).
  it("D15: start-up no longer reads the escalation person's job: admin_100, who holds no payment:reconcile, passes", () => {
    expect(problemsOf({ ...GOOD, escalate_to: "admin_100" })).toStrictEqual([]);
  });

  // Found by step 38c's review, H1: a role table without alert:read started cleanly, and then
  //   nobody could list an alert.
  // Changed in step 45: the role only. The person's job is no longer read (D15).
  it("DSOR-UNK-04c: a receivers role that holds no alert:read is refused", () => {
    const without = Object.fromEntries(
      [...ROLES].map(([role, held]) => [
        role,
        new Set([...held].filter((p) => p !== "alert:read")),
      ]),
    );
    const roles = new Map(Object.entries(without));
    const text = JSON.stringify({ org_456: GOOD, org_789: ORG_789 });
    const problems = checkAlerts({ file: "alerts.json", text }, logins.values(), roles).problems;
    expect(problems).toStrictEqual([
      'alerts.json: org_456\'s receivers "ap_supervisor" is a role that holds no alert:read',
      'alerts.json: org_789\'s receivers "ap_supervisor" is a role that holds no alert:read',
    ]);
  });

  // Changed in step 45: who holds a role is the company's to say, so a role no person of the
  //   company holds is no longer found here (D15). scheduler is refused for holding no
  //   alert:read, and CFO in org_789 passes.
  it("DSOR-UNK-04b: the receivers are checked: a role not in the table, and one that holds no alert:read, are refused", () => {
    expect(problemsOf({ ...GOOD, receivers: "treasurer" })).toStrictEqual([
      'alerts.json: org_456\'s receivers "treasurer" is not a role in roles.json',
    ]);
    // dsor-scheduler holds scheduler in org_456, and it is not a person.
    expect(problemsOf({ ...GOOD, receivers: "scheduler" })).toStrictEqual([
      'alerts.json: org_456\'s receivers "scheduler" is a role that holds no alert:read',
    ]);
    expect(problemsOf(GOOD, { org_789: { ...ORG_789, receivers: "CFO" } })).toStrictEqual([]);
  });

  it("DSOR-UNK-04b: alert_within is checked against §44's minute: PT1M passes, PT61S and words that are not a duration are refused", () => {
    expect(problemsOf({ ...GOOD, alert_within: "PT1M" })).toStrictEqual([]);
    expect(problemsOf({ ...GOOD, alert_within: "PT61S" })).toStrictEqual([
      "alerts.json: org_456's alert_within \"PT61S\" is over one minute, §44's ceiling for DSOR-UNK-04b",
    ]);
    expect(problemsOf({ ...GOOD, alert_within: "soon" })).toStrictEqual([
      'alerts.json: org_456\'s alert_within "soon" is not a duration such as PT1H',
    ]);
  });

  // Found by step 38b's review, M2: PT1H alone, with a sweep every minute, escalated up to a
  //   minute after the hour.
  it("DSOR-UNK-04c: escalate_after and one sweep's wait must fit in §44's hour: PT59M with PT1M passes; PT1H with PT1M, and PT59M with PT61S, are refused", () => {
    expect(problemsOf({ ...GOOD, escalate_after: "PT1H", sweep_every: "PT1M" })).toStrictEqual([
      'alerts.json: org_456\'s escalate_after "PT1H" with sweep_every "PT1M" can be over one hour, §44\'s ceiling for DSOR-UNK-04c',
    ]);
    expect(problemsOf({ ...GOOD, sweep_every: "PT61S" })).toStrictEqual([
      'alerts.json: org_456\'s escalate_after "PT59M" with sweep_every "PT61S" can be over one hour, §44\'s ceiling for DSOR-UNK-04c',
    ]);
    expect(problemsOf({ ...GOOD, sweep_every: "PT0S" })).toStrictEqual([
      'alerts.json: org_456\'s sweep_every "PT0S" is zero, so the sweep would never wait',
    ]);
    expect(problemsOf({ ...GOOD, escalate_after: "1 hour" })).toStrictEqual([
      'alerts.json: org_456\'s escalate_after "1 hour" is not a duration such as PT1H',
    ]);
  });

  it("DSOR-UNK-04c: a company where a login works, left out, a key that is not a company, and a line that is not an object, or names a field twice, one too few, or one too many, are refused", () => {
    expect(problemsOf(GOOD, {})).toStrictEqual([
      "alerts.json: org_789 has no alerts, and a login works there",
    ]);
    expect(problemsOf(GOOD, { org_789: ORG_789, acme: GOOD })).toStrictEqual([
      'alerts.json: "acme" is not a company id like org_456',
    ]);
    expect(problemsOf("cfo_100")).toStrictEqual([SHAPE]);
    const { escalate_to: _, ...missing } = GOOD;
    expect(problemsOf(missing)).toStrictEqual([SHAPE]);
    expect(problemsOf({ ...GOOD, cc: "user_123" })).toStrictEqual([SHAPE]);
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
    const args = Array.from({ length: 10 }) as unknown as Parameters<typeof ruleWorld>;
    args[10] = broken;
    expect(() => ruleWorld(...args)).toThrow(
      "alerts.json: org_789 has no alerts, and a login works there",
    );
  });
});
