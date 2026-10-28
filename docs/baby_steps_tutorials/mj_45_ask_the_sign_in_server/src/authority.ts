// Line ③'s last question. Does the person who signed the slip still hold her
// job, and which roles does she hold now? DSoR asks her company's directory, never the
// request (DSOR-IDN-05 and DSOR-IDN-06 in specs/dsor/02-security.md, section 12.1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Directories, Directory } from "./directory.ts";
import { Refusal, type ErrorCode } from "./envelope.ts";
import { keysWrittenTwice } from "./json.ts";
import type { Principal } from "./principals.ts";
import type { Slip } from "./slips.ts";
import { isTenantId } from "./uri.ts";

/** What line ③ learned about the signer: her roles in this company, from where, and as of when. */
export type SignerAuthority = { roles: string[]; source: "role_source"; as_of: string };

// The refusal when the directory reports the signer as gone. It has step 19's
// code and message, so the agent hears nothing new, and it carries the directory's word and the
// time of its answer, so line ③ can suspend her slips before it refuses (DSOR-IDN-07; step 19b's
// README, decision 4). It names no company and no person: line ③ uses its own (decision 4).
/** A refusal that carries the directory's report: the signer is suspended or gone. */
export class SignerGone extends Refusal {
  readonly word: string;
  readonly as_of: string;

  constructor(code: ErrorCode, message: string, report: { word: string; as_of: string }) {
    super(code, message);
    this.word = report.word;
    this.as_of = report.as_of;
  }
}

/** One company's role source setting, once start-up has checked it. */
export type RoleSetting = { kind: "idp_lookup"; max_staleness: string; ms: number };

/** Each company's role source setting, by company. */
export type RoleSettings = ReadonlyMap<string, RoleSetting>;

/** The settings file, as it was read from disk: its name and its text. */
export type RoleSettingsSource = { file: string; text: string };

/** An answer DSoR checked and kept, with the time it arrived by DSoR's clock. */
export type Kept = { answer: Record<string, unknown>; at: number };

/** DSoR's side of the role source: the signer's current authority, or a refusal. */
export type RoleSource = {
  authorityOf: (tenant: string, slip: Slip, name: string) => Promise<SignerAuthority>;
};

const SHIPPED = fileURLToPath(new URL("../role-sources.json", import.meta.url));

/** Reads the settings file: this step's own, unless another is named. */
export function readRoleSettings(path: string = SHIPPED): RoleSettingsSource {
  return { file: "role-sources.json", text: readFileSync(path, "utf8") };
}

// The specification's schemas, copied byte for byte (step 03's README, decision 3). A setting
// is checked against the role_source part of the tenant policy, so its shape is typed once.
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
// As registry.ts builds its checker: name every problem, and never change what is checked.
const ajv = new Ajv2020({
  allErrors: true,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
  // NEW IN STEP 45: and no formats, as slips.ts builds its checker. An answer's as_of is read below,
  // by TIMESTAMP, so the checker neither checks a date-time nor warns at start-up that it cannot.
  // Found by the database run: pnpm start printed the warning, and must print nothing to stderr.
  validateFormats: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
ajv.addSchema(loadSchema("tenant-policy.schema.json"));
const validateSetting = ajv.compile({
  $ref: "urn:dsor:schema:1.3:tenant-policy#/properties/role_source",
});
// NEW IN STEP 45: the shape of an answer, from our proposal for the specification. It sits in
// proposals/, apart from the specification's own copies, until the proposal lands (step 45's
// README, D4, D12).
const PROPOSALS = new URL("../proposals/", import.meta.url);
ajv.addSchema(
  JSON.parse(readFileSync(new URL("role-source-answer.schema.json", PROPOSALS), "utf8")) as object,
);
const validateAnswer = ajv.compile({ $ref: "urn:dsor:schema:1.3:role-source-answer" });

// §44's limit for L2: the signer's authority may be at most 24 hours old (DSOR-BND-02).
const DAY = 24 * 60 * 60 * 1000;
// The schema's own pattern for a duration has passed, so each part is a number or missing.
// not copied: it only splits a duration that already matched the specification's pattern,
// common.schema.json's duration, into its days, hours, minutes, and seconds.
const PARTS = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** A duration that passed the schema, in milliseconds. */
// Exported, so the READY lifetimes read their durations the same way.
export function millisecondsOf(duration: string): number {
  const [, d = "0", h = "0", m = "0", s = "0"] = PARTS.exec(duration) ?? [];
  return (((Number(d) * 24 + Number(h)) * 60 + Number(m)) * 60 + Number(s)) * 1000;
}

/** Checks each company's setting, and names every problem. */
export function checkRoleSettings(
  source: RoleSettingsSource,
  principals: Iterable<Principal>,
): { settings: RoleSettings; problems: string[] } {
  const { file, text } = source;
  const settings = new Map<string, RoleSetting>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { settings, problems: [`${file}: not valid JSON`] };
  }
  // A list and null are objects in JavaScript too. Neither one names a company.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    const problem = `${file}: must be an object that gives each company its role source`;
    return { settings, problems: [problem] };
  }
  // JSON.parse keeps the last of two lines for one company, and says nothing.
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  for (const [tenant, setting] of Object.entries(data)) {
    if (!isTenantId(tenant)) {
      problems.push(`${file}: ${JSON.stringify(tenant)} is not a company id like org_456`);
      continue;
    }
    // The specification's shape first: a kind it knows, and a duration it can read.
    if (!validateSetting(setting)) {
      for (const error of validateSetting.errors ?? []) {
        problems.push(`${file}: ${tenant}${error.instancePath} ${error.message ?? "is wrong"}`);
      }
      continue;
    }
    const { kind, max_staleness } = setting as { kind: string; max_staleness: string };
    // Then this step: it builds a lookup only (step 19's README, decision 1).
    if (kind !== "idp_lookup") {
      const why = "is not built: step 19 asks a directory at each call, idp_lookup";
      problems.push(`${file}: ${tenant}'s kind ${JSON.stringify(kind)} ${why}`);
      continue;
    }
    // And §44's limit. A tighter value, zero too, is the company's to set (DSOR-BND-02).
    const ms = millisecondsOf(max_staleness);
    if (ms > DAY) {
      const why = "is over 24 hours, the most §44 allows at L2 (DSOR-BND-02)";
      problems.push(`${file}: ${tenant}'s max_staleness ${JSON.stringify(max_staleness)} ${why}`);
      continue;
    }
    settings.set(tenant, { kind, max_staleness, ms });
  }
  // Every company where a login works needs a setting (DSOR-IDN-05). A setting for a company
  // where no login works is a typo, like a role nobody holds.
  const working = new Set([...principals].flatMap((p) => p.memberships.map((m) => m.tenant_id)));
  for (const tenant of [...working].sort()) {
    if (!Object.hasOwn(data, tenant)) {
      problems.push(`${file}: ${tenant}, where logins work, has no role source`);
    }
  }
  for (const tenant of Object.keys(data)) {
    if (isTenantId(tenant) && !working.has(tenant)) {
      problems.push(`${file}: ${tenant} has a role source, but no login works there`);
    }
  }
  return { settings, problems };
}

/** The key a kept answer is kept under: its company and its person (DSOR-TEN-02a). */
export function keptKey(tenant: string, person: string): string {
  return JSON.stringify([tenant, person]);
}

// DSoR waits this long for one answer, and no longer: a stuck directory must not hold every
// call from an agent (step 19's README, decision 9).
const WAIT_MS = 2000;

// NEW IN STEP 45: an answer in the shape the proposal gives: active, suspended, or gone, which is
// left the company or never had an account, and roles only while active (step 45's README, D4).
// Any other answer is one DSoR cannot read (step 19's README, decision 11).
type Answer = {
  tenant: string;
  person: string;
  status: "active" | "suspended" | "gone";
  roles: string[];
  as_of: string;
};

// NEW IN STEP 45: an answer's as_of may run ahead of DSoR's clock by one minute at most, and then
// counts as the moment DSoR asked; further ahead, the reply is one DSoR cannot use (D4, D13).
const AHEAD_MS = 60 * 1000;
// The checker above loads no formats, so it lets any text pass as a date-time. A time is read
// here instead, as RFC 3339 writes one: each field in its range, upper case, a zone, and no leap
// second.
// not copied: common.schema.json's timestamp is the format date-time, which has no pattern.
const TIMESTAMP =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** The time an as_of names, or NaN when it is not RFC 3339 or names a day its month lacks. */
function timeOf(as_of: string): number {
  const parts = TIMESTAMP.exec(as_of);
  if (parts === null) return Number.NaN;
  // Date.parse would read 30 February as 2 March: the day must be one its month has.
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate() ? Date.parse(as_of) : Number.NaN;
}

/** DSoR's side of each company's role source, holding the answers it keeps. */
export function createRoleSource(
  settings: RoleSettings,
  directories: Directories,
  // The kept answers, in memory, so a restart forgets them (step 19's README, decision 3).
  // A test may plant one.
  kept: Map<string, Kept> = new Map(),
): RoleSource {
  return Object.freeze({
    authorityOf: async (tenant: string, slip: Slip, name: string): Promise<SignerAuthority> => {
      const person = slip.delegator;
      const setting = settings.get(tenant);
      const directory = directories.get(tenant);
      // Start-up gives every company where a login works a setting. A company with no setting
      // or no directory here is a fault in DSoR's own set-up, not an outage.
      if (setting === undefined || directory === undefined) {
        throw new Refusal("INTERNAL_ERROR", `DSoR has no role source for ${tenant}`);
      }
      const cannotUse = `the directory of ${tenant} answered with something DSoR cannot use`;
      const key = keptKey(tenant, person);

      // The question, at every call (step 19's README, decision 3). An answer is never later
      // than the moment DSoR asked: the directory may have changed a moment after it answered
      // (decision 14).
      const askedAt = Date.now();
      const asked = await askWithin(directory, person);
      const last = kept.get(key);
      let answer: Answer;
      let at: number;
      if (asked.answered) {
        // One copy, read once, and every check and every use reads that copy, as line ①
        // copies the input (step 07's README, decision 9; step 19's README, decision 17).
        const copy = copyOf(asked.answer);
        // NEW IN STEP 45: the time the server read its facts. Further than a minute ahead of
        // DSoR's clock, the answer is one DSoR cannot use (D4).
        const read = usable(copy, tenant, person) ? timeOf(copy.as_of) : Number.NaN;
        if (!(read <= askedAt + AHEAD_MS)) {
          // An answer DSoR cannot use is a fault. The strange answer may be the very news DSoR
          // needs, so the kept answer goes too, unless DSoR learned it after it asked this
          // question (decisions 11 and 14). Found by step 19's review.
          if (last !== undefined && last.at <= askedAt) kept.delete(key);
          throw new Refusal("INTERNAL_ERROR", cannotUse);
        }
        answer = copy as Answer;
        // NEW IN STEP 45: the answer counts from the earlier of the server's time and the moment
        // DSoR asked (D13). Facts read longer ago than the company's bound establish nothing now,
        // though they came back at once (DSOR-IDN-06; break B3).
        at = Math.min(read, askedAt);
        if (!(askedAt - at < setting.ms)) {
          const where = `from the directory of ${tenant} that is recent enough`;
          const why = `DSoR has no answer about ${person}, who signed slip ${slip.id}, ${where}`;
          throw new Refusal("FRESHNESS_UNSATISFIABLE", `${name}: ${why}`);
        }
        // Older news never replaces newer: an answer whose facts are older than the kept ones is
        // not kept over them (decision 14). Found by step 19's review.
        if (last === undefined || last.at <= at) kept.set(key, { answer: copy as Answer, at });
      } else {
        // No answer: the kept one counts only while it is under the company's bound
        // (DSOR-IDN-06; step 19's README, decisions 3, 4, and 5). Never one from the future: a
        // clock that went back would make an old answer look young (decision 15).
        const age = last === undefined ? Number.NaN : Date.now() - last.at;
        if (last === undefined || !(age >= 0 && age < setting.ms)) {
          // The message names no bound: how long a kept answer lasts is the company's to know
          // (decision 16).
          const where = `from the directory of ${tenant} that is recent enough`;
          const why = `DSoR has no answer about ${person}, who signed slip ${slip.id}, ${where}`;
          throw new Refusal("FRESHNESS_UNSATISFIABLE", `${name}: ${why}`);
        }
        // Checked again at every use: a kept answer about someone else, or from another
        // company, is a fault too, and goes (step 19's README, C10).
        if (!usable(last.answer, tenant, person)) {
          kept.delete(key);
          throw new Refusal("INTERNAL_ERROR", cannotUse);
        }
        answer = last.answer;
        at = last.at;
      }

      // The time of the answer used, which line ⑪ records (step 19's README, decision 7).
      // And which a suspension's record names too (step 19b's README, decision 5).
      const as_of = new Date(at).toISOString();
      // NEW IN STEP 45: suspended or gone, her agent gets nothing, and her slips here are suspended
      // (DSOR-IDN-07). Gone takes the place of step 19's deprovisioned and of "not listed": a
      // company's server says only that she is not here, not why (D4). One message for both:
      // which one she is, is a fact about a person that the agent may not read (DSOR-ERR-01b;
      // step 19's README, decision 16).
      if (answer.status !== "active") {
        const whom = `whom the directory of ${tenant} does not list as active`;
        throw new SignerGone(
          "DELEGATION_REQUIRED",
          `${name}: slip ${slip.id} is signed by ${person}, ${whom}`,
          { word: answer.status, as_of },
        );
      }
      return { roles: [...answer.roles], source: "role_source", as_of };
    },
  });
}

/** The directory's answer, or none if it fails or takes longer than DSoR waits. */
async function askWithin(
  directory: Directory,
  person: string,
): Promise<{ answered: true; answer: unknown } | { answered: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ answered: false }>((resolve) => {
    timer = setTimeout(() => resolve({ answered: false }), WAIT_MS);
  });
  // A directory that fails, even at once, gives no answer. It never stops line ③ with an error
  // of its own.
  const asked = (async () => directory.ask(person))().then(
    (answer) => ({ answered: true as const, answer }),
    () => ({ answered: false as const }),
  );
  try {
    return await Promise.race([asked, late]);
  } finally {
    // The timer goes, so a call that was answered at once leaves nothing behind.
    clearTimeout(timer);
  }
}

/** A copy of the answer, read once, or nothing if it cannot be copied (decision 17). */
function copyOf(answer: unknown): unknown {
  try {
    // A copy keeps only the answer's own fields, each read once. A field on its prototype
    // goes, and a function cannot be copied at all: both make an answer DSoR cannot use.
    return structuredClone(answer);
  } catch {
    return undefined;
  }
}

/** True for an answer DSoR can use: in the proposal's shape, about this person, in this company. */
// NEW IN STEP 45: the shape is the proposal's schema now, not a list of checks of its own. The
// schema holds the rest of step 19b's decision 15: roles are a list of words, and empty unless
// the person is active (D4).
function usable(answer: unknown, tenant: string, person: string): answer is Answer {
  if (!validateAnswer(answer)) return false;
  const fields = answer as Answer;
  // About the person and the company that DSoR asked about, and no other (D2; step 19's C10).
  if (fields.tenant !== tenant || fields.person !== person) return false;
  return Number.isFinite(timeOf(fields.as_of));
}
