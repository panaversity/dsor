// NEW IN STEP 40: each company's channel (red: not built yet).
import type { DomainEvent } from "./events.ts";

/** The channels file, as read. */
export type ChannelsSource = { file: string; text: string };

export function readChannels(_path?: string): ChannelsSource {
  throw new Error("not built yet: step 40");
}

export function checkChannels(_source: ChannelsSource): {
  channels: Map<string, string>;
  problems: string[];
} {
  throw new Error("not built yet: step 40");
}

export function fileChannel(_dir: string, _file: string): (event: DomainEvent) => Promise<void> {
  throw new Error("not built yet: step 40");
}
