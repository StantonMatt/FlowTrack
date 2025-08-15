-- Create demo tenant
INSERT INTO tenants (id, name, subdomain, is_active, settings, branding, created_at, updated_at)
VALUES (
  'demo-tenant-id',
  'Demo Water Company',
  'demo',
  true,
  jsonb_build_object(
    'billingCycle', 1,
    'timezone', 'America/Los_Angeles',
    'currency', 'USD',
    'taxRate', 0.08
  ),
  jsonb_build_object(
    'primary_color', '#0066CC',
    'secondary_color', '#00AA55',
    'logo_url', '/demo-logo.png'
  ),
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Create demo customers
INSERT INTO customers (id, tenant_id, account_number, name, email, phone, service_address, billing_address, is_active, created_at, updated_at)
VALUES 
  (
    gen_random_uuid(),
    'demo-tenant-id',
    'ACC-001',
    'John Doe',
    'john.doe@example.com',
    '555-0101',
    jsonb_build_object('street', '123 Main St', 'city', 'Springfield', 'state', 'CA', 'zip', '90210'),
    jsonb_build_object('street', '123 Main St', 'city', 'Springfield', 'state', 'CA', 'zip', '90210'),
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'demo-tenant-id',
    'ACC-002',
    'Jane Smith',
    'jane.smith@example.com',
    '555-0102',
    jsonb_build_object('street', '456 Oak Ave', 'city', 'Springfield', 'state', 'CA', 'zip', '90210'),
    jsonb_build_object('street', '456 Oak Ave', 'city', 'Springfield', 'state', 'CA', 'zip', '90210'),
    true,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'demo-tenant-id',
    'ACC-003',
    'Bob Johnson',
    'bob.johnson@example.com',
    '555-0103',
    jsonb_build_object('street', '789 Pine Rd', 'city', 'Springfield', 'state', 'CA', 'zip', '90210'),
    jsonb_build_object('street', '789 Pine Rd', 'city', 'Springfield', 'state', 'CA', 'zip', '90210'),
    true,
    NOW(),
    NOW()
  )
ON CONFLICT DO NOTHING;

-- Create demo rate plan
INSERT INTO rate_plans (id, tenant_id, name, currency, tax_rate, active, effective_from, created_at)
VALUES (
  gen_random_uuid(),
  'demo-tenant-id',
  'Standard Residential',
  'USD',
  0.08,
  true,
  NOW() - INTERVAL '1 year',
  NOW()
) ON CONFLICT DO NOTHING;

-- Add rate tiers for the plan
WITH plan AS (
  SELECT id FROM rate_plans WHERE tenant_id = 'demo-tenant-id' LIMIT 1
)
INSERT INTO rate_tiers (id, rate_plan_id, tier_index, from_qty, up_to_qty, price_per_unit)
SELECT 
  gen_random_uuid(),
  plan.id,
  tier_index,
  from_qty,
  up_to_qty,
  price_per_unit
FROM plan, (VALUES
  (1, 0, 1000, 0.003),     -- First 1000 gallons at $3/1000 gal
  (2, 1000, 5000, 0.004),  -- Next 4000 gallons at $4/1000 gal
  (3, 5000, 10000, 0.005), -- Next 5000 gallons at $5/1000 gal
  (4, 10000, NULL, 0.006)  -- Above 10000 gallons at $6/1000 gal
) AS tiers(tier_index, from_qty, up_to_qty, price_per_unit)
WHERE NOT EXISTS (
  SELECT 1 FROM rate_tiers WHERE rate_plan_id = plan.id
);

-- Create some demo meter readings
WITH customers AS (
  SELECT id, account_number FROM customers WHERE tenant_id = 'demo-tenant-id'
)
INSERT INTO meter_readings (id, tenant_id, customer_id, reading_date, previous_reading, current_reading, consumption, status, created_at, updated_at)
SELECT
  gen_random_uuid(),
  'demo-tenant-id',
  c.id,
  date_trunc('day', NOW() - (row_number() OVER (PARTITION BY c.id ORDER BY generate_series) * INTERVAL '30 days')),
  10000 + (row_number() OVER (PARTITION BY c.id ORDER BY generate_series) - 1) * 300,
  10000 + row_number() OVER (PARTITION BY c.id ORDER BY generate_series) * 300,
  300,
  'verified',
  NOW(),
  NOW()
FROM customers c
CROSS JOIN generate_series(1, 3) -- 3 months of readings per customer
WHERE NOT EXISTS (
  SELECT 1 FROM meter_readings WHERE customer_id = c.id
);

-- Create some demo invoices
WITH customers AS (
  SELECT id FROM customers WHERE tenant_id = 'demo-tenant-id'
)
INSERT INTO invoices (
  id, tenant_id, customer_id, invoice_number, period_start, period_end,
  subtotal, tax, total, currency, status, due_date, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'demo-tenant-id',
  c.id,
  '2025-' || LPAD((row_number() OVER ())::text, 4, '0'),
  date_trunc('month', NOW() - (generate_series * INTERVAL '1 month')),
  date_trunc('month', NOW() - ((generate_series - 1) * INTERVAL '1 month')) - INTERVAL '1 day',
  45.00 + (random() * 20)::numeric(10,2),
  (45.00 + (random() * 20)::numeric(10,2)) * 0.08,
  (45.00 + (random() * 20)::numeric(10,2)) * 1.08,
  'USD',
  CASE 
    WHEN generate_series = 1 THEN 'sent'
    WHEN generate_series = 2 THEN 'paid'
    ELSE 'overdue'
  END,
  date_trunc('month', NOW() - ((generate_series - 1) * INTERVAL '1 month')) + INTERVAL '15 days',
  NOW(),
  NOW()
FROM customers c
CROSS JOIN generate_series(1, 2) -- 2 invoices per customer
WHERE NOT EXISTS (
  SELECT 1 FROM invoices WHERE customer_id = c.id
);

-- Note: We cannot create auth.users directly via SQL
-- The demo user needs to be created via Supabase Auth Admin API
-- or by using the signup flow