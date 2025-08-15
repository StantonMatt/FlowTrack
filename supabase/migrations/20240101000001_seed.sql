-- ============================================
-- SEED DATA FOR DEVELOPMENT
-- ============================================

-- Insert sample tenant
INSERT INTO tenants (id, name, subdomain, settings, billing_settings, branding)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'Acme Water Utility',
    'acme',
    '{"timezone": "America/New_York", "currency": "USD", "locale": "en-US"}',
    '{"billing_cycle": "monthly", "payment_terms": 30, "late_fee_percentage": 1.5}',
    '{"primary_color": "#0066CC", "logo_url": "/logo.png", "company_address": "123 Main St, Springfield, IL 62701"}'
);

-- Insert sample users with different roles
INSERT INTO users (id, tenant_id, email, full_name, role, auth_user_id)
VALUES 
    ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin@acme.com', 'John Admin', 'admin', NULL),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'manager@acme.com', 'Jane Manager', 'manager', NULL),
    ('b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'operator@acme.com', 'Bob Operator', 'operator', NULL),
    ('b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'viewer@acme.com', 'Alice Viewer', 'viewer', NULL);

-- Insert sample rate plans
INSERT INTO rate_plans (id, tenant_id, name, code, description, base_charge, tax_rate, tiers)
VALUES 
    ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'Residential Standard', 'RES-STD', 'Standard residential water rate', 
     15.00, 0.0875,
     '[
         {"min": 0, "max": 1000, "rate": 0.003, "description": "First 1000 gallons"},
         {"min": 1001, "max": 5000, "rate": 0.004, "description": "Next 4000 gallons"},
         {"min": 5001, "max": null, "rate": 0.005, "description": "Over 5000 gallons"}
     ]'::jsonb),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'Commercial Standard', 'COM-STD', 'Standard commercial water rate', 
     50.00, 0.0875,
     '[
         {"min": 0, "max": 5000, "rate": 0.0025, "description": "First 5000 gallons"},
         {"min": 5001, "max": 20000, "rate": 0.0035, "description": "Next 15000 gallons"},
         {"min": 20001, "max": null, "rate": 0.0045, "description": "Over 20000 gallons"}
     ]'::jsonb);

-- Insert sample customers
INSERT INTO customers (id, tenant_id, account_number, email, full_name, phone, status, meter_id, meter_type, rate_plan, billing_address, service_address)
VALUES 
    ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'ACME-000001', 'john.smith@email.com', 'John Smith', '555-0101', 'active', 
     'MTR-001', 'water', 'RES-STD',
     '{"street": "456 Oak Ave", "city": "Springfield", "state": "IL", "zip": "62701", "country": "USA"}',
     '{"street": "456 Oak Ave", "city": "Springfield", "state": "IL", "zip": "62701", "country": "USA"}'),
    
    ('d1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'ACME-000002', 'mary.johnson@email.com', 'Mary Johnson', '555-0102', 'active', 
     'MTR-002', 'water', 'RES-STD',
     '{"street": "789 Pine St", "city": "Springfield", "state": "IL", "zip": "62702", "country": "USA"}',
     '{"street": "789 Pine St", "city": "Springfield", "state": "IL", "zip": "62702", "country": "USA"}'),
    
    ('d2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'ACME-000003', 'business@email.com', 'Springfield Bakery', '555-0103', 'active', 
     'MTR-003', 'water', 'COM-STD',
     '{"street": "123 Business Blvd", "city": "Springfield", "state": "IL", "zip": "62703", "country": "USA"}',
     '{"street": "123 Business Blvd", "city": "Springfield", "state": "IL", "zip": "62703", "country": "USA"}'),
    
    ('d3eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'ACME-000004', 'robert.wilson@email.com', 'Robert Wilson', '555-0104', 'inactive', 
     'MTR-004', 'water', 'RES-STD',
     '{"street": "321 Elm Dr", "city": "Springfield", "state": "IL", "zip": "62704", "country": "USA"}',
     '{"street": "321 Elm Dr", "city": "Springfield", "state": "IL", "zip": "62704", "country": "USA"}');

-- Insert sample meter readings
INSERT INTO meter_readings (tenant_id, customer_id, meter_id, reading, previous_reading, reading_date, reading_type, status, recorded_by)
VALUES 
    -- John Smith readings
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'MTR-001', 1000, NULL, '2024-11-01 10:00:00', 'manual', 'confirmed', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'MTR-001', 1750, 1000, '2024-12-01 10:00:00', 'manual', 'confirmed', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'MTR-001', 2600, 1750, '2025-01-01 10:00:00', 'manual', 'confirmed', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    
    -- Mary Johnson readings
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'MTR-002', 500, NULL, '2024-11-01 11:00:00', 'manual', 'confirmed', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'MTR-002', 1100, 500, '2024-12-01 11:00:00', 'manual', 'confirmed', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'MTR-002', 1800, 1100, '2025-01-01 11:00:00', 'manual', 'confirmed', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    
    -- Springfield Bakery readings
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'MTR-003', 10000, NULL, '2024-11-01 09:00:00', 'manual', 'confirmed', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'MTR-003', 18500, 10000, '2024-12-01 09:00:00', 'manual', 'confirmed', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'MTR-003', 27200, 18500, '2025-01-01 09:00:00', 'manual', 'confirmed', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

-- Insert sample invoices
INSERT INTO invoices (tenant_id, customer_id, invoice_number, period_start, period_end, consumption, subtotal, tax_amount, total_amount, status, issued_at, due_date, line_items)
VALUES 
    -- John Smith December invoice
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
     'INV-2024-000001', '2024-11-01', '2024-11-30', 750,
     18.00, 1.58, 19.58, 'paid', '2024-12-01 12:00:00', '2024-12-31',
     '[
         {"description": "Base Charge", "amount": 15.00},
         {"description": "Water Usage (750 gallons @ $0.003/gal)", "amount": 2.25}
     ]'::jsonb),
    
    -- Mary Johnson December invoice
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
     'INV-2024-000002', '2024-11-01', '2024-11-30', 600,
     16.80, 1.47, 18.27, 'paid', '2024-12-01 12:00:00', '2024-12-31',
     '[
         {"description": "Base Charge", "amount": 15.00},
         {"description": "Water Usage (600 gallons @ $0.003/gal)", "amount": 1.80}
     ]'::jsonb),
    
    -- Springfield Bakery December invoice
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
     'INV-2024-000003', '2024-11-01', '2024-11-30', 8500,
     68.75, 6.02, 74.77, 'sent', '2024-12-01 12:00:00', '2024-12-31',
     '[
         {"description": "Base Charge", "amount": 50.00},
         {"description": "Water Usage - Tier 1 (5000 gallons @ $0.0025/gal)", "amount": 12.50},
         {"description": "Water Usage - Tier 2 (3500 gallons @ $0.0035/gal)", "amount": 12.25}
     ]'::jsonb);

-- Insert sample anomaly rules
INSERT INTO anomaly_rules (tenant_id, name, rule_type, parameters, is_active)
VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'High Usage Alert', 'threshold', 
     '{"threshold": 10000, "comparison": "greater_than", "message": "Usage exceeds 10,000 gallons"}', true),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Sudden Increase', 'percentage_change', 
     '{"percentage": 50, "comparison": "increase", "message": "Usage increased by more than 50%"}', true),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Zero Usage', 'threshold', 
     '{"threshold": 0, "comparison": "equals", "message": "No usage detected"}', true);

-- Initialize invoice sequences for the tenant
INSERT INTO invoice_sequences (tenant_id, prefix, year, current_value)
VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'INV', 2024, 3),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'INV', 2025, 0);

-- Insert sample audit logs
INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'CREATE', 'customer', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     '{"full_name": "John Smith", "account_number": "ACME-000001"}', '192.168.1.1'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 
     'CREATE', 'meter_reading', NULL, 
     '{"customer": "John Smith", "reading": 2600}', '192.168.1.2');

-- Create a test tenant for multi-tenancy testing
INSERT INTO tenants (id, name, subdomain, settings)
VALUES (
    'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'Test Water Company',
    'testwater',
    '{"timezone": "America/Chicago", "currency": "USD", "locale": "en-US"}'
);

-- Insert a user for the test tenant
INSERT INTO users (tenant_id, email, full_name, role)
VALUES 
    ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin@testwater.com', 'Test Admin', 'admin');

-- Insert a customer for the test tenant (to verify tenant isolation)
INSERT INTO customers (tenant_id, account_number, email, full_name, phone, status, meter_id, meter_type)
VALUES 
    ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'TEST-000001', 'test@customer.com', 
     'Test Customer', '555-9999', 'active', 'MTR-TEST-001', 'water');