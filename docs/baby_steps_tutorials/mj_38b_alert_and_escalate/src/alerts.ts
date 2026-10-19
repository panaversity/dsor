// NEW IN STEP 38b: each company's alerts, read from alerts.json at start-up and checked there, as
// ready-lifetimes.json is. An alert is DSoR's note that a payment's outcome is unknown and needs a
// person: the proposal store raises it with the move to OUTCOME_UNKNOWN and closes it with the move
// out (DSOR-UNK-04b). One still open after escalate_after goes to escalate_to, by the sweep
// alert.escalate_due (DSOR-UNK-04c). The receivers are the role whose people step 38c's list of
// alerts will show them to (step 38b's README, decisions D1 to D7).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { millisecondsOf } from "./authority.ts";
import { keysWrittenTwice } from "./json.ts";
import type { Roles } from "./permissions.ts";
import type { Principal } from "./principals.ts";
import { isTenantId } from "./uri.ts";

/** One alert, as the proposal store keeps it. */
export type Alert = {
  proposal: string;
  state: "open" | "escalated" | "closed";
  raised_at: string;
  escalated_to?: string;
  escalated_at?: string;
  outcome?: "COMMITTED" | "FAILED";
  closed_at?: string;
};

/** One company's alerts, once start-up has checked them, with the escalation bound in ms. */
export type Alerting = {
  receivers: string;
  escalate_to: string;
  alert_within: string;
  escalate_after: string;
  escalate_ms: number;
};

/** The alerts file, as it was read from disk: its name and its text. */
export type AlertsSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../alerts.json", import.meta.url));

/** Reads the alerts file: this step's own, unless another is named. */
export function readAlerts(path: string = SHIPPED): AlertsSource {
  return { file: "alerts.json", text: readFileSync(path, "utf8") };
}

// The specification's own pattern for a duration, as for the READY lifetimes.
// copied from packages/spec/schemas/common.schema.json#/$defs/duration/pattern
const DURATION = /^P(?!$)([0-9]+D)?(T([0-9]+H)?([0-9]+M)?([0-9]+S)?)?$/;
const FIELDS = ["receivers", "escalate_to", "alert_within", "escalate_after"];
// §44's ceilings: an alert within one minute, a person within one hour.
const BOUNDS = {
  alert_within: { ms: 60 * 1000, words: "one minute", rule: "DSOR-UNK-04b" },
  escalate_after: { ms: 60 * 60 * 1000, words: "one hour", rule: "DSOR-UNK-04c" },
} as const;

/** The problems of one company's line, or its checked alerts. */
function checkOne(
  file: string,
  tenant: string,
  line: unknown,
  principals: readonly Principal[],
  roles: Roles,
): Alerting | string[] {
  const shape = `${file}: ${tenant} must be an object with receivers, escalate_to, alert_within, and escalate_after`;
  if (typeof line !== "object" || line === null || Array.isArray(line)) return [shape];
  const keys = Object.keys(line);
  const given = line as Record<string, unknown>;
  const words = FIELDS.every((field) => typeof given[field] === "string");
  if (keys.length !== FIELDS.length || !words) return [shape];
  type Line = Record<"receivers" | "escalate_to" | "alert_within" | "escalate_after", string>;
  const { receivers, escalate_to, alert_within, escalate_after } = given as Line;
  const problems: string[] = [];
  const named = (field: string, value: string): string =>
    `${file}: ${tenant}'s ${field} ${JSON.stringify(value)}`;
  // A person: a human with a membership in this company. Never an agent or a system login.
  const people = principals.filter(
    (p) => p.type === "human" && p.memberships.some((m) => m.tenant_id === tenant),
  );
  if (!people.some((p) => p.id === escalate_to)) {
    problems.push(`${named("escalate_to", escalate_to)} is not a person of ${tenant}`);
  }
  const holds = (p: Principal): boolean =>
    p.memberships.some((m) => m.tenant_id === tenant && m.roles.includes(receivers));
  if (!roles.has(receivers)) {
    problems.push(`${named("receivers", receivers)} is not a role in roles.json`);
  } else if (!people.some(holds)) {
    problems.push(`${named("receivers", receivers)} is a role no person of ${tenant} holds`);
  }
  const values = { alert_within, escalate_after };
  for (const [field, bound] of Object.entries(BOUNDS)) {
    const value = values[field as keyof typeof values];
    if (!DURATION.test(value)) {
      problems.push(`${named(field, value)} is not a duration such as PT1H`);
    } else if (millisecondsOf(value) > bound.ms) {
      problems.push(
        `${named(field, value)} is over ${bound.words}, §44's ceiling for ${bound.rule}`,
      );
    }
  }
  if (problems.length > 0) return problems;
  return {
    receivers,
    escalate_to,
    alert_within,
    escalate_after,
    escalate_ms: millisecondsOf(escalate_after),
  };
}

/** Checks each company's alerts, and names every problem. */
export function checkAlerts(
  source: AlertsSource,
  principals: Iterable<Principal>,
  roles: Roles,
): { alerts: ReadonlyMap<string, Alerting>; problems: string[] } {
  const { file, text } = source;
  const alerts = new Map<string, Alerting>();
  const everyone = [...principals];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { alerts, problems: [`${file}: not valid JSON`] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { alerts, problems: [`${file}: must be an object that gives each company its alerts`] };
  }
  // JSON.parse keeps the last of two lines for one company, and says nothing.
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  for (const [tenant, line] of Object.entries(data)) {
    if (!isTenantId(tenant)) {
      problems.push(`${file}: ${JSON.stringify(tenant)} is not a company id like org_456`);
      continue;
    }
    const checked = checkOne(file, tenant, line, everyone, roles);
    if (Array.isArray(checked)) problems.push(...checked);
    else alerts.set(tenant, checked);
  }
  // Every company where a login works needs its alerts, or its unknown payments would tell nobody.
  const companies = new Set(everyone.flatMap((p) => p.memberships.map((m) => m.tenant_id)));
  for (const tenant of [...companies].sort()) {
    if (!Object.hasOwn(data, tenant)) {
      problems.push(`${file}: ${tenant} has no alerts, and a login works there`);
    }
  }
  return { alerts, problems };
}
