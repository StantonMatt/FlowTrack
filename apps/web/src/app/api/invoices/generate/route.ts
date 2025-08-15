import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = user.user_metadata?.tenant_id;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 400 });
    }

    // Check user role - only admins can generate invoices
    const { data: userRole } = await supabase
      .from('user_tenant_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .single();

    if (!userRole || !['admin', 'owner', 'manager'].includes(userRole.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const {
      periodStart,
      periodEnd,
      dryRun = false,
      sendEmails = true,
      customTenantId,
    } = body;

    // Validate dates
    if (!periodStart || !periodEnd) {
      return NextResponse.json(
        { error: 'Period start and end dates are required' },
        { status: 400 }
      );
    }

    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    if (startDate >= endDate) {
      return NextResponse.json(
        { error: 'Period start must be before period end' },
        { status: 400 }
      );
    }

    // Use custom tenant ID if provided and user is owner/admin
    const targetTenantId = customTenantId && userRole.role === 'owner' 
      ? customTenantId 
      : tenantId;

    // Call the Edge Function
    const { data, error } = await supabase.functions.invoke('generate-invoices', {
      body: {
        tenantId: targetTenantId,
        periodStart: startDate.toISOString().split('T')[0],
        periodEnd: endDate.toISOString().split('T')[0],
        dryRun,
        sendEmails,
      },
    });

    if (error) {
      console.error('Edge function error:', error);
      return NextResponse.json(
        { error: 'Failed to generate invoices', details: error.message },
        { status: 500 }
      );
    }

    // Log the action
    await supabase.from('audit_logs').insert({
      tenant_id: targetTenantId,
      user_id: user.id,
      action: dryRun ? 'invoice_generation_dry_run' : 'invoice_generation',
      resource_type: 'invoice',
      changes: {
        period_start: periodStart,
        period_end: periodEnd,
        dry_run: dryRun,
        send_emails: sendEmails,
        result: data.result,
      },
    });

    return NextResponse.json({
      success: true,
      message: data.message,
      result: data.result,
    });
  } catch (error) {
    console.error('Generate invoices error:', error);
    return NextResponse.json(
      { error: 'Failed to generate invoices', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}