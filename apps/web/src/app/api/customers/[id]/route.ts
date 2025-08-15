import { NextRequest, NextResponse } from 'next/server';
import { 
  withAuth, 
  withRole, 
  parseAndValidateBody,
  handleApiError,
  successResponse,
  validateTenantAccess,
  type ApiContext 
} from '@/lib/api/middleware';
import { 
  updateCustomerSchema,
  type UpdateCustomer,
  type Customer 
} from '@flowtrack/shared/schemas/customer';

// ============================================
// GET /api/customers/[id] - Get customer details
// ============================================
export const GET = withAuth(async (
  req: NextRequest, 
  context: ApiContext,
  { params }: { params: { id: string } }
) => {
  try {
    const { supabase, tenantId } = context;
    const customerId = params.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(customerId)) {
      return NextResponse.json(
        { error: 'Invalid customer ID format' },
        { status: 400 }
      );
    }

    // Fetch customer
    const { data: customer, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Customer not found' },
          { status: 404 }
        );
      }
      throw error;
    }

    // Validate tenant access
    if (!validateTenantAccess(customer, tenantId)) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    return successResponse(customer);
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================
// PUT /api/customers/[id] - Update customer
// ============================================
export const PUT = withRole('operator')(async (
  req: NextRequest,
  context: ApiContext,
  { params }: { params: { id: string } }
) => {
  try {
    const { supabase, tenantId } = context;
    const customerId = params.id;

    // Parse and validate request body
    const body = await req.json();
    const { data: updateData, error: validationError } = await parseAndValidateBody<UpdateCustomer>(
      req,
      updateCustomerSchema.extend({ id: customerId })
    );

    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    // Check if customer exists and belongs to tenant
    const { data: existingCustomer, error: fetchError } = await supabase
      .from('customers')
      .select('id, tenant_id')
      .eq('id', customerId)
      .single();

    if (fetchError || !existingCustomer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    if (!validateTenantAccess(existingCustomer, tenantId)) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    // Remove id from update data
    const { id, ...updateFields } = updateData!;

    // TODO: If addresses changed, validate with Google Maps API
    
    // Update customer
    const { data: updatedCustomer, error: updateError } = await supabase
      .from('customers')
      .update({
        ...updateFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log audit event
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: context.user.id,
      action: 'customer.update',
      resource_type: 'customer',
      resource_id: customerId,
      changes: updateFields,
    });

    return successResponse(updatedCustomer);
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================
// DELETE /api/customers/[id] - Soft delete customer
// ============================================
export const DELETE = withRole('admin')(async (
  req: NextRequest,
  context: ApiContext,
  { params }: { params: { id: string } }
) => {
  try {
    const { supabase, tenantId } = context;
    const customerId = params.id;
    
    // Check for 'permanent' query parameter for hard delete
    const { searchParams } = new URL(req.url);
    const isPermanent = searchParams.get('permanent') === 'true';

    // Check if customer exists and belongs to tenant
    const { data: existingCustomer, error: fetchError } = await supabase
      .from('customers')
      .select('id, tenant_id, status')
      .eq('id', customerId)
      .single();

    if (fetchError || !existingCustomer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    if (!validateTenantAccess(existingCustomer, tenantId)) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    // Check for related records before deletion
    const { count: invoiceCount } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('customer_id', customerId);

    const { count: readingCount } = await supabase
      .from('meter_readings')
      .select('*', { count: 'exact', head: true })
      .eq('customer_id', customerId);

    if ((invoiceCount! > 0 || readingCount! > 0) && isPermanent) {
      return NextResponse.json(
        { 
          error: 'Cannot permanently delete customer with existing invoices or readings',
          details: {
            invoices: invoiceCount,
            readings: readingCount,
          }
        },
        { status: 409 }
      );
    }

    if (isPermanent) {
      // Hard delete (only if no related records)
      const { error: deleteError } = await supabase
        .from('customers')
        .delete()
        .eq('id', customerId);

      if (deleteError) throw deleteError;

      // Log audit event
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId,
        user_id: context.user.id,
        action: 'customer.delete.permanent',
        resource_type: 'customer',
        resource_id: customerId,
      });

      return NextResponse.json(
        { success: true, message: 'Customer permanently deleted' },
        { status: 200 }
      );
    } else {
      // Soft delete (mark as inactive)
      const { data: updatedCustomer, error: updateError } = await supabase
        .from('customers')
        .update({
          status: 'inactive',
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId)
        .select()
        .single();

      if (updateError) throw updateError;

      // Log audit event
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId,
        user_id: context.user.id,
        action: 'customer.delete.soft',
        resource_type: 'customer',
        resource_id: customerId,
      });

      return successResponse({
        message: 'Customer deactivated',
        customer: updatedCustomer,
      });
    }
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================
// PATCH /api/customers/[id] - Restore soft-deleted customer
// ============================================
export const PATCH = withRole('manager')(async (
  req: NextRequest,
  context: ApiContext,
  { params }: { params: { id: string } }
) => {
  try {
    const { supabase, tenantId } = context;
    const customerId = params.id;
    
    // Parse action from body
    const body = await req.json();
    const action = body.action;

    if (action !== 'restore') {
      return NextResponse.json(
        { error: 'Invalid action. Only "restore" is supported' },
        { status: 400 }
      );
    }

    // Check if customer exists and is inactive
    const { data: existingCustomer, error: fetchError } = await supabase
      .from('customers')
      .select('id, tenant_id, status')
      .eq('id', customerId)
      .single();

    if (fetchError || !existingCustomer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    if (!validateTenantAccess(existingCustomer, tenantId)) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    if (existingCustomer.status !== 'inactive') {
      return NextResponse.json(
        { error: 'Customer is not inactive' },
        { status: 400 }
      );
    }

    // Restore customer
    const { data: restoredCustomer, error: updateError } = await supabase
      .from('customers')
      .update({
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log audit event
    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
      user_id: context.user.id,
      action: 'customer.restore',
      resource_type: 'customer',
      resource_id: customerId,
    });

    return successResponse({
      message: 'Customer restored',
      customer: restoredCustomer,
    });
  } catch (error) {
    return handleApiError(error);
  }
});