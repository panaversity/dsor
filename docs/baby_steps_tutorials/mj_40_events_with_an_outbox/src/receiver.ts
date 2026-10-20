// NEW IN STEP 40: the receiver's side (red: not built yet).
import type { DomainEvent } from "./events.ts";

export function readChannel(_file: string): DomainEvent[] {
  throw new Error("not built yet: step 40");
}

export function firstOfEach(_events: readonly DomainEvent[]): {
  kept: DomainEvent[];
  dropped: string[];
} {
  throw new Error("not built yet: step 40");
}
