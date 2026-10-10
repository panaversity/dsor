-- NEW IN STEP 18: the running example's permission slip, del_100 (decision 127).
--
-- user_123 lets accounts-payable-fte issue invoices and make and cancel payments, up to 50,000.00
-- USD each. The specification's del_100 also names payment:execute and vendor:read; this program has
-- neither yet, and a slip grants only what exists. And the specification's expires at the end of
-- 2026: this one at the end of 2099, so that the tutorial does not stop working on 1 January 2027.
-- The tests that need an expired slip make one.
--
-- After the lock, so this file says its company first: the lock holds the owner too, because 013
-- forces it, and a row written with no company said would fail the policy's WITH CHECK. The tests
-- put the story back by running this file again, which is why it says ON CONFLICT DO NOTHING.

SELECT set_config('dsor.tenant_id', 'org_456', true);

INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions,
                              per_transaction_limit_value, per_transaction_limit_currency,
                              status, expires_at)
VALUES ('org_456', 'del_100', 'user_123', 'accounts-payable-fte',
        ARRAY['invoice:issue', 'payment:create', 'payment:cancel'],
        50000.00, 'USD', 'active', '2099-12-31T23:59:59Z')
ON CONFLICT (tenant, id) DO NOTHING;
