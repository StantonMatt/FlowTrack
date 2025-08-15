-- Billing cycles and configurations
CREATE TABLE billing_cycles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'bimonthly', 'quarterly', 'annually')),
  billing_day INTEGER CHECK (billing_day BETWEEN 1 AND 31),
  due_days INTEGER DEFAULT 30 CHECK (due_days > 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_active_cycle_per_tenant 
    UNIQUE(tenant_id, is_active) WHERE is_active = true
);

-- Rate structures for billing
CREATE TABLE rate_structures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  rate_type TEXT NOT NULL CHECK (rate_type IN ('flat', 'tiered', 'seasonal', 'time_of_use')),
  base_rate DECIMAL(10,4) NOT NULL CHECK (base_rate >= 0),
  currency TEXT DEFAULT 'USD',
  effective_from TIMESTAMPTZ DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT no_overlapping_rates EXCLUDE USING gist (
    tenant_id WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (effective_to IS NOT NULL)
);

-- Tiered rate details
CREATE TABLE rate_tiers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rate_structure_id UUID NOT NULL REFERENCES rate_structures(id) ON DELETE CASCADE,
  tier_start DECIMAL(12,3) NOT NULL CHECK (tier_start >= 0),
  tier_end DECIMAL(12,3),
  rate DECIMAL(10,4) NOT NULL CHECK (rate >= 0),
  description TEXT,
  
  CONSTRAINT valid_tier_range CHECK (
    tier_end IS NULL OR tier_end > tier_start
  ),
  CONSTRAINT unique_tier_ranges UNIQUE(rate_structure_id, tier_start)
);

-- Billing periods
CREATE TABLE billing_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_cycle_id UUID NOT NULL REFERENCES billing_cycles(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_date DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
  total_customers INTEGER DEFAULT 0,
  total_invoices INTEGER DEFAULT 0,
  total_amount DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_period CHECK (period_end > period_start),
  CONSTRAINT unique_period_per_cycle UNIQUE(billing_cycle_id, period_start, period_end)
);

-- Invoices
CREATE TABLE invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  billing_period_id UUID REFERENCES billing_periods(id),
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'sent', 'paid', 'overdue', 'cancelled', 'void')),
  
  -- Billing details
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  previous_reading_id UUID REFERENCES meter_readings(id),
  current_reading_id UUID REFERENCES meter_readings(id),
  previous_reading DECIMAL(12,3),
  current_reading DECIMAL(12,3),
  consumption DECIMAL(12,3),
  
  -- Amounts
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(12,2) DEFAULT 0,
  balance_due DECIMAL(12,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  
  -- Payment tracking
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  transaction_reference TEXT,
  
  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  
  CONSTRAINT unique_invoice_number UNIQUE(tenant_id, invoice_number)
);

-- Invoice line items
CREATE TABLE invoice_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('consumption', 'fee', 'tax', 'discount', 'adjustment', 'credit')),
  description TEXT NOT NULL,
  quantity DECIMAL(12,3) DEFAULT 1,
  unit_price DECIMAL(10,4),
  amount DECIMAL(12,2) NOT NULL,
  tax_rate DECIMAL(5,2) DEFAULT 0,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  
  CONSTRAINT unique_line_number UNIQUE(invoice_id, line_number)
);

-- Payments
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'check', 'card', 'bank_transfer', 'online', 'other')),
  reference_number TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  processor TEXT, -- e.g., 'stripe', 'manual', etc.
  processor_fee DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment allocations (for partial payments or credits)
CREATE TABLE payment_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_payment_invoice UNIQUE(payment_id, invoice_id)
);

-- Billing templates for recurring charges
CREATE TABLE billing_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  template_type TEXT NOT NULL CHECK (template_type IN ('water', 'sewer', 'garbage', 'stormwater', 'other')),
  is_active BOOLEAN DEFAULT true,
  rate_structure_id UUID REFERENCES rate_structures(id),
  fixed_charges JSONB DEFAULT '[]', -- Array of fixed charge items
  tax_rate DECIMAL(5,2) DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer billing preferences
CREATE TABLE customer_billing_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  billing_cycle_id UUID REFERENCES billing_cycles(id),
  billing_template_id UUID REFERENCES billing_templates(id),
  paperless BOOLEAN DEFAULT false,
  auto_pay BOOLEAN DEFAULT false,
  payment_method TEXT,
  notification_email TEXT,
  notification_phone TEXT,
  language_preference TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_customer_preferences UNIQUE(customer_id)
);

-- Indexes for performance
CREATE INDEX idx_billing_cycles_tenant_active ON billing_cycles(tenant_id, is_active);
CREATE INDEX idx_rate_structures_tenant_effective ON rate_structures(tenant_id, effective_from DESC);
CREATE INDEX idx_rate_tiers_structure ON rate_tiers(rate_structure_id, tier_start);
CREATE INDEX idx_billing_periods_tenant_status ON billing_periods(tenant_id, status);
CREATE INDEX idx_billing_periods_dates ON billing_periods(period_start, period_end);
CREATE INDEX idx_invoices_tenant_customer ON invoices(tenant_id, customer_id);
CREATE INDEX idx_invoices_status ON invoices(tenant_id, status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date) WHERE status NOT IN ('paid', 'cancelled', 'void');
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id, line_number);
CREATE INDEX idx_payments_tenant_customer ON payments(tenant_id, customer_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_payments_date ON payments(payment_date DESC);
CREATE INDEX idx_payment_allocations_invoice ON payment_allocations(invoice_id);

-- Enable RLS
ALTER TABLE billing_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_billing_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies for billing_cycles
CREATE POLICY "billing_cycles_tenant_isolation" ON billing_cycles
  FOR ALL USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "billing_cycles_admin_only" ON billing_cycles
  FOR ALL USING (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin'])
  );

-- RLS Policies for rate_structures
CREATE POLICY "rate_structures_tenant_isolation" ON rate_structures
  FOR SELECT USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "rate_structures_admin_only" ON rate_structures
  FOR ALL USING (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin'])
  );

-- RLS Policies for invoices
CREATE POLICY "invoices_tenant_isolation" ON invoices
  FOR SELECT USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "invoices_create_permission" ON invoices
  FOR INSERT WITH CHECK (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin', 'manager', 'office_clerk'])
  );

CREATE POLICY "invoices_update_permission" ON invoices
  FOR UPDATE USING (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin', 'manager', 'office_clerk'])
  );

CREATE POLICY "invoices_delete_permission" ON invoices
  FOR DELETE USING (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin'])
  );

-- RLS Policies for payments
CREATE POLICY "payments_tenant_isolation" ON payments
  FOR SELECT USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "payments_create_permission" ON payments
  FOR INSERT WITH CHECK (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin', 'manager', 'office_clerk'])
  );

CREATE POLICY "payments_update_permission" ON payments
  FOR UPDATE USING (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin', 'manager'])
  );

-- Apply same pattern for other tables
CREATE POLICY "rate_tiers_read" ON rate_tiers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rate_structures rs
      WHERE rs.id = rate_tiers.rate_structure_id
      AND rs.tenant_id = get_auth_tenant_id()
    )
  );

CREATE POLICY "billing_periods_tenant_isolation" ON billing_periods
  FOR ALL USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "invoice_items_read" ON invoice_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
      AND i.tenant_id = get_auth_tenant_id()
    )
  );

CREATE POLICY "payment_allocations_read" ON payment_allocations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM payments p
      WHERE p.id = payment_allocations.payment_id
      AND p.tenant_id = get_auth_tenant_id()
    )
  );

CREATE POLICY "billing_templates_tenant_isolation" ON billing_templates
  FOR ALL USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "customer_billing_preferences_read" ON customer_billing_preferences
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = customer_billing_preferences.customer_id
      AND c.tenant_id = get_auth_tenant_id()
    )
  );

-- Functions for billing calculations
CREATE OR REPLACE FUNCTION calculate_tiered_rate(
  p_rate_structure_id UUID,
  p_consumption DECIMAL(12,3)
)
RETURNS DECIMAL(12,2)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total_cost DECIMAL(12,2) := 0;
  v_remaining DECIMAL(12,3) := p_consumption;
  v_tier RECORD;
BEGIN
  FOR v_tier IN
    SELECT tier_start, tier_end, rate
    FROM rate_tiers
    WHERE rate_structure_id = p_rate_structure_id
    ORDER BY tier_start
  LOOP
    IF v_remaining <= 0 THEN
      EXIT;
    END IF;
    
    IF v_tier.tier_end IS NULL OR v_remaining <= (v_tier.tier_end - v_tier.tier_start) THEN
      v_total_cost := v_total_cost + (v_remaining * v_tier.rate);
      v_remaining := 0;
    ELSE
      v_total_cost := v_total_cost + ((v_tier.tier_end - v_tier.tier_start) * v_tier.rate);
      v_remaining := v_remaining - (v_tier.tier_end - v_tier.tier_start);
    END IF;
  END LOOP;
  
  RETURN v_total_cost;
END;
$$;

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number(
  p_tenant_id UUID,
  p_prefix TEXT DEFAULT 'INV'
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_year TEXT;
  v_month TEXT;
  v_sequence INTEGER;
  v_invoice_number TEXT;
BEGIN
  v_year := TO_CHAR(NOW(), 'YYYY');
  v_month := TO_CHAR(NOW(), 'MM');
  
  -- Get next sequence number for this month
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(invoice_number FROM LENGTH(p_prefix) + 8)
      AS INTEGER
    )
  ), 0) + 1
  INTO v_sequence
  FROM invoices
  WHERE tenant_id = p_tenant_id
    AND invoice_number LIKE p_prefix || v_year || v_month || '%';
  
  v_invoice_number := p_prefix || v_year || v_month || LPAD(v_sequence::TEXT, 4, '0');
  
  RETURN v_invoice_number;
END;
$$;

-- Trigger to update timestamps
CREATE TRIGGER update_billing_cycles_updated_at
  BEFORE UPDATE ON billing_cycles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_rate_structures_updated_at
  BEFORE UPDATE ON rate_structures
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_billing_periods_updated_at
  BEFORE UPDATE ON billing_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_billing_templates_updated_at
  BEFORE UPDATE ON billing_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_customer_billing_preferences_updated_at
  BEFORE UPDATE ON customer_billing_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Insert default billing data for demo tenant
INSERT INTO billing_cycles (
  tenant_id,
  name,
  frequency,
  billing_day,
  due_days,
  is_active
)
SELECT 
  id,
  'Monthly Billing',
  'monthly',
  1,
  30,
  true
FROM tenants
WHERE subdomain = 'demo'
  AND NOT EXISTS (
    SELECT 1 FROM billing_cycles bc 
    WHERE bc.tenant_id = tenants.id
  );

INSERT INTO rate_structures (
  tenant_id,
  name,
  description,
  rate_type,
  base_rate,
  currency
)
SELECT 
  id,
  'Standard Water Rate',
  'Default water consumption rate',
  'tiered',
  0,
  'USD'
FROM tenants
WHERE subdomain = 'demo'
  AND NOT EXISTS (
    SELECT 1 FROM rate_structures rs 
    WHERE rs.tenant_id = tenants.id
  );

-- Insert default tiers for demo rate structure
INSERT INTO rate_tiers (rate_structure_id, tier_start, tier_end, rate, description)
SELECT 
  rs.id,
  0,
  1000,
  0.0035,
  'Basic usage (0-1000 gallons)'
FROM rate_structures rs
JOIN tenants t ON t.id = rs.tenant_id
WHERE t.subdomain = 'demo'
  AND NOT EXISTS (
    SELECT 1 FROM rate_tiers rt 
    WHERE rt.rate_structure_id = rs.id
  );

INSERT INTO rate_tiers (rate_structure_id, tier_start, tier_end, rate, description)
SELECT 
  rs.id,
  1000,
  5000,
  0.0045,
  'Normal usage (1000-5000 gallons)'
FROM rate_structures rs
JOIN tenants t ON t.id = rs.tenant_id
WHERE t.subdomain = 'demo'
  AND NOT EXISTS (
    SELECT 1 FROM rate_tiers rt 
    WHERE rt.rate_structure_id = rs.id
    AND rt.tier_start = 1000
  );

INSERT INTO rate_tiers (rate_structure_id, tier_start, tier_end, rate, description)
SELECT 
  rs.id,
  5000,
  NULL,
  0.0055,
  'High usage (5000+ gallons)'
FROM rate_structures rs
JOIN tenants t ON t.id = rs.tenant_id
WHERE t.subdomain = 'demo'
  AND NOT EXISTS (
    SELECT 1 FROM rate_tiers rt 
    WHERE rt.rate_structure_id = rs.id
    AND rt.tier_start = 5000
  );