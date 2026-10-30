// The receiver's side, kept small: the other system that reads a company's channel.
// Delivery is at least once, so the same event can arrive twice; the receiver keeps the first copy
// of each event id and drops the rest (§31 in specs/dsor/03-execution.md; step 40's README,
// decision D10).
import { existsSync, readFileSync } from "node:fs";
import type { DomainEvent } from "./events.ts";

/** The events a channel file holds, in the order they arrived. None when there is no file. */
export function readChannel(file: string): DomainEvent[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as DomainEvent);
}

/** The first copy of each event, in the order they came, and the id of every copy dropped. */
export function firstOfEach(events: readonly DomainEvent[]): {
  kept: DomainEvent[];
  dropped: string[];
} {
  const seen = new Set<string>();
  const kept: DomainEvent[] = [];
  const dropped: string[] = [];
  for (const event of events) {
    if (seen.has(event.event_id)) dropped.push(event.event_id);
    else {
      seen.add(event.event_id);
      kept.push(event);
    }
  }
  return { kept, dropped };
}
