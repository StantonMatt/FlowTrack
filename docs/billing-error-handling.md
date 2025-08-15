# Billing System Error Handling Documentation

## Overview

The billing system implements comprehensive error handling with retry mechanisms, partial failure recovery, and a dead-letter queue for failed email deliveries.

## Key Features

### 1. Retry Logic with Exponential Backoff

All external service calls (Storage, Email) use exponential backoff retry:
- **Max Attempts**: 3 for initial attempts, 2 for DLQ retries
- **Base Delay**: 1-3 seconds depending on operation
- **Max Delay**: 10 seconds
- **Jitter**: Added to prevent thundering herd

```typescript
await withRetry(
  async () => { /* operation */ },
  {
    maxAttempts: 3,
    baseDelayMs: 2000,
    backoffMultiplier: 2
  }
);
```

### 2. Per-Customer Transaction Savepoints

Each customer invoice is processed within a savepoint:
- Success: Savepoint is released
- Failure: Rollback to savepoint, preserving other customers' data

### 3. Invoice Status Management

Invoices track their processing state:
- `draft`: Initial creation
- `sent`: Email successfully delivered
- `error`: Processing failed (PDF or email)
- `paid`: Payment received
- `overdue`: Past due date

### 4. Dead Letter Queue (DLQ)

Failed emails are queued for retry:
- Automatic retry with exponential backoff
- Max 5 retry attempts by default
- Manual override available
- Scheduled processing every 30 minutes

## Database Schema Updates

### billing_runs Table
```sql
invoices_failed INTEGER    -- Count of failed invoice creations
pdfs_generated INTEGER     -- Successful PDF generations
pdfs_failed INTEGER        -- Failed PDF generations  
emails_sent INTEGER        -- Successful email deliveries
emails_failed INTEGER      -- Failed email deliveries
```

### email_dead_letter_queue Table
```sql
id UUID PRIMARY KEY
tenant_id UUID             -- Tenant reference
invoice_id UUID            -- Invoice reference
customer_id UUID           -- Customer reference
error_message TEXT         -- Last error message
retry_count INTEGER        -- Current retry attempts
max_retries INTEGER        -- Maximum allowed retries
next_retry_at TIMESTAMPTZ  -- Next scheduled retry
status TEXT                -- pending|retrying|failed|succeeded
```

### invoices Table
```sql
status invoice_status      -- Now includes 'error' status
error_details JSONB        -- Detailed error information
```

## Edge Functions

### generate-invoices
Main billing function with comprehensive error handling:
- Processes customers in parallel batches
- Tracks partial failures separately
- Updates billing run statistics
- Queues failed emails to DLQ

### process-email-dlq
Processes the dead letter queue:
- Retries failed email deliveries
- Implements exponential backoff
- Updates invoice status on success
- Marks permanently failed after max retries

## Error Recovery Strategies

### Partial Failure Handling

When invoice creation succeeds but PDF/email fails:
1. Invoice remains in system (status='error')
2. Failed email queued to DLQ
3. Billing run marked as 'partial'
4. Detailed error tracking in billing_runs

### Idempotency

Prevents duplicate billing runs:
- Input hash calculation
- Check for existing completed runs
- Safe re-runs with same parameters

### Monitoring & Observability

Error details are captured at multiple levels:
- Individual customer errors in result
- Aggregate statistics in billing_runs
- Detailed logs for debugging
- DLQ status for email retries

## Usage Examples

### Manual Invoice Generation
```bash
curl -X POST https://your-project.supabase.co/functions/v1/generate-invoices \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "uuid",
    "periodStart": "2024-01-01",
    "periodEnd": "2024-01-31",
    "sendEmails": true,
    "generatePdfs": true
  }'
```

### Process Dead Letter Queue
```bash
curl -X POST https://your-project.supabase.co/functions/v1/process-email-dlq \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 50,
    "force": false
  }'
```

### Check Billing Run Status
```sql
SELECT 
  status,
  total_customers,
  invoices_created,
  invoices_failed,
  emails_sent,
  emails_failed
FROM billing_runs
WHERE tenant_id = 'your-tenant-id'
ORDER BY created_at DESC
LIMIT 1;
```

### View Failed Emails in DLQ
```sql
SELECT 
  invoice_id,
  error_message,
  retry_count,
  next_retry_at
FROM email_dead_letter_queue
WHERE status IN ('pending', 'retrying')
  AND tenant_id = 'your-tenant-id'
ORDER BY next_retry_at;
```

## Testing

Run the test suite to validate error handling:

```bash
deno run --allow-net --allow-env \
  supabase/functions/generate-invoices/test-error-handling.ts
```

Test scenarios include:
1. Storage failure simulation
2. Email failure simulation
3. Dead letter queue creation
4. Billing run error tracking
5. DLQ processing
6. Invoice error status
7. Idempotency verification

## Best Practices

1. **Always check billing run status** after generation
2. **Monitor the DLQ** for persistent failures
3. **Set up alerts** for high failure rates
4. **Review error_details** in invoices for debugging
5. **Use dry_run** mode for testing
6. **Configure appropriate retry limits** based on your needs

## Troubleshooting

### High Email Failure Rate
- Check Resend API key and limits
- Verify customer email addresses
- Review DLQ error messages

### PDF Generation Failures
- Check Storage bucket permissions
- Verify PDF template data
- Monitor Storage API limits

### Partial Billing Runs
- Review individual customer errors
- Check for data quality issues
- Verify rate plan configuration

### DLQ Not Processing
- Ensure cron job is configured
- Check Edge Function logs
- Verify service role permissions