-- Add approval fields to meter_readings table
ALTER TABLE meter_readings
ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending' 
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'auto_approved')),
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false;

-- Create approval rules table
CREATE TABLE IF NOT EXISTS reading_approval_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  
  -- Rule conditions
  condition_type TEXT NOT NULL CHECK (condition_type IN (
    'high_consumption', 'low_consumption', 'negative_consumption',
    'high_variance', 'new_customer', 'estimated_reading',
    'photo_missing', 'anomaly_detected', 'threshold_exceeded'
  )),
  threshold_value DECIMAL(12,3),
  threshold_percentage DECIMAL(5,2),
  
  -- Auto-approval settings
  auto_approve BOOLEAN DEFAULT false,
  auto_approve_below DECIMAL(12,3),
  auto_reject_above DECIMAL(12,3),
  
  -- Notification settings
  notify_roles TEXT[] DEFAULT ARRAY['admin', 'manager'],
  notify_users UUID[] DEFAULT ARRAY[]::UUID[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  CONSTRAINT unique_rule_name UNIQUE(tenant_id, name)
);

-- Reading approval queue view
CREATE OR REPLACE VIEW reading_approval_queue AS
SELECT 
  mr.id,
  mr.tenant_id,
  mr.customer_id,
  c.first_name || ' ' || c.last_name AS customer_name,
  c.account_number,
  mr.meter_number,
  mr.reading_date,
  mr.reading_value,
  mr.consumption,
  mr.anomaly_flag,
  mr.approval_status,
  mr.requires_approval,
  mr.created_at,
  mr.photo_url,
  mr.notes,
  u.email AS submitted_by
FROM meter_readings mr
JOIN customers c ON c.id = mr.customer_id
LEFT JOIN auth.users u ON u.id = mr.created_by
WHERE mr.requires_approval = true
  AND mr.approval_status = 'pending'
ORDER BY mr.created_at DESC;

-- Function to evaluate approval rules
CREATE OR REPLACE FUNCTION evaluate_approval_rules(
  p_reading_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_reading RECORD;
  v_rule RECORD;
  v_requires_approval BOOLEAN := false;
  v_previous_avg DECIMAL;
BEGIN
  -- Get reading details
  SELECT mr.*, c.created_at AS customer_created_at
  INTO v_reading
  FROM meter_readings mr
  JOIN customers c ON c.id = mr.customer_id
  WHERE mr.id = p_reading_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Check each active rule
  FOR v_rule IN 
    SELECT * FROM reading_approval_rules
    WHERE tenant_id = v_reading.tenant_id
      AND is_active = true
    ORDER BY priority DESC
  LOOP
    CASE v_rule.condition_type
      WHEN 'high_consumption' THEN
        IF v_reading.consumption > v_rule.threshold_value THEN
          v_requires_approval := true;
        END IF;
        
      WHEN 'low_consumption' THEN
        IF v_reading.consumption < v_rule.threshold_value THEN
          v_requires_approval := true;
        END IF;
        
      WHEN 'negative_consumption' THEN
        IF v_reading.consumption < 0 THEN
          v_requires_approval := true;
        END IF;
        
      WHEN 'high_variance' THEN
        -- Check variance from average
        SELECT AVG(consumption) INTO v_previous_avg
        FROM meter_readings
        WHERE customer_id = v_reading.customer_id
          AND reading_date < v_reading.reading_date
          AND reading_date > v_reading.reading_date - INTERVAL '3 months'
          AND consumption IS NOT NULL;
        
        IF v_previous_avg IS NOT NULL AND v_previous_avg > 0 THEN
          IF ABS((v_reading.consumption - v_previous_avg) / v_previous_avg * 100) > v_rule.threshold_percentage THEN
            v_requires_approval := true;
          END IF;
        END IF;
        
      WHEN 'new_customer' THEN
        -- Check if customer is new (created within last 30 days)
        IF v_reading.customer_created_at > NOW() - INTERVAL '30 days' THEN
          v_requires_approval := true;
        END IF;
        
      WHEN 'estimated_reading' THEN
        IF v_reading.reading_type = 'estimated' THEN
          v_requires_approval := true;
        END IF;
        
      WHEN 'photo_missing' THEN
        IF v_reading.photo_url IS NULL THEN
          v_requires_approval := true;
        END IF;
        
      WHEN 'anomaly_detected' THEN
        IF v_reading.anomaly_flag IS NOT NULL THEN
          v_requires_approval := true;
        END IF;
        
      WHEN 'threshold_exceeded' THEN
        IF v_reading.reading_value > v_rule.threshold_value THEN
          v_requires_approval := true;
        END IF;
    END CASE;

    -- Check auto-approval conditions
    IF v_requires_approval AND v_rule.auto_approve THEN
      IF v_rule.auto_approve_below IS NOT NULL AND v_reading.consumption <= v_rule.auto_approve_below THEN
        -- Auto-approve
        UPDATE meter_readings
        SET approval_status = 'auto_approved',
            approved_at = NOW(),
            requires_approval = false
        WHERE id = p_reading_id;
        RETURN false;
      END IF;
    END IF;
  END LOOP;

  -- Update reading approval requirement
  IF v_requires_approval THEN
    UPDATE meter_readings
    SET requires_approval = true,
        approval_status = 'pending'
    WHERE id = p_reading_id;
  ELSE
    UPDATE meter_readings
    SET requires_approval = false,
        approval_status = 'auto_approved',
        approved_at = NOW()
    WHERE id = p_reading_id;
  END IF;

  RETURN v_requires_approval;
END;
$$;

-- Function to approve reading
CREATE OR REPLACE FUNCTION approve_reading(
  p_reading_id UUID,
  p_approved_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE meter_readings
  SET approval_status = 'approved',
      approved_by = p_approved_by,
      approved_at = NOW(),
      notes = COALESCE(notes || E'\n' || p_notes, p_notes)
  WHERE id = p_reading_id
    AND approval_status = 'pending';

  RETURN FOUND;
END;
$$;

-- Function to reject reading
CREATE OR REPLACE FUNCTION reject_reading(
  p_reading_id UUID,
  p_rejected_by UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE meter_readings
  SET approval_status = 'rejected',
      approved_by = p_rejected_by,
      approved_at = NOW(),
      rejection_reason = p_reason
  WHERE id = p_reading_id
    AND approval_status = 'pending';

  RETURN FOUND;
END;
$$;

-- Function to bulk approve readings
CREATE OR REPLACE FUNCTION bulk_approve_readings(
  p_reading_ids UUID[],
  p_approved_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE meter_readings
  SET approval_status = 'approved',
      approved_by = p_approved_by,
      approved_at = NOW()
  WHERE id = ANY(p_reading_ids)
    AND approval_status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Trigger to evaluate approval rules on insert/update
CREATE OR REPLACE FUNCTION check_reading_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only check for new readings or significant updates
  IF TG_OP = 'INSERT' OR 
     (TG_OP = 'UPDATE' AND (
       NEW.reading_value != OLD.reading_value OR
       NEW.consumption != OLD.consumption
     )) THEN
    PERFORM evaluate_approval_rules(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER reading_approval_check
  AFTER INSERT OR UPDATE ON meter_readings
  FOR EACH ROW
  EXECUTE FUNCTION check_reading_approval();

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_meter_readings_approval_status 
ON meter_readings(tenant_id, approval_status) 
WHERE requires_approval = true;

CREATE INDEX IF NOT EXISTS idx_meter_readings_approved_by 
ON meter_readings(approved_by, approved_at DESC);

CREATE INDEX IF NOT EXISTS idx_reading_approval_rules_tenant 
ON reading_approval_rules(tenant_id, is_active);

-- Insert default approval rules for demo tenant
INSERT INTO reading_approval_rules (
  tenant_id,
  name,
  description,
  condition_type,
  threshold_value,
  priority,
  is_active
)
SELECT 
  id,
  'High Consumption Alert',
  'Require approval for readings with consumption over 10000 gallons',
  'high_consumption',
  10000,
  10,
  true
FROM tenants
WHERE subdomain = 'demo'
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO reading_approval_rules (
  tenant_id,
  name,
  description,
  condition_type,
  threshold_percentage,
  priority,
  is_active
)
SELECT 
  id,
  'High Variance Alert',
  'Require approval for readings with >50% variance from average',
  'high_variance',
  50,
  8,
  true
FROM tenants
WHERE subdomain = 'demo'
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO reading_approval_rules (
  tenant_id,
  name,
  description,
  condition_type,
  priority,
  is_active
)
SELECT 
  id,
  'Negative Consumption Check',
  'Require approval for negative consumption readings',
  'negative_consumption',
  NULL,
  9,
  true
FROM tenants
WHERE subdomain = 'demo'
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Grant permissions
GRANT SELECT ON reading_approval_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE ON reading_approval_rules TO authenticated;
GRANT EXECUTE ON FUNCTION evaluate_approval_rules TO authenticated;
GRANT EXECUTE ON FUNCTION approve_reading TO authenticated;
GRANT EXECUTE ON FUNCTION reject_reading TO authenticated;
GRANT EXECUTE ON FUNCTION bulk_approve_readings TO authenticated;