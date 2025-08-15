import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { InvoiceEmailService } from '@/lib/email/invoice-email-service';
import { z } from 'zod';

// Request schema
const sendInvoiceSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  cc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  bcc: z.union([z.string().email(), z.array(z.string().email())]).optional(),
  attachPdf: z.boolean().default(false),
  includePaymentLink: z.boolean().default(true),
  customMessage: z.string().optional(),
  resend: z.boolean().default(false),
});

export async function POST(
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
    const body = await request.json();
    const validatedData = sendInvoiceSchema.parse(body);

    // Check if invoice exists and belongs to tenant
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, invoice_number, status')
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Check if invoice can be sent
    if (invoice.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot send email for cancelled invoice' },
        { status: 400 }
      );
    }

    // Initialize email service
    const emailService = new InvoiceEmailService(supabase);

    // Check if already sent (unless resending)
    if (!validatedData.resend) {
      const isSent = await emailService.isInvoiceSent(invoiceId, tenantId);
      if (isSent) {
        return NextResponse.json(
          { 
            error: 'Invoice has already been sent. Set resend=true to send again.',
            alreadySent: true,
          },
          { status: 400 }
        );
      }
    }

    // Send the email
    const result = await emailService.sendInvoiceEmail({
      invoiceId,
      tenantId,
      ...validatedData,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send invoice email' },
        { status: 500 }
      );
    }

    // Get email history
    const history = await emailService.getInvoiceEmailHistory(invoiceId, tenantId);

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      emailLogId: result.emailLogId,
      invoiceNumber: invoice.invoice_number,
      sentCount: history.filter(e => e.status === 'sent').length,
      message: validatedData.resend 
        ? 'Invoice email resent successfully' 
        : 'Invoice email sent successfully',
    });
  } catch (error) {
    console.error('Send invoice email error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to send invoice email' },
      { status: 500 }
    );
  }
}

// GET - Get email history for invoice
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

    // Check if invoice exists and belongs to tenant
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, invoice_number')
      .eq('id', invoiceId)
      .eq('tenant_id', tenantId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // Get email history
    const emailService = new InvoiceEmailService(supabase);
    const history = await emailService.getInvoiceEmailHistory(invoiceId, tenantId);

    // Get last sent email
    const lastSent = await emailService.getLastSentEmail(invoiceId, tenantId);

    return NextResponse.json({
      invoiceNumber: invoice.invoice_number,
      emailHistory: history,
      lastSent,
      totalSent: history.filter(e => e.status === 'sent').length,
      totalFailed: history.filter(e => e.status === 'failed').length,
    });
  } catch (error) {
    console.error('Get invoice email history error:', error);
    return NextResponse.json(
      { error: 'Failed to get email history' },
      { status: 500 }
    );
  }
}