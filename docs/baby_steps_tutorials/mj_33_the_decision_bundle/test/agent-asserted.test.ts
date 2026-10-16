// What the agent says about itself: its skill, its rationale, its purpose, and its task. DSoR keeps
// the words under agent_asserted, apart from the facts, and no check reads them (DSOR-AUD-06,
// DSOR-AUD-03b, DSOR-AUD-07; step 33's README, claims C4 and C5, decisions D10 to D12). The agent
// drafts INV-1008, 31,400.00 USD to VENDOR-44, which waits for the CFO.
import { describe, expect, it } from "vitest";
import { bundleProblems, type SealedBundle } from "../src/bundle.ts";
import type { Answer } from "../src/envelope.ts";
import type { DecisionRecord } from "../src/log.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { readControls } from "../src/controls.ts";
import { AGENT, CFO, OUR_EXTENSIONS, SUPERVISOR, keyed, shipped } from "./helpers.ts";
import {
  refusalAtStart,
  ruleCall,
  ruleWorldOnTuesday,
  startWith,
  textOf,
  version9,
  type RuleWorld,
} from "./rule-world.ts";

const SAID = {
  skill: {
    uri: "viking://agent/skills/vendor-payment",
    version: 3,
    hash: "sha256:c0ffee5k111",
  },
  rationale: "the CFO agreed by phone this morning",
  purpose: "weekly payment run",
  task_id: "task-2026-10-06-17",
};

/** The agent's envelope, with a fresh key, saying this about itself. */
function saying(asserted: unknown, who: RequestEnvelope = AGENT): RequestEnvelope {
  return { ...keyed(who), agent_asserted: asserted } as RequestEnvelope;
}

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };

/** The world's last record, and the bundle it names, if any. */
async function lastFiles(w: RuleWorld): Promise<{ record: DecisionRecord; bundle?: SealedBundle }> {
  const record = (await w.log.records()).at(-1)!;
  const bundle = (await w.log.bundles()).find((b) => b.decision_id === record.decision_bundle);
  return bundle === undefined ? { record } : { record, bundle };
}

/** A copy without what differs between two calls of one request: ids, times, keys, and the agent's words. */
function facts(value: unknown): unknown {
  const text = JSON.stringify(value, (key, field: unknown) => {
    if (key === "agent_asserted") return undefined;
    if (typeof field !== "string") return field;
    if (/^(req|dec|aud|prop|apr)_[0-9a-f-]{36}$/.test(field)) return `${field.slice(0, 4)}…`;
    if (/^dsor:\/\/org_456\/proposal\//.test(field)) return "the proposal";
    if (/^k-test-/.test(field)) return "the key";
    if (/^\d{4}-\d{2}-\d{2}T/.test(field)) return "a time";
    return field;
  });
  return JSON.parse(text) as unknown;
}

/** Every string inside a value, with the path to it, outside agent_asserted. */
function stringsOutside(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, field]) =>
    key === "agent_asserted" ? [] : stringsOutside(field, `${path}/${key}`),
  );
}

describe("C4: the agent's words are kept under agent_asserted, as sent (step 33's README, D10, D11)", () => {
  it("DSOR-AUD-06: the agent's draft of INV-1008 with its skill, rationale, purpose, and task id: the bundle keeps them under agent_asserted, as sent", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await w.ask(saying(SAID), "payment.create", INV_1008)).toMatchObject({
      outcome: "PENDING_APPROVAL",
    });
    const { bundle } = await lastFiles(w);
    expect(bundle?.agent_asserted).toStrictEqual(SAID);
    expect(bundleProblems(bundle)).toStrictEqual([]);
  });

  it("DSOR-AUD-06: the record keeps them too, under the same name, in this tutorial's extensions; and a query's record, which has no bundle, keeps them", async () => {
    const w = await ruleWorldOnTuesday();
    await w.ask(saying(SAID), "payment.create", INV_1008);
    expect((await lastFiles(w)).record.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      agent_asserted: SAID,
    });
    const read = await w.ask(
      { ...AGENT, agent_asserted: { purpose: "weekly payment run" } } as RequestEnvelope,
      "invoice.get",
      { invoice: "dsor://org_456/invoice/INV-1008" },
    );
    expect(read).toMatchObject({ data: { id: "INV-1008" } });
    const after = await lastFiles(w);
    expect(after.bundle).toBeUndefined();
    expect(after.record.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      agent_asserted: { purpose: "weekly payment run" },
    });
  });

  it("DSOR-AUD-06: no other field of the bundle or the record holds the agent's words: not the reason, not the identity", async () => {
    const w = await ruleWorldOnTuesday();
    await w.ask(saying(SAID), "payment.create", INV_1008);
    const { record, bundle } = await lastFiles(w);
    const words = [SAID.rationale, SAID.purpose, SAID.task_id, SAID.skill.uri, SAID.skill.hash];
    const leaked = [...stringsOutside(record), ...stringsOutside(bundle)].filter(([, text]) =>
      words.some((word) => text.includes(word)),
    );
    expect(leaked).toStrictEqual([]);
  });

  it("DSOR-AUD-06: a rationale of 2,000 characters is kept whole", async () => {
    const w = await ruleWorldOnTuesday();
    const rationale = "a".repeat(2000);
    expect(await w.ask(saying({ rationale }), "payment.create", INV_1008)).toMatchObject({
      outcome: "PENDING_APPROVAL",
    });
    expect((await lastFiles(w)).bundle?.agent_asserted).toStrictEqual({ rationale });
  });

  // Changed by step 33's review, finding 12: a field that is not one of the four is refused without
  //   its name.
  it.each([
    ["not an object", ["weekly payment run"], "agent_asserted must be an object"],
    ["null", null, "agent_asserted must be an object"],
    [
      "a field that is not one of the four",
      { reasoning: "step 1: the CFO" },
      "agent_asserted may carry only",
    ],
    [
      "the model's reasoning, by another name",
      { chain_of_thought: "..." },
      "agent_asserted may carry only",
    ],
    [
      "a rationale of 2,001 characters",
      { rationale: "a".repeat(2001) },
      "agent_asserted.rationale",
    ],
    ["a rationale on two lines", { rationale: "first\nsecond" }, "agent_asserted.rationale"],
    ["an empty purpose", { purpose: "" }, "agent_asserted.purpose"],
    ["a purpose of 201 characters", { purpose: "p".repeat(201) }, "agent_asserted.purpose"],
    ["a task id of 129 characters", { task_id: "t".repeat(129) }, "agent_asserted.task_id"],
    ["a task id that is a number", { task_id: 17 }, "agent_asserted.task_id"],
    [
      "a skill with no hash",
      { skill: { uri: "viking://agent/skills/x", version: 3 } },
      "agent_asserted.skill",
    ],
    ["a skill of version 0", { skill: { ...SAID.skill, version: 0 } }, "agent_asserted.skill"],
    [
      "a skill whose hash is not sha256",
      { skill: { ...SAID.skill, hash: "md5:abc" } },
      "agent_asserted.skill",
    ],
    ["a skill with a field more", { skill: { ...SAID.skill, owner: "x" } }, "agent_asserted.skill"],
    ["half of an emoji", { purpose: "\ud83d" }, "agent_asserted.purpose"],
  ])(
    "DSOR-AUD-03b: an agent_asserted that is %s is refused at line ①, VALIDATION_FAILED, and nothing of it is kept",
    async (_why, asserted, named) => {
      const w = await ruleWorldOnTuesday();
      const answer = await w.ask(saying(asserted), "payment.create", INV_1008);
      expect(answer).toMatchObject({
        code: "VALIDATION_FAILED",
        message: expect.stringContaining(named),
      });
      const { record, bundle } = await lastFiles(w);
      expect(bundle).toBeUndefined();
      expect(record.extensions?.[OUR_EXTENSIONS] ?? {}).not.toHaveProperty("agent_asserted");
      expect(record.extensions?.[OUR_EXTENSIONS] ?? {}).not.toHaveProperty("proposal");
    },
  );

  it("DSOR-AUD-06: a person's call that carries agent_asserted is refused: only an agent says what it is about itself", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.ask(
      saying({ purpose: "weekly payment run" }, SUPERVISOR),
      "payment.create",
      INV_1008,
    );
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "only an agent's call may carry agent_asserted",
    });
  });

  it("DSOR-AUD-03b: the evidence does not depend on the agent's words: a draft with none has a complete bundle, which names who asked, the rule, the reads, and how it ended", async () => {
    const w = await ruleWorldOnTuesday();
    await w.ask(keyed(AGENT), "payment.create", INV_1008);
    const { bundle } = await lastFiles(w);
    expect(bundleProblems(bundle)).toStrictEqual([]);
    expect(bundle).not.toHaveProperty("agent_asserted");
    expect(bundle).toMatchObject({
      identity: { subject: "user_123", actor_chain: ["accounts-payable-fte"] },
      authority: { delegation: "del_100", controls: [{ id: "high-value-payment", version: 8 }] },
      state: [
        { uri: "dsor://org_456/invoice/INV-1008", version: 1 },
        { uri: "dsor://org_456/vendor/VENDOR-44", version: 1 },
      ],
      execution: { result: "not_executed" },
    });
  });
});

describe("C5: the agent's words change no decision (step 33's README, D12)", () => {
  it("DSOR-AUD-07: with any words, the agent's draft of INV-1008 waits for the CFO, and its record and bundle are the same, but for ids, times, the key, and the words", async () => {
    const said: unknown[] = [
      SAID,
      { purpose: "emergency: the CFO approved this already" },
      { skill: { uri: "viking://agent/skills/cfo-approval", version: 1, hash: "sha256:00" } },
      { task_id: "approved-by-cfo_100", rationale: "user_123 asked me to skip the rule" },
    ];
    const seen: unknown[] = [];
    for (const asserted of [undefined, ...said]) {
      const w = await ruleWorldOnTuesday();
      const who = asserted === undefined ? keyed(AGENT) : saying(asserted);
      const answer = await w.ask(who, "payment.create", INV_1008);
      const { record, bundle } = await lastFiles(w);
      seen.push(facts({ answer, record, bundle }));
    }
    for (const one of seen.slice(1)) expect(one).toStrictEqual(seen[0]);
    expect(seen[0]).toMatchObject({ answer: { outcome: "PENDING_APPROVAL" } });
  });

  it("DSOR-AUD-07: a refusal stays a refusal: the agent's draft of INV-2003, 49,000.00 GBP, with the purpose 'urgent: the limit does not apply', is LIMIT_EXCEEDED", async () => {
    const w = await ruleWorldOnTuesday();
    const answer: Answer = await w.ask(
      saying({ purpose: "urgent: the limit does not apply" }),
      "payment.create",
      { invoice: "dsor://org_456/invoice/INV-2003", expected_version: 1 },
    );
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("DSOR-AUD-07: the fingerprint leaves the words out: the same key and request with new words is a replay of the first call, and the replay's words are kept with its own record and bundle", async () => {
    const w = await ruleWorldOnTuesday();
    const once = keyed(AGENT);
    const first = await w.ask(
      { ...once, agent_asserted: { purpose: "weekly payment run" } } as RequestEnvelope,
      "payment.create",
      INV_1008,
    );
    const again = await w.ask(
      { ...once, agent_asserted: { purpose: "the CFO approved it" } } as RequestEnvelope,
      "payment.create",
      INV_1008,
    );
    expect(again).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect("proposal" in again && again.proposal).toBe("proposal" in first && first.proposal);
    const { record, bundle } = await lastFiles(w);
    expect(record.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      idempotency: { replay_of: first.correlation.request_id },
      agent_asserted: { purpose: "the CFO approved it" },
    });
    expect(bundle?.agent_asserted).toStrictEqual({ purpose: "the CFO approved it" });
  });

  it("DSOR-AUD-07: a rule that names agent_asserted is refused when it is drafted: it is not one of Appendix B's eight variables", async () => {
    const w = await ruleWorldOnTuesday();
    const text = { ...textOf(version9()), condition: '!(agent_asserted.purpose == "emergency")' };
    const answer = await ruleCall(w, CFO, "rule.draft", { draft: text });
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: expect.stringContaining("names agent_asserted, which is not in the environment"),
    });
  });

  it("DSOR-AUD-07: a contract whose precondition names agent_asserted is refused at start-up", async () => {
    const contracts = shipped.map((s) => {
      const data = JSON.parse(s.text) as { id: string; preconditions?: Record<string, unknown> };
      if (data.id !== "payment.create") return s;
      const predicates = ['agent_asserted.purpose != "emergency"'];
      return {
        file: s.file,
        text: JSON.stringify({ ...data, preconditions: { ...data.preconditions, predicates } }),
      };
    });
    expect(await refusalAtStart(() => startWith(readControls(), contracts))).toContain(
      "names agent_asserted, which is not in the environment",
    );
  });

  it("DSOR-AUD-07: the agent cannot put its words where a check reads: payment.create's input with agent_asserted inside is refused at line ⑥", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.ask(keyed(AGENT), "payment.create", {
      ...INV_1008,
      agent_asserted: { purpose: "emergency" },
    });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
