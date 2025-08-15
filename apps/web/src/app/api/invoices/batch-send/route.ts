import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { InvoiceEmailService } from '@/lib/email/invoice-email-service';
import { z } from 'zod';

// Request schema
const batchSendSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1).max(100),
  attachPdf: z.boolean().default(false),
  includePaymentLink: z.boolean().default(true),
  resend: z.boolean().default(false),
  filter: z.object({
    status: z.enum(['draft', 'sent', 'overdue', 'paid']).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    customerId: z.string().uuid().optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
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

    // Parse request body
    const body = await request.json();
    const validatedData = batchSendSchema.parse(body);

    let invoiceIds = validatedData.invoiceIds;

    // If filter is provided, fetch matching invoices
    if (validatedData.filter && Object.keys(validatedData.filter).length > 0) {
      let query = supabase
        .from('invoices')
        .select('id')
        .eq('tenant_id', tenantId);

      if (validatedData.filter.status) {
        query = query.eq('status', validatedData.filter.status);
      }
      if (validatedData.filter.dateFrom) {
        query = query.gte('issue_date', validatedData.filter.dateFrom);
      }
      if (validatedData.filter.dateTo) {
        query = query.lte('issue_date', validatedData.filter.dateTo);
      }
      if (validatedData.filter.customerId) {
        query = query.eq('customer_id', validatedData.filter.customerId);
      }

      const { data: filteredInvoices, error: filterError } = await query;

      if (filterError) {
        throw filterError;
      }

      // Combine with provided IDs (if any) or use filtered results
      if (invoiceIds.length === 0) {
        invoiceIds = filteredInvoices?.map(i => i.id) || [];
      } else {
        // Intersect provided IDs with filtered results
        const filteredIds = new Set(filteredInvoices?.map(i => i.id) || []);
        invoiceIds = invoiceIds.filter(id => filteredIds.has(id));
      }
    }

    if (invoiceIds.length === 0) {
      return NextResponse.json(
        { error: 'No invoices found matching criteria' },
        { status: 400 }
      );
    }

    // Verify all invoices belong to tenant and can be sent
    const { data: invoices, error: verifyError } = await supabase
      .from('invoices')
      .select('id, invoice_number, status')
      .eq('tenant_id', tenantId)
      .in('id', invoiceIds);

    if (verifyError || !invoices || invoices.length === 0) {
      return NextResponse.json(
        { error: 'No valid invoices found' },
        { status: 404 }
      );
    }

    // Filter out cancelled invoices
    const validInvoices = invoices.filter(i => i.status !== 'cancelled');
    if (validInvoices.length === 0) {
      return NextResponse.json(
        { error: 'All selected invoices are cancelled' },
        { status: 400 }
      );
    }

    // Initialize email service
    const emailService = new InvoiceEmailService(supabase);

    // Send emails in batch
    const results = await emailService.sendBatchInvoiceEmails(
      validInvoices.map(i => i.id),
      tenantId,
      {
        attachPdf: validatedData.attachPdf,
        includePaymentLink: validatedData.includePaymentLink,
        resend: validatedData.resend,
      }
    );

    // Compile results
    const successful: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    const alreadySent: string[] = [];

    results.forEach((result, invoiceId) => {
      if (result.success) {
        successful.push(invoiceId);
      } else if (result.error?.includes('already been sent')) {
        alreadySent.push(invoiceId);
      } else {
        failed.push({ id: invoiceId, error: result.error || 'Unknown error' });
      }
    });

    // Get invoice numbers for response
    const invoiceMap = new Map(invoices.map(i => [i.id, i.invoice_number]));

    return NextResponse.json({
      success: true,
      summary: {
        total: validInvoices.length,
        successful: successful.length,
        failed: failed.length,
        alreadySent: alreadySent.length,
        skipped: invoices.length - validInvoices.length,
      },
      results: {
        successful: successful.map(id => ({
          id,
          invoiceNumber: invoiceMap.get(id),
        })),
        failed: failed.map(f => ({
          ...f,
          invoiceNumber: invoiceMap.get(f.id),
        })),
        alreadySent: alreadySent.map(id => ({
          id,
          invoiceNumber: invoiceMap.get(id),
        })),
      },
      message: `Sent ${successful.length} of ${validInvoices.length} invoices`,
    });
  } catch (error) {
    console.error('Batch send invoice emails error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to send invoice emails' },
      { status: 500 }
    );
  }
}