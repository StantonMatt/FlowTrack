import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExportRequest {
  reportType: 'billing_runs' | 'invoices' | 'reconciliation' | 'anomalies' | 'email_audit';
  tenantId?: string;
  periodStart?: string;
  periodEnd?: string;
  format?: 'csv' | 'json';
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

    const body: ExportRequest = await req.json();
    const { reportType, tenantId, periodStart, periodEnd, format = 'csv' } = body;

    // Check user has access to tenant
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

    let query;
    let filename: string;

    // Build query based on report type
    switch (reportType) {
      case 'billing_runs':
        query = supabase.from('v_billing_runs_summary').select('*');
        filename = 'billing_runs_summary';
        if (tenantId) query = query.eq('tenant_id', tenantId);
        if (periodStart) query = query.gte('period_start', periodStart);
        if (periodEnd) query = query.lte('period_end', periodEnd);
        break;

      case 'invoices':
        query = supabase.from('v_invoices_summary').select('*');
        filename = 'invoices_summary';
        if (tenantId) query = query.eq('tenant_id', tenantId);
        if (periodStart) query = query.gte('period_start', periodStart);
        if (periodEnd) query = query.lte('period_end', periodEnd);
        break;

      case 'reconciliation':
        query = supabase.from('v_billing_reconciliation').select('*');
        filename = 'billing_reconciliation';
        if (tenantId) query = query.eq('tenant_id', tenantId);
        query = query.neq('reconciliation_status', 'OK'); // Only show discrepancies
        break;

      case 'anomalies':
        query = supabase.from('v_billing_anomalies').select('*');
        filename = 'billing_anomalies';
        if (tenantId) query = query.eq('tenant_id', tenantId);
        break;

      case 'email_audit':
        query = supabase.from('v_email_delivery_audit').select('*');
        filename = 'email_delivery_audit';
        if (tenantId) query = query.eq('tenant_id', tenantId);
        if (periodStart) query = query.gte('billing_month', periodStart);
        if (periodEnd) query = query.lte('billing_month', periodEnd);
        query = query.neq('delivery_status', 'DELIVERED'); // Focus on issues
        break;

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid report type' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    // Execute query
    const { data, error } = await query;

    if (error) {
      console.error('Query error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch report data', details: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No data found for the specified criteria' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return JSON if requested
    if (format === 'json') {
      return new Response(
        JSON.stringify({ data, count: data.length }),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}.json"`
          } 
        }
      );
    }

    // Convert to CSV
    const csvContent = convertToCSV(data);
    
    // Add timestamp to filename
    const timestamp = new Date().toISOString().split('T')[0];
    const fullFilename = `${filename}_${timestamp}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${fullFilename}"`,
      },
    });

  } catch (error) {
    console.error('Export error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function convertToCSV(data: any[]): string {
  if (!data || data.length === 0) return '';

  // Get headers from first object
  const headers = Object.keys(data[0]);
  
  // Build CSV content
  const csvRows = [];
  
  // Add headers
  csvRows.push(headers.map(h => escapeCSV(h)).join(','));
  
  // Add data rows
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      return escapeCSV(value);
    });
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
}

function escapeCSV(value: any): string {
  if (value === null || value === undefined) return '';
  
  // Convert to string
  let str = String(value);
  
  // Handle JSON objects
  if (typeof value === 'object') {
    str = JSON.stringify(value);
  }
  
  // Escape quotes and wrap in quotes if needed
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  
  return str;
}