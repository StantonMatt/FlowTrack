import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

// GET - Retrieve invoice details with all related data
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tenantId = user.user_metadata?.tenant_id;
    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant associated with user' },
        { status: 400 }
      );
    }

    const invoiceId = params.id;

    // Fetch invoice with all related data
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        *,
        customer:customers(
          id,
          account_number,
          full_name,
          email,
          phone,
          billing_address,
          service_address,
          meter_number,
          created_at
        ),
        items:invoice_items(
          id,
          description,
          quantity,
          unit_price,
          amount,
          metadata,
          created_at
        ),
        payments:payments(
          id,
          amount,
          payment_date,
          payment_method,
          reference_number,
          status,
          metadata
        )
      `)
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Calculate summary statistics
    const totalPaid = invoice.payments?.reduce((sum: number, payment: any) => {
      if (payment.status === 'completed') {
        return sum + payment.amount;
      }
      return sum;
    }, 0) || 0;

    const balanceDue = invoice.total_amount - totalPaid;
    const isOverdue = invoice.status !== 'paid' && 
      new Date(invoice.due_date) < new Date();

    // Format response
    const response = {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      status: invoice.status,
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      billingPeriodStart: invoice.billing_period_start,
      billingPeriodEnd: invoice.billing_period_end,
      subtotal: invoice.subtotal,
      taxAmount: invoice.tax_amount,
      taxRate: invoice.tax_rate,
      discountAmount: invoice.discount_amount,
      totalAmount: invoice.total_amount,
      notes: invoice.notes,
      metadata: invoice.metadata,
      createdAt: invoice.created_at,
      updatedAt: invoice.updated_at,
      sentAt: invoice.sent_at,
      paidAt: invoice.paid_at,
      
      // PDF information (no public URL included)
      hasPdf: !!invoice.pdf_path,
      pdfGeneratedAt: invoice.pdf_generated_at,
      
      // Payment information
      stripeInvoiceId: invoice.stripe_invoice_id,
      stripePaymentLink: invoice.stripe_payment_link,
      
      // Related data
      customer: invoice.customer,
      items: invoice.items || [],
      payments: invoice.payments || [],
      
      // Calculated fields
      totalPaid,
      balanceDue,
      isOverdue,
      isPaid: invoice.status === 'paid',
      
      // URLs for actions (client should build these)
      actions: {
        viewPdf: invoice.pdf_path ? `/api/invoices/${invoiceId}/pdf` : null,
        sendEmail: `/api/invoices/${invoiceId}/send`,
        downloadPdf: invoice.pdf_path ? `/api/invoices/${invoiceId}/pdf?download=true` : null,
        regeneratePdf: `/api/invoices/${invoiceId}/pdf`,
        payment: invoice.stripe_payment_link || null,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Get invoice error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve invoice' },
      { status: 500 }
    );
  }
}

// PATCH - Update invoice details
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tenantId = user.user_metadata?.tenant_id;
    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant associated with user' },
        { status: 400 }
      );
    }

    const invoiceId = params.id;

    // Parse request body
    const updateSchema = z.object({
      status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
      notes: z.string().optional(),
      metadata: z.record(z.any()).optional(),
      due_date: z.string().optional(),
      billing_period_start: z.string().optional(),
      billing_period_end: z.string().optional(),
    });

    const body = await request.json();
    const validatedData = updateSchema.parse(body);

    // Check if invoice exists and belongs to tenant
    const { data: existingInvoice, error: checkError } = await supabase
      .from('invoices')
      .select('id, status')
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single();

    if (checkError || !existingInvoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Prevent updating cancelled invoices
    if (existingInvoice.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot update cancelled invoice' },
        { status: 400 }
      );
    }

    // Prevent updating paid invoices (except to cancel)
    if (existingInvoice.status === 'paid' && validatedData.status !== 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot update paid invoice' },
        { status: 400 }
      );
    }

    // Update invoice
    const updateData: any = {
      ...validatedData,
      updated_at: new Date().toISOString(),
    };

    // Add status-specific timestamps
    if (validatedData.status === 'paid' && existingInvoice.status !== 'paid') {
      updateData.paid_at = new Date().toISOString();
    }
    if (validatedData.status === 'sent' && existingInvoice.status === 'draft') {
      updateData.sent_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      message: 'Invoice updated successfully',
      invoice: data,
    });
  } catch (error) {
    console.error('Update invoice error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update invoice' },
      { status: 500 }
    );
  }
}

// DELETE - Cancel/delete invoice
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tenantId = user.user_metadata?.tenant_id;
    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant associated with user' },
        { status: 400 }
      );
    }

    const invoiceId = params.id;

    // Check if invoice exists and can be deleted
    const { data: existingInvoice, error: checkError } = await supabase
      .from('invoices')
      .select('id, status, invoice_number')
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single();

    if (checkError || !existingInvoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Only allow deletion of draft invoices
    // For sent/paid invoices, use PATCH to set status to 'cancelled'
    if (existingInvoice.status !== 'draft') {
      return NextResponse.json(
        { 
          error: 'Only draft invoices can be deleted. Use PATCH to cancel sent invoices.',
          suggestion: 'PATCH /api/invoices/' + invoiceId + ' with { "status": "cancelled" }',
        },
        { status: 400 }
      );
    }

    // Delete invoice (cascade will handle invoice_items)
    const { error: deleteError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      message: 'Invoice deleted successfully',
      invoiceNumber: existingInvoice.invoice_number,
    });
  } catch (error) {
    console.error('Delete invoice error:', error);
    return NextResponse.json(
      { error: 'Failed to delete invoice' },
      { status: 500 }
    );
  }
}