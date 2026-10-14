// NEW IN STEP 19b: suspended slips. When a company's directory reports the person who signed a
// slip as suspended, deprovisioned, or not listed, DSoR suspends every active slip she signed in
// that company, before it refuses the call (DSOR-IDN-07 in specs/dsor/02-security.md, section
// 12.1; step 19b's README, decisions 1 to 8).
import { SignerGone } from "./authority.ts";
import { Refusal, type Correlation } from "./envelope.ts";
import type { SlipStore } from "./slips.ts";

/**
 * Runs when line ③'s question about the signer was refused. If the directory reported her as
 * gone, her active slips in this company are suspended first. Then the refusal goes on, as in
 * step 19.
 */
export async function suspendThenRefuse(
  thrown: unknown,
  slips: SlipStore,
  // The company and the signer come from line ③ itself, never from the refusal: DSoR does not
  // trust its own parts to keep a company (step 10's README, decision 14). Found by step 19b's
  // review.
  tenant: string,
  signer: string,
  // The call that heard the directory, which each record names (decision 14).
  correlation: Correlation,
): Promise<never> {
  // Only the directory's word that she is gone. No answer, or an answer DSoR cannot use,
  // suspends nothing: DSoR does not know that she is gone (step 19b's README, C9).
  if (thrown instanceof SignerGone) {
    const why = { word: thrown.word, as_of: thrown.as_of, correlation };
    try {
      await slips.suspend(tenant, signer, why);
    } catch {
      // The store writes the suspensions and their records together or not at all, so a
      // failure changed nothing, unless the database committed and its answer was lost. DSoR
      // cannot tell which, so it says that it could not confirm. The call's record shows the
      // fault, so a person sees it. The store's own words stay inside: they can name servers
      // (decision 7). Found by step 19b's review.
      const message =
        "DSoR could not confirm that this agent's slip is suspended, so it refuses the call";
      throw new Refusal("INTERNAL_ERROR", message);
    }
  }
  throw thrown;
}
