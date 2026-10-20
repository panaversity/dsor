// Each company's channel, the place its events are delivered (DSOR-EVT-01d in
// specs/dsor/03-execution.md, section 31). channels.json names one channel for each company, and
// two companies never share one, so one company's events never reach another's receiver. In this
// tutorial a channel is a file of JSON lines in the events folder, named after its company; how
// events travel is outside the specification (step 40's README, decisions D9 and D12).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DomainEvent } from "./events.ts";
import { isObject } from "./labels.ts";
import { isTenantId } from "./uri.ts";

/** The channels file, as read. */
export type ChannelsSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../channels.json", import.meta.url));

/** The channels file of this folder, unless another is named. */
export function readChannels(path: string = SHIPPED): ChannelsSource {
  return { file: "channels.json", text: readFileSync(path, "utf8") };
}

/** Each company's channel, and every problem with the file. A file with a problem is refused. */
export function checkChannels(source: ChannelsSource): {
  channels: Map<string, string>;
  problems: string[];
} {
  const { file, text } = source;
  const channels = new Map<string, string>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { channels, problems: [`${file}: not valid JSON`] };
  }
  if (!isObject(data)) {
    return { channels, problems: [`${file}: must be an object that names each company's channel`] };
  }
  const problems: string[] = [];
  for (const [tenant, channel] of Object.entries(data)) {
    if (!isTenantId(tenant)) {
      problems.push(`${file}: ${tenant} is not a tenant id`);
      continue;
    }
    // A company's channel is named after it, so two companies never share one, even on a disk
    //   that does not tell a.jsonl from A.jsonl, and no channel leaves the events folder. Found by
    //   step 40's review, M4: two names that differed only in case were two channels (D12).
    if (channel !== `${tenant}.jsonl`) {
      problems.push(`${file}: ${tenant}'s channel must be ${tenant}.jsonl`);
      continue;
    }
    channels.set(tenant, channel);
  }
  return { channels, problems };
}

/** A channel that appends each event to the file, one JSON line each, in the events folder. */
export function fileChannel(dir: string, file: string): (event: DomainEvent) => Promise<void> {
  return async (event) => {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, file), `${JSON.stringify(event)}\n`);
  };
}
