// NEW IN STEP 45: the lookup, the role source of a company whose sign-in server answers DSoR's own
// question (step 45's README, D1, D4, D11, D14). DSoR asks about one person in one company: a GET
// of the company's lookup address with ?tenant=&person=, carrying the company key as
// Authorization: Bearer. The lookup is a directory in step 19's sense: authority.ts asks it, waits
// 2 seconds at most, and checks whatever comes back. So this file only sorts a reply into three
// kinds: an answer to check, no answer, or a reply DSoR cannot use.
import type { Directory } from "./directory.ts";

/** One company's lookup: its company, the address lookups.json names, and the key from the environment. */
export type LookupSetting = { tenant: string; address: string; key: string };

// How long one question may take. authority.ts stops waiting at the same 2 seconds; this drops the
// request too, so a server that hangs holds no connection open (D10's timeout).
const WAIT_MS = 2000;

// A busy server (429) or a failed one (5xx) cannot answer now, like no connection at all. Every
// other reply is the server speaking, and must be an answer (D2; the proposal for §37.1).
function cannotAnswerNow(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** The lookup of one company, as a directory that DSoR asks (D1). */
export function lookupDirectory(setting: LookupSetting): Directory {
  const { tenant, address, key } = setting;
  return Object.freeze({
    ask: async (person: string): Promise<unknown> => {
      const url = new URL(address);
      url.searchParams.set("tenant", tenant);
      url.searchParams.set("person", person);
      // A failed fetch, a timeout included, throws, and authority.ts reads a throw as no answer.
      // A redirect is not followed: it is not an answer, and the key never goes to another address.
      // The key is never put in an error message.
      const reply = await fetch(url, {
        headers: { authorization: `Bearer ${key}` },
        redirect: "manual",
        signal: AbortSignal.timeout(WAIT_MS),
      });
      if (cannotAnswerNow(reply.status)) {
        await reply.body?.cancel();
        throw new Error(`the lookup of ${tenant} cannot answer now: ${reply.status}`);
      }
      // Anything that is not a 200 carrying JSON is a reply DSoR cannot use. It comes back as a note
      // that no answer's shape matches, so authority.ts treats it as a fault (D2).
      if (reply.status !== 200) {
        await reply.body?.cancel();
        return { reply: reply.status };
      }
      try {
        return (await reply.json()) as unknown;
      } catch {
        return { reply: "not JSON" };
      }
    },
  });
}
