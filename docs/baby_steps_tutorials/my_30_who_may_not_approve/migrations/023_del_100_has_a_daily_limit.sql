-- NEW IN STEP 24: del_100 may spend 200,000.00 USD a day (DSOR-DEL-06a, decision 140).
--
-- As the specification's running example has it: 50,000.00 a payment, 200,000.00 a day. In a file
-- of its own, as 017 is, because the tests put the story back by running 014, 017 and this one.

SELECT set_config('dsor.tenant_id', 'org_456', true);

UPDATE dsor.delegations SET daily_limit_value = 200000.00, daily_limit_currency = 'USD'
 WHERE tenant = 'org_456' AND id = 'del_100';
