// NEW IN STEP 26: each company's sheets of exchange rates, in DSoR's own store (DSOR-MON-03 and
// DSOR-MON-04 in specs/dsor/01-model.md, section 9; step 26's README, decisions L1 and D2 to D9).
// A sheet comes from one source at one time, and says how much of each currency one unit of its
// base buys, as the source wrote it. DSoR keeps it once, with its base at 1, and never changes
// it: a correction is a newer sheet. A conversion takes both its rates from the newest sheet of
// the company's source, and only while that sheet is not older than the company's max_rate_age, by
// the store's clock: the database's, on the database. The program keeps the sheets in dsor.rates
// (postgres.ts); the unit tests keep them in memory (memoryRates below).
import { Refusal } from "./envelope.ts";
import type { RateSheet } from "./exchange.ts";
import { isCurrency } from "./money.ts";
import { preview } from "./registry.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { parseUri } from "./uri.ts";

/** The newest sheet of a source, and whether it is fresh: not older than the company allows. */
export type Newest = { sheet: RateSheet; fresh: boolean };

/** What a load did: wrote the sheet, found it there already, or found it published in the future. */
export type Loaded = "loaded" | "exists" | "future";

/** Where DSoR keeps each company's sheets of rates. */
export type RateStore = {
  // The newest sheet of this company's source, and whether its age is at most maxAgeMs. None
  // when the company has no sheet of that source (decisions D4 and D5).
  newest: (tenant: string, source: string, maxAgeMs: number) => Promise<Newest | undefined>;
  // What a load of a sheet of this source and time would do, writing nothing: line ⑨ asks before
  // any work (decision D16).
  wouldLoad: (tenant: string, source: string, published_at: string) => Promise<Loaded>;
  // Writes a sheet once, with its base's own line at 1 (decisions D6 and D9).
  load: (tenant: string, sheet: RateSheet) => Promise<Loaded>;
};

// A registry or a claim with no store of rates converts nothing, so every amount in another
// currency than its limit is refused. When the answer is missing, the answer is no.
/** A store that holds no sheet, and loads none. */
export const NO_RATES: RateStore = Object.freeze({
  newest: async () => undefined,
  wouldLoad: async (): Promise<never> => {
    throw new Error("this call loads no rates");
  },
  load: async (): Promise<never> => {
    throw new Error("this call loads no rates");
  },
});

/** The sheets in memory, for the tests, with every sheet the store holds. */
export type MemoryRates = RateStore & { all: () => Promise<RateSheet[]> };

/** Sheets in memory, for the unit tests. A sheet's age is counted by this clock. */
export function memoryRates(now: () => number = Date.now): MemoryRates {
  // Each company's sheets, as written, in the order they were loaded.
  const kept: { tenant: string; sheet: RateSheet }[] = [];
  const ofSource = (tenant: string, source: string): RateSheet[] =>
    kept.filter((k) => k.tenant === tenant && k.sheet.source === source).map((k) => k.sheet);
  // What a load would do: refuse a time after the clock, then a sheet of that source and time.
  const verdict = (tenant: string, source: string, published: number): Loaded => {
    if (published > now()) return "future";
    if (ofSource(tenant, source).some((s) => Date.parse(s.published_at) === published)) {
      return "exists";
    }
    return "loaded";
  };
  return Object.freeze({
    newest: async (tenant: string, source: string, maxAgeMs: number) => {
      // DSoR's own filter, the company first, as the database's WHERE (DSOR-TEN-01b).
      const sheets = ofSource(tenant, source);
      if (sheets.length === 0) return undefined;
      const at = (sheet: RateSheet): number => Date.parse(sheet.published_at);
      const sheet = sheets.reduce((newest, next) => (at(next) > at(newest) ? next : newest));
      return { sheet: structuredClone(sheet), fresh: now() - at(sheet) <= maxAgeMs };
    },
    wouldLoad: async (tenant: string, source: string, published_at: string) =>
      verdict(tenant, source, Date.parse(published_at)),
    load: async (tenant: string, sheet: RateSheet): Promise<Loaded> => {
      const published = Date.parse(sheet.published_at);
      const found = verdict(tenant, sheet.source, published);
      if (found !== "loaded") return found;
      // A copy, with the base's own line, so a caller that changes its sheet afterwards cannot
      // change the store's. The time is written one way, as the database gives it back.
      const rates = { [sheet.base]: "1", ...sheet.rates };
      const written = { ...sheet, published_at: new Date(published).toISOString(), rates };
      kept.push({ tenant, sheet: structuredClone(written) });
      return "loaded";
    },
    all: async (): Promise<RateSheet[]> => kept.map((k) => structuredClone(k.sheet)),
  });
}

/** The input of rate.load, once line ⑥ has checked it against its schema. */
type RateLoad = {
  company: string;
  source: string;
  base: string;
  published_at: string;
  rates: Record<string, string>;
};

/** The sheet's time one way, as the store gives it back. */
function timeOf(sent: RateLoad): string {
  return new Date(Date.parse(sent.published_at)).toISOString();
}

/** The refusal of a sheet that a load would not write, or none (decisions D5 and D6). */
function refusalOf(loaded: Loaded, sent: RateLoad): Refusal | undefined {
  const named = `a sheet of ${sent.source} published at ${timeOf(sent)}`;
  // The store's clock decides: the database's, on the database (decision D5).
  if (loaded === "future") {
    const why = `${named} is in the future, by DSoR's clock`;
    return new Refusal("VALIDATION_FAILED", why, "internal");
  }
  // A correction is a newer sheet, never the same one again (decision D6).
  if (loaded === "exists") {
    const why = `${named} is loaded already: a sheet is written once`;
    return new Refusal("CONFLICT", why, "internal");
  }
  return undefined;
}

/** True when the text is a real time: one that a date reads back the same, so 30 February is not. */
function isTime(text: string): boolean {
  const at = Date.parse(text);
  if (Number.isNaN(at)) return false;
  // The schema allowed one to three digits after the second. A date writes three.
  const [whole = "", fraction = ""] = text.slice(0, -1).split(".");
  return new Date(at).toISOString() === `${whole}.${fraction.padEnd(3, "0")}Z`;
}

/**
 * Line ⑨: the sheet is for the call's own company, from the source its money policy names, and
 * each code on it is a currency, its base not among its own rates (step 26's README, decisions D8
 * and D9). A dry run checks it too.
 */
async function mayLoad(input: unknown, look: OwnLook): Promise<void> {
  const sent = input as RateLoad;
  // The check of the URIs refused another company's URI before line ⑥. A URI of this company that
  // names another company's id is "no company", as the sweep's is (step 25c's README, D11).
  const { id } = parseUri(sent.company);
  if (id !== look.tenant) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no company ${preview(id)} here`, "internal");
  }
  // Start-up refused a company where a login works and no policy is. None is a bug, and the
  // answer is no.
  const policy = look.moneyPolicy;
  if (policy === undefined) {
    throw new Refusal("POLICY_DENIED", `${look.tenant} has no money policy`, "internal");
  }
  if (sent.source !== policy.rate_source) {
    const why = `${look.tenant} takes its rates from ${policy.rate_source}, as its money policy says`;
    throw new Refusal("POLICY_DENIED", `${why}, not from ${preview(sent.source)}`, "internal");
  }
  // Three capitals pass the schema. Only a currency on the list is one, as for money.
  if (!isCurrency(sent.base)) {
    const why = `the base ${sent.base} is not an ISO 4217 currency`;
    throw new Refusal("VALIDATION_FAILED", why, "internal");
  }
  for (const currency of Object.keys(sent.rates)) {
    if (!isCurrency(currency)) {
      throw new Refusal("VALIDATION_FAILED", `${currency} is not an ISO 4217 currency`, "internal");
    }
  }
  // DSoR writes the base's own line, at 1. A sheet that sends it could send another number.
  if (Object.hasOwn(sent.rates, sent.base)) {
    const why = `the sheet lists its base, ${sent.base}, among its rates: one ${sent.base} always buys one ${sent.base}`;
    throw new Refusal("VALIDATION_FAILED", why, "internal");
  }
  if (!isTime(sent.published_at)) {
    const why = `published_at ${sent.published_at} is not a time`;
    throw new Refusal("VALIDATION_FAILED", why, "internal");
  }
  // A sheet that is there already, or one published after the store's clock, is a "no" before any
  // work, as every other check of this line is (decisions D5, D6, and D16). Found by step 26's
  // review: both were refused inside the work, after DSoR had said yes, and a dry run said yes.
  const loaded = await look.rates.wouldLoad(look.tenant, sent.source, timeOf(sent));
  const refused = refusalOf(loaded, sent);
  if (refused !== undefined) throw refused;
}

/**
 * The work, after line ⑩: the sheet is written once, inside the claim's transaction. It answers
 * with the company, the sheet, and how many currencies it holds, its base's own line too.
 */
async function loadSheet(input: unknown, work: OwnStores): Promise<unknown> {
  const sent = input as RateLoad;
  const published_at = timeOf(sent);
  const sheet: RateSheet = {
    source: sent.source,
    base: sent.base,
    published_at,
    rates: { ...sent.rates },
  };
  // Line ⑨ asked already. Two loads of one sheet at one moment both pass it, and the second meets
  // the first here, at the store's one base row for each sheet (decision D6).
  const refused = refusalOf(await work.stores.rates.load(work.tenant, sheet), sent);
  if (refused !== undefined) throw refused;
  const currencies = Object.keys(sent.rates).length + 1;
  return { tenant_id: work.tenant, source: sent.source, base: sent.base, published_at, currencies };
}

/** DSoR's own work for rate.load. */
export function rateWorkFor(): Record<string, OwnWork> {
  return { "rate.load": { check: mayLoad, change: loadSheet } };
}
