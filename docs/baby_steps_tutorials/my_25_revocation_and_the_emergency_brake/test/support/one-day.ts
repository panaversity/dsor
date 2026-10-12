// Decision 155: a test that counts one day's bookings, run across midnight UTC.
//
// Each payment is booked against the day the database says it is, in UTC (src/reservation.ts). A
// test that books for a while, or runs the demo twice and counts on the second run finding the
// first run's day nearly full, takes for granted that the day does not change while it runs. Across
// midnight UTC it does: the bookings fall on two days, and the demo's second run finds a fresh day,
// where the first run's payments no longer count. The test then fails with nothing wrong. A test
// like that proves nothing either way, so it is skipped, not failed, and says why. A test that fails
// within one day still fails.

import type { TestContext } from "vitest";

/**
 * Today, in UTC, on this machine's clock. PGlite reads the same clock, in these tests and in the
 * demo, so this is the day the database books against.
 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Run a test whose bookings must all fall on one day. If it fails, and the day changed while it ran,
 * it is skipped instead, with the reason.
 */
export async function onOneDay(context: TestContext, run: () => unknown): Promise<void> {
  const day = today();

  try {
    await run();
  } catch (error) {
    context.skip(
      today() !== day,
      `midnight UTC fell while this test ran, so its bookings are on two days: run it again`,
    );

    throw error;
  }
}
