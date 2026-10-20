// NEW IN STEP 40: the outbox on the database, and its sender (red: not built yet).
import type pg from "pg";
import type { Outbox } from "./outbox.ts";

export function createDbOutbox(_pool: pg.Pool): Outbox {
  throw new Error("not built yet: step 40");
}
