// Step 39b: taking a checkpoint. It notes every chain of one database at its last place, follows
// the checkpoint before it, and is never taken over a broken log, nor over a folder whose newest
// checkpoint is not the one this key signed last (DSOR-AUD-04b, DSOR-AUD-04d; step 39b's README,
// claim C2, decisions D10, D11, and D13).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NO_CHAIN } from "../src/audit-chain.ts";
import {
  checkpointFileName,
  checkpointHash,
  checkpointText,
  takeCheckpoint,
  type Checkpoint,
} from "../src/checkpoint.ts";
import { mayTake } from "../src/checkpoint-signer.ts";
import { AT_10, AT_9, chainOf, check, DB, fileOf, LOG, rewritten, STORY } from "./checkpoints.ts";

describe("C2: what a checkpoint notes", () => {
  it("DSOR-AUD-04d: a checkpoint covers every chain of the log, no_company included, each at its last place, and names its database", () => {
    const taken = takeCheckpoint({ rows: LOG(), database: DB }, AT_9, null);
    expect("checkpoint" in taken && taken.checkpoint).toStrictEqual({
      database: DB,
      taken_at: AT_9,
      previous: null,
      chains: [
        { chain: "no_company", chain_position: "1", record_hash: LOG()[3]!.record_hash },
        { chain: "org_456", chain_position: "3", record_hash: LOG()[2]!.record_hash },
      ],
    });
  });

  // Found by the review, M26: places compared as text put place 9 after place 12.
  it("DSOR-AUD-04d: a chain of twelve records is noted at place 12, not place 9", () => {
    const records = Array.from({ length: 12 }, (_, i) => [String(i + 1), `aud_${i + 1}`]);
    const rows = chainOf("org_456", records);
    const taken = takeCheckpoint({ rows, database: DB }, AT_9, null);
    expect("checkpoint" in taken && taken.checkpoint.chains[0]!.chain_position).toBe("12");
  });

  it("DSOR-AUD-04b: a broken log is never signed: the checkpoint is refused, and the break is named", () => {
    const rows = LOG();
    rows[1]!.fields[5] = "ALLOW";
    const taken = takeCheckpoint({ rows, database: DB }, AT_9, null);
    expect("refused" in taken && taken.refused).toMatchObject([
      { chain: "no_company" },
      { chain: "org_456", broken: { position: 2, record_id: "aud_2" } },
    ]);
  });

  // Found by the review, M6b: a checkpoint that ignored the heads signed a log cut short.
  it("DSOR-AUD-04b: a log whose newest record is gone while its head still names it is never signed", () => {
    const rows = LOG();
    const heads = new Map([
      ["org_456", { chain_position: "3", record_hash: rows[2]!.record_hash }],
      ["no_company", { chain_position: "1", record_hash: rows[3]!.record_hash }],
    ]);
    const cut = rows.filter((r) => r.fields[1] !== "aud_3");
    expect("refused" in takeCheckpoint({ rows: cut, heads, database: DB }, AT_9, null)).toBe(true);
  });

  it("DSOR-AUD-04b: a record with no chain is a broken log, so no checkpoint", () => {
    const stray = { chain: NO_CHAIN, chain_position: "0", previous_hash: "", record_hash: "" };
    const rows = [...LOG(), { ...stray, fields: ["9"] }];
    expect("checkpoint" in takeCheckpoint({ rows, database: DB }, AT_9, null)).toBe(false);
  });

  it("DSOR-AUD-04b: the signed text has its fields in a fixed order and its chains sorted, whatever order they came in", () => {
    const a: Checkpoint = {
      database: DB,
      taken_at: AT_9,
      previous: null,
      chains: [
        { chain: "org_456", chain_position: "3", record_hash: "sha256:b" },
        { chain: "no_company", chain_position: "1", record_hash: "sha256:a" },
      ],
    };
    const b = {
      chains: [...a.chains].reverse().map((c) => ({
        record_hash: c.record_hash,
        chain_position: c.chain_position,
        chain: c.chain,
      })),
      previous: null,
      taken_at: AT_9,
      database: { name: DB.name, system_identifier: DB.system_identifier },
    };
    expect(checkpointText(a)).toBe(checkpointText(b));
  });

  it("DSOR-AUD-04b: a checkpoint's fingerprint is SHA-256 over its signed text, and its file is named by its time, with no colon", () => {
    const checkpoint: Checkpoint = { database: DB, taken_at: AT_9, previous: null, chains: [] };
    const sha = createHash("sha256").update(checkpointText(checkpoint), "utf8").digest("hex");
    expect(checkpointHash(checkpoint)).toBe(`sha256:${sha}`);
    expect(checkpointFileName(checkpoint)).toBe("2026-10-20T09-00-00.000Z.json");
  });
});

describe("D13: the signer follows its own last checkpoint (the review, H1)", () => {
  const A = () => fileOf(LOG(), AT_9);

  it("DSOR-AUD-04b: the first checkpoint, with no folder and no record of a last one, follows nothing", () => {
    expect(mayTake(check(LOG(), []), undefined)).toStrictEqual({ previous: null });
  });

  it("DSOR-AUD-04b: the next checkpoint follows the newest in the folder, when that is the one this key signed last", () => {
    const a = A();
    const last = { name: a.name, hash: a.hash };
    expect(mayTake(check(LOG(), [a]), last)).toStrictEqual({ previous: a.hash });
  });

  it("DSOR-AUD-04b: H1: the owner rewrote the chain after checkpoint A: the routine checkpoint is refused, so it cannot vouch for the rewrite", () => {
    const a = A();
    const decision = mayTake(check(rewritten(), [a]), { name: a.name, hash: a.hash });
    expect(decision).toStrictEqual({
      refused: "the log or a checkpoint is broken, and a new checkpoint would vouch for the break",
    });
  });

  it("DSOR-AUD-04b: H1: the owner rewrote the chain and deleted checkpoint A first: refused, because A is the last this key signed", () => {
    const a = A();
    const decision = mayTake(check(rewritten(), []), { name: a.name, hash: a.hash });
    expect(decision).toStrictEqual({
      refused: `the newest checkpoint this key signed, ${a.name}, is not the newest in the folder`,
    });
  });

  it("DSOR-AUD-04b: an older checkpoint left in place of the last one signed is refused too", () => {
    const a = A();
    const b = fileOf(LOG(), AT_10, { previous: a.hash });
    const decision = mayTake(check(LOG(), [a]), { name: b.name, hash: b.hash });
    expect(decision).toHaveProperty("refused");
  });

  it("DSOR-AUD-04b: a log that is whole but not yet vouched for, exit 2, may be checkpointed", () => {
    const stale = check(LOG(), [A()], "2026-10-25T09:00:00.000Z");
    expect(stale.exit).toBe(2);
    expect(mayTake(stale, { name: A().name, hash: A().hash })).toStrictEqual({
      previous: A().hash,
    });
  });

  it("DSOR-AUD-04b: org_456 grows past checkpoint A, and the next checkpoint notes the new last place", () => {
    const grown = chainOf("org_456", [...STORY(), ["9", "aud_9", AT_10, "decision"]]);
    const taken = takeCheckpoint({ rows: grown, database: DB }, AT_10, A().hash);
    expect("checkpoint" in taken && taken.checkpoint.chains[0]!.chain_position).toBe("4");
  });
});
