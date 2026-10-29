// Line ③'s last question. Does the person who signed the slip still hold her
// job, and which roles does she hold now? DSoR asks her company's directory, never the
// request (DSOR-IDN-05 and DSOR-IDN-06 in specs/dsor/02-security.md, section 12.1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { memoryAnswers, type KeptAnswers } from "./answers.ts";
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

/** DSoR's side of the role source: the signer's current authority, or a refusal. */
export type RoleSource = {
  authorityOf: (tenant: string, slip: Slip, name: string) => Promise<SignerAuthority>;
  // And a person's own, at line ②, when she calls for herself (step 45's README,
  // C2; decision Q7).
  /** What a person who calls for herself holds in this company now, or a refusal. */
  memberOf: (
    tenant: string,
    person: string,
    name: string,
    // False when DSoR asks about the person who made a request, at its release:
    // she is not the caller (found by step 45c's review, finding 1).
    own?: boolean,
  ) => Promise<SignerAuthority>;
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
  // And no formats, as slips.ts builds its checker. An answer's as_of is read below,
  // by TIMESTAMP, so the checker neither checks a date-time nor warns at start-up that it cannot.
  // Found by the database run: pnpm start printed the warning, and must print nothing to stderr.
  validateFormats: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
ajv.addSchema(loadSchema("tenant-policy.schema.json"));
const validateSetting = ajv.compile({
  $ref: "urn:dsor:schema:1.3:tenant-policy#/properties/role_source",
});
// The shape of an answer, from our proposal for the specification. It sits in
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

// DSoR waits this long for one answer, and no longer: a stuck directory must not hold every
// call from an agent (step 19's README, decision 9).
const WAIT_MS = 2000;

// An answer is used again for up to 10 seconds, so a flood of calls from agents is
// a few lookups a minute. A person who left is caught within 10 seconds (step 45's README, D3).
const REUSE_MS = 10 * 1000;

// An answer in the shape the proposal gives: active, suspended, or gone, which is
// left the company or never had an account, and roles only while active (step 45's README, D4).
// Any other answer is one DSoR cannot read (step 19's README, decision 11).
type Answer = {
  tenant: string;
  person: string;
  status: "active" | "suspended" | "gone";
  roles: string[];
  as_of: string;
};

// An answer's as_of may run ahead of DSoR's clock by one minute at most, and then
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

// After five failures in a row from one company's server, this DSoR server asks
// that server nothing for 10 seconds (step 45b's README, D10).
const FAILURES = 5;
const PAUSE_MS = 10 * 1000;

// One company's server, as this DSoR server has found it: its failures in a row,
// the end of its pause, and whether a call is trying it again (D10, D16).
// The run counts people, not failures: the different people whose lookups failed
// in a row, up to five, so one person's broken record counts once (step 45c's README, D25).
/** One company's run of failures on this DSoR server. */
type Run = { failed: Set<string>; pausedUntil: number; trying: boolean };

// One lookup, as every call that shares it reads it: the moment DSoR sent it,
// and what came back (step 45b's README, D9).
/** A lookup that calls share: when DSoR asked, and the reply, if one came in time. */
type Asked = { askedAt: number } & ({ answered: true; answer: unknown } | { answered: false });

// A person whose lookups keep failing waits twice as long each time before DSoR
// asks about her again: 10 seconds, then 20, 40, 80, 160, and 5 minutes at most (step 45c's
// README, D22).
const BACKOFF_MAX_MS = 5 * 60 * 1000;

// Each DSoR server sends at most 20 lookups in any minute, for each company, about
// people it knows nothing about, from their own calls (step 45c's README, D23).
const BUDGET = 20;
const BUDGET_MS = 60 * 1000;

// A stranger's own calls use the answer that she is gone for 10 minutes, so a
// sign-up account costs one lookup in 10 minutes, not one in 10 seconds (step 45c's README, D26).
const STRANGER_MS = 10 * 60 * 1000;

// The latest lookup about one person in one company, on this DSoR server: the
// lookup, in flight or with its reply, the moment DSoR asked, until when its reply is remembered,
// and her failures in a row (D9, D21, D22).
/** What one DSoR server remembers of its latest lookup about one person. */
type Memory = { lookup: Promise<Asked>; askedAt: number; until: number; failures: number };

/** DSoR's side of each company's role source, holding the answers it keeps. */
export function createRoleSource(
  settings: RoleSettings,
  directories: Directories,
  // The kept answers, in memory, so a restart forgets them (step 19's README, decision 3).
  // A test may plant one.
  // Or in DSoR's PostgreSQL, so every DSoR server shares them, and a restart
  // keeps them (step 45's README, D8).
  kept: KeptAnswers = memoryAnswers(),
): RoleSource {
  // The lookups in flight on this DSoR server, one for each company and person.
  // A call about the same pair waits for the one in flight, and asks nothing. The key holds the
  // company, as the kept answers' key does (step 45b's README, C1, C2, D9; DSOR-TEN-02a).
  // And once its reply has come, it is remembered for a while: 10 seconds, or
  // longer after failures in a row (step 45c's README, C1, C2, D21, D22). The oldest come first.
  const people = new Map<string, Memory>();
  // And each company's run of failures, keyed by company, so one company's outage
  // never pauses another (C7, D10; DSOR-TEN-02a). In memory too: a restart forgets a run.
  const runs = new Map<string, Run>();
  // And each company's budget: the moments of its lookups about people DSoR knows
  // nothing about in the last minute, 20 at most (C4, D23; DSOR-TEN-02a).
  const budgets = new Map<string, number[]>();

  /**
   * The lookup a call reads: the one in flight about this person in this company, a new one, or,
   * while the company's server is paused, no reply at once.
   */
  function ask(
    tenant: string,
    person: string,
    directory: Directory,
    // The company's bound, which an answer used again from memory must not pass.
    bound: number,
    // True for a person's own call about herself, when DSoR knows nothing about her.
    budgeted: boolean,
  ): Promise<Asked> {
    const key = JSON.stringify([tenant, person]);
    const askedAt = Date.now();
    // A lookup in flight, or one whose reply is still remembered: the same reply,
    // and no question (D9, D21, D22). Not one DSoR made later than its clock now: it came before a
    // clock went back (step 19's README, decision 15).
    const last = people.get(key);
    if (last !== undefined && askedAt < last.until && askedAt >= last.askedAt) return last.lookup;
    forgetOld(askedAt);
    // After five failures in a row, a call asks nothing while the pause lasts, or
    // while another call tries the server again. It has no reply, at once, and uses the answer
    // kept, or is refused (C4, C5; D10, D16).
    const run = runs.get(tenant) ?? { failed: new Set<string>(), pausedUntil: 0, trying: false };
    runs.set(tenant, run);
    const trial = run.failed.size >= FAILURES;
    // A pause that began later than DSoR's clock now came before a clock went back. It is over:
    // kept, it would last until the clock caught up, an hour for a clock set back an hour (found
    // while building; step 19's README, decision 15).
    const paused = askedAt < run.pausedUntil && askedAt >= run.pausedUntil - PAUSE_MS;
    if (trial && (paused || run.trying)) {
      return Promise.resolve({ askedAt, answered: false });
    }
    // A question about someone DSoR knows nothing about, from her own call, spends
    // one of the company's 20 lookups of this minute. With none left, no question, at once: it is
    // no failure, and nothing is remembered (C4, C5; D23, D24).
    if (budgeted && !spend(tenant, askedAt)) return Promise.resolve({ askedAt, answered: false });
    // The pause is over: this call alone tries the server again (D16).
    if (trial) run.trying = true;
    // In flight until its reply comes. Her failures in a row so far count on from
    // the lookup before, so the backoff grows (D22).
    // A memory that ended more than 5 minutes ago is gone, though the sweep has not reached it yet:
    //   found while answering step 45c's review.
    const recent = last !== undefined && askedAt < last.until + BACKOFF_MAX_MS;
    const memory = {
      askedAt,
      until: Number.POSITIVE_INFINITY,
      failures: recent ? last.failures : 0,
    };
    const lookup = askWithin(directory, person).then((reply): Asked => {
      if (trial) run.trying = false;
      if (reply.answered) {
        // Any reply, even one DSoR cannot use, shows the server is up, and ends
        // the run (C6, D17).
        run.failed.clear();
        // Her failures in a row start over (D22). A reply that no call can use as
        // an answer, a fault or one too old, is remembered for 10 seconds from the moment DSoR
        // asked. An answer a call can use is kept, as before, and used again from there only
        // while it is under the company's bound (D3, D21): found by step 45's test of a bound of
        // 5 seconds.
        memory.failures = 0;
        // One copy for every call that waited, which each copies again for itself (step 19's
        // README, decision 17).
        const copy = copyOf(reply.answer);
        memory.until = good(copy, tenant, person, askedAt, bound) ? askedAt : askedAt + REUSE_MS;
        return { askedAt, answered: true, answer: copy };
      }
      // One lookup is one failure, however many calls waited for it. The fifth in
      // a row starts a pause, and so does each failure after it, the trial's too (C4, C5).
      // And one person counts once in a run (D25). A stranger's failure does not
      // count: sign-up accounts whose records fail must not pause a company. Found by step 45c's
      // review, finding 3.
      if (!budgeted) {
        if (run.failed.size < FAILURES) run.failed.add(person);
        if (run.failed.size >= FAILURES) run.pausedUntil = Date.now() + PAUSE_MS;
      }
      // A failure is remembered for twice as long as the one before it (D22).
      memory.failures += 1;
      memory.until = askedAt + Math.min(REUSE_MS * 2 ** (memory.failures - 1), BACKOFF_MAX_MS);
      return { askedAt, answered: false };
    });
    // The latest lookup goes last, so the oldest memories come first.
    people.delete(key);
    people.set(key, Object.assign(memory, { lookup }));
    return lookup;
  }

  // One of the company's lookups of this minute, if one is left (D23).
  /** Spends one lookup about someone DSoR knows nothing about, and false if none is left. */
  function spend(tenant: string, now: number): boolean {
    // This minute's only. One from the future came before a clock went back (decision 15).
    const spent = (budgets.get(tenant) ?? []).filter(
      (moment) => moment <= now && now - moment < BUDGET_MS,
    );
    const left = spent.length < BUDGET;
    if (left) spent.push(now);
    budgets.set(tenant, spent);
    return left;
  }

  // A memory goes 5 minutes after it ended, so the map holds only the people asked
  // about lately. The oldest come first, and the first that is not old yet ends the sweep (D21).
  /** Forgets the memories that ended more than 5 minutes ago. */
  function forgetOld(now: number): void {
    for (const [key, memory] of people) {
      if (now < memory.until + BACKOFF_MAX_MS) return;
      people.delete(key);
    }
  }

  // The question both lines ask, about a slip's signer at line ③ and about a person
  // who calls for herself at line ②: what the company says about this person now, and as of
  // when (step 45's README, C2). `who` names the person in a refusal's words.
  /** The answer DSoR may use about this person now, and its time, or a refusal. */
  async function current(
    tenant: string,
    person: string,
    name: string,
    who: string,
    // Whether a question spends the company's budget (D23).
    budgeted = false,
  ): Promise<{ answer: Answer; as_of: string }> {
    const setting = settings.get(tenant);
    const directory = directories.get(tenant);
    // Start-up gives every company where a login works a setting. A company with no setting
    // or no directory here is a fault in DSoR's own set-up, not an outage.
    if (setting === undefined || directory === undefined) {
      throw new Refusal("INTERNAL_ERROR", `DSoR has no role source for ${tenant}`);
    }
    const cannotUse = `the directory of ${tenant} answered with something DSoR cannot use`;

    // The question. An answer is never later than the moment DSoR asked: the directory may
    // have changed a moment after it answered (step 19's README, decision 14).
    const askedAt = Date.now();
    // Not at every call any more. An answer DSoR asked for less than 10
    // seconds ago is used again, and the server is not asked, while the answer is under the
    // company's bound too (D3). Never one asked for in the future: a clock that went back
    // would make it look new (step 19's README, decision 15).
    const recent = await kept.get(tenant, person);
    const since = recent === undefined ? Number.NaN : askedAt - recent.asked;
    // A stranger's own call uses the answer that she is gone for 10 minutes (D26).
    const window = budgeted && recent?.answer["status"] === "gone" ? STRANGER_MS : REUSE_MS;
    const reuse =
      recent !== undefined && since >= 0 && since < window && askedAt - recent.at < setting.ms;
    // The lookup in flight about this person in this company, if there is one, and
    // a new one otherwise (D9).
    const asked: Asked = reuse
      ? { askedAt, answered: false }
      : await ask(tenant, person, directory, setting.ms, budgeted);
    let answer: Answer;
    let at: number;
    if (asked.answered) {
      // The moment DSoR asked is the moment the shared lookup was sent, which may
      // be before this call came. Each call that waited reads the answer as that old, and checks it
      // as its own, with every rule below (C3; D9, D13).
      const sent = asked.askedAt;
      // One copy, read once, and every check and every use reads that copy, as line ①
      // copies the input (step 07's README, decision 9; step 19's README, decision 17).
      const copy = copyOf(asked.answer);
      // The time the server read its facts. Further than a minute ahead of
      // DSoR's clock, the answer is one DSoR cannot use (D4).
      const read = usable(copy, tenant, person) ? timeOf(copy.as_of) : Number.NaN;
      if (!(read <= sent + AHEAD_MS)) {
        // An answer DSoR cannot use is a fault. The strange answer may be the very news DSoR
        // needs, so the kept answer goes too, unless DSoR learned it after it asked this
        // question (decisions 11 and 14). Found by step 19's review.
        await kept.forget(tenant, person, sent);
        throw new Refusal("INTERNAL_ERROR", cannotUse);
      }
      answer = copy as Answer;
      // The answer counts from the earlier of the server's time and the moment
      // DSoR asked (D13). Facts read longer ago than the company's bound establish nothing now,
      // though they came back at once (DSOR-IDN-06; break B3).
      at = Math.min(read, sent);
      if (!(sent - at < setting.ms)) {
        const where = `from the directory of ${tenant} that is recent enough`;
        const why = `DSoR has no answer about ${who} ${where}`;
        throw new Refusal("FRESHNESS_UNSATISFIABLE", `${name}: ${why}`);
      }
      // Older news never replaces newer: an answer whose facts are older than the kept ones is
      // not kept over them (decision 14). Found by step 19's review.
      // The store decides it, in one step, with the moment DSoR asked (D3, D8).
      await kept.keep(tenant, person, { answer: copy as Answer, at, asked: sent });
      // And the call decides on the newer news too. A reply from a server that
      // lags may be older than the answer DSoR keeps, and then the kept one decides: found by
      // step 45's review, finding 4 (step 19's README, decision 14).
      const newest = await kept.get(tenant, person);
      if (newest !== undefined && newest.at > at && usable(newest.answer, tenant, person)) {
        answer = newest.answer;
        at = newest.at;
      }
    } else {
      // No answer: the kept one counts only while it is under the company's bound
      // (DSOR-IDN-06; step 19's README, decisions 3, 4, and 5). Never one from the future: a
      // clock that went back would make an old answer look young (decision 15).
      // An answer used again takes this path too (D3). After a wait, the kept
      // answer is read again: another call may have kept a newer one meanwhile.
      const last = reuse ? recent : await kept.get(tenant, person);
      const age = last === undefined ? Number.NaN : Date.now() - last.at;
      if (last === undefined || !(age >= 0 && age < setting.ms)) {
        // The message names no bound: how long a kept answer lasts is the company's to know
        // (decision 16).
        const where = `from the directory of ${tenant} that is recent enough`;
        const why = `DSoR has no answer about ${who} ${where}`;
        throw new Refusal("FRESHNESS_UNSATISFIABLE", `${name}: ${why}`);
      }
      // Checked again at every use: a kept answer about someone else, or from another
      // company, is a fault too, and goes (step 19's README, C10).
      if (!usable(last.answer, tenant, person)) {
        await kept.forget(tenant, person, last.asked);
        throw new Refusal("INTERNAL_ERROR", cannotUse);
      }
      answer = last.answer;
      at = last.at;
    }

    // The time of the answer used, which line ⑪ records (step 19's README, decision 7).
    // And which a suspension's record names too (step 19b's README, decision 5).
    return { answer, as_of: new Date(at).toISOString() };
  }

  return Object.freeze({
    authorityOf: async (tenant: string, slip: Slip, name: string): Promise<SignerAuthority> => {
      const person = slip.delegator;
      const who = `${person}, who signed slip ${slip.id},`;
      const { answer, as_of } = await current(tenant, person, name, who);
      // Suspended or gone, her agent gets nothing, and her slips here are suspended
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
    // The same question about a person who calls for herself, asked at line ②
    // (step 45's README, C2; decision Q7).
    memberOf: async (
      tenant: string,
      person: string,
      name: string,
      own = true,
    ): Promise<SignerAuthority> => {
      // Suspended or gone, she may not work in the company. The words are the ones line ② gives
      //   anyone who is not a member, so the answer does not say which one she is (DSOR-ERR-01b).
      const stranger = new Refusal(
        "AUTHORIZATION_DENIED",
        "the caller may not work in the tenant it named",
      );
      // And a company DSoR does not serve, and a company whose server cannot answer now, sound the
      //   same to a person DSoR knows nothing about there: she hears what every stranger hears, so
      //   no call tells her which companies DSoR serves, or when their server is down. A person
      //   DSoR keeps an active answer about, however old, hears the real refusal. Found by step
      //   45's review, finding 3 (DSOR-ERR-01b).
      if (!settings.has(tenant) || !directories.has(tenant)) throw stranger;
      const before = await kept.get(tenant, person);
      const known =
        before !== undefined &&
        usable(before.answer, tenant, person) &&
        before.answer.status === "active";
      // Her own call, at line ②, spends the company's budget when DSoR knows
      // nothing about her (C4, D23), and hears the stranger's words. A release's question about
      // the person who made a request does neither: she is not the caller, and a company that
      // cannot answer now leaves the proposal waiting. Found by step 45c's review, finding 1; the
      // words turned an outage into a refusal there since step 45.
      const stranger_here = own && !known;
      let found: { answer: Answer; as_of: string };
      try {
        found = await current(tenant, person, name, person, stranger_here);
      } catch (error) {
        if (stranger_here) throw stranger;
        throw error;
      }
      if (found.answer.status !== "active") throw stranger;
      return { roles: [...found.answer.roles], source: "role_source", as_of: found.as_of };
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

// The answer a call can use, judged as each call judges it below: about this
// person in this company, at most a minute ahead, and under the company's bound when DSoR asked
// (step 45c's README, D21).
/** True for an answer that a call reading it could use, as of the moment DSoR asked. */
function good(
  answer: unknown,
  tenant: string,
  person: string,
  askedAt: number,
  bound: number,
): boolean {
  if (!usable(answer, tenant, person)) return false;
  const read = timeOf(answer.as_of);
  return read <= askedAt + AHEAD_MS && askedAt - Math.min(read, askedAt) < bound;
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
// The shape is the proposal's schema now, not a list of checks of its own. The
// schema holds the rest of step 19b's decision 15: roles are a list of words, and empty unless
// the person is active (D4).
function usable(answer: unknown, tenant: string, person: string): answer is Answer {
  if (!validateAnswer(answer)) return false;
  const fields = answer as Answer;
  // About the person and the company that DSoR asked about, and no other (D2; step 19's C10).
  if (fields.tenant !== tenant || fields.person !== person) return false;
  return Number.isFinite(timeOf(fields.as_of));
}
