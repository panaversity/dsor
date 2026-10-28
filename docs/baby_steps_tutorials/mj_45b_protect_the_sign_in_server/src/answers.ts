// The answers DSoR keeps from each company's role source, one for each company and
// person: the last answer DSoR could use, as of when, and when DSoR asked for it (step 45's README,
// D3 and D8). In memory for `pnpm start` and the unit tests, so a restart forgets them. In
// dsor.role_answers when DSoR runs on its database (createDbAnswers in src/postgres.ts), so every
// DSoR server shares them, a restart keeps them, and the table shows what DSoR knew about a
// person's job, and as of when.
/** One kept answer: what the company said, as of when (D13), and when DSoR asked (D3). */
export type Kept = { answer: Record<string, unknown>; at: number; asked: number };

/** The kept answers, one for each company and person (DSOR-TEN-02a). */
export type KeptAnswers = {
  /** The answer kept about this person in this company, if there is one. */
  get: (tenant: string, person: string) => Promise<Kept | undefined>;
  /**
   * Keeps this answer, unless the kept one's facts are newer (step 19's README, decision 14). A
   * kept answer whose facts are later than DSoR's clock now came before a clock went back, and
   * never stops a new one (decision 15).
   */
  keep: (tenant: string, person: string, kept: Kept) => Promise<void>;
  /**
   * Forgets the kept answer, unless DSoR asked for it after `asked` (decisions 11 and 14). One
   * asked for later than DSoR's clock now came before a clock went back, and goes too.
   */
  forget: (tenant: string, person: string, asked: number) => Promise<void>;
};

/** The kept answers in memory. A test may plant some, as [company, person, answer]. */
export function memoryAnswers(planted: Iterable<[string, string, Kept]> = []): KeptAnswers {
  const kept = new Map<string, Kept>();
  // The company and the person together are the key (DSOR-TEN-02a).
  const keyOf = (tenant: string, person: string): string => JSON.stringify([tenant, person]);
  for (const [tenant, person, answer] of planted) {
    kept.set(keyOf(tenant, person), structuredClone(answer));
  }
  return {
    // A copy each way, as a database gives: nobody changes a kept answer from outside.
    get: async (tenant, person) => {
      const found = kept.get(keyOf(tenant, person));
      return found === undefined ? undefined : structuredClone(found);
    },
    keep: async (tenant, person, answer) => {
      const last = kept.get(keyOf(tenant, person));
      if (last === undefined || last.at <= answer.at || last.at > Date.now()) {
        kept.set(keyOf(tenant, person), structuredClone(answer));
      }
    },
    forget: async (tenant, person, asked) => {
      const last = kept.get(keyOf(tenant, person));
      // Found by step 45's review, finding 5: an answer from the future was never forgotten.
      const fromTheFuture = last !== undefined && last.asked > Date.now();
      if (last !== undefined && (last.asked <= asked || fromTheFuture)) {
        kept.delete(keyOf(tenant, person));
      }
    },
  };
}
