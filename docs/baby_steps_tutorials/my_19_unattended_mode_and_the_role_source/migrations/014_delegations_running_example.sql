-- NEW IN STEP 18: the running example's permission slip, del_100 (decision 127).
--
-- user_123 lets accounts-payable-fte issue invoices and make and cancel payments, up to 50,000.00
-- USD each. The specification's del_100 grants invoice:read, vendor:read, payment:create and
-- payment:execute. Both grant payment:create. This one leaves out invoice:read, because the agent's
-- own role reads and a slip is for commands; vendor:read and payment:execute, because this program
-- has neither operation yet; and it adds invoice:issue and payment:cancel, the commands it has
-- besides (decision 128). Its modes, daily total, counterparties and hours come in later steps.
-- And the specification's expires at the end of 2026: this one at the end of 2099, so that the
-- tutorial does not stop working on 1 January 2027. The tests that need an expired slip make one.
--
-- The file says its company first, for an owner the lock holds: 013 forces the lock on the table's
-- owner, and a row written with no company said would fail the policy's WITH CHECK. PGlite's owner
-- and Neon's skip row-level security altogether, so no test shows the line is needed. The tests
-- put the story back by running this file again, which is why it says ON CONFLICT DO NOTHING.

SELECT set_config('dsor.tenant_id', 'org_456', true);

INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions,
                              per_transaction_limit_value, per_transaction_limit_currency,
                              status, expires_at)
VALUES ('org_456', 'del_100', 'user_123', 'accounts-payable-fte',
        ARRAY['invoice:issue', 'payment:create', 'payment:cancel'],
        50000.00, 'USD', 'active', '2099-12-31T23:59:59Z')
ON CONFLICT (tenant, id) DO NOTHING;
