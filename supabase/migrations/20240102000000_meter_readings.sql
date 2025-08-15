-- Meter readings table for tracking consumption
CREATE TABLE meter_readings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reading_value DECIMAL(12,3) NOT NULL CHECK (reading_value >= 0),
  reading_date TIMESTAMPTZ NOT NULL,
  previous_reading_value DECIMAL(12,3),
  consumption DECIMAL(12,3),
  anomaly_flag TEXT CHECK (anomaly_flag IN ('negative', 'low', 'high')),
  photo_path TEXT,
  metadata JSONB DEFAULT '{}',
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one reading per customer per date
  CONSTRAINT unique_reading_per_customer_date 
    UNIQUE(tenant_id, customer_id, reading_date)
);

-- Validation rules for anomaly detection
CREATE TABLE validation_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  low_threshold DECIMAL(12,3) DEFAULT 0,
  high_threshold DECIMAL(12,3) DEFAULT 10000,
  min_delta_pct DECIMAL(5,2) DEFAULT -50, -- -50% minimum change
  max_delta_pct DECIMAL(5,2) DEFAULT 200,  -- 200% maximum change
  effective_from TIMESTAMPTZ DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one active rule set per tenant
  CONSTRAINT no_overlapping_rules EXCLUDE USING gist (
    tenant_id WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  )
);

-- Idempotency keys for deduplication
CREATE TABLE idempotency_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_path TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '72 hours'),
  
  -- Unique key per tenant
  CONSTRAINT unique_idempotency_key 
    UNIQUE(tenant_id, key)
);

-- Indexes for performance
CREATE INDEX idx_meter_readings_tenant_customer_date 
  ON meter_readings(tenant_id, customer_id, reading_date DESC);

CREATE INDEX idx_meter_readings_tenant_date 
  ON meter_readings(tenant_id, reading_date DESC);

CREATE INDEX idx_meter_readings_customer_date 
  ON meter_readings(customer_id, reading_date DESC);

CREATE INDEX idx_meter_readings_anomaly 
  ON meter_readings(tenant_id, anomaly_flag) 
  WHERE anomaly_flag IS NOT NULL;

CREATE INDEX idx_validation_rules_tenant_effective 
  ON validation_rules(tenant_id, effective_from DESC);

CREATE INDEX idx_idempotency_keys_tenant_key 
  ON idempotency_keys(tenant_id, key);

CREATE INDEX idx_idempotency_keys_expires 
  ON idempotency_keys(expires_at);

-- Enable RLS
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies for meter_readings
CREATE POLICY "meter_readings_tenant_isolation" ON meter_readings
  FOR ALL USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "meter_readings_insert_permission" ON meter_readings
  FOR INSERT WITH CHECK (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin', 'manager', 'meter_reader', 'office_clerk'])
  );

CREATE POLICY "meter_readings_update_permission" ON meter_readings
  FOR UPDATE USING (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin', 'manager'])
  );

CREATE POLICY "meter_readings_delete_permission" ON meter_readings
  FOR DELETE USING (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin'])
  );

-- RLS Policies for validation_rules
CREATE POLICY "validation_rules_tenant_isolation" ON validation_rules
  FOR SELECT USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "validation_rules_admin_only" ON validation_rules
  FOR ALL USING (
    tenant_id = get_auth_tenant_id() AND
    has_role(get_auth_user_id(), tenant_id, ARRAY['admin'])
  );

-- RLS Policies for idempotency_keys
CREATE POLICY "idempotency_keys_tenant_isolation" ON idempotency_keys
  FOR ALL USING (tenant_id = get_auth_tenant_id());

-- Function to get previous reading
CREATE OR REPLACE FUNCTION get_previous_reading(
  p_tenant_id UUID,
  p_customer_id UUID,
  p_reading_date TIMESTAMPTZ
)
RETURNS TABLE (
  reading_value DECIMAL(12,3),
  reading_date TIMESTAMPTZ,
  id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT mr.reading_value, mr.reading_date, mr.id
  FROM meter_readings mr
  WHERE mr.tenant_id = p_tenant_id
    AND mr.customer_id = p_customer_id
    AND mr.reading_date < p_reading_date
  ORDER BY mr.reading_date DESC, mr.created_at DESC
  LIMIT 1;
END;
$$;

-- Function to calculate consumption
CREATE OR REPLACE FUNCTION calculate_consumption(
  p_current_reading DECIMAL(12,3),
  p_previous_reading DECIMAL(12,3)
)
RETURNS DECIMAL(12,3)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_previous_reading IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN p_current_reading - p_previous_reading;
END;
$$;

-- Function to evaluate anomaly flag
CREATE OR REPLACE FUNCTION evaluate_anomaly(
  p_tenant_id UUID,
  p_consumption DECIMAL(12,3),
  p_previous_value DECIMAL(12,3),
  p_reading_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rule validation_rules%ROWTYPE;
  v_delta_pct DECIMAL(5,2);
BEGIN
  -- Get active validation rule
  SELECT * INTO v_rule
  FROM validation_rules
  WHERE tenant_id = p_tenant_id
    AND effective_from <= p_reading_date
    AND (effective_to IS NULL OR effective_to > p_reading_date)
  ORDER BY effective_from DESC
  LIMIT 1;
  
  -- Use defaults if no rule found
  IF v_rule.id IS NULL THEN
    v_rule.low_threshold := 0;
    v_rule.high_threshold := 10000;
    v_rule.min_delta_pct := -50;
    v_rule.max_delta_pct := 200;
  END IF;
  
  -- Check for negative consumption
  IF p_consumption < 0 THEN
    RETURN 'negative';
  END IF;
  
  -- Check absolute thresholds
  IF p_consumption > v_rule.high_threshold THEN
    RETURN 'high';
  ELSIF p_consumption < v_rule.low_threshold THEN
    RETURN 'low';
  END IF;
  
  -- Check percentage change if previous value exists
  IF p_previous_value IS NOT NULL AND p_previous_value > 0 THEN
    v_delta_pct := ((p_consumption / p_previous_value) - 1) * 100;
    
    IF v_delta_pct > v_rule.max_delta_pct THEN
      RETURN 'high';
    ELSIF v_delta_pct < v_rule.min_delta_pct THEN
      RETURN 'low';
    END IF;
  END IF;
  
  RETURN NULL;
END;
$$;

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_meter_readings_updated_at
  BEFORE UPDATE ON meter_readings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_validation_rules_updated_at
  BEFORE UPDATE ON validation_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Function to clean expired idempotency keys
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM idempotency_keys
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Create storage bucket for reading photos (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reading-photos',
  'reading-photos',
  false,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for reading photos
CREATE POLICY "reading_photos_tenant_isolation" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'reading-photos' AND
    (storage.foldername(name))[1] = get_auth_tenant_id()::TEXT
  );

CREATE POLICY "reading_photos_insert_permission" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'reading-photos' AND
    (storage.foldername(name))[1] = get_auth_tenant_id()::TEXT AND
    has_role(get_auth_user_id(), get_auth_tenant_id(), ARRAY['admin', 'manager', 'meter_reader', 'office_clerk'])
  );

CREATE POLICY "reading_photos_update_permission" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'reading-photos' AND
    (storage.foldername(name))[1] = get_auth_tenant_id()::TEXT AND
    has_role(get_auth_user_id(), get_auth_tenant_id(), ARRAY['admin', 'manager'])
  );

CREATE POLICY "reading_photos_delete_permission" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'reading-photos' AND
    (storage.foldername(name))[1] = get_auth_tenant_id()::TEXT AND
    has_role(get_auth_user_id(), get_auth_tenant_id(), ARRAY['admin'])
  );

-- Insert default validation rules for demo tenant
INSERT INTO validation_rules (
  tenant_id,
  low_threshold,
  high_threshold,
  min_delta_pct,
  max_delta_pct,
  effective_from
)
SELECT 
  id,
  0,      -- low_threshold
  10000,  -- high_threshold  
  -50,    -- min_delta_pct
  200,    -- max_delta_pct
  NOW()
FROM tenants
WHERE subdomain = 'demo'
  AND NOT EXISTS (
    SELECT 1 FROM validation_rules vr 
    WHERE vr.tenant_id = tenants.id
  );