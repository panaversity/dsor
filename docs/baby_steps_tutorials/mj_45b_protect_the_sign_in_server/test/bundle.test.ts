// The decision bundle: one file of facts for each decision about a command, from line ④ on, kept
// with its record (DSOR-AUD-03a; step 33's README, claims C1 and C2, decisions D1, D2, D4, and D9).
// The agent drafts INV-1008, 31,400.00 USD to VENDOR-44, which waits for the CFO; cfo_100 approves
// it; the agent releases it. Around them, calls that DSoR refuses at each line.
import { describe, expect, it } from "vitest";
import { bundleProblems, type SealedBundle } from "../src/bundle.ts";
import type { Answer } from "../src/envelope.ts";
import { createLog, type Decision, type DecisionRecord } from "../src/log.ts";
import { AGENT, CFO, OUR_EXTENSIONS, SUPERVISOR, keyed } from "./helpers.ts";
import { ruleWorldOnTuesday, textOf, version9, type RuleWorld } from "./rule-world.ts";

/** The URI of the proposal an answer names, and its id. */
function proposalOf(answer: Answer): { uri: string; id: string } {
  const uri = String("proposal" in answer ? answer.proposal : "");
  return { uri, id: uri.split("/").at(-1)! };
}

/** Each record of the world's log, in order, with the bundle it names, if any. */
async function filesOf(w: RuleWorld): Promise<{ record: DecisionRecord; bundle?: SealedBundle }[]> {
  const bundles = await w.log.bundles();
  return (await w.log.records()).map((record) => {
    const bundle = bundles.find((b) => b.decision_id === record.decision_bundle);
    return bundle === undefined ? { record } : { record, bundle };
  });
}

/** The bundle of the world's last call. */
async function lastBundle(w: RuleWorld): Promise<SealedBundle> {
  const last = (await filesOf(w)).at(-1)!;
  expect(last.bundle).toBeDefined();
  return last.bundle!;
}

/** The agent drafts INV-1008, which waits for the CFO, and cfo_100 approves it. */
async function approved(w: RuleWorld): Promise<{ uri: string; id: string }> {
  const drafted = await w.draft("INV-1008");
  expect(drafted).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const proposal = proposalOf(drafted);
  const kept = (await w.proposals.get("org_456", proposal.id))!;
  const yes = await w.ask(keyed(CFO), "proposal.approve", {
    proposal: kept.uri,
    payload_hash: kept.payload_hash,
  });
  expect(yes).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
  return proposal;
}

describe("C1: every decision about a command from line ④ on has one bundle (step 33's README, D1 and D2)", () => {
  it("DSOR-AUD-03a: the agent's draft of INV-1008, which waits for the CFO, leaves one record and one bundle, which the record names and which validates against decision-bundle.schema.json", async () => {
    const w = await ruleWorldOnTuesday();
    await w.draft("INV-1008");
    const files = await filesOf(w);
    expect(files).toHaveLength(1);
    const { record, bundle } = files[0]!;
    expect(record.decision_bundle).toMatch(/^dec_[0-9a-f-]{36}$/);
    expect(bundle?.decision_id).toBe(record.decision_bundle);
    expect(bundleProblems(bundle)).toStrictEqual([]);
    expect(bundle?.sealed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("DSOR-AUD-03a: a refusal at line ⑤, one at line ⑥, a dry run, a prepared proposal, a replay, a payment drafted, cfo_100's approval, the release, and a tear-up each leave one valid bundle; a query and refusals at lines ① to ③ leave none", async () => {
    const w = await ruleWorldOnTuesday();
    const calls: [string, () => Promise<Answer>, boolean][] = [];
    const invoice = (id: string) => ({
      invoice: `dsor://org_456/invoice/${id}`,
      expected_version: 1,
    });
    const firstKey = keyed(AGENT);
    calls.push([
      "the agent drafts INV-1008",
      () => w.ask(firstKey, "payment.create", invoice("INV-1008")),
      true,
    ]);
    calls.push([
      "the agent reads INV-1008, a query",
      () => w.ask(AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" }),
      false,
    ]);
    calls.push([
      "a login nobody issued, refused at line ①",
      () =>
        w.ask(
          keyed({ token: "tok_0000", tenant: "org_456" }),
          "payment.create",
          invoice("INV-1002"),
        ),
      false,
    ]);
    calls.push([
      "user_123 in org_789, refused at line ②",
      () =>
        w.ask(keyed({ ...SUPERVISOR, tenant: "org_789" }), "payment.create", invoice("INV-1002")),
      false,
    ]);
    calls.push([
      "the agent issues INV-1011, refused at line ⑤",
      () =>
        w.ask(keyed(AGENT), "invoice.issue", {
          invoice: "dsor://org_456/invoice/INV-1011",
          expected_version: 1,
        }),
      true,
    ]);
    calls.push([
      "the agent names INV-1002 badly, refused at line ⑥",
      () => w.ask(keyed(AGENT), "payment.create", { invoice: "INV-1002", expected_version: 1 }),
      true,
    ]);
    calls.push([
      "user_123 tries INV-1002 as a dry run",
      () => w.ask({ ...SUPERVISOR, mode: "validate_only" }, "payment.create", invoice("INV-1002")),
      true,
    ]);
    calls.push([
      "user_123 prepares INV-1006",
      () =>
        w.ask(
          keyed({ ...SUPERVISOR, mode: "propose_only" }),
          "payment.create",
          invoice("INV-1006"),
        ),
      true,
    ]);
    calls.push([
      "the agent sends its first draft again, a replay",
      () => w.ask(firstKey, "payment.create", invoice("INV-1008")),
      true,
    ]);
    calls.push([
      "user_123 drafts INV-1002",
      () => w.ask(keyed(SUPERVISOR), "payment.create", invoice("INV-1002")),
      true,
    ]);
    const answers: Answer[] = [];
    for (const [, run] of calls) answers.push(await run());
    const kept = (await w.proposals.get("org_456", proposalOf(answers[0]!).id))!;
    calls.push([
      "cfo_100 approves INV-1008",
      () =>
        w.ask(keyed(CFO), "proposal.approve", {
          proposal: kept.uri,
          payload_hash: kept.payload_hash,
        }),
      true,
    ]);
    calls.push([
      "the agent releases INV-1008",
      () => w.ask(keyed(AGENT), "proposal.execute", { proposal: kept.uri }),
      true,
    ]);
    calls.push([
      "user_123 tears up del_100",
      () =>
        w.ask(keyed(SUPERVISOR), "delegation.revoke", {
          slip: "dsor://org_456/delegation/del_100",
          reason: "the agent is retired",
        }),
      true,
    ]);
    calls.push([
      "the agent drafts INV-1009 under the torn slip, refused at line ③",
      () => w.ask(keyed(AGENT), "payment.create", invoice("INV-1009")),
      false,
    ]);
    for (const [, run] of calls.slice(answers.length)) answers.push(await run());
    expect(
      answers.map((a) => ("code" in a ? a.code : "outcome" in a ? a.outcome : undefined)),
    ).toStrictEqual([
      "PENDING_APPROVAL",
      undefined,
      "AUTHENTICATION_REQUIRED",
      "AUTHORIZATION_DENIED",
      "AUTHORIZATION_DENIED",
      "VALIDATION_FAILED",
      "VALIDATED",
      "READY",
      "PENDING_APPROVAL",
      "COMMITTED",
      "COMMITTED",
      "COMMITTED",
      "COMMITTED",
      "DELEGATION_REVOKED",
    ]);
    const files = await filesOf(w);
    expect(files).toHaveLength(calls.length);
    expect(files.map((f) => f.bundle !== undefined)).toStrictEqual(calls.map(([, , has]) => has));
    for (const { bundle } of files)
      if (bundle !== undefined) expect(bundleProblems(bundle)).toStrictEqual([]);
    const ids = files.flatMap((f) => (f.bundle === undefined ? [] : [f.bundle.decision_id]));
    expect(new Set(ids).size).toBe(ids.length);
    expect((await w.log.bundles()).length).toBe(ids.length);
  });

  // Found by the review of the README, finding 33: no test looked at the bundle of a refusal at line
  //   ④, or of a brake, a rule's draft, or a sheet of rates, so the bundle could have begun after line
  //   ④ with every test green.
  it("DSOR-AUD-03a: user_123's brake on the agent, the agent's draft refused at line ④ by it, cfo_100's draft of a rule, and dsor-rates' sheet each leave one valid bundle", async () => {
    const w = await ruleWorldOnTuesday();
    const answers: Answer[] = [];
    answers.push(
      await w.ask(keyed(SUPERVISOR), "control.suspend", {
        target: "dsor://org_456/agent/accounts-payable-fte",
        reason: "the agent paid twice last week",
      }),
    );
    answers.push(
      await w.ask(keyed(AGENT), "payment.create", {
        invoice: "dsor://org_456/invoice/INV-1002",
        expected_version: 1,
      }),
    );
    answers.push(
      await w.ask(keyed(CFO), "rule.draft", {
        rule: "dsor://org_456/rule/high-value-payment",
        draft: textOf(version9()),
        reason: "the board lowered the line to 20,000 USD",
      }),
    );
    answers.push(
      await w.ask(keyed({ token: "tok_3b8f", tenant: "org_456" }), "rate.load", {
        company: "dsor://org_456/tenant/org_456",
        source: "ecb-daily",
        base: "EUR",
        published_at: "2026-10-06T14:30:00Z",
        rates: { USD: "1.0810", GBP: "0.8530", PKR: "302.50" },
      }),
    );
    expect(
      answers.map((a) => ("code" in a ? a.code : "outcome" in a ? a.outcome : undefined)),
    ).toStrictEqual(["COMMITTED", "AGENT_SUSPENDED", "COMMITTED", "COMMITTED"]);
    const files = await filesOf(w);
    expect(files.map((f) => f.bundle?.operation)).toStrictEqual([
      "control.suspend@1",
      "payment.create@1",
      "rule.draft@1",
      "rate.load@1",
    ]);
    for (const { bundle } of files) expect(bundleProblems(bundle)).toStrictEqual([]);
    expect(files[1]!.bundle).toMatchObject({
      identity: { mode: "unattended", subject: "user_123" },
      authority: { delegation: "del_100", authorization: "DENY" },
      execution: { result: "not_executed" },
    });
    expect(files[3]!.bundle?.identity).toMatchObject({ mode: "direct", subject: "dsor-rates" });
  });

  it("DSOR-AUD-03a: the log refuses a bundle that does not validate, and keeps neither it nor its record", async () => {
    const w = await ruleWorldOnTuesday();
    await w.draft("INV-1008");
    const { record, bundle } = (await filesOf(w))[0]!;
    const { record_id: _id, sequence: _n, at: _at, ...decision } = record;
    const { sealed_at: _sealed, ...unsealed } = bundle!;
    const log = createLog();
    const wrong = { ...unsealed, sod_mode: "relaxed" };
    await expect(log.add(decision as Decision, wrong as never)).rejects.toThrow(/sod_mode/);
    expect(await log.records()).toStrictEqual([]);
    expect(await log.bundles()).toStrictEqual([]);
  });

  it("DSOR-AUD-03a: the log refuses a record that names another bundle than the one it is given, or a bundle it is not given", async () => {
    const w = await ruleWorldOnTuesday();
    await w.draft("INV-1008");
    const { record, bundle } = (await filesOf(w))[0]!;
    const { record_id: _id, sequence: _n, at: _at, ...decision } = record;
    const { sealed_at: _sealed, ...unsealed } = bundle!;
    const log = createLog();
    const other = { ...decision, decision_bundle: "dec_00000000-0000-4000-8000-000000000000" };
    await expect(log.add(other as Decision, unsealed as never)).rejects.toThrow(/names/);
    await expect(log.add(decision as Decision)).rejects.toThrow(/names/);
    expect(await log.records()).toStrictEqual([]);
    expect(await log.bundles()).toStrictEqual([]);
  });
});

describe("C2: a bundle names the facts of its decision (step 33's README, D4 and D9)", () => {
  it("DSOR-AUD-03a: the agent's draft names who asked: unattended, user_123 through accounts-payable-fte, as of the directory's answer, under del_100, and the call's own request id", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.draft("INV-1008");
    const bundle = await lastBundle(w);
    const { record } = (await filesOf(w))[0]!;
    expect(bundle).toMatchObject({
      operation: "payment.create@1",
      tenant: "org_456",
      proposal: proposalOf(answer).uri,
      identity: {
        mode: "unattended",
        subject: "user_123",
        actor_chain: ["accounts-payable-fte"],
        subject_authority: {
          source: "role_source",
          as_of: record.identity!.subject_authority.as_of,
        },
      },
      authority: { delegation: "del_100", authorization: "ALLOW" },
      sod_mode: "standard",
    });
    expect(bundle.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      correlation: answer.correlation,
      answer: { result: "PENDING_APPROVAL" },
      invocation_mode: "execute",
    });
  });

  it("DSOR-VER-01c: the bundle names each rule line ⑩ evaluated, by id and version, with its answer and the policy it cites", async () => {
    const w = await ruleWorldOnTuesday();
    await w.draft("INV-1008");
    expect((await lastBundle(w)).authority.controls).toStrictEqual([
      {
        id: "high-value-payment",
        version: 8,
        outcome: "REQUIRE_APPROVAL",
        authority: {
          system: "ksor",
          uri: "ksor://org_456/finance/payment-approval-policy",
          rule: "high-value-payment",
          version: 4,
          content_hash: "sha256:9f2c1e7ab4d0",
        },
      },
    ]);
  });

  // Changed in step 45: her authority comes from her company's lookup, which line ② asked
  //   (step 45's README, C2).
  it("DSOR-AUD-03a: a person's own call names the person, in direct mode, with the role source's answer, under no slip: cfo_100's approval is committed", async () => {
    const w = await ruleWorldOnTuesday();
    await approved(w);
    const bundle = await lastBundle(w);
    expect(bundle).toMatchObject({
      operation: "proposal.approve@1",
      identity: {
        mode: "direct",
        subject: "cfo_100",
        actor_chain: [],
        subject_authority: { source: "role_source" },
      },
      authority: { authorization: "ALLOW", controls: [] },
      execution: { result: "committed", semantics: "atomic" },
    });
    expect(bundle.authority).not.toHaveProperty("delegation");
  });

  // And her move to APPROVED names it too. Found by piece 5's breaks: no test read
  // the move's own record (step 45's README, C2).
  it("C2: cfo_100's move to APPROVED names her company's role source as her authority", async () => {
    const w = await ruleWorldOnTuesday();
    await approved(w);
    const moves = (await w.proposals.transitions()).filter((move) => move.result === "APPROVED");
    expect(moves).toMatchObject([
      {
        identity: {
          mode: "direct",
          subject: "cfo_100",
          subject_authority: { source: "role_source" },
        },
      },
    ]);
  });

  it("DSOR-AUD-03a: user_123's draft of INV-1005, a draft invoice, says DENY and not_executed, names its DENIED proposal as the key of its execution, and keeps the answer and its reason", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.draft("INV-1005", SUPERVISOR);
    expect(answer).toMatchObject({ code: "CONFLICT" });
    const bundle = await lastBundle(w);
    const { uri, id } = proposalOf(answer);
    expect((await w.proposals.get("org_456", id))?.state).toBe("DENIED");
    expect(bundle).toMatchObject({
      proposal: uri,
      authority: { authorization: "DENY" },
      execution: { result: "not_executed", semantics: "compensatable", idempotency_key: id },
    });
    expect(bundle.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      answer: {
        result: "CONFLICT",
        reason: 'a precondition of payment.create does not hold: state.invoice.status == "issued"',
      },
    });
  });

  it("DSOR-AUD-03a: user_123's draft of INV-1002 is committed, and the key of its execution is its proposal's id, with the caller's own key beside it", async () => {
    const w = await ruleWorldOnTuesday();
    const who = keyed(SUPERVISOR);
    const answer = await w.ask(who, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1002",
      expected_version: 1,
    });
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    const bundle = await lastBundle(w);
    expect(bundle.execution).toStrictEqual({
      idempotency_key: proposalOf(answer).id,
      semantics: "compensatable",
      result: "committed",
    });
    expect(bundle.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      idempotency: { key: who.idempotency_key },
    });
  });

  // Found while building: a replay of a call that waits ran nothing either way, so only a replay of a
  //   payment drafted shows that a replay is not counted twice.
  it("DSOR-AUD-03a: user_123 sends the draft of INV-1002 again with its key: the replay is not_executed, so one payment has one committed bundle", async () => {
    const w = await ruleWorldOnTuesday();
    const who = keyed(SUPERVISOR);
    const input = { invoice: "dsor://org_456/invoice/INV-1002", expected_version: 1 };
    expect(await w.ask(who, "payment.create", input)).toMatchObject({ outcome: "COMMITTED" });
    expect(await w.ask(who, "payment.create", input)).toMatchObject({ outcome: "COMMITTED" });
    const results = (await w.log.bundles()).map((b) => b.execution.result);
    expect(results).toStrictEqual(["committed", "not_executed"]);
    expect(w.drafted).toHaveLength(1);
  });

  it("DSOR-AUD-03a: a cancel that the code refuses, because PAY-901 is cancelled already, is failed: the work ran and said no", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1002",
      expected_version: 1,
    });
    expect(drafted).toMatchObject({ outcome: "COMMITTED", data: { id: "PAY-901" } });
    const cancel = (version: number) =>
      w.ask(keyed(SUPERVISOR), "payment.cancel", {
        payment: "dsor://org_456/payment/PAY-901",
        expected_version: version,
      });
    expect(await cancel(1)).toMatchObject({ outcome: "COMMITTED" });
    expect((await lastBundle(w)).execution.result).toBe("committed");
    const again = await cancel(2);
    expect(again).toMatchObject({ code: "CONFLICT" });
    expect((await w.proposals.get("org_456", proposalOf(again).id))?.state).toBe("FAILED");
    expect((await lastBundle(w)).execution).toMatchObject({
      result: "failed",
      semantics: "atomic",
    });
  });

  it("DSOR-AUD-03a: a wait for the CFO, a dry run, a prepared proposal, and a replay are not_executed; a dry run names no proposal and no key of execution", async () => {
    const w = await ruleWorldOnTuesday();
    const first = keyed(AGENT);
    const inv = (id: string) => ({ invoice: `dsor://org_456/invoice/${id}`, expected_version: 1 });
    const results: unknown[] = [];
    await w.ask(first, "payment.create", inv("INV-1008"));
    results.push((await lastBundle(w)).execution.result);
    await w.ask({ ...SUPERVISOR, mode: "validate_only" }, "payment.create", inv("INV-1002"));
    const dry = await lastBundle(w);
    results.push(dry.execution.result);
    expect(dry).not.toHaveProperty("proposal");
    expect(dry.execution).not.toHaveProperty("idempotency_key");
    await w.ask(keyed({ ...SUPERVISOR, mode: "propose_only" }), "payment.create", inv("INV-1006"));
    results.push((await lastBundle(w)).execution.result);
    const replay = await w.ask(first, "payment.create", inv("INV-1008"));
    const replayed = await lastBundle(w);
    results.push(replayed.execution.result);
    expect(results).toStrictEqual(["not_executed", "not_executed", "not_executed", "not_executed"]);
    const firstRecord = (await w.log.records())[0]!;
    expect(replayed.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      idempotency: { key: first.idempotency_key, replay_of: firstRecord.correlation.request_id },
    });
    expect(replayed.proposal).toBe(proposalOf(replay).uri);
  });
});
