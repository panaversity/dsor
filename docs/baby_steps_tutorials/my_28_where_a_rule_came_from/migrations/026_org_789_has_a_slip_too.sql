-- NEW IN STEP 25: org_789 has a del_100 of its own (decision 142).
--
-- The cross-tenant suite asks every operation's example with the other company's address, and
-- checks that the other company holds a row of the same number, in the same state, that a careless
-- command could touch: org_789 holds an INV-1008, an INV-1009 and a PAY-901 for that reason.
-- delegation.revoke names del_100, so org_789 holds one too. It is signed by user_789, nobody this
-- program serves, for an agent of org_789's own, so that accounts-payable-fte still has no slip in
-- org_789, which other tests depend on.

SELECT set_config('dsor.tenant_id', 'org_789', true);

INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions,
                              per_transaction_limit_value, per_transaction_limit_currency,
                              status, expires_at)
VALUES ('org_789', 'del_100', 'user_789', 'payables-bot-789',
        ARRAY['payment:create'],
        5000.00, 'USD', 'active', '2099-12-31T23:59:59Z')
ON CONFLICT (tenant, id) DO NOTHING;
