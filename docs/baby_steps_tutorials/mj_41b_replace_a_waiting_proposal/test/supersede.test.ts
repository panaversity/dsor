// NEW IN STEP 41b: the cancel of a replaced proposal, alone, with stores a test controls. Found by
//   step 41b's own break B19: with the check of the move's answer removed, every test stayed green,
//   because no race in the tests landed between the look and the move. Here a release lands there
//   every time (step 41b's review, M2).
import { describe, expect, it } from "vitest";
import { Refusal } from "../src/envelope.ts";
import type { ReservationStore } from "../src/limits.ts";
import type { Proposal, ProposalStore } from "../src/proposals.ts";
import { cancelReplaced } from "../src/supersede.ts";

const OLD = "dsor://org_456/proposal/prop_11111111-1111-4111-8111-111111111111";
const NEW = "dsor://org_456/proposal/prop_22222222-2222-4222-8222-222222222222";

/** The old proposal as the look read it: APPROVED. */
const old = { uri: OLD, state: "APPROVED" } as Proposal;

const by = {
  mover: {
    mode: "unattended" as const,
    subject: "user_123",
    actor_chain: ["accounts-payable-fte"],
    subject_authority: { source: "role_source" as const, as_of: "2026-10-06T15:05:00.000Z" },
  },
  correlation: { request_id: "req_test" },
};

describe("step 41b's review, M2: a proposal that moved on between the look and the move", () => {
  it("step 41b's decision D6: M2: a release moved the old proposal first: CONFLICT, and its booking is not given back", async () => {
    const released: string[] = [];
    // A release committed between the look and the move: the move finds it EXECUTING, not APPROVED.
    const proposals = {
      move: async () => false,
      lines: async () => [],
    } as unknown as ProposalStore;
    const reservations = {
      release: async (_tenant: string, id: string) => {
        released.push(id);
      },
    } as unknown as ReservationStore;
    const cancelled = cancelReplaced({ proposals, reservations }, "org_456", old, NEW, by);
    await expect(cancelled).rejects.toBeInstanceOf(Refusal);
    await expect(cancelled).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "proposal prop_11111111-1111-4111-8111-111111111111 moved on while it was being replaced",
    });
    expect(released).toStrictEqual([]);
  });

  it("step 41b's decision D7: M2: the old proposal still waits: it moves to CANCELLED, then its booking goes back", async () => {
    const done: string[] = [];
    const proposals = {
      move: async (_tenant: string, id: string, from: string, to: string) => {
        done.push(`${id} ${from} -> ${to}`);
        return true;
      },
      lines: async () => [],
    } as unknown as ProposalStore;
    const reservations = {
      release: async (_tenant: string, id: string) => {
        done.push(`release ${id}`);
      },
    } as unknown as ReservationStore;
    await cancelReplaced({ proposals, reservations }, "org_456", old, NEW, by);
    expect(done).toStrictEqual([
      "prop_11111111-1111-4111-8111-111111111111 APPROVED -> CANCELLED",
      "release prop_11111111-1111-4111-8111-111111111111",
    ]);
  });
});
