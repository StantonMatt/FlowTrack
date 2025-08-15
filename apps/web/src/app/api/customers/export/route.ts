import { NextRequest, NextResponse } from 'next/server';
import { 
  withAuth, 
  withRole,
  scopeToTenant,
  type ApiContext 
} from '@/lib/api/middleware';
import { customerFiltersSchema } from '@flowtrack/shared/schemas/customer';

// ============================================
// GET /api/customers/export - Export customers as CSV
// ============================================
export const GET = withRole('viewer')(async (req: NextRequest, context: ApiContext) => {
  try {
    const { searchParams } = new URL(req.url);
    
    // Parse and validate query parameters (same as list endpoint)
    const filters = customerFiltersSchema.parse({
      q: searchParams.get('q') || undefined,
      status: searchParams.get('status') || undefined,
      meter_type: searchParams.get('meter_type') || undefined,
      rate_plan: searchParams.get('rate_plan') || undefined,
      sort_by: searchParams.get('sort_by') || 'created_at',
      sort_order: searchParams.get('sort_order') || 'desc',
    });

    const { supabase, tenantId, user } = context;
    const includeDeleted = searchParams.get('includeDeleted') === 'true' && user.role === 'admin';
    
    // Build query
    let query = supabase
      .from('customers')
      .select('*');

    // Apply tenant scoping
    query = scopeToTenant(query, tenantId);

    // Apply search filter
    if (filters.q) {
      query = query.or(
        `full_name.ilike.%${filters.q}%,` +
        `email.ilike.%${filters.q}%,` +
        `account_number.ilike.%${filters.q}%,` +
        `meter_id.ilike.%${filters.q}%`
      );
    }

    // Apply status filter (or exclude inactive if not including deleted)
    if (filters.status) {
      query = query.eq('status', filters.status);
    } else if (!includeDeleted) {
      query = query.neq('status', 'inactive');
    }

    // Apply meter type filter
    if (filters.meter_type) {
      query = query.eq('meter_type', filters.meter_type);
    }

    // Apply rate plan filter
    if (filters.rate_plan) {
      query = query.eq('rate_plan', filters.rate_plan);
    }

    // Apply sorting
    const ascending = filters.sort_order === 'asc';
    query = query.order(filters.sort_by, { ascending });

    // Execute query (no pagination for export)
    const { data: customers, error } = await query;

    if (error) throw error;

    // Create CSV header
    const headers = [
      'Account Number',
      'Full Name',
      'Email',
      'Phone',
      'Status',
      'Meter ID',
      'Meter Type',
      'Rate Plan',
      'Billing Street',
      'Billing City',
      'Billing State',
      'Billing ZIP',
      'Service Street',
      'Service City',
      'Service State',
      'Service ZIP',
      'Created Date',
      'Updated Date',
    ];

    // Helper function to escape CSV values
    const escapeCSV = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Helper function to extract address fields
    const getAddress = (address: Record<string, unknown> | null | undefined) => ({
      street: address?.street || '',
      city: address?.city || '',
      state: address?.state || '',
      zip: address?.zip || '',
    });

    // Build CSV content
    const csvRows = [headers.join(',')];
    
    for (const customer of customers || []) {
      const billingAddr = getAddress(customer.billing_address);
      const serviceAddr = getAddress(customer.service_address);
      
      const row = [
        escapeCSV(customer.account_number),
        escapeCSV(customer.full_name),
        escapeCSV(customer.email),
        escapeCSV(customer.phone),
        escapeCSV(customer.status),
        escapeCSV(customer.meter_id),
        escapeCSV(customer.meter_type),
        escapeCSV(customer.rate_plan),
        escapeCSV(billingAddr.street),
        escapeCSV(billingAddr.city),
        escapeCSV(billingAddr.state),
        escapeCSV(billingAddr.zip),
        escapeCSV(serviceAddr.street),
        escapeCSV(serviceAddr.city),
        escapeCSV(serviceAddr.state),
        escapeCSV(serviceAddr.zip),
        escapeCSV(new Date(customer.created_at).toLocaleDateString()),
        escapeCSV(new Date(customer.updated_at).toLocaleDateString()),
      ];
      
      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');

    // Log export event
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: context.user.id,
      action: 'customer.export',
      resource_type: 'customers',
      changes: {
        count: customers?.length || 0,
        filters,
        includeDeleted,
      },
    });

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    const filename = `customers-${date}.csv`;

    // Return CSV response
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
});