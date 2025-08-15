-- Telemetry tables for tracking sync and performance metrics

-- Sync telemetry table
CREATE TABLE IF NOT EXISTS sync_telemetry (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes for querying
  INDEX idx_sync_telemetry_tenant_timestamp (tenant_id, timestamp DESC),
  INDEX idx_sync_telemetry_user (user_id) WHERE user_id IS NOT NULL,
  INDEX idx_sync_telemetry_event_type (event_type)
);

-- Error logs table
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  error_type TEXT NOT NULL,
  error_message TEXT,
  error_stack TEXT,
  context JSONB DEFAULT '{}',
  severity TEXT CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_error_logs_tenant_timestamp (tenant_id, timestamp DESC) WHERE tenant_id IS NOT NULL,
  INDEX idx_error_logs_severity (severity, timestamp DESC),
  INDEX idx_error_logs_error_type (error_type)
);

-- Performance metrics table
CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  metric_type TEXT NOT NULL,
  metric_value JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id TEXT,
  page_url TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes
  INDEX idx_performance_metrics_tenant (tenant_id) WHERE tenant_id IS NOT NULL,
  INDEX idx_performance_metrics_type (metric_type, timestamp DESC),
  INDEX idx_performance_metrics_session (session_id) WHERE session_id IS NOT NULL
);

-- Aggregated sync statistics (materialized view for performance)
CREATE MATERIALIZED VIEW IF NOT EXISTS sync_statistics AS
SELECT 
  tenant_id,
  DATE_TRUNC('day', timestamp) as day,
  COUNT(*) as total_syncs,
  COUNT(DISTINCT user_id) as unique_users,
  AVG((event_data->>'duration')::numeric) as avg_duration_ms,
  SUM((event_data->>'successCount')::integer) as total_success,
  SUM((event_data->>'failureCount')::integer) as total_failures,
  SUM((event_data->>'photoUploads')::integer) as total_photos,
  AVG((event_data->>'averageRetries')::numeric) as avg_retries
FROM sync_telemetry
WHERE event_type = 'sync'
GROUP BY tenant_id, DATE_TRUNC('day', timestamp)
WITH DATA;

-- Create index on materialized view
CREATE INDEX idx_sync_statistics_tenant_day 
ON sync_statistics(tenant_id, day DESC);

-- Refresh function for materialized view
CREATE OR REPLACE FUNCTION refresh_sync_statistics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY sync_statistics;
END;
$$;

-- Schedule periodic refresh (would need pg_cron extension)
-- SELECT cron.schedule('refresh-sync-stats', '0 * * * *', 'SELECT refresh_sync_statistics();');

-- RLS Policies
ALTER TABLE sync_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;

-- Sync telemetry policies
CREATE POLICY "sync_telemetry_tenant_isolation" ON sync_telemetry
  FOR SELECT USING (tenant_id = get_auth_tenant_id());

CREATE POLICY "sync_telemetry_insert" ON sync_telemetry
  FOR INSERT WITH CHECK (tenant_id = get_auth_tenant_id());

-- Error logs policies  
CREATE POLICY "error_logs_tenant_isolation" ON error_logs
  FOR SELECT USING (
    tenant_id = get_auth_tenant_id() OR
    tenant_id IS NULL AND user_id = get_auth_user_id()
  );

CREATE POLICY "error_logs_insert" ON error_logs
  FOR INSERT WITH CHECK (
    tenant_id = get_auth_tenant_id() OR
    (tenant_id IS NULL AND user_id = get_auth_user_id())
  );

-- Performance metrics policies
CREATE POLICY "performance_metrics_tenant_isolation" ON performance_metrics
  FOR SELECT USING (
    tenant_id = get_auth_tenant_id() OR
    (tenant_id IS NULL AND user_id = get_auth_user_id())
  );

CREATE POLICY "performance_metrics_insert" ON performance_metrics
  FOR INSERT WITH CHECK (
    tenant_id = get_auth_tenant_id() OR
    (tenant_id IS NULL AND user_id = get_auth_user_id())
  );

-- Cleanup function for old telemetry data
CREATE OR REPLACE FUNCTION cleanup_old_telemetry(
  p_days_to_keep INTEGER DEFAULT 90
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete old sync telemetry
  DELETE FROM sync_telemetry
  WHERE timestamp < NOW() - INTERVAL '1 day' * p_days_to_keep;
  
  -- Delete old error logs (keep critical errors longer)
  DELETE FROM error_logs
  WHERE timestamp < NOW() - INTERVAL '1 day' * p_days_to_keep
    AND severity NOT IN ('critical', 'error');
  
  DELETE FROM error_logs
  WHERE timestamp < NOW() - INTERVAL '1 day' * (p_days_to_keep * 2)
    AND severity IN ('critical', 'error');
  
  -- Delete old performance metrics
  DELETE FROM performance_metrics
  WHERE timestamp < NOW() - INTERVAL '1 day' * (p_days_to_keep / 3);
  
  -- Refresh statistics after cleanup
  REFRESH MATERIALIZED VIEW CONCURRENTLY sync_statistics;
END;
$$;

-- Function to get sync health metrics
CREATE OR REPLACE FUNCTION get_sync_health(
  p_tenant_id UUID,
  p_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
  total_syncs BIGINT,
  successful_syncs BIGINT,
  failed_syncs BIGINT,
  success_rate NUMERIC,
  avg_duration_ms NUMERIC,
  total_items_synced BIGINT,
  total_photos_synced BIGINT,
  unique_users BIGINT,
  last_sync_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_syncs,
    COUNT(*) FILTER (WHERE (event_data->>'failureCount')::integer = 0)::BIGINT as successful_syncs,
    COUNT(*) FILTER (WHERE (event_data->>'failureCount')::integer > 0)::BIGINT as failed_syncs,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        (COUNT(*) FILTER (WHERE (event_data->>'failureCount')::integer = 0)::numeric / COUNT(*)::numeric * 100)
      ELSE 0
    END as success_rate,
    AVG((event_data->>'duration')::numeric) as avg_duration_ms,
    COALESCE(SUM((event_data->>'successCount')::integer), 0)::BIGINT as total_items_synced,
    COALESCE(SUM((event_data->>'photoUploads')::integer), 0)::BIGINT as total_photos_synced,
    COUNT(DISTINCT user_id)::BIGINT as unique_users,
    MAX(timestamp) as last_sync_at
  FROM sync_telemetry
  WHERE tenant_id = p_tenant_id
    AND event_type = 'sync'
    AND timestamp > NOW() - INTERVAL '1 hour' * p_hours;
END;
$$;

-- Create stored procedure for telemetry table creation (referenced in API)
CREATE OR REPLACE FUNCTION create_telemetry_table_if_not_exists()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- This is a no-op since tables are created in migration
  -- But kept for API compatibility
  NULL;
END;
$$;