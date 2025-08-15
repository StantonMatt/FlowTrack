import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { withRetry, RetryError } from '../_shared/retry.ts';

interface ProcessDLQRequest {
  tenantId?: string;
  limit?: number;
  force?: boolean; // Force retry even if max retries reached
}

interface ProcessDLQResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  details: Array<{
    invoiceId: string;
    customerId: string;
    status: 'sent' | 'failed' | 'skipped';
    error?: string;
    retryCount: number;
  }>;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      tenantId, 
      limit = 50,
      force = false 
    } = await req.json() as ProcessDLQRequest;

    const result: ProcessDLQResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };

    // Build query for pending items
    let query = supabase
      .from('email_dead_letter_queue')
      .select(`
        *,
        invoice:invoices(
          *,
          customer:customers(
            id,
            full_name,
            email,
            phone,
            billing_address
          ),
          items:invoice_line_items(
            description,
            quantity,
            unit_price,
            amount
          )
        )
      `)
      .in('status', ['pending', 'retrying'])
      .lte('next_retry_at', new Date().toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(limit);

    // Filter by tenant if provided
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    // If not forcing, exclude items that have exceeded max retries
    if (!force) {
      query = query.filter('retry_count', 'lt', 'max_retries');
    }

    const { data: queueItems, error: queryError } = await query;

    if (queryError) {
      throw queryError;
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(
        JSON.stringify({
          message: 'No items to process in dead letter queue',
          result,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process each item
    for (const item of queueItems) {
      result.processed++;

      // Check if max retries exceeded (unless forcing)
      if (!force && item.retry_count >= item.max_retries) {
        // Mark as permanently failed
        await supabase
          .from('email_dead_letter_queue')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);

        result.skipped++;
        result.details.push({
          invoiceId: item.invoice_id,
          customerId: item.customer_id,
          status: 'skipped',
          error: 'Max retries exceeded',
          retryCount: item.retry_count,
        });
        continue;
      }

      try {
        // Update status to retrying
        await supabase
          .from('email_dead_letter_queue')
          .update({
            status: 'retrying',
            last_retry_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);

        // Attempt to send the email with retry logic
        await withRetry(
          async () => {
            await sendInvoiceEmail(
              supabase,
              item.invoice,
              item.invoice.customer,
              item.tenant_id,
              resendApiKey
            );
          },
          {
            maxAttempts: 2, // Fewer retries since this is already a retry
            baseDelayMs: 2000,
          }
        );

        // Success - mark as succeeded and update invoice status
        await Promise.all([
          supabase
            .from('email_dead_letter_queue')
            .update({
              status: 'succeeded',
              updated_at: new Date().toISOString(),
            })
            .eq('id', item.id),
          
          supabase
            .from('invoices')
            .update({
              status: 'sent',
              error_details: null,
            })
            .eq('id', item.invoice_id)
        ]);

        result.succeeded++;
        result.details.push({
          invoiceId: item.invoice_id,
          customerId: item.customer_id,
          status: 'sent',
          retryCount: item.retry_count + 1,
        });

      } catch (error) {
        console.error(`Failed to send email for invoice ${item.invoice_id}:`, error);

        // Calculate next retry time with exponential backoff
        const nextRetryDelay = calculateNextRetryDelay(item.retry_count + 1);
        const nextRetryAt = new Date(Date.now() + nextRetryDelay);

        // Update queue item with new retry count and next retry time
        const newRetryCount = item.retry_count + 1;
        const isFinalFailure = !force && newRetryCount >= item.max_retries;

        await supabase
          .from('email_dead_letter_queue')
          .update({
            status: isFinalFailure ? 'failed' : 'pending',
            retry_count: newRetryCount,
            next_retry_at: isFinalFailure ? null : nextRetryAt.toISOString(),
            error_message: error instanceof Error ? error.message : 'Unknown error',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);

        result.failed++;
        result.details.push({
          invoiceId: item.invoice_id,
          customerId: item.customer_id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          retryCount: newRetryCount,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${result.processed} items: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped`,
        result,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in process-email-dlq function:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Calculate next retry delay with exponential backoff
 */
function calculateNextRetryDelay(retryCount: number): number {
  // Base delay: 15 minutes, doubles each time, max 24 hours
  const baseDelay = 15 * 60 * 1000; // 15 minutes
  const maxDelay = 24 * 60 * 60 * 1000; // 24 hours
  
  const delay = Math.min(
    baseDelay * Math.pow(2, retryCount - 1),
    maxDelay
  );
  
  // Add some jitter (±10%)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  
  return Math.round(delay + jitter);
}

/**
 * Send invoice email using Resend
 */
async function sendInvoiceEmail(
  supabase: any,
  invoice: any,
  customer: any,
  tenantId: string,
  resendApiKey: string
): Promise<void> {
  // Fetch tenant settings
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, settings')
    .eq('id', tenantId)
    .single();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const recipientEmail = customer.email;
  if (!recipientEmail) {
    throw new Error('Customer has no email address');
  }

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: invoice.currency || 'USD',
    }).format(amount);
  };

  // Generate URLs
  const baseUrl = Deno.env.get('NEXT_PUBLIC_APP_URL') || 'https://app.flowtrack.com';
  const viewInvoiceUrl = `${baseUrl}/${tenant.settings?.subdomain || tenantId}/invoices/${invoice.invoice_number}`;
  
  // Get signed PDF URL if available
  let pdfUrl: string | undefined;
  if (invoice.pdf_path) {
    const { data: urlData } = await supabase
      .storage
      .from('invoices')
      .createSignedUrl(invoice.pdf_path, 7 * 24 * 3600); // 7 days
    
    pdfUrl = urlData?.signedUrl;
  }

  // Prepare email HTML content
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Invoice ${invoice.invoice_number}</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 28px;">${tenant.name}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Invoice ${invoice.invoice_number}</p>
      </div>
      
      <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="margin: 0 0 20px 0;">Dear ${customer.full_name || 'Customer'},</p>
        
        <p>Your invoice for the period ${formatDate(invoice.period_start)} to ${formatDate(invoice.period_end)} is ready.</p>
        
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0;"><strong>Invoice Number:</strong></td>
              <td style="text-align: right; padding: 8px 0;">${invoice.invoice_number}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Due Date:</strong></td>
              <td style="text-align: right; padding: 8px 0;">${formatDate(invoice.due_date)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0;"><strong>Total Amount:</strong></td>
              <td style="text-align: right; padding: 8px 0; font-size: 18px; color: #667eea;"><strong>${formatCurrency(invoice.total_amount)}</strong></td>
            </tr>
          </table>
        </div>
        
        <div style="margin: 30px 0; text-align: center;">
          <a href="${viewInvoiceUrl}" style="display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600;">View Invoice</a>
          ${pdfUrl ? `<a href="${pdfUrl}" style="display: inline-block; background: white; color: #667eea; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600; border: 2px solid #667eea; margin-left: 10px;">Download PDF</a>` : ''}
        </div>
        
        <p style="margin: 20px 0 0 0; color: #666; font-size: 14px;">
          If you have any questions about this invoice, please don't hesitate to contact us.
        </p>
      </div>
      
      <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
        <p style="margin: 0;">© ${new Date().getFullYear()} ${tenant.name}. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;

  // Send email via Resend API
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: tenant.settings?.billing_email || 'noreply@flowtrack.com',
      to: recipientEmail,
      subject: `Invoice ${invoice.invoice_number} from ${tenant.name}`,
      html: emailHtml,
      tags: [
        { name: 'type', value: 'invoice' },
        { name: 'invoice_id', value: invoice.id },
        { name: 'tenant_id', value: tenantId },
        { name: 'retry', value: 'true' },
      ],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Resend API error: ${errorData.message || response.statusText}`);
  }

  const emailResult = await response.json();

  // Log successful email send
  await supabase
    .from('invoice_emails')
    .insert({
      invoice_id: invoice.id,
      tenant_id: tenantId,
      message_id: emailResult.id,
      sent_at: new Date().toISOString(),
      sent_to: [recipientEmail],
      status: 'sent',
      template: 'invoice',
      metadata: {
        retried: true,
        resend_id: emailResult.id,
      },
    });
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}