// NEW IN STEP 19: the company directory, which says what a person holds right now (decision 129).
//
// At 2 a.m. the person whose authority the agent carries is asleep and sends no login. DSoR still
// has to know whether that person holds the job the slip depends on, so it asks the company's
// directory, at every decision. A directory can be out of date, and it can be down, and
// `authority.ts` decides what DSoR does about either.
//
// This one is a fake: one per company, built from this program's people, which a test or the demo
// can change, make stale, or switch off. A real one is a directory sync or an identity provider
// (§12.1); what DSoR asks of it is the same.
//
// Rule DSOR-IDN-05: each tenant MUST configure a role source from which DSoR can read the current
// roles of a principal who is not present in the request.

import { findPerson } from "./people.ts";
import { permissionsOf } from "./permissions.ts";

/** What a directory says about one person: what they hold, and when that was true. */
export interface DirectoryAnswer {
  readonly permissions: readonly string[];
  /** When the directory knew this, as an exact ISO time. */
  readonly asOf: string;
}

/**
 * One company's directory. `lookup` answers for anyone, with nothing held for a person it does not
 * know, and throws when it cannot be reached, which is what being down looks like.
 */
export interface Directory {
  readonly lookup: (person: string) => DirectoryAnswer;
}

/** How a fake directory behaves. Everything left out is the plain case. */
export interface FakeDirectory {
  /** Every lookup throws, as a directory that cannot be reached does. */
  readonly down?: boolean;
  /** The time every answer is as of. Left out, the moment of the lookup. */
  readonly asOf?: string;
  /** What these people hold in the company, in place of their roles' permissions. */
  readonly holds?: Readonly<Record<string, readonly string[]>>;
}

/**
 * A fake directory for one company: each of this program's people who belongs to it holds their
 * role's permissions, unless `holds` says otherwise, and anyone else holds nothing.
 */
export function aDirectory(tenant: string, fake: FakeDirectory = {}): Directory {
  return Object.freeze({
    lookup: (person: string): DirectoryAnswer => {
      if (fake.down === true) {
        throw new Error(`the directory of ${tenant} did not answer`);
      }

      const asOf = fake.asOf ?? new Date().toISOString();
      const given =
        fake.holds !== undefined && Object.hasOwn(fake.holds, person)
          ? fake.holds[person]
          : undefined;

      if (given !== undefined) {
        return Object.freeze({ permissions: Object.freeze([...given]), asOf });
      }

      const found = findPerson(person);
      const belongs = found !== undefined && found.memberships.some((m) => m.tenantId === tenant);

      return Object.freeze({
        permissions: belongs ? permissionsOf(found) : Object.freeze([]),
        asOf,
      });
    },
  });
}

/** Each company's directory, where a test or the demo has set one: `null` is none at all. */
const configured = new Map<string, Directory | null>();

/** Give one company another directory, `null` for none, or `undefined` for its own fake again. */
export function useDirectory(tenant: string, directory: Directory | null | undefined): void {
  if (directory === undefined) {
    configured.delete(tenant);
  } else {
    configured.set(tenant, directory);
  }
}

/** The directory one company has configured, or `null` for a company that has none. */
export function directoryOf(tenant: string): Directory | null {
  const set = configured.get(tenant);

  return set === undefined ? aDirectory(tenant) : set;
}
