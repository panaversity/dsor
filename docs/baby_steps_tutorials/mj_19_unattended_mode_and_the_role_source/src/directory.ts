// NEW IN STEP 19: a company's staff directory. It knows who works in the company, in which
// job, and whether they still do. DSoR asks it about a person who is not in the request
// (DSOR-IDN-05 in specs/dsor/02-security.md, section 12.1). This one is fake: a stand-in that
// this tutorial writes itself, inside DSoR's program, with a switch for "off" and "stuck".
// A real one is the company's own system, reached over a network (step 19's README,
// decision 1). DSoR's side of the question is in authority.ts.

/** What a directory holds about one person: whether they still work there, and their jobs. */
export type Person = { status: string; roles: string[] };

// The directory answers with whatever it answers. DSoR checks the answer before it uses it,
// so the answer has no type here (step 19's README, decision 11).
/** A company's directory, as DSoR reaches it: one question, about one person. */
export type Directory = { ask: (person: string) => Promise<unknown> };

/** Each company's directory, by company. */
export type Directories = ReadonlyMap<string, Directory>;

// A registry built with no directories knows nobody's job. When the answer is missing, the
// answer is no.
/** No directory for any company. */
export const NO_DIRECTORIES: Directories = new Map();

/** A fake directory, with the switches that the story and the tests use. */
export type FakeDirectory = Directory & {
  /** Sets what the directory says about one person, or forgets the person. */
  set: (person: string, entry: Person | undefined) => void;
  /** Turns the directory on, off, or stuck. */
  turn: (state: "on" | "off" | "stuck") => void;
  /** How many questions the directory has been asked. */
  asked: () => number;
};

/** A fake directory of one company, holding these people. It starts on. */
export function fakeDirectory(tenant: string, people: Record<string, Person>): FakeDirectory {
  // A copy, so a caller that changes its own list cannot change the directory afterwards.
  const kept = new Map(Object.entries(structuredClone(people)));
  let state: "on" | "off" | "stuck" = "on";
  let questions = 0;
  return Object.freeze({
    ask: async (person: string): Promise<unknown> => {
      questions += 1;
      // Off: the question fails at once, like a network that refuses to connect.
      if (state === "off") throw new Error(`the directory of ${tenant} is off`);
      // Stuck: the question is taken and never answered.
      if (state === "stuck") return new Promise<never>(() => {});
      // The answer names the company and the person it is about, so DSoR can check that it
      // answers the question it asked (step 19's README, C10).
      const entry = kept.get(person);
      if (entry === undefined) return { tenant, person, listed: false };
      return { tenant, person, listed: true, ...structuredClone(entry) };
    },
    set: (person: string, entry: Person | undefined): void => {
      if (entry === undefined) kept.delete(person);
      else kept.set(person, structuredClone(entry));
    },
    turn: (to: "on" | "off" | "stuck"): void => {
      state = to;
    },
    asked: (): number => questions,
  });
}
