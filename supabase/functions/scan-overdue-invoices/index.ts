import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { withRetry } from '../_shared/retry.ts';

interface ScanOverdueRequest {
  tenantId?: string;
  force?: boolean; // Force scan even outside business hours
  dryRun?: boolean; // Preview what would be done without making changes
}

interface ScanResult {
  tenantsProcessed: number;
  invoicesScanned: number;
  invoicesMarkedOverdue: number;
  remindersScheduled: number;
  remindersSent: number;
  errors: Array<{
    invoiceId: string;
    error: string;
  }>;
  details: Array<{
    tenantId: string;
    invoicesProcessed: number;
    remindersScheduled: number;
    remindersSent: number;
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
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { 
      tenantId, 
      force = false,
      dryRun = false 
    } = await req.json() as ScanOverdueRequest;

    const result: ScanResult = {
      tenantsProcessed: 0,
      invoicesScanned: 0,
      invoicesMarkedOverdue: 0,
      remindersScheduled: 0,
      remindersSent: 0,
      errors: [],
      details: [],
    };

    // Get tenants to process
    let tenantsQuery = supabase
      .from('tenants')
      .select('id, name, settings');
    
    if (tenantId) {
      tenantsQuery = tenantsQuery.eq('id', tenantId);
    }

    const { data: tenants, error: tenantsError } = await tenantsQuery;
    
    if (tenantsError) throw tenantsError;
    if (!tenants || tenants.length === 0) {
      return new Response(
        JSON.stringify({
          message: 'No tenants to process',
          result,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process each tenant
    for (const tenant of tenants) {
      const tenantResult = await processTenantOverdueInvoices(
        supabase,
        tenant,
        {
          force,
          dryRun,
          resendApiKey: resendApiKey || '',
        }
      );

      result.tenantsProcessed++;
      result.invoicesScanned += tenantResult.invoicesScanned;
      result.invoicesMarkedOverdue += tenantResult.invoicesMarkedOverdue;
      result.remindersScheduled += tenantResult.remindersScheduled;
      result.remindersSent += tenantResult.remindersSent;
      result.errors.push(...tenantResult.errors);
      
      result.details.push({
        tenantId: tenant.id,
        invoicesProcessed: tenantResult.invoicesScanned,
        remindersScheduled: tenantResult.remindersScheduled,
        remindersSent: tenantResult.remindersSent,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${result.tenantsProcessed} tenants, scanned ${result.invoicesScanned} invoices, sent ${result.remindersSent} reminders`,
        result,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in scan-overdue-invoices function:', error);
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
 * Process overdue invoices for a single tenant
 */
async function processTenantOverdueInvoices(
  supabase: any,
  tenant: any,
  options: {
    force: boolean;
    dryRun: boolean;
    resendApiKey: string;
  }
): Promise<{
  invoicesScanned: number;
  invoicesMarkedOverdue: number;
  remindersScheduled: number;
  remindersSent: number;
  errors: Array<{ invoiceId: string; error: string }>;
}> {
  const result = {
    invoicesScanned: 0,
    invoicesMarkedOverdue: 0,
    remindersScheduled: 0,
    remindersSent: 0,
    errors: [] as Array<{ invoiceId: string; error: string }>,
  };

  // Get tenant reminder settings
  const { data: reminderSettings } = await supabase
    .from('tenant_reminder_settings')
    .select('*')
    .eq('tenant_id', tenant.id)
    .single();

  // Use default settings if not configured
  const settings = reminderSettings || {
    enabled: true,
    reminder_intervals: [7, 14, 30, 60],
    max_reminders: 4,
    include_payment_link: true,
    attach_pdf: false,
    send_hour_start: 9,
    send_hour_end: 17,
    send_days: [1, 2, 3, 4, 5],
  };

  // Skip if reminders are disabled for this tenant
  if (!settings.enabled && !options.force) {
    console.log(`Reminders disabled for tenant ${tenant.id}`);
    return result;
  }

  // Check if we're in business hours (unless forced)
  if (!options.force && !isBusinessHours(settings, tenant.settings?.timezone)) {
    console.log(`Outside business hours for tenant ${tenant.id}`);
    return result;
  }

  // Query overdue invoices using the view
  const { data: invoices, error: invoicesError } = await supabase
    .from('invoices_with_overdue')
    .select('*')
    .eq('tenant_id', tenant.id)
    .in('status', ['sent', 'overdue', 'error'])
    .not('due_date', 'is', null)
    .lte('due_date', new Date().toISOString().split('T')[0])
    .order('due_date', { ascending: true });

  if (invoicesError) {
    console.error('Error fetching invoices:', invoicesError);
    throw invoicesError;
  }

  if (!invoices || invoices.length === 0) {
    return result;
  }

  // Process each overdue invoice
  for (const invoice of invoices) {
    result.invoicesScanned++;

    try {
      // Calculate days overdue
      const daysOverdue = invoice.days_overdue || 0;
      
      if (daysOverdue <= 0) continue;

      // Mark as overdue if not already
      if (invoice.status !== 'overdue' && !options.dryRun) {
        await supabase
          .from('invoices')
          .update({
            status: 'overdue',
            overdue_since: invoice.overdue_since || invoice.due_date,
          })
          .eq('id', invoice.id);

        result.invoicesMarkedOverdue++;
      }

      // Check if a reminder should be sent
      const shouldSendReminder = shouldSendReminderForInvoice(
        invoice,
        daysOverdue,
        settings
      );

      if (shouldSendReminder) {
        result.remindersScheduled++;

        if (!options.dryRun && options.resendApiKey) {
          // Send reminder email
          const emailSent = await sendReminderEmail(
            supabase,
            invoice,
            tenant,
            daysOverdue,
            settings,
            options.resendApiKey
          );

          if (emailSent) {
            result.remindersSent++;

            // Update invoice reminder tracking
            const nextReminderDate = calculateNextReminderDate(
              invoice,
              settings.reminder_intervals
            );

            await supabase
              .from('invoices')
              .update({
                reminder_count: (invoice.reminder_count || 0) + 1,
                last_reminded_at: new Date().toISOString(),
                next_reminder_at: nextReminderDate,
              })
              .eq('id', invoice.id);

            // Record in reminder history
            await supabase
              .from('invoice_reminder_history')
              .insert({
                tenant_id: tenant.id,
                invoice_id: invoice.id,
                customer_id: invoice.customer_id,
                reminder_number: (invoice.reminder_count || 0) + 1,
                days_overdue: daysOverdue,
                email_to: [invoice.customer?.email].filter(Boolean),
                email_status: 'sent',
                metadata: {
                  invoice_number: invoice.invoice_number,
                  total_amount: invoice.total_amount,
                },
              });
          }
        }
      }
    } catch (error) {
      console.error(`Error processing invoice ${invoice.id}:`, error);
      result.errors.push({
        invoiceId: invoice.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return result;
}

/**
 * Check if we should send a reminder for this invoice
 */
function shouldSendReminderForInvoice(
  invoice: any,
  daysOverdue: number,
  settings: any
): boolean {
  // Don't send if already at max reminders
  if (invoice.reminder_count >= settings.max_reminders) {
    return false;
  }

  // Check if enough time has passed since last reminder
  if (invoice.last_reminded_at) {
    const daysSinceLastReminder = Math.floor(
      (Date.now() - new Date(invoice.last_reminded_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // Wait at least 3 days between reminders
    if (daysSinceLastReminder < 3) {
      return false;
    }
  }

  // Check if we've scheduled a future reminder
  if (invoice.next_reminder_at) {
    const nextReminderDate = new Date(invoice.next_reminder_at);
    if (nextReminderDate > new Date()) {
      return false;
    }
  }

  // Check if current days overdue matches any interval
  const reminderIntervals = settings.reminder_intervals || [7, 14, 30, 60];
  
  // Send reminder if we're at or past any interval we haven't sent yet
  const remindersSent = invoice.reminder_count || 0;
  if (remindersSent < reminderIntervals.length) {
    const currentInterval = reminderIntervals[remindersSent];
    return daysOverdue >= currentInterval;
  }

  return false;
}

/**
 * Calculate next reminder date based on intervals
 */
function calculateNextReminderDate(invoice: any, intervals: number[]): string | null {
  const remindersSent = (invoice.reminder_count || 0) + 1;
  
  if (remindersSent >= intervals.length) {
    // No more reminders scheduled
    return null;
  }

  const nextInterval = intervals[remindersSent];
  const dueDate = new Date(invoice.due_date);
  const nextDate = new Date(dueDate);
  nextDate.setDate(nextDate.getDate() + nextInterval);

  // If next date is in the past, schedule for tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  return nextDate > tomorrow ? nextDate.toISOString() : tomorrow.toISOString();
}

/**
 * Check if current time is within business hours
 */
function isBusinessHours(settings: any, timezone?: string): boolean {
  // For now, use UTC time (in production, use tenant timezone)
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay() || 7; // Convert Sunday from 0 to 7

  // Check hour
  if (currentHour < settings.send_hour_start || currentHour >= settings.send_hour_end) {
    return false;
  }

  // Check day of week
  if (!settings.send_days.includes(currentDay)) {
    return false;
  }

  return true;
}

/**
 * Send reminder email for overdue invoice
 */
async function sendReminderEmail(
  supabase: any,
  invoice: any,
  tenant: any,
  daysOverdue: number,
  settings: any,
  resendApiKey: string
): Promise<boolean> {
  try {
    // Get customer details
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('id', invoice.customer_id)
      .single();

    if (!customer || !customer.email) {
      console.error(`No email for customer ${invoice.customer_id}`);
      return false;
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
    const viewInvoiceUrl = `${baseUrl}/${tenant.settings?.subdomain || tenant.id}/invoices/${invoice.invoice_number}`;
    const paymentUrl = settings.include_payment_link 
      ? `${baseUrl}/${tenant.settings?.subdomain || tenant.id}/pay/${invoice.invoice_number}`
      : null;

    // Select reminder template based on number of reminders sent
    const reminderNumber = (invoice.reminder_count || 0) + 1;
    const subject = getReminderSubject(reminderNumber, daysOverdue, invoice.invoice_number, tenant.name);
    const emailHtml = getReminderEmailHtml({
      tenant,
      customer,
      invoice,
      daysOverdue,
      reminderNumber,
      viewInvoiceUrl,
      paymentUrl,
      formatCurrency,
    });

    // Send email via Resend
    const response = await withRetry(
      async () => {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: tenant.settings?.billing_email || 'noreply@flowtrack.com',
            to: customer.email,
            subject,
            html: emailHtml,
            tags: [
              { name: 'type', value: 'reminder' },
              { name: 'invoice_id', value: invoice.id },
              { name: 'tenant_id', value: tenant.id },
              { name: 'reminder_number', value: String(reminderNumber) },
              { name: 'days_overdue', value: String(daysOverdue) },
            ],
          }),
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(`Resend API error: ${errorData.message || res.statusText}`);
        }

        return res.json();
      },
      {
        maxAttempts: 2,
        baseDelayMs: 2000,
      }
    );

    console.log(`Reminder email sent for invoice ${invoice.id}`);
    return true;
  } catch (error) {
    console.error(`Failed to send reminder email for invoice ${invoice.id}:`, error);
    
    // Record failed attempt
    await supabase
      .from('invoice_reminder_history')
      .insert({
        tenant_id: tenant.id,
        invoice_id: invoice.id,
        customer_id: invoice.customer_id,
        reminder_number: (invoice.reminder_count || 0) + 1,
        days_overdue: daysOverdue,
        email_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });

    return false;
  }
}

/**
 * Get reminder email subject based on reminder number
 */
function getReminderSubject(
  reminderNumber: number,
  daysOverdue: number,
  invoiceNumber: string,
  tenantName: string
): string {
  if (reminderNumber === 1) {
    return `Friendly Reminder: Invoice ${invoiceNumber} from ${tenantName} is ${daysOverdue} days overdue`;
  } else if (reminderNumber === 2) {
    return `Second Notice: Invoice ${invoiceNumber} is ${daysOverdue} days past due`;
  } else if (reminderNumber === 3) {
    return `Important: Invoice ${invoiceNumber} requires immediate attention - ${daysOverdue} days overdue`;
  } else {
    return `Final Notice: Invoice ${invoiceNumber} is seriously overdue (${daysOverdue} days)`;
  }
}

/**
 * Generate reminder email HTML
 */
function getReminderEmailHtml(params: {
  tenant: any;
  customer: any;
  invoice: any;
  daysOverdue: number;
  reminderNumber: number;
  viewInvoiceUrl: string;
  paymentUrl: string | null;
  formatCurrency: (amount: number) => string;
}): string {
  const { tenant, customer, invoice, daysOverdue, reminderNumber, viewInvoiceUrl, paymentUrl, formatCurrency } = params;
  
  let urgencyColor = '#FFA500'; // Orange for first reminders
  let urgencyMessage = 'This is a friendly reminder that your invoice is past due.';
  
  if (reminderNumber >= 3) {
    urgencyColor = '#FF0000'; // Red for urgent
    urgencyMessage = 'This invoice requires immediate attention to avoid service interruption.';
  } else if (reminderNumber === 2) {
    urgencyColor = '#FF6B6B'; // Soft red for second notice
    urgencyMessage = 'This is your second notice. Please arrange payment as soon as possible.';
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Reminder - Invoice ${invoice.invoice_number}</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: ${urgencyColor}; padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
        <h2 style="color: white; margin: 0; font-size: 24px;">Payment Reminder</h2>
        <p style="color: white; margin: 5px 0 0 0; font-size: 14px;">${daysOverdue} Days Overdue</p>
      </div>
      
      <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none;">
        <p style="margin: 0 0 20px 0;">Dear ${customer.full_name || 'Valued Customer'},</p>
        
        <p style="color: ${urgencyColor}; font-weight: 600; margin: 0 0 20px 0;">
          ${urgencyMessage}
        </p>
        
        <div style="background: #fff3cd; border-left: 4px solid ${urgencyColor}; padding: 15px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 5px 0;"><strong>Invoice Number:</strong></td>
              <td style="text-align: right; padding: 5px 0;">${invoice.invoice_number}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0;"><strong>Original Due Date:</strong></td>
              <td style="text-align: right; padding: 5px 0;">${formatDate(invoice.due_date)}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0;"><strong>Days Overdue:</strong></td>
              <td style="text-align: right; padding: 5px 0; color: ${urgencyColor}; font-weight: 600;">${daysOverdue} days</td>
            </tr>
            <tr>
              <td style="padding: 10px 0 5px 0;"><strong>Amount Due:</strong></td>
              <td style="text-align: right; padding: 10px 0 5px 0; font-size: 20px; color: ${urgencyColor};"><strong>${formatCurrency(invoice.total_amount)}</strong></td>
            </tr>
          </table>
        </div>
        
        ${paymentUrl ? `
        <div style="margin: 30px 0; text-align: center;">
          <a href="${paymentUrl}" style="display: inline-block; background: ${urgencyColor}; color: white; padding: 14px 40px; text-decoration: none; border-radius: 5px; font-weight: 600; font-size: 16px;">Pay Now</a>
        </div>
        ` : ''}
        
        <div style="margin: 20px 0; text-align: center;">
          <a href="${viewInvoiceUrl}" style="color: #667eea; text-decoration: none;">View Invoice Details →</a>
        </div>
        
        <div style="border-top: 1px solid #e0e0e0; margin-top: 30px; padding-top: 20px;">
          <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">
            If you have already made this payment, please disregard this notice. If you have any questions or concerns, please contact us immediately.
          </p>
          
          ${tenant.settings?.contact_phone ? `
          <p style="margin: 5px 0; color: #666; font-size: 14px;">
            Phone: ${tenant.settings.contact_phone}
          </p>
          ` : ''}
          
          ${tenant.settings?.contact_email ? `
          <p style="margin: 5px 0; color: #666; font-size: 14px;">
            Email: ${tenant.settings.contact_email}
          </p>
          ` : ''}
        </div>
      </div>
      
      <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
        <p style="margin: 0;">This is reminder ${reminderNumber} of ${4}</p>
        <p style="margin: 5px 0;">© ${new Date().getFullYear()} ${tenant.name}. All rights reserved.</p>
      </div>
    </body>
    </html>
  `;
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