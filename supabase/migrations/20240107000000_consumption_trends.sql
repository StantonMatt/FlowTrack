-- Function to get consumption trends
CREATE OR REPLACE FUNCTION get_consumption_trends(
  p_tenant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_group_by TEXT DEFAULT 'month'
)
RETURNS TABLE (
  period TEXT,
  total_consumption DECIMAL,
  average_consumption DECIMAL,
  customer_count BIGINT,
  reading_count BIGINT,
  anomaly_count BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH grouped_readings AS (
    SELECT
      CASE 
        WHEN p_group_by = 'day' THEN TO_CHAR(reading_date, 'YYYY-MM-DD')
        WHEN p_group_by = 'week' THEN TO_CHAR(DATE_TRUNC('week', reading_date), 'YYYY-MM-DD')
        WHEN p_group_by = 'month' THEN TO_CHAR(reading_date, 'YYYY-MM')
        ELSE TO_CHAR(reading_date, 'YYYY-MM')
      END AS period_text,
      SUM(consumption) AS total_cons,
      AVG(consumption) AS avg_cons,
      COUNT(DISTINCT customer_id) AS cust_count,
      COUNT(*) AS read_count,
      COUNT(CASE WHEN anomaly_flag IS NOT NULL THEN 1 END) AS anom_count
    FROM meter_readings
    WHERE tenant_id = p_tenant_id
      AND reading_date >= p_start_date
      AND reading_date <= p_end_date
      AND consumption IS NOT NULL
    GROUP BY period_text
  )
  SELECT
    period_text,
    COALESCE(total_cons, 0),
    COALESCE(avg_cons, 0),
    cust_count,
    read_count,
    anom_count
  FROM grouped_readings
  ORDER BY period_text;
END;
$$;

-- Function to get top consumers
CREATE OR REPLACE FUNCTION get_top_consumers(
  p_tenant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  customer_id UUID,
  customer_name TEXT,
  total_consumption DECIMAL,
  reading_count BIGINT,
  average_consumption DECIMAL
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS customer_id,
    c.first_name || ' ' || c.last_name AS customer_name,
    COALESCE(SUM(mr.consumption), 0) AS total_consumption,
    COUNT(mr.id) AS reading_count,
    COALESCE(AVG(mr.consumption), 0) AS average_consumption
  FROM customers c
  LEFT JOIN meter_readings mr ON mr.customer_id = c.id
    AND mr.reading_date >= p_start_date
    AND mr.reading_date <= p_end_date
  WHERE c.tenant_id = p_tenant_id
  GROUP BY c.id, c.first_name, c.last_name
  HAVING SUM(mr.consumption) > 0
  ORDER BY total_consumption DESC
  LIMIT p_limit;
END;
$$;

-- Function to calculate consumption statistics by customer type
CREATE OR REPLACE FUNCTION get_consumption_by_customer_type(
  p_tenant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  customer_type TEXT,
  customer_count BIGINT,
  total_consumption DECIMAL,
  average_consumption DECIMAL,
  min_consumption DECIMAL,
  max_consumption DECIMAL
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.customer_type,
    COUNT(DISTINCT c.id) AS customer_count,
    COALESCE(SUM(mr.consumption), 0) AS total_consumption,
    COALESCE(AVG(mr.consumption), 0) AS average_consumption,
    COALESCE(MIN(mr.consumption), 0) AS min_consumption,
    COALESCE(MAX(mr.consumption), 0) AS max_consumption
  FROM customers c
  LEFT JOIN meter_readings mr ON mr.customer_id = c.id
    AND mr.reading_date >= p_start_date
    AND mr.reading_date <= p_end_date
  WHERE c.tenant_id = p_tenant_id
  GROUP BY c.customer_type
  ORDER BY total_consumption DESC;
END;
$$;

-- Function to detect consumption anomalies across tenant
CREATE OR REPLACE FUNCTION detect_consumption_outliers(
  p_tenant_id UUID,
  p_date DATE,
  p_std_dev_threshold DECIMAL DEFAULT 2.5
)
RETURNS TABLE (
  customer_id UUID,
  customer_name TEXT,
  consumption DECIMAL,
  z_score DECIMAL,
  is_outlier BOOLEAN
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_mean DECIMAL;
  v_stddev DECIMAL;
BEGIN
  -- Calculate mean and standard deviation for the date
  SELECT 
    AVG(mr.consumption),
    STDDEV(mr.consumption)
  INTO v_mean, v_stddev
  FROM meter_readings mr
  WHERE mr.tenant_id = p_tenant_id
    AND DATE(mr.reading_date) = p_date
    AND mr.consumption IS NOT NULL;

  -- Return outliers
  RETURN QUERY
  SELECT
    c.id AS customer_id,
    c.first_name || ' ' || c.last_name AS customer_name,
    mr.consumption,
    CASE 
      WHEN v_stddev > 0 THEN (mr.consumption - v_mean) / v_stddev
      ELSE 0
    END AS z_score,
    CASE 
      WHEN v_stddev > 0 AND ABS((mr.consumption - v_mean) / v_stddev) > p_std_dev_threshold THEN true
      ELSE false
    END AS is_outlier
  FROM meter_readings mr
  JOIN customers c ON c.id = mr.customer_id
  WHERE mr.tenant_id = p_tenant_id
    AND DATE(mr.reading_date) = p_date
    AND mr.consumption IS NOT NULL
  ORDER BY ABS(
    CASE 
      WHEN v_stddev > 0 THEN (mr.consumption - v_mean) / v_stddev
      ELSE 0
    END
  ) DESC;
END;
$$;

-- Materialized view for monthly consumption summary
CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_consumption_summary AS
SELECT 
  tenant_id,
  DATE_TRUNC('month', reading_date) AS month,
  COUNT(DISTINCT customer_id) AS unique_customers,
  COUNT(*) AS total_readings,
  SUM(consumption) AS total_consumption,
  AVG(consumption) AS average_consumption,
  MIN(consumption) AS min_consumption,
  MAX(consumption) AS max_consumption,
  STDDEV(consumption) AS consumption_stddev,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY consumption) AS percentile_25,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY consumption) AS median_consumption,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY consumption) AS percentile_75,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY consumption) AS percentile_95,
  COUNT(CASE WHEN anomaly_flag IS NOT NULL THEN 1 END) AS anomaly_count,
  COUNT(CASE WHEN anomaly_flag = 'high' THEN 1 END) AS high_anomaly_count,
  COUNT(CASE WHEN anomaly_flag = 'low' THEN 1 END) AS low_anomaly_count,
  COUNT(CASE WHEN anomaly_flag = 'negative' THEN 1 END) AS negative_anomaly_count
FROM meter_readings
WHERE consumption IS NOT NULL
GROUP BY tenant_id, DATE_TRUNC('month', reading_date);

-- Create index on materialized view
CREATE INDEX idx_monthly_consumption_summary_tenant_month 
ON monthly_consumption_summary(tenant_id, month DESC);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_monthly_consumption_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_consumption_summary;
END;
$$;

-- Create a function to calculate year-over-year growth
CREATE OR REPLACE FUNCTION calculate_yoy_growth(
  p_tenant_id UUID,
  p_month DATE
)
RETURNS TABLE (
  current_month DATE,
  previous_year_month DATE,
  current_consumption DECIMAL,
  previous_consumption DECIMAL,
  absolute_change DECIMAL,
  percentage_change DECIMAL
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH current_period AS (
    SELECT
      DATE_TRUNC('month', p_month) AS month,
      SUM(consumption) AS consumption
    FROM meter_readings
    WHERE tenant_id = p_tenant_id
      AND DATE_TRUNC('month', reading_date) = DATE_TRUNC('month', p_month)
      AND consumption IS NOT NULL
  ),
  previous_period AS (
    SELECT
      DATE_TRUNC('month', p_month - INTERVAL '1 year') AS month,
      SUM(consumption) AS consumption
    FROM meter_readings
    WHERE tenant_id = p_tenant_id
      AND DATE_TRUNC('month', reading_date) = DATE_TRUNC('month', p_month - INTERVAL '1 year')
      AND consumption IS NOT NULL
  )
  SELECT
    cp.month AS current_month,
    pp.month AS previous_year_month,
    COALESCE(cp.consumption, 0) AS current_consumption,
    COALESCE(pp.consumption, 0) AS previous_consumption,
    COALESCE(cp.consumption, 0) - COALESCE(pp.consumption, 0) AS absolute_change,
    CASE 
      WHEN COALESCE(pp.consumption, 0) > 0 THEN
        ((COALESCE(cp.consumption, 0) - COALESCE(pp.consumption, 0)) / pp.consumption * 100)
      ELSE NULL
    END AS percentage_change
  FROM current_period cp
  CROSS JOIN previous_period pp;
END;
$$;

-- Create a function for consumption forecasting (simple moving average)
CREATE OR REPLACE FUNCTION forecast_consumption(
  p_customer_id UUID,
  p_periods INTEGER DEFAULT 3,
  p_lookback_months INTEGER DEFAULT 6
)
RETURNS TABLE (
  forecast_period DATE,
  forecast_value DECIMAL,
  method TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_avg_consumption DECIMAL;
  v_trend DECIMAL;
BEGIN
  -- Calculate average consumption over lookback period
  SELECT 
    AVG(consumption),
    CASE 
      WHEN COUNT(*) >= 2 THEN
        (SUM((ROW_NUMBER() OVER (ORDER BY reading_date) - (COUNT(*) + 1.0) / 2) * consumption) /
         SUM(POWER(ROW_NUMBER() OVER (ORDER BY reading_date) - (COUNT(*) + 1.0) / 2, 2)))
      ELSE 0
    END
  INTO v_avg_consumption, v_trend
  FROM (
    SELECT consumption, reading_date
    FROM meter_readings
    WHERE customer_id = p_customer_id
      AND consumption IS NOT NULL
      AND reading_date >= CURRENT_DATE - (p_lookback_months || ' months')::INTERVAL
    ORDER BY reading_date DESC
    LIMIT p_lookback_months
  ) recent_readings;

  -- Generate forecast
  FOR i IN 1..p_periods LOOP
    RETURN QUERY
    SELECT
      DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::INTERVAL)::DATE AS forecast_period,
      GREATEST(0, v_avg_consumption + (v_trend * i))::DECIMAL AS forecast_value,
      'Linear Trend'::TEXT AS method;
  END LOOP;
END;
$$;

-- Grant appropriate permissions
GRANT EXECUTE ON FUNCTION get_consumption_trends TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_consumers TO authenticated;
GRANT EXECUTE ON FUNCTION get_consumption_by_customer_type TO authenticated;
GRANT EXECUTE ON FUNCTION detect_consumption_outliers TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_yoy_growth TO authenticated;
GRANT EXECUTE ON FUNCTION forecast_consumption TO authenticated;
GRANT SELECT ON monthly_consumption_summary TO authenticated;