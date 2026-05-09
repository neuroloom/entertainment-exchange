-- Seed default chart of accounts for new businesses
-- Called by business creation logic as reference data
-- Account codes match DEFAULT_CHART_OF_ACCOUNTS in apps/api/src/routes/business.ts

INSERT INTO ledger_accounts (id, tenant_id, business_id, code, name, account_type, currency)
SELECT
  gen_random_uuid(),
  tenant_id,
  id AS business_id,
  '1000',
  'Cash / Stripe Clearing',
  'asset',
  'USD'
FROM business_entities
WHERE status = 'active'
ON CONFLICT DO NOTHING;

INSERT INTO ledger_accounts (id, tenant_id, business_id, code, name, account_type, currency)
SELECT
  gen_random_uuid(),
  tenant_id,
  id AS business_id,
  '2000',
  'Deferred Revenue',
  'liability',
  'USD'
FROM business_entities
WHERE status = 'active'
ON CONFLICT DO NOTHING;

INSERT INTO ledger_accounts (id, tenant_id, business_id, code, name, account_type, currency)
SELECT
  gen_random_uuid(),
  tenant_id,
  id AS business_id,
  '2100',
  'Artist/Vendor Payable',
  'liability',
  'USD'
FROM business_entities
WHERE status = 'active'
ON CONFLICT DO NOTHING;

INSERT INTO ledger_accounts (id, tenant_id, business_id, code, name, account_type, currency)
SELECT
  gen_random_uuid(),
  tenant_id,
  id AS business_id,
  '4000',
  'Booking Revenue',
  'revenue',
  'USD'
FROM business_entities
WHERE status = 'active'
ON CONFLICT DO NOTHING;

INSERT INTO ledger_accounts (id, tenant_id, business_id, code, name, account_type, currency)
SELECT
  gen_random_uuid(),
  tenant_id,
  id AS business_id,
  '4100',
  'Commission Revenue',
  'revenue',
  'USD'
FROM business_entities
WHERE status = 'active'
ON CONFLICT DO NOTHING;

INSERT INTO ledger_accounts (id, tenant_id, business_id, code, name, account_type, currency)
SELECT
  gen_random_uuid(),
  tenant_id,
  id AS business_id,
  '5000',
  'Provider Fees',
  'expense',
  'USD'
FROM business_entities
WHERE status = 'active'
ON CONFLICT DO NOTHING;
