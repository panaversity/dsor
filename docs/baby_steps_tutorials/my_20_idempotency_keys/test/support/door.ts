// NEW IN STEP 20: the door the tests knock on, with a fresh idempotency key each time (decision 131).
//
// Every command needs a key now (DSOR-IDM-01a), and most tests are about something else. A careful
// client sends a new key with every new request, and so does this door, unless the test gives one.
// The tests about keys, in idempotency.test.ts, use the program's own door and mean every key they
// send. Nothing here is the program's: it never gives a key to a request that came without one.

import { randomUUID } from "node:crypto";
import {
  callOperation as theProgramsDoor,
  makeDoor as theProgramsMakeDoor,
  type Door,
} from "../../src/operations.ts";

/** A door that gives each request a fresh key, unless the caller gave one. */
export function withAFreshKey(door: Door): Door {
  return (login, id, args, request) =>
    door(login, id, args, request ?? { idempotencyKey: `test-${randomUUID()}` });
}

export const callOperation: Door = withAFreshKey(theProgramsDoor);

/** `makeDoor`, and the door it makes gives each request a fresh key. */
export const makeDoor = (...made: Parameters<typeof theProgramsMakeDoor>): Door =>
  withAFreshKey(theProgramsMakeDoor(...made));
