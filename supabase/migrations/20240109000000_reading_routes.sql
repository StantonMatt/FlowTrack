-- Reading routes table for organizing meter reading collection
CREATE TABLE IF NOT EXISTS reading_routes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  route_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  
  -- Route configuration
  reading_day INTEGER CHECK (reading_day BETWEEN 1 AND 31),
  reading_frequency TEXT CHECK (reading_frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'on_demand')),
  estimated_duration_hours DECIMAL(5,2),
  
  -- Assignment
  assigned_to UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ,
  
  -- Geographic data
  area_name TEXT,
  coordinates JSONB, -- Array of lat/lng points defining the route
  total_customers INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  CONSTRAINT unique_route_code UNIQUE(tenant_id, route_code)
);

-- Route customers junction table
CREATE TABLE IF NOT EXISTS route_customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  route_id UUID NOT NULL REFERENCES reading_routes(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  
  -- Customer location for route optimization
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  
  -- Reading instructions
  special_instructions TEXT,
  access_notes TEXT,
  preferred_reading_time TEXT,
  
  -- Status tracking
  is_active BOOLEAN DEFAULT true,
  last_read_date DATE,
  next_read_date DATE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_route_customer UNIQUE(route_id, customer_id),
  CONSTRAINT unique_route_sequence UNIQUE(route_id, sequence_number)
);

-- Route schedules table
CREATE TABLE IF NOT EXISTS route_schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  route_id UUID NOT NULL REFERENCES reading_routes(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  
  -- Schedule details
  start_time TIME,
  end_time TIME,
  assigned_to UUID REFERENCES auth.users(id),
  
  -- Progress tracking
  status TEXT DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'in_progress', 'completed', 'cancelled', 'partial'
  )),
  total_customers INTEGER,
  completed_readings INTEGER DEFAULT 0,
  skipped_readings INTEGER DEFAULT 0,
  
  -- Completion details
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_route_schedule UNIQUE(route_id, scheduled_date)
);

-- Route progress tracking
CREATE TABLE IF NOT EXISTS route_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES route_schedules(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  
  -- Progress details
  sequence_number INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'completed', 'skipped', 'inaccessible', 'no_access'
  )),
  
  -- Reading reference
  reading_id UUID REFERENCES meter_readings(id),
  
  -- Completion tracking
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  skip_reason TEXT,
  notes TEXT,
  
  -- Location tracking
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_schedule_customer UNIQUE(schedule_id, customer_id)
);

-- Function to create route schedule
CREATE OR REPLACE FUNCTION create_route_schedule(
  p_route_id UUID,
  p_scheduled_date DATE,
  p_assigned_to UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_schedule_id UUID;
  v_customer_count INTEGER;
BEGIN
  -- Get customer count
  SELECT COUNT(*) INTO v_customer_count
  FROM route_customers
  WHERE route_id = p_route_id AND is_active = true;

  -- Create schedule
  INSERT INTO route_schedules (
    route_id,
    scheduled_date,
    assigned_to,
    total_customers,
    status
  ) VALUES (
    p_route_id,
    p_scheduled_date,
    COALESCE(p_assigned_to, (SELECT assigned_to FROM reading_routes WHERE id = p_route_id)),
    v_customer_count,
    'scheduled'
  )
  RETURNING id INTO v_schedule_id;

  -- Create progress entries for each customer
  INSERT INTO route_progress (
    schedule_id,
    customer_id,
    sequence_number,
    status
  )
  SELECT 
    v_schedule_id,
    rc.customer_id,
    rc.sequence_number,
    'pending'
  FROM route_customers rc
  WHERE rc.route_id = p_route_id
    AND rc.is_active = true
  ORDER BY rc.sequence_number;

  RETURN v_schedule_id;
END;
$$;

-- Function to optimize route sequence
CREATE OR REPLACE FUNCTION optimize_route_sequence(
  p_route_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer RECORD;
  v_sequence INTEGER := 1;
  v_last_lat DECIMAL(10,8);
  v_last_lng DECIMAL(11,8);
BEGIN
  -- Simple nearest neighbor optimization
  -- In production, use more sophisticated routing algorithms
  
  -- Start from the first customer
  SELECT latitude, longitude 
  INTO v_last_lat, v_last_lng
  FROM route_customers
  WHERE route_id = p_route_id
    AND is_active = true
  ORDER BY sequence_number
  LIMIT 1;

  -- Update sequences based on distance
  FOR v_customer IN
    SELECT id, customer_id,
           latitude, longitude,
           SQRT(POWER(latitude - v_last_lat, 2) + POWER(longitude - v_last_lng, 2)) AS distance
    FROM route_customers
    WHERE route_id = p_route_id
      AND is_active = true
    ORDER BY distance
  LOOP
    UPDATE route_customers
    SET sequence_number = v_sequence,
        updated_at = NOW()
    WHERE id = v_customer.id;
    
    v_sequence := v_sequence + 1;
    v_last_lat := v_customer.latitude;
    v_last_lng := v_customer.longitude;
  END LOOP;

  RETURN true;
END;
$$;

-- Function to get next customer in route
CREATE OR REPLACE FUNCTION get_next_route_customer(
  p_schedule_id UUID
)
RETURNS TABLE (
  customer_id UUID,
  customer_name TEXT,
  address TEXT,
  meter_number TEXT,
  sequence_number INTEGER,
  special_instructions TEXT,
  latitude DECIMAL,
  longitude DECIMAL
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS customer_id,
    c.first_name || ' ' || c.last_name AS customer_name,
    c.service_address AS address,
    c.meter_number,
    rp.sequence_number,
    rc.special_instructions,
    rc.latitude,
    rc.longitude
  FROM route_progress rp
  JOIN customers c ON c.id = rp.customer_id
  JOIN route_schedules rs ON rs.id = rp.schedule_id
  JOIN route_customers rc ON rc.route_id = rs.route_id AND rc.customer_id = c.id
  WHERE rp.schedule_id = p_schedule_id
    AND rp.status = 'pending'
  ORDER BY rp.sequence_number
  LIMIT 1;
END;
$$;

-- Function to complete route reading
CREATE OR REPLACE FUNCTION complete_route_reading(
  p_schedule_id UUID,
  p_customer_id UUID,
  p_reading_id UUID,
  p_completed_by UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_completed_count INTEGER;
  v_total_count INTEGER;
BEGIN
  -- Update progress
  UPDATE route_progress
  SET status = 'completed',
      reading_id = p_reading_id,
      completed_at = NOW(),
      completed_by = p_completed_by
  WHERE schedule_id = p_schedule_id
    AND customer_id = p_customer_id;

  -- Update schedule progress
  SELECT 
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*)
  INTO v_completed_count, v_total_count
  FROM route_progress
  WHERE schedule_id = p_schedule_id;

  UPDATE route_schedules
  SET completed_readings = v_completed_count,
      status = CASE 
        WHEN v_completed_count = 0 THEN 'scheduled'
        WHEN v_completed_count < v_total_count THEN 'in_progress'
        ELSE 'completed'
      END,
      started_at = COALESCE(started_at, NOW()),
      completed_at = CASE 
        WHEN v_completed_count = v_total_count THEN NOW()
        ELSE NULL
      END
  WHERE id = p_schedule_id;

  RETURN true;
END;
$$;

-- View for route dashboard
CREATE OR REPLACE VIEW route_dashboard AS
SELECT 
  rr.id AS route_id,
  rr.tenant_id,
  rr.name AS route_name,
  rr.route_code,
  rr.assigned_to,
  u.email AS assigned_to_email,
  rr.total_customers,
  rs.id AS schedule_id,
  rs.scheduled_date,
  rs.status,
  rs.completed_readings,
  rs.skipped_readings,
  rs.total_customers AS scheduled_customers,
  CASE 
    WHEN rs.total_customers > 0 THEN 
      ROUND((rs.completed_readings::DECIMAL / rs.total_customers) * 100, 2)
    ELSE 0
  END AS completion_percentage,
  rs.started_at,
  rs.completed_at
FROM reading_routes rr
LEFT JOIN route_schedules rs ON rs.route_id = rr.id 
  AND rs.scheduled_date >= CURRENT_DATE - INTERVAL '30 days'
LEFT JOIN auth.users u ON u.id = rr.assigned_to
WHERE rr.is_active = true
ORDER BY rs.scheduled_date DESC;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_reading_routes_tenant 
ON reading_routes(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_route_customers_route 
ON route_customers(route_id, sequence_number) 
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_route_schedules_date 
ON route_schedules(scheduled_date, status);

CREATE INDEX IF NOT EXISTS idx_route_progress_schedule 
ON route_progress(schedule_id, status);

-- Enable RLS
ALTER TABLE reading_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "reading_routes_tenant_isolation" ON reading_routes
  FOR ALL USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "route_customers_tenant_isolation" ON route_customers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM reading_routes rr
      WHERE rr.id = route_customers.route_id
      AND rr.tenant_id = get_auth_tenant_id()
    )
  );

CREATE POLICY "route_schedules_tenant_isolation" ON route_schedules
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM reading_routes rr
      WHERE rr.id = route_schedules.route_id
      AND rr.tenant_id = get_auth_tenant_id()
    )
  );

CREATE POLICY "route_progress_tenant_isolation" ON route_progress
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM route_schedules rs
      JOIN reading_routes rr ON rr.id = rs.route_id
      WHERE rs.id = route_progress.schedule_id
      AND rr.tenant_id = get_auth_tenant_id()
    )
  );

-- Grant permissions
GRANT ALL ON reading_routes TO authenticated;
GRANT ALL ON route_customers TO authenticated;
GRANT ALL ON route_schedules TO authenticated;
GRANT ALL ON route_progress TO authenticated;
GRANT SELECT ON route_dashboard TO authenticated;
GRANT EXECUTE ON FUNCTION create_route_schedule TO authenticated;
GRANT EXECUTE ON FUNCTION optimize_route_sequence TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_route_customer TO authenticated;
GRANT EXECUTE ON FUNCTION complete_route_reading TO authenticated;