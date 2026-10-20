-- NEW IN STEP 27: org_456's policy, "Payments above 25,000 USD or equivalent require CFO
-- approval" (KSoR, finance/payment-approval-policy, version 4), as a control (decision 162).
--
-- It governs payment.create, where the agent commits to an amount, and it arrives waiting for
-- review: switching it on runs its five test cases first, and refuses if one fails (DSOR-CTL-02c).
-- The test cases are the specification's, read from `input` instead of `state`, with the rates
-- each one assumes pinned beside it (DSOR-CTL-02e). org_789 has no controls.

SELECT set_config('dsor.tenant_id', 'org_456', true);

INSERT INTO dsor.controls (tenant, id, version, operation, status, record)
VALUES ('org_456', 'high-value-payment', 8, 'payment.create', 'in_review', $control$
{
  "id": "high-value-payment",
  "version": 8,
  "operation": "payment.create",
  "condition": "dsor_exceeds(input.amount, dsor_money(\"25000\", \"USD\"))",
  "effect": { "require_approval": { "role": "CFO", "quorum": 1 } },
  "authority": {
    "system": "ksor",
    "uri": "ksor://org_456/finance/payment-approval-policy",
    "rule": "high-value-payment",
    "version": 4,
    "content_hash": "sha256:9f2c1e7ab4d0"
  },
  "owner": "cfo_100",
  "compiled_by": "user_123",
  "reviewed_by": "cfo_100",
  "on_stale": "require_approval",
  "stale_grace": "P7D",
  "effective_from": "2026-09-01T00:00:00Z",
  "tests": [
    { "input": { "amount": { "value": "25000.00", "currency": "USD" } }, "expect": "ALLOW" },
    { "input": { "amount": { "value": "25000.01", "currency": "USD" } }, "expect": "REQUIRE_APPROVAL" },
    { "input": { "amount": { "value": "50000000.00", "currency": "PKR" } }, "rates": { "PKR": "280" },
      "expect": "REQUIRE_APPROVAL" },
    { "input": { "amount": { "value": "6000000.00", "currency": "PKR" } }, "rates": { "PKR": "280" },
      "expect": "ALLOW" },
    { "input": { "amount": { "value": "100.00", "currency": "XXX" } }, "expect": "REQUIRE_APPROVAL" }
  ]
}
$control$::jsonb)
ON CONFLICT (tenant, id, version) DO NOTHING;
