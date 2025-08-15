-- Create audit view for billing runs summary
CREATE OR REPLACE VIEW v_billing_runs_summary AS
SELECT 
    br.id,
    br.tenant_id,
    t.name AS tenant_name,
    br.period_start,
    br.period_end,
    br.status,
    br.started_at,
    br.finished_at,
    br.total_customers,
    br.processed_count,
    br.success_count,
    br.error_count,
    br.pdf_error_count,
    br.email_error_count,
    br.retry_count,
    br.last_error_at,
    br.error_samples,
    -- Calculate totals from invoices
    COALESCE(inv.invoice_count, 0) AS invoice_count,
    COALESCE(inv.total_subtotal, 0) AS total_subtotal,
    COALESCE(inv.total_tax, 0) AS total_tax,
    COALESCE(inv.total_amount, 0) AS total_amount,
    COALESCE(inv.error_invoice_count, 0) AS error_invoice_count,
    COALESCE(inv.zero_usage_count, 0) AS zero_usage_count,
    -- Calculate processing time
    EXTRACT(EPOCH FROM (br.finished_at - br.started_at)) AS processing_seconds,
    -- Success rate
    CASE 
        WHEN br.total_customers > 0 
        THEN ROUND((br.success_count::numeric / br.total_customers::numeric) * 100, 2)
        ELSE NULL
    END AS success_rate_percent,
    br.created_at,
    br.updated_at
FROM billing_runs br
LEFT JOIN tenants t ON br.tenant_id = t.id
LEFT JOIN LATERAL (
    SELECT 
        COUNT(*) AS invoice_count,
        SUM(subtotal) AS total_subtotal,
        SUM(tax) AS total_tax,
        SUM(total) AS total_amount,
        COUNT(*) FILTER (WHERE status = 'error') AS error_invoice_count,
        COUNT(*) FILTER (WHERE total = 0) AS zero_usage_count
    FROM invoices
    WHERE tenant_id = br.tenant_id
        AND period_start = br.period_start
        AND period_end = br.period_end
) inv ON true
ORDER BY br.created_at DESC;

-- Create audit view for invoices summary per tenant/period
CREATE OR REPLACE VIEW v_invoices_summary AS
SELECT 
    i.tenant_id,
    t.name AS tenant_name,
    DATE_TRUNC('month', i.period_start) AS billing_month,
    i.period_start,
    i.period_end,
    COUNT(DISTINCT i.customer_id) AS unique_customers,
    COUNT(*) AS total_invoices,
    -- Status breakdown
    COUNT(*) FILTER (WHERE i.status = 'draft') AS draft_count,
    COUNT(*) FILTER (WHERE i.status = 'sent') AS sent_count,
    COUNT(*) FILTER (WHERE i.status = 'paid') AS paid_count,
    COUNT(*) FILTER (WHERE i.status = 'overdue') AS overdue_count,
    COUNT(*) FILTER (WHERE i.status = 'cancelled') AS cancelled_count,
    COUNT(*) FILTER (WHERE i.status = 'error') AS error_count,
    -- Financial totals
    SUM(i.subtotal) AS total_subtotal,
    SUM(i.tax) AS total_tax,
    SUM(i.total) AS total_amount,
    AVG(i.total) AS average_invoice_amount,
    MIN(i.total) AS min_invoice_amount,
    MAX(i.total) AS max_invoice_amount,
    -- PDF and email status
    COUNT(*) FILTER (WHERE i.pdf_path IS NOT NULL) AS has_pdf_count,
    COUNT(*) FILTER (WHERE i.pdf_path IS NULL) AS missing_pdf_count,
    COUNT(*) FILTER (WHERE ie.sent_at IS NOT NULL) AS emailed_count,
    COUNT(*) FILTER (WHERE ie.sent_at IS NULL AND i.status != 'draft') AS not_emailed_count,
    -- Anomalies
    COUNT(*) FILTER (WHERE i.total = 0) AS zero_amount_invoices,
    COUNT(*) FILTER (WHERE i.subtotal < 0) AS negative_amount_invoices,
    COUNT(*) FILTER (WHERE i.tax > i.subtotal) AS tax_exceeds_subtotal,
    -- Reminder statistics
    COUNT(*) FILTER (WHERE i.reminder_count > 0) AS invoices_with_reminders,
    SUM(i.reminder_count) AS total_reminders_sent,
    MAX(i.reminder_count) AS max_reminders_per_invoice,
    -- Overdue amounts
    SUM(i.total) FILTER (WHERE i.status = 'overdue') AS total_overdue_amount,
    COUNT(*) FILTER (WHERE i.status = 'overdue' AND i.due_date < CURRENT_DATE - INTERVAL '30 days') AS severely_overdue_count
FROM invoices i
LEFT JOIN tenants t ON i.tenant_id = t.id
LEFT JOIN LATERAL (
    SELECT MIN(sent_at) AS sent_at
    FROM invoice_emails
    WHERE invoice_id = i.id
) ie ON true
GROUP BY 
    i.tenant_id,
    t.name,
    DATE_TRUNC('month', i.period_start),
    i.period_start,
    i.period_end
ORDER BY 
    i.tenant_id,
    billing_month DESC;

-- Create reconciliation view for data integrity checks
CREATE OR REPLACE VIEW v_billing_reconciliation AS
WITH invoice_readings AS (
    -- Get readings that should be included in invoices
    SELECT 
        r.tenant_id,
        r.customer_id,
        DATE_TRUNC('month', r.reading_date) AS billing_month,
        SUM(r.consumption) AS total_consumption
    FROM meter_readings r
    WHERE r.consumption > 0
    GROUP BY 
        r.tenant_id,
        r.customer_id,
        DATE_TRUNC('month', r.reading_date)
),
invoice_totals AS (
    -- Get invoice line items consumption
    SELECT 
        i.tenant_id,
        i.customer_id,
        DATE_TRUNC('month', i.period_start) AS billing_month,
        SUM(ili.quantity) AS billed_consumption,
        COUNT(DISTINCT i.id) AS invoice_count
    FROM invoices i
    LEFT JOIN invoice_line_items ili ON i.id = ili.invoice_id
    WHERE ili.description LIKE '%consumption%' OR ili.description LIKE '%usage%'
    GROUP BY 
        i.tenant_id,
        i.customer_id,
        DATE_TRUNC('month', i.period_start)
)
SELECT 
    COALESCE(ir.tenant_id, it.tenant_id) AS tenant_id,
    COALESCE(ir.customer_id, it.customer_id) AS customer_id,
    COALESCE(ir.billing_month, it.billing_month) AS billing_month,
    ir.total_consumption AS readings_consumption,
    it.billed_consumption AS invoice_consumption,
    it.invoice_count,
    -- Discrepancy checks
    CASE 
        WHEN ir.total_consumption IS NULL AND it.billed_consumption IS NOT NULL THEN 'MISSING_READINGS'
        WHEN ir.total_consumption IS NOT NULL AND it.billed_consumption IS NULL THEN 'MISSING_INVOICE'
        WHEN ABS(COALESCE(ir.total_consumption, 0) - COALESCE(it.billed_consumption, 0)) > 0.01 THEN 'MISMATCH'
        ELSE 'OK'
    END AS reconciliation_status,
    ABS(COALESCE(ir.total_consumption, 0) - COALESCE(it.billed_consumption, 0)) AS discrepancy_amount
FROM invoice_readings ir
FULL OUTER JOIN invoice_totals it 
    ON ir.tenant_id = it.tenant_id 
    AND ir.customer_id = it.customer_id 
    AND ir.billing_month = it.billing_month
WHERE ir.total_consumption IS NULL 
    OR it.billed_consumption IS NULL 
    OR ABS(COALESCE(ir.total_consumption, 0) - COALESCE(it.billed_consumption, 0)) > 0.01
ORDER BY 
    tenant_id,
    billing_month DESC,
    discrepancy_amount DESC;

-- Create view for email delivery audit
CREATE OR REPLACE VIEW v_email_delivery_audit AS
SELECT 
    i.tenant_id,
    t.name AS tenant_name,
    DATE_TRUNC('month', i.period_start) AS billing_month,
    i.id AS invoice_id,
    i.invoice_number,
    i.customer_id,
    c.name AS customer_name,
    c.email AS customer_email,
    i.status AS invoice_status,
    i.created_at AS invoice_created,
    ie.sent_at AS email_sent_at,
    ie.status AS email_status,
    ie.error AS email_error,
    dlq.attempt_count AS dlq_attempts,
    dlq.status AS dlq_status,
    dlq.last_error AS dlq_last_error,
    dlq.next_attempt_at AS dlq_next_retry,
    -- Calculate time to send
    EXTRACT(EPOCH FROM (ie.sent_at - i.created_at)) / 60 AS minutes_to_send,
    -- Flag issues
    CASE 
        WHEN i.status != 'draft' AND ie.sent_at IS NULL AND dlq.id IS NULL THEN 'NEVER_ATTEMPTED'
        WHEN dlq.status = 'failed' THEN 'PERMANENTLY_FAILED'
        WHEN dlq.status = 'pending' THEN 'RETRY_PENDING'
        WHEN ie.status = 'failed' THEN 'SEND_FAILED'
        WHEN ie.status = 'sent' THEN 'DELIVERED'
        ELSE 'UNKNOWN'
    END AS delivery_status
FROM invoices i
LEFT JOIN tenants t ON i.tenant_id = t.id
LEFT JOIN customers c ON i.customer_id = c.id
LEFT JOIN invoice_emails ie ON i.id = ie.invoice_id
LEFT JOIN email_dead_letter_queue dlq ON i.id = dlq.invoice_id
WHERE i.status != 'draft'
ORDER BY 
    i.tenant_id,
    billing_month DESC,
    delivery_status DESC;

-- Create aggregated anomaly detection view
CREATE OR REPLACE VIEW v_billing_anomalies AS
SELECT 
    tenant_id,
    'ZERO_USAGE_INVOICE' AS anomaly_type,
    COUNT(*) AS count,
    STRING_AGG(invoice_number::text, ', ' ORDER BY created_at DESC LIMIT 10) AS sample_invoices
FROM invoices
WHERE total = 0 AND status != 'cancelled'
GROUP BY tenant_id

UNION ALL

SELECT 
    tenant_id,
    'MISSING_PDF' AS anomaly_type,
    COUNT(*) AS count,
    STRING_AGG(invoice_number::text, ', ' ORDER BY created_at DESC LIMIT 10) AS sample_invoices
FROM invoices
WHERE pdf_path IS NULL AND status NOT IN ('draft', 'cancelled')
GROUP BY tenant_id

UNION ALL

SELECT 
    tenant_id,
    'UNSENT_EMAIL' AS anomaly_type,
    COUNT(*) AS count,
    STRING_AGG(i.invoice_number::text, ', ' ORDER BY i.created_at DESC LIMIT 10) AS sample_invoices
FROM invoices i
LEFT JOIN invoice_emails ie ON i.id = ie.invoice_id
WHERE ie.id IS NULL AND i.status NOT IN ('draft', 'cancelled')
GROUP BY i.tenant_id

UNION ALL

SELECT 
    tenant_id,
    'LONG_OVERDUE' AS anomaly_type,
    COUNT(*) AS count,
    STRING_AGG(invoice_number::text, ', ' ORDER BY due_date LIMIT 10) AS sample_invoices
FROM invoices
WHERE status = 'overdue' AND due_date < CURRENT_DATE - INTERVAL '60 days'
GROUP BY tenant_id

UNION ALL

SELECT 
    i.tenant_id,
    'EMAIL_FAILED' AS anomaly_type,
    COUNT(DISTINCT i.id) AS count,
    STRING_AGG(DISTINCT i.invoice_number::text, ', ' ORDER BY i.invoice_number::text LIMIT 10) AS sample_invoices
FROM invoices i
JOIN email_dead_letter_queue dlq ON i.id = dlq.invoice_id
WHERE dlq.status = 'failed'
GROUP BY i.tenant_id

ORDER BY tenant_id, anomaly_type;

-- Grant appropriate permissions
GRANT SELECT ON v_billing_runs_summary TO authenticated;
GRANT SELECT ON v_invoices_summary TO authenticated;
GRANT SELECT ON v_billing_reconciliation TO authenticated;
GRANT SELECT ON v_email_delivery_audit TO authenticated;
GRANT SELECT ON v_billing_anomalies TO authenticated;

-- Add RLS policies for the views (views inherit RLS from base tables)
-- But we can add comments for clarity
COMMENT ON VIEW v_billing_runs_summary IS 'Audit view for billing run statistics and outcomes. Access controlled by billing_runs RLS.';
COMMENT ON VIEW v_invoices_summary IS 'Summary statistics for invoices by tenant and period. Access controlled by invoices RLS.';
COMMENT ON VIEW v_billing_reconciliation IS 'Reconciliation between meter readings and billed amounts. Access controlled by base table RLS.';
COMMENT ON VIEW v_email_delivery_audit IS 'Email delivery status and issues tracking. Access controlled by invoices RLS.';
COMMENT ON VIEW v_billing_anomalies IS 'Detected anomalies in billing data. Access controlled by invoices RLS.';