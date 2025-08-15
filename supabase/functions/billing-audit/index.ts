import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuditRequest {
  action: 'summary' | 'anomalies' | 'reconciliation' | 'email_audit' | 'run_details';
  tenantId?: string;
  runId?: string;
  periodStart?: string;
  periodEnd?: string;
  limit?: number;
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

    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: AuditRequest = await req.json();
    const { action, tenantId, runId, periodStart, periodEnd, limit = 100 } = body;

    // Check user has access to tenant if specified
    if (tenantId) {
      const { data: userRole } = await supabase
        .from('user_tenant_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('tenant_id', tenantId)
        .single();

      if (!userRole || !['admin', 'manager', 'office_clerk'].includes(userRole.role)) {
        return new Response(
          JSON.stringify({ error: 'Insufficient permissions' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    let result: any = {};

    switch (action) {
      case 'summary': {
        // Get billing runs summary
        let runsQuery = supabase
          .from('v_billing_runs_summary')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);
        
        if (tenantId) runsQuery = runsQuery.eq('tenant_id', tenantId);
        if (periodStart) runsQuery = runsQuery.gte('period_start', periodStart);
        if (periodEnd) runsQuery = runsQuery.lte('period_end', periodEnd);
        
        const { data: runs, error: runsError } = await runsQuery;
        if (runsError) throw runsError;

        // Get invoices summary
        let invoicesQuery = supabase
          .from('v_invoices_summary')
          .select('*')
          .order('billing_month', { ascending: false })
          .limit(limit);
        
        if (tenantId) invoicesQuery = invoicesQuery.eq('tenant_id', tenantId);
        if (periodStart) invoicesQuery = invoicesQuery.gte('period_start', periodStart);
        if (periodEnd) invoicesQuery = invoicesQuery.lte('period_end', periodEnd);
        
        const { data: invoices, error: invoicesError } = await invoicesQuery;
        if (invoicesError) throw invoicesError;

        // Calculate aggregate statistics
        const stats = calculateAggregateStats(runs, invoices);

        result = {
          runs,
          invoices,
          statistics: stats,
        };
        break;
      }

      case 'anomalies': {
        let query = supabase
          .from('v_billing_anomalies')
          .select('*')
          .order('count', { ascending: false });
        
        if (tenantId) query = query.eq('tenant_id', tenantId);
        
        const { data: anomalies, error } = await query;
        if (error) throw error;

        // Group anomalies by type
        const groupedAnomalies = anomalies.reduce((acc: any, anomaly: any) => {
          if (!acc[anomaly.anomaly_type]) {
            acc[anomaly.anomaly_type] = [];
          }
          acc[anomaly.anomaly_type].push(anomaly);
          return acc;
        }, {});

        result = {
          anomalies: groupedAnomalies,
          totalAnomalies: anomalies.reduce((sum: number, a: any) => sum + a.count, 0),
          types: Object.keys(groupedAnomalies),
        };
        break;
      }

      case 'reconciliation': {
        let query = supabase
          .from('v_billing_reconciliation')
          .select('*')
          .order('discrepancy_amount', { ascending: false })
          .limit(limit);
        
        if (tenantId) query = query.eq('tenant_id', tenantId);
        
        const { data: discrepancies, error } = await query;
        if (error) throw error;

        // Calculate totals
        const totalDiscrepancy = discrepancies.reduce((sum: number, d: any) => 
          sum + (d.discrepancy_amount || 0), 0);
        
        const byStatus = discrepancies.reduce((acc: any, d: any) => {
          acc[d.reconciliation_status] = (acc[d.reconciliation_status] || 0) + 1;
          return acc;
        }, {});

        result = {
          discrepancies,
          summary: {
            totalRecords: discrepancies.length,
            totalDiscrepancyAmount: totalDiscrepancy,
            byStatus,
          },
        };
        break;
      }

      case 'email_audit': {
        let query = supabase
          .from('v_email_delivery_audit')
          .select('*')
          .order('invoice_created', { ascending: false })
          .limit(limit);
        
        if (tenantId) query = query.eq('tenant_id', tenantId);
        if (periodStart) query = query.gte('billing_month', periodStart);
        if (periodEnd) query = query.lte('billing_month', periodEnd);
        
        const { data: emails, error } = await query;
        if (error) throw error;

        // Calculate delivery statistics
        const deliveryStats = emails.reduce((acc: any, e: any) => {
          acc[e.delivery_status] = (acc[e.delivery_status] || 0) + 1;
          return acc;
        }, {});

        const avgDeliveryTime = emails
          .filter((e: any) => e.minutes_to_send)
          .reduce((sum: number, e: any, _, arr: any[]) => 
            sum + e.minutes_to_send / arr.length, 0);

        result = {
          emails,
          summary: {
            totalEmails: emails.length,
            deliveryStats,
            averageDeliveryTimeMinutes: avgDeliveryTime,
            failedCount: deliveryStats['PERMANENTLY_FAILED'] || 0,
            pendingRetry: deliveryStats['RETRY_PENDING'] || 0,
          },
        };
        break;
      }

      case 'run_details': {
        if (!runId) {
          return new Response(
            JSON.stringify({ error: 'runId is required for run_details action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get run details
        const { data: run, error: runError } = await supabase
          .from('v_billing_runs_summary')
          .select('*')
          .eq('id', runId)
          .single();
        
        if (runError) throw runError;

        // Get invoices for this run
        const { data: invoices, error: invoicesError } = await supabase
          .from('invoices')
          .select(`
            *,
            customer:customers(name, email),
            line_items:invoice_line_items(*)
          `)
          .eq('tenant_id', run.tenant_id)
          .eq('period_start', run.period_start)
          .eq('period_end', run.period_end)
          .limit(limit);
        
        if (invoicesError) throw invoicesError;

        // Get error samples if any
        const errorInvoices = invoices.filter((i: any) => i.status === 'error');

        result = {
          run,
          invoices: {
            total: invoices.length,
            successful: invoices.filter((i: any) => i.status === 'sent' || i.status === 'paid').length,
            errors: errorInvoices.length,
            samples: invoices.slice(0, 10), // First 10 as samples
            errorSamples: errorInvoices.slice(0, 5), // Error samples
          },
          performance: {
            processingTimeSeconds: run.processing_seconds,
            averageTimePerCustomer: run.processing_seconds / (run.processed_count || 1),
            successRate: run.success_rate_percent,
          },
        };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Audit error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function calculateAggregateStats(runs: any[], invoices: any[]): any {
  if (!runs || !invoices) return {};

  const totalRuns = runs.length;
  const successfulRuns = runs.filter(r => r.status === 'completed').length;
  const totalInvoices = invoices.reduce((sum, i) => sum + (i.total_invoices || 0), 0);
  const totalAmount = invoices.reduce((sum, i) => sum + (i.total_amount || 0), 0);
  const totalTax = invoices.reduce((sum, i) => sum + (i.total_tax || 0), 0);
  const overdueAmount = invoices.reduce((sum, i) => sum + (i.total_overdue_amount || 0), 0);

  return {
    billing: {
      totalRuns,
      successfulRuns,
      failedRuns: totalRuns - successfulRuns,
      successRate: totalRuns > 0 ? ((successfulRuns / totalRuns) * 100).toFixed(2) : 0,
    },
    invoices: {
      totalGenerated: totalInvoices,
      totalAmount: totalAmount.toFixed(2),
      totalTax: totalTax.toFixed(2),
      overdueAmount: overdueAmount.toFixed(2),
      averageInvoiceAmount: totalInvoices > 0 ? (totalAmount / totalInvoices).toFixed(2) : 0,
    },
    issues: {
      missingPDFs: invoices.reduce((sum, i) => sum + (i.missing_pdf_count || 0), 0),
      unsentEmails: invoices.reduce((sum, i) => sum + (i.not_emailed_count || 0), 0),
      zeroAmountInvoices: invoices.reduce((sum, i) => sum + (i.zero_amount_invoices || 0), 0),
      overdueInvoices: invoices.reduce((sum, i) => sum + (i.overdue_count || 0), 0),
    },
  };
}