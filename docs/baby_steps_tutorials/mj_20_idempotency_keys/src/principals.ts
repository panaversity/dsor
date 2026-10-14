// Who is calling. DSoR finds the caller from the login token and its own
// table, never from the arguments. DSOR-IDN-01 in specs/dsor/02-security.md, section 12,
// and DSOR-SRC-02a and DSOR-SRC-02b in section 11.
import type { Label } from "./labels.ts";
import { Refusal } from "./envelope.ts";
import type { RequestEnvelope } from "./request.ts";

/** The four kinds of caller that §12 lists. */
export type PrincipalType = "human" | "agent" | "application" | "system";

// The same four, for start-up to check DSoR's table against (step 14's README, decision 5).
// Found by a hostile pass on the Stage 2 review's fix, and fixed from step 14 on.
/** The four kinds of caller, as text. */
export const PRINCIPAL_TYPES: readonly PrincipalType[] = [
  "human",
  "agent",
  "application",
  "system",
];

// The kinds of caller that are not agents: a person, an application, the system. Every
// other caller acts as an agent: its answers are masked, and an answer names it in
// agent_id. A type DSoR does not know, such as Agent in capitals, acts as an agent, and is
// never shown more (step 14's README, decision 5). One rule, for both. Found by a hostile
// pass on the Stage 2 review's fix, and fixed from step 14 on.
const NOT_AGENTS: ReadonlySet<string> = new Set(["human", "application", "system"]);

// The roles say what the principal may do there (step 06's README, decision 1).
/** A company the principal belongs to, and its roles there. */
export type Membership = { tenant_id: string; roles: string[] };

// An agent's clearance, the highest label it may see. A person has none,
// because a person's answer is not masked (step 14's README, decisions 2 and 5).
/** Who is calling. */
export type Principal = {
  id: string;
  type: PrincipalType;
  memberships: Membership[];
  clearance?: Label;
};

// The principals of steps 05 to 09 belong to one company, org_456.
function principal(id: string, type: PrincipalType, roles: string[]): Principal {
  return { id, type, memberships: [{ tenant_id: "org_456", roles }] };
}

// DSoR's own table: each login token it gave, and to whom (step 05's README, decision 3).
// A token names nobody until it is looked up here (step 05's decision 2). §12 writes tenantId.
// This tutorial spells every field the way the schemas do.
export const logins: ReadonlyMap<string, Principal> = new Map([
  // The agent holds no role of its own. Its power comes from a person's
  // slip, del_100 (step 18's README, decisions 2 and 11). Step 06's stand-in role, ap_agent,
  // is gone, as step 06's README, decision 5, expected.
  // Internal, so amounts are masked. §19.2's example gives it
  // confidential (step 14's README, decision 2).
  ["tok_7f3a", { ...principal("accounts-payable-fte", "agent", []), clearance: "internal" }],
  ["tok_2c91", principal("user_123", "human", ["ap_supervisor"])],
  ["tok_d4e8", principal("cfo_100", "human", ["CFO"])],
  // An accounting firm's agent, working for two client companies, and org_789's own
  // supervisor (step 10's README, decision 7). Since step 18 the firm's agent holds no role:
  // its power in each company comes from that company's slip, del_101 and del_102.
  [
    "tok_9b52",
    {
      id: "firm-ap-fte",
      type: "agent",
      // The firm's agent sees what our own agent sees.
      clearance: "internal",
      memberships: [
        { tenant_id: "org_456", roles: [] },
        { tenant_id: "org_789", roles: [] },
      ],
    },
  ],
  [
    "tok_e1a7",
    {
      id: "user_700",
      type: "human",
      memberships: [{ tenant_id: "org_789", roles: ["ap_supervisor"] }],
    },
  ],
]);

// The person who signed a slip, found by name in DSoR's own table (step
// 18's README, decision 4).
/** The principal with this id in DSoR's table of logins, if there is one. */
export function principalNamed(id: string): Principal | undefined {
  for (const principal of logins.values()) if (principal.id === id) return principal;
  return undefined;
}

// Line ③ finds a slip's signer by name, so one name must be one principal.
// With two, the order of the table would decide the signer's power. Found by step 18's
// review (step 18's README, decision 19).
/** Every name that two different principals in a table of logins share. */
export function loginProblems(principals: Iterable<Principal>): string[] {
  const first = new Map<string, Principal>();
  const problems: string[] = [];
  for (const principal of principals) {
    const seen = first.get(principal.id);
    if (seen === undefined) first.set(principal.id, principal);
    else if (seen !== principal) {
      const why = "so DSoR could not tell which of them signed a slip";
      problems.push(`two logins name ${principal.id}, ${why}`);
    }
  }
  return problems;
}

/** Finds who is calling, from the login token and DSoR's own table, or refuses the call. */
export function whoIsCalling(request: RequestEnvelope): Principal {
  // The envelope comes from outside the program, so it may even be null.
  const token = request?.token;
  // Only text is looked up. A Map never turns its key into text, so ["tok_7f3a"] finds
  // nobody, and neither does "toString".
  const caller = typeof token === "string" ? logins.get(token) : undefined;
  // One message for every case, so a refusal never tells a caller which tokens exist.
  if (caller === undefined) {
    const message = "log in first: the call has no login token that DSoR gave";
    throw new Refusal("AUTHENTICATION_REQUIRED", message);
  }
  return caller;
}

/** The ids that name the caller in an answer's correlation (step 05's README, decision 9). */
export function callerIds(caller: Principal): { agent_id: string } | { principal_id: string } {
  // The specification's examples put an agent in agent_id. Anyone else goes in principal_id.
  // By the rule masking uses (actsAsAgent below), so the two never disagree. Found by a
  // hostile pass on the Stage 2 review's fix, and fixed from step 14 on.
  return actsAsAgent(caller) ? { agent_id: caller.id } : { principal_id: caller.id };
}

/** True for a caller DSoR treats as an agent: masked, and named in agent_id. */
export function actsAsAgent(principal: Principal): boolean {
  return !NOT_AGENTS.has(principal.type);
}

// The places where the arguments may name a principal (step 05's README, decision 4). A new
// spelling, such as as_user, is not caught. That is the decision's price.
const AT_THE_TOP = [
  "principal",
  "principal_id",
  "subject",
  "actor",
  "actor_chain",
  "agent_id",
  "user",
  // The slip's own word for its person, and §13.2's mode. Found by step 18's
  // review (step 18's README, decision 17).
  "delegator",
  "on_behalf_of",
];
const IN_CORRELATION = ["principal_id", "agent_id"];

/** Refuses the call when its arguments name anyone but the caller (DSOR-SRC-02b). */
export function checkNamedPrincipals(input: unknown, caller: Principal): void {
  // The input comes from outside the program, so it has no types yet.
  const top = input as { [field: string]: unknown } | null | undefined;
  const correlationInInput = top?.["correlation"] as { [field: string]: unknown } | undefined;
  for (const field of AT_THE_TOP) refuseUnlessCaller(top?.[field], field, caller);
  for (const field of IN_CORRELATION) {
    refuseUnlessCaller(correlationInInput?.[field], `correlation.${field}`, caller);
  }
}

// Anything there but the caller's own id is refused: another name, a name nobody has, or
// a list or an object that holds one. DSoR never looks the name up, so the refusal cannot
// tell the caller who exists.
function refuseUnlessCaller(named: unknown, place: string, caller: Principal): void {
  if (named !== undefined && named !== caller.id) {
    const message = `the arguments name someone other than the caller, in ${place}`;
    throw new Refusal("AUTHORIZATION_DENIED", message);
  }
}
