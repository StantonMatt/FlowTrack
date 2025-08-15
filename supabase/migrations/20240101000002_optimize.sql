-- ============================================
-- PERFORMANCE OPTIMIZATIONS
-- ============================================

-- Enable pg_stat_statements for query performance monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Enable btree_gist for more efficient indexing
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================
-- ADDITIONAL PERFORMANCE INDEXES
-- ============================================

-- Composite indexes for common query patterns
CREATE INDEX idx_customers_tenant_status_created ON customers(tenant_id, status, created_at DESC);
CREATE INDEX idx_meter_readings_tenant_status_date ON meter_readings(tenant_id, status, reading_date DESC);
CREATE INDEX idx_invoices_tenant_customer_status ON invoices(tenant_id, customer_id, status);
CREATE INDEX idx_payments_tenant_status_processed ON payments(tenant_id, status, processed_at DESC);

-- Partial indexes for active records
CREATE INDEX idx_customers_active ON customers(tenant_id, account_number) WHERE status = 'active';
CREATE INDEX idx_invoices_unpaid ON invoices(tenant_id, customer_id, due_date) WHERE status IN ('sent', 'overdue');
CREATE INDEX idx_meter_readings_pending ON meter_readings(tenant_id, customer_id) WHERE status = 'pending';

-- ============================================
-- MATERIALIZED VIEWS FOR ANALYTICS
-- ============================================

-- Monthly consumption summary
CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_consumption_summary AS
SELECT 
    tenant_id,
    customer_id,
    DATE_TRUNC('month', reading_date) as month,
    COUNT(*) as reading_count,
    SUM(consumption) as total_consumption,
    AVG(consumption) as avg_consumption,
    MIN(consumption) as min_consumption,
    MAX(consumption) as max_consumption
FROM meter_readings
WHERE status = 'confirmed'
GROUP BY tenant_id, customer_id, DATE_TRUNC('month', reading_date);

CREATE UNIQUE INDEX idx_monthly_consumption_summary 
ON monthly_consumption_summary(tenant_id, customer_id, month);

-- Monthly revenue summary
CREATE MATERIALIZED VIEW IF NOT EXISTS monthly_revenue_summary AS
SELECT 
    tenant_id,
    DATE_TRUNC('month', paid_at) as month,
    COUNT(DISTINCT customer_id) as customers_paid,
    COUNT(*) as invoices_paid,
    SUM(total_amount) as total_revenue,
    AVG(total_amount) as avg_invoice_amount
FROM invoices
WHERE status = 'paid' AND paid_at IS NOT NULL
GROUP BY tenant_id, DATE_TRUNC('month', paid_at);

CREATE UNIQUE INDEX idx_monthly_revenue_summary 
ON monthly_revenue_summary(tenant_id, month);

-- Customer balance summary
CREATE MATERIALIZED VIEW IF NOT EXISTS customer_balance_summary AS
SELECT 
    i.tenant_id,
    i.customer_id,
    c.full_name,
    c.account_number,
    COUNT(CASE WHEN i.status IN ('sent', 'overdue') THEN 1 END) as unpaid_invoices,
    SUM(CASE WHEN i.status IN ('sent', 'overdue') THEN i.total_amount ELSE 0 END) as outstanding_balance,
    MAX(CASE WHEN i.status IN ('sent', 'overdue') THEN i.due_date END) as oldest_due_date
FROM invoices i
JOIN customers c ON c.id = i.customer_id
GROUP BY i.tenant_id, i.customer_id, c.full_name, c.account_number;

CREATE UNIQUE INDEX idx_customer_balance_summary 
ON customer_balance_summary(tenant_id, customer_id);

-- ============================================
-- FUNCTIONS FOR MATERIALIZED VIEW REFRESH
-- ============================================

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_consumption_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_revenue_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY customer_balance_summary;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- GRANTS FOR MONITORING
-- ============================================

-- Grant access to materialized views
GRANT SELECT ON monthly_consumption_summary TO authenticated;
GRANT SELECT ON monthly_revenue_summary TO authenticated;
GRANT SELECT ON customer_balance_summary TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_materialized_views TO authenticated;