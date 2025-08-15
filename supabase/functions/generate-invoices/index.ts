import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface GenerateInvoicesRequest {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  dryRun?: boolean;
  sendEmails?: boolean;
}

interface BillingResult {
  success: number;
  failed: number;
  errors: Array<{ customerId: string; error: string }>;
  totalAmount: number;
  runId?: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { tenantId, periodStart, periodEnd, dryRun = false, sendEmails = true } = 
      await req.json() as GenerateInvoicesRequest;

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
          runId: existingRun.id,
          result: {
            success: existingRun.invoices_created,
            failed: 0,
            errors: [],
            totalAmount: existingRun.total_amount,
            runId: existingRun.id,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create or update billing run record
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
        }, {
          onConflict: 'tenant_id,period_start,period_end',
        })
        .select()
        .single();

      if (runError) throw runError;
      runId = billingRun.id;
    }

    const result: BillingResult = {
      success: 0,
      failed: 0,
      errors: [],
      totalAmount: 0,
      runId,
    };

    try {
      // Get active customers
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'active');

      if (customersError) throw customersError;

      // Get active rate plan
      const { data: ratePlan, error: ratePlanError } = await supabase
        .from('rate_plans')
        .select(`
          *,
          rate_tiers (*)
        `)
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .lte('effective_from', periodEnd)
        .or(`effective_to.is.null,effective_to.gte.${periodStart}`)
        .single();

      if (ratePlanError || !ratePlan) {
        throw new Error('No active rate plan found for the billing period');
      }

      // Get billing template
      const { data: template } = await supabase
        .from('billing_templates')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .single();

      // Update total customers count
      if (!dryRun && runId) {
        await supabase
          .from('billing_runs')
          .update({ total_customers: customers?.length || 0 })
          .eq('id', runId);
      }

      // Process each customer
      for (const customer of customers || []) {
        try {
          // Get readings for the period
          const { data: readings, error: readingsError } = await supabase
            .from('meter_readings')
            .select('*')
            .eq('customer_id', customer.id)
            .gte('reading_date', periodStart)
            .lte('reading_date', periodEnd)
            .order('reading_date', { ascending: false });

          if (readingsError) throw readingsError;

          if (!readings || readings.length === 0) {
            console.log(`No readings for customer ${customer.id} in period`);
            continue;
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
          const charges = calculateCharges(
            totalConsumption,
            ratePlan,
            template
          );

          if (!dryRun) {
            // Get next invoice number
            const { data: invoiceNumber } = await supabase
              .rpc('next_invoice_number', { p_tenant_id: tenantId });

            // Calculate due date (30 days from period end)
            const dueDate = new Date(periodEnd);
            dueDate.setDate(dueDate.getDate() + 30);

            // Create invoice
            const { data: invoice, error: invoiceError } = await supabase
              .from('invoices')
              .insert({
                tenant_id: tenantId,
                customer_id: customer.id,
                billing_period_id: null, // Set if you have billing periods
                invoice_number: invoiceNumber,
                period_start: periodStart,
                period_end: periodEnd,
                consumption: totalConsumption,
                subtotal: charges.subtotal,
                tax_amount: charges.taxAmount,
                discount_amount: charges.discountAmount,
                total_amount: charges.totalAmount,
                currency: ratePlan.currency || 'USD',
                due_date: dueDate.toISOString().split('T')[0],
                status: sendEmails ? 'sent' : 'draft',
                issued_at: new Date().toISOString(),
                previous_reading_id: previousReading.id,
                current_reading_id: currentReading.id,
                previous_reading: previousReading.reading,
                current_reading: currentReading.reading,
              })
              .select()
              .single();

            if (invoiceError) throw invoiceError;

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

            // TODO: Generate PDF and send email if sendEmails is true
            // This would call your PDF generation and email services

            result.success++;
            result.totalAmount += charges.totalAmount;
          } else {
            // Dry run - just calculate
            result.success++;
            result.totalAmount += charges.totalAmount;
          }

        } catch (error) {
          console.error(`Error processing customer ${customer.id}:`, error);
          result.failed++;
          result.errors.push({
            customerId: customer.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Update billing run status
      if (!dryRun && runId) {
        await supabase
          .from('billing_runs')
          .update({
            status: result.failed === 0 ? 'completed' : 'partial',
            customers_processed: result.success + result.failed,
            invoices_created: result.success,
            total_amount: result.totalAmount,
            finished_at: new Date().toISOString(),
            error: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
          })
          .eq('id', runId);
      }

    } catch (error) {
      // Mark run as failed
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
        success: true,
        result,
        message: dryRun 
          ? `Dry run completed. Would generate ${result.success} invoices totaling ${result.totalAmount}`
          : `Generated ${result.success} invoices successfully`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
 * Calculate charges based on consumption and rate structure
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