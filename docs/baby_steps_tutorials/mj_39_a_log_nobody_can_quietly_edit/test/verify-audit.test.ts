// Step 39: the checker of DSoR's log. Given each chain's records in their places, it recomputes
// every fingerprint with the same recipe as the database, and names the first record of each chain
// that does not fit: a field changed, a fingerprint changed, a record removed, records swapped. It
// cannot see a chain rewritten from the edit on, or its newest records removed: step 39b's
// checkpoints (DSOR-AUD-04b, DSOR-AUD-04c; step 39's README, claims C4 to C6).
import { describe, expect, it } from "vitest";
import {
  fingerprint,
  GENESIS,
  recipeText,
  verifyChains,
  type ChainRow,
} from "../src/audit-chain.ts";

/** A chain of records, each field list as the database writes it as text, fingerprinted. */
function chainOf(chain: string, records: (string | null)[][]): ChainRow[] {
  const rows: ChainRow[] = [];
  let previous = GENESIS;
  records.forEach((fields, i) => {
    const position = String(i + 1);
    const record_hash = fingerprint(previous, chain, position, fields);
    rows.push({ chain, chain_position: position, previous_hash: previous, record_hash, fields });
    previous = record_hash;
  });
  return rows;
}

/** Three records of org_456: a draft, a denied reconcile, a release. */
const STORY = (): (string | null)[][] => [
  [
    "1",
    "aud_1",
    "2026-10-19T09:00:00.000000Z",
    "decision",
    "payment.create@1",
    "ALLOW",
    "COMMITTED",
  ],
  [
    "2",
    "aud_2",
    "2026-10-19T09:01:00.000000Z",
    "decision",
    "payment.reconcile@1",
    "DENY",
    "AUTHORIZATION_DENIED",
  ],
  ["3", "aud_3", "2026-10-19T09:02:00.000000Z", "decision", "proposal.execute@1", "ALLOW", null],
];

describe("C4 and C5: a whole chain passes, and each kind of break is named", () => {
  it("DSOR-AUD-04b: org_456's three records and org_789's two are whole", () => {
    const rows = [...chainOf("org_456", STORY()), ...chainOf("org_789", STORY().slice(0, 2))];
    expect(verifyChains(rows)).toStrictEqual([
      { chain: "org_456", records: 3 },
      { chain: "org_789", records: 2 },
    ]);
  });

  it("DSOR-AUD-04b: a field changed: the denied reconcile now says ALLOW, and record 2's contents no longer match its fingerprint", () => {
    const rows = chainOf("org_456", STORY());
    rows[1]!.fields[5] = "ALLOW";
    expect(verifyChains(rows)).toStrictEqual([
      {
        chain: "org_456",
        records: 3,
        broken: {
          position: 2,
          record_id: "aud_2",
          why: "its contents do not match its fingerprint",
        },
      },
    ]);
  });

  it("DSOR-AUD-04b: a field changed and that record's fingerprint written again: record 3 no longer follows it", () => {
    const rows = chainOf("org_456", STORY());
    rows[1]!.fields[5] = "ALLOW";
    rows[1]!.record_hash = fingerprint(rows[1]!.previous_hash, "org_456", "2", rows[1]!.fields);
    expect(verifyChains(rows)[0]!.broken).toStrictEqual({
      position: 3,
      record_id: "aud_3",
      why: "it does not follow the record before it",
    });
  });

  it("DSOR-AUD-04b: a record removed from the middle: place 2 is missing", () => {
    const rows = chainOf("org_456", STORY());
    rows.splice(1, 1);
    expect(verifyChains(rows)[0]!.broken).toStrictEqual({
      position: 2,
      record_id: "aud_3",
      why: "the record at place 2 is missing",
    });
  });

  it("DSOR-AUD-04b: two records swapped, places and all: the first one out of order is named", () => {
    const rows = chainOf("org_456", STORY());
    const [a, b] = [rows[1]!, rows[2]!];
    rows[1] = { ...b, chain_position: "2" };
    rows[2] = { ...a, chain_position: "3" };
    expect(verifyChains(rows)[0]!.broken).toMatchObject({ position: 2, record_id: "aud_3" });
  });

  it("DSOR-AUD-04c: a record that names another chain than the one it is read in is broken", () => {
    const rows = chainOf("org_456", STORY());
    rows[2] = { ...rows[2]!, chain: "org_789" };
    const report = verifyChains(rows);
    // Read in org_789's chain, it stands alone at place 3, so place 1 is missing there.
    expect(report.find((r) => r.chain === "org_789")!.broken).toStrictEqual({
      position: 1,
      record_id: "aud_3",
      why: "the record at place 1 is missing",
    });
  });

  it("DSOR-AUD-04b: an empty log is whole, with no chain", () => {
    expect(verifyChains([])).toStrictEqual([]);
  });
});

describe("C6: what the chain cannot see, said plainly", () => {
  it("DSOR-AUD-04b: the newest record removed passes: only a checkpoint kept elsewhere would see it (step 39b)", () => {
    const rows = chainOf("org_456", STORY());
    rows.pop();
    expect(verifyChains(rows)).toStrictEqual([{ chain: "org_456", records: 2 }]);
  });

  it("DSOR-AUD-04b: a field changed and every fingerprint after it written again passes: only a checkpoint would see it (step 39b)", () => {
    const story = STORY();
    story[1]![5] = "ALLOW";
    expect(verifyChains(chainOf("org_456", story))).toStrictEqual([
      { chain: "org_456", records: 3 },
    ]);
  });
});

describe("D5: the recipe", () => {
  it("DSOR-AUD-04b: a field that is null and a field that is empty make different texts", () => {
    expect(recipeText("org_456", "1", [null])).not.toBe(recipeText("org_456", "1", [""]));
  });

  it("DSOR-AUD-04b: moving a letter from one field to the next makes a different text", () => {
    expect(recipeText("org_456", "1", ["ab", "c"])).not.toBe(
      recipeText("org_456", "1", ["a", "bc"]),
    );
  });

  it("DSOR-AUD-04b: each field is counted in bytes, so é and e make different lengths", () => {
    expect(recipeText("org_456", "1", ["é"])).toContain("2:é");
  });

  it("DSOR-AUD-04b: a fingerprint is sha256: and 64 hex digits, and the first record follows a fingerprint of zeros", () => {
    expect(GENESIS).toBe(`sha256:${"0".repeat(64)}`);
    expect(fingerprint(GENESIS, "org_456", "1", ["x"])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
