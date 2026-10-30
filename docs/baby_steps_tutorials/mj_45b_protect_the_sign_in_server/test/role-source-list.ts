// The tests every role source must pass, whatever it is: the company's sign-in
// server that DSoR asks (this step), a copy that a directory sends by SCIM, or DSoR's own table
// (step 45's README, D5). A role source joins by giving a world: a way to start it for org_456
// with the story's people, and switches that change what DSoR hears at its next ask. Each refusal
// sits beside the success it guards, because a test that expects "yes" passes before any code
// says "no".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Directories } from "../src/directory.ts";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import { memorySlips, type Slip, type SlipStore } from "../src/slips.ts";
import { AGENT, MASKED_1008_OF_456, STORY_SLIPS, keyed, slipRegistry } from "./helpers.ts";

/** What a company says about one person (step 45's README, D4). */
export type Entry = { status: "active" | "suspended" | "gone"; roles: string[] };

/** The switches a world gives the list. Each changes what DSoR hears at its next ask. */
export type Switches = {
  /** What the company says about this person from now on. */
  set: (person: string, entry: Entry) => void;
  /** From now on, every answer is about this person, whoever DSoR asked about (D2). */
  answerAbout: (person: string) => void;
  /** From now on, every reply is one that DSoR cannot read (D2). */
  replyUnreadable: () => void;
  /** From now on, every answer says its facts were read at this time of the night, as a cache would (D13). */
  readAt: (time: string) => void;
  /** From now on, the company cannot answer, as a server that is down (C5). */
  stopAnswering: () => void;
};

/** A role source started for org_456, with user_123 (ap_supervisor) and cfo_100 (CFO) active. */
export type Started = { directories: Directories; switches: Switches; stop: () => Promise<void> };

/** A role source that joins the list: its name, and how to start it. */
export type RoleSourceWorld = { name: string; start: () => Promise<Started> };

// The night of step 19's story. Only the date is faked: a world may talk to a real server over
// the network, and faked timers would stop it.
export const NIGHT = "2026-10-06";
/** Sets DSoR's clock to this time of the story's night, in UTC. */
function at(time: string): void {
  vi.setSystemTime(new Date(`${NIGHT}T${time}:00Z`));
}

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };

/** Runs the list against one role source. */
export function roleSourceList(world: RoleSourceWorld): void {
  describe(`${world.name}: the list every role source passes (step 45's README, D5)`, () => {
    let started: Started;
    let registry: Registry;
    let rows: Payment[];
    let slips: SlipStore;

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      at("02:00");
      started = await world.start();
      rows = [];
      slips = memorySlips(STORY_SLIPS);
      registry = slipRegistry(slips, undefined, rows, started.directories);
    });

    afterEach(async () => {
      await started.stop();
      vi.useRealTimers();
    });

    /** The agent reads INV-1008 under del_100, which user_123 signed. */
    function read(): Promise<unknown> {
      return call(registry, createLog(), AGENT, "invoice.get", INVOICE);
    }

    /** The agent drafts a payment of INV-1008 under del_100. */
    function pay(): Promise<unknown> {
      return call(registry, createLog(), keyed(AGENT), "payment.create", {
        ...INVOICE,
        expected_version: 1,
      });
    }

    async function del100(): Promise<Slip["status"]> {
      return ((await slips.find("org_456", "accounts-payable-fte"))?.slip as Slip).status;
    }

    it("DSOR-IDN-07: while the company says user_123 is active, the agent drafts a payment under del_100", async () => {
      expect(await pay()).toMatchObject({ data: { status: "draft" } });
      expect(rows).toHaveLength(1);
      expect(await del100()).toBe("active");
    });

    it("DSOR-IDN-07: once the company says user_123 is gone, the next ask refuses, and del_100 is suspended", async () => {
      expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
      started.switches.set("user_123", { status: "gone", roles: [] });
      at("02:01");
      expect(await pay()).toMatchObject({ code: "DELEGATION_REQUIRED", retry: "never" });
      expect(rows).toStrictEqual([]);
      expect(await del100()).toBe("suspended");
    });

    it("DSOR-IDN-06: an answer whose facts were read 59 minutes ago counts, under org_456's hour", async () => {
      started.switches.readAt("01:01");
      expect(await pay()).toMatchObject({ data: { status: "draft" } });
      expect(rows).toHaveLength(1);
    });

    it("DSOR-IDN-06: an answer whose facts were read 61 minutes ago is refused with FRESHNESS_UNSATISFIABLE", async () => {
      started.switches.readAt("00:59");
      expect(await pay()).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
      expect(rows).toStrictEqual([]);
    });

    it("D2: an answer that names user_123, whom DSoR asked about, counts", async () => {
      started.switches.answerAbout("user_123");
      expect(await pay()).toMatchObject({ data: { status: "draft" } });
      expect(rows).toHaveLength(1);
    });

    it("D2: an answer about cfo_100, when DSoR asked about user_123, is a fault, and suspends nothing", async () => {
      started.switches.answerAbout("cfo_100");
      expect(await pay()).toMatchObject({ code: "INTERNAL_ERROR" });
      expect(rows).toStrictEqual([]);
      expect(await del100()).toBe("active");
    });

    it("D2: a company that cannot answer now is not a fault: the kept answer still counts", async () => {
      expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
      started.switches.stopAnswering();
      at("02:10");
      expect(await pay()).toMatchObject({ data: { status: "draft" } });
      expect(rows).toHaveLength(1);
    });

    it("D2: a reply DSoR cannot read is a fault, and drops the kept answer, so the next 'cannot answer now' is refused", async () => {
      expect(await read()).toMatchObject({ data: MASKED_1008_OF_456 });
      started.switches.replyUnreadable();
      at("02:01");
      expect(await read()).toMatchObject({ code: "INTERNAL_ERROR" });
      started.switches.stopAnswering();
      at("02:02");
      expect(await pay()).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
      expect(rows).toStrictEqual([]);
    });
  });
}
