-- NEW IN STEP 28: org_789 has a high-value-payment control of its own, waiting for review
-- (decision 165).
--
-- control.activate names a control by its address, and step 12's cross-tenant suite asks every
-- command whether, sent with org_789's address, it could touch org_789's row of the same name. With
-- no such row, a careless control.activate would leave org_789 untouched for want of anything to
-- touch, and the suite would pass for the wrong reason, as decision 142 found for slips. This one is
-- org_789's own: its own policy's address, and its own owner, user_789, nobody this program's
-- people include. It stays in review, and nothing in the story switches it on.

SELECT set_config('dsor.tenant_id', 'org_789', true);

INSERT INTO dsor.controls (tenant, id, version, operation, status, record)
VALUES ('org_789', 'high-value-payment', 8, 'payment.create', 'in_review', $control$
{
  "id": "high-value-payment",
  "version": 8,
  "operation": "payment.create",
  "condition": "dsor_exceeds(input.amount, dsor_money(\"25000\", \"USD\"))",
  "effect": { "require_approval": { "role": "CFO", "quorum": 1 } },
  "authority": {
    "system": "ksor",
    "uri": "ksor://org_789/finance/payment-approval-policy",
    "rule": "high-value-payment",
    "version": 4,
    "content_hash": "sha256:9f2c1e7ab4d0"
  },
  "owner": "user_789",
  "compiled_by": "user_789",
  "reviewed_by": "user_789",
  "on_stale": "require_approval",
  "stale_grace": "P7D",
  "effective_from": "2026-09-01T00:00:00Z",
  "tests": [
    { "input": { "amount": { "value": "25000.00", "currency": "USD" } }, "expect": "ALLOW" },
    { "input": { "amount": { "value": "25000.01", "currency": "USD" } }, "expect": "REQUIRE_APPROVAL" }
  ]
}
$control$::jsonb)
ON CONFLICT (tenant, id, version) DO NOTHING;
