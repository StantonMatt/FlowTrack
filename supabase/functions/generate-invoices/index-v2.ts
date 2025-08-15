import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { withRetry, RetryError, processBatchWithRetry } from '../_shared/retry.ts';

interface GenerateInvoicesRequest {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  dryRun?: boolean;
  sendEmails?: boolean;
  generatePdfs?: boolean;
}

interface CustomerInvoiceResult {
  customerId: string;
  invoiceId?: string;
  success: boolean;
  amount?: number;
  error?: string;
  pdfGenerated?: boolean;
  emailSent?: boolean;
  retryCount?: number;
}

interface BillingRunResult {
  runId?: string;
  status: 'completed' | 'partial' | 'failed';
  totalCustomers: number;
  customersProcessed: number;
  invoicesCreated: number;
  invoicesFailed: number;
  pdfsGenerated: number;
  pdfsFailed: number;
  emailsSent: number;
  emailsFailed: number;
  totalAmount: number;
  errors: CustomerInvoiceResult[];
  partialFailures: CustomerInvoiceResult[];
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
      periodStart, 
      periodEnd, 
      dryRun = false, 
      sendEmails = true,
      generatePdfs = true 
    } = await req.json() as GenerateInvoicesRequest;

    // Validate input
    if (!tenantId || !periodStart || !periodEnd) {
      throw new Error('Missing required parameters: tenantId, periodStart, periodEnd');
    }

    // Calculate input hash for idempotency
    const inputHash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${tenantId}-${periodStart}-${periodEnd}`)
    );
    const hashString = Array.from(new Uint8Array(inputHash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Check for existing billing run (idempotency)
    const { data: existingRun } = await supabase
      .from('billing_runs')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .single();

    if (existingRun && existingRun.status === 'completed' && !dryRun) {
      return new Response(
        JSON.stringify({
          message: 'Billing run already completed for this period',
          result: mapRunToResult(existingRun),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize or update billing run
    let runId: string | undefined;
    if (!dryRun) {
      const { data: billingRun, error: runError } = await supabase
        .from('billing_runs')
        .upsert({
          tenant_id: tenantId,
          period_start: periodStart,
          period_end: periodEnd,
          input_hash: hashString,
          status: 'running',
          started_at: new Date().toISOString(),
          invoices_failed: 0,
          pdfs_generated: 0,
          pdfs_failed: 0,
          emails_sent: 0,
          emails_failed: 0,
        }, {
          onConflict: 'tenant_id,period_start,period_end',
        })
        .select()
        .single();

      if (runError) throw runError;
      runId = billingRun.id;
    }

    const result: BillingRunResult = {
      runId,
      status: 'completed',
      totalCustomers: 0,
      customersProcessed: 0,
      invoicesCreated: 0,
      invoicesFailed: 0,
      pdfsGenerated: 0,
      pdfsFailed: 0,
      emailsSent: 0,
      emailsFailed: 0,
      totalAmount: 0,
      errors: [],
      partialFailures: [],
    };

    try {
      // Get required data with retry
      const [customers, ratePlan, template] = await Promise.all([
        withRetry(() => 
          supabase
            .from('customers')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('status', 'active')
            .then(res => {
              if (res.error) throw res.error;
              return res.data || [];
            })
        ),
        withRetry(() => 
          supabase
            .from('rate_plans')
            .select(`*, rate_tiers (*)`)
            .eq('tenant_id', tenantId)
            .eq('active', true)
            .lte('effective_from', periodEnd)
            .or(`effective_to.is.null,effective_to.gte.${periodStart}`)
            .single()
            .then(res => {
              if (res.error) throw new Error('No active rate plan found');
              return res.data;
            })
        ),
        withRetry(() => 
          supabase
            .from('billing_templates')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .single()
            .then(res => res.data)
        ),
      ]);

      result.totalCustomers = customers.length;

      // Process customers in batches with concurrency control
      const customerResults = await processBatchWithRetry(
        customers,
        async (customer) => {
          const customerResult: CustomerInvoiceResult = {
            customerId: customer.id,
            success: false,
          };

          // Start a savepoint for this customer
          const savepointName = `customer_${customer.id.replace(/-/g, '_')}`;
          
          try {
            // Begin savepoint (if not dry run)
            if (!dryRun) {
              await supabase.rpc('exec_sql', {
                query: `SAVEPOINT ${savepointName}`
              }).then(res => {
                if (res.error) throw res.error;
              });
            }

            // Process customer invoice
            const invoiceData = await processCustomerInvoice(
              supabase,
              customer,
              ratePlan,
              template,
              {
                tenantId,
                periodStart,
                periodEnd,
                dryRun,
                generatePdfs,
                sendEmails,
                resendApiKey,
              }
            );

            customerResult.invoiceId = invoiceData.invoiceId;
            customerResult.amount = invoiceData.amount;
            customerResult.pdfGenerated = invoiceData.pdfGenerated;
            customerResult.emailSent = invoiceData.emailSent;
            customerResult.success = true;

            // Release savepoint on success
            if (!dryRun) {
              await supabase.rpc('exec_sql', {
                query: `RELEASE SAVEPOINT ${savepointName}`
              });
            }

            return customerResult;
          } catch (error) {
            // Rollback to savepoint on failure
            if (!dryRun) {
              try {
                await supabase.rpc('exec_sql', {
                  query: `ROLLBACK TO SAVEPOINT ${savepointName}`
                });
              } catch (rollbackError) {
                console.error('Failed to rollback savepoint:', rollbackError);
              }
            }

            customerResult.error = error instanceof Error ? error.message : 'Unknown error';
            
            // Check if it's a partial failure (invoice created but PDF/email failed)
            if (error instanceof PartialFailureError) {
              customerResult.invoiceId = error.invoiceId;
              customerResult.amount = error.amount;
              customerResult.pdfGenerated = error.pdfGenerated;
              customerResult.emailSent = error.emailSent;
            }
            
            throw error;
          }
        },
        {
          concurrency: 5,
          retryOptions: {
            maxAttempts: 3,
            baseDelayMs: 1000,
            shouldRetry: (error, attempt) => {
              // Don't retry validation errors
              if (error.code === 'VALIDATION_ERROR') return false;
              // Don't retry after partial success
              if (error instanceof PartialFailureError) return false;
              return attempt < 3;
            },
          },
          onError: (customer, error) => {
            console.error(`Failed to process customer ${customer.id}:`, error);
          },
        }
      );

      // Aggregate results
      for (const { item: customer, result: customerResult } of customerResults.successful) {
        result.customersProcessed++;
        if (customerResult.success) {
          result.invoicesCreated++;
          result.totalAmount += customerResult.amount || 0;
          if (customerResult.pdfGenerated) result.pdfsGenerated++;
          if (customerResult.emailSent) result.emailsSent++;
        }
      }

      for (const { item: customer, error } of customerResults.failed) {
        result.customersProcessed++;
        result.invoicesFailed++;
        
        const errorResult: CustomerInvoiceResult = {
          customerId: customer.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };

        // Check for partial failures
        if (error instanceof PartialFailureError) {
          errorResult.invoiceId = error.invoiceId;
          errorResult.amount = error.amount;
          errorResult.pdfGenerated = error.pdfGenerated;
          errorResult.emailSent = error.emailSent;
          
          if (error.invoiceId) {
            result.invoicesCreated++;
            result.totalAmount += error.amount || 0;
          }
          if (error.pdfGenerated) {
            result.pdfsGenerated++;
          } else if (error.invoiceId) {
            result.pdfsFailed++;
          }
          if (error.emailSent) {
            result.emailsSent++;
          } else if (error.invoiceId) {
            result.emailsFailed++;
            
            // Add to dead letter queue for retry
            if (!dryRun) {
              await addToDeadLetterQueue(supabase, {
                tenantId,
                invoiceId: error.invoiceId,
                customerId: customer.id,
                error: error.message,
                metadata: {
                  periodStart,
                  periodEnd,
                  runId,
                },
              });
            }
          }
          
          result.partialFailures.push(errorResult);
        } else {
          result.errors.push(errorResult);
        }
      }

      // Determine final status
      if (result.invoicesFailed === 0 && result.partialFailures.length === 0) {
        result.status = 'completed';
      } else if (result.invoicesCreated > 0) {
        result.status = 'partial';
      } else {
        result.status = 'failed';
      }

      // Update billing run record
      if (!dryRun && runId) {
        await supabase
          .from('billing_runs')
          .update({
            status: result.status,
            total_customers: result.totalCustomers,
            customers_processed: result.customersProcessed,
            invoices_created: result.invoicesCreated,
            invoices_failed: result.invoicesFailed,
            pdfs_generated: result.pdfsGenerated,
            pdfs_failed: result.pdfsFailed,
            emails_sent: result.emailsSent,
            emails_failed: result.emailsFailed,
            total_amount: result.totalAmount,
            finished_at: new Date().toISOString(),
            error: result.errors.length > 0 ? JSON.stringify({
              errors: result.errors,
              partialFailures: result.partialFailures,
            }) : null,
          })
          .eq('id', runId);
      }

    } catch (error) {
      // Fatal error - mark run as failed
      result.status = 'failed';
      
      if (!dryRun && runId) {
        await supabase
          .from('billing_runs')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', runId);
      }
      
      throw error;
    }

    return new Response(
      JSON.stringify({
        success: result.status !== 'failed',
        result,
        message: formatResultMessage(result, dryRun),
      }),
      { 
        status: result.status === 'failed' ? 500 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in generate-invoices function:', error);
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
 * Custom error for partial failures
 */
class PartialFailureError extends Error {
  constructor(
    message: string,
    public invoiceId?: string,
    public amount?: number,
    public pdfGenerated?: boolean,
    public emailSent?: boolean
  ) {
    super(message);
    this.name = 'PartialFailureError';
  }
}

/**
 * Process a single customer's invoice
 */
async function processCustomerInvoice(
  supabase: SupabaseClient,
  customer: any,
  ratePlan: any,
  template: any,
  options: {
    tenantId: string;
    periodStart: string;
    periodEnd: string;
    dryRun: boolean;
    generatePdfs: boolean;
    sendEmails: boolean;
    resendApiKey?: string;
  }
): Promise<{
  invoiceId?: string;
  amount: number;
  pdfGenerated: boolean;
  emailSent: boolean;
}> {
  const result = {
    invoiceId: undefined as string | undefined,
    amount: 0,
    pdfGenerated: false,
    emailSent: false,
  };

  // Get readings for the period
  const { data: readings, error: readingsError } = await supabase
    .from('meter_readings')
    .select('*')
    .eq('customer_id', customer.id)
    .gte('reading_date', options.periodStart)
    .lte('reading_date', options.periodEnd)
    .order('reading_date', { ascending: false });

  if (readingsError) throw readingsError;

  if (!readings || readings.length === 0) {
    throw new Error(`No readings for customer ${customer.id} in period`);
  }

  // Calculate total consumption
  const totalConsumption = readings.reduce(
    (sum, r) => sum + (r.consumption || 0), 
    0
  );

  // Get first and last readings
  const currentReading = readings[0];
  const previousReading = readings[readings.length - 1];

  // Calculate charges
  const charges = calculateCharges(totalConsumption, ratePlan, template);
  result.amount = charges.totalAmount;

  if (options.dryRun) {
    // Dry run - just return calculated values
    return result;
  }

  // Get next invoice number
  const { data: invoiceNumber, error: numberError } = await supabase
    .rpc('next_invoice_number', { p_tenant_id: options.tenantId });

  if (numberError) throw numberError;

  // Calculate due date (30 days from period end)
  const dueDate = new Date(options.periodEnd);
  dueDate.setDate(dueDate.getDate() + 30);

  // Create invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      tenant_id: options.tenantId,
      customer_id: customer.id,
      invoice_number: invoiceNumber,
      period_start: options.periodStart,
      period_end: options.periodEnd,
      consumption: totalConsumption,
      subtotal: charges.subtotal,
      tax_amount: charges.taxAmount,
      discount_amount: charges.discountAmount,
      total_amount: charges.totalAmount,
      currency: ratePlan.currency || 'USD',
      due_date: dueDate.toISOString().split('T')[0],
      status: 'draft', // Start as draft, update after PDF/email
      issued_at: new Date().toISOString(),
      previous_reading_id: previousReading.id,
      current_reading_id: currentReading.id,
      previous_reading: previousReading.reading,
      current_reading: currentReading.reading,
    })
    .select()
    .single();

  if (invoiceError) throw invoiceError;

  result.invoiceId = invoice.id;

  // Create line items
  if (charges.items.length > 0) {
    const { error: itemsError } = await supabase
      .from('invoice_line_items')
      .insert(
        charges.items.map(item => ({
          invoice_id: invoice.id,
          ...item,
        }))
      );

    if (itemsError) throw itemsError;
  }

  let pdfError: Error | null = null;
  let emailError: Error | null = null;

  // Generate PDF if requested
  if (options.generatePdfs) {
    try {
      await withRetry(
        async () => {
          const pdfPath = await generateInvoicePDF(supabase, invoice, customer, options.tenantId);
          
          // Update invoice with PDF path
          const { error: updateError } = await supabase
            .from('invoices')
            .update({ pdf_path: pdfPath })
            .eq('id', invoice.id);

          if (updateError) throw updateError;
          
          result.pdfGenerated = true;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 2000,
        }
      );
    } catch (error) {
      pdfError = error instanceof Error ? error : new Error('PDF generation failed');
      console.error(`Failed to generate PDF for invoice ${invoice.id}:`, error);
    }
  }

  // Send email if requested
  if (options.sendEmails && options.resendApiKey) {
    try {
      await withRetry(
        async () => {
          await sendInvoiceEmail(
            supabase,
            invoice,
            customer,
            options.tenantId,
            options.resendApiKey!
          );
          
          result.emailSent = true;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 3000,
        }
      );
    } catch (error) {
      emailError = error instanceof Error ? error : new Error('Email sending failed');
      console.error(`Failed to send email for invoice ${invoice.id}:`, error);
    }
  }

  // Update invoice status based on results
  let newStatus = 'draft';
  if (result.emailSent) {
    newStatus = 'sent';
  } else if (pdfError || emailError) {
    newStatus = 'error';
  }

  const { error: statusUpdateError } = await supabase
    .from('invoices')
    .update({ 
      status: newStatus,
      error_details: (pdfError || emailError) ? {
        pdfError: pdfError?.message,
        emailError: emailError?.message,
      } : null,
    })
    .eq('id', invoice.id);

  if (statusUpdateError) {
    console.error('Failed to update invoice status:', statusUpdateError);
  }

  // If invoice was created but PDF/email failed, throw partial failure
  if (pdfError || emailError) {
    throw new PartialFailureError(
      `Invoice created but ${pdfError ? 'PDF generation' : ''} ${pdfError && emailError ? 'and ' : ''} ${emailError ? 'email sending' : ''} failed`,
      invoice.id,
      result.amount,
      result.pdfGenerated,
      result.emailSent
    );
  }

  return result;
}

/**
 * Add failed email to dead letter queue
 */
async function addToDeadLetterQueue(
  supabase: SupabaseClient,
  data: {
    tenantId: string;
    invoiceId: string;
    customerId: string;
    error: string;
    metadata?: any;
  }
) {
  try {
    await supabase
      .from('email_dead_letter_queue')
      .insert({
        tenant_id: data.tenantId,
        invoice_id: data.invoiceId,
        customer_id: data.customerId,
        error_message: data.error,
        retry_count: 0,
        max_retries: 5,
        next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes
        metadata: data.metadata,
      });
  } catch (error) {
    console.error('Failed to add to dead letter queue:', error);
  }
}

/**
 * Placeholder for PDF generation - implement with your PDF service
 */
async function generateInvoicePDF(
  supabase: SupabaseClient,
  invoice: any,
  customer: any,
  tenantId: string
): Promise<string> {
  // TODO: Implement actual PDF generation
  // This should call your PDF generation service and upload to storage
  
  // For now, return a placeholder path
  const pdfPath = `invoices/${tenantId}/${invoice.invoice_number}.pdf`;
  
  // Simulate PDF generation
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return pdfPath;
}

/**
 * Placeholder for email sending - implement with your email service
 */
async function sendInvoiceEmail(
  supabase: SupabaseClient,
  invoice: any,
  customer: any,
  tenantId: string,
  resendApiKey: string
): Promise<void> {
  // TODO: Implement actual email sending
  // This should call your email service (Resend)
  
  // For now, just log
  console.log(`Would send email for invoice ${invoice.id} to customer ${customer.email}`);
  
  // Simulate email sending
  await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * Calculate charges (existing implementation)
 */
function calculateCharges(
  consumption: number,
  ratePlan: any,
  template: any
): {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  items: any[];
} {
  const items = [];
  let subtotal = 0;
  let lineNumber = 1;

  // Add base charge if any
  if (ratePlan.base_charge && ratePlan.base_charge > 0) {
    items.push({
      line_number: lineNumber++,
      item_type: 'fee',
      description: 'Base Service Charge',
      quantity: 1,
      unit_price: ratePlan.base_charge,
      amount: ratePlan.base_charge,
      tax_rate: 0,
      tax_amount: 0,
    });
    subtotal += ratePlan.base_charge;
  }

  // Calculate tiered consumption charges
  if (ratePlan.rate_tiers && ratePlan.rate_tiers.length > 0) {
    const sortedTiers = ratePlan.rate_tiers.sort((a: any, b: any) => a.from_qty - b.from_qty);
    let remainingConsumption = consumption;

    for (const tier of sortedTiers) {
      if (remainingConsumption <= 0) break;

      const tierConsumption = tier.up_to_qty
        ? Math.min(remainingConsumption, tier.up_to_qty - tier.from_qty)
        : remainingConsumption;

      const tierAmount = tierConsumption * tier.price_per_unit;
      
      if (tierConsumption > 0) {
        items.push({
          line_number: lineNumber++,
          item_type: 'consumption',
          description: tier.description || `Tier ${tier.tier_index}: ${tier.from_qty}-${tier.up_to_qty || '+'} gallons`,
          quantity: tierConsumption,
          unit_price: tier.price_per_unit,
          amount: tierAmount,
          tax_rate: 0,
          tax_amount: 0,
        });
        subtotal += tierAmount;
        remainingConsumption -= tierConsumption;
      }
    }
  } else {
    // Flat rate if no tiers
    const amount = consumption * (ratePlan.base_rate || 0);
    if (amount > 0) {
      items.push({
        line_number: lineNumber++,
        item_type: 'consumption',
        description: 'Water consumption',
        quantity: consumption,
        unit_price: ratePlan.base_rate || 0,
        amount,
        tax_rate: 0,
        tax_amount: 0,
      });
      subtotal += amount;
    }
  }

  // Add fixed charges from template
  if (template && template.fixed_charges) {
    for (const charge of template.fixed_charges) {
      items.push({
        line_number: lineNumber++,
        item_type: 'fee',
        description: charge.description,
        quantity: 1,
        unit_price: charge.amount,
        amount: charge.amount,
        tax_rate: 0,
        tax_amount: 0,
      });
      subtotal += charge.amount;
    }
  }

  // Calculate tax
  const taxRate = template?.tax_rate || ratePlan.tax_rate || 0;
  const taxAmount = subtotal * taxRate;

  if (taxAmount > 0) {
    items.push({
      line_number: lineNumber++,
      item_type: 'tax',
      description: `Tax (${(taxRate * 100).toFixed(2)}%)`,
      quantity: 1,
      unit_price: taxAmount,
      amount: taxAmount,
      tax_rate: taxRate,
      tax_amount: 0,
    });
  }

  const discountAmount = 0; // Implement discount logic as needed
  const totalAmount = subtotal + taxAmount - discountAmount;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
    items,
  };
}

/**
 * Map billing run to result format
 */
function mapRunToResult(run: any): BillingRunResult {
  return {
    runId: run.id,
    status: run.status,
    totalCustomers: run.total_customers || 0,
    customersProcessed: run.customers_processed || 0,
    invoicesCreated: run.invoices_created || 0,
    invoicesFailed: run.invoices_failed || 0,
    pdfsGenerated: run.pdfs_generated || 0,
    pdfsFailed: run.pdfs_failed || 0,
    emailsSent: run.emails_sent || 0,
    emailsFailed: run.emails_failed || 0,
    totalAmount: run.total_amount || 0,
    errors: [],
    partialFailures: [],
  };
}

/**
 * Format result message
 */
function formatResultMessage(result: BillingRunResult, dryRun: boolean): string {
  if (dryRun) {
    return `Dry run completed. Would process ${result.totalCustomers} customers, creating ${result.invoicesCreated} invoices totaling ${result.totalAmount}`;
  }

  if (result.status === 'completed') {
    return `Successfully processed ${result.customersProcessed} customers. Created ${result.invoicesCreated} invoices, generated ${result.pdfsGenerated} PDFs, sent ${result.emailsSent} emails. Total amount: ${result.totalAmount}`;
  } else if (result.status === 'partial') {
    return `Partially completed. Processed ${result.customersProcessed}/${result.totalCustomers} customers. Created ${result.invoicesCreated} invoices (${result.invoicesFailed} failed). PDFs: ${result.pdfsGenerated} generated, ${result.pdfsFailed} failed. Emails: ${result.emailsSent} sent, ${result.emailsFailed} failed.`;
  } else {
    return `Billing run failed. ${result.errors.length} errors occurred.`;
  }
}