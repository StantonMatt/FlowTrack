import { NextRequest, NextResponse } from 'next/server';
import { 
  withAuth, 
  withRole, 
  withReadRateLimit,
  withWriteRateLimit,
  parseAndValidateBody,
  handleApiError,
  successResponse,
  scopeToTenant,
  type ApiContext 
} from '@/lib/api/middleware';
import { 
  customerFiltersSchema,
  createCustomerSchema,
  type CustomerFilters,
  type CreateCustomer,
  type Customer,
  type PaginatedResponse
} from '@flowtrack/shared/schemas/customer';
import { AccountNumberGenerator } from '@flowtrack/shared/utils/account-number';

// ============================================
// GET /api/customers - List customers with filters
// ============================================
export const GET = withReadRateLimit()(async (req: NextRequest, context: ApiContext) => {
  try {
    const { searchParams } = new URL(req.url);
    
    // Parse and validate query parameters
    const filters = customerFiltersSchema.parse({
      q: searchParams.get('q') || undefined,
      status: searchParams.get('status') || undefined,
      meter_type: searchParams.get('meter_type') || undefined,
      rate_plan: searchParams.get('rate_plan') || undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20,
      sort_by: searchParams.get('sort_by') || 'created_at',
      sort_order: searchParams.get('sort_order') || 'desc',
    });

    const { supabase, tenantId } = context;
    
    // Build query
    let query = supabase
      .from('customers')
      .select('*', { count: 'exact' });

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

    // Apply status filter
    if (filters.status) {
      query = query.eq('status', filters.status);
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

    // Apply pagination
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    query = query.range(from, to);

    // Execute query
    const { data, error, count } = await query;

    if (error) throw error;

    // Build paginated response
    const response: PaginatedResponse<Customer> = {
      data: data || [],
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / filters.limit),
      },
    };

    return successResponse(response);
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================
// POST /api/customers - Create new customer
// ============================================
export const POST = withRole('operator')(async (req: NextRequest, context: ApiContext) => {
  try {
    const { data: customerData, error: validationError } = await parseAndValidateBody<CreateCustomer>(
      req,
      createCustomerSchema
    );

    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    const { supabase, tenantId } = context;

    // Generate account number
    const accountGenerator = new AccountNumberGenerator();
    const accountNumber = await accountGenerator.generate(supabase, tenantId);

    // Normalize addresses if Google Maps integration is available
    // TODO: Integrate with Google Maps API for address validation
    const normalizedBillingAddress = customerData!.billing_address;
    const normalizedServiceAddress = customerData!.service_address;

    // Create customer record
    const { data: customer, error: createError } = await supabase
      .from('customers')
      .insert({
        tenant_id: tenantId,
        account_number: accountNumber,
        email: customerData!.email,
        full_name: customerData!.full_name,
        phone: customerData!.phone,
        status: customerData!.status,
        billing_address: normalizedBillingAddress,
        service_address: normalizedServiceAddress,
        meter_id: customerData!.meter_id,
        meter_type: customerData!.meter_type,
        rate_plan: customerData!.rate_plan,
        metadata: customerData!.metadata,
      })
      .select()
      .single();

    if (createError) throw createError;

    // Log audit event
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: context.user.id,
      action: 'customer.create',
      resource_type: 'customer',
      resource_id: customer.id,
      changes: customer,
    });

    return NextResponse.json(
      { success: true, data: customer },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
});